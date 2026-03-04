import { randomUUID } from 'crypto'
import ts from 'typescript'

import type { InteractionPoint } from '@/libs/types'

/** JS/TS 程式碼中偵測的模式 */
interface PatternMatch {
  node: ts.Node
  type: InteractionPoint['type']
  patternName: string
  confidence: InteractionPoint['confidence']
}

/**
 * 使用 TypeScript Compiler API 分析 JS/TS 原始碼中的高風險交互點。
 * 偵測項目：
 * - eval() 等危險呼叫
 * - innerHTML / outerHTML 賦值
 * - 直接使用 req.query / req.params / req.body（未消毒輸入）
 * - 原型鏈變異（__proto__、Object.setPrototypeOf、.prototype 賦值）
 */
export function analyzeJsTs(
  code: string,
  filePath: string,
  language: 'javascript' | 'typescript',
): InteractionPoint[] {
  const scriptKind = language === 'typescript' ? ts.ScriptKind.TS : ts.ScriptKind.JS
  const sourceFile = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, scriptKind)
  const matches: PatternMatch[] = []

  function visit(node: ts.Node) {
    detectEval(node, matches)
    detectNewFunction(node, matches)
    detectInnerHtml(node, matches)
    detectDirectQuery(node, matches)
    detectSqlInjection(node, matches)
    detectHardcodedSecret(node, matches)
    detectPrototypeMutation(node, matches)
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return matches.map((m) => nodeToInteractionPoint(m, sourceFile, filePath, language, code))
}


// ---------------------------------------------------------------------------
// 模式偵測器
// ---------------------------------------------------------------------------

const DANGEROUS_CALLS = new Set(['eval', 'Function', 'setTimeout', 'setInterval'])

/** 偵測 eval()、new Function()、setTimeout(字串)、setInterval(字串) */
function detectEval(node: ts.Node, out: PatternMatch[]) {
  if (!ts.isCallExpression(node)) return

  const name = extractCallName(node.expression)
  if (name !== null && DANGEROUS_CALLS.has(name)) {
    // setTimeout/setInterval 僅在第一個參數為字串字面值時標記
    if ((name === 'setTimeout' || name === 'setInterval') && node.arguments.length > 0) {
      const firstArg = node.arguments[0]
      if (!ts.isStringLiteral(firstArg) && !ts.isTemplateExpression(firstArg) && !ts.isNoSubstitutionTemplateLiteral(firstArg)) {
        return
      }
    }
    out.push({ node, type: 'dangerous_call', patternName: name, confidence: 'high' })
  }
}

/** 偵測 `new Function(...)` */
function detectNewFunction(node: ts.Node, out: PatternMatch[]) {
  if (!ts.isNewExpression(node)) return
  const name = extractCallName(node.expression)
  if (name === 'Function') {
    out.push({ node, type: 'dangerous_call', patternName: 'Function', confidence: 'high' })
  }
}

const DANGEROUS_HTML_PROPS = new Set(['innerHTML', 'outerHTML'])

/** 偵測 innerHTML / outerHTML 賦值 */
function detectInnerHtml(node: ts.Node, out: PatternMatch[]) {
  // el.innerHTML = ...（左側為 PropertyAccessExpression 的 BinaryExpression）
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const left = node.left
    if (ts.isPropertyAccessExpression(left) && DANGEROUS_HTML_PROPS.has(left.name.text)) {
      out.push({ node, type: 'unsafe_pattern', patternName: left.name.text, confidence: 'high' })
    }
  }

  // 目前聚焦於賦值操作以確保高信心度
}

const DIRECT_QUERY_PROPS = new Set(['query', 'params', 'body'])
const DIRECT_QUERY_OBJECTS = new Set(['req', 'request', 'ctx'])

/** 偵測未消毒的 req.query、req.params、req.body 直接存取 */
function detectDirectQuery(node: ts.Node, out: PatternMatch[]) {
  if (!ts.isPropertyAccessExpression(node)) return

  const propName = node.name.text
  if (!DIRECT_QUERY_PROPS.has(propName)) return

  // 檢查物件是否為已知的 request 類識別符
  const objName = extractIdentifierName(node.expression)
  if (objName !== null && DIRECT_QUERY_OBJECTS.has(objName)) {
    out.push({ node, type: 'sensitive_data', patternName: `direct_query_${propName}`, confidence: 'medium' })
  }
}

const SQL_KEYWORD = /\b(select|insert|update|delete|replace|drop|union|where|from|into|like)\b/i

/** 偵測 SQL 字串拼接 / 模板插值 */
function detectSqlInjection(node: ts.Node, out: PatternMatch[]) {
  if (ts.isTemplateExpression(node)) {
    const literalText =
      node.head.text + node.templateSpans.map((span) => span.literal.text).join(' ')
    if (SQL_KEYWORD.test(literalText) && node.templateSpans.length > 0) {
      out.push({
        node,
        type: 'unsafe_pattern',
        patternName: 'sql_string_concat',
        confidence: 'medium',
      })
    }
    return
  }

  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.PlusToken) return

  const parts = flattenPlusOperands(node)
  const hasSqlLiteral = parts.some((part) => {
    if (!isStringLike(part)) return false
    return SQL_KEYWORD.test(readStringLike(part))
  })
  if (!hasSqlLiteral) return

  const hasDynamicPart = parts.some((part) => !isStringLike(part))
  if (!hasDynamicPart) return

  out.push({
    node,
    type: 'unsafe_pattern',
    patternName: 'sql_string_concat',
    confidence: 'medium',
  })
}

const SECRET_NAME = /(secret|token|api[_-]?key|password|passwd|jwt|private[_-]?key)/i

/** 偵測硬編碼憑證 / token */
function detectHardcodedSecret(node: ts.Node, out: PatternMatch[]) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    if (!SECRET_NAME.test(node.name.text)) return
    if (!isLikelySecretLiteral(node.initializer)) return
    out.push({
      node,
      type: 'sensitive_data',
      patternName: 'hardcoded_secret',
      confidence: 'high',
    })
    return
  }

  if (!ts.isPropertyAssignment(node)) return
  const keyName = readPropertyName(node.name)
  if (!keyName || !SECRET_NAME.test(keyName)) return
  if (!isLikelySecretLiteral(node.initializer)) return
  out.push({
    node,
    type: 'sensitive_data',
    patternName: 'hardcoded_secret',
    confidence: 'high',
  })
}

/** 偵測原型鏈變異 */
function detectPrototypeMutation(node: ts.Node, out: PatternMatch[]) {
  // __proto__ 賦值：obj.__proto__ = ...
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const left = node.left
    if (ts.isPropertyAccessExpression(left) && left.name.text === '__proto__') {
      out.push({ node, type: 'prototype_mutation', patternName: '__proto__', confidence: 'high' })
      return
    }
    // .prototype = ... 賦值
    if (ts.isPropertyAccessExpression(left) && left.name.text === 'prototype') {
      out.push({ node, type: 'prototype_mutation', patternName: 'prototype_assignment', confidence: 'medium' })
      return
    }
  }

  // Object.setPrototypeOf(...)
  if (ts.isCallExpression(node)) {
    const name = extractFullCallName(node.expression)
    if (name === 'Object.setPrototypeOf') {
      out.push({ node, type: 'prototype_mutation', patternName: 'Object.setPrototypeOf', confidence: 'high' })
    }
    if (name === 'Object.assign' && node.arguments.length >= 1) {
      const targetArg = node.arguments[0]
      const targetName = extractFullCallName(targetArg)
      if (targetName === 'Object.prototype') {
        out.push({
          node,
          type: 'prototype_mutation',
          patternName: 'Object.assign.Object.prototype',
          confidence: 'high',
        })
      }
    }
    // Object.assign 含 __proto__
    if (name === 'Object.assign' && node.arguments.length >= 2) {
      const secondArg = node.arguments[1]
      if (ts.isObjectLiteralExpression(secondArg)) {
        for (const prop of secondArg.properties) {
          if (ts.isPropertyAssignment(prop)) {
            const propName = ts.isIdentifier(prop.name) ? prop.name.text
              : ts.isStringLiteral(prop.name) ? prop.name.text
              : null
            if (propName === '__proto__') {
              out.push({ node, type: 'prototype_mutation', patternName: 'Object.assign.__proto__', confidence: 'high' })
            }
          }
        }
      }
    }
  }
}


// ---------------------------------------------------------------------------
// 輔助函式
// ---------------------------------------------------------------------------

/** 從呼叫表達式中提取簡單名稱（如 `eval(...)` 中的 `eval`） */
function extractCallName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text
  return null
}

/** 提取完整的點分名稱（如 `Object.setPrototypeOf`） */
function extractFullCallName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr)) {
    const obj = extractFullCallName(expr.expression)
    return obj ? `${obj}.${expr.name.text}` : expr.name.text
  }
  return null
}

/** 從表達式中提取識別符名稱，無則回傳 null */
function extractIdentifierName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text
  return null
}

function flattenPlusOperands(node: ts.Expression): ts.Expression[] {
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.PlusToken) {
    return [node]
  }
  return [...flattenPlusOperands(node.left), ...flattenPlusOperands(node.right)]
}

function isStringLike(node: ts.Expression): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  )
}

function readStringLike(node: ts.Expression): string {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (!ts.isTemplateExpression(node)) return ''
  return node.head.text + node.templateSpans.map((span) => span.literal.text).join(' ')
}

function readPropertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name)) return name.text
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) return name.text
  return null
}

function isLikelySecretLiteral(node: ts.Expression): boolean {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text.trim().length >= 8
  }
  return false
}

/** 將 PatternMatch + AST 節點轉換為 InteractionPoint */
function nodeToInteractionPoint(
  match: PatternMatch,
  sourceFile: ts.SourceFile,
  filePath: string,
  language: 'javascript' | 'typescript',
  code: string,
): InteractionPoint {
  const { line: startLine, character: startCol } = sourceFile.getLineAndCharacterOfPosition(match.node.getStart(sourceFile))
  const { line: endLine, character: endCol } = sourceFile.getLineAndCharacterOfPosition(match.node.getEnd())

  // 提取包含此節點的原始碼行
  const lines = code.split('\n')
  const snippetLines = lines.slice(startLine, endLine + 1)
  const codeSnippet = snippetLines.join('\n').trim()

  return {
    id: randomUUID(),
    type: match.type,
    language,
    filePath,
    line: startLine + 1,       // 1-based
    column: startCol + 1,      // 1-based
    endLine: endLine + 1,
    endColumn: endCol + 1,
    codeSnippet,
    patternName: match.patternName,
    confidence: match.confidence,
  }
}

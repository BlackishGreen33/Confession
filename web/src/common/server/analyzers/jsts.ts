import { randomUUID } from 'crypto'
import ts from 'typescript'

import type { InteractionPoint } from '@/lib/types'

/** Patterns we detect in JS/TS code */
interface PatternMatch {
  node: ts.Node
  type: InteractionPoint['type']
  patternName: string
  confidence: InteractionPoint['confidence']
}

/**
 * Analyze JS/TS source code for high-risk interaction points using the
 * TypeScript Compiler API. Detects:
 * - eval() and similar dangerous calls
 * - innerHTML / outerHTML assignments
 * - Direct use of req.query / req.params / req.body (unsanitized input)
 * - Prototype chain mutations (__proto__, Object.setPrototypeOf, .prototype assignment)
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
    detectPrototypeMutation(node, matches)
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)

  return matches.map((m) => nodeToInteractionPoint(m, sourceFile, filePath, language, code))
}


// ---------------------------------------------------------------------------
// Pattern detectors
// ---------------------------------------------------------------------------

const DANGEROUS_CALLS = new Set(['eval', 'Function', 'setTimeout', 'setInterval'])

/** Detect eval(), new Function(), setTimeout(string), setInterval(string) */
function detectEval(node: ts.Node, out: PatternMatch[]) {
  if (!ts.isCallExpression(node)) return

  const name = extractCallName(node.expression)
  if (name !== null && DANGEROUS_CALLS.has(name)) {
    // For setTimeout/setInterval, only flag when first arg is a string literal
    if ((name === 'setTimeout' || name === 'setInterval') && node.arguments.length > 0) {
      const firstArg = node.arguments[0]
      if (!ts.isStringLiteral(firstArg) && !ts.isTemplateExpression(firstArg) && !ts.isNoSubstitutionTemplateLiteral(firstArg)) {
        return
      }
    }
    out.push({ node, type: 'dangerous_call', patternName: name, confidence: 'high' })
  }
}

/** Detect `new Function(...)` */
function detectNewFunction(node: ts.Node, out: PatternMatch[]) {
  if (!ts.isNewExpression(node)) return
  const name = extractCallName(node.expression)
  if (name === 'Function') {
    out.push({ node, type: 'dangerous_call', patternName: 'Function', confidence: 'high' })
  }
}

const DANGEROUS_HTML_PROPS = new Set(['innerHTML', 'outerHTML'])

/** Detect assignments to innerHTML / outerHTML */
function detectInnerHtml(node: ts.Node, out: PatternMatch[]) {
  // el.innerHTML = ... (BinaryExpression with PropertyAccessExpression on left)
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const left = node.left
    if (ts.isPropertyAccessExpression(left) && DANGEROUS_HTML_PROPS.has(left.name.text)) {
      out.push({ node, type: 'unsafe_pattern', patternName: left.name.text, confidence: 'high' })
    }
  }

  // Also detect property access reads like `el.innerHTML` used in other contexts
  // (e.g., passed as argument). We focus on assignments for high confidence.
}

const DIRECT_QUERY_PROPS = new Set(['query', 'params', 'body'])
const DIRECT_QUERY_OBJECTS = new Set(['req', 'request', 'ctx'])

/** Detect direct use of req.query, req.params, req.body without sanitization */
function detectDirectQuery(node: ts.Node, out: PatternMatch[]) {
  if (!ts.isPropertyAccessExpression(node)) return

  const propName = node.name.text
  if (!DIRECT_QUERY_PROPS.has(propName)) return

  // Check if the object is a known request-like identifier
  const objName = extractIdentifierName(node.expression)
  if (objName !== null && DIRECT_QUERY_OBJECTS.has(objName)) {
    out.push({ node, type: 'sensitive_data', patternName: `direct_query_${propName}`, confidence: 'medium' })
  }
}

/** Detect prototype chain mutations */
function detectPrototypeMutation(node: ts.Node, out: PatternMatch[]) {
  // __proto__ assignment: obj.__proto__ = ...
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    const left = node.left
    if (ts.isPropertyAccessExpression(left) && left.name.text === '__proto__') {
      out.push({ node, type: 'prototype_mutation', patternName: '__proto__', confidence: 'high' })
      return
    }
    // .prototype = ... assignment
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
    // Object.assign with __proto__
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
// Helpers
// ---------------------------------------------------------------------------

/** Extract the simple name from a call expression (e.g., `eval` from `eval(...)`) */
function extractCallName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text
  return null
}

/** Extract the full dotted name (e.g., `Object.setPrototypeOf`) */
function extractFullCallName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr)) {
    const obj = extractFullCallName(expr.expression)
    return obj ? `${obj}.${expr.name.text}` : expr.name.text
  }
  return null
}

/** Extract identifier name from an expression, or null */
function extractIdentifierName(expr: ts.Expression): string | null {
  if (ts.isIdentifier(expr)) return expr.text
  return null
}

/** Convert a PatternMatch + AST node into an InteractionPoint */
function nodeToInteractionPoint(
  match: PatternMatch,
  sourceFile: ts.SourceFile,
  filePath: string,
  language: 'javascript' | 'typescript',
  code: string,
): InteractionPoint {
  const { line: startLine, character: startCol } = sourceFile.getLineAndCharacterOfPosition(match.node.getStart(sourceFile))
  const { line: endLine, character: endCol } = sourceFile.getLineAndCharacterOfPosition(match.node.getEnd())

  // Extract the line(s) of source code containing this node
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

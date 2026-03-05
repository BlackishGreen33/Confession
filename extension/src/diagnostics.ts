import * as vscode from 'vscode'

import { generateMonitoringCode } from './monitoring'
import type { Severity, Vulnerability } from './types'

// === 漏洞儲存（按檔案路徑索引） ===

const vulnsByFile = new Map<string, Vulnerability[]>()

let diagnosticCollection: vscode.DiagnosticCollection

// === 嚴重度映射 ===

function mapSeverity(severity: Severity): vscode.DiagnosticSeverity {
  switch (severity) {
    case 'critical':
    case 'high':
      return vscode.DiagnosticSeverity.Error
    case 'medium':
      return vscode.DiagnosticSeverity.Warning
    case 'low':
    case 'info':
      return vscode.DiagnosticSeverity.Information
  }
}

// === 漏洞 → Diagnostic 轉換 ===

function vulnToDiagnostic(vuln: Vulnerability): vscode.Diagnostic {
  // 資料模型使用 1-based 行列號，VS Code 使用 0-based
  const range = new vscode.Range(
    new vscode.Position(vuln.line - 1, vuln.column - 1),
    new vscode.Position(vuln.endLine - 1, vuln.endColumn - 1),
  )

  const diagnostic = new vscode.Diagnostic(range, vuln.description, mapSeverity(vuln.severity))
  diagnostic.source = 'Confession'
  diagnostic.code = vuln.cweId ?? vuln.type

  return diagnostic
}

function normalizeSnippetForMatch(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim()
}

function includesSnippetLoosely(text: string, snippet: string): boolean {
  if (!snippet.trim()) return false
  if (text.includes(snippet)) return true
  const normalizedSnippet = normalizeSnippetForMatch(snippet)
  if (!normalizedSnippet) return false
  return normalizeSnippetForMatch(text).includes(normalizedSnippet)
}

function hasMonitoringCodeNearLine(
  doc: vscode.TextDocument,
  monitoringCode: string,
  centerLine: number,
  lineWindow = 30,
): boolean {
  const maxLine = Math.max(0, doc.lineCount - 1)
  const startLine = Math.max(0, centerLine - lineWindow)
  const endLine = Math.min(maxLine, centerLine + lineWindow)
  const start = new vscode.Position(startLine, 0)
  const end = doc.lineAt(endLine).range.end
  const text = doc.getText(new vscode.Range(start, end))
  return includesSnippetLoosely(text, monitoringCode)
}

// === 更新 Diagnostics ===

export function updateDiagnostics(filePath: string, vulns: Vulnerability[]): void {
  const openVulns = vulns.filter((v) => v.status === 'open')
  vulnsByFile.set(filePath, openVulns)

  const uri = vscode.Uri.file(filePath)
  diagnosticCollection.set(uri, openVulns.map(vulnToDiagnostic))
}

export function clearDiagnostics(filePath: string): void {
  vulnsByFile.delete(filePath)
  diagnosticCollection.set(vscode.Uri.file(filePath), [])
}

export function clearAllDiagnostics(): void {
  vulnsByFile.clear()
  diagnosticCollection.clear()
}


// === 根據位置查找漏洞 ===

function findVulnAtPosition(filePath: string, position: vscode.Position): Vulnerability | undefined {
  const vulns = vulnsByFile.get(filePath)
  if (!vulns) return undefined

  return vulns.find((v) => {
    const range = new vscode.Range(
      new vscode.Position(v.line - 1, v.column - 1),
      new vscode.Position(v.endLine - 1, v.endColumn - 1),
    )
    return range.contains(position)
  })
}

// === HoverProvider ===

const hoverProvider: vscode.HoverProvider = {
  provideHover(document, position) {
    const vuln = findVulnAtPosition(document.fileName, position)
    if (!vuln) return undefined

    const lines: string[] = [
      `**🔒 Confession — ${vuln.type}**`,
      '',
      `**嚴重等級：** ${vuln.severity}`,
    ]

    if (vuln.cweId) {
      lines.push(`**CWE：** ${vuln.cweId}`)
    }

    if (vuln.riskDescription) {
      lines.push('', `**風險描述：** ${vuln.riskDescription}`)
    }

    if (vuln.fixExplanation) {
      lines.push('', `**修復建議：** ${vuln.fixExplanation}`)
    }

    if (vuln.fixNewCode) {
      lines.push('', '**建議修復代碼：**', '```', vuln.fixNewCode, '```')
    }

    const markdown = new vscode.MarkdownString(lines.join('\n'))
    markdown.isTrusted = true

    return new vscode.Hover(markdown)
  },
}

// === CodeActionProvider ===

const codeActionProvider: vscode.CodeActionProvider = {
  provideCodeActions(document, range) {
    const vulns = vulnsByFile.get(document.fileName)
    if (!vulns) return []

    const actions: vscode.CodeAction[] = []

    for (const vuln of vulns) {
      const vulnRange = new vscode.Range(
        new vscode.Position(vuln.line - 1, vuln.column - 1),
        new vscode.Position(vuln.endLine - 1, vuln.endColumn - 1),
      )

      if (!range.intersection(vulnRange)) continue

      // 一鍵修復
      if (vuln.fixOldCode && vuln.fixNewCode) {
        const fullText = document.getText()
        const vulnText = document.getText(vulnRange)
        const alreadyFixed =
          includesSnippetLoosely(vulnText, vuln.fixNewCode) ||
          includesSnippetLoosely(fullText, vuln.fixNewCode)

        if (!alreadyFixed) {
          const fixAction = new vscode.CodeAction(
            `Confession: 修復 ${vuln.type}`,
            vscode.CodeActionKind.QuickFix,
          )
          fixAction.diagnostics = [vulnToDiagnostic(vuln)]
          fixAction.edit = new vscode.WorkspaceEdit()

          // 套用修復代碼
          fixAction.edit.replace(document.uri, vulnRange, vuln.fixNewCode)

          // 插入嵌入式監測日誌（修復代碼下一行）
          const monitoringCode = generateMonitoringCode(vuln, document.languageId)
          if (monitoringCode && !hasMonitoringCodeNearLine(document, monitoringCode, vuln.endLine)) {
            const insertPos = new vscode.Position(vuln.endLine, 0)
            fixAction.edit.insert(document.uri, insertPos, monitoringCode + '\n')
          }

          fixAction.isPreferred = true
          actions.push(fixAction)
        }
      }

      // 忽略此問題
      const ignoreAction = new vscode.CodeAction(
        `Confession: 忽略 ${vuln.type}`,
        vscode.CodeActionKind.QuickFix,
      )
      ignoreAction.command = {
        command: 'codeVuln.ignoreVulnerability',
        title: '忽略此漏洞',
        arguments: [vuln.id],
      }
      actions.push(ignoreAction)
    }

    return actions
  },
}

// === 註冊所有 Providers ===

const SUPPORTED_LANGUAGES = [
  { language: 'go' },
  { language: 'javascript' },
  { language: 'typescript' },
  { language: 'typescriptreact' },
  { language: 'javascriptreact' },
]

export function registerDiagnostics(context: vscode.ExtensionContext): vscode.DiagnosticCollection {
  diagnosticCollection = vscode.languages.createDiagnosticCollection('confession')
  context.subscriptions.push(diagnosticCollection)

  context.subscriptions.push(
    vscode.languages.registerHoverProvider(SUPPORTED_LANGUAGES, hoverProvider),
  )

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(SUPPORTED_LANGUAGES, codeActionProvider, {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
  )

  return diagnosticCollection
}

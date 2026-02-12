import * as vscode from 'vscode'

import { registerDiagnostics, updateDiagnostics } from './diagnostics'
import { createFileWatcher } from './file-watcher'
import {
  fetchAllOpenVulnerabilities,
  fetchFileVulnerabilities,
  fetchVulnerabilityById,
  ignoreVulnerability,
  pollUntilDone,
  triggerScan,
} from './scan-client'
import { createStatusBar, setAnalyzing, setResult } from './status-bar'
import type { PluginConfig } from './types'
import { registerDashboardProvider, sendConfigUpdate, sendScanProgress, sendVulnerabilities } from './webview'

/** 輸出頻道，用於記錄插件日誌 */
let outputChannel: vscode.OutputChannel

/**
 * 從 VS Code settings.json 讀取插件配置
 */
function getPluginConfig(): PluginConfig {
  const config = vscode.workspace.getConfiguration('confession')
  return {
    llm: {
      provider: 'gemini',
      apiKey: config.get<string>('llm.apiKey', ''),
      endpoint: config.get<string>('llm.endpoint'),
      model: config.get<string>('llm.model'),
    },
    analysis: {
      triggerMode: config.get<'onSave' | 'manual'>('analysis.triggerMode', 'onSave'),
      depth: config.get<'quick' | 'standard' | 'deep'>('analysis.depth', 'standard'),
      debounceMs: config.get<number>('analysis.debounceMs', 500),
    },
    ignore: {
      paths: config.get<string[]>('ignore.paths', []),
      types: config.get<string[]>('ignore.types', []),
    },
    api: {
      baseUrl: config.get<string>('api.baseUrl', 'http://localhost:3000'),
      mode: config.get<'local' | 'remote'>('api.mode', 'local'),
    },
  }
}

export function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel('Confession')
  outputChannel.appendLine('Confession 插件啟動中…')

  const pluginConfig = getPluginConfig()
  outputChannel.appendLine(`API 模式: ${pluginConfig.api.mode} (${pluginConfig.api.baseUrl})`)
  outputChannel.appendLine(`分析觸發: ${pluginConfig.analysis.triggerMode}, 深度: ${pluginConfig.analysis.depth}`)

  // --- 註冊側邊欄 Webview Provider ---
  registerDashboardProvider(context, getPluginConfig)

  // --- 註冊指令 ---
  context.subscriptions.push(
    vscode.commands.registerCommand('codeVuln.scanFile', () => {
      void scanCurrentFile(getPluginConfig)
    }),

    vscode.commands.registerCommand('codeVuln.scanWorkspace', () => {
      void scanWorkspaceFiles(getPluginConfig)
    }),

    vscode.commands.registerCommand('codeVuln.openDashboard', () => {
      outputChannel.appendLine('聚焦側邊欄安全儀表盤')
      vscode.commands.executeCommand('confession.dashboard.focus')
    }),

    vscode.commands.registerCommand('codeVuln.ignoreVulnerability', (vulnId: string) => {
      void handleIgnoreVulnerability(vulnId, getPluginConfig)
    }),
  )

  // --- 註冊 Diagnostics / Hover / CodeAction Providers ---
  registerDiagnostics(context)

  // --- 狀態列 ---
  createStatusBar(context)

  // --- 檔案儲存監聽 + debounce 增量分析 ---
  context.subscriptions.push(createFileWatcher(getPluginConfig, outputChannel))

  // --- 監聽配置變更 ---
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('confession')) {
        const updated = getPluginConfig()
        outputChannel.appendLine(`配置已更新: API=${updated.api.baseUrl}, 觸發=${updated.analysis.triggerMode}`)
        sendConfigUpdate(updated)
      }
    }),
  )

  // --- 清理輸出頻道 ---
  context.subscriptions.push(outputChannel)

  outputChannel.appendLine('Confession 插件啟動完成')
}

export function deactivate() {
  // 清理資源（outputChannel 已透過 subscriptions 自動 dispose）
}

// === 支援的語言 ID ===

const SUPPORTED_LANGUAGE_IDS = new Set([
  'go',
  'javascript',
  'typescript',
  'typescriptreact',
  'javascriptreact',
])

/** 語言 ID → API 語言名稱 */
function toApiLanguage(languageId: string): string {
  switch (languageId) {
    case 'go':
      return 'go'
    case 'javascript':
    case 'javascriptreact':
      return 'javascript'
    case 'typescript':
    case 'typescriptreact':
      return 'typescript'
    default:
      return languageId
  }
}

/** 掃描當前檔案 */
async function scanCurrentFile(getConfig: () => PluginConfig): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showWarningMessage('Confession: 沒有打開的檔案')
    return
  }

  const doc = editor.document
  if (!SUPPORTED_LANGUAGE_IDS.has(doc.languageId)) {
    vscode.window.showWarningMessage('Confession: 不支援此檔案類型')
    return
  }

  const config = getConfig()
  const baseUrl = config.api.baseUrl.replace(/\/+$/, '')

  outputChannel.appendLine(`掃描檔案: ${doc.fileName}`)
  setAnalyzing()
  sendScanProgress('running', 0)

  try {
    const taskId = await triggerScan(baseUrl, [
      { path: doc.fileName, content: doc.getText(), language: toApiLanguage(doc.languageId) },
    ], { depth: config.analysis.depth, includeLlmScan: config.analysis.depth === 'deep' })

    await pollUntilDone(baseUrl, taskId, (progress) => {
      sendScanProgress('running', progress)
    })

    const vulns = await fetchFileVulnerabilities(baseUrl, doc.fileName)
    updateDiagnostics(doc.fileName, vulns)
    setResult(vulns.length)
    sendVulnerabilities(vulns)
    sendScanProgress('completed', 1)

    outputChannel.appendLine(`掃描完成: ${doc.fileName}, 發現 ${vulns.length} 個漏洞`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤'
    outputChannel.appendLine(`掃描失敗: ${msg}`)
    setResult(0)
    sendScanProgress('failed', 0)
    vscode.window.showErrorMessage(`Confession: 掃描失敗 — ${msg}`)
  }
}

/** 掃描工作區所有支援的檔案 */
async function scanWorkspaceFiles(getConfig: () => PluginConfig): Promise<void> {
  const folders = vscode.workspace.workspaceFolders
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage('Confession: 沒有打開的工作區')
    return
  }

  const config = getConfig()
  const baseUrl = config.api.baseUrl.replace(/\/+$/, '')

  outputChannel.appendLine(`掃描工作區: ${folders.map((f) => f.name).join(', ')}`)
  setAnalyzing()
  sendScanProgress('running', 0)

  try {
    // 搜尋所有支援的檔案
    const uris = await vscode.workspace.findFiles(
      '**/*.{go,js,jsx,ts,tsx}',
      '**/node_modules/**',
      500,
    )

    if (uris.length === 0) {
      outputChannel.appendLine('工作區中未找到支援的檔案')
      setResult(0)
      sendScanProgress('completed', 1)
      return
    }

    // 讀取檔案內容
    const files = await Promise.all(
      uris
        .filter((uri) => !config.ignore.paths.some((p) => uri.fsPath.includes(p)))
        .map(async (uri) => {
          const doc = await vscode.workspace.openTextDocument(uri)
          return {
            path: uri.fsPath,
            content: doc.getText(),
            language: toApiLanguage(doc.languageId),
          }
        }),
    )

    outputChannel.appendLine(`找到 ${files.length} 個檔案，開始掃描…`)

    const taskId = await triggerScan(baseUrl, files, {
      depth: config.analysis.depth,
      includeLlmScan: config.analysis.depth === 'deep',
    })

    await pollUntilDone(baseUrl, taskId, (progress) => {
      sendScanProgress('running', progress)
    })

    // 取得所有開放漏洞並按檔案更新 diagnostics
    const allVulns = await fetchAllOpenVulnerabilities(baseUrl)
    const byFile = new Map<string, typeof allVulns>()
    for (const v of allVulns) {
      const list = byFile.get(v.filePath) ?? []
      list.push(v)
      byFile.set(v.filePath, list)
    }

    for (const [filePath, vulns] of byFile) {
      updateDiagnostics(filePath, vulns)
    }

    setResult(allVulns.length)
    sendVulnerabilities(allVulns)
    sendScanProgress('completed', 1)

    outputChannel.appendLine(`工作區掃描完成，共發現 ${allVulns.length} 個漏洞`)
    vscode.window.showInformationMessage(`Confession: 掃描完成，發現 ${allVulns.length} 個漏洞`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤'
    outputChannel.appendLine(`工作區掃描失敗: ${msg}`)
    setResult(0)
    sendScanProgress('failed', 0)
    vscode.window.showErrorMessage(`Confession: 工作區掃描失敗 — ${msg}`)
  }
}

/** 忽略漏洞 */
async function handleIgnoreVulnerability(vulnId: string, getConfig: () => PluginConfig): Promise<void> {
  const config = getConfig()
  const baseUrl = config.api.baseUrl.replace(/\/+$/, '')

  try {
    const ok = await ignoreVulnerability(baseUrl, vulnId)
    if (!ok) {
      vscode.window.showErrorMessage('Confession: 忽略漏洞失敗')
      return
    }

    // 取得漏洞資訊以更新 diagnostics
    const vuln = await fetchVulnerabilityById(baseUrl, vulnId)
    if (vuln) {
      const vulns = await fetchFileVulnerabilities(baseUrl, vuln.filePath)
      updateDiagnostics(vuln.filePath, vulns)
      setResult(vulns.length)
    }

    vscode.window.showInformationMessage('Confession: 已忽略此漏洞')
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤'
    vscode.window.showErrorMessage(`Confession: 忽略漏洞失敗 — ${msg}`)
  }
}

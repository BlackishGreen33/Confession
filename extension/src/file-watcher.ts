import * as vscode from 'vscode'

import { updateDiagnostics } from './diagnostics'
import { fetchFileVulnerabilities, pollUntilDone, triggerScan } from './scan-client'
import { setAnalyzing, setFailed, setResult } from './status-bar'
import type { PluginConfig } from './types'
import { sendScanProgress, sendVulnerabilities } from './webview'

/** 支援的語言 ID */
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

/** 每個檔案的 debounce 計時器 */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** 取得目前配置的讀取函數 */
type ConfigGetter = () => PluginConfig

/** 輸出頻道參考 */
let log: vscode.OutputChannel | undefined

/**
 * 檢查檔案路徑是否在忽略清單中
 */
function isIgnored(filePath: string, ignorePaths: string[]): boolean {
  return ignorePaths.some((pattern) => filePath.includes(pattern))
}

/**
 * 對單一檔案觸發增量掃描
 */
async function triggerIncrementalScan(document: vscode.TextDocument, config: PluginConfig): Promise<void> {
  const filePath = document.fileName
  const content = document.getText()
  const language = toApiLanguage(document.languageId)

  log?.appendLine(`增量掃描: ${filePath}`)
  setAnalyzing()
  sendScanProgress('running', 0)

  try {
    const baseUrl = config.api.baseUrl.replace(/\/+$/, '')

    const taskId = await triggerScan(baseUrl, [
      { path: filePath, content, language },
    ], {
      depth: config.analysis.depth,
      includeLlmScan: config.analysis.depth === 'deep',
      forceRescan: false,
      scanScope: 'file',
    })

    await pollUntilDone(baseUrl, taskId, (progress) => {
      sendScanProgress('running', progress)
    })

    const vulns = await fetchFileVulnerabilities(baseUrl, filePath)
    updateDiagnostics(filePath, vulns)
    setResult(vulns.length)
    sendVulnerabilities(vulns)
    sendScanProgress('completed', 1)

    log?.appendLine(`掃描完成: ${filePath}, 發現 ${vulns.length} 個漏洞`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤'
    log?.appendLine(`增量掃描失敗: ${msg}`)
    setFailed(msg)
    sendScanProgress('failed', 0)
  }
}

/**
 * 建立檔案儲存監聽器，回傳 Disposable 供 context.subscriptions 管理
 */
export function createFileWatcher(
  getConfig: ConfigGetter,
  outputChannel?: vscode.OutputChannel,
): vscode.Disposable {
  log = outputChannel

  const disposable = vscode.workspace.onDidSaveTextDocument((document) => {
    const config = getConfig()

    // 僅在 onSave 模式下觸發
    if (config.analysis.triggerMode !== 'onSave') return

    // 僅處理支援的語言
    if (!SUPPORTED_LANGUAGE_IDS.has(document.languageId)) return

    // 檢查忽略路徑
    if (isIgnored(document.fileName, config.ignore.paths)) return

    // Debounce：取消同一檔案的前一次計時器
    const existing = debounceTimers.get(document.fileName)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      debounceTimers.delete(document.fileName)
      void triggerIncrementalScan(document, config)
    }, config.analysis.debounceMs)

    debounceTimers.set(document.fileName, timer)
  })

  // 清理所有計時器
  return {
    dispose() {
      disposable.dispose()
      for (const timer of debounceTimers.values()) {
        clearTimeout(timer)
      }
      debounceTimers.clear()
    },
  }
}

/**
 * 清除所有待處理的 debounce 計時器（供測試使用）
 */
export function clearPendingTimers(): void {
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer)
  }
  debounceTimers.clear()
}

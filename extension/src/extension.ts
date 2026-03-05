import { Buffer } from 'node:buffer'

import path from 'path'
import * as vscode from 'vscode'

import { clearAllDiagnostics, registerDiagnostics, updateDiagnostics } from './diagnostics'
import { createFileWatcher } from './file-watcher'
import {
  cancelScanTask,
  fetchAllOpenVulnerabilities,
  fetchFileVulnerabilities,
  fetchVulnerabilityById,
  ignoreVulnerability,
  pollUntilDone,
  triggerScan,
} from './scan-client'
import { createStatusBar, setAnalyzing, setFailed, setResult } from './status-bar'
import type { PluginConfig } from './types'
import {
  openSettingsPanel,
  registerViewProvider,
  sendConfigUpdate,
  sendScanProgress,
  sendVulnerabilities,
  setWebviewLogger,
} from './webview'

/** 輸出頻道，用於記錄插件日誌 */
let outputChannel: vscode.OutputChannel
const FILE_SCAN_TIMEOUT_MS = 8 * 60 * 1000
const WORKSPACE_SCAN_TIMEOUT_MS = 30 * 60 * 1000
const WORKSPACE_FILE_LIMIT = 5000
const WORKSPACE_READ_CONCURRENCY = 16

/**
 * 從 VS Code settings.json 讀取插件配置
 */
function getPluginConfig(): PluginConfig {
  const config = vscode.workspace.getConfiguration('confession')
  return {
    llm: {
      provider: config.get<'gemini' | 'nvidia'>('llm.provider', 'nvidia'),
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
  setWebviewLogger((message) => outputChannel.appendLine(message))
  outputChannel.appendLine('Confession 插件啟動中…')

  const pluginConfig = getPluginConfig()
  outputChannel.appendLine(`API 模式: ${pluginConfig.api.mode} (${pluginConfig.api.baseUrl})`)
  outputChannel.appendLine(
    `分析觸發: ${pluginConfig.analysis.triggerMode}, 深度: ${pluginConfig.analysis.depth}`,
  )

  // --- 註冊兩個側邊欄 Webview View Provider ---
  const viewRoutes = [
    { viewId: 'confession.dashboard', route: '/' },
    { viewId: 'confession.vulnerabilities', route: '/vulnerabilities' },
  ] as const

  for (const { viewId, route } of viewRoutes) {
    registerViewProvider(context, viewId, getPluginConfig, route)
  }

  async function focusConfessionView(view: 'dashboard' | 'vulnerabilities'): Promise<void> {
    // 先確保 Confession 視圖容器被打開，再聚焦指定 view。
    try {
      await vscode.commands.executeCommand('workbench.view.extension.confession-security')
    } catch {
      // 某些 VS Code 版本可能不存在該命令，忽略後續直接嘗試 focus 指定 view。
    }
    if (view === 'vulnerabilities') {
      await vscode.commands.executeCommand('confession.vulnerabilities.focus')
      return
    }
    await vscode.commands.executeCommand('confession.dashboard.focus')
  }

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
      void focusConfessionView('dashboard')
    }),

    vscode.commands.registerCommand('codeVuln.showDashboard', () => {
      void focusConfessionView('dashboard')
    }),

    vscode.commands.registerCommand('codeVuln.showVulnerabilities', () => {
      void focusConfessionView('vulnerabilities')
    }),

    vscode.commands.registerCommand('codeVuln.showSettings', () => {
      openSettingsPanel(getPluginConfig)
    }),

    vscode.commands.registerCommand('codeVuln.ignoreVulnerability', (vulnId: string) => {
      return handleIgnoreVulnerability(vulnId, getPluginConfig)
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

/**
 * 依語言 ID + 副檔名推導 API 語言，避免 VS Code 未正確辨識時漏掃描。
 */
function inferApiLanguage(
  languageId: string,
  filePath: string,
): 'go' | 'javascript' | 'typescript' | null {
  const fromId = toApiLanguage(languageId)
  if (fromId === 'go' || fromId === 'javascript' || fromId === 'typescript') {
    return fromId
  }

  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.go':
      return 'go'
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript'
    case '.ts':
    case '.tsx':
    case '.mts':
    case '.cts':
      return 'typescript'
    default:
      return null
  }
}

function countNewVulnerabilities(
  beforeIds: Set<string>,
  after: Array<{ id: string }>,
): number {
  let count = 0
  for (const vuln of after) {
    if (!beforeIds.has(vuln.id)) count += 1
  }
  return count
}

function isScanTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return err.message.includes('掃描任務逾時')
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const safeConcurrency = Math.max(1, Math.floor(concurrency))
  const results = new Array<R>(items.length)
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await mapper(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(safeConcurrency, items.length) }, () => worker()))
  return results
}

/** 掃描當前檔案 */
async function scanCurrentFile(getConfig: () => PluginConfig): Promise<void> {
  const editor = vscode.window.activeTextEditor
  if (!editor) {
    vscode.window.showWarningMessage('Confession: 沒有打開的檔案')
    return
  }

  const doc = editor.document
  const inferredLanguage = inferApiLanguage(doc.languageId, doc.fileName)
  if (!inferredLanguage) {
    vscode.window.showWarningMessage('Confession: 不支援此檔案類型')
    return
  }

  const config = getConfig()
  const baseUrl = config.api.baseUrl.replace(/\/+$/, '')
  const beforeVulns = await fetchFileVulnerabilities(baseUrl, doc.fileName).catch(() => [])
  const beforeIds = new Set(beforeVulns.map((v) => v.id))

  outputChannel.appendLine(`掃描檔案: ${doc.fileName}`)
  setAnalyzing()
  sendScanProgress('running', 0)

  let taskId: string | null = null
  try {
    taskId = await triggerScan(
      baseUrl,
      [{ path: doc.fileName, content: doc.getText(), language: inferredLanguage }],
      {
        depth: config.analysis.depth,
        includeLlmScan: config.analysis.depth === 'deep',
        forceRescan: true,
        scanScope: 'file',
      },
    )

    await pollUntilDone(
      baseUrl,
      taskId,
      (progress) => {
        sendScanProgress('running', progress)
      },
      { timeoutMs: FILE_SCAN_TIMEOUT_MS },
    )

    const vulns = await fetchFileVulnerabilities(baseUrl, doc.fileName)
    const allOpenVulns = await fetchAllOpenVulnerabilities(baseUrl).catch(() => null)
    const newCount = countNewVulnerabilities(beforeIds, vulns)
    updateDiagnostics(doc.fileName, vulns)
    setResult((allOpenVulns ?? vulns).length)
    sendVulnerabilities(allOpenVulns ?? vulns)
    sendScanProgress('completed', 1)

    outputChannel.appendLine(
      `掃描完成: ${doc.fileName}, 本次新增 ${newCount} 個漏洞，目前開放 ${vulns.length} 個`,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤'
    if (taskId && isScanTimeoutError(err)) {
      try {
        await cancelScanTask(baseUrl, taskId)
        outputChannel.appendLine(`已送出取消掃描請求: ${taskId}`)
      } catch (cancelErr) {
        const cancelMsg = cancelErr instanceof Error ? cancelErr.message : '未知錯誤'
        outputChannel.appendLine(`送出取消掃描失敗(${taskId}): ${cancelMsg}`)
      }
    }
    outputChannel.appendLine(`掃描失敗: ${msg}`)
    setFailed(msg)
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
  const workspaceRoots = folders.map((folder) => folder.uri.fsPath).filter((value) => value.length > 0)

  outputChannel.appendLine(`掃描工作區: ${folders.map((f) => f.name).join(', ')}`)
  setAnalyzing()
  sendScanProgress('running', 0)

  let taskId: string | null = null
  try {
    // 搜尋所有支援的檔案
    const uris = await vscode.workspace.findFiles(
      '**/*.{go,js,jsx,ts,tsx}',
      '**/node_modules/**',
      WORKSPACE_FILE_LIMIT,
    )
    const workspaceSnapshotComplete = uris.length < WORKSPACE_FILE_LIMIT

    if (uris.length === 0) {
      outputChannel.appendLine('工作區中未找到支援的檔案')
      setResult(0)
      sendScanProgress('completed', 1)
      return
    }

    // 讀取檔案內容（workspace.fs + 併發限制，避免大量 openTextDocument 造成額外負擔）
    const candidateUris = uris.filter((uri) => !config.ignore.paths.some((p) => uri.fsPath.includes(p)))
    const files = await mapWithConcurrency(candidateUris, WORKSPACE_READ_CONCURRENCY, async (uri) => {
      const language = inferApiLanguage('', uri.fsPath)
      if (!language) return null

      try {
        const bytes = await vscode.workspace.fs.readFile(uri)
        const content = Buffer.from(bytes).toString('utf8')
        return {
          path: uri.fsPath,
          content,
          language,
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '未知錯誤'
        outputChannel.appendLine(`讀取檔案失敗，已跳過: ${uri.fsPath} (${msg})`)
        return null
      }
    })

    const scanFiles = files.filter((file): file is NonNullable<typeof file> => file !== null)
    if (scanFiles.length === 0) {
      outputChannel.appendLine('工作區中沒有可分析的 Go/JS/TS 檔案')
      setResult(0)
      sendScanProgress('completed', 1)
      return
    }

    const langCount = scanFiles.reduce(
      (acc, file) => {
        acc[file.language] = (acc[file.language] ?? 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )

    outputChannel.appendLine(
      `找到 ${scanFiles.length} 個檔案，開始掃描…（go=${langCount.go ?? 0}, js=${langCount.javascript ?? 0}, ts=${langCount.typescript ?? 0}）`,
    )
    if (!workspaceSnapshotComplete) {
      outputChannel.appendLine(
        `工作區檔案數已達掃描上限 ${WORKSPACE_FILE_LIMIT}，本次不執行刪檔自動收斂以避免誤判`,
      )
    }

    const beforeOpenVulns = await fetchAllOpenVulnerabilities(baseUrl).catch(() => [])
    const beforeOpenIds = new Set(beforeOpenVulns.map((v) => v.id))

    taskId = await triggerScan(baseUrl, scanFiles, {
      depth: config.analysis.depth,
      includeLlmScan: config.analysis.depth === 'deep',
      forceRescan: true,
      scanScope: 'workspace',
      workspaceSnapshotComplete,
      workspaceRoots,
    })

    await pollUntilDone(
      baseUrl,
      taskId,
      (progress) => {
        sendScanProgress('running', progress)
      },
      { timeoutMs: WORKSPACE_SCAN_TIMEOUT_MS },
    )

    // 取得所有開放漏洞並按檔案更新 diagnostics
    const allVulns = await fetchAllOpenVulnerabilities(baseUrl)
    const byFile = new Map<string, typeof allVulns>()
    for (const v of allVulns) {
      const list = byFile.get(v.filePath) ?? []
      list.push(v)
      byFile.set(v.filePath, list)
    }

    // 先清空再重建，避免已移除/已修復檔案留下舊診斷標記
    clearAllDiagnostics()
    for (const [filePath, vulns] of byFile) {
      updateDiagnostics(filePath, vulns)
    }

    setResult(allVulns.length)
    sendVulnerabilities(allVulns)
    sendScanProgress('completed', 1)

    const newCount = countNewVulnerabilities(beforeOpenIds, allVulns)
    outputChannel.appendLine(`工作區掃描完成，本次新增 ${newCount} 個漏洞，目前開放 ${allVulns.length} 個`)
    vscode.window.showInformationMessage(
      `Confession: 掃描完成，本次新增 ${newCount} 個漏洞（目前開放 ${allVulns.length} 個）`,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤'
    if (isScanTimeoutError(err)) {
      if (taskId) {
        try {
          await cancelScanTask(baseUrl, taskId)
          outputChannel.appendLine(`已送出取消掃描請求: ${taskId}`)
        } catch (cancelErr) {
          const cancelMsg = cancelErr instanceof Error ? cancelErr.message : '未知錯誤'
          outputChannel.appendLine(`送出取消掃描失敗(${taskId}): ${cancelMsg}`)
        }
      }
      outputChannel.appendLine(
        '工作區掃描等待逾時，已停止前端等待。可稍後檢查 recent/status 或重新觸發掃描。',
      )
    }
    outputChannel.appendLine(`工作區掃描失敗: ${msg}`)
    setFailed(msg)
    sendScanProgress('failed', 0)
    vscode.window.showErrorMessage(`Confession: 工作區掃描失敗 — ${msg}`)
  }
}

/** 忽略漏洞 */
async function handleIgnoreVulnerability(vulnId: string, getConfig: () => PluginConfig): Promise<boolean> {
  const config = getConfig()
  const baseUrl = config.api.baseUrl.replace(/\/+$/, '')

  try {
    const ok = await ignoreVulnerability(baseUrl, vulnId)
    if (!ok) {
      vscode.window.showErrorMessage('Confession: 忽略漏洞失敗')
      return false
    }

    try {
      // 取得漏洞資訊以更新 diagnostics
      const vuln = await fetchVulnerabilityById(baseUrl, vulnId)
      if (vuln) {
        const vulns = await fetchFileVulnerabilities(baseUrl, vuln.filePath)
        updateDiagnostics(vuln.filePath, vulns)
        const allOpenVulns = await fetchAllOpenVulnerabilities(baseUrl)
        setResult(allOpenVulns.length)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知錯誤'
      vscode.window.showWarningMessage(`Confession: 忽略成功，但更新診斷資訊失敗 — ${msg}`)
    }

    try {
      const allOpenVulns = await fetchAllOpenVulnerabilities(baseUrl)
      sendVulnerabilities(allOpenVulns)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知錯誤'
      vscode.window.showWarningMessage(`Confession: 忽略成功，但同步漏洞列表失敗 — ${msg}`)
    }

    vscode.window.showInformationMessage('Confession: 已忽略此漏洞')
    return true
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤'
    vscode.window.showErrorMessage(`Confession: 忽略漏洞失敗 — ${msg}`)
    return false
  }
}

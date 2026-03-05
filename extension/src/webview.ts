import * as fs from 'fs/promises'
import os from 'os'
import path from 'path'
import * as vscode from 'vscode'

import { generateMonitoringCode } from './monitoring'
import {
  fetchAllOpenVulnerabilities,
  fetchVulnerabilityById,
  updateVulnerabilityStatus,
} from './scan-client'
import type { ExtToWebMsg, PluginConfig, Vulnerability, WebToExtMsg } from './types'

type OperationResult = Extract<ExtToWebMsg, { type: 'operation_result' }>['data']
type OperationName = OperationResult['operation']
type ExportPdfRequestData = Extract<WebToExtMsg, { type: 'export_pdf' }>['data']
type WebviewLogger = (message: string) => void

/** 模組層級 Provider 參考（多視圖共用），供匯出函數使用 */
const providerInstances: ConfessionViewProvider[] = []
let webviewLogger: WebviewLogger | undefined

function logWebview(message: string): void {
  webviewLogger?.(message)
}

export function setWebviewLogger(logger: WebviewLogger): void {
  webviewLogger = logger
}

/** 側邊欄 Webview 視圖 Provider（通用，每個視圖實例持有自己的 route） */
export class ConfessionViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  private readonly getConfig: () => PluginConfig

  constructor(
    private readonly extensionUri: vscode.Uri,
    getConfig: () => PluginConfig,
    private readonly route: string,
  ) {
    this.getConfig = getConfig
  }

  /** VS Code 在視圖首次可見時呼叫 */
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView

    webviewView.webview.options = {
      enableScripts: true,
    }

    const baseUrl = this.getConfig().api.baseUrl
    webviewView.webview.html = buildHtml(baseUrl, this.route)

    // 監聯 Webview → Extension 訊息
    webviewView.webview.onDidReceiveMessage((msg: WebToExtMsg) => {
      handleWebviewMessage(msg, this.getConfig)
    })

    // 視圖可見性變更時推送目前配置
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.postMessage({ type: 'config_updated', data: this.getConfig() })
      }
    })
  }

  /** 向 Webview 發送訊息 */
  postMessage(message: ExtToWebMsg): void {
    this.view?.webview.postMessage(message)
  }
}

/**
 * 註冊單一 View Provider，回傳實例供其他模組使用
 */
export function registerViewProvider(
  context: vscode.ExtensionContext,
  viewId: string,
  getConfig: () => PluginConfig,
  route: string,
): ConfessionViewProvider {
  const provider = new ConfessionViewProvider(context.extensionUri, getConfig, route)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  )
  providerInstances.push(provider)
  return provider
}

/**
 * 向後相容：註冊 dashboard provider（route = '/'）
 */
export function registerDashboardProvider(
  context: vscode.ExtensionContext,
  getConfig: () => PluginConfig,
): ConfessionViewProvider {
  return registerViewProvider(context, 'confession.dashboard', getConfig, '/')
}

/**
 * 向所有已註冊的 Webview 發送訊息
 */
export function postMessageToWebview(message: ExtToWebMsg): void {
  for (const provider of providerInstances) {
    provider.postMessage(message)
  }
  // Editor Panel 與 Settings Panel 不在 providerInstances，需額外廣播
  detailPanel?.webview.postMessage(message)
  settingsPanel?.webview.postMessage(message)
}

/**
 * 推送漏洞更新到 Webview。
 * 語義：變更通知 + 可選資料（前端不得假設 payload 永遠完整）。
 */
export function sendVulnerabilities(vulns: Vulnerability[]): void {
  postMessageToWebview({ type: 'vulnerabilities_updated', data: vulns })
}

/**
 * 推送掃描進度到 Webview
 */
export function sendScanProgress(status: string, progress: number): void {
  postMessageToWebview({ type: 'scan_progress', data: { status, progress } })
}

/**
 * 推送配置更新到 Webview
 */
export function sendConfigUpdate(config: PluginConfig): void {
  postMessageToWebview({ type: 'config_updated', data: config })
}

// === 內部：處理 Webview 傳來的訊息 ===

function postOperationResult(result: OperationResult): void {
  // 回執採跨視圖廣播，各視圖以 requestId 判斷是否自身請求，
  // 其餘視圖仍可利用同一回執做快取收斂。
  postMessageToWebview({ type: 'operation_result', data: result })
}

function handleWebviewMessage(msg: WebToExtMsg, getConfig: () => PluginConfig): void {
  switch (msg.type) {
    case 'request_scan':
      if (msg.data.scope === 'file') {
        vscode.commands.executeCommand('codeVuln.scanFile')
      } else {
        vscode.commands.executeCommand('codeVuln.scanWorkspace')
      }
      break

    case 'apply_fix':
      void handleApplyFixRequest(msg.requestId, msg.data.vulnerabilityId)
      break

    case 'ignore_vulnerability':
      void handleIgnoreRequest(msg.requestId, msg.data.vulnerabilityId)
      break

    case 'refresh_vulnerabilities':
      void handleRefreshRequest(msg.requestId, getConfig)
      break

    case 'navigate_to_code': {
      const { filePath, line, column } = msg.data
      void navigateToCodeLocation(filePath, line, column)
      break
    }

    case 'update_config':
      void handleUpdateConfigRequest(msg.requestId, msg.data)
      break

    case 'export_pdf':
      logWebview(`[PDF 匯出] 收到請求 requestId=${msg.requestId}`)
      void handleExportPdfRequest(msg.requestId, msg.data, getConfig)
      break

    case 'request_config':
      sendConfigUpdate(getConfig())
      break
    case 'paste_clipboard':
      void handlePasteClipboardRequest()
      break

    case 'open_vulnerability_detail':
      void handleOpenVulnerabilityDetail(msg.data.vulnerabilityId, getConfig)
      break
  }
}

async function navigateToCodeLocation(
  filePath: string,
  line: number,
  column: number,
): Promise<void> {
  const uri = vscode.Uri.file(filePath)
  const position = new vscode.Position(line - 1, column - 1)

  try {
    const document = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(document, {
      selection: new vscode.Range(position, position),
      viewColumn: vscode.ViewColumn.One,
    })
  } catch (err) {
    if (isFileNotFoundError(err)) {
      vscode.window.showWarningMessage(
        'Confession: 來源檔案不存在（可能已刪除或改名），請重新掃描工作區同步漏洞',
      )
      return
    }

    const msg = err instanceof Error ? err.message : '未知錯誤'
    vscode.window.showErrorMessage(`Confession: 跳轉代碼失敗 — ${msg}`)
  }
}

function isFileNotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const maybeMessage = (err as { message?: unknown }).message
  const maybeCode = (err as { code?: unknown }).code
  const message = typeof maybeMessage === 'string' ? maybeMessage.toLowerCase() : ''
  const code = typeof maybeCode === 'string' ? maybeCode.toUpperCase() : ''

  if (code === 'ENOENT' || code === 'FILE_NOT_FOUND') return true
  return (
    message.includes('enoent') ||
    message.includes('not found') ||
    message.includes('no such file') ||
    message.includes('cannot find')
  )
}

async function handlePasteClipboardRequest(): Promise<void> {
  try {
    const text = await vscode.env.clipboard.readText()
    postMessageToWebview({ type: 'clipboard_paste', data: { text } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤'
    logWebview(`[Clipboard] 讀取失敗: ${msg}`)
  }
}

/** 取得漏洞資料並開啟 Editor Panel */
async function handleOpenVulnerabilityDetail(
  vulnId: string,
  getConfig: () => PluginConfig,
): Promise<void> {
  const config = getConfig()
  const baseUrl = config.api.baseUrl.replace(/\/+$/, '')

  try {
    const vuln = await fetchVulnerabilityById(baseUrl, vulnId)
    if (!vuln) {
      vscode.window.showErrorMessage('Confession: 找不到漏洞記錄')
      return
    }
    openVulnerabilityDetail(vuln, baseUrl, getConfig)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤'
    vscode.window.showErrorMessage(`Confession: 開啟漏洞詳情失敗 — ${msg}`)
  }
}

/** 重新拉取開放漏洞並廣播給所有 Webview */
async function refreshVulnerabilities(getConfig: () => PluginConfig): Promise<Vulnerability[]> {
  const baseUrl = getConfig().api.baseUrl.replace(/\/+$/, '')
  const allOpenVulns = await fetchAllOpenVulnerabilities(baseUrl)
  sendVulnerabilities(allOpenVulns)
  return allOpenVulns
}

function buildOperationResult(
  requestId: string,
  operation: OperationName,
  success: boolean,
  message: string,
  payload?: OperationResult['payload'],
): OperationResult {
  return { requestId, operation, success, message, payload }
}

async function handleApplyFixRequest(
  requestId: string,
  vulnerabilityId: string,
): Promise<void> {
  const result = await applyVulnerabilityFix(vulnerabilityId)
  postOperationResult(
    buildOperationResult(requestId, 'apply_fix', result.success, result.message, result.payload),
  )
}

async function handleIgnoreRequest(
  requestId: string,
  vulnerabilityId: string,
): Promise<void> {
  try {
    const ok = await vscode.commands.executeCommand<boolean>(
      'codeVuln.ignoreVulnerability',
      vulnerabilityId,
    )
    if (!ok) {
      postOperationResult(
        buildOperationResult(
          requestId,
          'ignore_vulnerability',
          false,
          '忽略漏洞失敗，請查看 VS Code 通知',
          { vulnerabilityId },
        ),
      )
      return
    }

    const baseUrl = vscode.workspace
      .getConfiguration('confession')
      .get<string>('api.baseUrl', 'http://localhost:3000')!
      .replace(/\/+$/, '')
    const updatedVulnerability = await fetchVulnerabilityById(baseUrl, vulnerabilityId)

    postOperationResult(
      buildOperationResult(requestId, 'ignore_vulnerability', true, '忽略漏洞成功', {
        vulnerabilityId,
        updatedVulnerability: updatedVulnerability ?? undefined,
      }),
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤'
    postOperationResult(
      buildOperationResult(requestId, 'ignore_vulnerability', false, `忽略漏洞失敗：${msg}`, {
        vulnerabilityId,
      }),
    )
  }
}

async function handleRefreshRequest(
  requestId: string,
  getConfig: () => PluginConfig,
): Promise<void> {
  try {
    const vulns = await refreshVulnerabilities(getConfig)
    postOperationResult(
      buildOperationResult(
        requestId,
        'refresh_vulnerabilities',
        true,
        `同步完成（${vulns.length} 筆開放漏洞）`,
      ),
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤'
    postOperationResult(
      buildOperationResult(
        requestId,
        'refresh_vulnerabilities',
        false,
        `同步漏洞資料失敗：${msg}`,
      ),
    )
  }
}

async function handleUpdateConfigRequest(
  requestId: string,
  config: PluginConfig,
): Promise<void> {
  const result = await writeConfigToSettings(config)
  postOperationResult(
    buildOperationResult(
      requestId,
      'update_config',
      result.success,
      result.message,
      result.success ? { config } : undefined,
    ),
  )
}

function injectAutoPrintScript(html: string): string {
  const script =
    '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),200));</script>'

  if (html.includes('window.print()')) return html
  if (html.includes('</body>')) {
    return html.replace('</body>', `${script}</body>`)
  }
  return `${html}\n${script}`
}

function buildTempHtmlPath(filename: string): string {
  const baseName = filename.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9._-]/g, '_')
  const safeName = baseName.length > 0 ? baseName : 'confession-export'
  return path.join(os.tmpdir(), `${safeName}-${Date.now()}.html`)
}

function filenameFromContentDisposition(
  disposition: string | null,
  fallback = 'confession-vulnerabilities.pdf',
): string {
  if (!disposition) return fallback
  const matched = disposition.match(/filename="([^"]+)"/i)
  return matched?.[1] ?? fallback
}

async function fetchPdfReportHtml(
  baseUrl: string,
  data: ExportPdfRequestData,
): Promise<{ html: string; filename: string }> {
  const startedAt = Date.now()
  const AbortControllerCtor = globalThis.AbortController
  if (!AbortControllerCtor) {
    throw new Error('目前環境不支援 AbortController')
  }
  const controller = new AbortControllerCtor()
  const timeout = setTimeout(() => controller.abort(), 120_000)
  const exportUrl = `${baseUrl.replace(/\/+$/, '')}/api/export`
  logWebview(`[PDF 匯出] 呼叫匯出 API: ${exportUrl}`)

  try {
    const res = await fetch(exportUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: 'pdf',
        filters: data.filters ?? {},
      }),
      signal: controller.signal,
    })
    logWebview(`[PDF 匯出] 匯出 API 回應 status=${res.status}`)

    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try {
        const payload = (await res.json()) as { error?: string }
        if (payload.error) detail = payload.error
      } catch {
        // ignore json parse errors, keep fallback detail
      }
      throw new Error(`匯出 API 錯誤：${detail}`)
    }

    const html = await res.text()
    if (!html.trim()) {
      throw new Error('匯出 API 回傳空內容')
    }

    const fallbackName = data.filename?.trim() || 'confession-vulnerabilities.pdf'
    const filename = filenameFromContentDisposition(
      res.headers.get('content-disposition'),
      fallbackName,
    )
    logWebview(
      `[PDF 匯出] 匯出內容已取得（${html.length} chars），耗時 ${Date.now() - startedAt}ms`,
    )
    return { html, filename }
  } finally {
    clearTimeout(timeout)
  }
}

async function handleExportPdfRequest(
  requestId: string,
  data: ExportPdfRequestData,
  getConfig: () => PluginConfig,
): Promise<void> {
  try {
    const baseUrl = getConfig().api.baseUrl.replace(/\/+$/, '')
    logWebview(`[PDF 匯出] 開始處理 requestId=${requestId}`)
    const { html, filename } = await fetchPdfReportHtml(baseUrl, data)
    const tempHtmlPath = buildTempHtmlPath(filename)
    await fs.writeFile(tempHtmlPath, injectAutoPrintScript(html), 'utf8')
    logWebview(`[PDF 匯出] 已寫入暫存 HTML: ${tempHtmlPath}`)

    const opened = await vscode.env.openExternal(vscode.Uri.file(tempHtmlPath))
    if (!opened) {
      logWebview(`[PDF 匯出] 開啟外部瀏覽器失敗 requestId=${requestId}`)
      postOperationResult(
        buildOperationResult(requestId, 'export_pdf', false, '無法開啟外部瀏覽器列印預覽'),
      )
      return
    }
    logWebview(`[PDF 匯出] 已開啟外部瀏覽器 requestId=${requestId}`)

    vscode.window.showInformationMessage(
      'Confession: 已開啟外部列印預覽，請在瀏覽器使用「另存為 PDF」。',
    )
    postOperationResult(
      buildOperationResult(requestId, 'export_pdf', true, '已開啟外部列印預覽'),
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤'
    logWebview(`[PDF 匯出] 失敗 requestId=${requestId} error=${msg}`)
    postOperationResult(
      buildOperationResult(requestId, 'export_pdf', false, `PDF 匯出失敗：${msg}`),
    )
  }
}

// === 內部：將 Webview 配置寫入 VS Code settings.json ===

async function writeConfigToSettings(
  config: PluginConfig,
): Promise<{ success: boolean; message: string }> {
  const cfg = vscode.workspace.getConfiguration('confession')
  try {
    await cfg.update('llm.provider', config.llm.provider, vscode.ConfigurationTarget.Global)
    await cfg.update('llm.apiKey', config.llm.apiKey, vscode.ConfigurationTarget.Global)
    await cfg.update('llm.endpoint', config.llm.endpoint || '', vscode.ConfigurationTarget.Global)
    await cfg.update('llm.model', config.llm.model || '', vscode.ConfigurationTarget.Global)
    await cfg.update('analysis.triggerMode', config.analysis.triggerMode, vscode.ConfigurationTarget.Global)
    await cfg.update('analysis.depth', config.analysis.depth, vscode.ConfigurationTarget.Global)
    await cfg.update('analysis.debounceMs', config.analysis.debounceMs, vscode.ConfigurationTarget.Global)
    await cfg.update('ignore.paths', config.ignore.paths, vscode.ConfigurationTarget.Global)
    await cfg.update('ignore.types', config.ignore.types, vscode.ConfigurationTarget.Global)
    await cfg.update('api.baseUrl', config.api.baseUrl, vscode.ConfigurationTarget.Global)
    await cfg.update('api.mode', config.api.mode, vscode.ConfigurationTarget.Global)
    sendConfigUpdate(config)
    return { success: true, message: 'Extension 設定已套用' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤'
    vscode.window.showErrorMessage(`Confession: 儲存設定失敗 — ${msg}`)
    return { success: false, message: `Extension 設定寫入失敗：${msg}` }
  }
}

// === 內部：套用漏洞修復 ===

async function applyVulnerabilityFix(vulnId: string): Promise<{
  success: boolean
  message: string
  payload?: OperationResult['payload']
}> {
  const baseUrl = vscode.workspace
    .getConfiguration('confession')
    .get<string>('api.baseUrl', 'http://localhost:3000')!
    .replace(/\/+$/, '')

  try {
    const vuln = await fetchVulnerabilityById(baseUrl, vulnId)
    if (!vuln) {
      vscode.window.showErrorMessage('Confession: 找不到漏洞記錄')
      return { success: false, message: '找不到漏洞記錄', payload: { vulnerabilityId: vulnId } }
    }

    if (!vuln.fixOldCode || !vuln.fixNewCode) {
      vscode.window.showWarningMessage('Confession: 此漏洞沒有可用的修復建議')
      return {
        success: false,
        message: '此漏洞沒有可用的修復建議',
        payload: { vulnerabilityId: vulnId },
      }
    }

    const uri = vscode.Uri.file(vuln.filePath)
    const doc = await vscode.workspace.openTextDocument(uri)
    const range = new vscode.Range(
      new vscode.Position(vuln.line - 1, vuln.column - 1),
      new vscode.Position(vuln.endLine - 1, vuln.endColumn - 1),
    )

    const edit = new vscode.WorkspaceEdit()
    edit.replace(uri, range, vuln.fixNewCode)

    // 插入嵌入式監測日誌（修復代碼下一行）
    const monitoringCode = generateMonitoringCode(vuln, doc.languageId)
    if (monitoringCode) {
      const insertPos = new vscode.Position(vuln.endLine, 0)
      edit.insert(uri, insertPos, monitoringCode + '\n')
    }

    const applied = await vscode.workspace.applyEdit(edit)

    if (!applied) {
      vscode.window.showErrorMessage('Confession: 套用修復失敗')
      return { success: false, message: '套用修復失敗', payload: { vulnerabilityId: vulnId } }
    }

    await doc.save()
    const updated = await updateVulnerabilityStatus(baseUrl, vulnId, 'fixed')
    if (!updated) {
      const updatedVulnerability = await fetchVulnerabilityById(baseUrl, vulnId)
      vscode.window.showWarningMessage('Confession: 代碼修復成功，但更新漏洞狀態為 fixed 失敗')
      return {
        success: false,
        message: '代碼修復成功，但更新漏洞狀態為 fixed 失敗',
        payload: {
          vulnerabilityId: vulnId,
          updatedVulnerability: updatedVulnerability ?? undefined,
        },
      }
    }

    try {
      const allOpenVulns = await fetchAllOpenVulnerabilities(baseUrl)
      sendVulnerabilities(allOpenVulns)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知錯誤'
      vscode.window.showWarningMessage(`Confession: 修復已完成，但同步漏洞列表失敗 — ${msg}`)
    }

    const updatedVulnerability = await fetchVulnerabilityById(baseUrl, vulnId)
    vscode.window.showInformationMessage(`Confession: 已套用修復 (${vuln.type})`)

    return {
      success: true,
      message: `已套用修復 (${vuln.type})`,
      payload: {
        vulnerabilityId: vulnId,
        updatedVulnerability: updatedVulnerability ?? undefined,
      },
    }
  } catch (err) {
    if (isFileNotFoundError(err)) {
      const message = '來源檔案不存在（可能已刪除或改名），請重新掃描工作區同步漏洞'
      vscode.window.showWarningMessage(`Confession: ${message}`)
      return { success: false, message, payload: { vulnerabilityId: vulnId } }
    }

    const msg = err instanceof Error ? err.message : '未知錯誤'
    vscode.window.showErrorMessage(`Confession: 套用修復失敗 — ${msg}`)
    return { success: false, message: `套用修復失敗：${msg}`, payload: { vulnerabilityId: vulnId } }
  }
}

// === 漏洞詳情 Editor Panel ===

/** 模組層級 detailPanel 參考，重複呼叫時 reveal 現有 panel */
let detailPanel: vscode.WebviewPanel | undefined

/**
 * 在編輯器區域開啟漏洞詳情 Panel
 * 若 panel 已存在則 reveal 並更新內容
 */
export function openVulnerabilityDetail(
  vuln: Vulnerability,
  baseUrl: string,
  getConfig: () => PluginConfig,
): void {
  if (detailPanel) {
    detailPanel.reveal(vscode.ViewColumn.One)
  } else {
    detailPanel = vscode.window.createWebviewPanel(
      'confession.vulnerabilityDetail',
      `漏洞詳情: ${vuln.cweId ?? vuln.type}`,
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    )
    detailPanel.onDidDispose(() => {
      detailPanel = undefined
    })

    // 監聽 Editor Panel → Extension 訊息
    detailPanel.webview.onDidReceiveMessage((msg: WebToExtMsg) => {
      handleWebviewMessage(msg, getConfig)
    })
  }

  detailPanel.title = `漏洞詳情: ${vuln.cweId ?? vuln.type}`
  detailPanel.webview.html = buildDetailHtml(baseUrl, vuln.id)

  // 傳送漏洞資料至 Editor Panel
  detailPanel.webview.postMessage({
    type: 'vulnerability_detail_data',
    data: vuln,
  } satisfies ExtToWebMsg)
}

// === 設定 Editor Panel ===

/** 模組層級 settingsPanel 參考，重複呼叫時 reveal 現有 panel */
let settingsPanel: vscode.WebviewPanel | undefined

/**
 * 在編輯器區域開啟設定 Panel（與代碼分頁並列）
 * 若 panel 已存在則 reveal
 */
export function openSettingsPanel(getConfig: () => PluginConfig): void {
  const baseUrl = getConfig().api.baseUrl.replace(/\/+$/, '')

  if (settingsPanel) {
    settingsPanel.reveal(vscode.ViewColumn.One)
    return
  }

  settingsPanel = vscode.window.createWebviewPanel(
    'confession.settings',
    '設定',
    vscode.ViewColumn.One,
    { enableScripts: true, retainContextWhenHidden: true },
  )

  settingsPanel.onDidDispose(() => {
    settingsPanel = undefined
  })

  // 監聽 Settings Panel → Extension 訊息
  settingsPanel.webview.onDidReceiveMessage((msg: WebToExtMsg) => {
    handleWebviewMessage(msg, getConfig)
  })

  settingsPanel.webview.html = buildHtml(baseUrl, '/settings')

  // 推送目前配置
  settingsPanel.webview.postMessage({
    type: 'config_updated',
    data: getConfig(),
  } satisfies ExtToWebMsg)
}

/**
 * 產生漏洞詳情 Editor Panel 的 HTML
 */
export function buildDetailHtml(baseUrl: string, vulnId: string): string {
  const iframeSrc = `${baseUrl}/vulnerability-detail?id=${vulnId}`
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>漏洞詳情</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, iframe { width: 100%; height: 100vh; border: none; overflow: hidden; }
    .loading {
      display: flex; align-items: center; justify-content: center;
      height: 100vh; font-family: system-ui, sans-serif;
      color: var(--vscode-foreground); background: var(--vscode-editor-background);
    }
  </style>
</head>
<body>
  <div class="loading" id="loading">載入漏洞詳情中…</div>
  <iframe id="app" src="${iframeSrc}" style="display:none;"></iframe>
  <script>
    (function () {
      const vscode = acquireVsCodeApi();
      const iframe = document.getElementById('app');
      const loading = document.getElementById('loading');

      iframe.addEventListener('load', () => {
        loading.style.display = 'none';
        iframe.style.display = 'block';
      });

      // Extension → Panel → iframe（轉發）
      window.addEventListener('message', (event) => {
        if (event.data && event.data.type && iframe.contentWindow) {
          iframe.contentWindow.postMessage(event.data, '*');
        }
      });

      // iframe → Panel → Extension（轉發）
      window.addEventListener('message', (event) => {
        if (event.source === iframe.contentWindow && event.data && event.data.type) {
          vscode.postMessage(event.data);
        }
      });

    })();
  </script>
</body>
</html>`
}

// === 內部：產生 Sidebar Webview HTML ===

export function buildHtml(baseUrl: string, route: string): string {
  const iframeSrc = baseUrl + route
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Confession Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, iframe { width: 100%; height: 100vh; border: none; overflow: hidden; }
    .loading, .error {
      display: flex; align-items: center; justify-content: center; flex-direction: column;
      height: 100vh; font-family: system-ui, sans-serif;
      color: var(--vscode-foreground); background: var(--vscode-editor-background);
    }
    .error { display: none; gap: 12px; }
    .error-message { text-align: center; line-height: 1.5; }
    .retry-button {
      padding: 6px 16px; border: none; border-radius: 4px; cursor: pointer;
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      font-size: 13px; font-family: system-ui, sans-serif;
    }
    .retry-button:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <div class="loading" id="loading">載入安全儀表盤中…</div>
  <div class="error" id="error">
    <div class="error-message">無法載入安全儀表盤，請確認服務是否已啟動。</div>
    <button class="retry-button" id="retryBtn">重試</button>
  </div>
  <iframe id="app" src="${iframeSrc}" style="display:none;"></iframe>
  <script>
    (function () {
      const vscode = acquireVsCodeApi();
      const iframe = document.getElementById('app');
      const loading = document.getElementById('loading');
      const error = document.getElementById('error');
      const retryBtn = document.getElementById('retryBtn');
      const iframeSrc = '${iframeSrc}';

      /** 顯示錯誤狀態並隱藏載入提示與 iframe */
      function showError() {
        loading.style.display = 'none';
        iframe.style.display = 'none';
        error.style.display = 'flex';
      }

      /** 重試載入：重設 iframe src 並恢復載入提示 */
      function retryLoad() {
        error.style.display = 'none';
        iframe.style.display = 'none';
        loading.style.display = 'flex';
        iframe.src = iframeSrc;
      }

      // iframe 載入完成後顯示
      iframe.addEventListener('load', () => {
        loading.style.display = 'none';
        error.style.display = 'none';
        iframe.style.display = 'block';
      });

      // iframe 載入失敗時顯示錯誤訊息與重試按鈕
      iframe.addEventListener('error', showError);

      // 重試按鈕點擊事件
      retryBtn.addEventListener('click', retryLoad);

      // Extension → Webview → iframe（轉發）
      window.addEventListener('message', (event) => {
        // 來自 Extension Host 的訊息轉發給 iframe
        if (event.data && event.data.type && iframe.contentWindow) {
          iframe.contentWindow.postMessage(event.data, '*');
        }
      });

      // iframe → Webview → Extension（轉發）
      window.addEventListener('message', (event) => {
        if (event.source === iframe.contentWindow && event.data && event.data.type) {
          vscode.postMessage(event.data);
        }
      });

    })();
  </script>
</body>
</html>`
}

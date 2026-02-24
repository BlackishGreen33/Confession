import * as vscode from 'vscode'

import { generateMonitoringCode } from './monitoring'
import { fetchVulnerabilityById } from './scan-client'
import type { ExtToWebMsg, PluginConfig, Vulnerability, WebToExtMsg } from './types'

/** 模組層級 Provider 參考（多視圖共用），供匯出函數使用 */
const providerInstances: ConfessionViewProvider[] = []

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
}

/**
 * 推送漏洞更新到 Webview
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
      void applyVulnerabilityFix(msg.data.vulnerabilityId)
      break

    case 'ignore_vulnerability':
      vscode.commands.executeCommand('codeVuln.ignoreVulnerability', msg.data.vulnerabilityId)
      break

    case 'navigate_to_code': {
      const { filePath, line, column } = msg.data
      const uri = vscode.Uri.file(filePath)
      const position = new vscode.Position(line - 1, column - 1)
      vscode.window.showTextDocument(uri, {
        selection: new vscode.Range(position, position),
        viewColumn: vscode.ViewColumn.One,
      })
      break
    }

    case 'update_config':
      void writeConfigToSettings(msg.data)
      break

    case 'request_config':
      sendConfigUpdate(getConfig())
      break

    case 'open_vulnerability_detail':
      void handleOpenVulnerabilityDetail(msg.data.vulnerabilityId, getConfig)
      break
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

// === 內部：將 Webview 配置寫入 VS Code settings.json ===

async function writeConfigToSettings(config: PluginConfig): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('confession')
  try {
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤'
    vscode.window.showErrorMessage(`Confession: 儲存設定失敗 — ${msg}`)
  }
}

// === 內部：套用漏洞修復 ===

async function applyVulnerabilityFix(vulnId: string): Promise<void> {
  const baseUrl = vscode.workspace
    .getConfiguration('confession')
    .get<string>('api.baseUrl', 'http://localhost:3000')!
    .replace(/\/+$/, '')

  try {
    const vuln = await fetchVulnerabilityById(baseUrl, vulnId)
    if (!vuln) {
      vscode.window.showErrorMessage('Confession: 找不到漏洞記錄')
      return
    }

    if (!vuln.fixOldCode || !vuln.fixNewCode) {
      vscode.window.showWarningMessage('Confession: 此漏洞沒有可用的修復建議')
      return
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

    if (applied) {
      await doc.save()
      vscode.window.showInformationMessage(`Confession: 已套用修復 (${vuln.type})`)
    } else {
      vscode.window.showErrorMessage('Confession: 套用修復失敗')
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知錯誤'
    vscode.window.showErrorMessage(`Confession: 套用修復失敗 — ${msg}`)
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


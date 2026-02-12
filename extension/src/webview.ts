import * as vscode from 'vscode'

import { generateMonitoringCode } from './monitoring'
import { fetchVulnerabilityById } from './scan-client'
import type { ExtToWebMsg, PluginConfig, Vulnerability, WebToExtMsg } from './types'

/** 單例 Webview Panel 參考 */
let panel: vscode.WebviewPanel | undefined

/** 訊息監聽器清理函數 */
let messageDisposable: vscode.Disposable | undefined

/** 取得目前配置的回呼（由 activate 注入） */
let getConfigFn: (() => PluginConfig) | undefined

/** 注入取得配置的回呼 */
export function setGetConfigFn(fn: () => PluginConfig): void {
  getConfigFn = fn
}

/**
 * 取得或建立 Webview Panel
 */
export function openDashboardPanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
  if (panel) {
    panel.reveal(vscode.ViewColumn.Beside)
    return panel
  }

  panel = vscode.window.createWebviewPanel(
    'confession.dashboard',
    'Confession — Security Dashboard',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
    },
  )

  const baseUrl = vscode.workspace
    .getConfiguration('confession')
    .get<string>('api.baseUrl', 'http://localhost:3000')

  panel.webview.html = buildHtml(baseUrl)

  // 監聽 Webview → Extension 訊息
  messageDisposable = panel.webview.onDidReceiveMessage((msg: WebToExtMsg) => {
    handleWebviewMessage(msg)
  })
  context.subscriptions.push(messageDisposable)

  // Panel 關閉時清理
  panel.onDidDispose(() => {
    panel = undefined
    messageDisposable?.dispose()
    messageDisposable = undefined
  })

  context.subscriptions.push(panel)

  return panel
}

/**
 * 向 Webview 發送訊息
 */
export function postMessageToWebview(message: ExtToWebMsg): void {
  panel?.webview.postMessage(message)
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

/**
 * 取得目前 Panel（可能為 undefined）
 */
export function getPanel(): vscode.WebviewPanel | undefined {
  return panel
}

// === 內部：處理 Webview 傳來的訊息 ===

function handleWebviewMessage(msg: WebToExtMsg): void {
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
      if (getConfigFn) {
        sendConfigUpdate(getConfigFn())
      }
      break
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

// === 內部：產生 Webview HTML ===

function buildHtml(baseUrl: string): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Confession Dashboard</title>
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
  <div class="loading" id="loading">載入安全儀表盤中…</div>
  <iframe id="app" src="${baseUrl}" style="display:none;"></iframe>
  <script>
    (function () {
      const vscode = acquireVsCodeApi();
      const iframe = document.getElementById('app');
      const loading = document.getElementById('loading');

      // iframe 載入完成後顯示
      iframe.addEventListener('load', () => {
        loading.style.display = 'none';
        iframe.style.display = 'block';
      });

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

import * as vscode from 'vscode'

import type { ExtToWebMsg, PluginConfig, Vulnerability, WebToExtMsg } from './types'

/** 單例 Webview Panel 參考 */
let panel: vscode.WebviewPanel | undefined

/** 訊息監聽器清理函數 */
let messageDisposable: vscode.Disposable | undefined

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
      vscode.window.showInformationMessage(
        `Confession: 正在套用修復 (${msg.data.vulnerabilityId})…`,
      )
      break

    case 'ignore_vulnerability':
      vscode.window.showInformationMessage(
        `Confession: 已忽略漏洞 (${msg.data.vulnerabilityId})`,
      )
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

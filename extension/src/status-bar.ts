import * as vscode from 'vscode'

/** 狀態列項目 */
let statusBarItem: vscode.StatusBarItem

/** 目前狀態 */
type StatusBarState = 'idle' | 'analyzing' | 'safe' | 'risks'

/**
 * 建立並註冊狀態列項目
 */
export function createStatusBar(context: vscode.ExtensionContext): vscode.StatusBarItem {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
  statusBarItem.command = 'codeVuln.openDashboard'
  context.subscriptions.push(statusBarItem)

  setIdle()
  statusBarItem.show()

  return statusBarItem
}

/**
 * 設定為閒置狀態（無分析結果）
 */
export function setIdle(): void {
  if (!statusBarItem) return
  updateStatusBar('idle', 0)
}

/**
 * 設定為分析中狀態
 */
export function setAnalyzing(): void {
  if (!statusBarItem) return
  updateStatusBar('analyzing', 0)
}

/**
 * 根據漏洞數量設定為安全或風險狀態
 */
export function setResult(riskCount: number): void {
  if (!statusBarItem) return
  if (riskCount > 0) {
    updateStatusBar('risks', riskCount)
  } else {
    updateStatusBar('safe', 0)
  }
}

// === 內部：更新狀態列顯示 ===

function updateStatusBar(state: StatusBarState, riskCount: number): void {
  switch (state) {
    case 'idle':
      statusBarItem.text = '$(shield) Confession'
      statusBarItem.tooltip = 'Confession — 點擊打開安全儀表盤'
      statusBarItem.backgroundColor = undefined
      break

    case 'analyzing':
      statusBarItem.text = '$(sync~spin) Confession: 分析中…'
      statusBarItem.tooltip = 'Confession — 正在分析程式碼…'
      statusBarItem.backgroundColor = undefined
      break

    case 'safe':
      statusBarItem.text = '$(check) Confession: 安全'
      statusBarItem.tooltip = 'Confession — 未發現安全風險'
      statusBarItem.backgroundColor = undefined
      break

    case 'risks':
      statusBarItem.text = `$(warning) Confession: ${riskCount} 個風險`
      statusBarItem.tooltip = `Confession — 發現 ${riskCount} 個安全風險，點擊查看詳情`
      statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground')
      break
  }
}

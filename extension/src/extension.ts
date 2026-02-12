import * as vscode from 'vscode'

import { registerDiagnostics } from './diagnostics'
import { createFileWatcher } from './file-watcher'
import { createStatusBar } from './status-bar'
import type { PluginConfig } from './types'
import { openDashboardPanel, sendConfigUpdate } from './webview'

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

  // --- 註冊指令 ---
  context.subscriptions.push(
    vscode.commands.registerCommand('codeVuln.scanFile', () => {
      const editor = vscode.window.activeTextEditor
      if (!editor) {
        vscode.window.showWarningMessage('Confession: 沒有打開的檔案')
        return
      }
      outputChannel.appendLine(`掃描檔案: ${editor.document.fileName}`)
      vscode.window.showInformationMessage('Confession: 正在掃描當前檔案…')
    }),

    vscode.commands.registerCommand('codeVuln.scanWorkspace', () => {
      const folders = vscode.workspace.workspaceFolders
      if (!folders || folders.length === 0) {
        vscode.window.showWarningMessage('Confession: 沒有打開的工作區')
        return
      }
      outputChannel.appendLine(`掃描工作區: ${folders.map((f) => f.name).join(', ')}`)
      vscode.window.showInformationMessage('Confession: 正在掃描工作區…')
    }),

    vscode.commands.registerCommand('codeVuln.openDashboard', () => {
      outputChannel.appendLine('打開安全儀表盤')
      openDashboardPanel(context)
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

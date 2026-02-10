import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('codeVuln.scanFile', () => {
      vscode.window.showInformationMessage('Confession: Scanning current file…')
    }),

    vscode.commands.registerCommand('codeVuln.scanWorkspace', () => {
      vscode.window.showInformationMessage('Confession: Scanning workspace…')
    }),

    vscode.commands.registerCommand('codeVuln.openDashboard', () => {
      vscode.window.showInformationMessage('Confession: Opening dashboard…')
    }),
  )
}

export function deactivate() {
  // Cleanup will go here
}

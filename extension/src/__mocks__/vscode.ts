/**
 * 最小化的 vscode 模組 mock，僅供測試環境使用。
 * 提供 webview.ts 模組層級 import 所需的基本結構。
 */

export const Uri = {
  file: (path: string) => ({ fsPath: path, scheme: 'file' }),
}

export const Position = class {
  constructor(
    public line: number,
    public character: number,
  ) {}
}

export const Range = class {
  constructor(
    public start: InstanceType<typeof Position>,
    public end: InstanceType<typeof Position>,
  ) {}
}

export const ViewColumn = { One: 1 }

export const ConfigurationTarget = { Global: 1 }

export const window = {
  registerWebviewViewProvider: () => ({ dispose: () => {} }),
  showTextDocument: () => Promise.resolve(),
  showErrorMessage: () => Promise.resolve(),
  showWarningMessage: () => Promise.resolve(),
  showInformationMessage: () => Promise.resolve(),
}

export const workspace = {
  getConfiguration: () => ({
    get: (_key: string, defaultValue: unknown) => defaultValue,
    update: () => Promise.resolve(),
  }),
  applyEdit: () => Promise.resolve(true),
  openTextDocument: () => Promise.resolve({ save: () => Promise.resolve(), languageId: 'typescript' }),
}

export const commands = {
  executeCommand: () => Promise.resolve(),
}

export const env = {
  clipboard: {
    readText: () => Promise.resolve(''),
  },
}

export class WorkspaceEdit {
  replace() {}
  insert() {}
}

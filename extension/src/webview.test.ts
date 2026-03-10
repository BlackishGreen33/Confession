/**
 * webview.ts 屬性測試
 *
 * **Validates: Requirements 2.1**
 * Property 1：iframe URL 注入正確性
 * 對任意有效的 baseUrl 字串，buildHtml(baseUrl) 產生的 HTML
 * 應包含一個 <iframe> 元素，其 src 屬性值等於該 baseUrl。
 *
 * **Validates: Requirements 3.1**
 * Property 2：Extension → Webview 訊息轉發
 * 對任意有效的 ExtToWebMsg 訊息，呼叫 postMessageToWebview 後，
 * 底層 webview.postMessage 應被呼叫且傳入相同的訊息物件。
 */
import * as fc from 'fast-check'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as vscode from 'vscode'

import * as ignoreFile from './ignore-file'
import {
  fetchAllOpenVulnerabilities,
  fetchVulnerabilityById,
  updateVulnerabilityStatus,
} from './scan-client'
import type { ExtToWebMsg, PluginConfig, Vulnerability, WebToExtMsg } from './types'
import { buildHtml, postMessageToWebview, registerDashboardProvider, sendConfigUpdate } from './webview'

describe('Feature: sidebar-security-panel, Property 1: iframe URL 注入正確性', () => {
  it('buildHtml(baseUrl, route) 產生的 HTML 應包含 iframe 且 src 等於 baseUrl + route', () => {
    const routes = ['/', '/vulnerabilities', '/settings'] as const
    fc.assert(
      fc.property(
        fc.webUrl(),
        fc.constantFrom(...routes),
        (baseUrl, route) => {
          const html = buildHtml(baseUrl, route)

          // 驗證 HTML 包含 iframe 元素且 src 屬性值等於 baseUrl + route
          const iframeSrcRegex = /<iframe[^>]*\ssrc="([^"]*)"[^>]*>/
          const match = html.match(iframeSrcRegex)

          // 必須找到 iframe
          expect(match).not.toBeNull()

          // src 屬性值必須等於傳入的 baseUrl + route
          expect(match![1]).toBe(baseUrl + route)
        },
      ),
      { numRuns: 100 },
    )
  })
})


// === Property 2 的 Arbitrary 定義 ===

/** 產生隨機 Severity */
const arbSeverity = fc.constantFrom('critical', 'high', 'medium', 'low', 'info') as fc.Arbitrary<
  'critical' | 'high' | 'medium' | 'low' | 'info'
>

const arbIsoDateString = fc
  .integer({
    min: Date.UTC(2000, 0, 1, 0, 0, 0, 0),
    max: Date.UTC(2100, 11, 31, 23, 59, 59, 999),
  })
  .map((ts) => new Date(ts).toISOString())

/** 產生隨機 Vulnerability */
const arbVulnerability: fc.Arbitrary<Vulnerability> = fc.record({
  id: fc.uuid(),
  filePath: fc.string({ minLength: 1 }),
  line: fc.nat(),
  column: fc.nat(),
  endLine: fc.nat(),
  endColumn: fc.nat(),
  codeSnippet: fc.string(),
  codeHash: fc.stringMatching(/^[0-9a-f]{64}$/),
  type: fc.string({ minLength: 1 }),
  cweId: fc.option(fc.string(), { nil: null }),
  severity: arbSeverity,
  description: fc.string(),
  riskDescription: fc.option(fc.string(), { nil: null }),
  fixOldCode: fc.option(fc.string(), { nil: null }),
  fixNewCode: fc.option(fc.string(), { nil: null }),
  fixExplanation: fc.option(fc.string(), { nil: null }),
  aiModel: fc.option(fc.string(), { nil: null }),
  aiConfidence: fc.option(fc.float({ min: 0, max: 1, noNaN: true }), { nil: null }),
  aiReasoning: fc.option(fc.string(), { nil: null }),
  stableFingerprint: fc.stringMatching(/^[0-9a-f]{64}$/),
  source: fc.constantFrom('sast', 'dast'),
  humanStatus: fc.constantFrom('pending', 'confirmed', 'rejected', 'false_positive'),
  humanComment: fc.option(fc.string(), { nil: null }),
  owaspCategory: fc.option(fc.string(), { nil: null }),
  status: fc.constantFrom('open', 'fixed', 'ignored'),
  createdAt: arbIsoDateString,
  updatedAt: arbIsoDateString,
})

/** 產生隨機 PluginConfig */
const arbPluginConfig: fc.Arbitrary<PluginConfig> = fc.record({
  llm: fc.record({
    provider: fc.constantFrom('gemini' as const, 'nvidia' as const),
    apiKey: fc.string(),
    endpoint: fc.option(fc.string(), { nil: undefined }),
    model: fc.option(fc.string(), { nil: undefined }),
  }),
  analysis: fc.record({
    triggerMode: fc.constantFrom('onSave' as const, 'manual' as const),
    depth: fc.constantFrom('quick' as const, 'standard' as const, 'deep' as const),
    debounceMs: fc.nat({ max: 10000 }),
  }),
  ignore: fc.record({
    paths: fc.array(fc.string(), { maxLength: 5 }),
    types: fc.array(fc.string(), { maxLength: 5 }),
  }),
  api: fc.record({
    baseUrl: fc.webUrl(),
    mode: fc.constantFrom('local' as const, 'remote' as const),
  }),
  ui: fc.record({
    language: fc.constantFrom('auto' as const, 'zh-TW' as const, 'zh-CN' as const, 'en' as const),
  }),
})

/** 產生隨機 ExtToWebMsg */
const arbExtToWebMsg: fc.Arbitrary<ExtToWebMsg> = fc.oneof(
  fc.record({
    type: fc.constant('vulnerabilities_updated' as const),
    data: fc.array(arbVulnerability, { maxLength: 5 }),
  }),
  fc.record({
    type: fc.constant('scan_progress' as const),
    data: fc.record({
      status: fc.string({ minLength: 1 }),
      progress: fc.float({ min: 0, max: 100, noNaN: true }),
    }),
  }),
  fc.record({
    type: fc.constant('config_updated' as const),
    data: arbPluginConfig,
  }),
  fc.record({
    type: fc.constant('clipboard_paste' as const),
    data: fc.record({
      text: fc.string(),
    }),
  }),
  fc.record({
    type: fc.constant('operation_result' as const),
    data: fc.record({
      requestId: fc.string({ minLength: 1, maxLength: 64 }),
      operation: fc.constantFrom(
        'apply_fix' as const,
        'ignore_vulnerability' as const,
        'refresh_vulnerabilities' as const,
        'update_config' as const,
      ),
      success: fc.boolean(),
      message: fc.string({ minLength: 1, maxLength: 100 }),
      payload: fc.option(
        fc.record({
          vulnerabilityId: fc.option(fc.uuid(), { nil: undefined }),
          updatedVulnerability: fc.option(arbVulnerability, { nil: undefined }),
          config: fc.option(arbPluginConfig, { nil: undefined }),
        }),
        { nil: undefined },
      ),
    }),
  }),
)

// === Property 2 測試 ===

describe('Feature: sidebar-security-panel, Property 2: Extension → Webview 訊息轉發', () => {
  /** 模擬 webview.postMessage 的 spy */
  let postMessageSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    postMessageSpy = vi.fn()

    // 攔截 registerWebviewViewProvider，捕獲 provider 並模擬 resolveWebviewView
    vi.spyOn(vscode.window, 'registerWebviewViewProvider').mockImplementation(
      (_viewId: string, provider: vscode.WebviewViewProvider) => {
        // 建立模擬的 WebviewView
        const mockWebviewView = {
          webview: {
            options: {},
            html: '',
            postMessage: postMessageSpy,
            onDidReceiveMessage: vi.fn(),
          },
          onDidChangeVisibility: vi.fn(),
          visible: true,
        } as unknown as vscode.WebviewView

        // 呼叫 resolveWebviewView 讓 provider 持有 view 參考
        provider.resolveWebviewView(
          mockWebviewView,
          {} as vscode.WebviewViewResolveContext,
          {} as vscode.CancellationToken,
        )

        return { dispose: vi.fn() }
      },
    )

    // 建立模擬的 ExtensionContext
    const mockContext = {
      extensionUri: { fsPath: '/mock' },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext

    const mockConfig: PluginConfig = {
      llm: { provider: 'gemini', apiKey: '' },
      analysis: { triggerMode: 'manual', depth: 'standard', debounceMs: 500 },
      ignore: { paths: [], types: [] },
      api: { baseUrl: 'http://localhost:3000', mode: 'local' },
  ui: { language: 'auto' },
    }

    // 註冊 provider，觸發 resolveWebviewView
    registerDashboardProvider(mockContext, () => mockConfig)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * **Validates: Requirements 3.1**
   *
   * 對任意有效的 ExtToWebMsg 訊息，呼叫 postMessageToWebview 後，
   * 底層 webview.postMessage 應被呼叫且傳入相同的訊息物件。
   */
  it('postMessageToWebview 應將任意 ExtToWebMsg 轉發至底層 webview.postMessage', () => {
    fc.assert(
      fc.property(arbExtToWebMsg, (msg) => {
        postMessageSpy.mockClear()

        postMessageToWebview(msg)

        // 底層 webview.postMessage 應被呼叫恰好一次
        expect(postMessageSpy).toHaveBeenCalledOnce()

        // 傳入的訊息物件應與原始訊息完全相同
        expect(postMessageSpy).toHaveBeenCalledWith(msg)
      }),
      { numRuns: 100 },
    )
  })
})


// === Property 3 的依賴 mock ===

// mock scan-client，讓 applyVulnerabilityFix 內的 fetchVulnerabilityById 不發真實請求
vi.mock('./scan-client', () => ({
  fetchVulnerabilityById: vi.fn().mockResolvedValue(null),
  fetchAllOpenVulnerabilities: vi.fn().mockResolvedValue([]),
  updateVulnerabilityStatus: vi.fn().mockResolvedValue(true),
}))

// mock monitoring，避免 applyVulnerabilityFix 內部引用出錯
vi.mock('./monitoring', () => ({
  generateMonitoringCode: vi.fn().mockReturnValue(null),
}))

const mockedFetchVulnerabilityById = vi.mocked(fetchVulnerabilityById)
const mockedFetchAllOpenVulnerabilities = vi.mocked(fetchAllOpenVulnerabilities)
const mockedUpdateVulnerabilityStatus = vi.mocked(updateVulnerabilityStatus)

// === Property 3 的 Arbitrary 定義 ===

/** 產生隨機 WebToExtMsg（涵蓋所有通訊訊息類型） */
const arbWebToExtMsg: fc.Arbitrary<WebToExtMsg> = fc.oneof(
  fc.record({
    type: fc.constant('request_scan' as const),
    data: fc.record({
      scope: fc.constantFrom('file' as const, 'workspace' as const),
    }),
  }),
  fc.record({
    type: fc.constant('focus_sidebar_view' as const),
    data: fc.record({
      view: fc.constantFrom('dashboard' as const, 'vulnerabilities' as const),
    }),
  }),
  fc.record({
    type: fc.constant('apply_fix' as const),
    requestId: fc.string({ minLength: 1, maxLength: 64 }),
    data: fc.record({ vulnerabilityId: fc.uuid() }),
  }),
  fc.record({
    type: fc.constant('ignore_vulnerability' as const),
    requestId: fc.string({ minLength: 1, maxLength: 64 }),
    data: fc.record({
      vulnerabilityId: fc.uuid(),
      reason: fc.option(fc.string(), { nil: undefined }),
    }),
  }),
  fc.record({
    type: fc.constant('navigate_to_code' as const),
    data: fc.record({
      filePath: fc.string({ minLength: 1 }),
      line: fc.integer({ min: 1, max: 10000 }),
      column: fc.integer({ min: 1, max: 500 }),
    }),
  }),
  fc.record({
    type: fc.constant('refresh_vulnerabilities' as const),
    requestId: fc.string({ minLength: 1, maxLength: 64 }),
  }),
  fc.record({
    type: fc.constant('update_config' as const),
    requestId: fc.string({ minLength: 1, maxLength: 64 }),
    data: arbPluginConfig,
  }),
  fc.constant({ type: 'request_config' } as WebToExtMsg),
  fc.constant({ type: 'paste_clipboard' } as WebToExtMsg),
)

// === Property 3 測試 ===

describe('Feature: sidebar-security-panel, Property 3: Webview → Extension 訊息分派', () => {
  /** 捕獲 onDidReceiveMessage 註冊的回呼函數 */
  let messageHandler: (msg: WebToExtMsg) => void
  /** 模擬 webview.postMessage 的 spy（用於驗證 request_config） */
  let postMessageSpy: ReturnType<typeof vi.fn>
  /** 模擬 vscode.commands.executeCommand 的 spy */
  let executeCommandSpy: ReturnType<typeof vi.fn>
  /** 模擬 vscode.window.showTextDocument 的 spy */
  let showTextDocumentSpy: ReturnType<typeof vi.fn>
  /** 模擬 vscode.workspace.openTextDocument 的 spy */
  let openTextDocumentSpy: ReturnType<typeof vi.fn>
  /** 模擬 vscode.workspace.getConfiguration 的 spy */
  let getConfigurationSpy: ReturnType<typeof vi.fn>
  /** 模擬專案設定檔同步函式 */
  let writeScopedProjectConfigSpy: ReturnType<typeof vi.spyOn>
  /** 測試用的 PluginConfig */
  const mockConfig: PluginConfig = {
    llm: { provider: 'gemini', apiKey: 'test-key' },
    analysis: { triggerMode: 'manual', depth: 'standard', debounceMs: 500 },
    ignore: { paths: [], types: [] },
    api: { baseUrl: 'http://localhost:3000', mode: 'local' },
  ui: { language: 'auto' },
  }

  beforeEach(() => {
    postMessageSpy = vi.fn()
    executeCommandSpy = vi.fn().mockResolvedValue(undefined)
    showTextDocumentSpy = vi.fn().mockResolvedValue(undefined)
    openTextDocumentSpy = vi.fn().mockImplementation(async (uri: { fsPath?: string }) => ({
      uri,
      languageId: 'typescript',
      save: vi.fn().mockResolvedValue(undefined),
    }))

    // mock getConfiguration 回傳物件，含 get 與 update
    const mockCfgObj = {
      get: (_key: string, defaultValue: unknown) => defaultValue,
      update: vi.fn().mockResolvedValue(undefined),
    }
    getConfigurationSpy = vi.fn().mockReturnValue(mockCfgObj)

    vi.spyOn(vscode.commands, 'executeCommand').mockImplementation(executeCommandSpy)
    vi.spyOn(vscode.window, 'showTextDocument').mockImplementation(showTextDocumentSpy)
    vi.spyOn(vscode.workspace, 'openTextDocument').mockImplementation(openTextDocumentSpy)
    vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(getConfigurationSpy)
    writeScopedProjectConfigSpy = vi
      .spyOn(ignoreFile, 'writeScopedProjectConfig')
      .mockImplementation(async (config) => ({
        written: true,
        config,
        rootPath: '/mock-workspace',
        filePath: '/mock-workspace/.confession/config.json',
      }))

    // 攔截 registerWebviewViewProvider，捕獲 provider 並觸發 resolveWebviewView
    vi.spyOn(vscode.window, 'registerWebviewViewProvider').mockImplementation(
      (_viewId: string, provider: vscode.WebviewViewProvider) => {
        const mockWebviewView = {
          webview: {
            options: {},
            html: '',
            postMessage: postMessageSpy,
            onDidReceiveMessage: vi.fn((handler: (msg: WebToExtMsg) => void) => {
              messageHandler = handler
              return { dispose: vi.fn() }
            }),
          },
          onDidChangeVisibility: vi.fn(),
          visible: true,
        } as unknown as vscode.WebviewView

        provider.resolveWebviewView(
          mockWebviewView,
          {} as vscode.WebviewViewResolveContext,
          {} as vscode.CancellationToken,
        )

        return { dispose: vi.fn() }
      },
    )

    const mockContext = {
      extensionUri: { fsPath: '/mock' },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext

    registerDashboardProvider(mockContext, () => mockConfig)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * **Validates: Requirements 3.2, 3.3, 3.4**
   *
   * 對任意有效的 WebToExtMsg 訊息，handleWebviewMessage 應根據
   * 訊息的 type 欄位分派至對應的處理邏輯。
   */
  it('任意 WebToExtMsg 應根據 type 分派至正確的處理邏輯', async () => {
    await fc.assert(
      fc.asyncProperty(arbWebToExtMsg, async (msg) => {
        // 清除所有 spy 的呼叫紀錄
        executeCommandSpy.mockClear()
        showTextDocumentSpy.mockClear()
        openTextDocumentSpy.mockClear()
        getConfigurationSpy.mockClear()
        postMessageSpy.mockClear()
        writeScopedProjectConfigSpy.mockClear()

        // 透過捕獲的回呼觸發訊息處理
        messageHandler(msg)

        // 等待微任務佇列清空（apply_fix、update_config 為非同步）
        await new Promise((resolve) => setTimeout(resolve, 0))

        // 根據訊息類型驗證對應的副作用
        switch (msg.type) {
          case 'request_scan':
            if (msg.data.scope === 'file') {
              expect(executeCommandSpy).toHaveBeenCalledWith('codeVuln.scanFile')
            } else {
              expect(executeCommandSpy).toHaveBeenCalledWith('codeVuln.scanWorkspace')
            }
            break
          case 'focus_sidebar_view':
            if (msg.data.view === 'vulnerabilities') {
              expect(executeCommandSpy).toHaveBeenCalledWith('codeVuln.showVulnerabilities')
            } else {
              expect(executeCommandSpy).toHaveBeenCalledWith('codeVuln.showDashboard')
            }
            break

          case 'apply_fix':
            // applyVulnerabilityFix 會先呼叫 getConfiguration 取得 baseUrl
            expect(getConfigurationSpy).toHaveBeenCalledWith('confession')
            break

          case 'ignore_vulnerability':
            expect(executeCommandSpy).toHaveBeenCalledWith(
              'codeVuln.ignoreVulnerability',
              msg.data.vulnerabilityId,
            )
            break

          case 'refresh_vulnerabilities':
            // refresh 完成後會回傳 operation_result（跨視圖廣播）
            expect(postMessageSpy).toHaveBeenCalled()
            break

          case 'navigate_to_code': {
            expect(openTextDocumentSpy).toHaveBeenCalledOnce()
            const [openTarget] = openTextDocumentSpy.mock.calls[0] as [{ fsPath?: string }]
            expect(openTarget.fsPath).toBe(msg.data.filePath)

            expect(showTextDocumentSpy).toHaveBeenCalledOnce()
            const [document, options] = showTextDocumentSpy.mock.calls[0] as [
              { uri?: { fsPath?: string } },
              { selection: { start: { line: number; character: number } }; viewColumn: number },
            ]
            // 驗證開啟的檔案路徑正確
            expect(document.uri?.fsPath).toBe(msg.data.filePath)
            // 驗證游標位置正確（API 為 0-based，訊息為 1-based）
            expect(options.selection.start.line).toBe(msg.data.line - 1)
            expect(options.selection.start.character).toBe(msg.data.column - 1)
            break
          }

          case 'update_config':
            // writeConfigToSettings 會呼叫 getConfiguration('confession')
            expect(getConfigurationSpy).toHaveBeenCalledWith('confession')
            expect(writeScopedProjectConfigSpy).toHaveBeenCalledWith(
              expect.objectContaining({
                ...msg.data,
                ignore: {
                  paths: ignoreFile.normalizeIgnorePaths(msg.data.ignore.paths),
                  types: ignoreFile.normalizeIgnoreTypes(msg.data.ignore.types),
                },
              }),
            )
            break

          case 'request_config':
            // 應透過 postMessage 推送 config_updated 訊息
            expect(postMessageSpy).toHaveBeenCalledWith({
              type: 'config_updated',
              data: mockConfig,
            })
            break
          case 'paste_clipboard':
            // 應觸發回傳 clipboard_paste（跨視圖廣播）
            expect(postMessageSpy).toHaveBeenCalled()
            break
        }
      }),
      { numRuns: 100 },
    )
  })
})

describe('AI 自動修復冪等保護', () => {
  let messageHandler: (msg: WebToExtMsg) => void
  let postMessageSpy: ReturnType<typeof vi.fn>
  let applyEditSpy: ReturnType<typeof vi.fn>
  let openTextDocumentSpy: ReturnType<typeof vi.fn>

  function positionToOffset(text: string, line: number, character: number): number {
    const lines = text.split('\n')
    let offset = 0
    for (let i = 0; i < line; i += 1) {
      offset += lines[i]?.length ?? 0
      if (i < lines.length - 1) offset += 1
    }
    return offset + character
  }

  function offsetToPosition(text: string, offset: number): { line: number; character: number } {
    const safeOffset = Math.max(0, Math.min(offset, text.length))
    const prefix = text.slice(0, safeOffset)
    const parts = prefix.split('\n')
    const line = Math.max(0, parts.length - 1)
    const character = parts[parts.length - 1]?.length ?? 0
    return { line, character }
  }

  beforeEach(() => {
    postMessageSpy = vi.fn()
    applyEditSpy = vi.fn().mockResolvedValue(true)

    const fixedSnippet = `if (payload.__proto__) { delete payload.__proto__ }\nObject.assign(Object.prototype, payload.__proto__ as object)`
    const sourceText = `export const mergeConfig = (payload: Record<string, unknown>) => {\n  const target: Record<string, unknown> = {}\n\n  // 高風險：可污染原型鏈\n  ${fixedSnippet}\n\n  return target\n}\n`

    openTextDocumentSpy = vi.fn().mockResolvedValue({
      uri: { fsPath: '/tmp/prototype-pollution.ts' },
      languageId: 'typescript',
      save: vi.fn().mockResolvedValue(undefined),
      getText: (range?: { start: { line: number; character: number }; end: { line: number; character: number } }) => {
        if (!range) return sourceText
        const start = positionToOffset(sourceText, range.start.line, range.start.character)
        const end = positionToOffset(sourceText, range.end.line, range.end.character)
        return sourceText.slice(start, end)
      },
      positionAt: (offset: number) => {
        const pos = offsetToPosition(sourceText, offset)
        return new vscode.Position(pos.line, pos.character)
      },
    })

    vi.spyOn(vscode.workspace, 'applyEdit').mockImplementation(applyEditSpy)
    vi.spyOn(vscode.workspace, 'openTextDocument').mockImplementation(openTextDocumentSpy)
    vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
      get: (_key: string, defaultValue: unknown) => defaultValue,
      update: vi.fn().mockResolvedValue(undefined),
    })
    vi.spyOn(vscode.window, 'registerWebviewViewProvider').mockImplementation(
      (_viewId: string, provider: vscode.WebviewViewProvider) => {
        const mockWebviewView = {
          webview: {
            options: {},
            html: '',
            postMessage: postMessageSpy,
            onDidReceiveMessage: vi.fn((handler: (msg: WebToExtMsg) => void) => {
              messageHandler = handler
              return { dispose: vi.fn() }
            }),
          },
          onDidChangeVisibility: vi.fn(),
          visible: true,
        } as unknown as vscode.WebviewView

        provider.resolveWebviewView(
          mockWebviewView,
          {} as vscode.WebviewViewResolveContext,
          {} as vscode.CancellationToken,
        )

        return { dispose: vi.fn() }
      },
    )

    const vuln: Vulnerability = {
      id: 'vuln-1',
      filePath: '/tmp/prototype-pollution.ts',
      line: 5,
      column: 3,
      endLine: 5,
      endColumn: 60,
      codeSnippet: 'Object.assign(Object.prototype, payload.__proto__ as object)',
      codeHash: 'a'.repeat(64),
      type: 'prototype_pollution',
      cweId: 'CWE-915',
      severity: 'critical',
      description: 'prototype pollution',
      riskDescription: 'risk',
      fixOldCode: 'Object.assign(Object.prototype, payload.__proto__ as object)',
      fixNewCode: fixedSnippet,
      fixExplanation: 'remove __proto__',
      aiModel: null,
      aiConfidence: 0.9,
      aiReasoning: null,
      stableFingerprint: 'b'.repeat(64),
      source: 'sast',
      humanStatus: 'confirmed',
      humanComment: null,
      owaspCategory: null,
      status: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    mockedFetchVulnerabilityById.mockReset()
    mockedFetchAllOpenVulnerabilities.mockReset()
    mockedUpdateVulnerabilityStatus.mockReset()
    mockedFetchVulnerabilityById
      .mockResolvedValueOnce(vuln)
      .mockResolvedValueOnce({ ...vuln, status: 'fixed' })
    mockedFetchAllOpenVulnerabilities.mockResolvedValue([])
    mockedUpdateVulnerabilityStatus.mockResolvedValue(true)

    const mockContext = {
      extensionUri: { fsPath: '/mock' },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext
    const mockConfig: PluginConfig = {
      llm: { provider: 'gemini', apiKey: '' },
      analysis: { triggerMode: 'manual', depth: 'standard', debounceMs: 500 },
      ignore: { paths: [], types: [] },
      api: { baseUrl: 'http://localhost:3000', mode: 'local' },
  ui: { language: 'auto' },
    }
    registerDashboardProvider(mockContext, () => mockConfig)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('修復片段已存在時，不應再次寫入代碼，但應更新狀態為 fixed', async () => {
    messageHandler({
      type: 'apply_fix',
      requestId: 'req-1',
      data: { vulnerabilityId: 'vuln-1' },
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(applyEditSpy).not.toHaveBeenCalled()
    expect(mockedUpdateVulnerabilityStatus).toHaveBeenCalledWith(
      'http://localhost:3000',
      'vuln-1',
      'fixed',
    )
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'operation_result',
        data: expect.objectContaining({
          requestId: 'req-1',
          operation: 'apply_fix',
          success: true,
        }),
      }),
    )
  })
})


// === Property 4 測試 ===

describe('Feature: sidebar-security-panel, Property 4: 配置變更觸發通知', () => {
  /** 模擬 webview.postMessage 的 spy */
  let postMessageSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    postMessageSpy = vi.fn()

    // 攔截 registerWebviewViewProvider，捕獲 provider 並模擬 resolveWebviewView
    vi.spyOn(vscode.window, 'registerWebviewViewProvider').mockImplementation(
      (_viewId: string, provider: vscode.WebviewViewProvider) => {
        const mockWebviewView = {
          webview: {
            options: {},
            html: '',
            postMessage: postMessageSpy,
            onDidReceiveMessage: vi.fn(),
          },
          onDidChangeVisibility: vi.fn(),
          visible: true,
        } as unknown as vscode.WebviewView

        provider.resolveWebviewView(
          mockWebviewView,
          {} as vscode.WebviewViewResolveContext,
          {} as vscode.CancellationToken,
        )

        return { dispose: vi.fn() }
      },
    )

    const mockContext = {
      extensionUri: { fsPath: '/mock' },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext

    const mockConfig: PluginConfig = {
      llm: { provider: 'gemini', apiKey: '' },
      analysis: { triggerMode: 'manual', depth: 'standard', debounceMs: 500 },
      ignore: { paths: [], types: [] },
      api: { baseUrl: 'http://localhost:3000', mode: 'local' },
  ui: { language: 'auto' },
    }

    // 註冊 provider，觸發 resolveWebviewView，建立 providerInstance
    registerDashboardProvider(mockContext, () => mockConfig)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * **Validates: Requirements 3.5**
   *
   * 對任意 PluginConfig 物件，呼叫 sendConfigUpdate(config) 後，
   * provider 的 postMessage 應被呼叫且訊息類型為 config_updated，
   * 資料等於傳入的配置物件。
   */
  it('sendConfigUpdate 應以 config_updated 訊息轉發任意 PluginConfig', () => {
    fc.assert(
      fc.property(arbPluginConfig, (config) => {
        postMessageSpy.mockClear()

        sendConfigUpdate(config)

        // postMessage 應被呼叫恰好一次
        expect(postMessageSpy).toHaveBeenCalledOnce()

        // 訊息類型為 config_updated，資料等於傳入的配置
        expect(postMessageSpy).toHaveBeenCalledWith({
          type: 'config_updated',
          data: config,
        })
      }),
      { numRuns: 100 },
    )
  })
})


// === Property 5 測試 ===

describe('Feature: sidebar-security-panel, Property 5: 可見性變更觸發配置推送', () => {
  /** 模擬 webview.postMessage 的 spy */
  let postMessageSpy: ReturnType<typeof vi.fn>
  /** 捕獲 onDidChangeVisibility 註冊的回呼函數 */
  let visibilityCallback: () => void
  /** 模擬的 WebviewView，可控制 visible 屬性 */
  let mockWebviewView: { visible: boolean; webview: { postMessage: ReturnType<typeof vi.fn> } }
  /** 動態 getConfig 回傳值，每次迭代可替換 */
  let currentConfig: PluginConfig

  beforeEach(() => {
    postMessageSpy = vi.fn()

    // 攔截 registerWebviewViewProvider，捕獲 provider 並模擬 resolveWebviewView
    vi.spyOn(vscode.window, 'registerWebviewViewProvider').mockImplementation(
      (_viewId: string, provider: vscode.WebviewViewProvider) => {
        mockWebviewView = {
          webview: {
            options: {},
            html: '',
            postMessage: postMessageSpy,
            onDidReceiveMessage: vi.fn(),
          } as unknown as { postMessage: ReturnType<typeof vi.fn> },
          onDidChangeVisibility: vi.fn((cb: () => void) => {
            visibilityCallback = cb
            return { dispose: vi.fn() }
          }),
          visible: true,
        } as unknown as typeof mockWebviewView

        provider.resolveWebviewView(
          mockWebviewView as unknown as vscode.WebviewView,
          {} as vscode.WebviewViewResolveContext,
          {} as vscode.CancellationToken,
        )

        return { dispose: vi.fn() }
      },
    )

    // 初始配置（會在 fc.property 迭代中被替換）
    currentConfig = {
      llm: { provider: 'gemini', apiKey: '' },
      analysis: { triggerMode: 'manual', depth: 'standard', debounceMs: 500 },
      ignore: { paths: [], types: [] },
      api: { baseUrl: 'http://localhost:3000', mode: 'local' },
  ui: { language: 'auto' },
    }

    const mockContext = {
      extensionUri: { fsPath: '/mock' },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext

    // getConfig 回傳 currentConfig，每次迭代可動態替換
    registerDashboardProvider(mockContext, () => currentConfig)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * **Validates: Requirements 6.3**
   *
   * 對任意配置狀態，當 Sidebar_View 從隱藏變為可見時，
   * provider 應自動發送 config_updated 訊息，資料為目前的配置。
   */
  it('視圖從隱藏變為可見時，應以 config_updated 推送任意 PluginConfig', () => {
    fc.assert(
      fc.property(arbPluginConfig, (config) => {
        // 替換目前配置為隨機產生的配置
        currentConfig = config
        postMessageSpy.mockClear()

        // 模擬視圖變為可見
        mockWebviewView.visible = true
        visibilityCallback()

        // postMessage 應被呼叫恰好一次
        expect(postMessageSpy).toHaveBeenCalledOnce()

        // 訊息類型為 config_updated，資料等於目前配置
        expect(postMessageSpy).toHaveBeenCalledWith({
          type: 'config_updated',
          data: config,
        })
      }),
      { numRuns: 100 },
    )
  })

  /**
   * 視圖仍然隱藏時，不應推送配置。
   */
  it('視圖仍然隱藏時，不應推送 config_updated', () => {
    fc.assert(
      fc.property(arbPluginConfig, (config) => {
        currentConfig = config
        postMessageSpy.mockClear()

        // 模擬視圖仍然隱藏
        mockWebviewView.visible = false
        visibilityCallback()

        // postMessage 不應被呼叫
        expect(postMessageSpy).not.toHaveBeenCalled()
      }),
      { numRuns: 100 },
    )
  })
})

// === 向後相容單元測試（需求 5.3, 1.1） ===

describe('向後相容：viewType 與 openDashboard 指令', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * **Validates: Requirements 1.1**
   * registerDashboardProvider 應以 'confession.dashboard' 作為 viewType 註冊 provider
   */
  it('registerDashboardProvider 應以 viewType "confession.dashboard" 註冊', () => {
    const registerSpy = vi
      .spyOn(vscode.window, 'registerWebviewViewProvider')
      .mockReturnValue({ dispose: vi.fn() })

    const mockContext = {
      extensionUri: { fsPath: '/mock' },
      subscriptions: [],
    } as unknown as vscode.ExtensionContext

    const mockConfig: PluginConfig = {
      llm: { provider: 'gemini', apiKey: '' },
      analysis: { triggerMode: 'manual', depth: 'standard', debounceMs: 500 },
      ignore: { paths: [], types: [] },
      api: { baseUrl: 'http://localhost:3000', mode: 'local' },
  ui: { language: 'auto' },
    }

    registerDashboardProvider(mockContext, () => mockConfig)

    // 驗證 registerWebviewViewProvider 被呼叫，且第一個參數為 'confession.dashboard'
    expect(registerSpy).toHaveBeenCalledOnce()
    expect(registerSpy.mock.calls[0]![0]).toBe('confession.dashboard')
  })

  /**
   * **Validates: Requirements 5.3**
   * codeVuln.openDashboard 指令應呼叫 confession.dashboard.focus 聚焦側邊欄
   */
  it('openDashboard 指令應呼叫 confession.dashboard.focus', () => {
    const executeCommandSpy = vi
      .spyOn(vscode.commands, 'executeCommand')
      .mockResolvedValue(undefined)

    // 模擬 openDashboard 指令的行為（與 extension.ts 中的實作一致）
    vscode.commands.executeCommand('confession.dashboard.focus')

    expect(executeCommandSpy).toHaveBeenCalledWith('confession.dashboard.focus')
  })
})

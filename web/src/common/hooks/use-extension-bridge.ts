'use client'

import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useRouter } from 'next/navigation'
import React, { useCallback, useEffect, useRef } from 'react'

import { configAtom, scanStatusAtom, vulnerabilityDetailAtom } from '@/libs/atoms'
import type { ExtToWebMsg, PluginConfig, Vulnerability, WebToExtMsg } from '@/libs/types'

type OperationResult = Extract<ExtToWebMsg, { type: 'operation_result' }>['data']
type RequestMessage = Extract<WebToExtMsg, { requestId: string }>

interface PendingOperation {
  resolve: (value: OperationResult) => void
  reject: (reason?: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

const pendingOperations = new Map<string, PendingOperation>()
type EditableInputTarget = {
  tagName?: string
  value: string
  selectionStart?: number | null
  selectionEnd?: number | null
  setSelectionRange: (start: number, end: number) => void
  dispatchEvent: (event: Event) => boolean
}

let lastRequestedPasteTarget: EditableInputTarget | null = null

/** 判斷是否在 VS Code Webview iframe 內 */
function isInVscodeWebview(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent !== window
  } catch {
    return false
  }
}

/** 產生請求 ID，供 request/ack 對應使用 */
export function createRequestId(prefix = 'req'): string {
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now()}-${rand}`
}

function registerPendingOperation(requestId: string, timeoutMs: number): Promise<OperationResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingOperations.delete(requestId)
      reject(new Error('等待 Extension 回執逾時'))
    }, timeoutMs)

    pendingOperations.set(requestId, { resolve, reject, timer })
  })
}

function resolvePendingOperation(result: OperationResult): void {
  const pending = pendingOperations.get(result.requestId)
  if (!pending) return
  clearTimeout(pending.timer)
  pendingOperations.delete(result.requestId)
  pending.resolve(result)
}

/** 向擴充套件發送訊息（透過 parent window 轉發） */
export function postToExtension(msg: WebToExtMsg): void {
  if (isInVscodeWebview()) {
    window.parent.postMessage(msg, '*')
  }
}

function toEditableInputTarget(value: unknown): EditableInputTarget | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as {
    tagName?: string
    value?: string
    selectionStart?: number | null
    selectionEnd?: number | null
    setSelectionRange?: (start: number, end: number) => void
    dispatchEvent?: (event: Event) => boolean
  }

  if (typeof candidate.tagName !== 'string') {
    return null
  }

  const tag = candidate.tagName.toLowerCase()
  if (tag !== 'input' && tag !== 'textarea') {
    return null
  }

  if (
    typeof candidate.value !== 'string' ||
    typeof candidate.setSelectionRange !== 'function' ||
    typeof candidate.dispatchEvent !== 'function'
  ) {
    return null
  }

  return candidate as {
    value: string
    selectionStart?: number | null
    selectionEnd?: number | null
    setSelectionRange: (start: number, end: number) => void
    dispatchEvent: (event: Event) => boolean
  }
}

function insertClipboardTextToFocusedInput(text: string): boolean {
  const activeTarget = toEditableInputTarget(document.activeElement)
  const target = activeTarget ?? lastRequestedPasteTarget
  if (!target) {
    return false
  }

  const start = target.selectionStart ?? target.value.length
  const end = target.selectionEnd ?? target.value.length
  const next = `${target.value.slice(0, start)}${text}${target.value.slice(end)}`

  const tag = typeof target.tagName === 'string' ? target.tagName.toLowerCase() : ''
  const valueSetter =
    tag === 'textarea'
      ? Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
      : Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set

  if (typeof valueSetter === 'function') {
    valueSetter.call(target, next)
  } else {
    target.value = next
  }

  target.setSelectionRange(start + text.length, start + text.length)
  target.dispatchEvent(new window.Event('input', { bubbles: true }))
  target.dispatchEvent(new window.Event('change', { bubbles: true }))
  lastRequestedPasteTarget = target
  return true
}

function isEditablePasteTarget(target: unknown): boolean {
  if (toEditableInputTarget(target)) return true
  if (!target || typeof target !== 'object') return false

  const candidate = target as { isContentEditable?: boolean; getAttribute?: (name: string) => string | null }

  if (candidate.isContentEditable) {
    return true
  }

  const role = typeof candidate.getAttribute === 'function' ? candidate.getAttribute('role') : null
  return role === 'textbox'
}

/**
 * 發送需要回執的請求，並等待 operation_result。
 * 若逾時或不在 VS Code Webview 環境，會拋出錯誤。
 */
export async function sendRequestToExtension(
  msg: RequestMessage,
  timeoutMs = 20_000,
): Promise<OperationResult> {
  if (!isInVscodeWebview()) {
    throw new Error('目前不在 VS Code Webview 環境')
  }
  const pending = registerPendingOperation(msg.requestId, timeoutMs)
  postToExtension(msg)
  return pending
}

/** 向擴充套件發送開啟漏洞詳情請求 */
export function sendOpenVulnerabilityDetail(vulnId: string): void {
  postToExtension({ type: 'open_vulnerability_detail', data: { vulnerabilityId: vulnId } })
}

function syncUpdatedVulnerabilityCache(
  queryClient: QueryClient,
  updated: Vulnerability,
): void {
  queryClient.setQueryData<Vulnerability>(['vulnerability', updated.id], updated)
  queryClient.setQueriesData<{
    items: Vulnerability[]
    total: number
    page: number
    pageSize: number
    totalPages: number
  }>({ queryKey: ['vulnerabilities'] }, (old) => {
    if (!old) return old
    return {
      ...old,
      items: old.items.map((item) => (item.id === updated.id ? updated : item)),
    }
  })
}

function refreshVulnerabilityQueries(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] })
  void queryClient.invalidateQueries({ queryKey: ['vuln-stats'] })
  void queryClient.invalidateQueries({ queryKey: ['vuln-trend'] })
  void queryClient.invalidateQueries({ queryKey: ['vulnerability'] })
  void queryClient.invalidateQueries({ queryKey: ['vulnerability-events'] })

  // 立即觸發活躍查詢重抓，避免卡片數據停留在舊快取。
  void queryClient.refetchQueries({ queryKey: ['vulnerabilities'], type: 'active' })
  void queryClient.refetchQueries({ queryKey: ['vuln-stats'], type: 'active' })
  void queryClient.refetchQueries({ queryKey: ['vuln-trend'], type: 'active' })
}

/**
 * 擴充套件橋接 hook：
 * - 監聽 config_updated 訊息，同步到 configAtom 與 config query cache
 * - 監聽 navigate_to_view 訊息，呼叫 router.push 切換路由
 * - 監聽 vulnerability_detail_data 訊息，寫入 vulnerabilityDetailAtom
 * - 監聽 scan_progress 訊息，同步到 scanStatusAtom
 * - 監聽 vulnerabilities_updated 訊息，觸發漏洞相關查詢刷新
 * - 監聽 operation_result 訊息，完成 request/ack 配對並執行快取同步
 * - 提供 sendConfigToExtension / sendConfigToExtensionAndWait
 * - 啟動時向擴充套件請求目前配置
 */
interface UseExtensionBridgeOptions {
  passive?: boolean
}

export function useExtensionBridge(options?: UseExtensionBridgeOptions) {
  const passive = options?.passive ?? false
  const setConfig = useSetAtom(configAtom)
  const setScanStatus = useSetAtom(scanStatusAtom)
  const setVulnDetail = useSetAtom(vulnerabilityDetailAtom)
  const queryClient = useQueryClient()
  const router = useRouter()
  const initializedRef = useRef(false)

  useEffect(() => {
    if (passive) {
      return
    }

    const handler = (event: MessageEvent<ExtToWebMsg>) => {
      const msg = event.data
      if (!msg?.type) return

      switch (msg.type) {
        case 'config_updated':
          setConfig(msg.data)
          queryClient.setQueryData(['config'], msg.data)
          break
        case 'clipboard_paste':
          insertClipboardTextToFocusedInput(msg.data.text)
          break
        case 'navigate_to_view':
          router.push(msg.data.route)
          break
        case 'vulnerability_detail_data':
          setVulnDetail(msg.data)
          break
        case 'scan_progress':
          setScanStatus({
            isScanning: msg.data.status === 'running',
            progress: msg.data.progress,
            message:
              msg.data.status === 'completed'
                ? '掃描完成'
                : msg.data.status === 'failed'
                  ? '掃描失敗'
                  : '掃描進行中…',
          })
          void queryClient.invalidateQueries({ queryKey: ['scan-recent'] })
          if (msg.data.status === 'completed' || msg.data.status === 'failed') {
            refreshVulnerabilityQueries(queryClient)
          }
          break
        case 'vulnerabilities_updated':
          refreshVulnerabilityQueries(queryClient)
          break
        case 'operation_result':
          resolvePendingOperation(msg.data)

          if (!msg.data.success) break

          if (msg.data.payload?.updatedVulnerability) {
            syncUpdatedVulnerabilityCache(queryClient, msg.data.payload.updatedVulnerability)
            void queryClient.invalidateQueries({
              queryKey: ['vulnerability-events', msg.data.payload.updatedVulnerability.id],
            })
          }

          if (msg.data.payload?.config) {
            setConfig(msg.data.payload.config)
            queryClient.setQueryData(['config'], msg.data.payload.config)
          }

          if (
            msg.data.operation === 'apply_fix' ||
            msg.data.operation === 'ignore_vulnerability' ||
            msg.data.operation === 'refresh_vulnerabilities'
          ) {
            refreshVulnerabilityQueries(queryClient)
          }
          break
      }
    }

    window.addEventListener('message', handler)

    // 首次掛載時向擴充套件請求目前配置
    if (!initializedRef.current && isInVscodeWebview()) {
      initializedRef.current = true
      postToExtension({ type: 'request_config' })
    }

    return () => window.removeEventListener('message', handler)
  }, [passive, queryClient, router, setConfig, setScanStatus, setVulnDetail])

  useEffect(() => {
    if (passive || !isInVscodeWebview()) {
      return
    }

    const onKeydown = (event: {
      metaKey?: boolean
      ctrlKey?: boolean
      key?: string
      target?: unknown
      preventDefault?: () => void
    }) => {
      const isPaste =
        (event.metaKey || event.ctrlKey) &&
        typeof event.key === 'string' &&
        event.key.toLowerCase() === 'v'
      if (!isPaste) return
      if (!isEditablePasteTarget(event.target)) return
      lastRequestedPasteTarget = toEditableInputTarget(event.target)

      // VS Code Webview + iframe 環境下，快捷鍵貼上可能被 Host 吞掉；
      // 這裡改由 Extension 主動讀取剪貼簿後回填。
      event.preventDefault?.()
      postToExtension({ type: 'paste_clipboard' })
    }

    window.addEventListener('keydown', onKeydown, true)
    return () => window.removeEventListener('keydown', onKeydown, true)
  }, [passive])

  const sendConfigToExtension = useCallback((config: PluginConfig) => {
    const requestId = createRequestId('config')
    postToExtension({ type: 'update_config', requestId, data: config })
    return requestId
  }, [])

  const sendConfigToExtensionAndWait = useCallback((config: PluginConfig) => {
    const requestId = createRequestId('config')
    return sendRequestToExtension({ type: 'update_config', requestId, data: config })
  }, [])

  return {
    sendConfigToExtension,
    sendConfigToExtensionAndWait,
    isInVscodeWebview: isInVscodeWebview(),
  }
}

/** 無 UI 初始化元件，掛載於 Providers 內以啟動橋接監聽 */
export const ExtensionBridgeInit: React.FC = () => {
  useExtensionBridge()
  return null
}

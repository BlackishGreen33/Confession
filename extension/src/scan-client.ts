import type { Vulnerability } from './types'
import type { ScanEngineMode, ScanErrorCode } from './types'

/** 掃描檔案輸入 */
export interface ScanFileInput {
  path: string
  content: string
  language: string
}

/** 掃描選項 */
export interface ScanOptions {
  depth: 'quick' | 'standard' | 'deep'
  includeLlmScan?: boolean
  forceRescan?: boolean
  scanScope?: 'file' | 'workspace'
  workspaceSnapshotComplete?: boolean
  workspaceRoots?: string[]
  engineMode?: ScanEngineMode
}

/** 掃描任務狀態 */
interface ScanTaskStatus {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  engineMode: ScanEngineMode
  fallbackUsed?: boolean
  fallbackFrom?: 'agentic'
  fallbackTo?: 'baseline'
  fallbackReason?: string
  errorMessage?: string | null
  errorCode?: ScanErrorCode | null
}

export interface PollUntilDoneOptions {
  timeoutMs?: number
  intervalMs?: number
}

const DEFAULT_POLL_TIMEOUT_MS = 60_000
const DEFAULT_POLL_INTERVAL_MS = 1_000
const SSE_RETRY_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000] as const

export class ScanTaskFailedError extends Error {
  readonly errorCode: ScanErrorCode | null
  readonly engineMode: ScanEngineMode | null

  constructor(
    message: string,
    errorCode: ScanErrorCode | null,
    engineMode: ScanEngineMode | null
  ) {
    super(message)
    this.name = 'ScanTaskFailedError'
    this.errorCode = errorCode
    this.engineMode = engineMode
  }
}

class ScanStreamUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScanStreamUnavailableError'
  }
}

/** 進行中的掃描請求去重：key = 檔案路徑排序後的組合 */
const inflightRequests = new Map<string, Promise<string>>()

/**
 * 計算掃描請求的去重鍵
 */
function scanDedupeKey(files: ScanFileInput[]): string {
  const fileKey = files
    .map((f) => f.path)
    .sort()
    .join('|')
  return fileKey
}

/**
 * 觸發掃描並回傳 taskId（含請求去重）
 *
 * 若相同檔案組合的掃描正在進行中，直接回傳既有 Promise。
 */
export async function triggerScan(
  baseUrl: string,
  files: ScanFileInput[],
  options: ScanOptions
): Promise<string> {
  const key = `${scanDedupeKey(files)}::${options.depth}::${options.scanScope ?? 'file'}::${options.engineMode ?? 'auto'}`
  const existing = inflightRequests.get(key)
  if (existing) return existing

  const promise = doTriggerScan(baseUrl, files, options).finally(() => {
    inflightRequests.delete(key)
  })

  inflightRequests.set(key, promise)
  return promise
}

/**
 * 實際觸發掃描 API 呼叫
 */
async function doTriggerScan(
  baseUrl: string,
  files: ScanFileInput[],
  options: ScanOptions
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/scan`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files,
      depth: options.depth,
      includeLlmScan: options.includeLlmScan ?? false,
      forceRescan: options.forceRescan ?? false,
      scanScope: options.scanScope ?? 'file',
      workspaceSnapshotComplete: options.workspaceSnapshotComplete,
      workspaceRoots: options.workspaceRoots,
      engineMode: options.engineMode,
    }),
  })

  if (!res.ok) {
    throw new Error(`掃描 API 錯誤: ${res.status}`)
  }

  const data = (await res.json()) as { taskId: string }
  return data.taskId
}

/**
 * 取消指定掃描任務（POST /api/scan/cancel/:id）。
 */
export async function cancelScanTask(
  baseUrl: string,
  taskId: string
): Promise<void> {
  const base = baseUrl.replace(/\/+$/, '')
  const res = await fetch(`${base}/api/scan/cancel/${taskId}`, {
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(`取消掃描失敗: ${res.status}`)
  }
}

/**
 * 以 SSE 為主、輪詢為備援，等待掃描完成或失敗。
 */
export async function pollUntilDone(
  baseUrl: string,
  taskId: string,
  onProgress?: (progress: number) => void,
  options: PollUntilDoneOptions = {}
): Promise<void> {
  const base = baseUrl.replace(/\/+$/, '')
  const timeoutMs = Math.max(
    5_000,
    options.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS
  )
  const intervalMs = Math.max(
    200,
    options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS
  )
  const startedAt = Date.now()

  try {
    await waitUntilDoneViaSse(base, taskId, timeoutMs, onProgress)
    return
  } catch (error) {
    if (error instanceof ScanTaskFailedError) throw error
    if (isTimeoutError(error)) throw error
    if (!(error instanceof ScanStreamUnavailableError)) {
      throw error
    }
  }

  await waitUntilDoneViaPolling(
    base,
    taskId,
    startedAt,
    timeoutMs,
    intervalMs,
    onProgress
  )
}

async function waitUntilDoneViaSse(
  base: string,
  taskId: string,
  timeoutMs: number,
  onProgress?: (progress: number) => void
): Promise<void> {
  const startedAt = Date.now()
  let retryCount = 0
  let lastEventId: string | null = null

  while (Date.now() - startedAt < timeoutMs) {
    const remainingMs = timeoutMs - (Date.now() - startedAt)
    if (remainingMs <= 0) break

    const controller = new globalThis.AbortController()
    const timeout = setTimeout(() => controller.abort(), remainingMs)

    try {
      const headers: Record<string, string> = {}
      if (lastEventId) {
        headers['Last-Event-ID'] = lastEventId
      }

      const res = await fetch(`${base}/api/scan/stream/${taskId}`, {
        headers,
        signal: controller.signal,
      })

      if (!res.ok) {
        throw new ScanStreamUnavailableError(
          `SSE 掃描串流不可用: ${res.status}`
        )
      }

      const reader = res.body?.getReader()
      if (!reader) {
        throw new ScanStreamUnavailableError('SSE 掃描串流無有效回應內容')
      }

      const decoder = new globalThis.TextDecoder()
      let buffer = ''

      while (Date.now() - startedAt < timeoutMs) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const parsed = drainSseMessages(buffer)
        buffer = parsed.rest

        for (const message of parsed.messages) {
          if (message.id) {
            lastEventId = message.id
          }
          if (message.event === 'keepalive') continue

          const task = parseStreamTaskStatus(message.data)
          if (!task) continue
          onProgress?.(task.progress)

          if (task.status === 'completed') return
          if (task.status === 'failed') {
            throw new ScanTaskFailedError(
              task.errorMessage ?? '掃描失敗',
              task.errorCode ?? null,
              task.engineMode ?? null
            )
          }
        }
      }
    } catch (error) {
      if (error instanceof ScanTaskFailedError) throw error
      if (isAbortError(error)) {
        throw new Error(`掃描任務逾時（>${Math.ceil(timeoutMs / 1000)} 秒）`)
      }
      if (!isRetryableSseError(error)) {
        throw new ScanStreamUnavailableError(
          error instanceof Error ? error.message : 'SSE 掃描串流失敗'
        )
      }
    } finally {
      clearTimeout(timeout)
    }

    const retryDelay =
      SSE_RETRY_DELAYS_MS[Math.min(retryCount, SSE_RETRY_DELAYS_MS.length - 1)]
    retryCount += 1
    await sleep(
      Math.min(retryDelay, Math.max(200, timeoutMs - (Date.now() - startedAt)))
    )
  }

  throw new Error(`掃描任務逾時（>${Math.ceil(timeoutMs / 1000)} 秒）`)
}

async function waitUntilDoneViaPolling(
  base: string,
  taskId: string,
  startedAt: number,
  timeoutMs: number,
  intervalMs: number,
  onProgress?: (progress: number) => void
): Promise<void> {
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(intervalMs)

    const res = await fetch(`${base}/api/scan/status/${taskId}`)
    if (!res.ok) continue

    const task = (await res.json()) as ScanTaskStatus

    onProgress?.(task.progress)

    if (task.status === 'completed') return
    if (task.status === 'failed') {
      throw new ScanTaskFailedError(
        task.errorMessage ?? '掃描失敗',
        task.errorCode ?? null,
        task.engineMode ?? null
      )
    }
  }

  throw new Error(`掃描任務逾時（>${Math.ceil(timeoutMs / 1000)} 秒）`)
}

interface ParsedSseMessage {
  id?: string
  event?: string
  data: string
}

function drainSseMessages(payload: string): {
  messages: ParsedSseMessage[]
  rest: string
} {
  const normalized = payload.replace(/\r\n/g, '\n')
  const messages: ParsedSseMessage[] = []
  let cursor = 0

  while (true) {
    const separator = normalized.indexOf('\n\n', cursor)
    if (separator === -1) break
    const raw = normalized.slice(cursor, separator)
    cursor = separator + 2

    let id: string | undefined
    let event: string | undefined
    const dataLines: string[] = []

    for (const line of raw.split('\n')) {
      if (!line || line.startsWith(':')) continue
      const colon = line.indexOf(':')
      const field = colon === -1 ? line : line.slice(0, colon)
      const rawValue = colon === -1 ? '' : line.slice(colon + 1)
      const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue

      if (field === 'id') {
        id = value
      } else if (field === 'event') {
        event = value
      } else if (field === 'data') {
        dataLines.push(value)
      }
    }

    if (dataLines.length === 0) continue
    messages.push({ id, event, data: dataLines.join('\n') })
  }

  return { messages, rest: normalized.slice(cursor) }
}

function parseStreamTaskStatus(raw: string): ScanTaskStatus | null {
  try {
    return JSON.parse(raw) as ScanTaskStatus
  } catch {
    return null
  }
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('掃描任務逾時')
}

function isRetryableSseError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (/SSE 掃描串流不可用: 404/.test(error.message)) return false
  if (/SSE 掃描串流無有效回應內容/.test(error.message)) return false
  return true
}

/**
 * 取得指定檔案的漏洞列表
 */
export async function fetchFileVulnerabilities(
  baseUrl: string,
  filePath: string
): Promise<Vulnerability[]> {
  const base = baseUrl.replace(/\/+$/, '')
  const params = new URLSearchParams({
    filePath,
    status: 'open',
    pageSize: '100',
  })
  const res = await fetch(`${base}/api/vulnerabilities?${params.toString()}`)
  if (!res.ok) return []

  const data = (await res.json()) as { items: Vulnerability[] }
  return data.items ?? []
}

/**
 * 取得所有開放漏洞
 */
export async function fetchAllOpenVulnerabilities(
  baseUrl: string
): Promise<Vulnerability[]> {
  const base = baseUrl.replace(/\/+$/, '')
  const params = new URLSearchParams({ status: 'open', pageSize: '100' })
  const res = await fetch(`${base}/api/vulnerabilities?${params.toString()}`)
  if (!res.ok) return []

  const data = (await res.json()) as { items: Vulnerability[] }
  return data.items ?? []
}

/**
 * 忽略指定漏洞（PATCH 更新狀態為 ignored）
 */
export async function ignoreVulnerability(
  baseUrl: string,
  vulnId: string
): Promise<boolean> {
  return updateVulnerabilityStatus(baseUrl, vulnId, 'ignored')
}

/**
 * 更新指定漏洞狀態（open / fixed / ignored）
 */
export async function updateVulnerabilityStatus(
  baseUrl: string,
  vulnId: string,
  status: Vulnerability['status']
): Promise<boolean> {
  const base = baseUrl.replace(/\/+$/, '')
  const res = await fetch(`${base}/api/vulnerabilities/${vulnId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
  return res.ok
}

/**
 * 取得單一漏洞詳情
 */
export async function fetchVulnerabilityById(
  baseUrl: string,
  vulnId: string
): Promise<Vulnerability | null> {
  const base = baseUrl.replace(/\/+$/, '')
  const res = await fetch(`${base}/api/vulnerabilities/${vulnId}`)
  if (!res.ok) return null

  const data = (await res.json()) as Vulnerability
  return data
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

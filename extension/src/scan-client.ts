import type { Vulnerability } from './types'

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
}

/** 掃描任務狀態 */
interface ScanTaskStatus {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  errorMessage?: string | null
}

/** 進行中的掃描請求去重：key = 檔案路徑排序後的組合 */
const inflightRequests = new Map<string, Promise<string>>()

/**
 * 計算掃描請求的去重鍵
 */
function scanDedupeKey(files: ScanFileInput[]): string {
  return files
    .map((f) => f.path)
    .sort()
    .join('|')
}

/**
 * 觸發掃描並回傳 taskId（含請求去重）
 *
 * 若相同檔案組合的掃描正在進行中，直接回傳既有 Promise。
 */
export async function triggerScan(
  baseUrl: string,
  files: ScanFileInput[],
  options: ScanOptions,
): Promise<string> {
  const key = scanDedupeKey(files)
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
  options: ScanOptions,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/scan`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files,
      depth: options.depth,
      includeLlmScan: options.includeLlmScan ?? false,
    }),
  })

  if (!res.ok) {
    throw new Error(`掃描 API 錯誤: ${res.status}`)
  }

  const data = (await res.json()) as { taskId: string }
  return data.taskId
}


/**
 * 輪詢掃描任務直到完成或失敗
 */
export async function pollUntilDone(
  baseUrl: string,
  taskId: string,
  onProgress?: (progress: number) => void,
  maxAttempts = 60,
  intervalMs = 1000,
): Promise<void> {
  const base = baseUrl.replace(/\/+$/, '')

  for (let i = 0; i < maxAttempts; i++) {
    await sleep(intervalMs)

    const res = await fetch(`${base}/api/scan/status/${taskId}`)
    if (!res.ok) continue

    const task = (await res.json()) as ScanTaskStatus

    onProgress?.(task.progress)

    if (task.status === 'completed') return
    if (task.status === 'failed') {
      throw new Error(task.errorMessage ?? '掃描失敗')
    }
  }

  throw new Error('掃描任務逾時')
}

/**
 * 取得指定檔案的漏洞列表
 */
export async function fetchFileVulnerabilities(
  baseUrl: string,
  filePath: string,
): Promise<Vulnerability[]> {
  const base = baseUrl.replace(/\/+$/, '')
  const params = new URLSearchParams({ filePath, status: 'open', pageSize: '100' })
  const res = await fetch(`${base}/api/vulnerabilities?${params.toString()}`)
  if (!res.ok) return []

  const data = (await res.json()) as { items: Vulnerability[] }
  return data.items ?? []
}

/**
 * 取得所有開放漏洞
 */
export async function fetchAllOpenVulnerabilities(
  baseUrl: string,
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
  vulnId: string,
): Promise<boolean> {
  return updateVulnerabilityStatus(baseUrl, vulnId, 'ignored')
}

/**
 * 更新指定漏洞狀態（open / fixed / ignored）
 */
export async function updateVulnerabilityStatus(
  baseUrl: string,
  vulnId: string,
  status: Vulnerability['status'],
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
  vulnId: string,
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

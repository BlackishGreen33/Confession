import type { ScanEngineMode, ScanErrorCode } from '@/libs/types'

export interface ScanProgressEvent {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  totalFiles: number
  scannedFiles: number
  engineMode: ScanEngineMode
  fallbackUsed: boolean
  fallbackFrom?: 'agentic'
  fallbackTo?: 'baseline'
  fallbackReason?: string
  errorMessage: string | null
  errorCode: ScanErrorCode | null
  createdAt: string
  updatedAt: string
}

type ProgressListener = (event: ScanProgressEvent) => void

const listenersByTaskId = new Map<string, Set<ProgressListener>>()
const latestEventByTaskId = new Map<string, ScanProgressEvent>()
let latestUpdatedAtMs = 0
let latestTaskId: string | null = null

function cloneProgressEvent(event: ScanProgressEvent): ScanProgressEvent {
  return {
    ...event,
  }
}

export function rememberScanProgress(event: ScanProgressEvent): void {
  latestEventByTaskId.set(event.id, cloneProgressEvent(event))
  const updatedAtMs = Date.parse(event.updatedAt)
  if (!Number.isNaN(updatedAtMs) && updatedAtMs >= latestUpdatedAtMs) {
    latestUpdatedAtMs = updatedAtMs
    latestTaskId = event.id
  }
}

export function getLatestScanProgress(
  taskId: string
): ScanProgressEvent | null {
  const found = latestEventByTaskId.get(taskId)
  return found ? cloneProgressEvent(found) : null
}

export function getMostRecentScanProgress(): ScanProgressEvent | null {
  if (!latestTaskId) return null
  const found = latestEventByTaskId.get(latestTaskId)
  return found ? cloneProgressEvent(found) : null
}

export function resetScanProgressState(): void {
  listenersByTaskId.clear()
  latestEventByTaskId.clear()
  latestUpdatedAtMs = 0
  latestTaskId = null
}

export function subscribeScanProgress(
  taskId: string,
  listener: ProgressListener
): () => void {
  const listeners = listenersByTaskId.get(taskId) ?? new Set<ProgressListener>()
  listeners.add(listener)
  listenersByTaskId.set(taskId, listeners)

  return () => {
    const current = listenersByTaskId.get(taskId)
    if (!current) return
    current.delete(listener)
    if (current.size === 0) {
      listenersByTaskId.delete(taskId)
    }
  }
}

export function emitScanProgress(event: ScanProgressEvent): void {
  rememberScanProgress(event)

  const listeners = listenersByTaskId.get(event.id)
  if (!listeners || listeners.size === 0) return

  for (const listener of Array.from(listeners)) {
    try {
      listener(event)
    } catch {
      // 單一 listener 失敗不應影響其他訂閱者
    }
  }
}

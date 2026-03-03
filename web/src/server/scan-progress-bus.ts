import type { ScanEngineMode, ScanErrorCode } from '@/libs/types'

export interface ScanProgressEvent {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  progress: number
  totalFiles: number
  scannedFiles: number
  engineMode: ScanEngineMode
  errorMessage: string | null
  errorCode: ScanErrorCode | null
  createdAt: string
  updatedAt: string
}

type ProgressListener = (event: ScanProgressEvent) => void

const listenersByTaskId = new Map<string, Set<ProgressListener>>()

export function subscribeScanProgress(
  taskId: string,
  listener: ProgressListener,
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

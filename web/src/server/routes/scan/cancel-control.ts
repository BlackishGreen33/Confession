import { triggerAdviceEvaluation } from '@server/advice-gate'
import { computeScanFingerprint, inflightScans } from '@server/cache'
import { emitScanProgress } from '@server/scan-progress-bus'
import { storage } from '@server/storage'

import { SUPERSEDED_BY_NEW_SCAN_MESSAGE } from './constants'
import { toScanProgressEvent } from './progress-event'
import type { ScanBody } from './schema'

const cancelRequestedByTaskId = new Map<string, string>()

interface ActiveTaskRow {
  id: string
  progress: number
  scannedFiles: number
  engineMode: string
  fallbackUsed: boolean
  fallbackFrom: string | null
  fallbackTo: string | null
  fallbackReason: string | null
}

export class ScanCanceledError extends Error {
  constructor(message = '掃描已取消') {
    super(message)
    this.name = 'ScanCanceledError'
  }
}

export function requestScanCancel(taskId: string, reason: string): void {
  cancelRequestedByTaskId.set(taskId, reason)
}

export function clearScanCancel(taskId: string): void {
  cancelRequestedByTaskId.delete(taskId)
}

export function assertTaskNotCanceled(taskId: string): void {
  const reason = cancelRequestedByTaskId.get(taskId)
  if (!reason) return
  throw new ScanCanceledError(reason)
}

export function isScanCanceledError(err: unknown): err is ScanCanceledError {
  return err instanceof ScanCanceledError
}

export function clearInflightReferences(taskId: string): void {
  inflightScans.delete(taskId)
}

export function tryGetInflightTaskId(
  body: ScanBody,
  engineMode: 'baseline' | 'agentic'
): {
  fingerprint: string
  existingTaskId: string | undefined
} {
  const fingerprint = computeScanFingerprint(
    body.files,
    body.depth,
    body.forceRescan ?? false,
    engineMode
  )

  return {
    fingerprint,
    existingTaskId: inflightScans.get(fingerprint),
  }
}

export function registerInflightTask(
  taskId: string,
  fingerprint: string
): void {
  inflightScans.set(taskId, taskId)
  inflightScans.set(fingerprint, taskId)
}

export async function interruptSupersededScanTasks(): Promise<void> {
  try {
    const activeTasksRaw = await storage.scanTask.findMany({
      where: { status: { in: ['pending', 'running'] } },
      select: {
        id: true,
        progress: true,
        scannedFiles: true,
        engineMode: true,
        fallbackUsed: true,
        fallbackFrom: true,
        fallbackTo: true,
        fallbackReason: true,
      },
    })
    const activeTasks = activeTasksRaw as unknown as ActiveTaskRow[]
    if (activeTasks.length === 0) return

    for (const task of activeTasks) {
      requestScanCancel(task.id, SUPERSEDED_BY_NEW_SCAN_MESSAGE)

      const updateResult = await storage.scanTask.updateMany({
        where: { id: task.id, status: { in: ['pending', 'running'] } },
        data: {
          status: 'failed',
          progress: task.progress,
          scannedFiles: task.scannedFiles,
          engineMode: task.engineMode,
          errorCode: 'UNKNOWN',
          errorMessage: SUPERSEDED_BY_NEW_SCAN_MESSAGE,
          fallbackUsed: task.fallbackUsed,
          fallbackFrom: task.fallbackFrom,
          fallbackTo: task.fallbackTo,
          fallbackReason: task.fallbackReason,
        },
      })

      if (updateResult.count === 0) {
        clearScanCancel(task.id)
        continue
      }

      const failedTask = await storage.scanTask.findUnique({
        where: { id: task.id },
      })
      if (failedTask) {
        emitScanProgress(toScanProgressEvent(failedTask))
      }
      triggerAdviceEvaluation({
        sourceEvent: 'scan_failed',
        sourceTaskId: task.id,
      })

      clearInflightReferences(task.id)
    }
  } catch {
    // 不中斷新掃描建立流程，僅記錄舊任務中止失敗
  }
}

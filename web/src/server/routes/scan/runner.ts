import { triggerAdviceEvaluation } from '@server/advice-gate'
import { orchestrateAgentic } from '@server/agents/agentic/orchestrator'
import { orchestrate } from '@server/agents/orchestrator'
import type { LlmClientConfig } from '@server/llm/client'
import { emitScanProgress } from '@server/scan-progress-bus'
import { storage, type UpsertStorageMetrics } from '@server/storage'

import type { ScanEngineMode, ScanErrorCode } from '@/libs/types'

import {
  assertTaskNotCanceled,
  clearInflightReferences,
  clearScanCancel,
  isScanCanceledError,
} from './cancel-control'
import {
  NO_STORAGE_METRICS,
  PROGRESS_FLUSH_FILE_STEP,
  PROGRESS_FLUSH_INTERVAL_MS,
} from './constants'
import { toScanProgressEvent } from './progress-event'
import {
  buildLlmFailureMessage,
  isLlmAnalysisFailed,
  logLlmUsage,
} from './runner-llm'
import { reconcileWorkspaceSnapshotVulnerabilities } from './runner-reconcile'
import type { ScanBody } from './schema'

interface FallbackMetadata {
  fallbackUsed: boolean
  fallbackFrom: 'agentic' | null
  fallbackTo: 'baseline' | null
  fallbackReason: string | null
}

interface EngineAttemptOutcome {
  ok: boolean
  observedStableFingerprints: Set<string>
  storageMetrics: UpsertStorageMetrics
  errorCode?: ScanErrorCode
  errorMessage?: string
}

const NO_FALLBACK: FallbackMetadata = {
  fallbackUsed: false,
  fallbackFrom: null,
  fallbackTo: null,
  fallbackReason: null,
}

export async function runScan(
  taskId: string,
  body: ScanBody,
  fingerprint: string,
  requestedEngineMode: ScanEngineMode,
  llmConfig?: LlmClientConfig
): Promise<void> {
  const totalFiles = body.files.length
  const startedAt = Date.now()

  let activeEngineMode: ScanEngineMode = requestedEngineMode
  let fallbackMeta: FallbackMetadata = NO_FALLBACK

  let agenticAttemptCount = 0
  let agenticFailureCount = 0
  let baselineFallbackCount = 0
  let fallbackSucceeded = false
  const storageMetrics: UpsertStorageMetrics = { ...NO_STORAGE_METRICS }

  const mergeStorageMetrics = (next: UpsertStorageMetrics) => {
    storageMetrics.fs_write_ops_per_scan += next.fs_write_ops_per_scan
    storageMetrics.db_lock_wait_ms_p95 = Math.max(
      storageMetrics.db_lock_wait_ms_p95,
      next.db_lock_wait_ms_p95
    )
    storageMetrics.db_lock_hold_ms_p95 = Math.max(
      storageMetrics.db_lock_hold_ms_p95,
      next.db_lock_hold_ms_p95
    )
    storageMetrics.db_lock_timeout_count += next.db_lock_timeout_count
  }
  const assertNotCanceled = () => assertTaskNotCanceled(taskId)

  try {
    assertNotCanceled()

    if (requestedEngineMode === 'agentic') {
      agenticAttemptCount += 1
      const agenticOutcome = await executeEngineAttempt({
        taskId,
        body,
        engineMode: 'agentic',
        totalFiles,
        llmConfig,
        fallbackMeta,
        assertNotCanceled,
      })
      mergeStorageMetrics(agenticOutcome.storageMetrics)

      if (agenticOutcome.ok) {
        assertNotCanceled()
        await reconcileWorkspaceSnapshotVulnerabilities(
          taskId,
          body,
          assertNotCanceled,
          agenticOutcome.observedStableFingerprints
        )
        await markTaskCompleted(taskId, totalFiles, 'agentic', fallbackMeta)
        return
      }

      agenticFailureCount += 1
      baselineFallbackCount += 1

      fallbackMeta = {
        fallbackUsed: true,
        fallbackFrom: 'agentic',
        fallbackTo: 'baseline',
        fallbackReason: `Agentic 引擎失敗：${agenticOutcome.errorMessage ?? '未知錯誤'}`,
      }
      activeEngineMode = 'baseline'

      const fallbackStarted = await storage.scanTask.update({
        where: { id: taskId },
        data: {
          status: 'running',
          progress: 0,
          scannedFiles: 0,
          engineMode: 'baseline',
          errorCode: null,
          errorMessage: null,
          ...toFallbackUpdateData(fallbackMeta),
        },
      })
      emitScanProgress(toScanProgressEvent(fallbackStarted))

      const baselineOutcome = await executeEngineAttempt({
        taskId,
        body,
        engineMode: 'baseline',
        totalFiles,
        llmConfig,
        fallbackMeta,
        assertNotCanceled,
      })
      mergeStorageMetrics(baselineOutcome.storageMetrics)

      if (baselineOutcome.ok) {
        fallbackSucceeded = true
        assertNotCanceled()
        await reconcileWorkspaceSnapshotVulnerabilities(
          taskId,
          body,
          assertNotCanceled,
          baselineOutcome.observedStableFingerprints
        )
        await markTaskCompleted(taskId, totalFiles, 'baseline', fallbackMeta)
        return
      }

      const agenticFailure = agenticOutcome.errorMessage ?? '未知錯誤'
      const baselineFailure = baselineOutcome.errorMessage ?? '未知錯誤'
      fallbackMeta = {
        ...fallbackMeta,
        fallbackReason: `Agentic 失敗：${agenticFailure}；Baseline 失敗：${baselineFailure}`,
      }
      await markTaskFailed(
        taskId,
        totalFiles,
        'baseline',
        'AGENTIC_ENGINE_FAILED',
        `Agentic 失敗：${agenticFailure}；Baseline 回退失敗：${baselineFailure}`,
        fallbackMeta
      )
      return
    }

    const baselineOutcome = await executeEngineAttempt({
      taskId,
      body,
      engineMode: 'baseline',
      totalFiles,
      llmConfig,
      fallbackMeta,
      assertNotCanceled,
    })
    mergeStorageMetrics(baselineOutcome.storageMetrics)

    if (baselineOutcome.ok) {
      assertNotCanceled()
      await reconcileWorkspaceSnapshotVulnerabilities(
        taskId,
        body,
        assertNotCanceled,
        baselineOutcome.observedStableFingerprints
      )
      await markTaskCompleted(taskId, totalFiles, 'baseline', fallbackMeta)
      return
    }

    await markTaskFailed(
      taskId,
      totalFiles,
      'baseline',
      baselineOutcome.errorCode ?? 'UNKNOWN',
      baselineOutcome.errorMessage ?? '未知錯誤',
      fallbackMeta
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知錯誤'
    const errorCode: ScanErrorCode = isScanCanceledError(err)
      ? 'UNKNOWN'
      : activeEngineMode === 'agentic'
        ? 'AGENTIC_ENGINE_FAILED'
        : 'UNKNOWN'

    await markTaskFailed(
      taskId,
      totalFiles,
      activeEngineMode,
      errorCode,
      message,
      fallbackMeta
    )
  } finally {
    clearInflightReferences(taskId)
    clearScanCancel(taskId)

    const fallbackUsed = fallbackMeta.fallbackUsed
    process.stdout.write(
      `[Confession][EngineMetrics] ${JSON.stringify({
        taskId,
        requestedEngineMode,
        finalEngineMode: activeEngineMode,
        fallbackUsed,
        fallbackFrom: fallbackUsed ? fallbackMeta.fallbackFrom : null,
        fallbackTo: fallbackUsed ? fallbackMeta.fallbackTo : null,
        fallbackReason: fallbackUsed ? fallbackMeta.fallbackReason : null,
        agentic_attempt_count: agenticAttemptCount,
        agentic_failure_count: agenticFailureCount,
        baseline_fallback_count: baselineFallbackCount,
        fallback_success_rate:
          baselineFallbackCount > 0 ? Number(fallbackSucceeded) : null,
        fs_write_ops_per_scan: storageMetrics.fs_write_ops_per_scan,
        db_lock_wait_ms_p95: storageMetrics.db_lock_wait_ms_p95,
        db_lock_hold_ms_p95: storageMetrics.db_lock_hold_ms_p95,
        db_lock_timeout_count: storageMetrics.db_lock_timeout_count,
        scan_latency_ms: Date.now() - startedAt,
      })}\n`
    )
  }
}

async function executeEngineAttempt(params: {
  taskId: string
  body: ScanBody
  engineMode: ScanEngineMode
  totalFiles: number
  llmConfig?: LlmClientConfig
  fallbackMeta: FallbackMetadata
  assertNotCanceled: () => void
}): Promise<EngineAttemptOutcome> {
  const {
    taskId,
    body,
    engineMode,
    totalFiles,
    llmConfig,
    fallbackMeta,
    assertNotCanceled,
  } = params

  let completedFiles = 0
  let lastReportedCompleted = -1
  let pendingCompletedDelta = 0
  let lastProgressFlushAt = 0
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let flushPromise: Promise<void> | null = null

  async function flushRunningProgress(force = false): Promise<void> {
    assertNotCanceled()
    const normalized = Math.max(0, Math.min(totalFiles, completedFiles))
    if (!force && normalized === lastReportedCompleted) return

    if (flushPromise) {
      await flushPromise
      if (!force && normalized === lastReportedCompleted) return
    }

    flushPromise = (async () => {
      const progress =
        totalFiles > 0 ? Math.min(0.98, normalized / totalFiles) : 0.98
      try {
        const updated = await storage.scanTask.update({
          where: { id: taskId },
          data: {
            status: 'running',
            scannedFiles: normalized,
            progress,
            engineMode,
            errorCode: null,
            errorMessage: null,
            ...toFallbackUpdateData(fallbackMeta),
          },
        })
        emitScanProgress(toScanProgressEvent(updated))
        lastReportedCompleted = normalized
        pendingCompletedDelta = 0
        lastProgressFlushAt = Date.now()
      } catch {
        // 進度更新失敗不應中斷掃描主流程
      }
    })()

    await flushPromise
    flushPromise = null
  }

  function scheduleRunningProgressFlush(): void {
    if (flushTimer) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flushRunningProgress(false).catch(() => {
        // 取消或更新失敗由主流程處理，避免未處理 Promise 拋錯
      })
    }, PROGRESS_FLUSH_INTERVAL_MS)
  }

  async function drainRunningProgressFlush(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
    await flushRunningProgress(true)
  }

  async function updateRunningProgress(
    nextCompletedFiles: number
  ): Promise<void> {
    assertNotCanceled()
    const normalized = Math.max(0, Math.min(totalFiles, nextCompletedFiles))
    const previous = completedFiles
    completedFiles = normalized

    if (normalized > previous) {
      pendingCompletedDelta += normalized - previous
    }

    const shouldFlushImmediately =
      normalized === totalFiles ||
      pendingCompletedDelta >= PROGRESS_FLUSH_FILE_STEP ||
      Date.now() - lastProgressFlushAt >= PROGRESS_FLUSH_INTERVAL_MS

    if (shouldFlushImmediately) {
      await flushRunningProgress(false)
      return
    }

    scheduleRunningProgressFlush()
  }

  async function handleFilteredFiles(meta: {
    totalFiles: number
    changedFiles: number
  }): Promise<void> {
    assertNotCanceled()
    const skippedFiles = Math.max(0, meta.totalFiles - meta.changedFiles)
    await updateRunningProgress(skippedFiles)
  }

  async function handleFileCompleted(): Promise<void> {
    assertNotCanceled()
    await updateRunningProgress(completedFiles + 1)
  }

  assertNotCanceled()
  const started = await storage.scanTask.update({
    where: { id: taskId },
    data: {
      status: 'running',
      progress: 0,
      scannedFiles: 0,
      engineMode,
      errorCode: null,
      errorMessage: null,
      ...toFallbackUpdateData(fallbackMeta),
    },
  })
  emitScanProgress(toScanProgressEvent(started))

  try {
    assertNotCanceled()
    const result =
      engineMode === 'agentic'
        ? await orchestrateAgentic(
            {
              files: body.files,
              depth: body.depth,
              includeLlmScan: body.includeLlmScan,
              forceRescan: body.forceRescan ?? false,
              scanScope: body.scanScope,
              workspaceSnapshotComplete: body.workspaceSnapshotComplete,
              workspaceRoots: body.workspaceRoots,
              engineMode,
            },
            {
              llmConfig,
              taskId,
              onFilteredFiles: handleFilteredFiles,
              onFileCompleted: handleFileCompleted,
              assertNotCanceled,
            }
          )
        : await orchestrate(
            {
              files: body.files,
              depth: body.depth,
              includeLlmScan: body.includeLlmScan,
              forceRescan: body.forceRescan ?? false,
              scanScope: body.scanScope,
              workspaceSnapshotComplete: body.workspaceSnapshotComplete,
              workspaceRoots: body.workspaceRoots,
              engineMode,
            },
            {
              llmConfig,
              taskId,
              onFilteredFiles: handleFilteredFiles,
              onFileCompleted: handleFileCompleted,
              assertNotCanceled,
            }
          )

    assertNotCanceled()
    await drainRunningProgressFlush()
    logLlmUsage(taskId, engineMode, body.depth, result)

    if (isLlmAnalysisFailed(result.llmStats)) {
      return {
        ok: false,
        observedStableFingerprints: new Set(result.stableFingerprints),
        storageMetrics: result.storageMetrics,
        errorCode:
          engineMode === 'agentic'
            ? 'AGENTIC_ENGINE_FAILED'
            : 'LLM_ANALYSIS_FAILED',
        errorMessage: buildLlmFailureMessage(result.llmStats),
      }
    }

    return {
      ok: true,
      observedStableFingerprints: new Set(result.stableFingerprints),
      storageMetrics: result.storageMetrics,
    }
  } catch (err) {
    await drainRunningProgressFlush()
    if (isScanCanceledError(err)) {
      throw err
    }
    const message = err instanceof Error ? err.message : '未知錯誤'
    return {
      ok: false,
      observedStableFingerprints: new Set<string>(),
      storageMetrics: { ...NO_STORAGE_METRICS },
      errorCode: engineMode === 'agentic' ? 'AGENTIC_ENGINE_FAILED' : 'UNKNOWN',
      errorMessage: message,
    }
  }
}

async function markTaskCompleted(
  taskId: string,
  totalFiles: number,
  engineMode: ScanEngineMode,
  fallbackMeta: FallbackMetadata
): Promise<void> {
  const completed = await storage.scanTask.update({
    where: { id: taskId },
    data: {
      status: 'completed',
      progress: 1,
      scannedFiles: totalFiles,
      engineMode,
      errorCode: null,
      errorMessage: null,
      ...toFallbackUpdateData(fallbackMeta),
    },
  })
  emitScanProgress(toScanProgressEvent(completed))
  triggerAdviceEvaluation({
    sourceEvent: 'scan_completed',
    sourceTaskId: taskId,
  })
}

async function markTaskFailed(
  taskId: string,
  totalFiles: number,
  engineMode: ScanEngineMode,
  errorCode: ScanErrorCode,
  errorMessage: string,
  fallbackMeta: FallbackMetadata
): Promise<void> {
  const failed = await storage.scanTask.update({
    where: { id: taskId },
    data: {
      status: 'failed',
      progress: 1,
      scannedFiles: totalFiles,
      engineMode,
      errorCode,
      errorMessage,
      ...toFallbackUpdateData(fallbackMeta),
    },
  })
  emitScanProgress(toScanProgressEvent(failed))
  triggerAdviceEvaluation({ sourceEvent: 'scan_failed', sourceTaskId: taskId })
}

function toFallbackUpdateData(fallbackMeta: FallbackMetadata) {
  return {
    fallbackUsed: fallbackMeta.fallbackUsed,
    fallbackFrom: fallbackMeta.fallbackFrom,
    fallbackTo: fallbackMeta.fallbackTo,
    fallbackReason: fallbackMeta.fallbackReason,
  }
}

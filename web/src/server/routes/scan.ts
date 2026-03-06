import { zValidator } from '@hono/zod-validator';
import { triggerAdviceEvaluation } from '@server/advice-gate';
import { orchestrateAgenticBeta } from '@server/agents/agentic-beta/orchestrator';
import { orchestrate } from '@server/agents/orchestrator';
import { computeScanFingerprint, inflightScans } from '@server/cache';
import { prisma } from '@server/db';
import { configFromPlugin, type LlmClientConfig } from '@server/llm/client';
import {
  emitScanProgress,
  type ScanProgressEvent,
  subscribeScanProgress,
} from '@server/scan-progress-bus';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod/v4';

import type { ScanEngineMode, ScanErrorCode } from '@/libs/types';

/** POST /api/scan 請求 body schema */
const scanBodySchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
      language: z.string(),
    })
  ),
  depth: z.enum(['quick', 'standard', 'deep']).default('standard'),
  includeLlmScan: z.boolean().optional(),
  forceRescan: z.boolean().optional(),
  scanScope: z.enum(['file', 'workspace']).optional(),
  workspaceSnapshotComplete: z.boolean().optional(),
  workspaceRoots: z.array(z.string()).optional(),
  engineMode: z.enum(['baseline', 'agentic_beta']).optional(),
});

type ScanBody = z.infer<typeof scanBodySchema>;
type EngineExecutionResult =
  | Awaited<ReturnType<typeof orchestrate>>
  | Awaited<ReturnType<typeof orchestrateAgenticBeta>>;

interface FallbackMetadata {
  fallbackUsed: boolean;
  fallbackFrom: 'agentic_beta' | null;
  fallbackTo: 'baseline' | null;
  fallbackReason: string | null;
}

interface EngineAttemptOutcome {
  ok: boolean;
  errorCode?: ScanErrorCode;
  errorMessage?: string;
}

const NO_FALLBACK: FallbackMetadata = {
  fallbackUsed: false,
  fallbackFrom: null,
  fallbackTo: null,
  fallbackReason: null,
};

class ScanCanceledError extends Error {
  constructor(message = '掃描已取消') {
    super(message);
    this.name = 'ScanCanceledError';
  }
}

const cancelRequestedByTaskId = new Map<string, string>();
const USER_CANCELED_MESSAGE = '使用者已取消掃描';
const SUPERSEDED_BY_NEW_SCAN_MESSAGE = '新掃描任務已啟動，上一個掃描已中止';
const WORKSPACE_SNAPSHOT_AUTO_FIXED_MESSAGE =
  '來源檔案未出現在本次工作區快照，已自動標記為 fixed（可能已刪除或改名）';
const PROGRESS_FLUSH_INTERVAL_MS = 500;
const PROGRESS_FLUSH_FILE_STEP = 5;

export const scanRoutes = new Hono();

/**
 * POST /api/scan — 觸發掃描
 *
 * 建立 ScanTask 記錄後，背景執行 orchestrate，
 * 即時回傳 taskId 供前端輪詢進度。
 */
scanRoutes.post('/', zValidator('json', scanBodySchema), async (c) => {
  const body = c.req.valid('json');
  const runtime = await loadRuntimeConfigFromDb();
  const engineMode = resolveEngineMode(body.engineMode);

  // 請求去重：相同檔案內容 + depth + engineMode 的掃描直接回傳既有 taskId
  const fingerprint = computeScanFingerprint(
    body.files,
    body.depth,
    body.forceRescan ?? false,
    engineMode
  );
  const existingTaskId = inflightScans.get(fingerprint);

  if (existingTaskId) {
    const task = await prisma.scanTask.findUnique({
      where: { id: existingTaskId },
    });
    if (task && (task.status === 'pending' || task.status === 'running')) {
      return c.json(
        { taskId: existingTaskId, status: task.status, deduplicated: true },
        200
      );
    }
    clearInflightReferences(existingTaskId);
  }

  await interruptSupersededScanTasks();

  const task = await prisma.scanTask.create({
    data: {
      status: 'running',
      engineMode,
      totalFiles: body.files.length,
      scannedFiles: 0,
      progress: 0,
      errorCode: null,
      fallbackUsed: false,
      fallbackFrom: null,
      fallbackTo: null,
      fallbackReason: null,
    },
  });

  inflightScans.set(task.id, task.id);
  inflightScans.set(fingerprint, task.id);
  emitScanProgress(toScanProgressEvent(task));

  void runScan(task.id, body, fingerprint, engineMode, runtime.llmConfig);

  return c.json({ taskId: task.id, status: 'running' }, 201);
});

/**
 * GET /api/scan/status/:id — 查詢掃描進度
 */
scanRoutes.get('/status/:id', async (c) => {
  const id = c.req.param('id');

  const task = await prisma.scanTask.findUnique({ where: { id } });
  if (!task) {
    return c.json({ error: '掃描任務不存在' }, 404);
  }

  return c.json(toScanProgressEvent(task));
});

/**
 * POST /api/scan/cancel/:id — 取消進行中的掃描
 */
scanRoutes.post('/cancel/:id', async (c) => {
  const id = c.req.param('id');
  const task = await prisma.scanTask.findUnique({ where: { id } });
  if (!task) {
    return c.json({ error: '掃描任務不存在' }, 404);
  }

  if (task.status === 'completed' || task.status === 'failed') {
    return c.json({
      taskId: id,
      status: task.status,
      canceling: false,
      message: '任務已結束，無需取消',
    });
  }

  requestScanCancel(id, USER_CANCELED_MESSAGE);
  const canceledTask = await prisma.scanTask.update({
    where: { id },
    data: {
      status: 'failed',
      progress: task.progress,
      scannedFiles: task.scannedFiles,
      engineMode: task.engineMode,
      errorCode: 'UNKNOWN',
      errorMessage: USER_CANCELED_MESSAGE,
      fallbackUsed: task.fallbackUsed,
      fallbackFrom: task.fallbackFrom,
      fallbackTo: task.fallbackTo,
      fallbackReason: task.fallbackReason,
    },
  });
  emitScanProgress(toScanProgressEvent(canceledTask));
  triggerAdviceEvaluation({ sourceEvent: 'scan_failed', sourceTaskId: id });

  return c.json(
    {
      taskId: id,
      status: canceledTask.status,
      canceling: true,
      message: '已取消掃描任務',
    },
    202
  );
});

/**
 * GET /api/scan/stream/:id — SSE 即時進度推送
 */
scanRoutes.get('/stream/:id', async (c) => {
  const id = c.req.param('id');
  const task = await prisma.scanTask.findUnique({ where: { id } });
  if (!task) {
    return c.json({ error: '掃描任務不存在' }, 404);
  }

  c.header('Cache-Control', 'no-cache, no-transform');
  c.header('Connection', 'keep-alive');
  c.header('X-Accel-Buffering', 'no');

  return streamSSE(c, async (stream) => {
    const initial = toScanProgressEvent(task);
    await stream.writeSSE({ data: JSON.stringify(initial) });

    if (initial.status === 'completed' || initial.status === 'failed') {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      let unsubscribe: () => void = () => {};

      const finish = () => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve();
      };

      unsubscribe = subscribeScanProgress(id, (event) => {
        void (async () => {
          try {
            await stream.writeSSE({ data: JSON.stringify(event) });
          } catch {
            finish();
            return;
          }

          if (event.status === 'completed' || event.status === 'failed') {
            finish();
          }
        })();
      });

      stream.onAbort(() => {
        finish();
      });
    });
  });
});

/**
 * GET /api/scan/recent — 取得最近一次掃描摘要
 */
scanRoutes.get('/recent', async (c) => {
  const task = await prisma.scanTask.findFirst({
    orderBy: { updatedAt: 'desc' },
  });

  if (!task) {
    return c.json({ error: '尚無掃描記錄' }, 404);
  }

  return c.json(toScanProgressEvent(task));
});

/**
 * 背景掃描邏輯：呼叫 orchestrator 並更新 ScanTask 狀態。
 * 完成後清除去重快取。
 */
async function runScan(
  taskId: string,
  body: ScanBody,
  fingerprint: string,
  requestedEngineMode: ScanEngineMode,
  llmConfig?: LlmClientConfig
) {
  const totalFiles = body.files.length;
  const startedAt = Date.now();

  let activeEngineMode: ScanEngineMode = requestedEngineMode;
  let fallbackMeta: FallbackMetadata = NO_FALLBACK;

  let agenticAttemptCount = 0;
  let agenticFailureCount = 0;
  let baselineFallbackCount = 0;
  let fallbackSucceeded = false;
  const assertNotCanceled = () => assertTaskNotCanceled(taskId);

  try {
    assertNotCanceled();

    if (requestedEngineMode === 'agentic_beta') {
      agenticAttemptCount += 1;
      const agenticOutcome = await executeEngineAttempt({
        taskId,
        body,
        engineMode: 'agentic_beta',
        totalFiles,
        llmConfig,
        fallbackMeta,
        assertNotCanceled,
      });

      if (agenticOutcome.ok) {
        assertNotCanceled();
        await reconcileWorkspaceSnapshotVulnerabilities(
          taskId,
          body,
          assertNotCanceled
        );
        await markTaskCompleted(
          taskId,
          totalFiles,
          'agentic_beta',
          fallbackMeta
        );
        return;
      }

      agenticFailureCount += 1;
      baselineFallbackCount += 1;

      fallbackMeta = {
        fallbackUsed: true,
        fallbackFrom: 'agentic_beta',
        fallbackTo: 'baseline',
        fallbackReason: `Agentic 引擎失敗：${agenticOutcome.errorMessage ?? '未知錯誤'}`,
      };
      activeEngineMode = 'baseline';

      const fallbackStarted = await prisma.scanTask.update({
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
      });
      emitScanProgress(toScanProgressEvent(fallbackStarted));

      const baselineOutcome = await executeEngineAttempt({
        taskId,
        body,
        engineMode: 'baseline',
        totalFiles,
        llmConfig,
        fallbackMeta,
        assertNotCanceled,
      });

      if (baselineOutcome.ok) {
        fallbackSucceeded = true;
        assertNotCanceled();
        await reconcileWorkspaceSnapshotVulnerabilities(
          taskId,
          body,
          assertNotCanceled
        );
        await markTaskCompleted(taskId, totalFiles, 'baseline', fallbackMeta);
        return;
      }

      const agenticFailure = agenticOutcome.errorMessage ?? '未知錯誤';
      const baselineFailure = baselineOutcome.errorMessage ?? '未知錯誤';
      await markTaskFailed(
        taskId,
        totalFiles,
        'baseline',
        'BETA_ENGINE_FAILED',
        `Agentic 失敗：${agenticFailure}；Baseline 回退失敗：${baselineFailure}`,
        {
          ...fallbackMeta,
          fallbackReason: `Agentic 失敗：${agenticFailure}；Baseline 失敗：${baselineFailure}`,
        }
      );
      return;
    }

    const baselineOutcome = await executeEngineAttempt({
      taskId,
      body,
      engineMode: 'baseline',
      totalFiles,
      llmConfig,
      fallbackMeta,
      assertNotCanceled,
    });

    if (baselineOutcome.ok) {
      assertNotCanceled();
      await reconcileWorkspaceSnapshotVulnerabilities(
        taskId,
        body,
        assertNotCanceled
      );
      await markTaskCompleted(taskId, totalFiles, 'baseline', fallbackMeta);
      return;
    }

    await markTaskFailed(
      taskId,
      totalFiles,
      'baseline',
      baselineOutcome.errorCode ?? 'UNKNOWN',
      baselineOutcome.errorMessage ?? '未知錯誤',
      fallbackMeta
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知錯誤';
    const errorCode: ScanErrorCode = isScanCanceledError(err)
      ? 'UNKNOWN'
      : activeEngineMode === 'agentic_beta'
        ? 'BETA_ENGINE_FAILED'
        : 'UNKNOWN';

    await markTaskFailed(
      taskId,
      totalFiles,
      activeEngineMode,
      errorCode,
      message,
      fallbackMeta
    );
  } finally {
    inflightScans.delete(fingerprint);
    clearInflightReferences(taskId);
    clearScanCancel(taskId);

    const fallbackUsed = fallbackMeta.fallbackUsed;
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
        scan_latency_ms: Date.now() - startedAt,
      })}\n`
    );
  }
}

async function executeEngineAttempt(params: {
  taskId: string;
  body: ScanBody;
  engineMode: ScanEngineMode;
  totalFiles: number;
  llmConfig?: LlmClientConfig;
  fallbackMeta: FallbackMetadata;
  assertNotCanceled: () => void;
}): Promise<EngineAttemptOutcome> {
  const {
    taskId,
    body,
    engineMode,
    totalFiles,
    llmConfig,
    fallbackMeta,
    assertNotCanceled,
  } = params;

  let completedFiles = 0;
  let lastReportedCompleted = -1;
  let pendingCompletedDelta = 0;
  let lastProgressFlushAt = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<void> | null = null;

  async function flushRunningProgress(force = false): Promise<void> {
    assertNotCanceled();
    const normalized = Math.max(0, Math.min(totalFiles, completedFiles));
    if (!force && normalized === lastReportedCompleted) return;

    if (flushPromise) {
      await flushPromise;
      if (!force && normalized === lastReportedCompleted) return;
    }

    flushPromise = (async () => {
      const progress =
        totalFiles > 0 ? Math.min(0.98, normalized / totalFiles) : 0.98;
      try {
        const updated = await prisma.scanTask.update({
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
        });
        emitScanProgress(toScanProgressEvent(updated));
        lastReportedCompleted = normalized;
        pendingCompletedDelta = 0;
        lastProgressFlushAt = Date.now();
      } catch {
        // 進度更新失敗不應中斷掃描主流程
      }
    })();

    await flushPromise;
    flushPromise = null;
  }

  function scheduleRunningProgressFlush(): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushRunningProgress(false).catch(() => {
        // 取消或更新失敗由主流程處理，避免未處理 Promise 拋錯
      });
    }, PROGRESS_FLUSH_INTERVAL_MS);
  }

  async function drainRunningProgressFlush(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await flushRunningProgress(true);
  }

  async function updateRunningProgress(
    nextCompletedFiles: number
  ): Promise<void> {
    assertNotCanceled();
    const normalized = Math.max(0, Math.min(totalFiles, nextCompletedFiles));
    const previous = completedFiles;
    completedFiles = normalized;

    if (normalized > previous) {
      pendingCompletedDelta += normalized - previous;
    }

    const shouldFlushImmediately =
      normalized === totalFiles ||
      pendingCompletedDelta >= PROGRESS_FLUSH_FILE_STEP ||
      Date.now() - lastProgressFlushAt >= PROGRESS_FLUSH_INTERVAL_MS;

    if (shouldFlushImmediately) {
      await flushRunningProgress(false);
      return;
    }

    scheduleRunningProgressFlush();
  }

  async function handleFilteredFiles(meta: {
    totalFiles: number;
    changedFiles: number;
  }): Promise<void> {
    assertNotCanceled();
    const skippedFiles = Math.max(0, meta.totalFiles - meta.changedFiles);
    await updateRunningProgress(skippedFiles);
  }

  async function handleFileCompleted(): Promise<void> {
    assertNotCanceled();
    await updateRunningProgress(completedFiles + 1);
  }

  assertNotCanceled();
  const started = await prisma.scanTask.update({
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
  });
  emitScanProgress(toScanProgressEvent(started));

  try {
    assertNotCanceled();
    const result =
      engineMode === 'agentic_beta'
        ? await orchestrateAgenticBeta(
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
              onFilteredFiles: handleFilteredFiles,
              onFileCompleted: handleFileCompleted,
              assertNotCanceled,
            }
          );

    assertNotCanceled();
    await drainRunningProgressFlush();
    logLlmUsage(taskId, engineMode, body.depth, result);

    if (isLlmAnalysisFailed(result.llmStats)) {
      return {
        ok: false,
        errorCode:
          engineMode === 'agentic_beta'
            ? 'BETA_ENGINE_FAILED'
            : 'LLM_ANALYSIS_FAILED',
        errorMessage: buildLlmFailureMessage(result.llmStats),
      };
    }

    return { ok: true };
  } catch (err) {
    await drainRunningProgressFlush();
    if (isScanCanceledError(err)) {
      throw err;
    }
    const message = err instanceof Error ? err.message : '未知錯誤';
    return {
      ok: false,
      errorCode:
        engineMode === 'agentic_beta' ? 'BETA_ENGINE_FAILED' : 'UNKNOWN',
      errorMessage: message,
    };
  }
}

function logLlmUsage(
  taskId: string,
  engineMode: ScanEngineMode,
  depth: ScanBody['depth'],
  result: EngineExecutionResult
): void {
  process.stdout.write(
    `[Confession][LLMUsage] ${JSON.stringify({
      taskId,
      engineMode,
      depth,
      requestCount: result.llmStats.requestCount,
      cacheHits: result.llmStats.cacheHits,
      promptTokens: result.llmStats.promptTokens,
      completionTokens: result.llmStats.completionTokens,
      totalTokens: result.llmStats.totalTokens,
      skippedByPolicy: result.llmStats.skippedByPolicy,
      processedFiles: result.llmStats.processedFiles,
      successfulFiles: result.llmStats.successfulFiles,
      requestFailures: result.llmStats.requestFailures,
      parseFailures: result.llmStats.parseFailures,
      failureKinds: result.llmStats.failureKinds,
      agenticTraceCount:
        'agenticTrace' in result && Array.isArray(result.agenticTrace)
          ? result.agenticTrace.length
          : 0,
    })}\n`
  );

  if ('agenticTrace' in result && Array.isArray(result.agenticTrace)) {
    process.stdout.write(
      `[Confession][AgenticTrace] ${JSON.stringify({
        taskId,
        engineMode,
        traces: result.agenticTrace,
      })}\n`
    );
  }
}

async function markTaskCompleted(
  taskId: string,
  totalFiles: number,
  engineMode: ScanEngineMode,
  fallbackMeta: FallbackMetadata
): Promise<void> {
  const completed = await prisma.scanTask.update({
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
  });
  emitScanProgress(toScanProgressEvent(completed));
  triggerAdviceEvaluation({
    sourceEvent: 'scan_completed',
    sourceTaskId: taskId,
  });
}

async function markTaskFailed(
  taskId: string,
  totalFiles: number,
  engineMode: ScanEngineMode,
  errorCode: ScanErrorCode,
  errorMessage: string,
  fallbackMeta: FallbackMetadata
): Promise<void> {
  const failed = await prisma.scanTask.update({
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
  });
  emitScanProgress(toScanProgressEvent(failed));
  triggerAdviceEvaluation({ sourceEvent: 'scan_failed', sourceTaskId: taskId });
}

async function reconcileWorkspaceSnapshotVulnerabilities(
  taskId: string,
  body: ScanBody,
  assertNotCanceled: () => void
): Promise<void> {
  if (body.scanScope !== 'workspace') return;
  if (body.workspaceSnapshotComplete === false) {
    process.stdout.write(
      `[Confession][WorkspaceReconcile] ${JSON.stringify({
        taskId,
        skipped: true,
        reason: 'workspace_snapshot_incomplete',
      })}\n`
    );
    return;
  }

  const workspaceRoots = normalizeWorkspaceRoots(body.workspaceRoots);
  if (workspaceRoots.length === 0) {
    process.stdout.write(
      `[Confession][WorkspaceReconcile] ${JSON.stringify({
        taskId,
        skipped: true,
        reason: 'missing_workspace_roots',
      })}\n`
    );
    return;
  }

  const filePathSet = new Set(body.files.map((file) => file.path));
  if (filePathSet.size === 0) return;

  try {
    assertNotCanceled();
    const openVulns = await prisma.vulnerability.findMany({
      where: {
        status: 'open',
        OR: workspaceRoots.map((root) => ({ filePath: { startsWith: root } })),
      },
      select: {
        id: true,
        filePath: true,
        humanStatus: true,
      },
    });

    const stale = openVulns.filter((item) => !filePathSet.has(item.filePath));
    if (stale.length === 0) {
      process.stdout.write(
        `[Confession][WorkspaceReconcile] ${JSON.stringify({
          taskId,
          skipped: true,
          reason: 'no_stale_vulnerability',
        })}\n`
      );
      return;
    }

    const staleIds = stale.map((item) => item.id);
    const staleById = new Map(stale.map((item) => [item.id, item]));

    assertNotCanceled();
    try {
      await prisma.$transaction(async (tx) => {
        const currentOpen = await tx.vulnerability.findMany({
          where: {
            id: { in: staleIds },
            status: 'open',
          },
          select: {
            id: true,
            humanStatus: true,
          },
        });

        if (currentOpen.length === 0) return;
        const currentIds = currentOpen.map((item) => item.id);

        await tx.vulnerability.updateMany({
          where: {
            id: { in: currentIds },
            status: 'open',
          },
          data: {
            status: 'fixed',
          },
        });

        await tx.vulnerabilityEvent.createMany({
          data: currentOpen.map((item) => ({
            vulnerabilityId: item.id,
            eventType: 'status_changed',
            message: WORKSPACE_SNAPSHOT_AUTO_FIXED_MESSAGE,
            fromStatus: 'open',
            toStatus: 'fixed',
            fromHumanStatus: item.humanStatus,
            toHumanStatus: item.humanStatus,
          })),
        });
      });
    } catch (err) {
      if (!isMissingEventsTableError(err)) throw err;
      await prisma.vulnerability.updateMany({
        where: {
          id: { in: staleIds },
          status: 'open',
        },
        data: {
          status: 'fixed',
        },
      });
    }

    process.stdout.write(
      `[Confession][WorkspaceReconcile] ${JSON.stringify({
        taskId,
        skipped: false,
        autoFixedCount: staleIds.length,
        staleFileSamples: Array.from(
          new Set(
            staleIds
              .map((id) => staleById.get(id)?.filePath)
              .filter((value): value is string => typeof value === 'string')
          )
        ).slice(0, 5),
      })}\n`
    );
  } catch (err) {
    // 收斂失敗不應影響主掃描完成，僅記錄以供追查。
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(
      `[Confession][WorkspaceReconcile] ${JSON.stringify({
        taskId,
        skipped: true,
        reason: 'reconcile_failed',
        message,
      })}\n`
    );
  }
}

function toFallbackUpdateData(fallbackMeta: FallbackMetadata) {
  return {
    fallbackUsed: fallbackMeta.fallbackUsed,
    fallbackFrom: fallbackMeta.fallbackFrom,
    fallbackTo: fallbackMeta.fallbackTo,
    fallbackReason: fallbackMeta.fallbackReason,
  };
}

function requestScanCancel(taskId: string, reason: string): void {
  cancelRequestedByTaskId.set(taskId, reason);
}

function clearScanCancel(taskId: string): void {
  cancelRequestedByTaskId.delete(taskId);
}

function assertTaskNotCanceled(taskId: string): void {
  const reason = cancelRequestedByTaskId.get(taskId);
  if (!reason) return;
  throw new ScanCanceledError(reason);
}

function isScanCanceledError(err: unknown): err is ScanCanceledError {
  return err instanceof ScanCanceledError;
}

async function interruptSupersededScanTasks(): Promise<void> {
  try {
    const activeTasks = await prisma.scanTask.findMany({
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
    });
    if (activeTasks.length === 0) return;

    for (const task of activeTasks) {
      requestScanCancel(task.id, SUPERSEDED_BY_NEW_SCAN_MESSAGE);

      const updateResult = await prisma.scanTask.updateMany({
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
      });

      if (updateResult.count === 0) {
        clearScanCancel(task.id);
        continue;
      }

      const failedTask = await prisma.scanTask.findUnique({
        where: { id: task.id },
      });
      if (failedTask) {
        emitScanProgress(toScanProgressEvent(failedTask));
      }
      triggerAdviceEvaluation({
        sourceEvent: 'scan_failed',
        sourceTaskId: task.id,
      });

      clearInflightReferences(task.id);
    }
  } catch {
    // 不中斷新掃描建立流程，僅記錄舊任務中止失敗
  }
}

function clearInflightReferences(taskId: string): void {
  inflightScans.delete(taskId);
}

function isLlmAnalysisFailed(stats: {
  processedFiles: number;
  successfulFiles: number;
  requestFailures: number;
  parseFailures: number;
}): boolean {
  if (stats.processedFiles === 0) return false;
  if (stats.successfulFiles > 0) return false;
  return stats.requestFailures > 0 || stats.parseFailures > 0;
}

function buildLlmFailureMessage(stats: {
  requestFailures: number;
  parseFailures: number;
  failureKinds: {
    quotaExceeded: number;
    unavailable: number;
    timeout: number;
    other: number;
  };
}): string {
  if (stats.failureKinds.quotaExceeded > 0) {
    return 'LLM 分析失敗：配額已用盡（429/RESOURCE_EXHAUSTED），請稍後重試或更換 API Key/方案';
  }

  const parts: string[] = [];
  if (stats.failureKinds.unavailable > 0)
    parts.push(`服務暫時不可用 ${stats.failureKinds.unavailable} 次`);
  if (stats.failureKinds.timeout > 0)
    parts.push(`請求逾時 ${stats.failureKinds.timeout} 次`);
  if (stats.failureKinds.other > 0)
    parts.push(`其他錯誤 ${stats.failureKinds.other} 次`);
  if (stats.requestFailures > 0)
    parts.push(`LLM 呼叫失敗 ${stats.requestFailures} 次`);
  if (stats.parseFailures > 0)
    parts.push(`LLM 回應解析失敗 ${stats.parseFailures} 次`);
  if (parts.length === 0) return 'LLM 分析失敗';
  return `LLM 分析失敗：${parts.join('，')}`;
}

function isMissingEventsTableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const maybeCode = (err as { code?: unknown }).code;
  const maybeMessage = (err as { message?: unknown }).message;
  const code = typeof maybeCode === 'string' ? maybeCode : '';
  const message = typeof maybeMessage === 'string' ? maybeMessage : '';
  return code === 'P2021' || /vulnerability_events/i.test(message);
}

function normalizeWorkspaceRoots(roots: string[] | undefined): string[] {
  if (!Array.isArray(roots)) return [];

  const normalized = roots
    .map((root) => root.trim())
    .filter((root) => root.length > 0)
    .map((root) => root.replace(/[\\/]$/, ''));

  return Array.from(new Set(normalized));
}

interface ScanTaskRecordLike {
  id: string;
  status: string;
  progress: number;
  totalFiles: number;
  scannedFiles: number;
  engineMode: string;
  fallbackUsed?: boolean | null;
  fallbackFrom?: string | null;
  fallbackTo?: string | null;
  fallbackReason?: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toScanProgressEvent(task: ScanTaskRecordLike): ScanProgressEvent {
  const fallbackUsed = Boolean(task.fallbackUsed);
  return {
    id: task.id,
    status: normalizeTaskStatus(task.status),
    progress: task.progress,
    totalFiles: task.totalFiles,
    scannedFiles: task.scannedFiles,
    engineMode: normalizeEngineMode(task.engineMode),
    fallbackUsed,
    fallbackFrom: fallbackUsed
      ? normalizeFallbackFrom(task.fallbackFrom ?? null)
      : undefined,
    fallbackTo: fallbackUsed
      ? normalizeFallbackTo(task.fallbackTo ?? null)
      : undefined,
    fallbackReason: fallbackUsed
      ? normalizeFallbackReason(task.fallbackReason ?? null)
      : undefined,
    errorMessage: task.errorMessage,
    errorCode: normalizeErrorCode(task.errorCode),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function normalizeTaskStatus(value: string): ScanProgressEvent['status'] {
  if (value === 'running' || value === 'completed' || value === 'failed')
    return value;
  return 'pending';
}

function normalizeEngineMode(value: string): ScanEngineMode {
  return value === 'agentic_beta' ? 'agentic_beta' : 'baseline';
}

function normalizeErrorCode(value: string | null): ScanErrorCode | null {
  if (value === 'BETA_ENGINE_FAILED') return value;
  if (value === 'LLM_ANALYSIS_FAILED') return value;
  if (value === 'UNKNOWN') return value;
  return null;
}

function normalizeFallbackFrom(
  value: string | null
): 'agentic_beta' | undefined {
  return value === 'agentic_beta' ? 'agentic_beta' : undefined;
}

function normalizeFallbackTo(value: string | null): 'baseline' | undefined {
  return value === 'baseline' ? 'baseline' : undefined;
}

function normalizeFallbackReason(value: string | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const persistedConfigSchema = z.object({
  llm: z
    .object({
      provider: z.enum(['gemini', 'nvidia']).optional(),
      apiKey: z.string().nullable().optional(),
      endpoint: z.string().nullable().optional(),
      model: z.string().nullable().optional(),
    })
    .optional(),
});

function resolveEngineMode(
  requested: ScanEngineMode | undefined
): ScanEngineMode {
  return requested ?? 'agentic_beta';
}

function normalizeOptional(
  value: string | null | undefined
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNvidiaModel(model: string | undefined): string | undefined {
  if (model !== 'deepseek-ai/deepseek-r1') return model;
  return 'qwen/qwen2.5-coder-32b-instruct';
}

async function loadRuntimeConfigFromDb(): Promise<{
  llmConfig?: LlmClientConfig;
}> {
  const row = await prisma.config.findUnique({ where: { id: 'default' } });
  if (!row) {
    return { llmConfig: undefined };
  }

  try {
    const parsed = persistedConfigSchema.safeParse(JSON.parse(row.data));
    if (!parsed.success || !parsed.data.llm) {
      return { llmConfig: undefined };
    }

    const provider = parsed.data.llm.provider ?? 'nvidia';
    const model = normalizeOptional(parsed.data.llm.model);

    return {
      llmConfig: configFromPlugin({
        provider,
        apiKey: normalizeOptional(parsed.data.llm.apiKey) ?? '',
        endpoint: normalizeOptional(parsed.data.llm.endpoint),
        model: provider === 'nvidia' ? normalizeNvidiaModel(model) : model,
      }),
    };
  } catch {
    return { llmConfig: undefined };
  }
}

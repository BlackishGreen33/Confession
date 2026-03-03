import { zValidator } from '@hono/zod-validator'
import { orchestrateAgenticBeta } from '@server/agents/agentic-beta/orchestrator'
import { orchestrate } from '@server/agents/orchestrator'
import { computeScanFingerprint, inflightScans } from '@server/cache'
import { prisma } from '@server/db'
import { configFromPlugin, type LlmClientConfig } from '@server/llm/client'
import {
  emitScanProgress,
  type ScanProgressEvent,
  subscribeScanProgress,
} from '@server/scan-progress-bus'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod/v4'

import type { ScanEngineMode, ScanErrorCode } from '@/libs/types'

/** POST /api/scan 請求 body schema */
const scanBodySchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      content: z.string(),
      language: z.string(),
    }),
  ),
  depth: z.enum(['quick', 'standard', 'deep']).default('standard'),
  includeLlmScan: z.boolean().optional(),
  forceRescan: z.boolean().optional(),
  scanScope: z.enum(['file', 'workspace']).optional(),
  engineMode: z.enum(['baseline', 'agentic_beta']).optional(),
})

export const scanRoutes = new Hono()

/**
 * POST /api/scan — 觸發掃描
 *
 * 建立 ScanTask 記錄後，背景執行 orchestrate，
 * 即時回傳 taskId 供前端輪詢進度。
 */
scanRoutes.post('/', zValidator('json', scanBodySchema), async (c) => {
  const body = c.req.valid('json')
  const runtime = await loadRuntimeConfigFromDb()
  const engineMode = resolveEngineMode(body.engineMode, runtime.betaAgenticEnabled)

  // 請求去重：相同檔案內容 + depth + engineMode 的掃描直接回傳既有 taskId
  const fingerprint = computeScanFingerprint(
    body.files,
    body.depth,
    body.forceRescan ?? false,
    engineMode,
  )
  const existingTaskId = inflightScans.get(fingerprint)

  if (existingTaskId) {
    const task = await prisma.scanTask.findUnique({ where: { id: existingTaskId } })
    if (task && (task.status === 'pending' || task.status === 'running')) {
      return c.json({ taskId: existingTaskId, status: task.status, deduplicated: true }, 200)
    }
    inflightScans.delete(fingerprint)
  }

  const task = await prisma.scanTask.create({
    data: {
      status: 'running',
      engineMode,
      totalFiles: body.files.length,
      scannedFiles: 0,
      progress: 0,
      errorCode: null,
    },
  })

  inflightScans.set(task.id, task.id)
  inflightScans.set(fingerprint, task.id)
  emitScanProgress(toScanProgressEvent(task))

  void runScan(task.id, body, fingerprint, engineMode, runtime.llmConfig)

  return c.json({ taskId: task.id, status: 'running' }, 201)
})

/**
 * GET /api/scan/status/:id — 查詢掃描進度
 */
scanRoutes.get('/status/:id', async (c) => {
  const id = c.req.param('id')

  const task = await prisma.scanTask.findUnique({ where: { id } })
  if (!task) {
    return c.json({ error: '掃描任務不存在' }, 404)
  }

  return c.json(toScanProgressEvent(task))
})

/**
 * GET /api/scan/stream/:id — SSE 即時進度推送
 */
scanRoutes.get('/stream/:id', async (c) => {
  const id = c.req.param('id')
  const task = await prisma.scanTask.findUnique({ where: { id } })
  if (!task) {
    return c.json({ error: '掃描任務不存在' }, 404)
  }

  c.header('Cache-Control', 'no-cache, no-transform')
  c.header('Connection', 'keep-alive')
  c.header('X-Accel-Buffering', 'no')

  return streamSSE(c, async (stream) => {
    const initial = toScanProgressEvent(task)
    await stream.writeSSE({ data: JSON.stringify(initial) })

    if (initial.status === 'completed' || initial.status === 'failed') {
      return
    }

    await new Promise<void>((resolve) => {
      let settled = false
      let unsubscribe: () => void = () => {}

      const finish = () => {
        if (settled) return
        settled = true
        unsubscribe()
        resolve()
      }

      unsubscribe = subscribeScanProgress(id, (event) => {
        void (async () => {
          try {
            await stream.writeSSE({ data: JSON.stringify(event) })
          } catch {
            finish()
            return
          }

          if (event.status === 'completed' || event.status === 'failed') {
            finish()
          }
        })()
      })

      stream.onAbort(() => {
        finish()
      })
    })
  })
})

/**
 * GET /api/scan/recent — 取得最近一次掃描摘要
 */
scanRoutes.get('/recent', async (c) => {
  const task = await prisma.scanTask.findFirst({
    orderBy: { updatedAt: 'desc' },
  })

  if (!task) {
    return c.json({ error: '尚無掃描記錄' }, 404)
  }

  return c.json(toScanProgressEvent(task))
})

/**
 * 背景掃描邏輯：呼叫 orchestrator 並更新 ScanTask 狀態。
 * 完成後清除去重快取。
 */
async function runScan(
  taskId: string,
  body: z.infer<typeof scanBodySchema>,
  fingerprint: string,
  engineMode: ScanEngineMode,
  llmConfig?: LlmClientConfig,
) {
  const totalFiles = body.files.length
  let completedFiles = 0
  let lastReportedCompleted = -1

  async function updateRunningProgress(nextCompletedFiles: number): Promise<void> {
    const normalized = Math.max(0, Math.min(totalFiles, nextCompletedFiles))
    completedFiles = normalized

    if (normalized === lastReportedCompleted) return
    lastReportedCompleted = normalized

    const progress = totalFiles > 0 ? Math.min(0.98, normalized / totalFiles) : 0.98
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
        },
      })
      emitScanProgress(toScanProgressEvent(updated))
    } catch {
      // 進度更新失敗不應中斷掃描主流程
    }
  }

  async function handleFilteredFiles(meta: { totalFiles: number; changedFiles: number }): Promise<void> {
    const skippedFiles = Math.max(0, meta.totalFiles - meta.changedFiles)
    await updateRunningProgress(skippedFiles)
  }

  async function handleFileCompleted(): Promise<void> {
    await updateRunningProgress(completedFiles + 1)
  }

  try {
    const started = await prisma.scanTask.update({
      where: { id: taskId },
      data: {
        status: 'running',
        progress: 0,
        scannedFiles: 0,
        engineMode,
        errorCode: null,
        errorMessage: null,
      },
    })
    emitScanProgress(toScanProgressEvent(started))

    const result =
      engineMode === 'agentic_beta'
        ? await orchestrateAgenticBeta(
            {
              files: body.files,
              depth: body.depth,
              includeLlmScan: body.includeLlmScan,
              forceRescan: body.forceRescan ?? false,
              scanScope: body.scanScope,
              engineMode,
            },
            {
              llmConfig,
              onFilteredFiles: handleFilteredFiles,
              onFileCompleted: handleFileCompleted,
            },
          )
        : await orchestrate(
            {
              files: body.files,
              depth: body.depth,
              includeLlmScan: body.includeLlmScan,
              forceRescan: body.forceRescan ?? false,
              scanScope: body.scanScope,
              engineMode,
            },
            {
              llmConfig,
              onFilteredFiles: handleFilteredFiles,
              onFileCompleted: handleFileCompleted,
            },
          )

    process.stdout.write(
      `[Confession][LLMUsage] ${JSON.stringify({
        taskId,
        engineMode,
        depth: body.depth,
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
      })}\n`,
    )

    if ('agenticTrace' in result && Array.isArray(result.agenticTrace)) {
      process.stdout.write(
        `[Confession][AgenticTrace] ${JSON.stringify({
          taskId,
          engineMode,
          traces: result.agenticTrace,
        })}\n`,
      )
    }

    if (isLlmAnalysisFailed(result.llmStats)) {
      const failed = await prisma.scanTask.update({
        where: { id: taskId },
        data: {
          status: 'failed',
          progress: 1,
          scannedFiles: totalFiles,
          errorCode: engineMode === 'agentic_beta' ? 'BETA_ENGINE_FAILED' : 'LLM_ANALYSIS_FAILED',
          errorMessage: buildLlmFailureMessage(result.llmStats),
        },
      })
      emitScanProgress(toScanProgressEvent(failed))
      inflightScans.delete(fingerprint)
      return
    }

    const completed = await prisma.scanTask.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        progress: 1,
        scannedFiles: totalFiles,
        errorCode: null,
      },
    })
    emitScanProgress(toScanProgressEvent(completed))

    inflightScans.delete(fingerprint)
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知錯誤'
    const failed = await prisma.scanTask.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        progress: 1,
        scannedFiles: totalFiles,
        errorMessage: message,
        errorCode: engineMode === 'agentic_beta' ? 'BETA_ENGINE_FAILED' : 'UNKNOWN',
      },
    })
    emitScanProgress(toScanProgressEvent(failed))

    inflightScans.delete(fingerprint)
  }
}

function isLlmAnalysisFailed(stats: {
  processedFiles: number
  successfulFiles: number
  requestFailures: number
  parseFailures: number
}): boolean {
  if (stats.processedFiles === 0) return false
  if (stats.successfulFiles > 0) return false
  return stats.requestFailures > 0 || stats.parseFailures > 0
}

function buildLlmFailureMessage(stats: {
  requestFailures: number
  parseFailures: number
  failureKinds: {
    quotaExceeded: number
    unavailable: number
    timeout: number
    other: number
  }
}): string {
  if (stats.failureKinds.quotaExceeded > 0) {
    return 'LLM 分析失敗：配額已用盡（429/RESOURCE_EXHAUSTED），請稍後重試或更換 API Key/方案'
  }

  const parts: string[] = []
  if (stats.failureKinds.unavailable > 0) parts.push(`服務暫時不可用 ${stats.failureKinds.unavailable} 次`)
  if (stats.failureKinds.timeout > 0) parts.push(`請求逾時 ${stats.failureKinds.timeout} 次`)
  if (stats.failureKinds.other > 0) parts.push(`其他錯誤 ${stats.failureKinds.other} 次`)
  if (stats.requestFailures > 0) parts.push(`LLM 呼叫失敗 ${stats.requestFailures} 次`)
  if (stats.parseFailures > 0) parts.push(`LLM 回應解析失敗 ${stats.parseFailures} 次`)
  if (parts.length === 0) return 'LLM 分析失敗'
  return `LLM 分析失敗：${parts.join('，')}`
}

interface ScanTaskRecordLike {
  id: string
  status: string
  progress: number
  totalFiles: number
  scannedFiles: number
  engineMode: string
  errorMessage: string | null
  errorCode: string | null
  createdAt: Date
  updatedAt: Date
}

function toScanProgressEvent(task: ScanTaskRecordLike): ScanProgressEvent {
  return {
    id: task.id,
    status: normalizeTaskStatus(task.status),
    progress: task.progress,
    totalFiles: task.totalFiles,
    scannedFiles: task.scannedFiles,
    engineMode: normalizeEngineMode(task.engineMode),
    errorMessage: task.errorMessage,
    errorCode: normalizeErrorCode(task.errorCode),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

function normalizeTaskStatus(value: string): ScanProgressEvent['status'] {
  if (value === 'running' || value === 'completed' || value === 'failed') return value
  return 'pending'
}

function normalizeEngineMode(value: string): ScanEngineMode {
  return value === 'agentic_beta' ? 'agentic_beta' : 'baseline'
}

function normalizeErrorCode(value: string | null): ScanErrorCode | null {
  if (value === 'BETA_ENGINE_FAILED') return value
  if (value === 'LLM_ANALYSIS_FAILED') return value
  if (value === 'UNKNOWN') return value
  return null
}

const persistedConfigSchema = z.object({
  llm: z
    .object({
      provider: z.enum(['gemini', 'nvidia']).optional(),
      apiKey: z.string().optional(),
      endpoint: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
  analysis: z
    .object({
      betaAgenticEnabled: z.boolean().optional(),
    })
    .optional(),
})

function resolveEngineMode(
  requested: ScanEngineMode | undefined,
  betaAgenticEnabled: boolean,
): ScanEngineMode {
  if (requested) return requested
  return betaAgenticEnabled ? 'agentic_beta' : 'baseline'
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeNvidiaModel(model: string | undefined): string | undefined {
  if (model !== 'deepseek-ai/deepseek-r1') return model
  return 'qwen/qwen2.5-coder-32b-instruct'
}

async function loadRuntimeConfigFromDb(): Promise<{
  llmConfig?: LlmClientConfig
  betaAgenticEnabled: boolean
}> {
  const row = await prisma.config.findUnique({ where: { id: 'default' } })
  if (!row) {
    return { llmConfig: undefined, betaAgenticEnabled: false }
  }

  try {
    const parsed = persistedConfigSchema.safeParse(JSON.parse(row.data))
    if (!parsed.success) {
      return { llmConfig: undefined, betaAgenticEnabled: false }
    }

    const betaAgenticEnabled = parsed.data.analysis?.betaAgenticEnabled ?? false

    if (!parsed.data.llm) {
      return { llmConfig: undefined, betaAgenticEnabled }
    }

    const provider = parsed.data.llm.provider ?? 'nvidia'
    const model = normalizeOptional(parsed.data.llm.model)

    return {
      betaAgenticEnabled,
      llmConfig: configFromPlugin({
        provider,
        apiKey: normalizeOptional(parsed.data.llm.apiKey) ?? '',
        endpoint: normalizeOptional(parsed.data.llm.endpoint),
        model: provider === 'nvidia' ? normalizeNvidiaModel(model) : model,
      }),
    }
  } catch {
    return { llmConfig: undefined, betaAgenticEnabled: false }
  }
}

import { zValidator } from '@hono/zod-validator'
import { orchestrate } from '@server/agents/orchestrator'
import { computeScanFingerprint, inflightScans } from '@server/cache'
import { prisma } from '@server/db'
import { configFromPlugin, type GeminiClientConfig } from '@server/llm/gemini'
import { Hono } from 'hono'
import { z } from 'zod/v4'

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

  // 請求去重：相同檔案內容 + depth 的掃描直接回傳既有 taskId
  const fingerprint = computeScanFingerprint(body.files, body.depth, body.forceRescan ?? false)
  const existingTaskId = inflightScans.get(fingerprint)
  if (existingTaskId) {
    const task = await prisma.scanTask.findUnique({ where: { id: existingTaskId } })
    if (task && (task.status === 'pending' || task.status === 'running')) {
      return c.json({ taskId: existingTaskId, status: task.status, deduplicated: true }, 200)
    }
    // 已完成或失敗的任務，清除快取讓新請求通過
    inflightScans.delete(fingerprint)
  }

  // 建立掃描任務
  const task = await prisma.scanTask.create({
    data: {
      status: 'running',
      totalFiles: body.files.length,
      scannedFiles: 0,
      progress: 0,
    },
  })

  // 記錄進行中的掃描
  inflightScans.set(task.id, task.id)
  inflightScans.set(fingerprint, task.id)

  // 背景執行掃描，不阻塞回應
  void runScan(task.id, body, fingerprint)

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

  return c.json({
    id: task.id,
    status: task.status,
    progress: task.progress,
    totalFiles: task.totalFiles,
    scannedFiles: task.scannedFiles,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  })
})

/**
 * 背景掃描邏輯：呼叫 orchestrator 並更新 ScanTask 狀態。
 * 完成後清除去重快取。
 */
async function runScan(
  taskId: string,
  body: z.infer<typeof scanBodySchema>,
  fingerprint: string,
) {
  try {
    await prisma.scanTask.update({
      where: { id: taskId },
      data: { status: 'running', progress: 0.1 },
    })

    const geminiConfig = await loadGeminiConfigFromDb()
    const result = await orchestrate(
      {
        files: body.files,
        depth: body.depth,
        includeLlmScan: body.includeLlmScan,
        forceRescan: body.forceRescan ?? false,
        scanScope: body.scanScope,
      },
      { geminiConfig },
    )

    process.stdout.write(
      `[Confession][LLMUsage] ${JSON.stringify({
        taskId,
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
      })}\n`,
    )

    if (isLlmAnalysisFailed(result.llmStats)) {
      await prisma.scanTask.update({
        where: { id: taskId },
        data: {
          status: 'failed',
          progress: 1,
          scannedFiles: body.files.length,
          errorMessage: buildLlmFailureMessage(result.llmStats),
        },
      })
      inflightScans.delete(fingerprint)
      return result
    }

    await prisma.scanTask.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        progress: 1,
        scannedFiles: body.files.length,
      },
    })

    // 掃描完成，清除去重快取
    inflightScans.delete(fingerprint)

    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知錯誤'
    await prisma.scanTask.update({
      where: { id: taskId },
      data: { status: 'failed', errorMessage: message },
    })

    // 失敗也清除去重快取，允許重試
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
    return 'LLM 分析失敗：Gemini 配額已用盡（429/RESOURCE_EXHAUSTED），請稍後重試或更換 API Key/方案'
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

const persistedConfigSchema = z.object({
  llm: z
    .object({
      provider: z.literal('gemini').optional(),
      apiKey: z.string().optional(),
      endpoint: z.string().optional(),
      model: z.string().optional(),
    })
    .optional(),
})

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

async function loadGeminiConfigFromDb(): Promise<GeminiClientConfig | undefined> {
  const row = await prisma.config.findUnique({ where: { id: 'default' } })
  if (!row) return undefined

  try {
    const parsed = persistedConfigSchema.safeParse(JSON.parse(row.data))
    if (!parsed.success || !parsed.data.llm) return undefined

    return configFromPlugin({
      provider: 'gemini',
      apiKey: normalizeOptional(parsed.data.llm.apiKey) ?? '',
      endpoint: normalizeOptional(parsed.data.llm.endpoint),
      model: normalizeOptional(parsed.data.llm.model),
    })
  } catch {
    return undefined
  }
}

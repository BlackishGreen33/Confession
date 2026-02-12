import { zValidator } from '@hono/zod-validator'
import { orchestrate } from '@server/agents/orchestrator'
import { prisma } from '@server/db'
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

  // 建立掃描任務
  const task = await prisma.scanTask.create({
    data: {
      status: 'running',
      totalFiles: body.files.length,
      scannedFiles: 0,
      progress: 0,
    },
  })

  // 背景執行掃描，不阻塞回應
  void runScan(task.id, body)

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
 */
async function runScan(
  taskId: string,
  body: z.infer<typeof scanBodySchema>,
) {
  try {
    await prisma.scanTask.update({
      where: { id: taskId },
      data: { status: 'running', progress: 0.1 },
    })

    const result = await orchestrate({
      files: body.files,
      depth: body.depth,
      includeLlmScan: body.includeLlmScan,
    })

    await prisma.scanTask.update({
      where: { id: taskId },
      data: {
        status: 'completed',
        progress: 1,
        scannedFiles: body.files.length,
      },
    })

    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : '未知錯誤'
    await prisma.scanTask.update({
      where: { id: taskId },
      data: { status: 'failed', errorMessage: message },
    })
  }
}

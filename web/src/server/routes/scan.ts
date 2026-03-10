import { zValidator } from '@hono/zod-validator'
import { triggerAdviceEvaluation } from '@server/advice-gate'
import { loadRuntimeLlmConfigFromStorage } from '@server/runtime-llm-config'
import {
  emitScanProgress,
  type ScanProgressEvent,
  subscribeScanProgress,
} from '@server/scan-progress-bus'
import { storage } from '@server/storage'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import {
  clearInflightReferences,
  interruptSupersededScanTasks,
  registerInflightTask,
  requestScanCancel,
  tryGetInflightTaskId,
} from './scan/cancel-control'
import { SSE_KEEPALIVE_MS, USER_CANCELED_MESSAGE } from './scan/constants'
import { toScanProgressEvent } from './scan/progress-event'
import { runScan } from './scan/runner'
import { resolveEngineMode, scanBodySchema } from './scan/schema'
import {
  readRecentScanWithHotIndex,
  readScanStatusWithHotIndex,
} from './scan/status-read-metrics'

export const scanRoutes = new Hono()

interface ScanTaskIdRow {
  id: string
}

/**
 * POST /api/scan — 觸發掃描
 *
 * 建立 ScanTask 記錄後，背景執行 orchestrate，
 * 即時回傳 taskId 供前端輪詢進度。
 */
scanRoutes.post('/', zValidator('json', scanBodySchema), async (c) => {
  const body = c.req.valid('json')
  const llmConfig = await loadRuntimeLlmConfigFromStorage()
  const engineMode = resolveEngineMode(body.engineMode)
  const { fingerprint, existingTaskId } = tryGetInflightTaskId(body, engineMode)

  if (existingTaskId) {
    const task = await storage.scanTask.findUnique({
      where: { id: existingTaskId },
    })
    if (task && (task.status === 'pending' || task.status === 'running')) {
      return c.json(
        { taskId: existingTaskId, status: task.status, deduplicated: true },
        200,
      )
    }
    clearInflightReferences(existingTaskId)
  }

  await interruptSupersededScanTasks()

  const task = await storage.scanTask.create({
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
  })
  const typedTask = task as unknown as ScanTaskIdRow

  registerInflightTask(typedTask.id, fingerprint)
  emitScanProgress(toScanProgressEvent(task))

  void runScan(typedTask.id, body, fingerprint, engineMode, llmConfig)

  return c.json({ taskId: typedTask.id, status: 'running' }, 201)
})

/**
 * GET /api/scan/status/:id — 查詢掃描進度
 */
scanRoutes.get('/status/:id', async (c) => {
  const id = c.req.param('id')
  const { event, metrics, shouldLog } = await readScanStatusWithHotIndex(id, () =>
    storage.scanTask.findUnique({ where: { id } }),
  )
  if (!event) {
    if (shouldLog) {
      process.stdout.write(
        `[Confession][StatusReadMetrics] ${JSON.stringify({
          route: 'status',
          taskId: id,
          found: false,
          ...metrics,
        })}\n`,
      )
    }
    return c.json({ error: '掃描任務不存在' }, 404)
  }

  if (shouldLog) {
    process.stdout.write(
      `[Confession][StatusReadMetrics] ${JSON.stringify({
        route: 'status',
        taskId: id,
        found: true,
        ...metrics,
      })}\n`,
    )
  }

  return c.json(event)
})

/**
 * POST /api/scan/cancel/:id — 取消進行中的掃描
 */
scanRoutes.post('/cancel/:id', async (c) => {
  const id = c.req.param('id')
  const task = await storage.scanTask.findUnique({ where: { id } })
  if (!task) {
    return c.json({ error: '掃描任務不存在' }, 404)
  }

  if (task.status === 'completed' || task.status === 'failed') {
    return c.json({
      taskId: id,
      status: task.status,
      canceling: false,
      message: '任務已結束，無需取消',
    })
  }

  requestScanCancel(id, USER_CANCELED_MESSAGE)
  const canceledTask = await storage.scanTask.update({
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
  })
  emitScanProgress(toScanProgressEvent(canceledTask))
  triggerAdviceEvaluation({ sourceEvent: 'scan_failed', sourceTaskId: id })

  return c.json(
    {
      taskId: id,
      status: canceledTask.status,
      canceling: true,
      message: '已取消掃描任務',
    },
    202,
  )
})

/**
 * GET /api/scan/stream/:id — SSE 即時進度推送
 */
scanRoutes.get('/stream/:id', async (c) => {
  const id = c.req.param('id')
  const task = await storage.scanTask.findUnique({ where: { id } })
  if (!task) {
    return c.json({ error: '掃描任務不存在' }, 404)
  }

  c.header('Cache-Control', 'no-cache, no-transform')
  c.header('Connection', 'keep-alive')
  c.header('X-Accel-Buffering', 'no')

  return streamSSE(c, async (stream) => {
    let eventSeq = Math.max(
      0,
      Number.parseInt(c.req.header('Last-Event-ID') ?? '0', 10) || 0,
    )
    const nextEventId = () => {
      eventSeq += 1
      return String(eventSeq)
    }
    const writeProgress = async (event: ScanProgressEvent) => {
      await stream.writeSSE({
        id: nextEventId(),
        event: 'scan_progress',
        data: JSON.stringify(event),
      })
    }

    const initial = toScanProgressEvent(task)
    await writeProgress(initial)

    if (initial.status === 'completed' || initial.status === 'failed') {
      return
    }

    await new Promise<void>((resolve) => {
      let settled = false
      let unsubscribe: () => void = () => {}
      let keepaliveTimer: ReturnType<typeof setInterval> | null = null

      const finish = () => {
        if (settled) return
        settled = true
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer)
          keepaliveTimer = null
        }
        unsubscribe()
        resolve()
      }

      keepaliveTimer = setInterval(() => {
        void stream
          .writeSSE({
            id: nextEventId(),
            event: 'keepalive',
            data: JSON.stringify({
              taskId: id,
              ts: new Date().toISOString(),
            }),
          })
          .catch(() => {
            finish()
          })
      }, SSE_KEEPALIVE_MS)

      unsubscribe = subscribeScanProgress(id, (event) => {
        void (async () => {
          try {
            await writeProgress(event)
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
  const { event, metrics, shouldLog } = await readRecentScanWithHotIndex(() =>
    storage.scanTask.findFirst({
      orderBy: { updatedAt: 'desc' },
    }),
  )
  if (!event) {
    if (shouldLog) {
      process.stdout.write(
        `[Confession][StatusReadMetrics] ${JSON.stringify({
          route: 'recent',
          found: false,
          ...metrics,
        })}\n`,
      )
    }
    return c.json({ error: '尚無掃描記錄' }, 404)
  }

  if (shouldLog) {
    process.stdout.write(
      `[Confession][StatusReadMetrics] ${JSON.stringify({
        route: 'recent',
        taskId: event.id,
        found: true,
        ...metrics,
      })}\n`,
    )
  }

  return c.json(event)
})

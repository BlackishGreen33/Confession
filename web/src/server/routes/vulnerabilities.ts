import { zValidator } from '@hono/zod-validator'
import { prisma } from '@server/db'
import { Hono } from 'hono'
import { z } from 'zod/v4'

const STATUS_VALUES = ['open', 'fixed', 'ignored'] as const
const HUMAN_STATUS_VALUES = ['pending', 'confirmed', 'rejected', 'false_positive'] as const

type VulnStatus = (typeof STATUS_VALUES)[number]
type VulnHumanStatus = (typeof HUMAN_STATUS_VALUES)[number]

// === Query / Body Schemas ===

const listQuerySchema = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  humanStatus: z.enum(HUMAN_STATUS_VALUES).optional(),
  filePath: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['severity', 'createdAt', 'updatedAt', 'filePath', 'line']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const patchBodySchema = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  humanStatus: z.enum(HUMAN_STATUS_VALUES).optional(),
  humanComment: z.string().nullable().optional(),
  owaspCategory: z.string().nullable().optional(),
})

const eventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

interface VulnerabilityEventDelta {
  eventType: 'review_saved' | 'status_changed'
  message: string
  fromStatus?: VulnStatus
  toStatus?: VulnStatus
  fromHumanStatus?: VulnHumanStatus
  toHumanStatus?: VulnHumanStatus
}

interface VulnerabilityTrendDelta {
  date: string
  total: number
  open: number
  fixed: number
  ignored: number
}

export const vulnerabilityRoutes = new Hono()

/**
 * GET /api/vulnerabilities — 漏洞列表（篩選 / 排序 / 分頁）
 */
vulnerabilityRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { status, severity, humanStatus, filePath, search, sortBy, sortOrder, page, pageSize } =
    c.req.valid('query')

  // 組裝 where 條件
  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (severity) where.severity = severity
  if (humanStatus) where.humanStatus = humanStatus
  if (filePath) where.filePath = { contains: filePath }
  if (search) {
    where.OR = [
      { description: { contains: search } },
      { filePath: { contains: search } },
      { type: { contains: search } },
      { cweId: { contains: search } },
    ]
  }

  const [items, total] = await Promise.all([
    prisma.vulnerability.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.vulnerability.count({ where }),
  ])

  return c.json({
    items: items.map(serializeVuln),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  })
})

/**
 * GET /api/vulnerabilities/trend — 歷史趨勢（事件驅動，依日期聚合後累計）
 */
vulnerabilityRoutes.get('/trend', async (c) => {
  try {
    const rows = await prisma.vulnerabilityEvent.findMany({
      where: { eventType: { in: ['scan_detected', 'status_changed'] } },
      select: { createdAt: true, eventType: true, fromStatus: true, toStatus: true },
      orderBy: { createdAt: 'asc' },
    })

    // 尚未累積到事件時，回退舊趨勢，避免圖表整塊空白
    if (rows.length === 0) {
      const trend = await buildLegacyTrend()
      return c.json(trend)
    }

    const dailyDeltas = aggregateDailyTrendDeltas(rows)
    const trend = toCumulativeTrend(dailyDeltas)
    return c.json(trend)
  } catch (err) {
    // 相容舊 DB：尚未套用 events migration 時回退舊趨勢算法
    if (!isMissingEventsTableError(err)) throw err
    const trend = await buildLegacyTrend()
    return c.json(trend)
  }
})

/**
 * GET /api/vulnerabilities/stats — 統計數據
 */
vulnerabilityRoutes.get('/stats', async (c) => {
  const [
    total,
    bySeverity,
    byStatus,
    byHumanStatus,
  ] = await Promise.all([
    prisma.vulnerability.count(),
    prisma.vulnerability.groupBy({ by: ['severity'], _count: true }),
    prisma.vulnerability.groupBy({ by: ['status'], _count: true }),
    prisma.vulnerability.groupBy({ by: ['humanStatus'], _count: true }),
  ])

  const fixed = byStatus.find((s) => s.status === 'fixed')?._count ?? 0
  const fixRate = total > 0 ? fixed / total : 0

  return c.json({
    total,
    fixRate,
    bySeverity: Object.fromEntries(bySeverity.map((s) => [s.severity, s._count])),
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
    byHumanStatus: Object.fromEntries(byHumanStatus.map((s) => [s.humanStatus, s._count])),
  })
})

/**
 * GET /api/vulnerabilities/:id/events — 單筆漏洞事件流（新到舊）
 */
vulnerabilityRoutes.get('/:id/events', zValidator('query', eventsQuerySchema), async (c) => {
  const id = c.req.param('id')
  const { limit } = c.req.valid('query')

  const existing = await prisma.vulnerability.findUnique({ where: { id }, select: { id: true } })
  if (!existing) {
    return c.json({ error: '漏洞不存在' }, 404)
  }

  try {
    const events = await prisma.vulnerabilityEvent.findMany({
      where: { vulnerabilityId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    })

    return c.json(events.map(serializeEvent))
  } catch (err) {
    // 相容舊 DB：事件表不存在時先回空陣列，避免詳情頁報錯
    if (!isMissingEventsTableError(err)) throw err
    return c.json([])
  }
})

/**
 * GET /api/vulnerabilities/:id — 單筆漏洞詳情
 */
vulnerabilityRoutes.get('/:id', async (c) => {
  const id = c.req.param('id')
  const vuln = await prisma.vulnerability.findUnique({ where: { id } })
  if (!vuln) {
    return c.json({ error: '漏洞不存在' }, 404)
  }
  return c.json(serializeVuln(vuln))
})

/**
 * PATCH /api/vulnerabilities/:id — 更新狀態 / 歸因
 */
vulnerabilityRoutes.patch('/:id', zValidator('json', patchBodySchema), async (c) => {
  const id = c.req.param('id')

  const body = c.req.valid('json')

  // 至少要有一個欄位
  if (Object.keys(body).length === 0) {
    return c.json({ error: '至少需要提供一個更新欄位' }, 400)
  }

  const existing = await prisma.vulnerability.findUnique({ where: { id } })
  if (!existing) {
    return c.json({ error: '漏洞不存在' }, 404)
  }

  const { data, events, hasChanges } = buildPatchDelta(existing, body)

  if (!hasChanges) {
    return c.json(serializeVuln(existing))
  }

  const updated = await (async () => {
    try {
      return await prisma.$transaction(async (tx) => {
        const next = await tx.vulnerability.update({ where: { id }, data })

        if (events.length > 0) {
          await tx.vulnerabilityEvent.createMany({
            data: events.map((event) => ({
              vulnerabilityId: id,
              eventType: event.eventType,
              message: event.message,
              fromStatus: event.fromStatus,
              toStatus: event.toStatus,
              fromHumanStatus: event.fromHumanStatus,
              toHumanStatus: event.toHumanStatus,
            })),
          })
        }

        return next
      })
    } catch (err) {
      // 相容舊 DB：未 migration 前至少維持狀態更新可用
      if (!isMissingEventsTableError(err)) throw err
      return prisma.vulnerability.update({ where: { id }, data })
    }
  })()

  return c.json(serializeVuln(updated))
})

/** 將 Prisma 記錄序列化為 API 回應格式（日期轉 ISO 字串） */
function serializeVuln(v: {
  createdAt: Date
  updatedAt: Date
  humanReviewedAt: Date | null
  [key: string]: unknown
}) {
  return {
    ...v,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
    humanReviewedAt: v.humanReviewedAt?.toISOString() ?? null,
  }
}

function serializeEvent(v: {
  createdAt: Date
  [key: string]: unknown
}) {
  return {
    ...v,
    createdAt: v.createdAt.toISOString(),
  }
}

export function buildPatchDelta(
  existing: {
    status: string
    humanStatus: string
    humanComment: string | null
    owaspCategory: string | null
  },
  body: z.infer<typeof patchBodySchema>,
): {
  data: Record<string, unknown>
  events: VulnerabilityEventDelta[]
  hasChanges: boolean
} {
  const data: Record<string, unknown> = {}
  const events: VulnerabilityEventDelta[] = []

  const statusChanged = body.status !== undefined && body.status !== existing.status
  const humanStatusChanged =
    body.humanStatus !== undefined && body.humanStatus !== existing.humanStatus
  const humanCommentChanged =
    body.humanComment !== undefined && body.humanComment !== existing.humanComment
  const owaspCategoryChanged =
    body.owaspCategory !== undefined && body.owaspCategory !== existing.owaspCategory
  const reviewChanged = humanStatusChanged || humanCommentChanged || owaspCategoryChanged

  if (statusChanged && body.status) {
    data.status = body.status
    events.push({
      eventType: 'status_changed',
      message: `狀態流轉：${existing.status} -> ${body.status}`,
      fromStatus: existing.status as VulnStatus,
      toStatus: body.status,
    })
  }

  if (humanStatusChanged && body.humanStatus) {
    data.humanStatus = body.humanStatus
  }
  if (humanCommentChanged) {
    data.humanComment = body.humanComment ?? null
  }
  if (owaspCategoryChanged) {
    data.owaspCategory = body.owaspCategory ?? null
  }
  if (reviewChanged) {
    data.humanReviewedAt = new Date()
    events.push({
      eventType: 'review_saved',
      message:
        humanStatusChanged && body.humanStatus
          ? `專家審核已更新（${existing.humanStatus} -> ${body.humanStatus}）`
          : '審核備註已更新',
      fromHumanStatus: existing.humanStatus as VulnHumanStatus,
      toHumanStatus: (body.humanStatus ?? existing.humanStatus) as VulnHumanStatus,
    })
  }

  return { data, events, hasChanges: Object.keys(data).length > 0 }
}

export function aggregateDailyTrendDeltas(
  rows: Array<{
    createdAt: Date
    eventType: string
    fromStatus: string | null
    toStatus: string | null
  }>,
): VulnerabilityTrendDelta[] {
  const map = new Map<string, VulnerabilityTrendDelta>()

  for (const row of rows) {
    const date = row.createdAt.toISOString().slice(0, 10)
    const entry = map.get(date) ?? { date, total: 0, open: 0, fixed: 0, ignored: 0 }

    if (row.eventType === 'scan_detected') {
      entry.total += 1
      entry.open += 1
      map.set(date, entry)
      continue
    }

    if (row.eventType === 'status_changed') {
      if (row.fromStatus === 'open') entry.open -= 1
      if (row.fromStatus === 'fixed') entry.fixed -= 1
      if (row.fromStatus === 'ignored') entry.ignored -= 1

      if (row.toStatus === 'open') entry.open += 1
      if (row.toStatus === 'fixed') entry.fixed += 1
      if (row.toStatus === 'ignored') entry.ignored += 1
      map.set(date, entry)
    }
  }

  return [...map.values()]
}

export function toCumulativeTrend(dailyDeltas: VulnerabilityTrendDelta[]) {
  let cumTotal = 0
  let cumOpen = 0
  let cumFixed = 0
  let cumIgnored = 0

  return dailyDeltas.map(({ date, total, open, fixed, ignored }) => {
    cumTotal += total
    cumOpen += open
    cumFixed += fixed
    cumIgnored += ignored
    return { date, total: cumTotal, open: cumOpen, fixed: cumFixed, ignored: cumIgnored }
  })
}

function isMissingEventsTableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const maybeCode = (err as { code?: unknown }).code
  const maybeMessage = (err as { message?: unknown }).message
  const code = typeof maybeCode === 'string' ? maybeCode : ''
  const message = typeof maybeMessage === 'string' ? maybeMessage : ''
  return code === 'P2021' || /vulnerability_events/i.test(message)
}

async function buildLegacyTrend() {
  const rows = await prisma.vulnerability.findMany({
    select: { createdAt: true, status: true },
    orderBy: { createdAt: 'asc' },
  })

  const map = new Map<string, { total: number; open: number; fixed: number; ignored: number }>()
  for (const r of rows) {
    const date = r.createdAt.toISOString().slice(0, 10)
    const entry = map.get(date) ?? { total: 0, open: 0, fixed: 0, ignored: 0 }
    entry.total += 1
    if (r.status === 'open') entry.open += 1
    else if (r.status === 'fixed') entry.fixed += 1
    else if (r.status === 'ignored') entry.ignored += 1
    map.set(date, entry)
  }

  return toCumulativeTrend(
    [...map.entries()].map(([date, counts]) => ({
      date,
      total: counts.total,
      open: counts.open,
      fixed: counts.fixed,
      ignored: counts.ignored,
    })),
  )
}

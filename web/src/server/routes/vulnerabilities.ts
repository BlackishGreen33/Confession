import { zValidator } from '@hono/zod-validator'
import { prisma } from '@server/db'
import { Hono } from 'hono'
import { z } from 'zod/v4'

// === Query / Body Schemas ===

const listQuerySchema = z.object({
  status: z.enum(['open', 'fixed', 'ignored']).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  humanStatus: z.enum(['pending', 'confirmed', 'rejected', 'false_positive']).optional(),
  filePath: z.string().optional(),
  search: z.string().optional(),
  sortBy: z.enum(['severity', 'createdAt', 'updatedAt', 'filePath', 'line']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const patchBodySchema = z.object({
  status: z.enum(['open', 'fixed', 'ignored']).optional(),
  humanStatus: z.enum(['pending', 'confirmed', 'rejected', 'false_positive']).optional(),
  humanComment: z.string().nullable().optional(),
  owaspCategory: z.string().nullable().optional(),
})

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
 * GET /api/vulnerabilities/trend — 歷史趨勢（依日期聚合，累計值）
 */
vulnerabilityRoutes.get('/trend', async (c) => {
  const rows = await prisma.vulnerability.findMany({
    select: { createdAt: true, status: true },
    orderBy: { createdAt: 'asc' },
  })

  // 依日期聚合
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

  // 轉為累計趨勢
  let cumTotal = 0
  let cumOpen = 0
  let cumFixed = 0
  let cumIgnored = 0

  const trend = [...map.entries()].map(([date, counts]) => {
    cumTotal += counts.total
    cumOpen += counts.open
    cumFixed += counts.fixed
    cumIgnored += counts.ignored
    return { date, total: cumTotal, open: cumOpen, fixed: cumFixed, ignored: cumIgnored }
  })

  return c.json(trend)
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

  // 若更新 humanStatus，同時記錄審核時間
  const data: Record<string, unknown> = { ...body }
  if (body.humanStatus) {
    data.humanReviewedAt = new Date()
  }

  const updated = await prisma.vulnerability.update({ where: { id }, data })

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

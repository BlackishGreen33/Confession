import { zValidator } from '@hono/zod-validator'
import { triggerAdviceEvaluation } from '@server/advice-gate'
import { storage } from '@server/storage'
import { deduplicateVulnerabilities } from '@server/vulnerability-dedupe'
import {
  serializeEventForApi,
  serializeVulnerabilityForApi,
} from '@server/vulnerability-presenter'
import { buildVulnerabilityWhere } from '@server/vulnerability-query'
import { Hono } from 'hono'
import { z } from 'zod/v4'

import {
  HUMAN_STATUS_VALUES,
  STATUS_VALUES,
} from './vulnerabilities/constants'
import {
  countBy,
  type DedupedVulnerabilityRow,
  sortVulnerabilities,
} from './vulnerabilities/listing'
import {
  buildPatchDelta,
  type VulnerabilityPatchInput,
} from './vulnerabilities/patch-delta'
import {
  aggregateDailyTrendDeltas,
  buildLegacyTrend,
  toCumulativeTrend,
} from './vulnerabilities/trend'

const listQuerySchema = z.object({
  status: z.enum(STATUS_VALUES).optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
  humanStatus: z.enum(HUMAN_STATUS_VALUES).optional(),
  filePath: z.string().optional(),
  search: z.string().optional(),
  sortBy: z
    .enum(['severity', 'createdAt', 'updatedAt', 'filePath', 'line'])
    .default('createdAt'),
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

export const vulnerabilityRoutes = new Hono()

vulnerabilityRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const {
    status,
    severity,
    humanStatus,
    filePath,
    search,
    sortBy,
    sortOrder,
    page,
    pageSize,
  } = c.req.valid('query')

  const where = buildVulnerabilityWhere({
    status,
    severity,
    humanStatus,
    filePath,
    search,
  })

  const rows = await storage.vulnerability.findMany({ where })
  const deduped = deduplicateVulnerabilities(
    rows as unknown as DedupedVulnerabilityRow[],
  )
  const sorted = sortVulnerabilities(deduped, sortBy, sortOrder)
  const total = sorted.length
  const offset = (page - 1) * pageSize
  const items = sorted.slice(offset, offset + pageSize)

  return c.json({
    items: items.map((item) =>
      serializeVulnerabilityForApi(item as unknown as Record<string, unknown>),
    ),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  })
})

vulnerabilityRoutes.get('/trend', async (c) => {
  const rows = await storage.vulnerabilityEvent.findMany({
    where: { eventType: { in: ['scan_detected', 'status_changed'] } },
    select: {
      createdAt: true,
      eventType: true,
      fromStatus: true,
      toStatus: true,
    },
    orderBy: { createdAt: 'asc' },
  })

  if (rows.length === 0) {
    const trend = await buildLegacyTrend()
    return c.json(trend)
  }

  const dailyDeltas = aggregateDailyTrendDeltas(
    rows as Array<{
      createdAt: Date
      eventType: string
      fromStatus: string | null
      toStatus: string | null
    }>,
  )
  const trend = toCumulativeTrend(dailyDeltas)
  return c.json(trend)
})

vulnerabilityRoutes.get('/stats', async (c) => {
  const rows = await storage.vulnerability.findMany({
    select: {
      filePath: true,
      line: true,
      column: true,
      endLine: true,
      endColumn: true,
      type: true,
      cweId: true,
      severity: true,
      description: true,
      codeSnippet: true,
      aiConfidence: true,
      stableFingerprint: true,
      status: true,
      humanStatus: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  const deduped = deduplicateVulnerabilities(
    rows as unknown as DedupedVulnerabilityRow[],
  )

  const total = deduped.length
  const bySeverity = countBy(deduped, (item) => item.severity)
  const bySeverityOpen = countBy(
    deduped.filter((item) => item.status === 'open'),
    (item) => item.severity,
  )
  const byStatus = countBy(deduped, (item) => item.status)
  const byHumanStatus = countBy(deduped, (item) => item.humanStatus)

  const fixed = byStatus.fixed ?? 0
  const fixRate = total > 0 ? fixed / total : 0

  return c.json({
    total,
    fixRate,
    bySeverity,
    bySeverityOpen,
    byStatus,
    byHumanStatus,
  })
})

vulnerabilityRoutes.get(
  '/:id/events',
  zValidator('query', eventsQuerySchema),
  async (c) => {
    const id = c.req.param('id')
    const { limit } = c.req.valid('query')

    const existing = await storage.vulnerability.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!existing) {
      return c.json({ error: '漏洞不存在' }, 404)
    }

    const events = await storage.vulnerabilityEvent.findMany({
      where: { vulnerabilityId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    })

    return c.json(
      events.map((event) =>
        serializeEventForApi(event as unknown as Record<string, unknown>),
      ),
    )
  },
)

vulnerabilityRoutes.get('/:id', async (c) => {
  const id = c.req.param('id')
  const vuln = await storage.vulnerability.findUnique({ where: { id } })
  if (!vuln) {
    return c.json({ error: '漏洞不存在' }, 404)
  }
  return c.json(
    serializeVulnerabilityForApi(vuln as unknown as Record<string, unknown>),
  )
})

vulnerabilityRoutes.patch('/:id', zValidator('json', patchBodySchema), async (c) => {
  const id = c.req.param('id')
  const body = c.req.valid('json')

  if (Object.keys(body).length === 0) {
    return c.json({ error: '至少需要提供一個更新欄位' }, 400)
  }

  const existing = await storage.vulnerability.findUnique({ where: { id } })
  if (!existing) {
    return c.json({ error: '漏洞不存在' }, 404)
  }

  const { data, events, hasChanges } = buildPatchDelta(
    existing as {
      status: string
      humanStatus: string
      humanComment: string | null
      owaspCategory: string | null
    },
    body as VulnerabilityPatchInput,
  )

  if (!hasChanges) {
    return c.json(
      serializeVulnerabilityForApi(existing as unknown as Record<string, unknown>),
    )
  }

  const updated = await storage.$transaction(async (tx) => {
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

  const eventTypes = new Set(events.map((event) => event.eventType))
  if (eventTypes.has('review_saved')) {
    triggerAdviceEvaluation({
      sourceEvent: 'review_saved',
      sourceVulnerabilityId: id,
    })
  }
  if (eventTypes.has('status_changed')) {
    triggerAdviceEvaluation({
      sourceEvent: 'status_changed',
      sourceVulnerabilityId: id,
    })
  }

  return c.json(
    serializeVulnerabilityForApi(updated as unknown as Record<string, unknown>),
  )
})

export { buildPatchDelta } from './vulnerabilities/patch-delta'
export {
  aggregateDailyTrendDeltas,
  toCumulativeTrend,
} from './vulnerabilities/trend'

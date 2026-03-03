import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  vulnerability: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  },
  vulnerabilityEvent: {
    findMany: vi.fn(),
    createMany: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock('@server/db', () => ({ prisma: mockPrisma }))

import {
  aggregateDailyTrendDeltas,
  buildPatchDelta,
  toCumulativeTrend,
  vulnerabilityRoutes,
} from './vulnerabilities'

describe('vulnerabilityRoutes event helpers', () => {
  it('humanStatus 有變更時會產生 review_saved 事件', () => {
    const result = buildPatchDelta(
      {
        status: 'open',
        humanStatus: 'pending',
        humanComment: null,
        owaspCategory: null,
      },
      {
        humanStatus: 'confirmed',
      },
    )

    expect(result.hasChanges).toBe(true)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({
      eventType: 'review_saved',
      fromHumanStatus: 'pending',
      toHumanStatus: 'confirmed',
    })
  })

  it('status 有變更時會產生 status_changed 事件', () => {
    const result = buildPatchDelta(
      {
        status: 'open',
        humanStatus: 'confirmed',
        humanComment: null,
        owaspCategory: null,
      },
      {
        status: 'fixed',
      },
    )

    expect(result.hasChanges).toBe(true)
    expect(result.events).toHaveLength(1)
    expect(result.events[0]).toMatchObject({
      eventType: 'status_changed',
      fromStatus: 'open',
      toStatus: 'fixed',
    })
  })

  it('status 與 humanStatus 同時變更時會產生兩筆事件', () => {
    const result = buildPatchDelta(
      {
        status: 'open',
        humanStatus: 'pending',
        humanComment: null,
        owaspCategory: null,
      },
      {
        status: 'ignored',
        humanStatus: 'rejected',
      },
    )

    expect(result.hasChanges).toBe(true)
    expect(result.events).toHaveLength(2)
    expect(result.events.map((e) => e.eventType)).toEqual(['status_changed', 'review_saved'])
  })

  it('同值 PATCH 不會產生事件', () => {
    const result = buildPatchDelta(
      {
        status: 'open',
        humanStatus: 'pending',
        humanComment: 'same',
        owaspCategory: null,
      },
      {
        status: 'open',
        humanStatus: 'pending',
        humanComment: 'same',
      },
    )

    expect(result.hasChanges).toBe(false)
    expect(result.events).toHaveLength(0)
  })

  it('trend 會依 scan_detected + status_changed 聚合並累計', () => {
    const rows = [
      {
        createdAt: new Date('2026-02-01T10:00:00.000Z'),
        eventType: 'scan_detected',
        fromStatus: null,
        toStatus: 'open',
      },
      {
        createdAt: new Date('2026-02-01T11:00:00.000Z'),
        eventType: 'scan_detected',
        fromStatus: null,
        toStatus: 'open',
      },
      {
        createdAt: new Date('2026-02-02T10:00:00.000Z'),
        eventType: 'status_changed',
        fromStatus: 'open',
        toStatus: 'fixed',
      },
    ]

    const deltas = aggregateDailyTrendDeltas(rows)
    const trend = toCumulativeTrend(deltas)

    expect(trend).toEqual([
      { date: '2026-02-01', total: 2, open: 2, fixed: 0, ignored: 0 },
      { date: '2026-02-02', total: 2, open: 1, fixed: 1, ignored: 0 },
    ])
  })
})

describe('GET /api/vulnerabilities/:id/events', () => {
  const app = new Hono().route('/api/vulnerabilities', vulnerabilityRoutes)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('會回傳指定 limit 的事件列表（新到舊）', async () => {
    mockPrisma.vulnerability.findUnique.mockResolvedValue({ id: 'v1' })
    mockPrisma.vulnerabilityEvent.findMany.mockResolvedValue([
      {
        id: 'e2',
        vulnerabilityId: 'v1',
        eventType: 'status_changed',
        message: '狀態流轉：open -> fixed',
        fromStatus: 'open',
        toStatus: 'fixed',
        fromHumanStatus: null,
        toHumanStatus: null,
        createdAt: new Date('2026-02-02T10:00:00.000Z'),
      },
      {
        id: 'e1',
        vulnerabilityId: 'v1',
        eventType: 'scan_detected',
        message: '掃描發現新漏洞',
        fromStatus: null,
        toStatus: 'open',
        fromHumanStatus: null,
        toHumanStatus: null,
        createdAt: new Date('2026-02-01T10:00:00.000Z'),
      },
    ])

    const res = await app.request('/api/vulnerabilities/v1/events?limit=2')
    expect(res.status).toBe(200)

    expect(mockPrisma.vulnerabilityEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { vulnerabilityId: 'v1' },
        take: 2,
      }),
    )

    const body = (await res.json()) as Array<{ id: string; createdAt: string }>
    expect(body).toHaveLength(2)
    expect(body[0].id).toBe('e2')
    expect(body[0].createdAt).toBe('2026-02-02T10:00:00.000Z')
  })

  it('漏洞不存在時回傳 404', async () => {
    mockPrisma.vulnerability.findUnique.mockResolvedValue(null)

    const res = await app.request('/api/vulnerabilities/not-found/events')
    expect(res.status).toBe(404)
  })
})

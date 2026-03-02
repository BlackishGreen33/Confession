import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  scanTask: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  config: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@server/db', () => ({ prisma: mockPrisma }))

import { scanRoutes } from './scan'

describe('GET /api/scan/recent', () => {
  const app = new Hono().route('/api/scan', scanRoutes)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('有最近掃描資料時回傳最新摘要', async () => {
    mockPrisma.scanTask.findFirst.mockResolvedValue({
      id: 'task-1',
      status: 'completed',
      progress: 1,
      totalFiles: 12,
      scannedFiles: 12,
      errorMessage: null,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:05:00.000Z'),
    })

    const res = await app.request('/api/scan/recent')
    expect(res.status).toBe(200)
    expect(mockPrisma.scanTask.findFirst).toHaveBeenCalledWith({
      orderBy: { updatedAt: 'desc' },
    })

    const body = (await res.json()) as {
      id: string
      createdAt: string
      updatedAt: string
      scannedFiles: number
      totalFiles: number
    }

    expect(body.id).toBe('task-1')
    expect(body.scannedFiles).toBe(12)
    expect(body.totalFiles).toBe(12)
    expect(body.createdAt).toBe('2026-03-01T00:00:00.000Z')
    expect(body.updatedAt).toBe('2026-03-01T00:05:00.000Z')
  })

  it('沒有掃描記錄時回傳 404', async () => {
    mockPrisma.scanTask.findFirst.mockResolvedValue(null)

    const res = await app.request('/api/scan/recent')
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('尚無掃描記錄')
  })
})

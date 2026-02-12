import { zValidator } from '@hono/zod-validator'
import { prisma } from '@server/db'
import { Hono } from 'hono'
import { z } from 'zod/v4'

const exportBodySchema = z.object({
  format: z.enum(['json', 'csv']),
  filters: z
    .object({
      status: z.enum(['open', 'fixed', 'ignored']).optional(),
      severity: z.enum(['critical', 'high', 'medium', 'low', 'info']).optional(),
      humanStatus: z.enum(['pending', 'confirmed', 'rejected', 'false_positive']).optional(),
      filePath: z.string().optional(),
    })
    .optional(),
})

export const exportRoutes = new Hono()

/**
 * POST /api/export — 導出漏洞報告（JSON / CSV）
 *
 * 根據篩選條件查詢漏洞，以指定格式回傳。
 */
exportRoutes.post('/', zValidator('json', exportBodySchema), async (c) => {
  const { format, filters } = c.req.valid('json')

  // 組裝 where 條件
  const where: Record<string, unknown> = {}
  if (filters?.status) where.status = filters.status
  if (filters?.severity) where.severity = filters.severity
  if (filters?.humanStatus) where.humanStatus = filters.humanStatus
  if (filters?.filePath) where.filePath = { contains: filters.filePath }

  const vulns = await prisma.vulnerability.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  })

  if (format === 'csv') {
    const csv = toCsv(vulns)
    return c.text(csv, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="vulnerabilities-${Date.now()}.csv"`,
    })
  }

  // JSON 格式
  const data = vulns.map(serializeVuln)
  return c.json(
    { exportedAt: new Date().toISOString(), total: data.length, items: data },
    200,
    { 'Content-Disposition': `attachment; filename="vulnerabilities-${Date.now()}.json"` },
  )
})

/** CSV 欄位定義 */
const CSV_COLUMNS = [
  'id',
  'filePath',
  'line',
  'column',
  'type',
  'cweId',
  'severity',
  'description',
  'status',
  'humanStatus',
  'owaspCategory',
  'createdAt',
  'updatedAt',
] as const

/** 將漏洞陣列轉為 CSV 字串 */
function toCsv(vulns: Array<Record<string, unknown>>): string {
  const header = CSV_COLUMNS.join(',')
  const rows = vulns.map((v) =>
    CSV_COLUMNS.map((col) => escapeCsvField(String(v[col] ?? ''))).join(','),
  )
  return [header, ...rows].join('\n')
}

/** 跳脫 CSV 欄位（含逗號、換行、雙引號時加引號包裹） */
function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

/** 日期欄位序列化 */
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

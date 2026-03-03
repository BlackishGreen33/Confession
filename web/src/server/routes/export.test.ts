import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  vulnerability: {
    findMany: vi.fn(),
  },
}))

vi.mock('@server/db', () => ({ prisma: mockPrisma }))

import { exportRoutes } from './export'

function buildVulnerability(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vuln-1',
    filePath: '/workspace/app.ts',
    line: 12,
    column: 3,
    endLine: 14,
    endColumn: 8,
    codeSnippet: 'const user = req.query.id\nconsole.log("debug")',
    codeHash: 'hash-1',
    type: 'xss',
    cweId: 'CWE-79',
    severity: 'high',
    description: '潛在 XSS',
    riskDescription: '使用者輸入未過濾',
    fixOldCode: 'element.innerHTML = userInput',
    fixNewCode: 'element.textContent = userInput',
    fixExplanation: '改用 textContent 避免 HTML 注入',
    aiModel: 'nvidia/qwen',
    aiConfidence: 0.91,
    aiReasoning: '由資料流可達危險 DOM sink',
    humanStatus: 'confirmed',
    humanComment: '已確認可重現',
    humanReviewedAt: new Date('2026-03-01T00:00:00.000Z'),
    owaspCategory: 'A03:2021-Injection',
    status: 'open',
    createdAt: new Date('2026-03-01T10:00:00.000Z'),
    updatedAt: new Date('2026-03-01T12:00:00.000Z'),
    ...overrides,
  }
}

describe('exportRoutes', () => {
  const app = new Hono().route('/api/export', exportRoutes)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('json 匯出會回傳 v2 報告並套用 search 篩選條件', async () => {
    mockPrisma.vulnerability.findMany.mockResolvedValue([
      buildVulnerability(),
      buildVulnerability({
        id: 'vuln-2',
        severity: 'critical',
        type: 'sql_injection',
        humanStatus: 'pending',
        status: 'fixed',
      }),
    ])

    const res = await app.request('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        format: 'json',
        filters: {
          status: 'open',
          severity: 'high',
          humanStatus: 'confirmed',
          filePath: '/workspace',
          search: 'xss',
        },
      }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('content-disposition')).toMatch(
      /confession-vulnerabilities-\d{8}-\d{6}\.json/,
    )
    expect(mockPrisma.vulnerability.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'open',
          severity: 'high',
          humanStatus: 'confirmed',
          filePath: { contains: '/workspace' },
          OR: expect.any(Array),
        }),
      }),
    )

    const body = (await res.json()) as {
      schemaVersion: string
      summary: { total: number; bySeverity: Record<string, number> }
      items: Array<{ createdAt: string }>
    }

    expect(body.schemaVersion).toBe('2.0.0')
    expect(body.summary.total).toBe(2)
    expect(body.summary.bySeverity.critical).toBe(1)
    expect(body.summary.bySeverity.high).toBe(1)
    expect(body.items[0].createdAt).toBe('2026-03-01T10:00:00.000Z')
  })

  it('csv 匯出會帶 BOM 並正確跳脫欄位內容', async () => {
    mockPrisma.vulnerability.findMany.mockResolvedValue([
      buildVulnerability({
        description: 'desc,with,comma',
        codeSnippet: 'line1\nline2 "quoted"',
      }),
    ])

    const res = await app.request('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'csv' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/csv')
    const bytes = new Uint8Array(await res.arrayBuffer())
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    const text = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
    expect(text).toContain(
      'id,filePath,line,column,endLine,endColumn,type,cweId,severity,status,humanStatus,owaspCategory,description,riskDescription,codeSnippet,codeHash,fixExplanation,fixOldCode,fixNewCode,aiModel,aiConfidence,aiReasoning,humanComment,humanReviewedAt,createdAt,updatedAt',
    )
    expect(text).toContain('"desc,with,comma"')
    expect(text).toContain('"line1\nline2 ""quoted"""')
  })

  it('markdown 匯出會包含摘要與漏洞明細章節', async () => {
    mockPrisma.vulnerability.findMany.mockResolvedValue([buildVulnerability()])

    const res = await app.request('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'markdown' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    expect(res.headers.get('content-disposition')).toMatch(
      /confession-vulnerabilities-\d{8}-\d{6}\.md/,
    )
    const text = await res.text()
    expect(text).toContain('# Confession 漏洞匯出報告')
    expect(text).toContain('## 統計摘要')
    expect(text).toContain('## 漏洞明細')
  })

  it('pdf 匯出會回傳可列印 HTML 並跳脫危險字元', async () => {
    mockPrisma.vulnerability.findMany.mockResolvedValue([
      buildVulnerability({
        description: '<script>alert(1)</script>',
      }),
    ])

    const res = await app.request('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'pdf' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('content-disposition')).toMatch(
      /confession-vulnerabilities-\d{8}-\d{6}\.pdf/,
    )

    const html = await res.text()
    expect(html).toContain('@page')
    expect(html).toContain('Confession 漏洞匯出報告')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

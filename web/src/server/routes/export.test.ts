import { TextDecoder } from 'node:util'

import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = vi.hoisted(() => ({
  vulnerability: {
    findMany: vi.fn(),
  },
  config: {
    findUnique: vi.fn(),
  },
}))

vi.mock('@server/storage', () => ({ storage: mockPrisma }))

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
    stableFingerprint: 'stable-fp-1',
    source: 'sast',
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
    mockPrisma.config.findUnique.mockResolvedValue({
      id: 'default',
      data: JSON.stringify({
        ui: { language: 'zh-TW' },
      }),
    })
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
    const text = new TextDecoder('utf-8').decode(bytes)
    expect(text).toContain(
      'ID,檔案路徑,行,列,結束行,結束列,漏洞類型,CWE,嚴重度,狀態,人工審核狀態,OWASP 類別,描述,風險說明,代碼片段,代碼雜湊,修復說明,修復前代碼,修復後代碼,AI 模型,AI 信心值,AI 推理,穩定指紋,來源,人工備註,人工審核時間,建立時間,更新時間',
    )
    expect(text).toContain('"desc,with,comma"')
    expect(text).toContain('"line1\nline2 ""quoted"""')
  })

  it('csv 匯出可指定 locale=en，欄位標題使用英文鍵名', async () => {
    mockPrisma.vulnerability.findMany.mockResolvedValue([buildVulnerability()])

    const res = await app.request('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'csv', locale: 'en' }),
    })

    expect(res.status).toBe(200)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const text = new TextDecoder('utf-8').decode(bytes)
    expect(text).toContain(
      'id,file_path,line,column,end_line,end_column,type,cwe_id,severity,status,human_status,owasp_category,description,risk_description,code_snippet,code_hash,fix_explanation,fix_old_code,fix_new_code,ai_model,ai_confidence,ai_reasoning,stable_fingerprint,source,human_comment,human_reviewed_at,created_at,updated_at',
    )
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

  it('markdown 匯出未帶 locale 時會依 config.ui.language 決定語系', async () => {
    mockPrisma.config.findUnique.mockResolvedValue({
      id: 'default',
      data: JSON.stringify({
        ui: { language: 'zh-CN' },
      }),
    })
    mockPrisma.vulnerability.findMany.mockResolvedValue([buildVulnerability()])

    const res = await app.request('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'markdown' }),
    })

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(text).toContain('# Confession 漏洞导出报告')
    expect(text).toContain('## 统计摘要')
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

  it('sarif 匯出會回傳 2.1.0 並包含 stableFingerprint', async () => {
    mockPrisma.vulnerability.findMany.mockResolvedValue([
      buildVulnerability({
        stableFingerprint: 'stable-fingerprint-xss',
        source: 'sast',
      }),
    ])

    const res = await app.request('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'sarif' }),
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/sarif+json')
    expect(res.headers.get('content-disposition')).toMatch(
      /confession-vulnerabilities-\d{8}-\d{6}\.sarif\.json/,
    )

    const body = (await res.json()) as {
      version: string
      runs: Array<{
        tool: { driver: { name: string } }
        results: Array<{
          ruleId: string
          level: string
          partialFingerprints?: Record<string, string>
        }>
      }>
    }
    expect(body.version).toBe('2.1.0')
    expect(body.runs[0]?.tool.driver.name).toBe('Confession')
    expect(body.runs[0]?.results[0]?.ruleId).toBe('xss')
    expect(body.runs[0]?.results[0]?.level).toBe('error')
    expect(body.runs[0]?.results[0]?.partialFingerprints?.stableFingerprint).toBe(
      'stable-fingerprint-xss',
    )
  })
})

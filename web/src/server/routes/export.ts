import { zValidator } from '@hono/zod-validator'
import { storage } from '@server/storage'
import { buildExportReport, serializeVulnerabilityForExport } from '@server/vulnerability-presenter'
import { buildVulnerabilityWhere } from '@server/vulnerability-query'
import { Hono } from 'hono'
import { z } from 'zod/v4'

import { type ResolvedLocale,resolveLocale } from '@/libs/i18n'
import type { UiLanguage } from '@/libs/types'

import { renderPrintableHtml } from '../export/printable-html'
import {
  buildExportFilename,
  type ExportFormat,
  renderCsv,
  renderJsonReport,
  renderMarkdown,
  renderSarif,
} from '../export/renderers'

const STATUS_VALUES = ['open', 'fixed', 'ignored'] as const
const SEVERITY_VALUES = ['critical', 'high', 'medium', 'low', 'info'] as const
const HUMAN_STATUS_VALUES = ['pending', 'confirmed', 'rejected', 'false_positive'] as const
const REPORT_SCHEMA_VERSION = '2.0.0'

const exportBodySchema = z.object({
  format: z.enum(['json', 'csv', 'markdown', 'pdf', 'sarif']),
  locale: z.enum(['zh-TW', 'zh-CN', 'en']).optional(),
  filters: z
    .object({
      status: z.enum(STATUS_VALUES).optional(),
      severity: z.enum(SEVERITY_VALUES).optional(),
      humanStatus: z.enum(HUMAN_STATUS_VALUES).optional(),
      filePath: z.string().optional(),
      search: z.string().optional(),
    })
    .optional(),
})

export const exportRoutes = new Hono()

async function resolveExportLocale(input: ResolvedLocale | undefined): Promise<ResolvedLocale> {
  if (input) return input

  const row = await storage.config.findUnique({ where: { id: 'default' } })
  if (!row) return 'zh-TW'

  try {
    const raw = JSON.parse(row.data) as {
      ui?: { language?: UiLanguage }
    }
    return resolveLocale(raw.ui?.language ?? 'auto')
  } catch {
    return 'zh-TW'
  }
}

/**
 * POST /api/export — 匯出漏洞報告（JSON / CSV / Markdown / PDF(列印 HTML) / SARIF）
 *
 * 根據篩選條件查詢漏洞，以指定格式回傳。
 */
exportRoutes.post('/', zValidator('json', exportBodySchema), async (c) => {
  const { format, filters, locale: localeFromRequest } = c.req.valid('json')
  const locale = await resolveExportLocale(localeFromRequest)
  const filename = buildExportFilename(format as ExportFormat)
  const where = buildVulnerabilityWhere(filters)

  const vulns = await storage.vulnerability.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  })

  const items = vulns.map((item) =>
    serializeVulnerabilityForExport(
      item as Parameters<typeof serializeVulnerabilityForExport>[0],
    ),
  )
  const report = buildExportReport(
    items,
    (filters ?? {}) as Record<string, unknown>,
    REPORT_SCHEMA_VERSION,
  )

  if (format === 'csv') {
    const csv = renderCsv(items, locale)
    // 加入 UTF-8 BOM，避免繁中在部分試算表工具開啟時出現亂碼
    const csvWithBom = `\uFEFF${csv}`
    return c.text(csvWithBom, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    })
  }

  if (format === 'markdown') {
    return c.text(renderMarkdown(report, locale), 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    })
  }

  if (format === 'pdf') {
    return c.text(renderPrintableHtml(report, locale), 200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    })
  }

  if (format === 'sarif') {
    const sarif = renderSarif(report)
    const headers: Record<string, string> = {
      'Content-Type': 'application/sarif+json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    }
    if (sarif.warnings.length > 0) {
      headers['X-Confession-Sarif-Warning'] = sarif.warnings[0]
    }
    return c.text(sarif.content, 200, headers)
  }

  return c.text(renderJsonReport(report), 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
  })
})

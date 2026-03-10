import { buildSarifPayloadWithGuards } from '@server/sarif-generator'
import type {
  ExportReportV2,
  SerializedVulnerability,
} from '@server/vulnerability-presenter'

import { formatCounter, groupBySeverity } from './common'

export type ExportFormat = 'json' | 'csv' | 'markdown' | 'pdf' | 'sarif'

const CSV_COLUMNS = [
  'id',
  'filePath',
  'line',
  'column',
  'endLine',
  'endColumn',
  'type',
  'cweId',
  'severity',
  'status',
  'humanStatus',
  'owaspCategory',
  'description',
  'riskDescription',
  'codeSnippet',
  'codeHash',
  'fixExplanation',
  'fixOldCode',
  'fixNewCode',
  'aiModel',
  'aiConfidence',
  'aiReasoning',
  'stableFingerprint',
  'source',
  'humanComment',
  'humanReviewedAt',
  'createdAt',
  'updatedAt',
] as const

export function buildExportFilename(format: ExportFormat): string {
  const extensionMap: Record<ExportFormat, string> = {
    json: 'json',
    csv: 'csv',
    markdown: 'md',
    pdf: 'pdf',
    sarif: 'sarif.json',
  }
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const min = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `confession-vulnerabilities-${yyyy}${mm}${dd}-${hh}${min}${ss}.${extensionMap[format]}`
}

export function renderJsonReport(report: ExportReportV2): string {
  return JSON.stringify(report, null, 2)
}

export function renderSarif(report: ExportReportV2): {
  content: string
  warnings: string[]
} {
  const built = buildSarifPayloadWithGuards({
    items: report.items,
    reportSchemaVersion: report.schemaVersion,
    exportedAt: report.exportedAt,
    filters: report.filters ?? {},
  })
  return {
    content: JSON.stringify(built.payload, null, 2),
    warnings: built.warnings,
  }
}

export function renderCsv(items: SerializedVulnerability[]): string {
  const header = CSV_COLUMNS.join(',')
  const rows = items.map((item) =>
    CSV_COLUMNS.map((col) => escapeCsvField(String(item[col] ?? ''))).join(','),
  )
  return [header, ...rows].join('\n')
}

export function renderMarkdown(report: ExportReportV2): string {
  const summary = report.summary
  const filterEntries = Object.entries(report.filters ?? {})
  const filterLines =
    filterEntries.length > 0
      ? filterEntries.map(([k, v]) => `- ${k}: \`${String(v)}\``).join('\n')
      : '- （無篩選）'
  const sections = groupBySeverity(report.items)

  const details = sections
    .filter((section) => section.items.length > 0)
    .map(
      (section) =>
        `## ${section.label}（${section.items.length}）\n\n${section.items
          .map((item) => renderMarkdownItem(item))
          .join('\n\n')}`,
    )
    .join('\n\n')

  return [
    '# Confession 漏洞匯出報告',
    '',
    `- 版本：${report.schemaVersion}`,
    `- 匯出時間：${report.exportedAt}`,
    `- 總數：${summary.total}`,
    '',
    '## 篩選條件',
    filterLines,
    '',
    '## 統計摘要',
    '',
    `- 依嚴重度：${formatCounter(summary.bySeverity)}`,
    `- 依狀態：${formatCounter(summary.byStatus)}`,
    `- 依審核狀態：${formatCounter(summary.byHumanStatus)}`,
    `- 依漏洞類型：${formatCounter(summary.byType)}`,
    '',
    '## 漏洞明細',
    '',
    details || '（沒有符合條件的漏洞）',
    '',
  ].join('\n')
}

function renderMarkdownItem(item: SerializedVulnerability): string {
  return [
    `### ${item.cweId ?? item.type} — ${item.filePath}:${item.line}:${item.column}`,
    '',
    `- id: \`${item.id}\``,
    `- severity: \`${item.severity}\``,
    `- status: \`${item.status}\``,
    `- humanStatus: \`${item.humanStatus}\``,
    `- owaspCategory: ${item.owaspCategory ?? 'N/A'}`,
    `- createdAt: ${item.createdAt}`,
    `- updatedAt: ${item.updatedAt}`,
    '',
    `描述：${item.description}`,
    '',
    `風險說明：${item.riskDescription ?? 'N/A'}`,
    '',
    '```txt',
    item.codeSnippet || '',
    '```',
    '',
    `修復建議：${item.fixExplanation ?? 'N/A'}`,
    '',
    item.fixOldCode
      ? ['修復前：', '```txt', item.fixOldCode, '```'].join('\n')
      : '修復前：N/A',
    '',
    item.fixNewCode
      ? ['修復後：', '```txt', item.fixNewCode, '```'].join('\n')
      : '修復後：N/A',
    '',
    `AI：model=${item.aiModel ?? 'N/A'} confidence=${item.aiConfidence ?? 'N/A'}`,
    item.aiReasoning ? `AI 說明：${item.aiReasoning}` : 'AI 說明：N/A',
    item.humanComment ? `審核備註：${item.humanComment}` : '審核備註：N/A',
  ].join('\n')
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

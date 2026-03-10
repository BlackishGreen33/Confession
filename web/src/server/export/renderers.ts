import { buildSarifPayloadWithGuards } from '@server/sarif-generator'
import type {
  ExportReportV2,
  SerializedVulnerability,
} from '@server/vulnerability-presenter'

import type { ResolvedLocale } from '@/libs/i18n'

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

type CsvColumn = (typeof CSV_COLUMNS)[number]

const CSV_COLUMN_LABELS: Record<ResolvedLocale, Record<CsvColumn, string>> = {
  'zh-TW': {
    id: 'ID',
    filePath: '檔案路徑',
    line: '行',
    column: '列',
    endLine: '結束行',
    endColumn: '結束列',
    type: '漏洞類型',
    cweId: 'CWE',
    severity: '嚴重度',
    status: '狀態',
    humanStatus: '人工審核狀態',
    owaspCategory: 'OWASP 類別',
    description: '描述',
    riskDescription: '風險說明',
    codeSnippet: '代碼片段',
    codeHash: '代碼雜湊',
    fixExplanation: '修復說明',
    fixOldCode: '修復前代碼',
    fixNewCode: '修復後代碼',
    aiModel: 'AI 模型',
    aiConfidence: 'AI 信心值',
    aiReasoning: 'AI 推理',
    stableFingerprint: '穩定指紋',
    source: '來源',
    humanComment: '人工備註',
    humanReviewedAt: '人工審核時間',
    createdAt: '建立時間',
    updatedAt: '更新時間',
  },
  'zh-CN': {
    id: 'ID',
    filePath: '文件路径',
    line: '行',
    column: '列',
    endLine: '结束行',
    endColumn: '结束列',
    type: '漏洞类型',
    cweId: 'CWE',
    severity: '严重度',
    status: '状态',
    humanStatus: '人工审核状态',
    owaspCategory: 'OWASP 类别',
    description: '描述',
    riskDescription: '风险说明',
    codeSnippet: '代码片段',
    codeHash: '代码哈希',
    fixExplanation: '修复说明',
    fixOldCode: '修复前代码',
    fixNewCode: '修复后代码',
    aiModel: 'AI 模型',
    aiConfidence: 'AI 置信度',
    aiReasoning: 'AI 推理',
    stableFingerprint: '稳定指纹',
    source: '来源',
    humanComment: '人工备注',
    humanReviewedAt: '人工审核时间',
    createdAt: '创建时间',
    updatedAt: '更新时间',
  },
  en: {
    id: 'id',
    filePath: 'file_path',
    line: 'line',
    column: 'column',
    endLine: 'end_line',
    endColumn: 'end_column',
    type: 'type',
    cweId: 'cwe_id',
    severity: 'severity',
    status: 'status',
    humanStatus: 'human_status',
    owaspCategory: 'owasp_category',
    description: 'description',
    riskDescription: 'risk_description',
    codeSnippet: 'code_snippet',
    codeHash: 'code_hash',
    fixExplanation: 'fix_explanation',
    fixOldCode: 'fix_old_code',
    fixNewCode: 'fix_new_code',
    aiModel: 'ai_model',
    aiConfidence: 'ai_confidence',
    aiReasoning: 'ai_reasoning',
    stableFingerprint: 'stable_fingerprint',
    source: 'source',
    humanComment: 'human_comment',
    humanReviewedAt: 'human_reviewed_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
}

const MARKDOWN_TEXT: Record<
  ResolvedLocale,
  {
    reportTitle: string
    version: string
    exportedAt: string
    total: string
    filtersTitle: string
    noFilters: string
    summaryTitle: string
    bySeverity: string
    byStatus: string
    byHumanStatus: string
    byType: string
    detailsTitle: string
    noDetails: string
    description: string
    riskDescription: string
    fixSuggestion: string
    beforeFix: string
    afterFix: string
    aiSummary: string
    aiReasoning: string
    reviewComment: string
    notAvailable: string
  }
> = {
  'zh-TW': {
    reportTitle: '# Confession 漏洞匯出報告',
    version: '版本',
    exportedAt: '匯出時間',
    total: '總數',
    filtersTitle: '## 篩選條件',
    noFilters: '（無篩選）',
    summaryTitle: '## 統計摘要',
    bySeverity: '依嚴重度',
    byStatus: '依狀態',
    byHumanStatus: '依審核狀態',
    byType: '依漏洞類型',
    detailsTitle: '## 漏洞明細',
    noDetails: '（沒有符合條件的漏洞）',
    description: '描述',
    riskDescription: '風險說明',
    fixSuggestion: '修復建議',
    beforeFix: '修復前',
    afterFix: '修復後',
    aiSummary: 'AI',
    aiReasoning: 'AI 說明',
    reviewComment: '審核備註',
    notAvailable: 'N/A',
  },
  'zh-CN': {
    reportTitle: '# Confession 漏洞导出报告',
    version: '版本',
    exportedAt: '导出时间',
    total: '总数',
    filtersTitle: '## 筛选条件',
    noFilters: '（无筛选）',
    summaryTitle: '## 统计摘要',
    bySeverity: '按严重度',
    byStatus: '按状态',
    byHumanStatus: '按审核状态',
    byType: '按漏洞类型',
    detailsTitle: '## 漏洞明细',
    noDetails: '（没有符合条件的漏洞）',
    description: '描述',
    riskDescription: '风险说明',
    fixSuggestion: '修复建议',
    beforeFix: '修复前',
    afterFix: '修复后',
    aiSummary: 'AI',
    aiReasoning: 'AI 说明',
    reviewComment: '审核备注',
    notAvailable: 'N/A',
  },
  en: {
    reportTitle: '# Confession Vulnerability Export Report',
    version: 'Version',
    exportedAt: 'Exported At',
    total: 'Total',
    filtersTitle: '## Filters',
    noFilters: '(No filters)',
    summaryTitle: '## Summary',
    bySeverity: 'By Severity',
    byStatus: 'By Status',
    byHumanStatus: 'By Review Status',
    byType: 'By Vulnerability Type',
    detailsTitle: '## Vulnerability Details',
    noDetails: '(No vulnerabilities match the filters)',
    description: 'Description',
    riskDescription: 'Risk',
    fixSuggestion: 'Fix Suggestion',
    beforeFix: 'Before Fix',
    afterFix: 'After Fix',
    aiSummary: 'AI',
    aiReasoning: 'AI Reasoning',
    reviewComment: 'Review Comment',
    notAvailable: 'N/A',
  },
}

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

export function renderCsv(
  items: SerializedVulnerability[],
  locale: ResolvedLocale = 'zh-TW',
): string {
  const header = CSV_COLUMNS.map((col) => CSV_COLUMN_LABELS[locale][col]).join(',')
  const rows = items.map((item) =>
    CSV_COLUMNS.map((col) => escapeCsvField(String(item[col] ?? ''))).join(','),
  )
  return [header, ...rows].join('\n')
}

export function renderMarkdown(
  report: ExportReportV2,
  locale: ResolvedLocale = 'zh-TW',
): string {
  const text = MARKDOWN_TEXT[locale]
  const summary = report.summary
  const filterEntries = Object.entries(report.filters ?? {})
  const filterLines =
    filterEntries.length > 0
      ? filterEntries.map(([k, v]) => `- ${k}: \`${String(v)}\``).join('\n')
      : `- ${text.noFilters}`
  const sections = groupBySeverity(report.items, locale)

  const details = sections
    .filter((section) => section.items.length > 0)
    .map(
      (section) =>
        `## ${section.label}（${section.items.length}）\n\n${section.items
          .map((item) => renderMarkdownItem(item, locale))
          .join('\n\n')}`,
    )
    .join('\n\n')

  return [
    text.reportTitle,
    '',
    `- ${text.version}: ${report.schemaVersion}`,
    `- ${text.exportedAt}: ${report.exportedAt}`,
    `- ${text.total}: ${summary.total}`,
    '',
    text.filtersTitle,
    filterLines,
    '',
    text.summaryTitle,
    '',
    `- ${text.bySeverity}: ${formatCounter(summary.bySeverity)}`,
    `- ${text.byStatus}: ${formatCounter(summary.byStatus)}`,
    `- ${text.byHumanStatus}: ${formatCounter(summary.byHumanStatus)}`,
    `- ${text.byType}: ${formatCounter(summary.byType)}`,
    '',
    text.detailsTitle,
    '',
    details || text.noDetails,
    '',
  ].join('\n')
}

function renderMarkdownItem(
  item: SerializedVulnerability,
  locale: ResolvedLocale,
): string {
  const text = MARKDOWN_TEXT[locale]
  return [
    `### ${item.cweId ?? item.type} — ${item.filePath}:${item.line}:${item.column}`,
    '',
    `- id: \`${item.id}\``,
    `- severity: \`${item.severity}\``,
    `- status: \`${item.status}\``,
    `- humanStatus: \`${item.humanStatus}\``,
    `- owaspCategory: ${item.owaspCategory ?? text.notAvailable}`,
    `- createdAt: ${item.createdAt}`,
    `- updatedAt: ${item.updatedAt}`,
    '',
    `${text.description}: ${item.description}`,
    '',
    `${text.riskDescription}: ${item.riskDescription ?? text.notAvailable}`,
    '',
    '```txt',
    item.codeSnippet || '',
    '```',
    '',
    `${text.fixSuggestion}: ${item.fixExplanation ?? text.notAvailable}`,
    '',
    item.fixOldCode
      ? [`${text.beforeFix}:`, '```txt', item.fixOldCode, '```'].join('\n')
      : `${text.beforeFix}: ${text.notAvailable}`,
    '',
    item.fixNewCode
      ? [`${text.afterFix}:`, '```txt', item.fixNewCode, '```'].join('\n')
      : `${text.afterFix}: ${text.notAvailable}`,
    '',
    `${text.aiSummary}: model=${item.aiModel ?? text.notAvailable} confidence=${item.aiConfidence ?? text.notAvailable}`,
    item.aiReasoning
      ? `${text.aiReasoning}: ${item.aiReasoning}`
      : `${text.aiReasoning}: ${text.notAvailable}`,
    item.humanComment
      ? `${text.reviewComment}: ${item.humanComment}`
      : `${text.reviewComment}: ${text.notAvailable}`,
  ].join('\n')
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('\n') || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

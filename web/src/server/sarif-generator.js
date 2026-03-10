import { Buffer } from 'node:buffer'

const DEFAULT_MAX_RESULTS = 10_000
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
const MIN_RESULTS = 25

function toSarifLevel(severity) {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'error'
    case 'medium':
      return 'warning'
    default:
      return 'note'
  }
}

function toSarifSecuritySeverity(severity) {
  switch (severity) {
    case 'critical':
      return '9.5'
    case 'high':
      return '8.0'
    case 'medium':
      return '6.0'
    case 'low':
      return '3.0'
    default:
      return '1.0'
  }
}

function truncateSnippet(value) {
  if (typeof value !== 'string') return ''
  const normalized = value.replace(/\r\n/g, '\n')
  if (normalized.length <= 500) return normalized
  return `${normalized.slice(0, 500)}\n/* ...truncated... */`
}

function buildRules(items) {
  const rulesMap = new Map()

  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const ruleId = String(item.type ?? 'unknown')
    if (rulesMap.has(ruleId)) continue

    rulesMap.set(ruleId, {
      id: ruleId,
      shortDescription: { text: item.cweId ?? ruleId },
      fullDescription: { text: item.description || ruleId },
      help: {
        text: item.fixExplanation || '請依漏洞型別與上下文調整修復策略',
      },
      properties: {
        tags: [item.severity ?? 'info', item.source === 'dast' ? 'dast' : 'sast'],
        precision: 'medium',
        'security-severity': toSarifSecuritySeverity(item.severity),
      },
    })
  }

  return [...rulesMap.values()]
}

function buildResults(items) {
  return items.map((item) => ({
    ruleId: item.type,
    level: toSarifLevel(item.severity),
    message: { text: item.description },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: item.filePath,
            uriBaseId: '%SRCROOT%',
          },
          region: {
            startLine: item.line,
            startColumn: item.column,
            endLine: item.endLine,
            endColumn: item.endColumn,
            snippet: {
              text: truncateSnippet(item.codeSnippet),
            },
          },
        },
      },
    ],
    partialFingerprints: {
      stableFingerprint: item.stableFingerprint,
      codeHash: item.codeHash,
    },
    properties: {
      severity: item.severity,
      status: item.status,
      humanStatus: item.humanStatus,
      source: item.source,
      cweId: item.cweId,
      owaspCategory: item.owaspCategory,
      confidence: item.aiConfidence,
    },
  }))
}

function buildPayload({
  items,
  reportSchemaVersion,
  exportedAt,
  filters,
  category,
  warnings,
}) {
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'Confession',
            informationUri: 'https://github.com/BlackishGreen33/Confession',
            semanticVersion: '0.1.0',
            rules: buildRules(items),
          },
        },
        invocations: [
          {
            executionSuccessful: true,
          },
        ],
        properties: {
          reportSchemaVersion,
          exportedAt,
          filters: filters ?? {},
          category: category ?? null,
          warnings,
        },
        results: buildResults(items),
      },
    ],
  }
}

/**
 * 產生 SARIF 並套用結果數/檔案大小保護。
 * @param {{
 *  items: Array<Record<string, any>>,
 *  reportSchemaVersion: string,
 *  exportedAt: string,
 *  filters?: Record<string, unknown>,
 *  category?: string,
 *  maxResults?: number,
 *  maxBytes?: number,
 * }} input
 */
export function buildSarifPayloadWithGuards(input) {
  const inputMaxResults = Number(input.maxResults)
  const inputMaxBytes = Number(input.maxBytes)

  const maxResults =
    Number.isFinite(inputMaxResults) && inputMaxResults > 0
      ? Math.floor(inputMaxResults)
      : DEFAULT_MAX_RESULTS
  const maxBytes =
    Number.isFinite(inputMaxBytes) && inputMaxBytes > 0
      ? Math.floor(inputMaxBytes)
      : DEFAULT_MAX_BYTES

  let effectiveItems = Array.isArray(input.items) ? [...input.items] : []
  const warnings = []

  if (effectiveItems.length > maxResults) {
    warnings.push(
      `結果數超過上限，已截斷（${effectiveItems.length} -> ${maxResults}）`,
    )
    effectiveItems = effectiveItems.slice(0, maxResults)
  }

  let payload = buildPayload({
    items: effectiveItems,
    reportSchemaVersion: input.reportSchemaVersion,
    exportedAt: input.exportedAt,
    filters: input.filters,
    category: input.category,
    warnings,
  })

  let serialized = JSON.stringify(payload, null, 2)
  let bytes = Buffer.byteLength(serialized, 'utf8')

  if (bytes > maxBytes) {
    let nextSize = effectiveItems.length
    while (nextSize > MIN_RESULTS && bytes > maxBytes) {
      nextSize = Math.max(MIN_RESULTS, Math.floor(nextSize * 0.8))
      effectiveItems = effectiveItems.slice(0, nextSize)
      payload = buildPayload({
        items: effectiveItems,
        reportSchemaVersion: input.reportSchemaVersion,
        exportedAt: input.exportedAt,
        filters: input.filters,
        category: input.category,
        warnings,
      })
      serialized = JSON.stringify(payload, null, 2)
      bytes = Buffer.byteLength(serialized, 'utf8')
    }

    if (bytes > maxBytes) {
      warnings.push(`檔案大小仍高於上限（${bytes} bytes > ${maxBytes} bytes）`)
    } else {
      warnings.push(`檔案大小超限，已截斷結果至 ${effectiveItems.length} 筆`)
    }

    payload = buildPayload({
      items: effectiveItems,
      reportSchemaVersion: input.reportSchemaVersion,
      exportedAt: input.exportedAt,
      filters: input.filters,
      category: input.category,
      warnings,
    })
    serialized = JSON.stringify(payload, null, 2)
    bytes = Buffer.byteLength(serialized, 'utf8')
  }

  return {
    payload,
    warnings,
    resultCount: effectiveItems.length,
    byteSize: bytes,
  }
}

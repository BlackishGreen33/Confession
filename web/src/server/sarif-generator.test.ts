import { describe, expect, it } from 'vitest'

import { buildSarifPayloadWithGuards } from './sarif-generator'

function buildItem(index: number) {
  return {
    id: `v-${index}`,
    filePath: `/repo/src/file-${index}.ts`,
    line: index + 1,
    column: 1,
    endLine: index + 1,
    endColumn: 20,
    codeSnippet: `dangerous(${index})`,
    codeHash: `${index}`.repeat(64).slice(0, 64),
    type: 'xss',
    cweId: 'CWE-79',
    severity: 'high',
    description: '可疑輸入直接進入輸出點',
    riskDescription: null,
    fixOldCode: null,
    fixNewCode: null,
    fixExplanation: null,
    aiModel: null,
    aiConfidence: 0.8,
    aiReasoning: null,
    stableFingerprint: `${index}`.repeat(64).slice(0, 64),
    source: 'sast',
    humanStatus: 'pending',
    humanComment: null,
    humanReviewedAt: null,
    owaspCategory: null,
    status: 'open',
    createdAt: new Date('2026-03-01T00:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-03-01T00:00:00.000Z').toISOString(),
  }
}

describe('sarif-generator', () => {
  it('可產生 SARIF 2.1.0 並保留 stableFingerprint', () => {
    const result = buildSarifPayloadWithGuards({
      items: [buildItem(1)],
      reportSchemaVersion: '2.0.0',
      exportedAt: new Date('2026-03-10T00:00:00.000Z').toISOString(),
      filters: {},
      category: 'confession-baseline-standard',
    })

    expect(result.payload.version).toBe('2.1.0')
    expect(result.payload.runs[0]?.results[0]?.partialFingerprints?.stableFingerprint).toBe(
      buildItem(1).stableFingerprint,
    )
    expect(result.payload.runs[0]?.properties?.category).toBe('confession-baseline-standard')
    expect(result.warnings).toHaveLength(0)
  })

  it('超過 maxResults 時會截斷並產生 warning', () => {
    const result = buildSarifPayloadWithGuards({
      items: [buildItem(1), buildItem(2)],
      reportSchemaVersion: '2.0.0',
      exportedAt: new Date('2026-03-10T00:00:00.000Z').toISOString(),
      maxResults: 1,
    })

    expect(result.resultCount).toBe(1)
    expect(result.warnings.some((item) => item.includes('結果數超過上限'))).toBe(true)
  })

  it('超過 maxBytes 時會嘗試截斷並產生 warning', () => {
    const items = Array.from({ length: 80 }, (_, index) => ({
      ...buildItem(index + 1),
      codeSnippet: 'A'.repeat(1000),
    }))

    const result = buildSarifPayloadWithGuards({
      items,
      reportSchemaVersion: '2.0.0',
      exportedAt: new Date('2026-03-10T00:00:00.000Z').toISOString(),
      maxBytes: 40_000,
    })

    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.resultCount).toBeLessThan(items.length)
  })
})

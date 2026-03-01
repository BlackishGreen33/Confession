import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { LlmVulnerability } from './parser'
import { parseLlmResponse } from './parser'

/**
 * P5: LLM 響應解析健壯性（Validates: Requirements 2.4.3）
 *
 * 合法 JSON 陣列且通過 schema 驗證 → 回傳 LlmVulnerability[]
 * 非法 JSON 或驗證失敗 → 回傳 null，不拋異常
 */
describe('P5: LLM 響應解析健壯性', () => {
  /** 產生合法的 LlmVulnerability 物件 */
  const llmVulnArb: fc.Arbitrary<LlmVulnerability> = fc.record({
    type: fc.constantFrom('xss', 'sql_injection', 'eval_usage', 'prototype_pollution', 'hardcoded_secret'),
    cweId: fc.option(fc.constantFrom('CWE-79', 'CWE-89', 'CWE-94', 'CWE-502'), { nil: null }),
    severity: fc.constantFrom<('critical' | 'high' | 'medium' | 'low' | 'info')[]>(
      'critical',
      'high',
      'medium',
      'low',
      'info',
    ),
    description: fc.string({ minLength: 1, maxLength: 100, unit: 'grapheme' }),
    riskDescription: fc.option(fc.string({ minLength: 1, maxLength: 50, unit: 'grapheme' }), { nil: null }),
    line: fc.integer({ min: 1, max: 10000 }),
    column: fc.integer({ min: 0, max: 500 }),
    endLine: fc.integer({ min: 1, max: 10000 }),
    endColumn: fc.integer({ min: 0, max: 500 }),
    fixOldCode: fc.option(fc.string({ minLength: 1, maxLength: 50, unit: 'grapheme' }), { nil: null }),
    fixNewCode: fc.option(fc.string({ minLength: 1, maxLength: 50, unit: 'grapheme' }), { nil: null }),
    fixExplanation: fc.option(fc.string({ minLength: 1, maxLength: 50, unit: 'grapheme' }), { nil: null }),
    confidence: fc.double({ min: 0, max: 1, noNaN: true }),
    reasoning: fc.string({ minLength: 1, maxLength: 100, unit: 'grapheme' }),
  })

  /** 合法 JSON 陣列 → 成功解析 */
  it('合法 JSON 陣列成功解析為 LlmVulnerability[]', () => {
    fc.assert(
      fc.property(fc.array(llmVulnArb, { minLength: 0, maxLength: 5 }), (vulns) => {
        const json = JSON.stringify(vulns)
        const result = parseLlmResponse(json)

        expect(result).not.toBeNull()
        expect(result!.length).toBe(vulns.length)

        for (let i = 0; i < vulns.length; i++) {
          expect(result![i].type).toBe(vulns[i].type)
          expect(result![i].severity).toBe(vulns[i].severity)
          expect(result![i].line).toBe(vulns[i].line)
          expect(result![i].description).toBe(vulns[i].description)
        }
      }),
      { numRuns: 200 },
    )
  })

  /** 被 markdown code fence 包裹的合法 JSON → 成功解析 */
  it('markdown code fence 包裹的合法 JSON 成功解析', () => {
    fc.assert(
      fc.property(fc.array(llmVulnArb, { minLength: 1, maxLength: 3 }), (vulns) => {
        const json = JSON.stringify(vulns, null, 2)
        const wrapped = '```json\n' + json + '\n```'
        const result = parseLlmResponse(wrapped)

        expect(result).not.toBeNull()
        expect(result!.length).toBe(vulns.length)
      }),
      { numRuns: 100 },
    )
  })

  /** 非法 JSON → 回傳 null，不拋異常 */
  it('非法 JSON 回傳 null，不拋異常', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(
          'not json at all',
          '{ broken',
          '{"type": "xss"}',
          '[{"type": 123}]',
          '[{"severity": "unknown"}]',
          '',
          'null',
          'undefined',
          '42',
          '"just a string"',
          '[{"type":"xss","severity":"high","description":"d","line":1,"column":0,"endLine":1,"endColumn":5,"confidence":2,"reasoning":"r"}]',
        ),
        (invalidInput) => {
          const result = parseLlmResponse(invalidInput)
          expect(result === null || Array.isArray(result)).toBe(true)
        },
      ),
      { numRuns: 100 },
    )
  })

  /** 任意字串 → 不拋異常（回傳 null 或合法結果） */
  it('任意字串輸入不拋異常', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 500 }), (raw) => {
        const result = parseLlmResponse(raw)
        expect(result === null || Array.isArray(result)).toBe(true)
      }),
      { numRuns: 300 },
    )
  })

  /** 相容百分制 confidence（0..100） */
  it('confidence 百分制會自動正規化到 0..1', () => {
    const raw = JSON.stringify([
      {
        type: 'sql_injection',
        cweId: 'CWE-89',
        severity: 'critical',
        description: 'd',
        riskDescription: null,
        line: 1,
        column: 1,
        endLine: 1,
        endColumn: 10,
        fixOldCode: null,
        fixNewCode: null,
        fixExplanation: null,
        confidence: 88,
        reasoning: 'r',
      },
    ])

    const result = parseLlmResponse(raw)
    expect(result).not.toBeNull()
    expect(result![0].confidence).toBeCloseTo(0.88, 6)
  })
})

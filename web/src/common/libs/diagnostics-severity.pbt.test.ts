import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type { DiagnosticLevel, Severity } from './types'
import { mapSeverityToLevel } from './types'

/**
 * P7: Diagnostics 嚴重等級映射（Validates: Requirements 2.7.1）
 *
 * critical/high → error, medium → warning, low/info → information
 * 映射必須對所有合法 Severity 值成立，且結果為有效的 DiagnosticLevel。
 */
describe('P7: Diagnostics 嚴重等級映射', () => {
  const severityArb: fc.Arbitrary<Severity> = fc.constantFrom(
    'critical',
    'high',
    'medium',
    'low',
    'info',
  )

  const errorSeverityArb: fc.Arbitrary<Severity> = fc.constantFrom('critical', 'high')
  const warningSeverityArb: fc.Arbitrary<Severity> = fc.constant('medium')
  const infoSeverityArb: fc.Arbitrary<Severity> = fc.constantFrom('low', 'info')

  const validLevels: DiagnosticLevel[] = ['error', 'warning', 'information']

  it('所有 Severity 映射結果皆為有效 DiagnosticLevel', () => {
    fc.assert(
      fc.property(severityArb, (severity) => {
        const level = mapSeverityToLevel(severity)
        expect(validLevels).toContain(level)
      }),
      { numRuns: 200 },
    )
  })

  it('critical/high → error', () => {
    fc.assert(
      fc.property(errorSeverityArb, (severity) => {
        expect(mapSeverityToLevel(severity)).toBe('error')
      }),
      { numRuns: 100 },
    )
  })

  it('medium → warning', () => {
    fc.assert(
      fc.property(warningSeverityArb, (severity) => {
        expect(mapSeverityToLevel(severity)).toBe('warning')
      }),
      { numRuns: 100 },
    )
  })

  it('low/info → information', () => {
    fc.assert(
      fc.property(infoSeverityArb, (severity) => {
        expect(mapSeverityToLevel(severity)).toBe('information')
      }),
      { numRuns: 100 },
    )
  })
})

import type { VulnerabilityInput } from '@server/db'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import type {
  ExtToWebMsg,
  InteractionPoint,
  PluginConfig,
  ScanRequest,
  Vulnerability,
  WebToExtMsg,
} from '@/libs/types'

/**
 * P4: Agent 消息序列化往返（Validates: Requirements 2.5.5）
 *
 * 所有 Agent 間通信的消息型別經 JSON.stringify → JSON.parse 後
 * 必須與原始物件深度相等，不丟失任何欄位。
 */
describe('P4: Agent 消息序列化往返', () => {
  // === Arbitraries ===

  const interactionPointArb: fc.Arbitrary<InteractionPoint> = fc.record({
    id: fc.uuid(),
    type: fc.constantFrom('dangerous_call', 'sensitive_data', 'unsafe_pattern', 'prototype_mutation') as fc.Arbitrary<InteractionPoint['type']>,
    language: fc.constantFrom('go', 'javascript', 'typescript') as fc.Arbitrary<InteractionPoint['language']>,
    filePath: fc.stringMatching(/^[a-z][a-z0-9/\-_.]{0,30}$/),
    line: fc.nat({ max: 10000 }),
    column: fc.nat({ max: 500 }),
    endLine: fc.nat({ max: 10000 }),
    endColumn: fc.nat({ max: 500 }),
    codeSnippet: fc.string({ minLength: 1, maxLength: 200 }),
    patternName: fc.string({ minLength: 1, maxLength: 50 }),
    confidence: fc.constantFrom('high', 'medium', 'low') as fc.Arbitrary<InteractionPoint['confidence']>,
  })

  const vulnerabilityArb: fc.Arbitrary<Vulnerability> = fc.record({
    id: fc.uuid(),
    filePath: fc.stringMatching(/^[a-z][a-z0-9/\-_.]{0,30}$/),
    line: fc.nat({ max: 10000 }),
    column: fc.nat({ max: 500 }),
    endLine: fc.nat({ max: 10000 }),
    endColumn: fc.nat({ max: 500 }),
    codeSnippet: fc.string({ minLength: 1, maxLength: 200 }),
    codeHash: fc.stringMatching(/^[0-9a-f]{64}$/),
    type: fc.string({ minLength: 1, maxLength: 50 }),
    cweId: fc.option(fc.stringMatching(/^CWE-\d{1,4}$/), { nil: null }),
    severity: fc.constantFrom('critical', 'high', 'medium', 'low', 'info') as fc.Arbitrary<Vulnerability['severity']>,
    description: fc.string({ minLength: 1, maxLength: 200 }),
    riskDescription: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null }),
    fixOldCode: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null }),
    fixNewCode: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null }),
    fixExplanation: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null }),
    aiModel: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
    aiConfidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
    aiReasoning: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null }),
    humanStatus: fc.constantFrom('pending', 'confirmed', 'rejected', 'false_positive') as fc.Arbitrary<Vulnerability['humanStatus']>,
    humanComment: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null }),
    owaspCategory: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
    status: fc.constantFrom('open', 'fixed', 'ignored') as fc.Arbitrary<Vulnerability['status']>,
    createdAt: fc.integer({ min: 946684800000, max: 4102444800000 }).map((ts) => new Date(ts).toISOString()),
    updatedAt: fc.integer({ min: 946684800000, max: 4102444800000 }).map((ts) => new Date(ts).toISOString()),
  })

  const scanRequestArb: fc.Arbitrary<ScanRequest> = fc.record({
    files: fc.array(
      fc.record({
        path: fc.stringMatching(/^[a-z][a-z0-9/\-_.]{0,30}$/),
        content: fc.string({ minLength: 1, maxLength: 100 }),
        language: fc.string({ minLength: 1, maxLength: 20 }),
      }),
      { minLength: 0, maxLength: 5 },
    ),
    depth: fc.constantFrom('quick', 'standard', 'deep') as fc.Arbitrary<ScanRequest['depth']>,
    includeLlmScan: fc.option(fc.boolean(), { nil: undefined }),
    forceRescan: fc.option(fc.boolean(), { nil: undefined }),
    scanScope: fc.option(fc.constantFrom('file', 'workspace'), { nil: undefined }),
    engineMode: fc.option(fc.constantFrom('baseline', 'agentic_beta'), { nil: undefined }),
  })

  const pluginConfigArb: fc.Arbitrary<PluginConfig> = fc.record({
    llm: fc.record({
      provider: fc.constantFrom('gemini', 'nvidia') as fc.Arbitrary<PluginConfig['llm']['provider']>,
      apiKey: fc.string({ minLength: 1, maxLength: 50 }),
      endpoint: fc.option(fc.stringMatching(/^https?:\/\/[a-z0-9.]+$/), { nil: undefined }),
      model: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
    }),
    analysis: fc.record({
      triggerMode: fc.constantFrom('onSave', 'manual') as fc.Arbitrary<PluginConfig['analysis']['triggerMode']>,
      depth: fc.constantFrom('quick', 'standard', 'deep') as fc.Arbitrary<PluginConfig['analysis']['depth']>,
      debounceMs: fc.nat({ max: 5000 }),
      betaAgenticEnabled: fc.boolean(),
    }),
    ignore: fc.record({
      paths: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 5 }),
      types: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { maxLength: 5 }),
    }),
    api: fc.record({
      baseUrl: fc.stringMatching(/^https?:\/\/[a-z0-9.:]+$/),
      mode: fc.constantFrom('local', 'remote') as fc.Arbitrary<PluginConfig['api']['mode']>,
    }),
  })

  const extToWebMsgArb: fc.Arbitrary<ExtToWebMsg> = fc.oneof(
    fc.record({
      type: fc.constant('vulnerabilities_updated') as fc.Arbitrary<'vulnerabilities_updated'>,
      data: fc.array(vulnerabilityArb, { maxLength: 3 }),
    }),
    fc.record({
      type: fc.constant('scan_progress') as fc.Arbitrary<'scan_progress'>,
      data: fc.record({ status: fc.string({ minLength: 1, maxLength: 30 }), progress: fc.double({ min: 0, max: 100, noNaN: true }) }),
    }),
    fc.record({
      type: fc.constant('config_updated') as fc.Arbitrary<'config_updated'>,
      data: pluginConfigArb,
    }),
    fc.record({
      type: fc.constant('operation_result') as fc.Arbitrary<'operation_result'>,
      data: fc.record({
        requestId: fc.string({ minLength: 1, maxLength: 64 }),
        operation: fc.constantFrom(
          'apply_fix',
          'ignore_vulnerability',
          'refresh_vulnerabilities',
          'update_config',
        ) as fc.Arbitrary<
          'apply_fix' | 'ignore_vulnerability' | 'refresh_vulnerabilities' | 'update_config'
        >,
        success: fc.boolean(),
        message: fc.string({ minLength: 1, maxLength: 100 }),
        payload: fc.option(
          fc.record({
            vulnerabilityId: fc.option(fc.uuid(), { nil: undefined }),
            updatedVulnerability: fc.option(vulnerabilityArb, { nil: undefined }),
            config: fc.option(pluginConfigArb, { nil: undefined }),
          }),
          { nil: undefined },
        ),
      }),
    }),
  )

  const webToExtMsgArb: fc.Arbitrary<WebToExtMsg> = fc.oneof(
    fc.record({
      type: fc.constant('request_scan') as fc.Arbitrary<'request_scan'>,
      data: fc.record({ scope: fc.constantFrom('file', 'workspace') as fc.Arbitrary<'file' | 'workspace'> }),
    }),
    fc.record({
      type: fc.constant('apply_fix') as fc.Arbitrary<'apply_fix'>,
      requestId: fc.string({ minLength: 1, maxLength: 64 }),
      data: fc.record({ vulnerabilityId: fc.uuid() }),
    }),
    fc.record({
      type: fc.constant('ignore_vulnerability') as fc.Arbitrary<'ignore_vulnerability'>,
      requestId: fc.string({ minLength: 1, maxLength: 64 }),
      data: fc.record({ vulnerabilityId: fc.uuid(), reason: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }) }),
    }),
    fc.record({
      type: fc.constant('refresh_vulnerabilities') as fc.Arbitrary<'refresh_vulnerabilities'>,
      requestId: fc.string({ minLength: 1, maxLength: 64 }),
    }),
    fc.record({
      type: fc.constant('update_config') as fc.Arbitrary<'update_config'>,
      requestId: fc.string({ minLength: 1, maxLength: 64 }),
      data: pluginConfigArb,
    }),
    fc.record({
      type: fc.constant('request_config') as fc.Arbitrary<'request_config'>,
    }),
    fc.record({
      type: fc.constant('navigate_to_code') as fc.Arbitrary<'navigate_to_code'>,
      data: fc.record({
        filePath: fc.stringMatching(/^[a-z][a-z0-9/\-_.]{0,30}$/),
        line: fc.nat({ max: 10000 }),
        column: fc.nat({ max: 500 }),
      }),
    }),
  )

  const vulnerabilityInputArb: fc.Arbitrary<VulnerabilityInput> = fc.record({
    filePath: fc.stringMatching(/^[a-z][a-z0-9/\-_.]{0,30}$/),
    line: fc.nat({ max: 10000 }),
    column: fc.nat({ max: 500 }),
    endLine: fc.nat({ max: 10000 }),
    endColumn: fc.nat({ max: 500 }),
    codeSnippet: fc.string({ minLength: 1, maxLength: 200 }),
    type: fc.string({ minLength: 1, maxLength: 50 }),
    cweId: fc.option(fc.stringMatching(/^CWE-\d{1,4}$/), { nil: null }),
    severity: fc.constantFrom('critical', 'high', 'medium', 'low', 'info'),
    description: fc.string({ minLength: 1, maxLength: 200 }),
    riskDescription: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null }),
    fixOldCode: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null }),
    fixNewCode: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null }),
    fixExplanation: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null }),
    aiModel: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
    aiConfidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
    aiReasoning: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null }),
    owaspCategory: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
  })

  // === 往返測試函式 ===

  function roundTrip<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T
  }

  // === 屬性測試 ===

  it('InteractionPoint 序列化往返不丟失', () => {
    fc.assert(
      fc.property(interactionPointArb, (msg) => {
        expect(roundTrip(msg)).toEqual(msg)
      }),
      { numRuns: 300 },
    )
  })

  it('Vulnerability 序列化往返不丟失', () => {
    fc.assert(
      fc.property(vulnerabilityArb, (msg) => {
        expect(roundTrip(msg)).toEqual(msg)
      }),
      { numRuns: 300 },
    )
  })

  it('ScanRequest 序列化往返不丟失', () => {
    fc.assert(
      fc.property(scanRequestArb, (msg) => {
        expect(roundTrip(msg)).toEqual(msg)
      }),
      { numRuns: 300 },
    )
  })

  it('ExtToWebMsg 序列化往返不丟失', () => {
    fc.assert(
      fc.property(extToWebMsgArb, (msg) => {
        expect(roundTrip(msg)).toEqual(msg)
      }),
      { numRuns: 300 },
    )
  })

  it('WebToExtMsg 序列化往返不丟失', () => {
    fc.assert(
      fc.property(webToExtMsgArb, (msg) => {
        expect(roundTrip(msg)).toEqual(msg)
      }),
      { numRuns: 300 },
    )
  })

  it('VulnerabilityInput 序列化往返不丟失', () => {
    fc.assert(
      fc.property(vulnerabilityInputArb, (msg) => {
        expect(roundTrip(msg)).toEqual(msg)
      }),
      { numRuns: 300 },
    )
  })
})

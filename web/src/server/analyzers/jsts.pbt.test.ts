import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { analyzeJsTs } from './jsts'

/**
 * P1: AST 分析器完整性（Validates: Requirements 2.3.1, 2.3.4）
 *
 * 含已知高風險模式的代碼必須返回對應交互點，含正確行號和模式名。
 */
describe('P1: AST 分析器完整性', () => {
  /** 安全的前綴行產生器 — 不含任何已知模式的合法 JS 語句 */
  const safeLineArb = fc.constantFrom(
    'const a = 1;',
    'let b = "hello";',
    'console.log(42);',
    'const arr = [1, 2, 3];',
    'const obj = { key: "value" };',
    'function safeFunc() { return true; }',
    'const sum = (x, y) => x + y;',
    'if (true) { /* noop */ }',
    'for (let i = 0; i < 10; i++) {}',
    'const m = new Map();',
  )

  /** 產生 0~5 行安全前綴 */
  const safePrefixArb = fc.array(safeLineArb, { minLength: 0, maxLength: 5 })

  // -----------------------------------------------------------------------
  // 模式定義：每個模式包含程式碼片段、預期 patternName、預期 type
  // -----------------------------------------------------------------------

  interface PatternCase {
    code: string
    patternName: string
    type: string
  }

  const evalPatterns: PatternCase[] = [
    { code: 'eval("alert(1)")', patternName: 'eval', type: 'dangerous_call' },
    { code: "eval('test')", patternName: 'eval', type: 'dangerous_call' },
    { code: 'eval(variable)', patternName: 'eval', type: 'dangerous_call' },
  ]

  const newFunctionPatterns: PatternCase[] = [
    { code: 'new Function("return 1")', patternName: 'Function', type: 'dangerous_call' },
    { code: 'new Function("a", "return a")', patternName: 'Function', type: 'dangerous_call' },
  ]

  const setTimeoutPatterns: PatternCase[] = [
    { code: 'setTimeout("alert(1)", 100)', patternName: 'setTimeout', type: 'dangerous_call' },
    { code: 'setInterval("doEvil()", 500)', patternName: 'setInterval', type: 'dangerous_call' },
  ]

  const innerHtmlPatterns: PatternCase[] = [
    { code: 'el.innerHTML = userInput', patternName: 'innerHTML', type: 'unsafe_pattern' },
    { code: 'el.outerHTML = data', patternName: 'outerHTML', type: 'unsafe_pattern' },
    { code: 'document.body.innerHTML = html', patternName: 'innerHTML', type: 'unsafe_pattern' },
  ]

  const directQueryPatterns: PatternCase[] = [
    { code: 'const x = req.query', patternName: 'direct_query_query', type: 'sensitive_data' },
    { code: 'const x = req.params', patternName: 'direct_query_params', type: 'sensitive_data' },
    { code: 'const x = req.body', patternName: 'direct_query_body', type: 'sensitive_data' },
    { code: 'const x = request.query', patternName: 'direct_query_query', type: 'sensitive_data' },
    { code: 'const x = ctx.body', patternName: 'direct_query_body', type: 'sensitive_data' },
  ]

  const prototypeMutationPatterns: PatternCase[] = [
    { code: 'obj.__proto__ = evil', patternName: '__proto__', type: 'prototype_mutation' },
    { code: 'Object.setPrototypeOf(a, b)', patternName: 'Object.setPrototypeOf', type: 'prototype_mutation' },
    { code: 'MyClass.prototype = newProto', patternName: 'prototype_assignment', type: 'prototype_mutation' },
    { code: 'Object.assign(t, { __proto__: evil })', patternName: 'Object.assign.__proto__', type: 'prototype_mutation' },
  ]

  const allPatterns: PatternCase[] = [
    ...evalPatterns,
    ...newFunctionPatterns,
    ...setTimeoutPatterns,
    ...innerHtmlPatterns,
    ...directQueryPatterns,
    ...prototypeMutationPatterns,
  ]

  const patternArb = fc.constantFrom(...allPatterns)
  const langArb = fc.constantFrom<('javascript' | 'typescript')[]>('javascript', 'typescript')

  it('含已知模式的代碼必須返回對應交互點與正確 patternName', () => {
    fc.assert(
      fc.property(safePrefixArb, patternArb, langArb, (prefix, pattern, lang) => {
        const lines = [...prefix, pattern.code]
        const code = lines.join('\n')
        const expectedLine = prefix.length + 1 // 1-based

        const results = analyzeJsTs(code, 'test.ts', lang)

        // 必須找到至少一個匹配的交互點
        const matched = results.filter((r) => r.patternName === pattern.patternName)
        expect(matched.length).toBeGreaterThanOrEqual(1)

        // 驗證匹配的交互點具有正確的 type
        expect(matched.some((r) => r.type === pattern.type)).toBe(true)

        // 驗證行號正確（模式所在行）
        expect(matched.some((r) => r.line === expectedLine)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it('交互點結構完整性 — 所有必要欄位皆存在且合法', () => {
    fc.assert(
      fc.property(safePrefixArb, patternArb, langArb, (prefix, pattern, lang) => {
        const code = [...prefix, pattern.code].join('\n')
        const results = analyzeJsTs(code, 'src/app.ts', lang)

        for (const r of results) {
          // 必要欄位存在
          expect(r.id).toBeDefined()
          expect(typeof r.id).toBe('string')
          expect(r.filePath).toBe('src/app.ts')
          expect(r.language).toBe(lang)

          // 位置資訊為正整數
          expect(r.line).toBeGreaterThan(0)
          expect(r.column).toBeGreaterThan(0)
          expect(r.endLine).toBeGreaterThanOrEqual(r.line)
          expect(r.endColumn).toBeGreaterThan(0)

          // codeSnippet 非空
          expect(r.codeSnippet.length).toBeGreaterThan(0)

          // type 為合法值
          expect(['dangerous_call', 'sensitive_data', 'unsafe_pattern', 'prototype_mutation']).toContain(r.type)

          // confidence 為合法值
          expect(['high', 'medium', 'low']).toContain(r.confidence)
        }
      }),
      { numRuns: 100 },
    )
  })
})

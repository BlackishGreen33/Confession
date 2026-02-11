import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { buildKeywordIndex, getKeywords, scanKeywords } from './keywords'

/**
 * P2: 關鍵詞索引正確性（Validates: Requirements 2.3.3）
 *
 * 含敏感關鍵詞的文件必須出現在索引中，不含的不出現。
 */
describe('P2: 關鍵詞索引正確性', () => {
  /** 取得所有預設關鍵詞 */
  const allKeywords = getKeywords()

  /** 從預設關鍵詞中隨機選一個 */
  const keywordArb = fc.constantFrom(...allKeywords)

  /** 不含任何預設關鍵詞的安全程式碼行 */
  const safeLineArb = fc.constantFrom(
    'const x = 1;',
    'let y = "hello";',
    'console.log(42);',
    'const arr = [1, 2, 3];',
    'function add(a, b) { return a + b; }',
    'const obj = { key: "value" };',
    'if (true) { /* noop */ }',
    'for (let i = 0; i < 10; i++) {}',
    'const m = new Map();',
    'export default {};',
  )

  /** 產生 0~5 行安全前綴 */
  const safePrefixArb = fc.array(safeLineArb, { minLength: 0, maxLength: 5 })

  /** 隨機檔案路徑 */
  const filePathArb = fc.constantFrom(
    'src/config.ts',
    'lib/auth.ts',
    'utils/db.ts',
    'app/server.ts',
    'index.ts',
  )

  it('含關鍵詞的文件必須出現在倒排索引中', () => {
    fc.assert(
      fc.property(safePrefixArb, keywordArb, filePathArb, (prefix, kw, filePath) => {
        // 構造一行含有關鍵詞的程式碼（用空格隔開確保詞邊界）
        const keywordLine = `const ${kw.keyword} = "sensitive_value";`
        const lines = [...prefix, keywordLine]
        const content = lines.join('\n')

        const index = buildKeywordIndex([{ path: filePath, content }])

        // 該關鍵詞必須出現在索引中
        const entries = index.entries.get(kw.keyword)
        expect(entries).toBeDefined()
        expect(entries!.length).toBeGreaterThanOrEqual(1)

        // 索引中的檔案路徑必須正確
        expect(entries!.some((e) => e.filePath === filePath)).toBe(true)

        // 行號必須正確（前綴行數 + 1，1-based）
        const expectedLine = prefix.length + 1
        expect(entries!.some((e) => e.line === expectedLine)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it('不含關鍵詞的文件不出現在索引中', () => {
    fc.assert(
      fc.property(
        fc.array(safeLineArb, { minLength: 1, maxLength: 10 }),
        filePathArb,
        (safeLines, filePath) => {
          const content = safeLines.join('\n')

          // 先確認安全行確實不含任何關鍵詞
          const hits = scanKeywords(content)
          if (hits.length > 0) return // 跳過意外含關鍵詞的情況

          const index = buildKeywordIndex([{ path: filePath, content }])

          // 索引應為空
          expect(index.entries.size).toBe(0)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('多檔案索引中，僅含關鍵詞的檔案被索引，安全檔案不被索引', () => {
    fc.assert(
      fc.property(safePrefixArb, keywordArb, (prefix, kw) => {
        const keywordLine = `let ${kw.keyword} = getEnvVar();`
        const unsafeContent = [...prefix, keywordLine].join('\n')
        const safeContent = prefix.join('\n') || 'const x = 1;'

        const files = [
          { path: 'unsafe.ts', content: unsafeContent },
          { path: 'safe.ts', content: safeContent },
        ]

        const index = buildKeywordIndex(files)
        const entries = index.entries.get(kw.keyword)

        // 關鍵詞必須在索引中
        expect(entries).toBeDefined()

        // unsafe.ts 必須出現
        expect(entries!.some((e) => e.filePath === 'unsafe.ts')).toBe(true)

        // safe.ts 不應出現在該關鍵詞的索引中
        expect(entries!.every((e) => e.filePath !== 'safe.ts')).toBe(true)
      }),
      { numRuns: 200 },
    )
  })
})

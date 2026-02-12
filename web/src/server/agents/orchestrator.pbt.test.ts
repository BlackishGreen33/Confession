import fc from 'fast-check'
import { describe, expect, it } from 'vitest'

import { groupByLanguage } from './orchestrator'

/**
 * P6: Orchestrator 語言路由正確性（Validates: Requirements 2.5.1）
 *
 * 混合語言檔案 → Go 歸 go 群組，JS/TS 歸 jsts 群組，不遺漏任何檔案。
 */
describe('P6: Orchestrator 語言路由正確性', () => {
  /** 產生單一檔案項目 */
  const fileArb = fc.record({
    path: fc.stringMatching(/^[a-z][a-z0-9/\-_]{0,30}\.[a-z]{1,4}$/),
    content: fc.string({ minLength: 1, maxLength: 100 }),
    language: fc.constantFrom('go', 'javascript', 'typescript'),
  })

  /** 產生混合語言的檔案列表 */
  const filesArb = fc.array(fileArb, { minLength: 0, maxLength: 20 })

  it('Go 檔案全部歸入 go 群組，JS/TS 檔案全部歸入 jsts 群組', () => {
    fc.assert(
      fc.property(filesArb, (files) => {
        const { go, jsts } = groupByLanguage(files)

        // go 群組只含 language === 'go' 的檔案
        for (const f of go) {
          expect(f.language).toBe('go')
        }

        // jsts 群組只含 language === 'javascript' 或 'typescript' 的檔案
        for (const f of jsts) {
          expect(['javascript', 'typescript']).toContain(f.language)
        }
      }),
      { numRuns: 300 },
    )
  })

  it('所有檔案不遺漏 — go + jsts 的總數等於原始檔案數', () => {
    fc.assert(
      fc.property(filesArb, (files) => {
        const { go, jsts } = groupByLanguage(files)

        const goCount = files.filter((f) => f.language === 'go').length
        const jstsCount = files.filter((f) => ['javascript', 'typescript'].includes(f.language)).length

        expect(go.length).toBe(goCount)
        expect(jsts.length).toBe(jstsCount)
        expect(go.length + jsts.length).toBe(files.length)
      }),
      { numRuns: 300 },
    )
  })

  it('檔案內容與路徑在路由後保持不變', () => {
    fc.assert(
      fc.property(filesArb, (files) => {
        const { go, jsts } = groupByLanguage(files)
        const all = [...go, ...jsts]

        // 每個原始檔案都能在路由結果中找到完全相同的物件
        for (const original of files) {
          const found = all.find(
            (f) =>
              f.path === original.path &&
              f.content === original.content &&
              f.language === original.language,
          )
          expect(found).toBeDefined()
        }
      }),
      { numRuns: 200 },
    )
  })
})

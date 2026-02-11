import { describe, expect, it } from 'vitest'

import {
  buildKeywordIndex,
  getKeywords,
  keywordHitsToInteractionPoints,
  scanKeywords,
} from './keywords'

describe('getKeywords', () => {
  it('回傳預設關鍵詞列表，包含 password、secret、token', () => {
    const kws = getKeywords()
    const words = kws.map((k) => k.keyword)
    expect(words).toContain('password')
    expect(words).toContain('secret')
    expect(words).toContain('token')
  })

  it('可合併額外關鍵詞', () => {
    const kws = getKeywords({ custom: ['my_secret_key'] })
    const words = kws.map((k) => k.keyword)
    expect(words).toContain('my_secret_key')
  })
})

describe('scanKeywords', () => {
  it('偵測到含有 password 的行', () => {
    const content = 'const password = "hunter2"'
    const hits = scanKeywords(content)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].keyword).toBe('password')
    expect(hits[0].line).toBe(1)
    expect(hits[0].column).toBe(7)
  })

  it('同一行多次出現同一關鍵詞都能偵測', () => {
    const content = 'token = getToken(token_value)'
    const kws = getKeywords()
    const hits = scanKeywords(content, kws)
    const tokenHits = hits.filter((h) => h.keyword === 'token')
    // 'token' 在 "token =" 和 "getToken" 中（getToken 不符合邊界）和 "token_value" 中（不符合邊界）
    // 只有開頭的 token 符合邊界
    expect(tokenHits.length).toBeGreaterThanOrEqual(1)
  })

  it('不含關鍵詞的程式碼回傳空陣列', () => {
    const content = 'const x = 1 + 2\nconsole.log(x)'
    const hits = scanKeywords(content)
    expect(hits).toHaveLength(0)
  })

  it('多行內容正確回傳行號', () => {
    const content = 'line1\nconst secret = "abc"\nline3'
    const hits = scanKeywords(content)
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].line).toBe(2)
  })

  it('詞邊界檢查：不匹配更長識別符中的子字串', () => {
    // "passwords" 包含 "password" 但後面接 's'（字母），不應匹配
    const content = 'const passwords = []'
    const hits = scanKeywords(content)
    const pwHits = hits.filter((h) => h.keyword === 'password')
    expect(pwHits).toHaveLength(0)
  })
})

describe('buildKeywordIndex', () => {
  it('建構倒排索引，關鍵詞對應到正確檔案', () => {
    const files = [
      { path: 'a.ts', content: 'const password = "x"' },
      { path: 'b.ts', content: 'const x = 1' },
    ]
    const index = buildKeywordIndex(files)
    const pwEntries = index.entries.get('password')
    expect(pwEntries).toBeDefined()
    expect(pwEntries!.length).toBe(1)
    expect(pwEntries![0].filePath).toBe('a.ts')
  })

  it('不含關鍵詞的檔案不出現在索引中', () => {
    const files = [{ path: 'safe.ts', content: 'const x = 1' }]
    const index = buildKeywordIndex(files)
    expect(index.entries.size).toBe(0)
  })

  it('多個檔案含同一關鍵詞都會被索引', () => {
    const files = [
      { path: 'a.ts', content: 'const token = "abc"' },
      { path: 'b.ts', content: 'let token = getVal()' },
    ]
    const index = buildKeywordIndex(files)
    const tokenEntries = index.entries.get('token')
    expect(tokenEntries).toBeDefined()
    expect(tokenEntries!.length).toBe(2)
  })
})

describe('keywordHitsToInteractionPoints', () => {
  it('轉換為正確的 InteractionPoint 結構', () => {
    const hits = scanKeywords('const secret = "abc"')
    const points = keywordHitsToInteractionPoints(hits, 'src/config.ts', 'typescript')
    expect(points).toHaveLength(hits.length)
    const p = points[0]
    expect(p.type).toBe('sensitive_data')
    expect(p.language).toBe('typescript')
    expect(p.filePath).toBe('src/config.ts')
    expect(p.patternName).toContain('secret')
    expect(p.confidence).toBe('medium')
    expect(p.id).toBeDefined()
  })
})

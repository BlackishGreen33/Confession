import { randomUUID } from 'crypto'

import type { InteractionPoint } from '@/lib/types'

/** 預設敏感關鍵詞，依類別分組 */
const DEFAULT_KEYWORDS: Record<string, string[]> = {
  credentials: ['password', 'passwd', 'secret', 'api_key', 'apikey', 'api-key', 'private_key', 'privatekey'],
  tokens: ['token', 'access_token', 'refresh_token', 'auth_token', 'jwt', 'bearer'],
  secrets: ['secret_key', 'secretkey', 'encryption_key', 'signing_key'],
  connection: ['connection_string', 'database_url', 'db_password', 'db_url'],
}

/** 單一關鍵詞命中結果 */
export interface KeywordHit {
  keyword: string
  category: string
  line: number
  column: number
  lineContent: string
}

/** 倒排索引：關鍵詞 → 出現位置列表 { filePath, line, column } */
export interface KeywordIndex {
  entries: Map<string, Array<{ filePath: string; line: number; column: number }>>
}

/**
 * 取得所有預設關鍵詞及其類別的扁平列表。
 * 可傳入額外關鍵詞合併。
 */
export function getKeywords(extra?: Record<string, string[]>): Array<{ keyword: string; category: string }> {
  const merged = { ...DEFAULT_KEYWORDS, ...extra }
  const result: Array<{ keyword: string; category: string }> = []
  for (const [category, words] of Object.entries(merged)) {
    for (const keyword of words) {
      result.push({ keyword: keyword.toLowerCase(), category })
    }
  }
  return result
}

/**
 * 掃描單一檔案內容中的敏感關鍵詞。
 * 回傳所有命中結果，含行號與欄號。
 */
export function scanKeywords(
  content: string,
  keywords?: Array<{ keyword: string; category: string }>,
): KeywordHit[] {
  const kws = keywords ?? getKeywords()
  const hits: KeywordHit[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const lineLower = lines[i].toLowerCase()
    for (const { keyword, category } of kws) {
      let searchFrom = 0
      while (true) {
        const col = lineLower.indexOf(keyword, searchFrom)
        if (col === -1) break
        // 詞邊界檢查：確保關鍵詞不是更長識別符的一部分
        const before = col > 0 ? lineLower[col - 1] : ' '
        const after = col + keyword.length < lineLower.length ? lineLower[col + keyword.length] : ' '
        const isBoundaryBefore = !/[a-z0-9]/.test(before)
        const isBoundaryAfter = !/[a-z0-9]/.test(after)
        if (isBoundaryBefore && isBoundaryAfter) {
          hits.push({
            keyword,
            category,
            line: i + 1, // 從 1 開始
            column: col + 1, // 從 1 開始
            lineContent: lines[i],
          })
        }
        searchFrom = col + keyword.length
      }
    }
  }

  return hits
}

/**
 * 從多個檔案建構倒排索引。
 * 將每個關鍵詞對應到其出現的檔案位置列表。
 */
export function buildKeywordIndex(
  files: Array<{ path: string; content: string }>,
  keywords?: Array<{ keyword: string; category: string }>,
): KeywordIndex {
  const kws = keywords ?? getKeywords()
  const entries = new Map<string, Array<{ filePath: string; line: number; column: number }>>()

  for (const file of files) {
    const hits = scanKeywords(file.content, kws)
    for (const hit of hits) {
      if (!entries.has(hit.keyword)) {
        entries.set(hit.keyword, [])
      }
      entries.get(hit.keyword)!.push({
        filePath: file.path,
        line: hit.line,
        column: hit.column,
      })
    }
  }

  return { entries }
}

/**
 * 將關鍵詞命中結果轉換為 InteractionPoint，
 * 以便與 AST 分析管線整合。
 */
export function keywordHitsToInteractionPoints(
  hits: KeywordHit[],
  filePath: string,
  language: 'go' | 'javascript' | 'typescript',
): InteractionPoint[] {
  return hits.map((hit) => ({
    id: randomUUID(),
    type: 'sensitive_data' as const,
    language,
    filePath,
    line: hit.line,
    column: hit.column,
    endLine: hit.line,
    endColumn: hit.column + hit.keyword.length,
    codeSnippet: hit.lineContent.trim(),
    patternName: `keyword_${hit.category}_${hit.keyword}`,
    confidence: 'medium' as const,
  }))
}

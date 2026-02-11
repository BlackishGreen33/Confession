import { analyzeJsTs } from '@server/analyzers/jsts'
import { keywordHitsToInteractionPoints, scanKeywords } from '@server/analyzers/keywords'

import type { InteractionPoint } from '@/libs/types'

/** 單一檔案輸入 */
export interface JsTsFileInput {
  path: string
  content: string
  language: 'javascript' | 'typescript'
}

/**
 * JS/TS Agent：對一組檔案執行 AST 靜態分析 + 關鍵詞掃描，
 * 合併去重後回傳 InteractionPoint[]。
 */
export async function analyzeJsTsFiles(files: JsTsFileInput[]): Promise<InteractionPoint[]> {
  const results: InteractionPoint[] = []

  for (const file of files) {
    // AST 靜態分析
    const astPoints = analyzeJsTs(file.content, file.path, file.language)

    // 關鍵詞掃描
    const keywordHits = scanKeywords(file.content)
    const keywordPoints = keywordHitsToInteractionPoints(keywordHits, file.path, file.language)

    // 去重：同一位置（filePath + line + column）只保留信心度較高的
    const merged = deduplicatePoints([...astPoints, ...keywordPoints])
    results.push(...merged)
  }

  return results
}

/** 信心度排序權重 */
const CONFIDENCE_WEIGHT: Record<InteractionPoint['confidence'], number> = {
  high: 3,
  medium: 2,
  low: 1,
}

/**
 * 依位置（filePath + line + column）去重，
 * 同一位置保留信心度較高的交互點。
 */
function deduplicatePoints(points: InteractionPoint[]): InteractionPoint[] {
  const map = new Map<string, InteractionPoint>()

  for (const point of points) {
    const key = `${point.filePath}:${point.line}:${point.column}`
    const existing = map.get(key)

    if (!existing || CONFIDENCE_WEIGHT[point.confidence] > CONFIDENCE_WEIGHT[existing.confidence]) {
      map.set(key, point)
    }
  }

  return Array.from(map.values())
}

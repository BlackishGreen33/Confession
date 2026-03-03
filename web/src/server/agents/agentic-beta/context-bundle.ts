import { computeContentHash } from '@server/cache'
import { randomUUID } from 'crypto'

import type { InteractionPoint, ScanRequest } from '@/libs/types'

import type { ContextBlock, ContextBundle } from './types'

const MAX_HOTSPOTS_BY_DEPTH: Record<ScanRequest['depth'], number> = {
  quick: 8,
  standard: 16,
  deep: 24,
}

const WINDOW_LINES_BY_DEPTH: Record<ScanRequest['depth'], number> = {
  quick: 6,
  standard: 12,
  deep: 18,
}

const CONFIDENCE_WEIGHT: Record<InteractionPoint['confidence'], number> = {
  high: 3,
  medium: 2,
  low: 1,
}

export function buildContextBundle(
  filePath: string,
  language: string,
  content: string,
  points: InteractionPoint[],
  depth: ScanRequest['depth'],
): ContextBundle {
  const selected = points
    .slice()
    .sort((a, b) => scorePoint(b) - scorePoint(a))
    .slice(0, MAX_HOTSPOTS_BY_DEPTH[depth])

  return {
    traceId: randomUUID(),
    filePath,
    language,
    content,
    contentDigest: computeContentHash(content),
    depth,
    hotspots: selected,
    contextBlocks: buildContextBlocks(content, selected, WINDOW_LINES_BY_DEPTH[depth]),
    totalLines: content.split('\n').length,
    highRiskHotspotCount: selected.filter((point) => point.confidence === 'high').length,
  }
}

function scorePoint(point: InteractionPoint): number {
  const base = point.type === 'dangerous_call' || point.type === 'prototype_mutation' ? 1000 : 500
  return base + CONFIDENCE_WEIGHT[point.confidence]
}

function buildContextBlocks(
  content: string,
  points: InteractionPoint[],
  windowLines: number,
): ContextBlock[] {
  if (points.length === 0) return []

  const lines = content.split('\n')
  const ranges = points
    .map((point) => ({
      start: Math.max(1, point.line - windowLines),
      end: Math.min(lines.length, point.endLine + windowLines),
    }))
    .sort((a, b) => a.start - b.start)

  const merged: Array<{ start: number; end: number }> = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (!last || range.start > last.end + 1) {
      merged.push({ ...range })
      continue
    }
    last.end = Math.max(last.end, range.end)
  }

  return merged.map((range, index) => ({
    id: `ctx_${index + 1}`,
    startLine: range.start,
    endLine: range.end,
    content: lines
      .slice(range.start - 1, range.end)
      .map((line, lineIndex) => `${range.start + lineIndex}|${line}`)
      .join('\n'),
  }))
}

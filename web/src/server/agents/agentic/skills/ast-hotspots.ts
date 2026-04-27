import type { ContextBundle, SkillExecutionRecord } from '../types'

export function runAstHotspotsSkill(bundle: ContextBundle): SkillExecutionRecord {
  const startedAt = Date.now()
  const evidence = bundle.hotspots.map(
    (point) => `${point.type} ${point.patternName} @${point.line}:${point.column} (${point.confidence})`,
  )

  return {
    skillName: 'ast_hotspots',
    evidence,
    confidence: bundle.hotspots.length > 0 ? 0.9 : 0.2,
    cost: 0,
    latencyMs: Date.now() - startedAt,
    traceId: bundle.traceId,
    success: true,
  }
}

import type { ContextBundle, SkillExecutionRecord } from '../types'

export function runContextSliceSkill(bundle: ContextBundle): SkillExecutionRecord {
  const startedAt = Date.now()
  const evidence = bundle.contextBlocks.map(
    (block) => `${block.id} lines=${block.startLine}-${block.endLine}`,
  )

  return {
    skillName: 'context_slice',
    evidence,
    confidence: bundle.contextBlocks.length > 0 ? 0.85 : 0.1,
    cost: Math.ceil(bundle.contextBlocks.reduce((acc, block) => acc + block.content.length, 0) / 100),
    latencyMs: Date.now() - startedAt,
    traceId: bundle.traceId,
    success: true,
  }
}

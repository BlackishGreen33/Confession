import type { ContextBundle, SkillExecutionRecord } from '../types'

const SANITIZER_PATTERNS = [/sanitize/i, /escape/i, /encode/i, /validator/i]

export function runSanitizerCheckSkill(bundle: ContextBundle): SkillExecutionRecord {
  const startedAt = Date.now()
  const lines = bundle.content.split('\n')
  const evidence: string[] = []

  for (const [index, line] of lines.entries()) {
    if (SANITIZER_PATTERNS.some((pattern) => pattern.test(line))) {
      evidence.push(`sanitizer_found line=${index + 1}: ${line.trim()}`)
    }
  }

  if (evidence.length === 0) {
    evidence.push('未偵測到明確 sanitize/escape/encode 語義')
  }

  return {
    skillName: 'sanitizer_check',
    evidence,
    confidence: evidence.length === 1 && evidence[0].startsWith('未偵測') ? 0.6 : 0.75,
    cost: 0,
    latencyMs: Date.now() - startedAt,
    traceId: bundle.traceId,
    success: true,
  }
}

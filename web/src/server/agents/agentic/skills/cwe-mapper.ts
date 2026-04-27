import type { ContextBundle, SkillExecutionRecord } from '../types'

const CWE_BY_PATTERN: Array<{ pattern: RegExp; cwe: string; label: string }> = [
  { pattern: /eval|Function|exec/i, cwe: 'CWE-94', label: 'Code Injection' },
  { pattern: /innerHTML|outerHTML|xss/i, cwe: 'CWE-79', label: 'Cross-site Scripting' },
  { pattern: /query|params|body|sql/i, cwe: 'CWE-89', label: 'SQL Injection / Input Injection' },
  { pattern: /token|secret|password/i, cwe: 'CWE-200', label: 'Sensitive Information Exposure' },
  { pattern: /proto|prototype/i, cwe: 'CWE-915', label: 'Prototype Pollution' },
]

export function runCweMapperSkill(bundle: ContextBundle): SkillExecutionRecord {
  const startedAt = Date.now()
  const evidence: string[] = []

  for (const point of bundle.hotspots) {
    const matched = CWE_BY_PATTERN.find((item) => item.pattern.test(point.patternName))
    if (!matched) continue
    evidence.push(`${point.patternName} -> ${matched.cwe} (${matched.label})`)
  }

  if (evidence.length === 0) {
    evidence.push('未找到明確 CWE 映射，需交由 LLM 綜合判斷')
  }

  return {
    skillName: 'cwe_mapper',
    evidence,
    confidence: evidence.length > 0 ? 0.65 : 0.25,
    cost: 0,
    latencyMs: Date.now() - startedAt,
    traceId: bundle.traceId,
    success: true,
  }
}

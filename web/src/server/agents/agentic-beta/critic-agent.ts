import type { VulnerabilityInput } from '@server/db'

import type { ContextBundle, CriticResult, SkillExecutionRecord } from './types'

/**
 * Critic Agent：嘗試反證、排除證據不足候選項。
 */
export function runCritic(
  bundle: ContextBundle,
  candidates: VulnerabilityInput[],
  skills: SkillExecutionRecord[],
): CriticResult {
  const accepted: VulnerabilityInput[] = []
  const rejected: CriticResult['rejected'] = []

  for (const vuln of candidates) {
    const supportScore = scoreSupport(bundle, vuln, skills)
    if (supportScore >= 1.2) {
      accepted.push(vuln)
    } else {
      rejected.push({
        vuln,
        reason: `證據不足（supportScore=${supportScore.toFixed(2)}）`,
      })
    }
  }

  return { accepted, rejected }
}

function scoreSupport(
  bundle: ContextBundle,
  vuln: VulnerabilityInput,
  skills: SkillExecutionRecord[],
): number {
  let score = 0

  const nearbyHotspot = bundle.hotspots.some((point) => Math.abs(point.line - vuln.line) <= 3)
  if (nearbyHotspot) score += 0.7

  const hasPatternEvidence = skills.some(
    (record) =>
      record.skillName === 'mcp_pattern_scan' &&
      record.evidence.some((item) => item.includes(`line=${vuln.line}`)),
  )
  if (hasPatternEvidence) score += 0.5

  const sanitizerWeak = skills.some(
    (record) =>
      record.skillName === 'sanitizer_check' &&
      record.evidence.some((item) => item.includes('未偵測到明確 sanitize')),
  )
  if (sanitizerWeak) score += 0.3

  if ((vuln.aiConfidence ?? 0) >= 0.8) score += 0.4
  if ((vuln.aiConfidence ?? 0) <= 0.3) score -= 0.4

  return score
}

import type { VulnerabilityInput } from '@server/storage'

import type { ContextBundle, CriticResult, JudgeResult } from './types'

const MIN_CONFIDENCE_BY_DEPTH: Record<ContextBundle['depth'], number> = {
  quick: 0.55,
  standard: 0.45,
  deep: 0.35,
}

/**
 * Judge Agent：最終裁決輸出，做信心門檻、位置合法性與去重。
 */
export function runJudge(bundle: ContextBundle, critic: CriticResult): JudgeResult {
  const minConfidence = MIN_CONFIDENCE_BY_DEPTH[bundle.depth]
  const totalLines = bundle.totalLines
  const deduped = new Map<string, VulnerabilityInput>()
  const rejected = [...critic.rejected]

  for (const vuln of critic.accepted) {
    const confidence = vuln.aiConfidence ?? 0
    if (confidence < minConfidence) {
      rejected.push({ vuln, reason: `低於門檻 confidence=${confidence.toFixed(2)}` })
      continue
    }

    if (vuln.line < 1 || vuln.line > totalLines) {
      rejected.push({ vuln, reason: `行號超出範圍 line=${vuln.line}` })
      continue
    }

    const key = `${vuln.line}:${vuln.column}:${vuln.endLine}:${vuln.endColumn}:${vuln.type}`
    const existing = deduped.get(key)
    if (!existing || (existing.aiConfidence ?? 0) < confidence) {
      deduped.set(key, {
        ...vuln,
        aiReasoning: appendJudgeReasoning(vuln.aiReasoning),
      })
    }
  }

  return {
    vulnerabilities: Array.from(deduped.values()),
    rejected,
  }
}

function appendJudgeReasoning(reasoning: string | null | undefined): string {
  const base = typeof reasoning === 'string' && reasoning.length > 0 ? reasoning : '未提供推理內容'
  return `${base}\n[Judge] 已通過證據門檻與位置校驗`
}

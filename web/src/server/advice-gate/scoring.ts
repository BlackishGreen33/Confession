import { createHash } from 'crypto'

import type {
  AdviceTriggerContribution,
  AdviceTriggerMetrics,
  AdviceTriggerScoreResult,
} from './types'

export function computeAdviceTriggerScore(
  metrics: AdviceTriggerMetrics,
): AdviceTriggerScoreResult {
  const exposurePressure = clamp((metrics.highRiskMix - 0.2) / 0.5, 0, 1)
  const reliabilityPressure = clamp(
    Math.max(
      (70 - metrics.reliabilityScore) / 40,
      (metrics.fallbackRate - 0.08) / 0.22,
      metrics.healthScore < 60 ? (60 - metrics.healthScore) / 60 : 0,
    ),
    0,
    1,
  )
  const trendPressure = metrics.trendPressureHigh
    ? 1
    : metrics.openNet7d > 0
      ? clamp(metrics.openNet7d / Math.max(4, metrics.openCount || 1), 0, 0.85)
      : 0
  const reviewPressure = clamp((metrics.pendingReviewPressure - 0.2) / 0.4, 0, 1)

  const contributions: AdviceTriggerContribution[] = [
    { key: 'exposure', label: '高風險曝險', pressure: exposurePressure },
    { key: 'reliability', label: '掃描可靠度', pressure: reliabilityPressure },
    { key: 'trend', label: '風險演進壓力', pressure: trendPressure },
    { key: 'review', label: '審核堆積', pressure: reviewPressure },
  ]

  const triggerScore = round(
    (exposurePressure * 0.35 +
      reliabilityPressure * 0.3 +
      trendPressure * 0.2 +
      reviewPressure * 0.15) *
      100,
    2,
  )

  const dominant = contributions
    .filter((item) => item.pressure >= 0.15)
    .sort((a, b) => b.pressure - a.pressure)
    .slice(0, 2)

  const triggerReason =
    dominant.length > 0
      ? `觸發壓力：${dominant.map((item) => `${item.label} ${(item.pressure * 100).toFixed(0)}%`).join('、')}`
      : '目前指標波動仍低於建議觸發區間'

  return { triggerScore, triggerReason, contributions }
}

export function computeAdviceMetricsFingerprint(
  metrics: AdviceTriggerMetrics,
): string {
  const stable = {
    healthScore: round(metrics.healthScore, 1),
    reliabilityScore: round(metrics.reliabilityScore, 1),
    fallbackRate: round(metrics.fallbackRate, 4),
    openCount: metrics.openCount,
    criticalOpenCount: metrics.criticalOpenCount,
    highOpenCount: metrics.highOpenCount,
    pendingOpenCount: metrics.pendingOpenCount,
    highRiskMix: round(metrics.highRiskMix, 4),
    pendingReviewPressure: round(metrics.pendingReviewPressure, 4),
    trendPressureHigh: metrics.trendPressureHigh,
    openNet7d: metrics.openNet7d,
  }
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 2): number {
  const p = 10 ** digits
  return Math.round(value * p) / p
}

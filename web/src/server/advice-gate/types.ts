export const ADVICE_SOURCE_EVENTS = [
  'scan_completed',
  'scan_failed',
  'review_saved',
  'status_changed',
] as const

export type AdviceSourceEvent = (typeof ADVICE_SOURCE_EVENTS)[number]

export type AdviceBlockedReason =
  | 'threshold_not_met'
  | 'cooldown_active'
  | 'same_fingerprint'
  | 'daily_limit_reached'

export interface AdviceActionItem {
  title: string
  reason: string
  expectedImpact: string
}

export interface AdvicePayload {
  summary: string
  confidence: number
  actions: AdviceActionItem[]
}

export interface AdviceLatestResponse {
  available: boolean
  evaluatedAt: string | null
  triggerScore: number | null
  triggerReason: string | null
  sourceEvent: AdviceSourceEvent | null
  stale: boolean
  blockedReason: AdviceBlockedReason | null
  advice: AdvicePayload | null
}

export interface AdviceTriggerMetrics {
  healthScore: number
  reliabilityScore: number
  fallbackRate: number
  openCount: number
  criticalOpenCount: number
  highOpenCount: number
  pendingOpenCount: number
  highRiskMix: number
  pendingReviewPressure: number
  trendPressureHigh: boolean
  openNet7d: number
}

export interface AdviceTriggerContribution {
  key: 'exposure' | 'reliability' | 'trend' | 'review'
  label: string
  pressure: number
}

export interface AdviceTriggerScoreResult {
  triggerScore: number
  triggerReason: string
  contributions: AdviceTriggerContribution[]
}

export interface AdviceGuardInput {
  triggerScore: number
  metricsFingerprint: string
  now: Date
  lastCalledAt?: Date | null
  lastCalledFingerprint?: string | null
  dailyCallCount: number
}

export interface AdviceGuardResult {
  shouldCallAi: boolean
  blockedReason: AdviceBlockedReason | null
}

export interface AdviceGateTriggerInput {
  sourceEvent: AdviceSourceEvent
  sourceTaskId?: string
  sourceVulnerabilityId?: string
}

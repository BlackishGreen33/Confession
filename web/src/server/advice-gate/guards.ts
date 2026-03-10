import type { AdviceGuardInput, AdviceGuardResult } from './types'

const ADVICE_TRIGGER_THRESHOLD = 55
const ADVICE_COOLDOWN_HOURS = 6
const ADVICE_DAILY_CALL_LIMIT = 6
const ADVICE_STALE_HOURS = 72

export function evaluateAdviceDecisionGuards(
  input: AdviceGuardInput,
): AdviceGuardResult {
  if (input.triggerScore < ADVICE_TRIGGER_THRESHOLD) {
    return { shouldCallAi: false, blockedReason: 'threshold_not_met' }
  }

  if (
    input.lastCalledFingerprint &&
    input.lastCalledFingerprint === input.metricsFingerprint
  ) {
    return { shouldCallAi: false, blockedReason: 'same_fingerprint' }
  }

  if (input.lastCalledAt) {
    const cooldownMs = ADVICE_COOLDOWN_HOURS * 60 * 60 * 1000
    if (input.now.getTime() - input.lastCalledAt.getTime() < cooldownMs) {
      return { shouldCallAi: false, blockedReason: 'cooldown_active' }
    }
  }

  if (input.dailyCallCount >= ADVICE_DAILY_CALL_LIMIT) {
    return { shouldCallAi: false, blockedReason: 'daily_limit_reached' }
  }

  return { shouldCallAi: true, blockedReason: null }
}

export function isAdviceStale(updatedAt: Date, now: Date = new Date()): boolean {
  const staleMs = ADVICE_STALE_HOURS * 60 * 60 * 1000
  return now.getTime() - updatedAt.getTime() > staleMs
}

export function startOfUtcDay(now: Date): Date {
  const d = new Date(now)
  d.setUTCHours(0, 0, 0, 0)
  return d
}

import { describe, expect, it } from 'vitest';

import {
  type AdviceTriggerMetrics,
  computeAdviceTriggerScore,
  evaluateAdviceDecisionGuards,
  isAdviceStale,
} from './advice-gate';

function buildMetrics(
  overrides: Partial<AdviceTriggerMetrics> = {}
): AdviceTriggerMetrics {
  return {
    healthScore: overrides.healthScore ?? 78,
    reliabilityScore: overrides.reliabilityScore ?? 82,
    fallbackRate: overrides.fallbackRate ?? 0.04,
    openCount: overrides.openCount ?? 20,
    criticalOpenCount: overrides.criticalOpenCount ?? 2,
    highOpenCount: overrides.highOpenCount ?? 3,
    pendingOpenCount: overrides.pendingOpenCount ?? 3,
    highRiskMix: overrides.highRiskMix ?? 0.25,
    pendingReviewPressure: overrides.pendingReviewPressure ?? 0.2,
    trendPressureHigh: overrides.trendPressureHigh ?? false,
    openNet7d: overrides.openNet7d ?? 0,
  };
}

describe('advice gate formulas', () => {
  it('高壓力指標應提升 triggerScore', () => {
    const lowPressure = computeAdviceTriggerScore(buildMetrics());
    const highPressure = computeAdviceTriggerScore(
      buildMetrics({
        healthScore: 42,
        reliabilityScore: 38,
        fallbackRate: 0.42,
        highRiskMix: 0.86,
        pendingReviewPressure: 0.74,
        trendPressureHigh: true,
        openNet7d: 12,
      })
    );

    expect(highPressure.triggerScore).toBeGreaterThan(lowPressure.triggerScore);
    expect(highPressure.triggerScore).toBeGreaterThanOrEqual(55);
  });

  it('未達門檻時不呼叫 AI', () => {
    const guard = evaluateAdviceDecisionGuards({
      triggerScore: 41,
      metricsFingerprint: 'fp-a',
      now: new Date('2026-03-06T08:00:00.000Z'),
      lastCalledAt: null,
      lastCalledFingerprint: null,
      dailyCallCount: 0,
    });

    expect(guard).toEqual({
      shouldCallAi: false,
      blockedReason: 'threshold_not_met',
    });
  });

  it('冷卻時間內會阻擋重複呼叫', () => {
    const now = new Date('2026-03-06T12:00:00.000Z');
    const guard = evaluateAdviceDecisionGuards({
      triggerScore: 80,
      metricsFingerprint: 'fp-b',
      now,
      lastCalledAt: new Date('2026-03-06T08:30:00.000Z'),
      lastCalledFingerprint: 'fp-a',
      dailyCallCount: 1,
    });

    expect(guard).toEqual({
      shouldCallAi: false,
      blockedReason: 'cooldown_active',
    });
  });

  it('同 fingerprint 會被去重擋下', () => {
    const guard = evaluateAdviceDecisionGuards({
      triggerScore: 80,
      metricsFingerprint: 'fp-same',
      now: new Date('2026-03-06T16:00:00.000Z'),
      lastCalledAt: new Date('2026-03-06T05:00:00.000Z'),
      lastCalledFingerprint: 'fp-same',
      dailyCallCount: 1,
    });

    expect(guard).toEqual({
      shouldCallAi: false,
      blockedReason: 'same_fingerprint',
    });
  });

  it('超過每日上限會阻擋', () => {
    const guard = evaluateAdviceDecisionGuards({
      triggerScore: 82,
      metricsFingerprint: 'fp-c',
      now: new Date('2026-03-06T19:00:00.000Z'),
      lastCalledAt: new Date('2026-03-06T10:00:00.000Z'),
      lastCalledFingerprint: 'fp-b',
      dailyCallCount: 6,
    });

    expect(guard).toEqual({
      shouldCallAi: false,
      blockedReason: 'daily_limit_reached',
    });
  });

  it('超過 stale 門檻後需標記為過期', () => {
    const now = new Date('2026-03-10T12:00:00.000Z');
    const oldSnapshot = new Date('2026-03-06T11:00:00.000Z');
    const freshSnapshot = new Date('2026-03-08T12:30:00.000Z');

    expect(isAdviceStale(oldSnapshot, now)).toBe(true);
    expect(isAdviceStale(freshSnapshot, now)).toBe(false);
  });
});

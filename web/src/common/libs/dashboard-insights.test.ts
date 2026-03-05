import { describe, expect, it } from 'vitest'

import {
  buildRiskPriorityLanes,
  buildSecuritySummary,
  computeRiskPressureScore,
  computeTrendInsights,
  type DashboardInsightInput,
  resolveActionPreset,
} from './dashboard-insights'

function buildInput(overrides: Partial<DashboardInsightInput> = {}): DashboardInsightInput {
  return {
    totalCount: overrides.totalCount ?? 20,
    openCount: overrides.openCount ?? 10,
    bySeverity: overrides.bySeverity ?? {
      critical: 3,
      high: 4,
      medium: 6,
      low: 5,
      info: 2,
    },
    bySeverityOpen: overrides.bySeverityOpen ?? {
      critical: 2,
      high: 3,
      medium: 3,
      low: 1,
      info: 1,
    },
    health: overrides.health ?? null,
    trend:
      overrides.trend ?? [
        { date: '2026-03-01', total: 20, open: 10, fixed: 8, ignored: 2 },
        { date: '2026-03-02', total: 21, open: 11, fixed: 8, ignored: 2 },
        { date: '2026-03-03', total: 22, open: 11, fixed: 9, ignored: 2 },
        { date: '2026-03-04', total: 22, open: 10, fixed: 10, ignored: 2 },
        { date: '2026-03-05', total: 23, open: 10, fixed: 11, ignored: 2 },
      ],
  }
}

describe('dashboard-insights', () => {
  it('critical/open 增加時，風險壓力分數不可下降', () => {
    const baseline = computeRiskPressureScore({
      openBySeverity: {
        critical: 1,
        high: 3,
        medium: 4,
        low: 2,
        info: 1,
      },
    })

    const withMoreCritical = computeRiskPressureScore({
      openBySeverity: {
        critical: 3,
        high: 3,
        medium: 2,
        low: 2,
        info: 1,
      },
    })

    expect(withMoreCritical).toBeGreaterThanOrEqual(baseline)
  })

  it('Priority lanes 配比總和為 100 且每項 >= 0', () => {
    const lanes = buildRiskPriorityLanes(buildInput())
    const totalRatio = lanes.reduce((sum, lane) => sum + lane.ratioPercent, 0)

    expect(totalRatio).toBe(100)
    expect(lanes.every((lane) => lane.ratioPercent >= 0)).toBe(true)
  })

  it('趨勢樣本不足時 ETA 為 null 且顯示保守文案', () => {
    const insights = computeTrendInsights([
      { date: '2026-03-05', total: 10, open: 5, fixed: 4, ignored: 1 },
    ])

    expect(insights.hasEnoughData).toBe(false)
    expect(insights.etaDays).toBeNull()
    expect(insights.metrics.find((item) => item.key === 'eta_days')?.value).toBe('樣本不足')
  })

  it('建議映射：有 critical 時優先導向 critical_open', () => {
    const preset = resolveActionPreset(
      buildInput({
        bySeverityOpen: {
          critical: 2,
          high: 0,
          medium: 1,
          low: 0,
          info: 0,
        },
      }),
    )

    expect(preset).toBe('critical_open')
  })

  it('建議映射：無 critical 且有 high 時導向 high_open，否則 open_all', () => {
    const highPreset = resolveActionPreset(
      buildInput({
        bySeverityOpen: {
          critical: 0,
          high: 4,
          medium: 1,
          low: 0,
          info: 0,
        },
      }),
    )
    const allPreset = resolveActionPreset(
      buildInput({
        bySeverityOpen: {
          critical: 0,
          high: 0,
          medium: 3,
          low: 2,
          info: 1,
        },
      }),
    )

    expect(highPreset).toBe('high_open')
    expect(allPreset).toBe('open_all')
  })

  it('總結卡不重複 KPI：輸出三個衍生信號與可行動建議', () => {
    const summary = buildSecuritySummary(buildInput())
    expect(summary.coreMessage.length).toBeGreaterThan(0)
    expect(summary.solutionMessage.length).toBeGreaterThan(0)
    expect(summary.coreMessage).not.toContain('7日待處理淨變化')
    expect(summary.solutionMessage).not.toContain('修復速度')
    expect(summary.action?.preset).toBeDefined()
    expect(summary.rationale.length).toBeGreaterThanOrEqual(2)
  })
})

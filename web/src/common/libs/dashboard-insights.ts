import type { HealthResponseV2, VulnerabilityFilterPreset } from '@/libs/types'

export interface TrendSnapshotPoint {
  date: string
  total: number
  open: number
  fixed: number
  ignored: number
}

export interface DashboardInsightInput {
  totalCount: number
  openCount: number
  bySeverity: Record<string, number>
  bySeverityOpen?: Record<string, number>
  byHumanStatus?: Record<string, number>
  health?: HealthResponseV2 | null
  trend?: TrendSnapshotPoint[] | null
}

export interface MetricHelpContent {
  formula: string
  meaning: string
  ideal: string
}

export interface SecuritySignal {
  key: 'high_risk_mix' | 'pending_review_pressure' | 'reliability_pressure'
  label: string
  value: string
  tone: 'positive' | 'warning' | 'negative' | 'neutral'
  description: string
  help: MetricHelpContent
}

export interface SecuritySummaryAction {
  label: string
  preset: VulnerabilityFilterPreset
  reason: string
}

export interface SecuritySummary {
  headline: string
  tone: 'safe' | 'warning' | 'danger'
  coreMessage: string
  solutionMessage: string
  action: SecuritySummaryAction | null
  rationale: string[]
}

export interface TrendInsightView {
  key: 'open_net_7d' | 'fix_velocity_7d' | 'eta_days'
  label: string
  value: string
  tone: 'positive' | 'warning' | 'negative' | 'neutral'
  description: string
  help: MetricHelpContent
}

export interface TrendInsights {
  hasEnoughData: boolean
  openNet7d: number | null
  fixVelocityPerDay7d: number | null
  etaDays: number | null
  pressureHigh: boolean
  pressureReason: string | null
  metrics: TrendInsightView[]
}

export interface RiskPriorityLane {
  key: 'critical' | 'high' | 'batch'
  title: string
  subtitle: string
  openCount: number
  ratioPercent: number
  preset: VulnerabilityFilterPreset
  expectedBenefit: string
  tone: 'danger' | 'warning' | 'info'
}

export const PRESET_LABELS: Record<VulnerabilityFilterPreset, string> = {
  critical_open: '嚴重級待處理',
  high_open: '高風險待處理',
  open_all: '全部待處理',
}

const ALLOCATION_COEFFICIENT = {
  critical: 5,
  high: 3,
  medium: 1.5,
  low: 0.7,
  info: 0.7,
} as const

const ZERO_OPEN_BY_SEVERITY: Record<'critical' | 'high' | 'medium' | 'low' | 'info', number> = {
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  info: 0,
}

export const TREND_HELP: Record<TrendInsightView['key'], MetricHelpContent> = {
  open_net_7d: {
    formula: 'openNet7d = open(t) - open(t-7d)',
    meaning: '反映最近 7 天待處理庫存是增加或下降。',
    ideal: '建議 <= 0，代表待處理沒有持續淨增。',
  },
  fix_velocity_7d: {
    formula: 'fixVelocity = (fixed(t) - fixed(t-7d)) / 天數',
    meaning: '反映近期修復節奏，數值越高表示處理吞吐越好。',
    ideal: '建議維持穩定正值，且可追上待處理淨增。',
  },
  eta_days: {
    formula: 'ETA = currentOpen / fixVelocity（fixVelocity>0）',
    meaning: '在當前修復節奏下，清空待處理的估算天數。',
    ideal: '越短越好；若為無法估算，代表目前修復速度不足。',
  },
}

export const RELIABILITY_HELP: MetricHelpContent = {
  formula: 'Reliability = 0.5*success + 0.2*(1-fallback) + 0.3*latency',
  meaning: '衡量掃描成功率、回退率與延遲穩定度。',
  ideal: '建議 >= 80，且 fallback rate 維持低水位。',
}

export const HIGH_RISK_MIX_HELP: MetricHelpContent = {
  formula: '高風險佔比 =（嚴重級 + 高風險級）/ 待處理總數',
  meaning: '衡量待處理中高風險所佔比例，越高代表越需要先止血。',
  ideal: '建議優先壓低到 30% 以下。',
}

export const PENDING_REVIEW_HELP: MetricHelpContent = {
  formula: 'pendingReviewPressure = pending_review / open_total',
  meaning: '衡量待審核決策堆積程度，越高表示修復決策被卡住。',
  ideal: '建議維持低水位，避免長期高於 35%。',
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 1): number {
  const m = 10 ** digits
  return Math.round(value * m) / m
}

function normalizeOpenBySeverity(params: {
  bySeverity: Record<string, number>
  bySeverityOpen?: Record<string, number>
  openCount: number
  totalCount: number
}): Record<'critical' | 'high' | 'medium' | 'low' | 'info', number> {
  const { bySeverity, bySeverityOpen, openCount, totalCount } = params

  const hasOpenBySeverity =
    !!bySeverityOpen &&
    Object.values(bySeverityOpen).some((value) => typeof value === 'number' && value > 0)

  if (hasOpenBySeverity && bySeverityOpen) {
    return {
      critical: Math.max(0, bySeverityOpen.critical ?? 0),
      high: Math.max(0, bySeverityOpen.high ?? 0),
      medium: Math.max(0, bySeverityOpen.medium ?? 0),
      low: Math.max(0, bySeverityOpen.low ?? 0),
      info: Math.max(0, bySeverityOpen.info ?? 0),
    }
  }

  if (openCount <= 0 || totalCount <= 0) {
    return { ...ZERO_OPEN_BY_SEVERITY }
  }

  const severities: Array<'critical' | 'high' | 'medium' | 'low' | 'info'> = [
    'critical',
    'high',
    'medium',
    'low',
    'info',
  ]

  const totalBySeverity = severities.reduce((sum, key) => sum + Math.max(0, bySeverity[key] ?? 0), 0)
  if (totalBySeverity <= 0) {
    return { ...ZERO_OPEN_BY_SEVERITY }
  }

  const rawAllocations = severities.map((key) => {
    const ratio = Math.max(0, (bySeverity[key] ?? 0) / totalBySeverity)
    const raw = openCount * ratio
    const base = Math.floor(raw)
    return { key, raw, base, frac: raw - base }
  })

  let remain = Math.max(0, openCount - rawAllocations.reduce((sum, item) => sum + item.base, 0))
  rawAllocations.sort((a, b) => b.frac - a.frac)
  for (const item of rawAllocations) {
    if (remain <= 0) break
    item.base += 1
    remain -= 1
  }

  const map = new Map(rawAllocations.map((item) => [item.key, item.base]))
  return {
    critical: map.get('critical') ?? 0,
    high: map.get('high') ?? 0,
    medium: map.get('medium') ?? 0,
    low: map.get('low') ?? 0,
    info: map.get('info') ?? 0,
  }
}

function formatDelta(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '樣本不足'
  const rounded = Math.round(value)
  if (rounded > 0) return `+${rounded}`
  if (rounded < 0) return `${rounded}`
  return '0'
}

function formatFloat(value: number | null, digits = 1, suffix = ''): string {
  if (value === null || Number.isNaN(value)) return '樣本不足'
  return `${round(value, digits)}${suffix}`
}

function toReliabilitySignal(health?: HealthResponseV2 | null): SecuritySignal {
  const reliability = health?.score.components.reliability.value
  const fallbackRate = health?.score.components.reliability.fallbackRate

  if (typeof reliability !== 'number' || typeof fallbackRate !== 'number') {
    return {
      key: 'reliability_pressure',
      label: '可靠度壓力',
      value: '資料不足',
      tone: 'neutral',
      description: '尚未取得足夠掃描樣本，暫時無法判斷可靠度壓力。',
      help: RELIABILITY_HELP,
    }
  }

  const tone: SecuritySignal['tone'] =
    reliability < 60 || fallbackRate > 0.2
      ? 'negative'
      : reliability < 75 || fallbackRate > 0.1
        ? 'warning'
        : 'positive'

  return {
    key: 'reliability_pressure',
    label: '可靠度壓力',
    value: `${reliability.toFixed(1)} / fallback ${(fallbackRate * 100).toFixed(1)}%`,
    tone,
    description:
      tone === 'negative'
        ? '可靠度偏弱，建議優先穩定掃描流程再擴大修復節奏。'
        : tone === 'warning'
          ? '可靠度可用但仍有回退成本，建議持續觀察。'
          : '可靠度穩定，可維持目前掃描與修復節奏。',
    help: RELIABILITY_HELP,
  }
}

export function computeTrendInsights(trend?: TrendSnapshotPoint[] | null): TrendInsights {
  if (!trend || trend.length < 2) {
    return {
      hasEnoughData: false,
      openNet7d: null,
      fixVelocityPerDay7d: null,
      etaDays: null,
      pressureHigh: false,
      pressureReason: null,
      metrics: [
        {
          key: 'open_net_7d',
          label: '7日待處理淨變化',
          value: '樣本不足',
          tone: 'neutral',
          description: '資料不足，暫時無法計算近 7 天待處理淨變化。',
          help: TREND_HELP.open_net_7d,
        },
        {
          key: 'fix_velocity_7d',
          label: '修復速度',
          value: '樣本不足',
          tone: 'neutral',
          description: '資料不足，暫時無法估算修復節奏。',
          help: TREND_HELP.fix_velocity_7d,
        },
        {
          key: 'eta_days',
          label: '清空估算',
          value: '樣本不足',
          tone: 'neutral',
          description: '至少需要兩筆趨勢資料才能推估 ETA。',
          help: TREND_HELP.eta_days,
        },
      ],
    }
  }

  const windowPoints = trend.slice(-7)
  const first = windowPoints[0]
  const last = windowPoints[windowPoints.length - 1]
  const days = Math.max(1, windowPoints.length - 1)

  const openNet7d = last.open - first.open
  const fixedDelta7d = last.fixed - first.fixed
  const fixVelocityPerDay7d = fixedDelta7d / days
  const etaDays = fixVelocityPerDay7d > 0 ? last.open / fixVelocityPerDay7d : null

  let risingStreak = 0
  let maxRisingStreak = 0
  for (let i = 1; i < windowPoints.length; i += 1) {
    const delta = windowPoints[i].open - windowPoints[i - 1].open
    if (delta > 0) {
      risingStreak += 1
      maxRisingStreak = Math.max(maxRisingStreak, risingStreak)
    } else {
      risingStreak = 0
    }
  }

  const pressureHigh =
    openNet7d > 0 &&
    (maxRisingStreak >= 2 || openNet7d >= Math.max(3, Math.ceil((first.open || 1) * 0.2)))
  const pressureReason = pressureHigh
    ? maxRisingStreak >= 2
      ? '待處理連續上升，風險壓力正在累積。'
      : '待處理淨增超過警戒值，建議優先壓低新增量。'
    : null

  const openTone: TrendInsightView['tone'] = openNet7d > 0 ? 'negative' : openNet7d < 0 ? 'positive' : 'warning'
  const velocityTone: TrendInsightView['tone'] =
    fixVelocityPerDay7d > 0 ? 'positive' : fixVelocityPerDay7d < 0 ? 'negative' : 'warning'
  const etaTone: TrendInsightView['tone'] = etaDays === null ? 'warning' : etaDays > 30 ? 'negative' : etaDays > 14 ? 'warning' : 'positive'

  return {
    hasEnoughData: true,
    openNet7d,
    fixVelocityPerDay7d,
    etaDays,
    pressureHigh,
    pressureReason,
    metrics: [
      {
        key: 'open_net_7d',
        label: '7日待處理淨變化',
        value: formatDelta(openNet7d),
        tone: openTone,
        description: openNet7d > 0 ? '待處理正在上升，需提升處理速度。' : '待處理未淨增，節奏可控。',
        help: TREND_HELP.open_net_7d,
      },
      {
        key: 'fix_velocity_7d',
        label: '修復速度',
        value: `${formatFloat(fixVelocityPerDay7d, 1)} / 日`,
        tone: velocityTone,
        description:
          fixVelocityPerDay7d > 0
            ? '目前有持續修復吞吐，可用於估算清空時間。'
            : '修復速度不足，待處理可能持續堆積。',
        help: TREND_HELP.fix_velocity_7d,
      },
      {
        key: 'eta_days',
        label: '清空估算',
        value: etaDays === null ? '無法估算' : `${Math.ceil(etaDays)} 天`,
        tone: etaTone,
        description:
          etaDays === null
            ? '目前修復速度不足，尚無法估算清空時間。'
            : `若維持現速，約 ${Math.ceil(etaDays)} 天可清空待處理。`,
        help: TREND_HELP.eta_days,
      },
    ],
  }
}

export function computeRiskPressureScore(params: {
  openBySeverity: Record<'critical' | 'high' | 'medium' | 'low' | 'info', number>
}): number {
  const weighted =
    params.openBySeverity.critical * ALLOCATION_COEFFICIENT.critical +
    params.openBySeverity.high * ALLOCATION_COEFFICIENT.high +
    params.openBySeverity.medium * ALLOCATION_COEFFICIENT.medium +
    params.openBySeverity.low * ALLOCATION_COEFFICIENT.low +
    params.openBySeverity.info * ALLOCATION_COEFFICIENT.info

  const totalOpen = Object.values(params.openBySeverity).reduce((sum, value) => sum + value, 0)
  if (totalOpen <= 0) return 0

  const maxWeighted = totalOpen * ALLOCATION_COEFFICIENT.critical
  return clamp(weighted / maxWeighted, 0, 1)
}

export function buildRiskPriorityLanes(input: DashboardInsightInput): RiskPriorityLane[] {
  const openBySeverity = normalizeOpenBySeverity({
    bySeverity: input.bySeverity,
    bySeverityOpen: input.bySeverityOpen,
    openCount: input.openCount,
    totalCount: input.totalCount,
  })

  const weightedCritical = openBySeverity.critical * ALLOCATION_COEFFICIENT.critical
  const weightedHigh = openBySeverity.high * ALLOCATION_COEFFICIENT.high
  const weightedBatch =
    openBySeverity.medium * ALLOCATION_COEFFICIENT.medium +
    (openBySeverity.low + openBySeverity.info) * ALLOCATION_COEFFICIENT.low

  const weightedTotal = weightedCritical + weightedHigh + weightedBatch

  const laneRatios =
    weightedTotal > 0
      ? {
          critical: Math.round((weightedCritical / weightedTotal) * 100),
          high: Math.round((weightedHigh / weightedTotal) * 100),
          batch: Math.round((weightedBatch / weightedTotal) * 100),
        }
      : { critical: 34, high: 33, batch: 33 }

  const ratioDiff = 100 - (laneRatios.critical + laneRatios.high + laneRatios.batch)
  if (ratioDiff !== 0) {
    laneRatios.critical += ratioDiff
  }

  return [
    {
      key: 'critical',
      title: '嚴重級即時處理',
      subtitle: '先阻斷高爆炸半徑風險',
      openCount: openBySeverity.critical,
      ratioPercent: laneRatios.critical,
      preset: 'critical_open',
      expectedBenefit: '優先降低高衝擊暴露，最快拉低風險上限。',
      tone: 'danger',
    },
    {
      key: 'high',
      title: '高風險快速清理',
      subtitle: '壓低中高風險累積速度',
      openCount: openBySeverity.high,
      ratioPercent: laneRatios.high,
      preset: 'high_open',
      expectedBenefit: '穩定降低待處理淨增，避免風險長尾。',
      tone: 'warning',
    },
    {
      key: 'batch',
      title: '中低風險批次修復',
      subtitle: '利用低成本時段批量收斂',
      openCount: openBySeverity.medium + openBySeverity.low + openBySeverity.info,
      ratioPercent: laneRatios.batch,
      preset: 'open_all',
      expectedBenefit: '持續清庫存，避免中低風險堆積為維護負擔。',
      tone: 'info',
    },
  ]
}

export function buildSecuritySummary(input: DashboardInsightInput): SecuritySummary {
  const openBySeverity = normalizeOpenBySeverity({
    bySeverity: input.bySeverity,
    bySeverityOpen: input.bySeverityOpen,
    openCount: input.openCount,
    totalCount: input.totalCount,
  })

  const trendInsights = computeTrendInsights(input.trend)
  const reliabilitySignal = toReliabilitySignal(input.health)
  const pendingReview = Math.max(0, input.byHumanStatus?.pending ?? 0)
  const pendingReviewPressure = input.openCount > 0 ? pendingReview / input.openCount : 0

  const criticalOpen = openBySeverity.critical
  const highOpen = openBySeverity.high

  let headline = '目前風險趨勢穩定，可持續按節奏處理。'
  let tone: SecuritySummary['tone'] = 'safe'
  let coreMessage = '目前沒有立即風險阻塞，可維持既有節奏。'
  let solutionMessage = '持續工作區掃描與審核抽樣，避免新風險累積。'
  let action: SecuritySummaryAction | null = null

  if (input.openCount <= 0) {
    headline = '目前沒有待處理漏洞，建議維持掃描與審核節奏。'
    tone = 'safe'
    coreMessage = '目前沒有待處理風險。'
    solutionMessage = '維持例行掃描與審核節奏，避免風險回升。'
    action = null
  } else if (criticalOpen > 0) {
    headline = `嚴重級待處理 ${criticalOpen} 筆，建議先止血。`
    tone = 'danger'
    coreMessage = '最高衝擊面尚未收斂，整體暴露上限仍偏高。'
    solutionMessage = '先修嚴重級待處理，完成後再收斂高風險。'
    action = {
      label: '立即處理嚴重級',
      preset: 'critical_open',
      reason: '先壓低最高風險面，最快降低暴露上限。',
    }
  } else if (highOpen > 0) {
    headline = `高風險待處理 ${highOpen} 筆，建議優先收斂。`
    tone = 'warning'
    coreMessage = '高風險庫存仍偏高，可能持續擠壓修復節奏。'
    solutionMessage = '優先清理高風險項，再進行中低風險批次修復。'
    action = {
      label: '優先清理高風險',
      preset: 'high_open',
      reason: '先穩住中高風險，避免待處理持續堆積。',
    }
  } else if (pendingReviewPressure >= 0.35) {
    headline = `待審核堆積 ${pendingReview} 筆，修復決策受阻。`
    tone = 'warning'
    coreMessage = '主要瓶頸是審核流量不足，導致修復動作被卡住。'
    solutionMessage = '先清待審核，再推進已確認項目的修復與忽略決策。'
    action = {
      label: '先清待審核',
      preset: 'open_all',
      reason: '先解除審核瓶頸，才能穩定提升修復吞吐。',
    }
  } else if (reliabilitySignal.tone === 'negative') {
    headline = '掃描可靠度偏弱，建議先穩定引擎再加速修復。'
    tone = 'warning'
    coreMessage = '掃描可靠度偏低，會影響判斷與後續修復效率。'
    solutionMessage = '先穩定掃描成功率與回退率，再擴大修復節奏。'
    action = {
      label: '查看待處理清單',
      preset: 'open_all',
      reason: '先穩定掃描流程，避免修復決策建立在不穩定輸出上。',
    }
  } else {
    headline = '目前仍有待處理項目，建議以批次方式快速清庫存。'
    tone = trendInsights.pressureHigh ? 'warning' : 'safe'
    coreMessage = '目前無高風險堵點，主要任務是持續清理待處理庫存。'
    solutionMessage = '採批次修復，維持穩定吞吐並防止庫存回升。'
    action = {
      label: '查看待處理清單',
      preset: 'open_all',
      reason: '已無高風險堵點，適合進入批次清理階段。',
    }
  }

  if (trendInsights.pressureHigh && input.openCount > 0) {
    tone = tone === 'danger' ? 'danger' : 'warning'
  }

  const rationale = [
    `風險壓力分數：${Math.round(
      computeRiskPressureScore({ openBySeverity }) * 100,
    )} / 100（依 severity 權重估算）`,
    trendInsights.pressureReason ?? '近期趨勢未觸發上升壓力警戒。',
    reliabilitySignal.description,
  ]

  return {
    headline,
    tone,
    coreMessage,
    solutionMessage,
    action,
    rationale,
  }
}

export function resolveActionPreset(input: DashboardInsightInput): VulnerabilityFilterPreset {
  const openBySeverity = normalizeOpenBySeverity({
    bySeverity: input.bySeverity,
    bySeverityOpen: input.bySeverityOpen,
    openCount: input.openCount,
    totalCount: input.totalCount,
  })

  if (openBySeverity.critical > 0) return 'critical_open'
  if (openBySeverity.high > 0) return 'high_open'
  return 'open_all'
}

export function presetToFilters(preset: VulnerabilityFilterPreset): {
  status: 'open'
  severity: 'critical' | 'high' | undefined
  search: string
} {
  if (preset === 'critical_open') {
    return { status: 'open', severity: 'critical', search: '' }
  }
  if (preset === 'high_open') {
    return { status: 'open', severity: 'high', search: '' }
  }
  return { status: 'open', severity: undefined, search: '' }
}

import type { ResolvedLocale } from '@/libs/i18n'
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
  focusCount: number | null
  kpi: {
    label: string
    current: string
    target: string
  }
}

export type SecurityMissionStage = 'stop-bleed' | 'converge' | 'stabilize'

export interface SecuritySummaryProgress {
  score: number
  statusLabel: string
  stage: SecurityMissionStage
  stageIndex: number
  stageReason: string
}

export interface SecuritySummary {
  headline: string
  tone: 'safe' | 'warning' | 'danger'
  coreMessage: string
  solutionMessage: string
  dataTime: string | null
  dataSourceLabel: string
  progress: SecuritySummaryProgress
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

const PRESET_LABEL_TEXT: Record<
  VulnerabilityFilterPreset,
  { 'zh-TW': string; 'zh-CN': string; en: string }
> = {
  critical_open: {
    'zh-TW': '嚴重級待處理',
    'zh-CN': '严重级待处理',
    en: 'Open Critical',
  },
  high_open: {
    'zh-TW': '高風險待處理',
    'zh-CN': '高风险待处理',
    en: 'Open High Risk',
  },
  open_all: {
    'zh-TW': '全部待處理',
    'zh-CN': '全部待处理',
    en: 'All Open',
  },
}

export const PRESET_LABELS: Record<VulnerabilityFilterPreset, string> = {
  critical_open: PRESET_LABEL_TEXT.critical_open['zh-TW'],
  high_open: PRESET_LABEL_TEXT.high_open['zh-TW'],
  open_all: PRESET_LABEL_TEXT.open_all['zh-TW'],
}

export function getPresetLabel(
  preset: VulnerabilityFilterPreset,
  locale: ResolvedLocale = 'zh-TW',
): string {
  return PRESET_LABEL_TEXT[preset][locale]
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

function getTrendHelp(
  locale: ResolvedLocale,
): Record<TrendInsightView['key'], MetricHelpContent> {
  return {
    open_net_7d: {
      formula: 'openNet7d = open(t) - open(t-7d)',
      meaning: lt(locale, {
        'zh-TW': '反映最近 7 天待處理庫存是增加或下降。',
        'zh-CN': '反映最近 7 天待处理库存是增加或下降。',
        en: 'Shows whether open backlog increased or decreased over the last 7 days.',
      }),
      ideal: lt(locale, {
        'zh-TW': '建議 <= 0，代表待處理沒有持續淨增。',
        'zh-CN': '建议 <= 0，表示待处理没有持续净增。',
        en: 'Target <= 0, meaning no sustained net increase in open backlog.',
      }),
    },
    fix_velocity_7d: {
      formula: 'fixVelocity = (fixed(t) - fixed(t-7d)) / days',
      meaning: lt(locale, {
        'zh-TW': '反映近期修復節奏，數值越高表示處理吞吐越好。',
        'zh-CN': '反映近期修复节奏，数值越高表示处理吞吐越好。',
        en: 'Indicates recent remediation pace. Higher value means better throughput.',
      }),
      ideal: lt(locale, {
        'zh-TW': '建議維持穩定正值，且可追上待處理淨增。',
        'zh-CN': '建议维持稳定正值，且可追上待处理净增。',
        en: 'Keep it stably positive and high enough to catch open net increase.',
      }),
    },
    eta_days: {
      formula: 'ETA = currentOpen / fixVelocity (fixVelocity>0)',
      meaning: lt(locale, {
        'zh-TW': '在當前修復節奏下，清空待處理的估算天數。',
        'zh-CN': '在当前修复节奏下，清空待处理的估算天数。',
        en: 'Estimated days to clear open backlog at the current fix velocity.',
      }),
      ideal: lt(locale, {
        'zh-TW': '越短越好；若為無法估算，代表目前修復速度不足。',
        'zh-CN': '越短越好；若无法估算，表示当前修复速度不足。',
        en: 'Shorter is better. N/A means current fix velocity is insufficient.',
      }),
    },
  }
}

function getReliabilityHelp(locale: ResolvedLocale): MetricHelpContent {
  return {
    formula: 'Reliability = 0.5*success + 0.2*(1-fallback) + 0.3*latency',
    meaning: lt(locale, {
      'zh-TW': '衡量掃描成功率、回退率與延遲穩定度。',
      'zh-CN': '衡量扫描成功率、回退率与延迟稳定度。',
      en: 'Measures scan success rate, fallback rate, and latency stability.',
    }),
    ideal: lt(locale, {
      'zh-TW': '建議 >= 80，且 fallback rate 維持低水位。',
      'zh-CN': '建议 >= 80，且 fallback rate 维持低水位。',
      en: 'Target >= 80 with a low fallback rate.',
    }),
  }
}

export const HIGH_RISK_MIX_HELP: MetricHelpContent = {
  formula: 'highRiskRatio = (critical + high) / open_total',
  meaning: 'High-risk share in open backlog.',
  ideal: 'Target below 30%.',
}

export const PENDING_REVIEW_HELP: MetricHelpContent = {
  formula: 'pendingReviewPressure = pending_review / open_total',
  meaning: 'Pending-review pressure in decision flow.',
  ideal: 'Keep below 35%.',
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

function formatDelta(
  value: number | null,
  locale: ResolvedLocale = 'zh-TW',
): string {
  if (value === null || Number.isNaN(value)) {
    return lt(locale, {
      'zh-TW': '樣本不足',
      'zh-CN': '样本不足',
      en: 'Not enough samples',
    })
  }
  const rounded = Math.round(value)
  if (rounded > 0) return `+${rounded}`
  if (rounded < 0) return `${rounded}`
  return '0'
}

function formatFloat(
  value: number | null,
  digits = 1,
  suffix = '',
  locale: ResolvedLocale = 'zh-TW',
): string {
  if (value === null || Number.isNaN(value)) {
    return lt(locale, {
      'zh-TW': '樣本不足',
      'zh-CN': '样本不足',
      en: 'Not enough samples',
    })
  }
  return `${round(value, digits)}${suffix}`
}

function lt(
  locale: ResolvedLocale,
  text: { 'zh-TW': string; 'zh-CN': string; en: string },
): string {
  return text[locale]
}

function toReliabilitySignal(
  health?: HealthResponseV2 | null,
  locale: ResolvedLocale = 'zh-TW',
): SecuritySignal {
  const reliability = health?.score.components.reliability.value
  const fallbackRate = health?.score.components.reliability.fallbackRate
  const reliabilityHelp = getReliabilityHelp(locale)

  if (typeof reliability !== 'number' || typeof fallbackRate !== 'number') {
    return {
      key: 'reliability_pressure',
      label: lt(locale, {
        'zh-TW': '可靠度壓力',
        'zh-CN': '可靠度压力',
        en: 'Reliability Pressure',
      }),
      value: lt(locale, {
        'zh-TW': '資料不足',
        'zh-CN': '数据不足',
        en: 'Insufficient data',
      }),
      tone: 'neutral',
      description: lt(locale, {
        'zh-TW': '尚未取得足夠掃描樣本，暫時無法判斷可靠度壓力。',
        'zh-CN': '尚未取得足够扫描样本，暂时无法判断可靠度压力。',
        en: 'Not enough scan samples to evaluate reliability pressure yet.',
      }),
      help: reliabilityHelp,
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
    label: lt(locale, {
      'zh-TW': '可靠度壓力',
      'zh-CN': '可靠度压力',
      en: 'Reliability Pressure',
    }),
    value: `${reliability.toFixed(1)} / fallback ${(fallbackRate * 100).toFixed(1)}%`,
    tone,
    description:
      tone === 'negative'
        ? lt(locale, {
            'zh-TW': '可靠度偏弱，建議優先穩定掃描流程再擴大修復節奏。',
            'zh-CN': '可靠度偏弱，建议优先稳定扫描流程再扩大修复节奏。',
            en: 'Reliability is weak; stabilize scan flow before accelerating remediation.',
          })
        : tone === 'warning'
          ? lt(locale, {
              'zh-TW': '可靠度可用但仍有回退成本，建議持續觀察。',
              'zh-CN': '可靠度可用但仍有回退成本，建议持续观察。',
              en: 'Reliability is acceptable but fallback cost remains; keep monitoring.',
            })
          : lt(locale, {
              'zh-TW': '可靠度穩定，可維持目前掃描與修復節奏。',
              'zh-CN': '可靠度稳定，可维持当前扫描与修复节奏。',
              en: 'Reliability is stable; current scan/remediation cadence can be maintained.',
            }),
    help: reliabilityHelp,
  }
}

function formatPercent(value: number, digits = 0): string {
  return `${round(value * 100, digits)}%`
}

function toReliabilityPressure(health?: HealthResponseV2 | null): number {
  const reliability = health?.score.components.reliability.value
  const fallbackRate = health?.score.components.reliability.fallbackRate

  if (typeof reliability !== 'number' || typeof fallbackRate !== 'number') {
    return 0.35
  }

  const reliabilityPenalty = clamp((80 - reliability) / 80, 0, 1)
  const fallbackPenalty = clamp((fallbackRate - 0.05) / 0.35, 0, 1)
  return clamp(reliabilityPenalty * 0.7 + fallbackPenalty * 0.3, 0, 1)
}

function toTrendPressure(params: {
  openNet7d: number | null
  openCount: number
}): number {
  const { openNet7d, openCount } = params
  if (openNet7d === null || openNet7d <= 0) return 0
  const tolerance = Math.max(1, Math.ceil(openCount * 0.3))
  return clamp(openNet7d / tolerance, 0, 1)
}

function toMissionProgress(params: {
  locale?: ResolvedLocale
  openCount: number
  riskPressure: number
  pendingReviewPressure: number
  trendPressure: number
  reliabilityPressure: number
}): SecuritySummaryProgress {
  const locale = params.locale ?? 'zh-TW'
  const {
    openCount,
    riskPressure,
    pendingReviewPressure,
    trendPressure,
    reliabilityPressure,
  } = params

  if (openCount <= 0) {
    return {
      score: 100,
      statusLabel: lt(locale, {
        'zh-TW': '穩定巡航',
        'zh-CN': '稳定巡航',
        en: 'Stable Cruise',
      }),
      stage: 'stabilize',
      stageIndex: 2,
      stageReason: lt(locale, {
        'zh-TW': '目前沒有待處理風險，維持固定掃描與審核節奏即可。',
        'zh-CN': '当前没有待处理风险，维持固定扫描与审核节奏即可。',
        en: 'No open risks. Maintain a steady scanning and review cadence.',
      }),
    }
  }

  const pressure =
    riskPressure * 0.45 +
    pendingReviewPressure * 0.2 +
    trendPressure * 0.2 +
    reliabilityPressure * 0.15
  const score = round(clamp((1 - pressure) * 100, 0, 100), 1)

  const pressureBreakdown = [
    {
      key: 'risk',
      value: riskPressure,
      reason: lt(locale, {
        'zh-TW': '高風險庫存占比偏高，優先止血可最快降壓。',
        'zh-CN': '高风险库存占比偏高，优先止血可最快降压。',
        en: 'High-risk backlog ratio is elevated; immediate containment reduces pressure fastest.',
      }),
    },
    {
      key: 'review',
      value: pendingReviewPressure,
      reason: lt(locale, {
        'zh-TW': '待審核比例偏高，修復決策流被阻塞。',
        'zh-CN': '待审核比例偏高，修复决策流被阻塞。',
        en: 'Pending-review ratio is high and remediation decisions are blocked.',
      }),
    },
    {
      key: 'trend',
      value: trendPressure,
      reason: lt(locale, {
        'zh-TW': '7 日待處理淨增偏高，壓力仍在升高。',
        'zh-CN': '7 日待处理净增偏高，压力仍在升高。',
        en: '7-day open net increase is high; pressure is still rising.',
      }),
    },
    {
      key: 'reliability',
      value: reliabilityPressure,
      reason: lt(locale, {
        'zh-TW': '掃描可靠度偏弱，建議先穩定引擎輸出。',
        'zh-CN': '扫描可靠度偏弱，建议先稳定引擎输出。',
        en: 'Scan reliability is weak; stabilize engine output first.',
      }),
    },
  ]
    .sort((a, b) => b.value - a.value)
    .filter((item) => item.value > 0.08)

  const stageReason =
    pressureBreakdown[0]?.reason ??
    lt(locale, {
      'zh-TW': '主要壓力已緩解，可持續批次收斂。',
      'zh-CN': '主要压力已缓解，可持续批量收敛。',
      en: 'Primary pressure has eased. Continue steady batch convergence.',
    })

  if (score < 45) {
    return {
      score,
      statusLabel: lt(locale, {
        'zh-TW': '高壓警戒',
        'zh-CN': '高压警戒',
        en: 'High-Pressure Alert',
      }),
      stage: 'stop-bleed',
      stageIndex: 0,
      stageReason,
    }
  }
  if (score < 80) {
    return {
      score,
      statusLabel: lt(locale, {
        'zh-TW': '正在收斂',
        'zh-CN': '正在收敛',
        en: 'Converging',
      }),
      stage: 'converge',
      stageIndex: 1,
      stageReason,
    }
  }
  return {
    score,
    statusLabel: lt(locale, {
      'zh-TW': '穩定巡航',
      'zh-CN': '稳定巡航',
      en: 'Stable Cruise',
    }),
    stage: 'stabilize',
    stageIndex: 2,
    stageReason,
  }
}

export function computeTrendInsights(
  trend?: TrendSnapshotPoint[] | null,
  locale: ResolvedLocale = 'zh-TW',
): TrendInsights {
  const trendHelp = getTrendHelp(locale)
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
          label: lt(locale, {
            'zh-TW': '7日待處理淨變化',
            'zh-CN': '7日待处理净变化',
            en: '7d Open Net Change',
          }),
          value: lt(locale, {
            'zh-TW': '樣本不足',
            'zh-CN': '样本不足',
            en: 'Not enough samples',
          }),
          tone: 'neutral',
          description: lt(locale, {
            'zh-TW': '資料不足，暫時無法計算近 7 天待處理淨變化。',
            'zh-CN': '数据不足，暂时无法计算近 7 天待处理净变化。',
            en: 'Insufficient data to compute 7-day open net change.',
          }),
          help: trendHelp.open_net_7d,
        },
        {
          key: 'fix_velocity_7d',
          label: lt(locale, {
            'zh-TW': '修復速度',
            'zh-CN': '修复速度',
            en: 'Fix Velocity',
          }),
          value: lt(locale, {
            'zh-TW': '樣本不足',
            'zh-CN': '样本不足',
            en: 'Not enough samples',
          }),
          tone: 'neutral',
          description: lt(locale, {
            'zh-TW': '資料不足，暫時無法估算修復節奏。',
            'zh-CN': '数据不足，暂时无法估算修复节奏。',
            en: 'Insufficient data to estimate fix velocity.',
          }),
          help: trendHelp.fix_velocity_7d,
        },
        {
          key: 'eta_days',
          label: lt(locale, {
            'zh-TW': '清空估算',
            'zh-CN': '清空估算',
            en: 'Clear ETA',
          }),
          value: lt(locale, {
            'zh-TW': '樣本不足',
            'zh-CN': '样本不足',
            en: 'Not enough samples',
          }),
          tone: 'neutral',
          description: lt(locale, {
            'zh-TW': '至少需要兩筆趨勢資料才能推估 ETA。',
            'zh-CN': '至少需要两笔趋势数据才能估算 ETA。',
            en: 'At least two trend points are required to estimate ETA.',
          }),
          help: trendHelp.eta_days,
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
      ? lt(locale, {
          'zh-TW': '待處理連續上升，風險壓力正在累積。',
          'zh-CN': '待处理连续上升，风险压力正在累积。',
          en: 'Open vulnerabilities keep rising; risk pressure is accumulating.',
        })
      : lt(locale, {
          'zh-TW': '待處理淨增超過警戒值，建議優先壓低新增量。',
          'zh-CN': '待处理净增超过警戒值，建议优先压低新增量。',
          en: 'Open net increase crossed threshold; reduce incoming risk first.',
        })
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
        label: lt(locale, {
          'zh-TW': '7日待處理淨變化',
          'zh-CN': '7日待处理净变化',
          en: '7d Open Net Change',
        }),
        value: formatDelta(openNet7d, locale),
        tone: openTone,
        description:
          openNet7d > 0
            ? lt(locale, {
                'zh-TW': '待處理正在上升，需提升處理速度。',
                'zh-CN': '待处理正在上升，需要提升处理速度。',
                en: 'Open backlog is rising; increase remediation throughput.',
              })
            : lt(locale, {
                'zh-TW': '待處理未淨增，節奏可控。',
                'zh-CN': '待处理未净增，节奏可控。',
                en: 'No net increase in open backlog; trend is under control.',
              }),
        help: trendHelp.open_net_7d,
      },
      {
        key: 'fix_velocity_7d',
        label: lt(locale, { 'zh-TW': '修復速度', 'zh-CN': '修复速度', en: 'Fix Velocity' }),
        value:
          locale === 'en'
            ? `${formatFloat(fixVelocityPerDay7d, 1, '', locale)} / day`
            : `${formatFloat(fixVelocityPerDay7d, 1, '', locale)} / 日`,
        tone: velocityTone,
        description:
          fixVelocityPerDay7d > 0
            ? lt(locale, {
                'zh-TW': '目前有持續修復吞吐，可用於估算清空時間。',
                'zh-CN': '目前有持续修复吞吐，可用于估算清空时间。',
                en: 'Current remediation throughput is positive and can estimate ETA.',
              })
            : lt(locale, {
                'zh-TW': '修復速度不足，待處理可能持續堆積。',
                'zh-CN': '修复速度不足，待处理可能持续堆积。',
                en: 'Fix velocity is insufficient; open backlog may keep growing.',
              }),
        help: trendHelp.fix_velocity_7d,
      },
      {
        key: 'eta_days',
        label: lt(locale, {
          'zh-TW': '清空估算',
          'zh-CN': '清空估算',
          en: 'Clear ETA',
        }),
        value:
          etaDays === null
            ? lt(locale, { 'zh-TW': '無法估算', 'zh-CN': '无法估算', en: 'N/A' })
            : locale === 'en'
              ? `${Math.ceil(etaDays)} days`
              : `${Math.ceil(etaDays)} 天`,
        tone: etaTone,
        description:
          etaDays === null
            ? lt(locale, {
                'zh-TW': '目前修復速度不足，尚無法估算清空時間。',
                'zh-CN': '目前修复速度不足，尚无法估算清空时间。',
                en: 'Current remediation velocity is too low to estimate clear ETA.',
              })
            : locale === 'en'
              ? `At current velocity, backlog can be cleared in ~${Math.ceil(etaDays)} days.`
              : locale === 'zh-CN'
                ? `若维持当前速度，约 ${Math.ceil(etaDays)} 天可清空待处理。`
                : `若維持現速，約 ${Math.ceil(etaDays)} 天可清空待處理。`,
        help: trendHelp.eta_days,
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

export function buildRiskPriorityLanes(
  input: DashboardInsightInput,
  locale: ResolvedLocale = 'zh-TW',
): RiskPriorityLane[] {
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
      title: lt(locale, {
        'zh-TW': '嚴重級即時處理',
        'zh-CN': '严重级即时处理',
        en: 'Critical Immediate Lane',
      }),
      subtitle: lt(locale, {
        'zh-TW': '先阻斷高爆炸半徑風險',
        'zh-CN': '先阻断高爆炸半径风险',
        en: 'Contain highest-blast-radius risks first',
      }),
      openCount: openBySeverity.critical,
      ratioPercent: laneRatios.critical,
      preset: 'critical_open',
      expectedBenefit: lt(locale, {
        'zh-TW': '優先降低高衝擊暴露，最快拉低風險上限。',
        'zh-CN': '优先降低高冲击暴露，最快拉低风险上限。',
        en: 'Reduce high-impact exposure first for the fastest risk cap reduction.',
      }),
      tone: 'danger',
    },
    {
      key: 'high',
      title: lt(locale, {
        'zh-TW': '高風險快速清理',
        'zh-CN': '高风险快速清理',
        en: 'High-Risk Fast Cleanup',
      }),
      subtitle: lt(locale, {
        'zh-TW': '壓低中高風險累積速度',
        'zh-CN': '压低中高风险累积速度',
        en: 'Slow down mid/high risk accumulation',
      }),
      openCount: openBySeverity.high,
      ratioPercent: laneRatios.high,
      preset: 'high_open',
      expectedBenefit: lt(locale, {
        'zh-TW': '穩定降低待處理淨增，避免風險長尾。',
        'zh-CN': '稳定降低待处理净增，避免风险长尾。',
        en: 'Stabilize open-net reduction and avoid long-tail risk.',
      }),
      tone: 'warning',
    },
    {
      key: 'batch',
      title: lt(locale, {
        'zh-TW': '中低風險批次修復',
        'zh-CN': '中低风险批量修复',
        en: 'Batch Lane for Mid/Low Risks',
      }),
      subtitle: lt(locale, {
        'zh-TW': '利用低成本時段批量收斂',
        'zh-CN': '利用低成本时段批量收敛',
        en: 'Batch close during low-cost windows',
      }),
      openCount: openBySeverity.medium + openBySeverity.low + openBySeverity.info,
      ratioPercent: laneRatios.batch,
      preset: 'open_all',
      expectedBenefit: lt(locale, {
        'zh-TW': '持續清庫存，避免中低風險堆積為維護負擔。',
        'zh-CN': '持续清库存，避免中低风险堆积为维护负担。',
        en: 'Drain backlog steadily and avoid mid/low risk maintenance debt.',
      }),
      tone: 'info',
    },
  ]
}

export function buildSecuritySummary(
  input: DashboardInsightInput,
  locale: ResolvedLocale = 'zh-TW',
): SecuritySummary {
  const openBySeverity = normalizeOpenBySeverity({
    bySeverity: input.bySeverity,
    bySeverityOpen: input.bySeverityOpen,
    openCount: input.openCount,
    totalCount: input.totalCount,
  })

  const trendInsights = computeTrendInsights(input.trend, locale)
  const reliabilitySignal = toReliabilitySignal(input.health, locale)
  const pendingReview = Math.max(0, input.byHumanStatus?.pending ?? 0)
  const pendingReviewPressure = input.openCount > 0 ? pendingReview / input.openCount : 0
  const riskPressure = computeRiskPressureScore({ openBySeverity })
  const trendPressure = toTrendPressure({
    openNet7d: trendInsights.openNet7d,
    openCount: input.openCount,
  })
  const reliabilityPressure = toReliabilityPressure(input.health)
  const progress = toMissionProgress({
    locale,
    openCount: input.openCount,
    riskPressure,
    pendingReviewPressure,
    trendPressure,
    reliabilityPressure,
  })

  const criticalOpen = openBySeverity.critical
  const highOpen = openBySeverity.high
  const highRiskOpen = criticalOpen + highOpen
  const highRiskRatio = input.openCount > 0 ? highRiskOpen / input.openCount : 0
  const reliabilityValue = input.health?.score.components.reliability.value
  const fallbackRate = input.health?.score.components.reliability.fallbackRate
  const dataTime = input.health?.evaluatedAt ?? input.trend?.at(-1)?.date ?? null
  const dataSourceLabel = input.health
    ? lt(locale, {
        'zh-TW': '規則推導（health + stats + trend）',
        'zh-CN': '规则推导（health + stats + trend）',
        en: 'Rule-based (health + stats + trend)',
      })
    : lt(locale, {
        'zh-TW': '規則推導（stats + trend）',
        'zh-CN': '规则推导（stats + trend）',
        en: 'Rule-based (stats + trend)',
      })

  let headline = lt(locale, {
    'zh-TW': '目前風險趨勢穩定，可持續按節奏處理。',
    'zh-CN': '当前风险趋势稳定，可按节奏持续处理。',
    en: 'Risk trend is stable; continue remediation at current pace.',
  })
  let tone: SecuritySummary['tone'] = 'safe'
  let coreMessage = lt(locale, {
    'zh-TW': '目前沒有立即風險阻塞，可維持既有節奏。',
    'zh-CN': '当前没有即时风险阻塞，可维持既有节奏。',
    en: 'No immediate risk blockers at the moment.',
  })
  let solutionMessage = lt(locale, {
    'zh-TW': '持續工作區掃描與審核抽樣，避免新風險累積。',
    'zh-CN': '持续工作区扫描与审核抽样，避免新风险累积。',
    en: 'Keep workspace scans and review sampling to prevent new buildup.',
  })
  let action: SecuritySummaryAction | null = null

  if (input.openCount <= 0) {
    headline = lt(locale, {
      'zh-TW': '目前沒有待處理漏洞，建議維持掃描與審核節奏。',
      'zh-CN': '当前没有待处理漏洞，建议维持扫描与审核节奏。',
      en: 'No open vulnerabilities now; keep scan and review cadence.',
    })
    tone = 'safe'
    coreMessage = lt(locale, {
      'zh-TW': '目前沒有待處理風險。',
      'zh-CN': '当前没有待处理风险。',
      en: 'No open risk at the moment.',
    })
    solutionMessage = lt(locale, {
      'zh-TW': '維持例行掃描與審核節奏，避免風險回升。',
      'zh-CN': '维持例行扫描与审核节奏，避免风险回升。',
      en: 'Maintain routine scans and reviews to avoid regression.',
    })
    action = null
  } else if (criticalOpen > 0) {
    headline = lt(locale, {
      'zh-TW': `嚴重級待處理 ${criticalOpen} 筆，建議先止血。`,
      'zh-CN': `严重级待处理 ${criticalOpen} 笔，建议先止血。`,
      en: `${criticalOpen} critical items are still open. Start with immediate containment.`,
    })
    tone = 'danger'
    coreMessage = lt(locale, {
      'zh-TW': '最高衝擊面尚未收斂，整體暴露上限仍偏高。',
      'zh-CN': '最高冲击面尚未收敛，整体暴露上限仍偏高。',
      en: 'Highest-impact exposure has not converged yet and risk cap remains high.',
    })
    solutionMessage = lt(locale, {
      'zh-TW': '先修嚴重級待處理，完成後再收斂高風險。',
      'zh-CN': '先修严重级待处理，完成后再收敛高风险。',
      en: 'Fix open critical items first, then converge high-risk items.',
    })
    action = {
      label: lt(locale, {
        'zh-TW': '立即處理嚴重級',
        'zh-CN': '立即处理严重级',
        en: 'Handle Critical Now',
      }),
      preset: 'critical_open',
      reason: lt(locale, {
        'zh-TW': '先壓低最高風險面，最快降低暴露上限。',
        'zh-CN': '先压低最高风险面，最快降低暴露上限。',
        en: 'Reduce the highest risk surface first to lower exposure cap fastest.',
      }),
      focusCount: criticalOpen,
      kpi: {
        label: lt(locale, {
          'zh-TW': '嚴重級待處理',
          'zh-CN': '严重级待处理',
          en: 'Open Critical',
        }),
        current:
          locale === 'en'
            ? `${criticalOpen} items`
            : `${criticalOpen}${locale === 'zh-CN' ? ' 笔' : ' 筆'}`,
        target: locale === 'en' ? '0 items' : `0${locale === 'zh-CN' ? ' 笔' : ' 筆'}`,
      },
    }
  } else if (highOpen > 0) {
    headline = lt(locale, {
      'zh-TW': `高風險待處理 ${highOpen} 筆，建議優先收斂。`,
      'zh-CN': `高风险待处理 ${highOpen} 笔，建议优先收敛。`,
      en: `${highOpen} high-risk items are open. Prioritize convergence.`,
    })
    tone = 'warning'
    coreMessage = lt(locale, {
      'zh-TW': '高風險庫存仍偏高，可能持續擠壓修復節奏。',
      'zh-CN': '高风险库存仍偏高，可能持续挤压修复节奏。',
      en: 'High-risk backlog is still elevated and may keep squeezing remediation pace.',
    })
    solutionMessage = lt(locale, {
      'zh-TW': '優先清理高風險項，再進行中低風險批次修復。',
      'zh-CN': '优先清理高风险项，再进行中低风险批量修复。',
      en: 'Clear high-risk items first, then move to mid/low-risk batch remediation.',
    })
    action = {
      label: lt(locale, {
        'zh-TW': '優先清理高風險',
        'zh-CN': '优先清理高风险',
        en: 'Prioritize High Risk',
      }),
      preset: 'high_open',
      reason: lt(locale, {
        'zh-TW': '先穩住中高風險，避免待處理持續堆積。',
        'zh-CN': '先稳住中高风险，避免待处理持续堆积。',
        en: 'Stabilize mid/high risks first to prevent ongoing backlog growth.',
      }),
      focusCount: highOpen,
      kpi: {
        label: lt(locale, {
          'zh-TW': '高風險待處理',
          'zh-CN': '高风险待处理',
          en: 'Open High Risk',
        }),
        current:
          locale === 'en' ? `${highOpen} items` : `${highOpen}${locale === 'zh-CN' ? ' 笔' : ' 筆'}`,
        target: locale === 'en' ? '0 items' : `0${locale === 'zh-CN' ? ' 笔' : ' 筆'}`,
      },
    }
  } else if (pendingReviewPressure >= 0.35) {
    headline = lt(locale, {
      'zh-TW': `待審核堆積 ${pendingReview} 筆，修復決策受阻。`,
      'zh-CN': `待审核堆积 ${pendingReview} 笔，修复决策受阻。`,
      en: `${pendingReview} items are pending review and remediation decisions are blocked.`,
    })
    tone = 'warning'
    coreMessage = lt(locale, {
      'zh-TW': '主要瓶頸是審核流量不足，導致修復動作被卡住。',
      'zh-CN': '主要瓶颈是审核流量不足，导致修复动作被卡住。',
      en: 'The bottleneck is review capacity; remediation actions are blocked.',
    })
    solutionMessage = lt(locale, {
      'zh-TW': '先清待審核，再推進已確認項目的修復與忽略決策。',
      'zh-CN': '先清待审核，再推进已确认项目的修复与忽略决策。',
      en: 'Clear pending reviews first, then proceed with confirmed remediation/ignore decisions.',
    })
    action = {
      label: lt(locale, {
        'zh-TW': '先清待審核',
        'zh-CN': '先清待审核',
        en: 'Clear Pending Reviews',
      }),
      preset: 'open_all',
      reason: lt(locale, {
        'zh-TW': '先解除審核瓶頸，才能穩定提升修復吞吐。',
        'zh-CN': '先解除审核瓶颈，才能稳定提升修复吞吐。',
        en: 'Relieve review bottlenecks first to increase remediation throughput steadily.',
      }),
      focusCount: pendingReview,
      kpi: {
        label: lt(locale, {
          'zh-TW': '待審核壓力',
          'zh-CN': '待审核压力',
          en: 'Pending Review Pressure',
        }),
        current: `${formatPercent(pendingReviewPressure)} (${pendingReview}/${input.openCount})`,
        target: locale === 'en' ? '< 20%' : '< 20%',
      },
    }
  } else if (reliabilitySignal.tone === 'negative') {
    headline = lt(locale, {
      'zh-TW': '掃描可靠度偏弱，建議先穩定引擎再加速修復。',
      'zh-CN': '扫描可靠度偏弱，建议先稳定引擎再加速修复。',
      en: 'Scan reliability is weak. Stabilize the engine before accelerating remediation.',
    })
    tone = 'warning'
    coreMessage = lt(locale, {
      'zh-TW': '掃描可靠度偏低，會影響判斷與後續修復效率。',
      'zh-CN': '扫描可靠度偏低，会影响判断与后续修复效率。',
      en: 'Low reliability impacts signal quality and downstream remediation efficiency.',
    })
    solutionMessage = lt(locale, {
      'zh-TW': '先穩定掃描成功率與回退率，再擴大修復節奏。',
      'zh-CN': '先稳定扫描成功率与回退率，再扩大修复节奏。',
      en: 'Stabilize scan success and fallback rates, then expand remediation cadence.',
    })
    action = {
      label: lt(locale, {
        'zh-TW': '查看待處理清單',
        'zh-CN': '查看待处理清单',
        en: 'View Open Backlog',
      }),
      preset: 'open_all',
      reason: lt(locale, {
        'zh-TW': '先穩定掃描流程，避免修復決策建立在不穩定輸出上。',
        'zh-CN': '先稳定扫描流程，避免修复决策建立在不稳定输出上。',
        en: 'Stabilize scan flow first to avoid decisions based on unstable outputs.',
      }),
      focusCount: input.openCount,
      kpi: {
        label: lt(locale, {
          'zh-TW': '掃描可靠度',
          'zh-CN': '扫描可靠度',
          en: 'Scan Reliability',
        }),
        current:
          typeof reliabilityValue === 'number' && typeof fallbackRate === 'number'
            ? `${reliabilityValue.toFixed(1)} / fallback ${(fallbackRate * 100).toFixed(1)}%`
            : lt(locale, {
                'zh-TW': '資料不足',
                'zh-CN': '数据不足',
                en: 'Insufficient data',
              }),
        target:
          locale === 'en'
            ? '>= 80 and fallback <= 10%'
            : locale === 'zh-CN'
              ? '>= 80 且 fallback <= 10%'
              : '>= 80 且 fallback <= 10%',
      },
    }
  } else {
    headline = lt(locale, {
      'zh-TW': '目前仍有待處理項目，建議以批次方式快速清庫存。',
      'zh-CN': '当前仍有待处理项目，建议以批量方式快速清库存。',
      en: 'There are still open items. Use batch remediation to reduce backlog quickly.',
    })
    tone = trendInsights.pressureHigh ? 'warning' : 'safe'
    coreMessage = lt(locale, {
      'zh-TW': '目前無高風險堵點，主要任務是持續清理待處理庫存。',
      'zh-CN': '当前无高风险堵点，主要任务是持续清理待处理库存。',
      en: 'No high-risk blockers now. Primary goal is to drain open backlog steadily.',
    })
    solutionMessage = lt(locale, {
      'zh-TW': '採批次修復，維持穩定吞吐並防止庫存回升。',
      'zh-CN': '采用批量修复，维持稳定吞吐并防止库存回升。',
      en: 'Use batch remediation to keep steady throughput and prevent backlog rebound.',
    })
    action = {
      label: lt(locale, {
        'zh-TW': '查看待處理清單',
        'zh-CN': '查看待处理清单',
        en: 'View Open Backlog',
      }),
      preset: 'open_all',
      reason: lt(locale, {
        'zh-TW': '已無高風險堵點，適合進入批次清理階段。',
        'zh-CN': '已无高风险堵点，适合进入批量清理阶段。',
        en: 'No high-risk blockers remain; this is suitable for batch cleanup.',
      }),
      focusCount: input.openCount,
      kpi: {
        label: lt(locale, {
          'zh-TW': '7日待處理淨變化',
          'zh-CN': '7日待处理净变化',
          en: '7d Open Net Change',
        }),
        current:
          trendInsights.openNet7d === null
            ? lt(locale, {
                'zh-TW': '樣本不足',
                'zh-CN': '样本不足',
                en: 'Not enough samples',
              })
            : formatDelta(trendInsights.openNet7d, locale),
        target: '<= 0',
      },
    }
  }

  if (input.openCount > 0) {
    if (progress.stage === 'stop-bleed') {
      tone = 'danger'
    } else if (progress.stage === 'converge' && tone === 'safe') {
      tone = 'warning'
    }
  }

  const trendLabel =
    trendInsights.openNet7d === null
      ? lt(locale, {
          'zh-TW': '7日趨勢樣本不足',
          'zh-CN': '7日趋势样本不足',
          en: 'Insufficient 7-day trend samples',
        })
      : locale === 'en'
        ? `7d Open Net Change ${formatDelta(trendInsights.openNet7d, locale)}`
        : locale === 'zh-CN'
          ? `7日待处理净变化 ${formatDelta(trendInsights.openNet7d, locale)}`
          : `7日待處理淨變化 ${formatDelta(trendInsights.openNet7d, locale)}`
  const reliabilityLabel =
    typeof reliabilityValue === 'number' && typeof fallbackRate === 'number'
      ? locale === 'en'
        ? `Reliability ${reliabilityValue.toFixed(1)} / fallback ${(fallbackRate * 100).toFixed(1)}%`
        : locale === 'zh-CN'
          ? `可靠度 ${reliabilityValue.toFixed(1)} / fallback ${(fallbackRate * 100).toFixed(1)}%`
          : `可靠度 ${reliabilityValue.toFixed(1)} / fallback ${(fallbackRate * 100).toFixed(1)}%`
      : lt(locale, {
          'zh-TW': '可靠度資料不足',
          'zh-CN': '可靠度数据不足',
          en: 'Reliability data unavailable',
        })
  const pressureMixLabel =
    input.openCount > 0
      ? locale === 'en'
        ? `High-risk ratio: ${formatPercent(highRiskRatio)} (${highRiskOpen}/${input.openCount}) · Pending-review pressure: ${formatPercent(pendingReviewPressure)} (${pendingReview}/${input.openCount})`
        : locale === 'zh-CN'
          ? `高风险占比：${formatPercent(highRiskRatio)}（${highRiskOpen}/${input.openCount}）・待审核压力：${formatPercent(pendingReviewPressure)}（${pendingReview}/${input.openCount}）`
          : `高風險佔比：${formatPercent(highRiskRatio)}（${highRiskOpen}/${input.openCount}）・待審核壓力：${formatPercent(pendingReviewPressure)}（${pendingReview}/${input.openCount}）`
      : lt(locale, {
          'zh-TW': '目前無待處理項目，壓力來源已清空。',
          'zh-CN': '当前无待处理项目，压力来源已清空。',
          en: 'No open items; pressure sources are cleared.',
        })
  const rationale = [
    locale === 'en'
      ? `Mission progress score: ${progress.score.toFixed(1)} / 100 (45% risk + 20% review + 20% trend + 15% reliability)`
      : locale === 'zh-CN'
        ? `任务推进分数：${progress.score.toFixed(1)} / 100（45%风险压力 + 20%待审核 + 20%趋势 + 15%可靠度）`
        : `任務推進分數：${progress.score.toFixed(1)} / 100（45%風險壓力 + 20%待審核 + 20%趨勢 + 15%可靠度）`,
    pressureMixLabel,
    `${trendLabel}；${reliabilityLabel}`,
  ]

  return {
    headline,
    tone,
    coreMessage,
    solutionMessage,
    dataTime,
    dataSourceLabel,
    progress,
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

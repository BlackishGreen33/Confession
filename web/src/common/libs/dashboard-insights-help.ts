import type { ResolvedLocale } from '@/libs/i18n'

export interface MetricHelpContent {
  formula: string
  meaning: string
  ideal: string
}

type TrendInsightHelpKey = 'open_net_7d' | 'fix_velocity_7d' | 'eta_days'

function lt(
  locale: ResolvedLocale,
  text: { 'zh-TW': string; 'zh-CN': string; en: string },
): string {
  return text[locale]
}

export function getTrendHelp(
  locale: ResolvedLocale,
): Record<TrendInsightHelpKey, MetricHelpContent> {
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

export function getReliabilityHelp(locale: ResolvedLocale): MetricHelpContent {
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

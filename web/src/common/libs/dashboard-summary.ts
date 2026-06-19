import type { ResolvedLocale } from '@/libs/i18n'

import type {
  SecuritySummary,
  SecuritySummaryContext,
  SecuritySummaryProgress,
} from './dashboard-insights'

type SecuritySummaryDecision = Pick<
  SecuritySummary,
  'headline' | 'tone' | 'coreMessage' | 'solutionMessage' | 'action'
>

function lt(
  locale: ResolvedLocale,
  text: { 'zh-TW': string; 'zh-CN': string; en: string },
): string {
  return text[locale]
}

function formatDelta(value: number, locale: ResolvedLocale): string {
  const suffix =
    locale === 'en'
      ? ' items'
      : locale === 'zh-CN'
        ? ' 笔'
        : ' 筆'
  const rounded = Math.round(value)
  if (rounded > 0) return `+${rounded}${suffix}`
  if (rounded < 0) return `${rounded}${suffix}`
  return `0${suffix}`
}

function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`
}

function formatItemCount(count: number, locale: ResolvedLocale): string {
  if (locale === 'en') return `${count} items`
  return `${count}${locale === 'zh-CN' ? ' 笔' : ' 筆'}`
}

function formatReliabilityValue(
  reliabilityValue: number | undefined,
  fallbackRate: number | undefined,
  locale: ResolvedLocale,
): string {
  if (typeof reliabilityValue === 'number' && typeof fallbackRate === 'number') {
    return `${reliabilityValue.toFixed(1)} / fallback ${(fallbackRate * 100).toFixed(1)}%`
  }
  return lt(locale, {
    'zh-TW': '資料不足',
    'zh-CN': '数据不足',
    en: 'Insufficient data',
  })
}

function applyProgressTone(
  tone: SecuritySummary['tone'],
  progress: SecuritySummaryProgress,
  openCount: number,
): SecuritySummary['tone'] {
  if (openCount > 0) {
    if (progress.stage === 'stop-bleed') {
      return 'danger'
    }
    if (progress.stage === 'converge' && tone === 'safe') {
      return 'warning'
    }
  }
  return tone
}

export function buildSecuritySummaryFromContext(
  context: SecuritySummaryContext,
  locale: ResolvedLocale,
): SecuritySummary {
  const decision = selectSecuritySummaryDecision(context, locale)
  const tone = applyProgressTone(decision.tone, context.progress, context.input.openCount)

  return {
    ...decision,
    tone,
    dataTime: context.dataTime,
    dataSourceLabel: context.dataSourceLabel,
    progress: context.progress,
    rationale: buildSecuritySummaryRationale(context, locale),
  }
}

function selectSecuritySummaryDecision(
  context: SecuritySummaryContext,
  locale: ResolvedLocale,
): SecuritySummaryDecision {
  const {
    input,
    reliabilitySignal,
    pendingReviewPressure,
    criticalOpen,
    highOpen,
  } = context

  if (input.openCount <= 0) return buildNoOpenSummaryDecision(locale)
  if (criticalOpen > 0) return buildCriticalSummaryDecision(criticalOpen, locale)
  if (highOpen > 0) return buildHighSummaryDecision(highOpen, locale)
  if (pendingReviewPressure >= 0.35) {
    return buildPendingReviewSummaryDecision(context, locale)
  }
  if (reliabilitySignal.tone === 'negative') {
    return buildReliabilitySummaryDecision(context, locale)
  }
  return buildBatchSummaryDecision(context, locale)
}

function buildNoOpenSummaryDecision(locale: ResolvedLocale): SecuritySummaryDecision {
  return {
    headline: lt(locale, {
      'zh-TW': '目前沒有待處理漏洞，建議維持掃描與審核節奏。',
      'zh-CN': '当前没有待处理漏洞，建议维持扫描与审核节奏。',
      en: 'No open vulnerabilities now; keep scan and review cadence.',
    }),
    tone: 'safe',
    coreMessage: lt(locale, {
      'zh-TW': '目前沒有待處理風險。',
      'zh-CN': '当前没有待处理风险。',
      en: 'No open risk at the moment.',
    }),
    solutionMessage: lt(locale, {
      'zh-TW': '維持例行掃描與審核節奏，避免風險回升。',
      'zh-CN': '维持例行扫描与审核节奏，避免风险回升。',
      en: 'Maintain routine scans and reviews to avoid regression.',
    }),
    action: null,
  }
}

function buildCriticalSummaryDecision(
  criticalOpen: number,
  locale: ResolvedLocale,
): SecuritySummaryDecision {
  return {
    headline: lt(locale, {
      'zh-TW': `嚴重級待處理 ${criticalOpen} 筆，建議先止血。`,
      'zh-CN': `严重级待处理 ${criticalOpen} 笔，建议先止血。`,
      en: `${criticalOpen} critical items are still open. Start with immediate containment.`,
    }),
    tone: 'danger',
    coreMessage: lt(locale, {
      'zh-TW': '最高衝擊面尚未收斂，整體暴露上限仍偏高。',
      'zh-CN': '最高冲击面尚未收敛，整体暴露上限仍偏高。',
      en: 'Highest-impact exposure has not converged yet and risk cap remains high.',
    }),
    solutionMessage: lt(locale, {
      'zh-TW': '先修嚴重級待處理，完成後再收斂高風險。',
      'zh-CN': '先修严重级待处理，完成后再收敛高风险。',
      en: 'Fix open critical items first, then converge high-risk items.',
    }),
    action: {
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
        current: formatItemCount(criticalOpen, locale),
        target: formatItemCount(0, locale),
      },
    },
  }
}

function buildHighSummaryDecision(
  highOpen: number,
  locale: ResolvedLocale,
): SecuritySummaryDecision {
  return {
    headline: lt(locale, {
      'zh-TW': `高風險待處理 ${highOpen} 筆，建議優先收斂。`,
      'zh-CN': `高风险待处理 ${highOpen} 笔，建议优先收敛。`,
      en: `${highOpen} high-risk items are open. Prioritize convergence.`,
    }),
    tone: 'warning',
    coreMessage: lt(locale, {
      'zh-TW': '高風險庫存仍偏高，可能持續擠壓修復節奏。',
      'zh-CN': '高风险库存仍偏高，可能持续挤压修复节奏。',
      en: 'High-risk backlog is still elevated and may keep squeezing remediation pace.',
    }),
    solutionMessage: lt(locale, {
      'zh-TW': '優先清理高風險項，再進行中低風險批次修復。',
      'zh-CN': '优先清理高风险项，再进行中低风险批量修复。',
      en: 'Clear high-risk items first, then move to mid/low-risk batch remediation.',
    }),
    action: {
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
        current: formatItemCount(highOpen, locale),
        target: formatItemCount(0, locale),
      },
    },
  }
}

function buildPendingReviewSummaryDecision(
  context: SecuritySummaryContext,
  locale: ResolvedLocale,
): SecuritySummaryDecision {
  const { input, pendingReview, pendingReviewPressure } = context

  return {
    headline: lt(locale, {
      'zh-TW': `待審核堆積 ${pendingReview} 筆，修復決策受阻。`,
      'zh-CN': `待审核堆积 ${pendingReview} 笔，修复决策受阻。`,
      en: `${pendingReview} items are pending review and remediation decisions are blocked.`,
    }),
    tone: 'warning',
    coreMessage: lt(locale, {
      'zh-TW': '主要瓶頸是審核流量不足，導致修復動作被卡住。',
      'zh-CN': '主要瓶颈是审核流量不足，导致修复动作被卡住。',
      en: 'The bottleneck is review capacity; remediation actions are blocked.',
    }),
    solutionMessage: lt(locale, {
      'zh-TW': '先清待審核，再推進已確認項目的修復與忽略決策。',
      'zh-CN': '先清待审核，再推进已确认项目的修复与忽略决策。',
      en: 'Clear pending reviews first, then proceed with confirmed remediation/ignore decisions.',
    }),
    action: {
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
        target: '< 20%',
      },
    },
  }
}

function buildReliabilitySummaryDecision(
  context: SecuritySummaryContext,
  locale: ResolvedLocale,
): SecuritySummaryDecision {
  const { input, reliabilityValue, fallbackRate } = context

  return {
    headline: lt(locale, {
      'zh-TW': '掃描可靠度偏弱，建議先穩定引擎再加速修復。',
      'zh-CN': '扫描可靠度偏弱，建议先稳定引擎再加速修复。',
      en: 'Scan reliability is weak. Stabilize the engine before accelerating remediation.',
    }),
    tone: 'warning',
    coreMessage: lt(locale, {
      'zh-TW': '掃描可靠度偏低，會影響判斷與後續修復效率。',
      'zh-CN': '扫描可靠度偏低，会影响判断与后续修复效率。',
      en: 'Low reliability impacts signal quality and downstream remediation efficiency.',
    }),
    solutionMessage: lt(locale, {
      'zh-TW': '先穩定掃描成功率與回退率，再擴大修復節奏。',
      'zh-CN': '先稳定扫描成功率与回退率，再扩大修复节奏。',
      en: 'Stabilize scan success and fallback rates, then expand remediation cadence.',
    }),
    action: {
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
        current: formatReliabilityValue(reliabilityValue, fallbackRate, locale),
        target:
          locale === 'en'
            ? '>= 80 and fallback <= 10%'
            : locale === 'zh-CN'
              ? '>= 80 且 fallback <= 10%'
              : '>= 80 且 fallback <= 10%',
      },
    },
  }
}

function buildBatchSummaryDecision(
  context: SecuritySummaryContext,
  locale: ResolvedLocale,
): SecuritySummaryDecision {
  const { input, trendInsights } = context

  return {
    headline: lt(locale, {
      'zh-TW': '目前仍有待處理項目，建議以批次方式快速清庫存。',
      'zh-CN': '当前仍有待处理项目，建议以批量方式快速清库存。',
      en: 'There are still open items. Use batch remediation to reduce backlog quickly.',
    }),
    tone: trendInsights.pressureHigh ? 'warning' : 'safe',
    coreMessage: lt(locale, {
      'zh-TW': '目前無高風險堵點，主要任務是持續清理待處理庫存。',
      'zh-CN': '当前无高风险堵点，主要任务是持续清理待处理库存。',
      en: 'No high-risk blockers now. Primary goal is to drain open backlog steadily.',
    }),
    solutionMessage: lt(locale, {
      'zh-TW': '採批次修復，維持穩定吞吐並防止庫存回升。',
      'zh-CN': '采用批量修复，维持稳定吞吐并防止库存回升。',
      en: 'Use batch remediation to keep steady throughput and prevent backlog rebound.',
    }),
    action: {
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
    },
  }
}

function buildSecuritySummaryRationale(
  context: SecuritySummaryContext,
  locale: ResolvedLocale,
): string[] {
  const {
    input,
    trendInsights,
    pendingReview,
    pendingReviewPressure,
    progress,
    highRiskOpen,
    highRiskRatio,
    reliabilityValue,
    fallbackRate,
  } = context
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

  return [
    locale === 'en'
      ? `Mission progress score: ${progress.score.toFixed(1)} / 100 (45% risk + 20% review + 20% trend + 15% reliability)`
      : locale === 'zh-CN'
        ? `任务推进分数：${progress.score.toFixed(1)} / 100（45%风险压力 + 20%待审核 + 20%趋势 + 15%可靠度）`
        : `任務推進分數：${progress.score.toFixed(1)} / 100（45%風險壓力 + 20%待審核 + 20%趨勢 + 15%可靠度）`,
    pressureMixLabel,
    `${trendLabel}；${reliabilityLabel}`,
  ]
}

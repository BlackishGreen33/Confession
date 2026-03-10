'use client'

import { m, useReducedMotion } from 'framer-motion'
import { CircleHelp, Shield } from 'lucide-react'
import React, { useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Tooltip as UiTooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/hooks/use-i18n'
import { useVulnTrend } from '@/hooks/use-vulnerabilities'
import {
  computeTrendInsights,
  type MetricHelpContent,
} from '@/libs/dashboard-insights'
import type { ResolvedLocale } from '@/libs/i18n'
import type { VulnerabilityFilterPreset } from '@/libs/types'
import { MOTION_DURATIONS, MOTION_EASING } from '@/motion/tokens'

// === Cyber 風格 tooltip 樣式 ===

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'color-mix(in srgb, var(--cyber-surface) 92%, transparent)',
    backdropFilter: 'blur(10px)',
    borderRadius: '8px',
    border: '1px solid var(--cyber-border)',
    padding: '10px',
  },
  itemStyle: { color: 'var(--cyber-text)', fontSize: '11px', fontWeight: 'bold' as const },
  labelStyle: {
    color: 'var(--cyber-textmuted)',
    fontSize: '11px',
    marginBottom: '4px',
    textTransform: 'uppercase' as const,
    fontWeight: '900' as const,
  },
}

const metricToneClass = {
  positive: 'text-emerald-700 dark:text-emerald-300',
  warning: 'text-amber-700 dark:text-amber-300',
  negative: 'text-red-700 dark:text-red-300',
  neutral: 'text-cyber-textmuted',
} as const

function lt(
  locale: ResolvedLocale,
  text: { 'zh-TW': string; 'zh-CN': string; en: string },
): string {
  return text[locale]
}

/** 格式化日期標籤（MM/DD） */
const formatDate = (dateStr: string): string => {
  const parts = dateStr.split('-')
  return `${parts[1]}/${parts[2]}`
}

const MetricHelp: React.FC<{ content: MetricHelpContent; locale: ResolvedLocale }> = ({
  content,
  locale,
}) => {
  return (
    <UiTooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-cyber-border text-cyber-textmuted transition-colors hover:border-cyber-primary hover:text-cyber-primary"
          aria-label={lt(locale, {
            'zh-TW': '查看趨勢指標說明',
            'zh-CN': '查看趋势指标说明',
            en: 'View trend metric details',
          })}
        >
          <CircleHelp className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="start"
        collisionPadding={12}
        className="w-[min(18rem,calc(100vw-2rem))] rounded-lg border-cyber-border bg-cyber-surface2 p-3 text-left text-xs leading-relaxed text-cyber-text"
      >
        <span className="block text-xs font-black uppercase tracking-[0.08em] text-cyber-primary">
          {lt(locale, {
            'zh-TW': '怎麼算',
            'zh-CN': '怎么算',
            en: 'Formula',
          })}
        </span>
        <span className="mt-1 block font-mono text-cyber-textmuted">{content.formula}</span>
        <span className="mt-2 block text-xs font-black uppercase tracking-[0.08em] text-cyber-primary">
          {lt(locale, {
            'zh-TW': '代表什麼',
            'zh-CN': '代表什么',
            en: 'Meaning',
          })}
        </span>
        <span className="mt-1 block text-cyber-textmuted">{content.meaning}</span>
        <span className="mt-2 block text-xs font-black uppercase tracking-[0.08em] text-cyber-primary">
          {lt(locale, {
            'zh-TW': '何時警戒',
            'zh-CN': '何时警戒',
            en: 'Alert Threshold',
          })}
        </span>
        <span className="mt-1 block text-cyber-textmuted">{content.ideal}</span>
      </TooltipContent>
    </UiTooltip>
  )
}

interface TrendChartProps {
  onNavigatePreset?: (preset: VulnerabilityFilterPreset) => void
}

type TrendSeriesKey = 'total' | 'open' | 'fixed' | 'ignored'

function getSeriesMeta(
  locale: ResolvedLocale,
): Record<TrendSeriesKey, { label: string; color: string }> {
  return {
    total: {
      label: lt(locale, { 'zh-TW': '總計', 'zh-CN': '总计', en: 'Total' }),
      color: '#4C8DFF',
    },
    open: {
      label: lt(locale, { 'zh-TW': '待處理', 'zh-CN': '待处理', en: 'Open' }),
      color: '#F3B34C',
    },
    fixed: {
      label: lt(locale, { 'zh-TW': '已修復', 'zh-CN': '已修复', en: 'Fixed' }),
      color: '#2FBF8F',
    },
    ignored: {
      label: lt(locale, { 'zh-TW': '已忽略', 'zh-CN': '已忽略', en: 'Ignored' }),
      color: '#9FB0C7',
    },
  }
}

function getPresetLabel(
  preset: VulnerabilityFilterPreset,
  locale: ResolvedLocale,
): string {
  switch (preset) {
    case 'critical_open':
      return lt(locale, {
        'zh-TW': '嚴重級待處理',
        'zh-CN': '严重级待处理',
        en: 'Open Critical',
      })
    case 'high_open':
      return lt(locale, {
        'zh-TW': '高風險待處理',
        'zh-CN': '高风险待处理',
        en: 'Open High Risk',
      })
    default:
      return lt(locale, {
        'zh-TW': '全部待處理',
        'zh-CN': '全部待处理',
        en: 'All Open',
      })
  }
}

// === 安全趨勢面積圖 ===

export const TrendChart: React.FC<TrendChartProps> = ({ onNavigatePreset }) => {
  const { locale } = useI18n()
  const reduceMotion = useReducedMotion()
  const [hoverSeries, setHoverSeries] = useState<TrendSeriesKey | null>(null)
  const [pinnedSeries, setPinnedSeries] = useState<TrendSeriesKey | null>(null)
  const { data: trend, isLoading, isError } = useVulnTrend()
  const activeSeries = hoverSeries ?? pinnedSeries
  const seriesMeta = getSeriesMeta(locale)

  const renderPlaceholder = (message: string) => (
    <div className="relative flex min-h-[440px] flex-col overflow-hidden rounded-xl border border-cyber-border bg-cyber-surface shadow-lg animate-on-load delay-400 motion-safe:animate-slide-in">
      <div className="absolute top-0 left-0 w-full h-px bg-linear-to-r from-transparent via-cyber-primary/30 to-transparent" />
      <div className="p-4 pb-2">
        <h2 className="text-base font-bold text-cyber-text tracking-tight flex items-center gap-2">
          <span className="w-1 h-4 bg-cyber-primary rounded-full shadow-[0_0_10px_rgba(88,166,255,0.8)]" />
          {lt(locale, {
            'zh-TW': '安全威脅演進',
            'zh-CN': '安全威胁演进',
            en: 'Security Threat Trend',
          })}
        </h2>
        <p className="mt-1 ml-3 text-xs font-black uppercase tracking-[0.08em] text-cyber-textmuted opacity-50">
          Security Pulse Engine
        </p>
      </div>
      <div className="flex-1 flex items-center justify-center text-cyber-textmuted text-sm">{message}</div>
    </div>
  )

  if (isLoading)
    return renderPlaceholder(
      lt(locale, { 'zh-TW': '載入中…', 'zh-CN': '加载中…', en: 'Loading…' }),
    )
  if (isError || !trend)
    return renderPlaceholder(
      lt(locale, {
        'zh-TW': '無法載入趨勢資料',
        'zh-CN': '无法加载趋势数据',
        en: 'Failed to load trend data',
      }),
    )
  if (trend.length === 0)
    return renderPlaceholder(
      lt(locale, {
        'zh-TW': '尚無趨勢資料',
        'zh-CN': '暂无趋势数据',
        en: 'No trend data yet',
      }),
    )

  const trendInsights = computeTrendInsights(trend, locale)
  const suggestedPreset: VulnerabilityFilterPreset =
    trendInsights.pressureHigh || (trendInsights.openNet7d ?? 0) > 2
      ? 'critical_open'
      : (trendInsights.openNet7d ?? 0) > 0
        ? 'high_open'
        : 'open_all'

  const trendStatusLabel = trendInsights.pressureHigh
    ? lt(locale, { 'zh-TW': '壓力升高', 'zh-CN': '压力升高', en: 'Pressure Rising' })
    : lt(locale, { 'zh-TW': '趨勢可控', 'zh-CN': '趋势可控', en: 'Trend Controlled' })
  const trendStatusToneClass = trendInsights.pressureHigh
    ? 'text-red-700 dark:text-red-300'
    : 'text-emerald-700 dark:text-emerald-300'
  const trendStatusDescription = trendInsights.pressureHigh
    ? (trendInsights.pressureReason ??
      lt(locale, {
        'zh-TW': '待處理風險有上升訊號，建議優先止血。',
        'zh-CN': '待处理风险出现上升信号，建议优先止血。',
        en: 'Open risk is rising; prioritize immediate containment.',
      }))
    : !trendInsights.hasEnoughData
      ? lt(locale, {
          'zh-TW': '目前樣本仍少，請持續累積掃描資料以提高趨勢判讀準確度。',
          'zh-CN': '当前样本较少，请持续累积扫描数据以提升趋势判断准确度。',
          en: 'Sample size is still small. Keep collecting scans for better trend confidence.',
        })
      : (trendInsights.openNet7d ?? 0) <= 0
        ? lt(locale, {
            'zh-TW': '最近 7 日待處理未淨增，整體節奏仍在可控範圍。',
            'zh-CN': '最近 7 日待处理未净增，整体节奏仍可控。',
            en: 'No 7-day net increase in open backlog. Overall pace remains controllable.',
          })
        : lt(locale, {
            'zh-TW': '雖有新增，但尚未形成連續上升壓力，可維持目前節奏。',
            'zh-CN': '虽有新增，但尚未形成连续上升压力，可维持当前节奏。',
            en: 'There is some increase, but not a sustained upward pressure yet.',
          })
  const trendStatusAction = trendInsights.pressureHigh
    ? lt(locale, {
        'zh-TW': '建議先清理嚴重級與高風險待處理，將 7 日淨變化壓回 <= 0。',
        'zh-CN': '建议先清理严重级与高风险待处理，将 7 日净变化压回 <= 0。',
        en: 'Prioritize critical/high-risk items and drive 7-day open net change back to <= 0.',
      })
    : lt(locale, {
        'zh-TW': '建議維持每日修復節奏，持續觀察 7 日淨變化與修復速度。',
        'zh-CN': '建议维持每日修复节奏，持续观察 7 日净变化与修复速度。',
        en: 'Keep daily remediation cadence and monitor 7-day open net change and fix velocity.',
      })
  const handleSeriesPinToggle = (series: TrendSeriesKey): void => {
    setPinnedSeries((prev) => (prev === series ? null : series))
  }
  const getStrokeOpacity = (series: TrendSeriesKey): number =>
    activeSeries && activeSeries !== series ? 0.4 : 1
  const getFillOpacity = (series: TrendSeriesKey): number =>
    activeSeries && activeSeries !== series ? 0.32 : 1

  return (
    <div className="relative flex min-h-[440px] flex-col overflow-hidden rounded-xl border border-cyber-border bg-cyber-surface shadow-lg transition-[border-color,box-shadow] duration-200 hover:duration-300 hover:border-cyber-primary/60 hover:shadow-cyan-900/20 animate-on-load delay-400 motion-safe:animate-slide-in">
      <div className="absolute top-0 left-0 w-full h-px bg-linear-to-r from-transparent via-cyber-primary/30 to-transparent" />

      {/* 標題 */}
      <div className="p-4 pb-2">
        <h2 className="text-base font-bold text-cyber-text tracking-tight flex items-center gap-2">
          <span className="w-1 h-4 bg-cyber-primary rounded-full shadow-[0_0_10px_rgba(88,166,255,0.8)]" />
          {lt(locale, {
            'zh-TW': '安全威脅演進',
            'zh-CN': '安全威胁演进',
            en: 'Security Threat Trend',
          })}
        </h2>
        <p className="mt-1 ml-3 text-xs font-black uppercase tracking-[0.08em] text-cyber-textmuted opacity-50">
          Security Pulse Engine
        </p>
      </div>

      {/* 面積圖：小螢幕提高占比，讓圖表成為主要視覺焦點 */}
      <m.div
        className="mt-2 h-[360px] px-4 md:h-[300px]"
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={reduceMotion ? undefined : { y: -2, scale: 1.005 }}
        transition={{
          duration: MOTION_DURATIONS.slow,
          ease: MOTION_EASING.enter,
          delay: 0.06,
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={trend} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
            <defs>
              <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={seriesMeta.total.color} stopOpacity={0.56} />
                <stop offset="95%" stopColor={seriesMeta.total.color} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradOpen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={seriesMeta.open.color} stopOpacity={0.44} />
                <stop offset="95%" stopColor={seriesMeta.open.color} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradFixed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={seriesMeta.fixed.color} stopOpacity={0.44} />
                <stop offset="95%" stopColor={seriesMeta.fixed.color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="5 5"
              stroke="var(--cyber-border)"
              vertical={false}
              opacity={0.35}
            />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              stroke="var(--cyber-textmuted)"
              fontSize={11}
              fontWeight="bold"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
            />
            <YAxis
              stroke="var(--cyber-textmuted)"
              fontSize={11}
              fontWeight="bold"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE.contentStyle}
              itemStyle={CHART_TOOLTIP_STYLE.itemStyle}
              labelStyle={CHART_TOOLTIP_STYLE.labelStyle}
              cursor={{
                stroke: 'var(--cyber-primary)',
                strokeDasharray: '4 4',
                strokeWidth: 1,
                opacity: 0.45,
              }}
            />
            <Area
              type="monotone"
              dataKey="total"
              name={seriesMeta.total.label}
              stroke={seriesMeta.total.color}
              fill="url(#gradTotal)"
              strokeWidth={activeSeries === 'total' ? 3.6 : 3}
              strokeOpacity={getStrokeOpacity('total')}
              fillOpacity={getFillOpacity('total')}
              dot={{
                r: 3,
                fill: 'var(--cyber-surface)',
                strokeWidth: 2,
                stroke: seriesMeta.total.color,
              }}
              activeDot={{
                r: 5,
                fill: 'var(--cyber-surface)',
                stroke: seriesMeta.total.color,
                strokeWidth: 2,
              }}
              onMouseEnter={() => setHoverSeries('total')}
              onMouseLeave={() => setHoverSeries(null)}
              isAnimationActive={!reduceMotion}
              animationBegin={80}
              animationDuration={920}
              animationEasing="ease-out"
            />
            <Area
              type="monotone"
              dataKey="open"
              name={seriesMeta.open.label}
              stroke={seriesMeta.open.color}
              fill="url(#gradOpen)"
              strokeWidth={activeSeries === 'open' ? 2.8 : 2}
              strokeOpacity={getStrokeOpacity('open')}
              fillOpacity={getFillOpacity('open')}
              dot={false}
              onMouseEnter={() => setHoverSeries('open')}
              onMouseLeave={() => setHoverSeries(null)}
              isAnimationActive={!reduceMotion}
              animationBegin={170}
              animationDuration={940}
              animationEasing="ease-out"
            />
            <Area
              type="monotone"
              dataKey="fixed"
              name={seriesMeta.fixed.label}
              stroke={seriesMeta.fixed.color}
              fill="url(#gradFixed)"
              strokeWidth={activeSeries === 'fixed' ? 2.8 : 2}
              strokeOpacity={getStrokeOpacity('fixed')}
              fillOpacity={getFillOpacity('fixed')}
              dot={false}
              onMouseEnter={() => setHoverSeries('fixed')}
              onMouseLeave={() => setHoverSeries(null)}
              isAnimationActive={!reduceMotion}
              animationBegin={260}
              animationDuration={940}
              animationEasing="ease-out"
            />
            <Area
              type="monotone"
              dataKey="ignored"
              name={seriesMeta.ignored.label}
              stroke={seriesMeta.ignored.color}
              fill="none"
              strokeWidth={activeSeries === 'ignored' ? 2 : 1.5}
              strokeOpacity={getStrokeOpacity('ignored')}
              strokeDasharray="4 4"
              dot={false}
              onMouseEnter={() => setHoverSeries('ignored')}
              onMouseLeave={() => setHoverSeries(null)}
              isAnimationActive={!reduceMotion}
              animationBegin={340}
              animationDuration={900}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      </m.div>

      <div className="mt-2 px-4">
        <div className="flex flex-wrap gap-2">
          {(Object.keys(seriesMeta) as TrendSeriesKey[]).map((series) => {
            const meta = seriesMeta[series]
            const focused = activeSeries === series
            const pinned = pinnedSeries === series
            return (
              <button
                key={series}
                type="button"
                aria-pressed={pinned}
                onClick={() => handleSeriesPinToggle(series)}
                onMouseEnter={() => setHoverSeries(series)}
                onMouseLeave={() => setHoverSeries(null)}
                className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-[11px] font-bold tracking-[0.04em] transition-[transform,background-color,border-color,opacity] duration-200 ${
                  focused
                    ? 'border-cyber-primary/70 bg-cyber-primary/15 text-cyber-text'
                    : 'border-cyber-border bg-cyber-bg/40 text-cyber-textmuted'
                }`}
              >
                <span
                  className="inline-flex h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
                {meta.label}
                {pinned && (
                  <span className="font-mono text-[10px] text-cyber-primary">
                    {lt(locale, { 'zh-TW': '鎖定', 'zh-CN': '锁定', en: 'Pinned' })}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mx-4 mt-3 rounded-xl border border-cyber-border/45 bg-cyber-bg/25 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-black tracking-[0.04em] text-cyber-text">
            {lt(locale, {
              'zh-TW': '7 日趨勢摘要',
              'zh-CN': '7 日趋势摘要',
              en: '7-Day Trend Summary',
            })}
          </p>
          <span className={`text-xs font-bold ${trendStatusToneClass}`}>{trendStatusLabel}</span>
        </div>
        <div className="custom-scrollbar mt-3 flex gap-2 overflow-x-auto md:grid md:grid-cols-3 md:overflow-visible">
          {trendInsights.metrics.map((metric) => (
            <div
              key={metric.key}
              className="min-w-[9.75rem] rounded-lg border border-cyber-border/65 bg-cyber-surface/55 px-2.5 py-2 md:min-w-0 md:px-3 md:py-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] leading-tight font-bold text-cyber-text">{metric.label}</span>
                <MetricHelp content={metric.help} locale={locale} />
              </div>
              <p className={`mt-1 font-mono text-sm font-black md:mt-1.5 md:text-base ${metricToneClass[metric.tone]}`}>
                {metric.value}
              </p>
              <p className="mt-1 hidden text-xs leading-relaxed text-cyber-textmuted md:block">{metric.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 狀態頁腳列 */}
      <div className="mx-4 mt-3 mb-4 rounded-xl border border-cyber-border/60 bg-cyber-bg/50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-[16rem] flex-1 items-start gap-3">
            <Shield className={`mt-0.5 size-5 ${trendStatusToneClass}`} />
            <div className="min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-black text-cyber-text">趨勢判讀：{trendStatusLabel}</span>
                <MetricHelp
                  content={{
                    formula: lt(locale, {
                      'zh-TW': '壓力判讀 = 7 日淨增 + 連續上升檢查',
                      'zh-CN': '压力判读 = 7 日净增 + 连续上升检查',
                      en: 'Pressure signal = 7-day open net + consecutive rising check',
                    }),
                    meaning: trendStatusDescription,
                    ideal: trendStatusAction,
                  }}
                  locale={locale}
                />
              </div>
              <p className="text-xs leading-relaxed text-cyber-textmuted">{trendStatusDescription}</p>
              <p className="text-xs leading-relaxed text-cyber-text">
                <span className="font-semibold text-cyber-primary">
                  {lt(locale, { 'zh-TW': '建議：', 'zh-CN': '建议：', en: 'Recommendation: ' })}
                </span>
                {trendStatusAction}
              </p>
            </div>
          </div>
          {onNavigatePreset && (
            <button
              type="button"
              onClick={() => onNavigatePreset(suggestedPreset)}
              className="inline-flex items-center rounded border border-cyber-primary/50 bg-cyber-primary/10 px-2.5 py-1.5 text-xs font-bold tracking-[0.04em] text-cyber-primary transition-colors hover:border-cyber-primary hover:bg-cyber-primary/20"
            >
              {lt(locale, { 'zh-TW': '前往', 'zh-CN': '前往', en: 'Go to' })}{' '}
              {getPresetLabel(suggestedPreset, locale)}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

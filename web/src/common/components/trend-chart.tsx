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
import { useVulnTrend } from '@/hooks/use-vulnerabilities'
import {
  computeTrendInsights,
  type MetricHelpContent,
  PRESET_LABELS,
} from '@/libs/dashboard-insights'
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

/** 格式化日期標籤（MM/DD） */
const formatDate = (dateStr: string): string => {
  const parts = dateStr.split('-')
  return `${parts[1]}/${parts[2]}`
}

const MetricHelp: React.FC<{ content: MetricHelpContent }> = ({ content }) => {
  return (
    <UiTooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-cyber-border text-cyber-textmuted transition-colors hover:border-cyber-primary hover:text-cyber-primary"
          aria-label="查看趨勢指標說明"
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
        <span className="block text-xs font-black uppercase tracking-[0.08em] text-cyber-primary">怎麼算</span>
        <span className="mt-1 block font-mono text-cyber-textmuted">{content.formula}</span>
        <span className="mt-2 block text-xs font-black uppercase tracking-[0.08em] text-cyber-primary">代表什麼</span>
        <span className="mt-1 block text-cyber-textmuted">{content.meaning}</span>
        <span className="mt-2 block text-xs font-black uppercase tracking-[0.08em] text-cyber-primary">何時警戒</span>
        <span className="mt-1 block text-cyber-textmuted">{content.ideal}</span>
      </TooltipContent>
    </UiTooltip>
  )
}

interface TrendChartProps {
  onNavigatePreset?: (preset: VulnerabilityFilterPreset) => void
}

type TrendSeriesKey = 'total' | 'open' | 'fixed' | 'ignored'

const SERIES_META: Record<TrendSeriesKey, { label: string; color: string }> = {
  total: { label: '總計', color: 'var(--state-low)' },
  open: { label: '待處理', color: 'var(--state-high)' },
  fixed: { label: '已修復', color: 'var(--state-safe)' },
  ignored: { label: '已忽略', color: 'var(--state-info)' },
}

// === 安全趨勢面積圖 ===

export const TrendChart: React.FC<TrendChartProps> = ({ onNavigatePreset }) => {
  const reduceMotion = useReducedMotion()
  const [hoverSeries, setHoverSeries] = useState<TrendSeriesKey | null>(null)
  const [pinnedSeries, setPinnedSeries] = useState<TrendSeriesKey | null>(null)
  const { data: trend, isLoading, isError } = useVulnTrend()
  const activeSeries = hoverSeries ?? pinnedSeries

  const renderPlaceholder = (message: string) => (
    <div className="relative flex min-h-[440px] flex-col overflow-hidden rounded-xl border border-cyber-border bg-cyber-surface shadow-lg animate-on-load delay-400 motion-safe:animate-slide-in">
      <div className="absolute top-0 left-0 w-full h-px bg-linear-to-r from-transparent via-cyber-primary/30 to-transparent" />
      <div className="p-4 pb-2">
        <h2 className="text-base font-bold text-cyber-text tracking-tight flex items-center gap-2">
          <span className="w-1 h-4 bg-cyber-primary rounded-full shadow-[0_0_10px_rgba(88,166,255,0.8)]" />
          安全威脅演進
        </h2>
        <p className="mt-1 ml-3 text-xs font-black uppercase tracking-[0.08em] text-cyber-textmuted opacity-50">
          Security Pulse Engine
        </p>
      </div>
      <div className="flex-1 flex items-center justify-center text-cyber-textmuted text-sm">{message}</div>
    </div>
  )

  if (isLoading) return renderPlaceholder('載入中…')
  if (isError || !trend) return renderPlaceholder('無法載入趨勢資料')
  if (trend.length === 0) return renderPlaceholder('尚無趨勢資料')

  const trendInsights = computeTrendInsights(trend)
  const suggestedPreset: VulnerabilityFilterPreset =
    trendInsights.pressureHigh || (trendInsights.openNet7d ?? 0) > 2
      ? 'critical_open'
      : (trendInsights.openNet7d ?? 0) > 0
        ? 'high_open'
        : 'open_all'

  const trendStatusLabel = trendInsights.pressureHigh ? '壓力升高' : '趨勢可控'
  const trendStatusToneClass = trendInsights.pressureHigh
    ? 'text-red-700 dark:text-red-300'
    : 'text-emerald-700 dark:text-emerald-300'
  const trendStatusDescription = trendInsights.pressureHigh
    ? (trendInsights.pressureReason ?? '待處理風險有上升訊號，建議優先止血。')
    : !trendInsights.hasEnoughData
      ? '目前樣本仍少，請持續累積掃描資料以提高趨勢判讀準確度。'
      : (trendInsights.openNet7d ?? 0) <= 0
        ? '最近 7 日待處理未淨增，整體節奏仍在可控範圍。'
        : '雖有新增，但尚未形成連續上升壓力，可維持目前節奏。'
  const trendStatusAction = trendInsights.pressureHigh
    ? '建議先清理嚴重級與高風險待處理，將 7 日淨變化壓回 <= 0。'
    : '建議維持每日修復節奏，持續觀察 7 日淨變化與修復速度。'
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
          安全威脅演進
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
                <stop offset="5%" stopColor="var(--state-low)" stopOpacity={0.4} />
                <stop offset="95%" stopColor="var(--state-low)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradOpen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--state-high)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--state-high)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradFixed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--state-safe)" stopOpacity={0.3} />
                <stop offset="95%" stopColor="var(--state-safe)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="5 5" stroke="var(--cyber-border)" vertical={false} opacity={0.4} />
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
              name="總計"
              stroke="var(--state-low)"
              fill="url(#gradTotal)"
              strokeWidth={activeSeries === 'total' ? 3.6 : 3}
              strokeOpacity={getStrokeOpacity('total')}
              fillOpacity={getFillOpacity('total')}
              dot={{ r: 3, fill: 'var(--cyber-bg)', strokeWidth: 2, stroke: 'var(--state-low)' }}
              activeDot={{
                r: 5,
                fill: 'var(--cyber-bg)',
                stroke: 'var(--state-low)',
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
              name="待處理"
              stroke="var(--state-high)"
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
              name="已修復"
              stroke="var(--state-safe)"
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
              name="已忽略"
              stroke="var(--state-info)"
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
          {(Object.keys(SERIES_META) as TrendSeriesKey[]).map((series) => {
            const meta = SERIES_META[series]
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
                {pinned && <span className="font-mono text-[10px] text-cyber-primary">鎖定</span>}
              </button>
            )
          })}
        </div>
      </div>

      <div className="mx-4 mt-3 rounded-xl border border-cyber-border/45 bg-cyber-bg/25 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-black tracking-[0.04em] text-cyber-text">7 日趨勢摘要</p>
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
                <MetricHelp content={metric.help} />
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
                    formula: '壓力判讀 = 7 日淨增 + 連續上升檢查',
                    meaning: trendStatusDescription,
                    ideal: trendStatusAction,
                  }}
                />
              </div>
              <p className="text-xs leading-relaxed text-cyber-textmuted">{trendStatusDescription}</p>
              <p className="text-xs leading-relaxed text-cyber-text">
                <span className="font-semibold text-cyber-primary">建議：</span>
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
              前往 {PRESET_LABELS[suggestedPreset]}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

import { CircleHelp, Shield } from 'lucide-react'
import React from 'react'
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

// === Cyber 風格 tooltip 樣式 ===

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: 'rgba(13, 17, 23, 0.95)',
    backdropFilter: 'blur(10px)',
    borderRadius: '8px',
    border: '1px solid #30363D',
    padding: '10px',
  },
  itemStyle: { color: '#E6EDF3', fontSize: '11px', fontWeight: 'bold' as const },
  labelStyle: {
    color: '#8B949E',
    fontSize: '10px',
    marginBottom: '4px',
    textTransform: 'uppercase' as const,
    fontWeight: '900' as const,
  },
}

const metricToneClass = {
  positive: 'text-emerald-300',
  warning: 'text-amber-300',
  negative: 'text-red-300',
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
        className="w-[min(18rem,calc(100vw-2rem))] rounded-lg border-cyber-border bg-cyber-surface2 p-3 text-left text-[11px] leading-relaxed text-cyber-text"
      >
        <span className="block text-[10px] font-black uppercase tracking-wider text-cyber-primary">怎麼算</span>
        <span className="mt-1 block font-mono text-cyber-textmuted">{content.formula}</span>
        <span className="mt-2 block text-[10px] font-black uppercase tracking-wider text-cyber-primary">代表什麼</span>
        <span className="mt-1 block text-cyber-textmuted">{content.meaning}</span>
        <span className="mt-2 block text-[10px] font-black uppercase tracking-wider text-cyber-primary">何時警戒</span>
        <span className="mt-1 block text-cyber-textmuted">{content.ideal}</span>
      </TooltipContent>
    </UiTooltip>
  )
}

interface TrendChartProps {
  onNavigatePreset?: (preset: VulnerabilityFilterPreset) => void
}

// === 安全趨勢面積圖 ===

export const TrendChart: React.FC<TrendChartProps> = ({ onNavigatePreset }) => {
  const { data: trend, isLoading, isError } = useVulnTrend()

  const renderPlaceholder = (message: string) => (
    <div className="relative overflow-hidden rounded-xl border border-cyber-border bg-cyber-surface shadow-lg animate-slide-in animate-on-load delay-400 min-h-[440px] flex flex-col">
      <div className="absolute top-0 left-0 w-full h-px bg-linear-to-r from-transparent via-cyber-primary/30 to-transparent" />
      <div className="p-4 pb-2">
        <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
          <span className="w-1 h-4 bg-cyber-primary rounded-full shadow-[0_0_10px_rgba(88,166,255,0.8)]" />
          安全威脅演進
        </h2>
        <p className="text-[10px] text-cyber-textmuted mt-1 uppercase tracking-widest font-black ml-3 opacity-50">
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

  return (
    <div className="relative overflow-hidden rounded-xl border border-cyber-border bg-cyber-surface shadow-lg transition-[border-color,box-shadow] duration-75 hover:duration-300 hover:border-cyber-primary/60 hover:shadow-cyan-900/20 animate-slide-in animate-on-load delay-400 min-h-[440px] flex flex-col">
      <div className="absolute top-0 left-0 w-full h-px bg-linear-to-r from-transparent via-cyber-primary/30 to-transparent" />

      {/* 標題 */}
      <div className="p-4 pb-2">
        <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
          <span className="w-1 h-4 bg-cyber-primary rounded-full shadow-[0_0_10px_rgba(88,166,255,0.8)]" />
          安全威脅演進
        </h2>
        <p className="text-[10px] text-cyber-textmuted mt-1 uppercase tracking-widest font-black ml-3 opacity-50">
          Security Pulse Engine
        </p>
      </div>

      {/* 面積圖：ResponsiveContainer 需要可計算高度，避免圖表高度為 0 */}
      <div className="px-4 mt-2 h-[280px] sm:h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={trend} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
            <defs>
              <linearGradient id="gradTotal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#58A6FF" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#58A6FF" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradOpen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#D29922" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#D29922" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradFixed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2EA043" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#2EA043" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="5 5" stroke="#30363D" vertical={false} opacity={0.3} />
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              stroke="#8B949E"
              fontSize={10}
              fontWeight="bold"
              tickLine={false}
              axisLine={false}
              tickMargin={10}
            />
            <YAxis
              stroke="#8B949E"
              fontSize={10}
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
            />
            <Area
              type="monotone"
              dataKey="total"
              name="總計"
              stroke="#58A6FF"
              fill="url(#gradTotal)"
              strokeWidth={3}
              dot={{ r: 3, fill: '#0A0C10', strokeWidth: 2, stroke: '#58A6FF' }}
            />
            <Area
              type="monotone"
              dataKey="open"
              name="待處理"
              stroke="#D29922"
              fill="url(#gradOpen)"
              strokeWidth={2}
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="fixed"
              name="已修復"
              stroke="#2EA043"
              fill="url(#gradFixed)"
              strokeWidth={2}
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="ignored"
              name="已忽略"
              stroke="#8B949E"
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="mx-4 mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        {trendInsights.metrics.map((metric) => (
          <div
            key={metric.key}
            className="rounded-lg border border-cyber-border bg-cyber-bg/40 px-3 py-2 text-[11px]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-black uppercase tracking-[0.12em] text-cyber-textmuted">
                {metric.label}
              </span>
              <MetricHelp content={metric.help} />
            </div>
            <p className={`mt-1 font-mono text-sm font-black ${metricToneClass[metric.tone]}`}>
              {metric.value}
            </p>
          </div>
        ))}
      </div>

      {/* 狀態頁腳列 */}
      <div className="mx-4 mt-3 mb-4 rounded-xl border border-cyber-border/60 bg-cyber-bg/50 p-4 flex justify-between items-center gap-3">
        <div className="flex items-center gap-4">
          <Shield className="size-6 text-cyber-accent" />
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-black text-white uppercase tracking-widest block">
              {trendInsights.pressureHigh ? '壓力升高' : '趨勢可控'}
            </span>
            <MetricHelp
              content={{
                formula: '壓力判讀 = 7 日淨增 + 連續上升檢查',
                meaning: trendInsights.pressureReason ?? '目前未出現連續上升訊號，可維持既有節奏。',
                ideal: '若顯示壓力升高，建議先處理嚴重級與高風險待處理項目。',
              }}
            />
          </div>
        </div>
        {onNavigatePreset && (
          <button
            type="button"
            onClick={() => onNavigatePreset(suggestedPreset)}
            className="inline-flex items-center rounded border border-cyber-primary/50 bg-cyber-primary/10 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-cyber-primary transition-colors hover:border-cyber-primary hover:bg-cyber-primary/20"
          >
            前往 {PRESET_LABELS[suggestedPreset]}
          </button>
        )}
      </div>
    </div>
  )
}

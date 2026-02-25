'use client'

import { Shield } from 'lucide-react'
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

import { useVulnTrend } from '@/hooks/use-vulnerabilities'

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

/** 格式化日期標籤（MM/DD） */
const formatDate = (dateStr: string): string => {
  const parts = dateStr.split('-')
  return `${parts[1]}/${parts[2]}`
}

// === 安全趨勢面積圖 ===

export const TrendChart: React.FC = () => {
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
      <div className="flex-1 flex items-center justify-center text-cyber-textmuted text-sm">
        {message}
      </div>
    </div>
  )

  if (isLoading) return renderPlaceholder('載入中…')
  if (isError || !trend) return renderPlaceholder('無法載入趨勢資料')
  if (trend.length === 0) return renderPlaceholder('尚無趨勢資料')

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
            <CartesianGrid
              strokeDasharray="5 5"
              stroke="#30363D"
              vertical={false}
              opacity={0.3}
            />
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

      {/* 狀態頁腳列 */}
      <div className="mx-4 mb-4 p-4 bg-cyber-bg/50 rounded-xl border border-cyber-border/60 flex justify-between items-center">
        <div className="flex items-center gap-4">
          <Shield className="size-6 text-cyber-accent" />
          <div>
            <span className="text-[11px] font-black text-white uppercase tracking-widest block">
              AI 分析採手動觸發
            </span>
            <span className="text-[9px] text-cyber-textmuted font-bold">
              僅在你主動操作時才會呼叫模型
            </span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-mono text-white opacity-30">
            最後同步: {new Date().toLocaleTimeString()}
          </span>
        </div>
      </div>
    </div>
  )
}

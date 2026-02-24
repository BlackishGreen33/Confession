'use client'

import { ChevronDown, FileText, FolderOpen, Zap } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

import { GlowButton } from '@/components/glow-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { postToExtension } from '@/hooks/use-extension-bridge'
import { useVulnStats } from '@/hooks/use-vulnerabilities'

import { TrendChart } from './trend-chart'

// === 嚴重等級配色 ===

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#F85149',
  high: '#D29922',
  medium: '#E3B341',
  low: '#58A6FF',
  info: '#8B949E',
}

const SEVERITY_LABELS: Record<string, string> = {
  critical: '嚴重',
  high: '高',
  medium: '中',
  low: '低',
  info: '資訊',
}

// === Cyber 統計卡片 ===

interface CyberStatCardProps {
  label: string
  value: string | number
  trend: string
  trendUp: boolean
  subtext: string
  barColor: string
  hoverBorderColor: string
  delay: string
}

const CyberStatCard: React.FC<CyberStatCardProps> = ({
  label,
  value,
  trend,
  trendUp,
  subtext,
  barColor,
  hoverBorderColor,
  delay,
}) => {
  return (
    <div
      className={`group relative min-h-[140px] overflow-hidden rounded-xl border border-cyber-border bg-cyber-surface shadow-lg transition-[border-color,box-shadow] duration-75 hover:duration-300 animate-slide-in animate-on-load cursor-default ${hoverBorderColor} ${delay}`}
    >
      {/* 頂部漸層線 */}
      <div className="absolute top-0 left-0 w-full h-px bg-linear-to-r from-transparent via-cyber-primary/30 to-transparent" />

      <div className="h-full p-5 flex flex-col justify-between relative z-10">
        <div className="space-y-1">
          <span className="text-[10px] font-black tracking-[0.2em] uppercase text-cyber-textmuted block">
            {label}
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-black text-white font-mono tracking-tighter">
              {value}
            </span>
            <div
              className={`px-2 py-0.5 rounded border text-[10px] font-black ${
                trendUp
                  ? 'bg-green-500/10 text-green-500 border-green-500/20'
                  : 'bg-amber-500/10 text-amber-500 border-amber-500/20'
              }`}
            >
              {trend}
            </div>
          </div>
        </div>
        <p className="text-[10px] text-cyber-textmuted font-bold tracking-tight opacity-70 mt-4">
          {subtext}
        </p>
      </div>

      {/* 底部動畫彩色條 */}
      <div
        className={`absolute bottom-0 left-0 h-[2px] ${barColor} w-0 group-hover:w-full transition-all duration-700`}
      />
    </div>
  )
}

// === Cyber 甜甜圈圓餅圖 ===

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

const SeverityChart: React.FC<{ bySeverity: Record<string, number>; total: number }> = ({
  bySeverity,
  total,
}) => {
  const data = Object.entries(bySeverity)
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => ({
      name: SEVERITY_LABELS[severity] ?? severity,
      value: count,
      severity,
      color: SEVERITY_COLORS[severity] ?? '#8B949E',
    }))

  if (data.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-cyber-textmuted text-sm">
        尚無漏洞資料
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {/* 甜甜圈圖 + 中心數值 */}
      <div className="relative h-[240px] mb-6">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={100}
              paddingAngle={6}
              dataKey="value"
              nameKey="name"
              stroke="none"
            >
              {data.map((entry) => (
                <Cell key={entry.severity} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE.contentStyle}
              itemStyle={CHART_TOOLTIP_STYLE.itemStyle}
              labelStyle={CHART_TOOLTIP_STYLE.labelStyle}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-4xl font-black text-white font-mono tracking-tighter">
            {total}
          </span>
          <span className="text-[9px] text-cyber-textmuted uppercase font-black tracking-[0.2em] mt-1">
            Total
          </span>
        </div>
      </div>

      {/* 圖例網格 */}
      <div className="grid grid-cols-2 gap-3">
        {data.map((item) => (
          <div
            key={item.severity}
            className="flex items-center justify-between p-2.5 bg-cyber-bg/40 rounded border border-cyber-border/40 hover:border-cyber-primary/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: item.color, boxShadow: `0 0 5px ${item.color}` }}
              />
              <span className="text-[10px] font-black text-cyber-textmuted uppercase">
                {item.name}
              </span>
            </div>
            <span className="font-mono text-xs text-white font-black">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// === 儀表盤標題區塊 ===

const DashboardHeader: React.FC = () => {
  const [isScanMenuOpen, setIsScanMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsScanMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleScan = useCallback((scope: 'file' | 'workspace') => {
    postToExtension({ type: 'request_scan', data: { scope } })
    setIsScanMenuOpen(false)
  }, [])

  return (
    <header className="relative z-20 flex flex-col sm:flex-row sm:items-end justify-between gap-4 animate-fade-in animate-on-load">
      <div className="space-y-2">
        <Badge
          variant="outline"
          className="gap-2 border-cyber-primary/30 bg-cyber-primary/10 text-cyber-primary text-[10px] font-black uppercase tracking-[0.2em]"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-cyber-primary animate-pulse shadow-[0_0_5px_#58A6FF]" />
          系統狀態：正常運行
        </Badge>
        <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tighter">
          安全態勢核心{' '}
          <span className="text-cyber-primary/50 text-base font-mono ml-2 uppercase opacity-40">
            Dashboard
          </span>
        </h1>
      </div>
      <div className="flex gap-3 items-center">
        <Button
          variant="outline"
          size="sm"
          className="text-[10px] font-black uppercase tracking-widest glass-panel"
        >
          匯出報告
        </Button>

        {/* 掃描按鈕下拉選單 */}
        <div className="relative" ref={menuRef}>
          <GlowButton
            size="sm"
            className="gap-2 text-[11px]"
            onClick={() => setIsScanMenuOpen(!isScanMenuOpen)}
          >
            <Zap className="size-4" />
            執行掃描
            <ChevronDown className="size-3" />
          </GlowButton>

          {isScanMenuOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-cyber-surface border border-cyber-primary/40 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] z-50 overflow-hidden backdrop-blur-xl animate-slide-in">
              <div className="absolute top-0 left-0 w-full h-px bg-cyber-primary/40" />
              <button
                type="button"
                onClick={() => handleScan('file')}
                className="w-full px-5 py-3.5 text-left text-[11px] font-bold text-white hover:bg-cyber-primary/10 hover:text-cyber-primary transition-all flex items-center gap-3 border-b border-cyber-border/50 group cursor-pointer"
              >
                <FileText className="size-5 text-cyber-primary opacity-70 group-hover:opacity-100" />
                <span>掃描當前文件</span>
              </button>
              <button
                type="button"
                onClick={() => handleScan('workspace')}
                className="w-full px-5 py-3.5 text-left text-[11px] font-bold text-white hover:bg-cyber-primary/10 hover:text-cyber-primary transition-all flex items-center gap-3 group cursor-pointer"
              >
                <FolderOpen className="size-5 text-cyber-primary opacity-70 group-hover:opacity-100" />
                <span>掃描整個工作區</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

// === Cyber 風格卡片容器 ===

interface CyberCardProps {
  title: string
  subtitle?: string
  children: React.ReactNode
  className?: string
  delay?: string
}

const CyberCard: React.FC<CyberCardProps> = ({ title, subtitle, children, className, delay }) => {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-cyber-border bg-cyber-surface shadow-lg transition-[border-color,box-shadow] duration-75 hover:duration-300 hover:border-cyber-primary/60 hover:shadow-cyan-900/20 animate-slide-in animate-on-load ${delay ?? ''} ${className ?? ''}`}
    >
      <div className="absolute top-0 left-0 w-full h-px bg-linear-to-r from-transparent via-cyber-primary/30 to-transparent" />
      <div className="p-4 pb-2">
        <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
          <span className="w-1 h-4 bg-cyber-primary rounded-full shadow-[0_0_10px_rgba(88,166,255,0.8)]" />
          {title}
        </h2>
        {subtitle && (
          <p className="text-[10px] text-cyber-textmuted mt-1 uppercase tracking-widest font-black ml-3 opacity-50">
            {subtitle}
          </p>
        )}
      </div>
      <div className="p-4 pt-0">{children}</div>
    </div>
  )
}

// === 儀表盤主元件 ===

export const Dashboard: React.FC = () => {
  const { data: stats, isLoading, isError } = useVulnStats()

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-cyber-textmuted">
        載入中…
      </div>
    )
  }

  if (isError || !stats) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-cyber-textmuted">
        無法載入統計資料
      </div>
    )
  }

  const openCount = stats.byStatus?.open ?? 0
  const fixedCount = stats.byStatus?.fixed ?? 0
  const ignoredCount = stats.byStatus?.ignored ?? 0
  const criticalHighCount = (stats.bySeverity?.critical ?? 0) + (stats.bySeverity?.high ?? 0)

  // 健康評分：基於修復率
  const healthScore =
    stats.total === 0
      ? 'A+'
      : stats.fixRate >= 0.8
        ? 'A'
        : stats.fixRate >= 0.6
          ? 'B+'
          : stats.fixRate >= 0.4
            ? 'B'
            : 'C'

  const statCards: CyberStatCardProps[] = [
    {
      label: '漏洞總數',
      value: stats.total,
      trend: `${stats.total}`,
      trendUp: false,
      subtext: '所有已偵測的漏洞',
      barColor: 'bg-blue-500',
      hoverBorderColor: 'hover:border-blue-500 hover:shadow-blue-500/20',
      delay: 'delay-100',
    },
    {
      label: '待處理',
      value: openCount,
      trend: openCount > 0 ? 'OPEN' : '- 0',
      trendUp: false,
      subtext: '尚未修復或忽略',
      barColor: 'bg-amber-500',
      hoverBorderColor: 'hover:border-amber-500 hover:shadow-amber-500/20',
      delay: 'delay-200',
    },
    {
      label: '嚴重 / 高風險',
      value: criticalHighCount,
      trend: criticalHighCount > 0 ? 'CRITICAL' : 'SAFE',
      trendUp: criticalHighCount > 0,
      subtext: '需優先處理',
      barColor: 'bg-red-500',
      hoverBorderColor: 'hover:border-red-500 hover:shadow-red-500/20',
      delay: 'delay-300',
    },
    {
      label: '健康評分',
      value: healthScore,
      trend: `${Math.round(stats.fixRate * 100)}%`,
      trendUp: stats.fixRate >= 0.5,
      subtext: `已修復 ${fixedCount}・已忽略 ${ignoredCount}`,
      barColor: 'bg-green-600',
      hoverBorderColor: 'hover:border-green-500 hover:shadow-green-500/20',
      delay: 'delay-400',
    },
  ]

  return (
    <div className="space-y-8">
      {/* 標題區塊 */}
      <DashboardHeader />

      {/* 統計卡片 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <CyberStatCard key={card.label} {...card} />
        ))}
      </div>

      {/* 圖表區 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 嚴重性分佈甜甜圈圖 */}
        <CyberCard
          title="風險資源分配"
          subtitle="Threat Matrix Allocation"
          className="lg:col-span-4 flex flex-col min-h-[440px]"
          delay="delay-400"
        >
          <SeverityChart bySeverity={stats.bySeverity} total={stats.total} />
        </CyberCard>

        {/* 安全趨勢面積圖 */}
        <div className="lg:col-span-8">
          <TrendChart />
        </div>
      </div>
    </div>
  )
}

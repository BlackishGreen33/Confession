'use client'

import { AlertTriangle, Bug, CheckCircle2, Shield, ShieldAlert, ShieldX } from 'lucide-react'
import React from 'react'
import { Cell, Pie, PieChart } from 'recharts'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { useVulnStats } from '@/hooks/use-vulnerabilities'

import { TrendChart } from './trend-chart'

// === 嚴重等級配色（對應 CSS 變數） ===

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'var(--color-severity-critical)',
  high: 'var(--color-severity-high)',
  medium: 'var(--color-severity-medium)',
  low: 'var(--color-severity-low)',
  info: 'var(--color-severity-info)',
}

const SEVERITY_LABELS: Record<string, string> = {
  critical: '嚴重',
  high: '高',
  medium: '中',
  low: '低',
  info: '資訊',
}

const severityChartConfig: ChartConfig = {
  critical: { label: '嚴重', color: 'var(--color-severity-critical)' },
  high: { label: '高', color: 'var(--color-severity-high)' },
  medium: { label: '中', color: 'var(--color-severity-medium)' },
  low: { label: '低', color: 'var(--color-severity-low)' },
  info: { label: '資訊', color: 'var(--color-severity-info)' },
}

// === 統計卡片 ===

interface StatCardProps {
  title: string
  value: string | number
  description: string
  icon: React.ReactNode
}

const StatCard: React.FC<StatCardProps> = ({ title, value, description, icon }) => {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-muted-foreground text-xs">{description}</p>
      </CardContent>
    </Card>
  )
}

// === 嚴重性分佈圓餅圖 ===

const SeverityChart: React.FC<{ bySeverity: Record<string, number> }> = ({ bySeverity }) => {
  const data = Object.entries(bySeverity)
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => ({
      name: SEVERITY_LABELS[severity] ?? severity,
      value: count,
      severity,
    }))

  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-muted-foreground text-sm">
        尚無漏洞資料
      </div>
    )
  }

  return (
    <ChartContainer config={severityChartConfig} className="mx-auto aspect-square h-[250px]">
      <PieChart>
        <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} strokeWidth={2}>
          {data.map((entry) => (
            <Cell key={entry.severity} fill={SEVERITY_COLORS[entry.severity] ?? 'var(--color-muted)'} />
          ))}
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="name" />} />
      </PieChart>
    </ChartContainer>
  )
}

// === 修復率指示器 ===

const FixRateIndicator: React.FC<{ fixRate: number }> = ({ fixRate }) => {
  const percentage = Math.round(fixRate * 100)
  const color = percentage >= 80 ? 'text-safe' : percentage >= 50 ? 'text-severity-medium' : 'text-severity-high'

  return (
    <div className="flex flex-col items-center gap-2">
      <div className={`text-4xl font-bold ${color}`}>{percentage}%</div>
      <p className="text-muted-foreground text-sm">漏洞修復率</p>
    </div>
  )
}

// === 儀表盤主元件 ===

export const Dashboard: React.FC = () => {
  const { data: stats, isLoading, isError } = useVulnStats()

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-muted-foreground">
        載入中…
      </div>
    )
  }

  if (isError || !stats) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-muted-foreground">
        無法載入統計資料
      </div>
    )
  }

  const openCount = stats.byStatus?.open ?? 0
  const fixedCount = stats.byStatus?.fixed ?? 0
  const ignoredCount = stats.byStatus?.ignored ?? 0
  const criticalHighCount = (stats.bySeverity?.critical ?? 0) + (stats.bySeverity?.high ?? 0)

  return (
    <div className="flex flex-col gap-6">
      {/* 統計卡片 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="漏洞總數"
          value={stats.total}
          description="所有已偵測的漏洞"
          icon={<Bug className="h-4 w-4" />}
        />
        <StatCard
          title="待處理"
          value={openCount}
          description="尚未修復或忽略"
          icon={<ShieldAlert className="h-4 w-4" />}
        />
        <StatCard
          title="嚴重 / 高風險"
          value={criticalHighCount}
          description="需優先處理"
          icon={<ShieldX className="h-4 w-4" />}
        />
        <StatCard
          title="已修復"
          value={fixedCount}
          description={`已忽略 ${ignoredCount} 項`}
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </div>

      {/* 圖表區 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>嚴重性分佈</CardTitle>
            <CardDescription>依嚴重等級分類的漏洞數量</CardDescription>
          </CardHeader>
          <CardContent>
            <SeverityChart bySeverity={stats.bySeverity} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>修復進度</CardTitle>
            <CardDescription>已修復漏洞佔總數的比例</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-center py-8">
            <div className="flex flex-col items-center gap-6">
              <FixRateIndicator fixRate={stats.fixRate} />
              <div className="flex gap-6 text-sm">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-safe" />
                  <span className="text-muted-foreground">已修復 {fixedCount}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-severity-medium" />
                  <span className="text-muted-foreground">待處理 {openCount}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">已忽略 {ignoredCount}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 歷史趨勢 */}
      <TrendChart />
    </div>
  )
}

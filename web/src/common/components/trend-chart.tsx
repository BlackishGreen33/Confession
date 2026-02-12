'use client'

import React from 'react'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { useVulnTrend } from '@/hooks/use-vulnerabilities'

// === 圖表配色 ===

const trendChartConfig: ChartConfig = {
  total: { label: '總計', color: 'var(--color-primary)' },
  open: { label: '待處理', color: 'var(--color-severity-high)' },
  fixed: { label: '已修復', color: 'var(--color-safe)' },
  ignored: { label: '已忽略', color: 'var(--color-muted-foreground)' },
}

/** 格式化日期標籤（MM/DD） */
const formatDate = (dateStr: string): string => {
  const parts = dateStr.split('-')
  return `${parts[1]}/${parts[2]}`
}

// === 歷史趨勢折線圖 ===

export const TrendChart: React.FC = () => {
  const { data: trend, isLoading, isError } = useVulnTrend()

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>歷史趨勢</CardTitle>
          <CardDescription>漏洞數量隨時間變化</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
            載入中…
          </div>
        </CardContent>
      </Card>
    )
  }

  if (isError || !trend) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>歷史趨勢</CardTitle>
          <CardDescription>漏洞數量隨時間變化</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
            無法載入趨勢資料
          </div>
        </CardContent>
      </Card>
    )
  }

  if (trend.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>歷史趨勢</CardTitle>
          <CardDescription>漏洞數量隨時間變化</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex h-[250px] items-center justify-center text-muted-foreground text-sm">
            尚無趨勢資料
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>歷史趨勢</CardTitle>
        <CardDescription>漏洞數量隨時間變化（累計）</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={trendChartConfig} className="h-[250px] w-full">
          <LineChart data={trend} accessibilityLayer>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" tickFormatter={formatDate} tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={40} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Line
              type="monotone"
              dataKey="total"
              stroke="var(--color-total)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="open"
              stroke="var(--color-open)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="fixed"
              stroke="var(--color-fixed)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="ignored"
              stroke="var(--color-ignored)"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

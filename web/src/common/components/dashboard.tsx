'use client'

import { ChevronDown, CircleHelp, Download, FileText, FolderOpen, X, Zap } from 'lucide-react'
import Link from 'next/link'
import React, { useCallback, useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from 'recharts'
import { toast } from 'sonner'

import { CyberDropdownMenu } from '@/components/elements/cyber-dropdown-menu'
import { CyberSelect } from '@/components/elements/cyber-select'
import { GlowButton } from '@/components/glow-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { createRequestId, postToExtension } from '@/hooks/use-extension-bridge'
import { useHealth } from '@/hooks/use-health'
import { useRecentScanSummary } from '@/hooks/use-scan'
import { useVulnStats } from '@/hooks/use-vulnerabilities'
import { api } from '@/libs/api-client'
import type { ExportFilters, ExportFormat, ScanEngineMode, ScanErrorCode } from '@/libs/types'

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

const STATUS_LABELS: Record<string, string> = {
  all: '全部',
  open: '待處理',
  fixed: '已修復',
  ignored: '已忽略',
}

const HUMAN_STATUS_LABELS: Record<string, string> = {
  all: '全部',
  pending: '待審核',
  confirmed: '已確認',
  rejected: '已駁回',
  false_positive: '誤報',
}

const EXPORT_FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'pdf', label: 'PDF（列印）' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'json', label: 'JSON' },
  { value: 'csv', label: 'CSV' },
]

const EXPORT_EXT: Record<ExportFormat, string> = {
  json: 'json',
  csv: 'csv',
  markdown: 'md',
  pdf: 'pdf',
}

interface ExportDialogState {
  status: 'all' | 'open' | 'fixed' | 'ignored'
  severity: 'all' | 'critical' | 'high' | 'medium' | 'low' | 'info'
  humanStatus: 'all' | 'pending' | 'confirmed' | 'rejected' | 'false_positive'
  filePath: string
  search: string
}

const DEFAULT_EXPORT_DIALOG_STATE: ExportDialogState = {
  status: 'all',
  severity: 'all',
  humanStatus: 'all',
  filePath: '',
  search: '',
}

function buildFallbackFilename(format: ExportFormat): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const hh = String(now.getHours()).padStart(2, '0')
  const min = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')
  return `confession-vulnerabilities-${yyyy}${mm}${dd}-${hh}${min}${ss}.${EXPORT_EXT[format]}`
}

function filenameFromDisposition(
  disposition: string | undefined,
  format: ExportFormat,
): string {
  const matched = disposition?.match(/filename="([^"]+)"/i)
  return matched?.[1] ?? buildFallbackFilename(format)
}

function isInVscodeWebview(): boolean {
  try {
    return window.parent !== window
  } catch {
    return false
  }
}

function getErrorDetail(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return null
}

function toExportFilters(state: ExportDialogState): ExportFilters {
  const filters: ExportFilters = {}
  if (state.status !== 'all') filters.status = state.status
  if (state.severity !== 'all') filters.severity = state.severity
  if (state.humanStatus !== 'all') filters.humanStatus = state.humanStatus

  const filePath = state.filePath.trim()
  if (filePath) filters.filePath = filePath

  const search = state.search.trim()
  if (search) filters.search = search

  return filters
}

function downloadBlob(data: unknown, filename: string): void {
  const blob = data instanceof window.Blob ? data : new window.Blob([String(data ?? '')])
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(url)
}

async function printHtmlReport(html: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = 'none'
    document.body.appendChild(iframe)

    let settled = false
    const cleanup = () => {
      setTimeout(() => {
        iframe.remove()
      }, 1_000)
    }

    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) {
        reject(error)
        return
      }
      resolve()
    }

    const tryPrint = () => {
      try {
        if (!iframe.contentWindow || typeof iframe.contentWindow.print !== 'function') {
          finish(new Error('目前環境不支援列印視窗'))
          return
        }
        iframe.contentWindow.focus()
        iframe.contentWindow.print()
        finish()
      } catch (err) {
        finish(err)
      }
    }

    iframe.onload = () => {
      setTimeout(() => {
        tryPrint()
      }, 200)
    }

    iframe.onerror = () => {
      finish(new Error('建立列印視窗失敗'))
    }

    const frameDoc = iframe.contentWindow?.document
    if (!frameDoc) {
      finish(new Error('無法寫入列印內容'))
      return
    }

    frameDoc.open()
    frameDoc.write(html)
    frameDoc.close()

    setTimeout(() => {
      if (!settled) tryPrint()
    }, 500)

    setTimeout(() => {
      if (!settled) finish(new Error('PDF 匯出初始化逾時'))
    }, 5_000)
  })
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
  onClick?: () => void
  actionHint?: string
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
  onClick,
  actionHint,
}) => {
  const clickable = typeof onClick === 'function'
  return (
    <div
      className={`group relative min-h-[140px] overflow-hidden rounded-xl border border-cyber-border bg-cyber-surface shadow-lg transition-[border-color,box-shadow] duration-75 hover:duration-300 animate-slide-in animate-on-load ${clickable ? 'cursor-pointer' : 'cursor-default'} ${hoverBorderColor} ${delay}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onClick?.()
              }
            }
          : undefined
      }
    >
      {/* 頂部漸層線 */}
      <div className="absolute top-0 left-0 w-full h-px bg-linear-to-r from-transparent via-cyber-primary/30 to-transparent" />

      <div className="h-full p-5 flex flex-col justify-between relative z-10">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-black tracking-[0.2em] uppercase text-cyber-textmuted block">
              {label}
            </span>
            {actionHint && (
              <span className="text-[9px] font-black uppercase tracking-[0.15em] text-cyber-textmuted/70">
                {actionHint}
              </span>
            )}
          </div>
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
            <RechartsTooltip
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

interface RecentScanAvailabilityViewModel {
  label: string
  className: string
}

function toRecentScanAvailabilityView(params: {
  status?: string
  isLoading: boolean
  isError: boolean
}): RecentScanAvailabilityViewModel {
  const { status, isLoading, isError } = params
  if (isLoading) {
    return {
      label: '可用性檢測中',
      className: 'border-cyber-primary/30 bg-cyber-primary/10 text-cyber-primary',
    }
  }

  if (isError || status === 'failed') {
    return {
      label: '最近掃描不可用',
      className: 'border-red-500/30 bg-red-500/10 text-red-400',
    }
  }

  if (status === 'completed' || status === 'running' || status === 'pending') {
    return {
      label: '最近掃描可用',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    }
  }

  return {
    label: '尚無掃描記錄',
    className: 'border-cyber-border bg-cyber-surface2/30 text-cyber-textmuted',
  }
}

function formatRecentTime(iso: string | undefined): string {
  if (!iso) return '尚無資料'
  return new Date(iso).toLocaleString('zh-TW', { hour12: false })
}

interface TechHelpContent {
  title: string
  description: string
  footnote?: string
}

const TECH_HELP_CONTENT = {
  engine: {
    title: '掃描引擎是什麼？',
    description:
      '掃描引擎代表本次漏洞分析採用的策略。智慧多代理引擎會多步驟交叉判斷，基準引擎則偏向穩定與快速。',
    footnote: '代號僅供技術追查：agentic_beta / baseline',
  },
  fallback: {
    title: '自動回退是什麼？',
    description:
      '若智慧多代理引擎在本次任務中失敗，系統會自動切到基準引擎，避免整次掃描直接中斷。',
    footnote: '目標是提升可用性，不代表漏洞已自動修復。',
  },
  errorCode: {
    title: '錯誤代碼如何看？',
    description: '錯誤代碼用於快速定位失敗類型，可搭配錯誤訊息與回退資訊判斷後續動作。',
  },
} satisfies Record<string, TechHelpContent>

function toEngineModeLabel(mode: ScanEngineMode): {
  display: string
  detail: string
  code: string
} {
  if (mode === 'agentic_beta') {
    return {
      display: '智慧多代理分析',
      detail: '規劃→技能→分析→審核，多步驟交叉判斷',
      code: 'agentic_beta',
    }
  }
  return {
    display: '基準分析引擎',
    detail: '單階段分析流程，偏向穩定與快速',
    code: 'baseline',
  }
}

function toFallbackLabel(params: {
  fallbackUsed: boolean
  fallbackFrom?: 'agentic_beta'
  fallbackTo?: 'baseline'
  fallbackReason?: string
}): {
  display: string
  detail: string
  tone: 'normal' | 'warning'
} {
  if (!params.fallbackUsed) {
    return {
      display: '未觸發',
      detail: '本次掃描未需要切換備援引擎',
      tone: 'normal',
    }
  }
  const from = toEngineModeLabel(params.fallbackFrom ?? 'agentic_beta')
  const to = toEngineModeLabel(params.fallbackTo ?? 'baseline')
  return {
    display: '已觸發',
    detail: `${from.display} → ${to.display}`,
    tone: 'warning',
  }
}

function toErrorCodeLabel(code: ScanErrorCode | null): string | null {
  if (!code) return null
  if (code === 'BETA_ENGINE_FAILED') return '多代理流程失敗（含回退後仍失敗）'
  if (code === 'LLM_ANALYSIS_FAILED') return '模型分析回應失敗'
  return '未知錯誤'
}

const TechInlineHelp: React.FC<{ content: TechHelpContent }> = ({ content }) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-cyber-border text-cyber-textmuted transition-colors hover:border-cyber-primary hover:text-cyber-primary"
          aria-label={`${content.title}說明`}
        >
          <CircleHelp className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="end"
        collisionPadding={12}
        className="w-[min(18rem,calc(100vw-2rem))] rounded-lg border-cyber-border bg-cyber-surface2 p-3 text-left text-[11px] leading-relaxed text-cyber-text"
      >
        <span className="block text-[10px] font-black uppercase tracking-wider text-cyber-primary">
          {content.title}
        </span>
        <span className="mt-1 block text-cyber-textmuted">{content.description}</span>
        {content.footnote && (
          <span className="mt-2 block font-mono text-cyber-textmuted">{content.footnote}</span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}

// === 儀表盤標題區塊 ===

interface DashboardHeaderProps {
  onOpenExport: () => void
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({ onOpenExport }) => {
  const [isScanMenuOpen, setIsScanMenuOpen] = useState(false)
  const { health, isLoading, isError } = useHealth()
  const healthStatus = health?.status
  const isOperable = !isError && healthStatus !== 'down'

  // 根據健康狀態決定顯示樣式
  const statusLabel = isLoading
    ? '檢測中…'
    : isOperable
      ? '正常運行'
      : '無法運行'
  const statusColor = isLoading || isOperable
    ? 'border-cyber-primary/30 bg-cyber-primary/10 text-cyber-primary'
    : 'border-red-500/30 bg-red-500/10 text-red-400'
  const dotColor = isLoading || isOperable
    ? 'bg-cyber-primary animate-pulse shadow-[0_0_5px_#58A6FF]'
    : 'bg-red-500 animate-pulse shadow-[0_0_5px_#F85149]'

  const handleScan = useCallback((scope: 'file' | 'workspace') => {
    postToExtension({ type: 'request_scan', data: { scope } })
    setIsScanMenuOpen(false)
  }, [])

  return (
    <header className="relative z-20 flex flex-col sm:flex-row sm:items-end justify-between gap-4 animate-fade-in animate-on-load">
      <div className="space-y-2">
        <Badge
          variant="outline"
          className={`gap-2 ${statusColor} text-[10px] font-black uppercase tracking-[0.2em]`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
          系統狀態：{statusLabel}
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
          onClick={onOpenExport}
          className="gap-2 border-cyber-border bg-cyber-surface text-cyber-text hover:border-cyber-primary/60 hover:text-white"
        >
          <Download className="size-4" />
          匯出報告
        </Button>
        <CyberDropdownMenu
          open={isScanMenuOpen}
          onOpenChange={setIsScanMenuOpen}
          trigger={
            <GlowButton size="sm" className="gap-2 text-[11px]">
              <Zap className="size-4" />
              執行掃描
              <ChevronDown className="size-3" />
            </GlowButton>
          }
          items={[
            {
              key: 'file',
              label: '掃描當前文件',
              onSelect: () => handleScan('file'),
              icon: <FileText className="mr-3 size-5 text-cyber-primary opacity-70" />,
              className: 'px-5 py-3.5',
            },
            {
              key: 'workspace',
              label: '掃描整個工作區',
              onSelect: () => handleScan('workspace'),
              icon: <FolderOpen className="mr-3 size-5 text-cyber-primary opacity-70" />,
              className: 'px-5 py-3.5',
            },
          ]}
          contentClassName="w-56"
        />
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

const RecentScanCard: React.FC = () => {
  const { data, isLoading, isError } = useRecentScanSummary()
  const [showTechDetail, setShowTechDetail] = useState(false)
  const availability = toRecentScanAvailabilityView({
    status: data?.status,
    isLoading,
    isError,
  })
  const inVscodeWebview = isInVscodeWebview()
  const engineMode = data ? toEngineModeLabel(data.engineMode) : null
  const fallbackInfo = data
    ? toFallbackLabel({
        fallbackUsed: data.fallbackUsed,
        fallbackFrom: data.fallbackFrom,
        fallbackTo: data.fallbackTo,
        fallbackReason: data.fallbackReason ?? undefined,
      })
    : null
  const errorCodeLabel = data ? toErrorCodeLabel(data.errorCode) : null

  const handleOpenVulnerabilityList = useCallback(() => {
    postToExtension({
      type: 'focus_sidebar_view',
      data: { view: 'vulnerabilities' },
    })
  }, [])

  return (
    <CyberCard
      title="最近掃描摘要"
      subtitle="Latest Scan Snapshot"
      className="lg:col-span-4"
      delay="delay-500"
    >
      <div className="space-y-4">
        <Badge
          variant="outline"
          className={`gap-2 text-[10px] font-black uppercase tracking-[0.2em] ${availability.className}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {availability.label}
        </Badge>

        {isLoading && <p className="text-xs text-cyber-textmuted">讀取最近掃描資訊中…</p>}
        {isError && !isLoading && (
          <p className="text-xs text-cyber-textmuted">目前無法讀取最近掃描資訊</p>
        )}

        {data && (
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between rounded border border-cyber-border/60 bg-cyber-bg/40 px-3 py-2">
              <span className="text-cyber-textmuted">最近更新</span>
              <span className="font-mono text-white">{formatRecentTime(data.updatedAt)}</span>
            </div>
            <div className="flex items-center justify-between rounded border border-cyber-border/60 bg-cyber-bg/40 px-3 py-2">
              <span className="text-cyber-textmuted">掃描進度</span>
              <span className="font-mono text-white">
                {data.scannedFiles}/{data.totalFiles}
              </span>
            </div>
            <div className="flex items-center justify-between rounded border border-cyber-border/60 bg-cyber-bg/40 px-3 py-2">
              <span className="text-cyber-textmuted">任務狀態</span>
              <span className="font-mono text-white">
                {data.status === 'failed' ? '不可用' : '可用'}
              </span>
            </div>

            <button
              type="button"
              aria-expanded={showTechDetail}
              className="w-full rounded-md border border-cyber-primary/40 bg-linear-to-r from-cyber-primary/10 to-cyber-bg/50 px-3 py-2 text-left transition-colors hover:border-cyber-primary hover:from-cyber-primary/15"
              onClick={() => setShowTechDetail((prev) => !prev)}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.15em] text-cyber-primary">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-cyber-primary/50 bg-cyber-primary/10">
                    <ChevronDown
                      className={`h-3 w-3 transition-transform ${showTechDetail ? 'rotate-180' : ''}`}
                    />
                  </span>
                  技術詳情
                </span>
                <span className="text-[10px] font-black uppercase tracking-[0.15em] text-cyber-textmuted">
                  {showTechDetail ? '點擊收合' : '點擊展開'}
                </span>
              </span>
            </button>

            {showTechDetail && (
              <div className="space-y-2 rounded border border-cyber-border/60 bg-cyber-bg/40 p-3 text-[11px]">
                <div className="flex items-start justify-between gap-3 rounded border border-cyber-border/50 bg-cyber-surface/40 px-3 py-2">
                  <div className="flex items-center gap-2 text-cyber-textmuted">
                    <span>掃描引擎</span>
                    <TechInlineHelp content={TECH_HELP_CONTENT.engine} />
                  </div>
                  {engineMode && (
                    <div className="text-right">
                      <div className="font-semibold text-white">{engineMode.display}</div>
                      <div className="mt-1 text-[10px] text-cyber-textmuted">{engineMode.detail}</div>
                      <div className="mt-1 font-mono text-[10px] text-cyber-textmuted/80">
                        代號：{engineMode.code}
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-start justify-between gap-3 rounded border border-cyber-border/50 bg-cyber-surface/40 px-3 py-2">
                  <div className="flex items-center gap-2 text-cyber-textmuted">
                    <span>自動回退</span>
                    <TechInlineHelp content={TECH_HELP_CONTENT.fallback} />
                  </div>
                  {fallbackInfo && (
                    <div className="text-right">
                      <div
                        className={`font-semibold ${fallbackInfo.tone === 'warning' ? 'text-amber-300' : 'text-white'}`}
                      >
                        {fallbackInfo.display}
                      </div>
                      <div className="mt-1 text-[10px] text-cyber-textmuted">{fallbackInfo.detail}</div>
                    </div>
                  )}
                </div>
                {errorCodeLabel && (
                  <div className="flex items-start justify-between gap-3 rounded border border-cyber-border/50 bg-cyber-surface/40 px-3 py-2">
                    <div className="flex items-center gap-2 text-cyber-textmuted">
                      <span>錯誤代碼</span>
                      <TechInlineHelp content={TECH_HELP_CONTENT.errorCode} />
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-[11px] text-white">{data.errorCode}</div>
                      <div className="mt-1 text-[10px] text-cyber-textmuted">{errorCodeLabel}</div>
                    </div>
                  </div>
                )}
                {data.fallbackUsed && data.fallbackReason && (
                  <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200">
                    {data.fallbackReason}
                  </div>
                )}
                {data.status === 'failed' && data.errorMessage && (
                  <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-300">
                    {data.errorMessage}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {inVscodeWebview ? (
          <button
            type="button"
            onClick={handleOpenVulnerabilityList}
            className="inline-flex items-center rounded border border-cyber-primary/50 bg-cyber-primary/10 px-3 py-2 text-[11px] font-black uppercase tracking-wider text-cyber-primary transition-colors hover:border-cyber-primary hover:bg-cyber-primary/20"
          >
            前往漏洞列表
          </button>
        ) : (
          <Link
            href="/vulnerabilities"
            className="inline-flex items-center rounded border border-cyber-primary/50 bg-cyber-primary/10 px-3 py-2 text-[11px] font-black uppercase tracking-wider text-cyber-primary transition-colors hover:border-cyber-primary hover:bg-cyber-primary/20"
          >
            前往漏洞列表
          </Link>
        )}
      </div>
    </CyberCard>
  )
}

interface HealthMetricHelpContent {
  formula: string
  meaning: string
  ideal: string
}

const HEALTH_METRIC_HELP: Record<string, HealthMetricHelpContent> = {
  exposure: {
    formula: 'S = 100 * exp(-ORB/K)，LEV = 1 - Π(1-p_i)',
    meaning: '衡量目前開放漏洞的整體暴露風險與至少一項被利用機率。',
    ideal: '越高越好；LEV 建議越低越好。',
  },
  remediation: {
    formula: 'S = 0.7*exp(-MTTR/72h) + 0.3*closureRate',
    meaning: '衡量修復速度（MTTR）與近期關閉率（closure rate）。',
    ideal: '建議 >= 70。',
  },
  quality: {
    formula: 'S = 0.65*efficiency + 0.35*coverage',
    meaning: '衡量審核後有效率（confirmed vs false_positive）與審核覆蓋度。',
    ideal: '建議 >= 75。',
  },
  reliability: {
    formula: 'S = 0.5*success + 0.2*(1-fallback) + 0.3*latency',
    meaning: '衡量掃描成功率、fallback 比率與延遲穩定度。',
    ideal: '建議 >= 80。',
  },
}

const HealthMetricHelp: React.FC<{ content: HealthMetricHelpContent }> = ({ content }) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-cyber-border text-cyber-textmuted transition-colors hover:border-cyber-primary hover:text-cyber-primary"
          aria-label="查看指標說明"
        >
          <CircleHelp className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="end"
        collisionPadding={12}
        className="w-[min(18rem,calc(100vw-2rem))] rounded-lg border-cyber-border bg-cyber-surface2 p-3 text-left text-[11px] leading-relaxed text-cyber-text"
      >
        <span className="block text-[10px] font-black uppercase tracking-wider text-cyber-primary">怎麼算</span>
        <span className="mt-1 block font-mono text-cyber-textmuted">{content.formula}</span>
        <span className="mt-2 block text-[10px] font-black uppercase tracking-wider text-cyber-primary">
          代表什麼
        </span>
        <span className="mt-1 block text-cyber-textmuted">{content.meaning}</span>
        <span className="mt-2 block text-[10px] font-black uppercase tracking-wider text-cyber-primary">
          理想區間
        </span>
        <span className="mt-1 block text-cyber-textmuted">{content.ideal}</span>
      </TooltipContent>
    </Tooltip>
  )
}

interface HealthDetailDrawerProps {
  open: boolean
  onClose: () => void
}

const HealthDetailDrawer: React.FC<HealthDetailDrawerProps> = ({ open, onClose }) => {
  const [windowMode, setWindowMode] = useState<'7d' | '30d'>('30d')
  const windowDays: 7 | 30 = windowMode === '7d' ? 7 : 30
  const { health, isLoading, isError } = useHealth(windowDays, open)

  if (!open) return null

  const components = health
    ? [
        {
          key: 'exposure',
          label: 'Exposure',
          value: health.score.components.exposure.value,
          detail: `ORB=${health.score.components.exposure.orb.toFixed(2)} / LEV=${(
            health.score.components.exposure.lev * 100
          ).toFixed(1)}%`,
        },
        {
          key: 'remediation',
          label: 'Remediation',
          value: health.score.components.remediation.value,
          detail: `MTTR=${health.score.components.remediation.mttrHours.toFixed(1)}h / closure=${(
            health.score.components.remediation.closureRate * 100
          ).toFixed(1)}%`,
        },
        {
          key: 'quality',
          label: 'Quality',
          value: health.score.components.quality.value,
          detail: `efficiency=${(health.score.components.quality.efficiency * 100).toFixed(1)}% / coverage=${(
            health.score.components.quality.coverage * 100
          ).toFixed(1)}%`,
        },
        {
          key: 'reliability',
          label: 'Reliability',
          value: health.score.components.reliability.value,
          detail: `success=${(health.score.components.reliability.successRate * 100).toFixed(1)}% / fallback=${(
            health.score.components.reliability.fallbackRate * 100
          ).toFixed(1)}% / p95=${Math.round(health.score.components.reliability.workspaceP95Ms)}ms`,
        },
      ] as const
    : []

  const lowest =
    components.length > 0
      ? components.reduce((acc, cur) => (cur.value < acc.value ? cur : acc), components[0])
      : null
  const actionSuggestion =
    !lowest
      ? '暫無足夠資料產生建議。'
      : lowest.key === 'exposure'
        ? '先處理 critical/high 且 open 的漏洞，優先降低 ORB 與 LEV。'
        : lowest.key === 'remediation'
          ? '優先縮短 MTTR：先處理已確認且可快速修復的 open 項目。'
          : lowest.key === 'quality'
            ? '提高審核覆蓋率與效率，優先完成 pending 審核。'
            : '優先改善掃描穩定度：降低 fallback 率並縮短 workspace P95。'

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/55 backdrop-blur-sm">
      <button className="h-full flex-1 cursor-default" aria-label="關閉健康抽屜遮罩" onClick={onClose} />
      <aside className="h-full w-full max-w-xl overflow-y-auto border-l border-cyber-border bg-cyber-surface p-6 shadow-2xl">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-black tracking-tight text-white">健康評分詳情</h2>
            {health ? (
              <p className="mt-1 text-xs text-cyber-textmuted">
                總分 {health.score.value.toFixed(1)} / Grade {health.score.grade}（更新：
                {new Date(health.evaluatedAt).toLocaleString('zh-TW', { hour12: false })}）
              </p>
            ) : (
              <p className="mt-1 text-xs text-cyber-textmuted">健康資料載入中…</p>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-cyber-border bg-cyber-bg text-cyber-text hover:border-cyber-primary/60 hover:text-white"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mb-4 inline-flex rounded-md border border-cyber-border bg-cyber-bg p-1">
          <button
            type="button"
            onClick={() => setWindowMode('7d')}
            className={`rounded px-3 py-1 text-xs font-black uppercase tracking-wider ${windowMode === '7d' ? 'bg-cyber-primary/20 text-cyber-primary' : 'text-cyber-textmuted'}`}
          >
            7D
          </button>
          <button
            type="button"
            onClick={() => setWindowMode('30d')}
            className={`rounded px-3 py-1 text-xs font-black uppercase tracking-wider ${windowMode === '30d' ? 'bg-cyber-primary/20 text-cyber-primary' : 'text-cyber-textmuted'}`}
          >
            30D
          </button>
        </div>

        <p className="mb-4 text-xs text-cyber-textmuted">
          {windowMode === '7d'
            ? '7D 視角：重點觀察 Reliability 與近期掃描成功率。'
            : '30D 視角：重點觀察 Exposure / Remediation / Quality 的趨勢。'}
        </p>

        {isError ? (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-300">
            無法載入健康評分資料，請稍後再試。
          </p>
        ) : isLoading || !health ? (
          <p className="rounded-lg border border-cyber-border bg-cyber-bg/40 px-4 py-3 text-xs text-cyber-textmuted">
            正在計算健康評分…
          </p>
        ) : (
          <div className="space-y-3">
            {components.map((item) => (
              <div
                key={item.key}
                className="rounded-lg border border-cyber-border bg-cyber-bg/40 px-4 py-3 transition-colors hover:border-cyber-primary/40"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-black uppercase tracking-[0.18em] text-cyber-textmuted">
                      {item.label}
                    </span>
                    <HealthMetricHelp content={HEALTH_METRIC_HELP[item.key]} />
                  </div>
                  <span className="font-mono text-xl font-black text-white">{item.value.toFixed(1)}</span>
                </div>
                <p className="mt-2 text-[11px] text-cyber-textmuted">{item.detail}</p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-300">優先行動建議</p>
          <p className="mt-2 text-xs text-amber-100">{actionSuggestion}</p>
        </div>
      </aside>
    </div>
  )
}

interface ExportDialogProps {
  open: boolean
  isExporting: boolean
  format: ExportFormat
  filters: ExportDialogState
  onClose: () => void
  onConfirm: () => void
  onFormatChange: (format: ExportFormat) => void
  onFiltersChange: (patch: Partial<ExportDialogState>) => void
}

const ExportDialog: React.FC<ExportDialogProps> = ({
  open,
  isExporting,
  format,
  filters,
  onClose,
  onConfirm,
  onFormatChange,
  onFiltersChange,
}) => {
  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="匯出報告設定"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-cyber-border bg-cyber-surface p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-black tracking-tight text-white">匯出報告</h2>
            <p className="mt-1 text-xs text-cyber-textmuted">
              先設定篩選條件，再選擇匯出格式。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="rounded border border-cyber-border p-1 text-cyber-textmuted transition-colors hover:border-cyber-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="關閉匯出設定"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-cyber-textmuted">
              匯出格式
            </label>
            <CyberSelect
              value={format}
              onValueChange={(value) => onFormatChange(value as ExportFormat)}
              options={EXPORT_FORMAT_OPTIONS}
              triggerClassName="text-xs text-cyber-text"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-cyber-textmuted">
              漏洞狀態
            </label>
            <CyberSelect
              value={filters.status}
              onValueChange={(value) =>
                onFiltersChange({
                  status: value as ExportDialogState['status'],
                })
              }
              options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              triggerClassName="text-xs text-cyber-text"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-cyber-textmuted">
              嚴重性
            </label>
            <CyberSelect
              value={filters.severity}
              onValueChange={(value) =>
                onFiltersChange({
                  severity: value as ExportDialogState['severity'],
                })
              }
              options={[
                { value: 'all', label: '全部' },
                { value: 'critical', label: '嚴重' },
                { value: 'high', label: '高' },
                { value: 'medium', label: '中' },
                { value: 'low', label: '低' },
                { value: 'info', label: '資訊' },
              ]}
              triggerClassName="text-xs text-cyber-text"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-cyber-textmuted">
              人工審核狀態
            </label>
            <CyberSelect
              value={filters.humanStatus}
              onValueChange={(value) =>
                onFiltersChange({
                  humanStatus: value as ExportDialogState['humanStatus'],
                })
              }
              options={Object.entries(HUMAN_STATUS_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
              triggerClassName="text-xs text-cyber-text"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-cyber-textmuted">
              檔案路徑包含
            </label>
            <Input
              value={filters.filePath}
              onChange={(e) => onFiltersChange({ filePath: e.target.value })}
              placeholder="例如: src/server/routes"
              className="border-cyber-border bg-cyber-bg text-sm text-cyber-text placeholder:text-cyber-textmuted"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-cyber-textmuted">
              關鍵字搜尋
            </label>
            <Input
              value={filters.search}
              onChange={(e) => onFiltersChange({ search: e.target.value })}
              placeholder="描述 / 類型 / CWE / 路徑"
              className="border-cyber-border bg-cyber-bg text-sm text-cyber-text placeholder:text-cyber-textmuted"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isExporting}
            className="border-cyber-border bg-cyber-bg text-cyber-text hover:border-cyber-primary/60 hover:text-white"
          >
            取消
          </Button>
          <GlowButton type="button" onClick={onConfirm} disabled={isExporting} className="gap-2">
            <Download className="h-4 w-4" />
            {isExporting ? '匯出中…' : '開始匯出'}
          </GlowButton>
        </div>
      </div>
    </div>
  )
}

// === 儀表盤主元件 ===

export const Dashboard: React.FC = () => {
  const { data: stats, isLoading, isError } = useVulnStats()
  const { health } = useHealth(30)
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isHealthDrawerOpen, setIsHealthDrawerOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf')
  const [exportDialogState, setExportDialogState] = useState<ExportDialogState>(
    DEFAULT_EXPORT_DIALOG_STATE,
  )
  const exportFilters = useMemo(
    () => toExportFilters(exportDialogState),
    [exportDialogState],
  )

  const handleOpenExportDialog = useCallback(() => {
    setIsExportDialogOpen(true)
  }, [])

  const handleCloseExportDialog = useCallback(() => {
    if (isExporting) return
    setIsExportDialogOpen(false)
  }, [isExporting])

  const handleExportFiltersChange = useCallback((patch: Partial<ExportDialogState>) => {
    setExportDialogState((prev) => ({ ...prev, ...patch }))
  }, [])

  const handleExportReport = useCallback(async () => {
    setIsExporting(true)
    const loadingToastId =
      exportFormat === 'pdf'
        ? toast.loading('正在準備 PDF 匯出，請稍候…')
        : undefined

    try {
      if (exportFormat === 'pdf') {
        if (isInVscodeWebview()) {
          // Webview 內固定由 Extension 開啟外部瀏覽器列印，不下載 HTML。
          const requestId = createRequestId('export-pdf')
          postToExtension({
            type: 'export_pdf',
            requestId,
            data: { filters: exportFilters, filename: buildFallbackFilename('pdf') },
          })
          if (loadingToastId !== undefined) {
            toast.success('已通知擴充套件開啟外部列印，請稍候…', { id: loadingToastId })
          } else {
            toast.success('已通知擴充套件開啟外部列印，請稍候…')
          }
          setIsExportDialogOpen(false)
          return
        }

        const response = await api.post(
          '/api/export',
          { format: 'pdf', filters: exportFilters },
          { responseType: 'text', timeout: 120_000 },
        )
        const html = String(response.data ?? '')
        await printHtmlReport(html)
        if (loadingToastId !== undefined) {
          toast.success('PDF 匯出流程已啟動', { id: loadingToastId })
        } else {
          toast.success('PDF 匯出流程已啟動')
        }

        setIsExportDialogOpen(false)
        return
      }

      const response = await api.post(
        '/api/export',
        { format: exportFormat, filters: exportFilters },
        { responseType: 'blob', timeout: 120_000 },
      )
      const disposition = response.headers['content-disposition'] as string | undefined
      const filename = filenameFromDisposition(disposition, exportFormat)
      downloadBlob(response.data, filename)
      toast.success(`已下載 ${filename}`)
      setIsExportDialogOpen(false)
    } catch (err) {
      const detail = getErrorDetail(err)
      const message =
        exportFormat === 'pdf'
          ? 'PDF 匯出失敗，請稍後再試'
          : '匯出失敗，請稍後再試'
      const description =
        (detail ? `更多資訊：${detail}` : null) ??
        (exportFormat === 'pdf'
          ? '更多資訊：可改用 Markdown 或 JSON 匯出。'
          : undefined)
      if (loadingToastId !== undefined) {
        toast.error(message, { id: loadingToastId, description })
      } else {
        toast.error(message, { description })
      }
    } finally {
      setIsExporting(false)
    }
  }, [exportFilters, exportFormat])

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

  // 健康評分：預設 fallback 為 fixRate 分級；若 /api/health 有資料則優先使用 v2
  const legacyHealthGrade =
    stats.total === 0
      ? 'A+'
      : stats.fixRate >= 0.8
        ? 'A'
        : stats.fixRate >= 0.6
          ? 'B+'
          : stats.fixRate >= 0.4
            ? 'B'
            : 'C'

  const healthGrade = health?.score.grade ?? legacyHealthGrade
  const healthScoreValue =
    health?.score.value !== undefined ? health.score.value.toFixed(1) : `${Math.round(stats.fixRate * 100)}`
  const healthTrend =
    health?.score.value !== undefined
      ? `${health.score.value.toFixed(1)} / 100`
      : `${Math.round(stats.fixRate * 100)}%`
  const healthSubtext =
    health?.score.value !== undefined
      ? `Exposure ${health.score.components.exposure.value.toFixed(1)}・Reliability ${health.score.components.reliability.value.toFixed(1)}`
      : `已修復 ${fixedCount}・已忽略 ${ignoredCount}`
  const healthTrendUp = (health?.score.value ?? stats.fixRate * 100) >= 60

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
      value: healthGrade,
      trend: healthTrend,
      trendUp: healthTrendUp,
      subtext: healthSubtext,
      barColor: 'bg-green-600',
      hoverBorderColor: 'hover:border-green-500 hover:shadow-green-500/20',
      delay: 'delay-400',
      onClick: () => setIsHealthDrawerOpen(true),
      actionHint: `SCORE ${healthScoreValue}`,
    },
  ]

  return (
    <TooltipProvider delayDuration={120}>
      <div className="space-y-8">
        {/* 標題區塊 */}
        <DashboardHeader onOpenExport={handleOpenExportDialog} />

        {/* 統計卡片 */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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

          <RecentScanCard />
        </div>

        <ExportDialog
          open={isExportDialogOpen}
          isExporting={isExporting}
          format={exportFormat}
          filters={exportDialogState}
          onClose={handleCloseExportDialog}
          onConfirm={() => void handleExportReport()}
          onFormatChange={setExportFormat}
          onFiltersChange={handleExportFiltersChange}
        />
        <HealthDetailDrawer
          open={isHealthDrawerOpen}
          onClose={() => setIsHealthDrawerOpen(false)}
        />
      </div>
    </TooltipProvider>
  )
}

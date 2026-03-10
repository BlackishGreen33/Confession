'use client';

import { m, useReducedMotion } from 'framer-motion';
import { useSetAtom } from 'jotai';
import {
  Activity,
  ChevronDown,
  CircleHelp,
  Clock3,
  Download,
  FileText,
  FolderOpen,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from 'recharts';
import { toast } from 'sonner';

import { CyberDropdownMenu } from '@/components/elements/cyber-dropdown-menu';
import { CyberSelect } from '@/components/elements/cyber-select';
import { GlowButton } from '@/components/glow-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAdviceLatest } from '@/hooks/use-advice';
import {
  createRequestId,
  postToExtension,
  sendFocusSidebarViewAndWait,
} from '@/hooks/use-extension-bridge';
import { useHealth } from '@/hooks/use-health';
import { useRecentScanSummary } from '@/hooks/use-scan';
import { useVulnStats, useVulnTrend } from '@/hooks/use-vulnerabilities';
import { api } from '@/libs/api-client';
import { vulnerabilityPresetAtom, vulnFiltersAtom } from '@/libs/atoms';
import {
  buildRiskPriorityLanes,
  buildSecuritySummary,
  type MetricHelpContent,
  PRESET_LABELS,
  presetToFilters,
  type RiskPriorityLane,
  type SecuritySummary,
  type SecuritySummaryAction,
} from '@/libs/dashboard-insights';
import type {
  AdviceLatestResponse,
  ExportFilters,
  ExportFormat,
  HealthGrade,
  ScanEngineMode,
  ScanErrorCode,
  VulnerabilityFilterPreset,
} from '@/libs/types';
import { getEngineModeLabel, toMoreInfo } from '@/libs/ui-messages';
import {
  getStaggerForCount,
  MOTION_DURATIONS,
  MOTION_EASING,
} from '@/motion/tokens';
import { fadeInUp, panelEnter, sectionContainer } from '@/motion/variants';

import { TrendChart } from '../trend-chart';

// === 嚴重等級配色 ===

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#F85149',
  high: '#D29922',
  medium: '#E3B341',
  low: '#58A6FF',
  info: '#8B949E',
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: '嚴重',
  high: '高',
  medium: '中',
  low: '低',
  info: '資訊',
};

const STATUS_LABELS: Record<string, string> = {
  all: '全部',
  open: '待處理',
  fixed: '已修復',
  ignored: '已忽略',
};

const HUMAN_STATUS_LABELS: Record<string, string> = {
  all: '全部',
  pending: '待審核',
  confirmed: '已確認',
  rejected: '已駁回',
  false_positive: '誤報',
};

const EXPORT_FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'pdf', label: 'PDF（列印）' },
  { value: 'sarif', label: 'SARIF 2.1.0' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'json', label: 'JSON' },
  { value: 'csv', label: 'CSV' },
];

const EXPORT_EXT: Record<ExportFormat, string> = {
  json: 'json',
  csv: 'csv',
  markdown: 'md',
  pdf: 'pdf',
  sarif: 'sarif.json',
};

interface ExportDialogState {
  status: 'all' | 'open' | 'fixed' | 'ignored';
  severity: 'all' | 'critical' | 'high' | 'medium' | 'low' | 'info';
  humanStatus: 'all' | 'pending' | 'confirmed' | 'rejected' | 'false_positive';
  filePath: string;
  search: string;
}

const DEFAULT_EXPORT_DIALOG_STATE: ExportDialogState = {
  status: 'all',
  severity: 'all',
  humanStatus: 'all',
  filePath: '',
  search: '',
};

function buildFallbackFilename(format: ExportFormat): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `confession-vulnerabilities-${yyyy}${mm}${dd}-${hh}${min}${ss}.${EXPORT_EXT[format]}`;
}

function filenameFromDisposition(
  disposition: string | undefined,
  format: ExportFormat
): string {
  const matched = disposition?.match(/filename="([^"]+)"/i);
  return matched?.[1] ?? buildFallbackFilename(format);
}

function isInVscodeWebview(): boolean {
  try {
    return window.parent !== window;
  } catch {
    return false;
  }
}

function getErrorDetail(error: unknown): string | null {
  if (error instanceof Error && error.message.trim())
    return error.message.trim();
  return null;
}

function toExportFilters(state: ExportDialogState): ExportFilters {
  const filters: ExportFilters = {};
  if (state.status !== 'all') filters.status = state.status;
  if (state.severity !== 'all') filters.severity = state.severity;
  if (state.humanStatus !== 'all') filters.humanStatus = state.humanStatus;

  const filePath = state.filePath.trim();
  if (filePath) filters.filePath = filePath;

  const search = state.search.trim();
  if (search) filters.search = search;

  return filters;
}

function downloadBlob(data: unknown, filename: string): void {
  const blob =
    data instanceof window.Blob ? data : new window.Blob([String(data ?? '')]);
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

async function printHtmlReport(html: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    let settled = false;
    const cleanup = () => {
      setTimeout(() => {
        iframe.remove();
      }, 1_000);
    };

    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };

    const tryPrint = () => {
      try {
        if (
          !iframe.contentWindow ||
          typeof iframe.contentWindow.print !== 'function'
        ) {
          finish(new Error('目前環境不支援列印視窗'));
          return;
        }
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
        finish();
      } catch (err) {
        finish(err);
      }
    };

    iframe.onload = () => {
      setTimeout(() => {
        tryPrint();
      }, 200);
    };

    iframe.onerror = () => {
      finish(new Error('建立列印視窗失敗'));
    };

    const frameDoc = iframe.contentWindow?.document;
    if (!frameDoc) {
      finish(new Error('無法寫入列印內容'));
      return;
    }

    frameDoc.open();
    frameDoc.write(html);
    frameDoc.close();

    setTimeout(() => {
      if (!settled) tryPrint();
    }, 500);

    setTimeout(() => {
      if (!settled) finish(new Error('PDF 匯出初始化逾時'));
    }, 5_000);
  });
}

// === Cyber 統計卡片 ===

interface CyberStatCardProps {
  label: string;
  value: string | number;
  valueSuffix?: string;
  trend: string;
  trendUp: boolean;
  subtext: React.ReactNode;
  barColor: string;
  hoverBorderColor: string;
  delay: string;
  onClick?: () => void;
  clickTarget?: 'card' | 'action';
  actionButtonLabel?: string;
  actionHint?: React.ReactNode;
  trendTone?: 'info' | 'warning' | 'danger' | 'success';
  valueHelp?: MetricHelpContent;
  orbToneClass?: string;
  showOrb?: boolean;
}

const CyberStatCard: React.FC<CyberStatCardProps> = ({
  label,
  value,
  valueSuffix,
  trend,
  trendUp,
  subtext,
  barColor,
  hoverBorderColor,
  delay,
  onClick,
  clickTarget = 'card',
  actionButtonLabel,
  actionHint,
  trendTone,
  valueHelp,
  orbToneClass,
  showOrb = true,
}) => {
  const cardClickable = typeof onClick === 'function' && clickTarget === 'card';
  const actionClickable =
    typeof onClick === 'function' && clickTarget === 'action';
  const trendToneClass =
    trendTone === 'info'
      ? 'bg-cyber-primary/10 text-cyber-primary border-cyber-primary/25'
      : trendTone === 'danger'
        ? 'bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/25'
        : trendTone === 'success'
          ? 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/25'
          : trendUp
            ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20'
            : 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20';

  return (
    <div
      className={`group border-cyber-border/40 glass-panel motion-safe:animate-slide-in animate-on-load relative min-h-[140px] overflow-hidden rounded-xl border shadow-lg transition-[transform,box-shadow,border-color,opacity] duration-300 hover:-translate-y-1 hover:shadow-[0_4px_20px_rgba(88,166,255,0.15)] ${cardClickable ? 'cursor-pointer' : 'cursor-default'} ${hoverBorderColor} ${delay}`}
      onClick={cardClickable ? onClick : undefined}
      role={cardClickable ? 'button' : undefined}
      tabIndex={cardClickable ? 0 : undefined}
      onKeyDown={
        cardClickable
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      {/* 卡片語彙：右上 1/4 半圓背景 */}
      {showOrb && (
        <>
          <div
            className={`pointer-events-none absolute -top-14 -right-14 h-36 w-36 rounded-full border opacity-80 ${
              orbToneClass ?? 'border-cyber-primary/25 bg-cyber-primary/12'
            }`}
          />
          <div
            className={`pointer-events-none absolute -top-20 -right-20 h-44 w-44 rounded-full border opacity-35 ${
              orbToneClass ?? 'border-cyber-primary/25 bg-cyber-primary/12'
            }`}
          />
        </>
      )}

      {/* 頂部漸層線與掃描線效果 */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden rounded-xl">
        <div className="via-cyber-primary/5 motion-safe:group-hover:animate-scanline h-12 w-full bg-linear-to-b from-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      </div>
      <div className="cyber-grid-bg pointer-events-none absolute inset-0 opacity-20 mix-blend-overlay" />
      <div className="via-cyber-primary/40 absolute top-0 left-0 h-px w-full bg-linear-to-r from-transparent to-transparent shadow-[0_0_8px_rgba(88,166,255,0.3)]" />

      <div className="relative z-10 flex h-full flex-col justify-between p-5">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-cyber-textmuted block text-xs font-black tracking-[0.12em] uppercase">
              {label}
            </span>
            {actionHint && (
              <span className="text-cyber-textmuted/70 text-xs font-black tracking-[0.1em] uppercase">
                {actionHint}
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-2">
            <div className="flex items-center gap-1">
              <div className="flex items-end gap-0.5">
                <span className="text-cyber-text motion-safe:group-hover:animate-glow-text font-mono text-3xl font-black tracking-tighter transition-[transform,box-shadow,border-color,opacity]">
                  {value}
                </span>
                {valueSuffix && (
                  <span className="text-cyber-textmuted/65 mb-0.5 font-mono text-lg font-bold tracking-tight">
                    {valueSuffix}
                  </span>
                )}
              </div>
              {valueHelp && <HealthMetricHelp content={valueHelp} />}
            </div>
            <div
              className={`rounded border px-2 py-0.5 text-xs font-black ${trendToneClass}`}
            >
              {trend}
            </div>
          </div>
        </div>
        <div className="from-cyber-border/85 via-cyber-border/45 mt-3 h-px w-full bg-linear-to-r to-transparent" />
        {actionClickable && actionButtonLabel ? (
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="text-cyber-textmuted min-w-0 text-xs font-bold tracking-tight opacity-70">
              {subtext}
            </div>
            <button
              type="button"
              onClick={onClick}
              className="border-cyber-primary/50 bg-cyber-primary/10 text-cyber-primary hover:border-cyber-primary hover:bg-cyber-primary/20 inline-flex shrink-0 items-center rounded border px-2 py-1 text-xs font-black tracking-wider transition-colors"
            >
              {actionButtonLabel}
            </button>
          </div>
        ) : (
          <div className="text-cyber-textmuted mt-4 text-xs font-bold tracking-tight opacity-70">
            {subtext}
          </div>
        )}
      </div>

      {/* 底部動畫彩色條 */}
      <div
        className={`absolute bottom-0 left-0 h-[2px] ${barColor} w-full origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100`}
      />
    </div>
  );
};

// === Cyber 甜甜圈圓餅圖 ===

const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor:
      'color-mix(in srgb, var(--cyber-surface) 92%, transparent)',
    backdropFilter: 'blur(10px)',
    borderRadius: '8px',
    border: '1px solid var(--cyber-border)',
    padding: '10px',
  },
  itemStyle: {
    color: 'var(--cyber-text)',
    fontSize: '11px',
    fontWeight: 'bold' as const,
  },
  labelStyle: {
    color: 'var(--cyber-textmuted)',
    fontSize: '10px',
    marginBottom: '4px',
    textTransform: 'uppercase' as const,
    fontWeight: '900' as const,
  },
};

const SeverityChart: React.FC<{
  bySeverity: Record<string, number>;
  total: number;
}> = ({ bySeverity, total }) => {
  const reduceMotion = useReducedMotion();
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const data = Object.entries(bySeverity)
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => ({
      name: SEVERITY_LABELS[severity] ?? severity,
      value: count,
      severity,
      color: SEVERITY_COLORS[severity] ?? '#8B949E',
    }));
  const dominantIndex = useMemo(
    () =>
      data.reduce(
        (bestIndex, item, index, arr) =>
          item.value > (arr[bestIndex]?.value ?? Number.NEGATIVE_INFINITY)
            ? index
            : bestIndex,
        0
      ),
    [data]
  );
  const focusIndex = activeIndex ?? dominantIndex;
  const focusSlice = data[focusIndex];
  const isSliceFocused = activeIndex !== null;

  if (data.length === 0) {
    return (
      <div className="text-cyber-textmuted flex h-[240px] items-center justify-center text-sm">
        尚無漏洞資料
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* 甜甜圈圖 + 中心數值 */}
      <m.div
        className="relative h-[240px]"
        initial={reduceMotion ? false : { opacity: 0, y: 8, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        whileHover={reduceMotion ? undefined : { y: -2, scale: 1.012 }}
        transition={{
          duration: MOTION_DURATIONS.slow,
          ease: MOTION_EASING.enter,
          delay: 0.06,
        }}
      >
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
              activeIndex={focusIndex}
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
              isAnimationActive={!reduceMotion}
              animationDuration={920}
              animationBegin={80}
              animationEasing="ease-out"
            >
              {data.map((entry, index) => {
                const dimmed = focusIndex !== index;
                return (
                  <Cell
                    key={entry.severity}
                    fill={entry.color}
                    fillOpacity={dimmed ? 0.34 : 1}
                    stroke="var(--cyber-bg)"
                    strokeWidth={dimmed ? 0.8 : 2.6}
                    style={{
                      transition: reduceMotion
                        ? 'none'
                        : 'opacity var(--motion-fast) ease, stroke-width var(--motion-fast) ease, fill-opacity var(--motion-fast) ease',
                    }}
                  />
                );
              })}
            </Pie>
            <RechartsTooltip
              contentStyle={CHART_TOOLTIP_STYLE.contentStyle}
              itemStyle={CHART_TOOLTIP_STYLE.itemStyle}
              labelStyle={CHART_TOOLTIP_STYLE.labelStyle}
            />
          </PieChart>
        </ResponsiveContainer>
        <m.div
          className="border-cyber-primary/35 pointer-events-none absolute top-1/2 left-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border"
          initial={false}
          animate={
            reduceMotion
              ? { opacity: 0.22, scale: 1 }
              : {
                  opacity: isSliceFocused ? 0.52 : 0.22,
                  scale: isSliceFocused ? 1.08 : 1,
                }
          }
          transition={{
            duration: MOTION_DURATIONS.fast,
            ease: MOTION_EASING.enter,
          }}
        />
        <div className="group pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span
            className={`text-cyber-text font-mono text-4xl font-black tracking-tighter drop-shadow-[0_0_12px_rgba(88,166,255,0.4)] transition-[transform,box-shadow,border-color,opacity] duration-200 ${
              isSliceFocused ? 'scale-[1.08]' : ''
            }`}
          >
            {total}
          </span>
          <span className="text-cyber-textmuted mt-1 text-xs font-black tracking-[0.12em] uppercase">
            待處理池
          </span>
          {focusSlice && (
            <span className="text-cyber-textmuted mt-1 text-[11px] font-bold">
              焦點：{focusSlice.name} {focusSlice.value}
            </span>
          )}
        </div>
      </m.div>
    </div>
  );
};

interface RecentScanAvailabilityViewModel {
  label: string;
  className: string;
}

function toRecentScanAvailabilityView(params: {
  status?: string;
  isLoading: boolean;
  isError: boolean;
}): RecentScanAvailabilityViewModel {
  const { status, isLoading, isError } = params;
  if (isLoading) {
    return {
      label: '可用性檢測中',
      className:
        'border-cyber-primary/30 bg-cyber-primary/10 text-cyber-primary',
    };
  }

  if (isError || status === 'failed') {
    return {
      label: '最近掃描不可用',
      className: 'border-red-500/30 bg-red-500/10 text-red-400',
    };
  }

  if (status === 'completed' || status === 'running' || status === 'pending') {
    return {
      label: '最近掃描可用',
      className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    };
  }

  return {
    label: '尚無掃描記錄',
    className: 'border-cyber-border bg-cyber-surface2/30 text-cyber-textmuted',
  };
}

function formatRecentTime(iso: string | undefined): string {
  if (!iso) return '尚無資料';
  return new Date(iso).toLocaleString('zh-TW', { hour12: false });
}

function formatTimeOnly(iso: string | undefined): string {
  if (!iso) return '未更新';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.slice(5).replace('-', '/');
  return new Date(iso).toLocaleTimeString('zh-TW', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface TechHelpContent {
  title: string;
  description: string;
  footnote?: string;
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
    description:
      '錯誤代碼用於快速定位失敗類型，可搭配錯誤訊息與回退資訊判斷後續動作。',
  },
} satisfies Record<string, TechHelpContent>;

function toEngineModeLabel(mode: ScanEngineMode): {
  display: string;
  detail: string;
  code: string;
} {
  if (mode === 'agentic_beta') {
    return {
      display: getEngineModeLabel(mode),
      detail: '規劃→技能→分析→審核，多步驟交叉判斷',
      code: 'agentic_beta',
    };
  }
  return {
    display: getEngineModeLabel(mode),
    detail: '單階段分析流程，偏向穩定與快速',
    code: 'baseline',
  };
}

function toFallbackLabel(params: {
  fallbackUsed: boolean;
  fallbackFrom?: 'agentic_beta';
  fallbackTo?: 'baseline';
  fallbackReason?: string;
}): {
  display: string;
  detail: string;
  tone: 'normal' | 'warning';
} {
  if (!params.fallbackUsed) {
    return {
      display: '未觸發',
      detail: '本次掃描未需要切換備援引擎',
      tone: 'normal',
    };
  }
  const from = toEngineModeLabel(params.fallbackFrom ?? 'agentic_beta');
  const to = toEngineModeLabel(params.fallbackTo ?? 'baseline');
  return {
    display: '已觸發',
    detail: `${from.display} → ${to.display}`,
    tone: 'warning',
  };
}

function toErrorCodeLabel(code: ScanErrorCode | null): string | null {
  if (!code) return null;
  if (code === 'BETA_ENGINE_FAILED') return '多代理流程失敗（含回退後仍失敗）';
  if (code === 'LLM_ANALYSIS_FAILED') return '模型分析回應失敗';
  return '未知錯誤';
}

function toGradeView(grade: HealthGrade): {
  label: string;
  tone: 'info' | 'warning' | 'danger' | 'success';
} {
  if (grade === 'A+' || grade === 'A')
    return { label: `${grade} 級`, tone: 'success' };
  if (grade === 'B+' || grade === 'B')
    return { label: `${grade} 級`, tone: 'info' };
  if (grade === 'C') return { label: 'C 級', tone: 'warning' };
  return { label: 'D 級', tone: 'danger' };
}

const TechInlineHelp: React.FC<{ content: TechHelpContent }> = ({
  content,
}) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="border-cyber-border text-cyber-textmuted hover:border-cyber-primary hover:text-cyber-primary inline-flex h-4 w-4 items-center justify-center rounded-full border transition-colors"
          aria-label={`${content.title}說明`}
        >
          <CircleHelp className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        collisionPadding={12}
        className="border-cyber-border bg-cyber-surface2 text-cyber-text w-[min(18rem,calc(100vw-2rem))] rounded-lg p-3 text-left text-xs leading-relaxed"
      >
        <span className="text-cyber-primary block text-xs font-black tracking-wider uppercase">
          {content.title}
        </span>
        <span className="text-cyber-textmuted mt-1 block">
          {content.description}
        </span>
        {content.footnote && (
          <span className="text-cyber-textmuted mt-2 block font-mono">
            {content.footnote}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
};

// === 儀表盤標題區塊 ===

interface DashboardHeaderProps {
  onOpenExport: () => void;
}

const DashboardHeader: React.FC<DashboardHeaderProps> = ({ onOpenExport }) => {
  const [isScanMenuOpen, setIsScanMenuOpen] = useState(false);
  const { health, isLoading, isError } = useHealth();
  const healthStatus = health?.status;
  const isOperable = !isError && healthStatus !== 'down';

  // 根據健康狀態決定顯示樣式
  const statusLabel = isLoading
    ? '檢測中…'
    : isOperable
      ? '正常運行'
      : '無法運行';
  const statusColor =
    isLoading || isOperable
      ? 'border-cyber-primary/30 bg-cyber-primary/10 text-cyber-primary'
      : 'border-red-500/30 bg-red-500/10 text-red-400';
  const dotColor =
    isLoading || isOperable
      ? 'bg-cyber-primary animate-pulse shadow-[0_0_5px_#58A6FF]'
      : 'bg-red-500 animate-pulse shadow-[0_0_5px_#F85149]';

  const handleScan = useCallback((scope: 'file' | 'workspace') => {
    postToExtension({ type: 'request_scan', data: { scope } });
    setIsScanMenuOpen(false);
  }, []);

  return (
    <header className="animate-on-load motion-safe:animate-slide-in relative z-20 mb-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div className="flex flex-col items-start gap-2">
        <Badge
          variant="outline"
          className={`gap-2 whitespace-nowrap ${statusColor} text-xs font-black tracking-[0.12em] uppercase drop-shadow-[0_0_8px_rgba(88,166,255,0.1)]`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
          系統狀態：{statusLabel}
        </Badge>
        <h1 className="group text-cyber-text relative inline-flex cursor-default flex-nowrap items-end gap-2 text-[clamp(1.25rem,4.2vw,2rem)] leading-none font-black tracking-tighter whitespace-nowrap sm:text-3xl">
          <span className="whitespace-nowrap">安全態勢核心</span>
          <span className="text-cyber-primary/70 relative font-mono text-[clamp(0.85rem,2.4vw,1rem)] tracking-[0.12em] whitespace-nowrap uppercase">
            Dashboard
            <span className="bg-cyber-primary/50 group-hover:bg-cyber-primary absolute -bottom-1 left-0 h-px w-full transition-[transform,box-shadow,border-color,opacity] duration-300 group-hover:shadow-[0_0_12px_rgba(88,166,255,0.8)]"></span>
          </span>
        </h1>
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenExport}
          className="border-cyber-border bg-cyber-surface text-cyber-text hover:border-cyber-primary/60 hover:text-cyber-text gap-2"
        >
          <Download className="size-4" />
          匯出報告
        </Button>
        <CyberDropdownMenu
          open={isScanMenuOpen}
          onOpenChange={setIsScanMenuOpen}
          trigger={
            <GlowButton size="sm" className="gap-2 text-xs">
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
              icon: (
                <FileText className="text-cyber-primary mr-3 size-5 opacity-70" />
              ),
              className: 'px-5 py-3.5',
            },
            {
              key: 'workspace',
              label: '掃描整個工作區',
              onSelect: () => handleScan('workspace'),
              icon: (
                <FolderOpen className="text-cyber-primary mr-3 size-5 opacity-70" />
              ),
              className: 'px-5 py-3.5',
            },
          ]}
          contentClassName="w-56"
        />
      </div>
    </header>
  );
};

// === Cyber 風格卡片容器 ===

interface CyberCardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  delay?: string;
}

const CyberCard: React.FC<CyberCardProps> = ({
  title,
  subtitle,
  children,
  className,
  delay,
}) => {
  return (
    <div
      className={`group border-cyber-border/40 glass-panel hover:border-cyber-primary/50 animate-on-load motion-safe:animate-slide-up relative overflow-hidden rounded-xl border shadow-lg transition-[transform,box-shadow,border-color,opacity] duration-300 hover:-translate-y-0.5 hover:shadow-[0_4px_30px_rgba(88,166,255,0.12)] ${delay ?? ''} ${className ?? ''}`}
    >
      <div className="from-cyber-primary/10 pointer-events-none absolute inset-0 bg-linear-to-b to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-10" />
      <div className="cyber-grid-bg pointer-events-none absolute inset-0 opacity-[0.05] mix-blend-overlay" />
      <div className="via-cyber-primary/50 absolute top-0 left-0 h-px w-full bg-linear-to-r from-transparent to-transparent" />
      <div className="relative z-10 p-4 pb-2">
        <h2 className="text-cyber-text flex items-center gap-2 text-base font-bold tracking-tight">
          <span className="bg-cyber-primary h-4 w-1 rounded-full shadow-[0_0_10px_rgba(88,166,255,0.8)]" />
          {title}
        </h2>
        {subtitle && (
          <p className="text-cyber-textmuted mt-1 ml-3 text-xs font-black tracking-[0.08em] uppercase opacity-50">
            {subtitle}
          </p>
        )}
      </div>
      <div className="p-4 pt-0">{children}</div>
    </div>
  );
};

const RecentScanCard: React.FC = () => {
  const { data, isLoading, isError } = useRecentScanSummary();
  const [showTechDetail, setShowTechDetail] = useState(false);
  const availability = toRecentScanAvailabilityView({
    status: data?.status,
    isLoading,
    isError,
  });
  const inVscodeWebview = isInVscodeWebview();
  const engineMode = data ? toEngineModeLabel(data.engineMode) : null;
  const fallbackInfo = data
    ? toFallbackLabel({
        fallbackUsed: data.fallbackUsed,
        fallbackFrom: data.fallbackFrom,
        fallbackTo: data.fallbackTo,
        fallbackReason: data.fallbackReason ?? undefined,
      })
    : null;
  const errorCodeLabel = data ? toErrorCodeLabel(data.errorCode) : null;

  const handleOpenVulnerabilityList = useCallback(() => {
    const toastId = toast.loading('正在切換到漏洞列表…');
    void sendFocusSidebarViewAndWait('vulnerabilities', undefined, 8_000)
      .then((result) => {
        if (result.success) {
          toast.success('已切換到漏洞列表', { id: toastId });
          return;
        }
        toast.error('切換漏洞列表失敗，請手動展開漏洞列表面板', {
          id: toastId,
          description: toMoreInfo(result.message || 'Extension 未回覆成功結果'),
        });
      })
      .catch((error) => {
        const detail = getErrorDetail(error) ?? '導航回執逾時';
        toast.error('切換漏洞列表失敗，請手動展開漏洞列表面板', {
          id: toastId,
          description: toMoreInfo(detail),
        });
      });
  }, []);

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
          className={`gap-2 text-xs font-black tracking-[0.12em] uppercase ${availability.className}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {availability.label}
        </Badge>

        {isLoading && (
          <p className="text-cyber-textmuted text-xs">讀取最近掃描資訊中…</p>
        )}
        {isError && !isLoading && (
          <p className="text-cyber-textmuted text-xs">
            目前無法讀取最近掃描資訊
          </p>
        )}

        {data && (
          <div className="space-y-2 text-xs">
            <div className="border-cyber-border/60 bg-cyber-bg/40 flex items-center justify-between rounded border px-3 py-2">
              <span className="text-cyber-textmuted">最近更新</span>
              <span className="text-cyber-text font-mono">
                {formatRecentTime(data.updatedAt)}
              </span>
            </div>
            <div className="border-cyber-border/60 bg-cyber-bg/40 flex items-center justify-between rounded border px-3 py-2">
              <span className="text-cyber-textmuted">掃描進度</span>
              <span className="text-cyber-text font-mono">
                {data.scannedFiles}/{data.totalFiles}
              </span>
            </div>
            <div className="border-cyber-border/60 bg-cyber-bg/40 flex items-center justify-between rounded border px-3 py-2">
              <span className="text-cyber-textmuted">任務狀態</span>
              <span
                className={`font-mono ${
                  data.status === 'failed'
                    ? 'text-red-700 dark:text-red-300'
                    : 'text-emerald-700 dark:text-emerald-300'
                }`}
              >
                {data.status === 'failed' ? '不可用' : '可用'}
              </span>
            </div>

            <button
              type="button"
              aria-expanded={showTechDetail}
              className="border-cyber-primary/40 from-cyber-primary/10 to-cyber-bg/50 hover:border-cyber-primary hover:from-cyber-primary/15 w-full rounded-md border bg-linear-to-r px-3 py-2 text-left transition-colors"
              onClick={() => setShowTechDetail((prev) => !prev)}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-cyber-primary flex items-center gap-2 text-xs font-black tracking-[0.1em] uppercase">
                  <span className="border-cyber-primary/50 bg-cyber-primary/10 inline-flex h-4 w-4 items-center justify-center rounded border">
                    <ChevronDown
                      className={`h-3 w-3 transition-transform ${showTechDetail ? 'rotate-180' : ''}`}
                    />
                  </span>
                  技術詳情
                </span>
                <span className="text-cyber-textmuted text-xs font-black tracking-[0.1em] uppercase">
                  {showTechDetail ? '點擊收合' : '點擊展開'}
                </span>
              </span>
            </button>

            {showTechDetail && (
              <div className="border-cyber-border/60 bg-cyber-bg/40 space-y-2 rounded border p-3 text-xs">
                <div className="border-cyber-border/50 bg-cyber-surface/40 flex items-start justify-between gap-3 rounded border px-3 py-2">
                  <div className="text-cyber-textmuted flex items-center gap-2">
                    <span>掃描引擎</span>
                    <TechInlineHelp content={TECH_HELP_CONTENT.engine} />
                  </div>
                  {engineMode && (
                    <div className="text-right">
                      <div className="text-cyber-text font-semibold">
                        {engineMode.display}
                      </div>
                      <div className="text-cyber-textmuted mt-1 text-xs">
                        {engineMode.detail}
                      </div>
                      <div className="text-cyber-textmuted/80 mt-1 font-mono text-xs">
                        代號：{engineMode.code}
                      </div>
                    </div>
                  )}
                </div>
                <div className="border-cyber-border/50 bg-cyber-surface/40 flex items-start justify-between gap-3 rounded border px-3 py-2">
                  <div className="text-cyber-textmuted flex items-center gap-2">
                    <span>自動回退</span>
                    <TechInlineHelp content={TECH_HELP_CONTENT.fallback} />
                  </div>
                  {fallbackInfo && (
                    <div className="text-right">
                      <div
                        className={`font-semibold ${fallbackInfo.tone === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-cyber-text'}`}
                      >
                        {fallbackInfo.display}
                      </div>
                      <div className="text-cyber-textmuted mt-1 text-xs">
                        {fallbackInfo.detail}
                      </div>
                    </div>
                  )}
                </div>
                {errorCodeLabel && (
                  <div className="border-cyber-border/50 bg-cyber-surface/40 flex items-start justify-between gap-3 rounded border px-3 py-2">
                    <div className="text-cyber-textmuted flex items-center gap-2">
                      <span>錯誤代碼</span>
                      <TechInlineHelp content={TECH_HELP_CONTENT.errorCode} />
                    </div>
                    <div className="text-right">
                      <div className="text-cyber-text font-mono text-xs">
                        {data.errorCode}
                      </div>
                      <div className="text-cyber-textmuted mt-1 text-xs">
                        {errorCodeLabel}
                      </div>
                    </div>
                  </div>
                )}
                {data.fallbackUsed && data.fallbackReason && (
                  <div className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-200">
                    {data.fallbackReason}
                  </div>
                )}
                {data.status === 'failed' && data.errorMessage && (
                  <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-red-700 dark:text-red-300">
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
            className="border-cyber-primary/50 bg-cyber-primary/10 text-cyber-primary hover:border-cyber-primary hover:bg-cyber-primary/20 inline-flex items-center rounded border px-3 py-2 text-xs font-black tracking-wider uppercase transition-colors"
          >
            前往漏洞列表
          </button>
        ) : (
          <Link
            href="/vulnerabilities"
            className="border-cyber-primary/50 bg-cyber-primary/10 text-cyber-primary hover:border-cyber-primary hover:bg-cyber-primary/20 inline-flex items-center rounded border px-3 py-2 text-xs font-black tracking-wider uppercase transition-colors"
          >
            前往漏洞列表
          </Link>
        )}
      </div>
    </CyberCard>
  );
};

const HEALTH_METRIC_HELP: Record<string, MetricHelpContent> = {
  score: {
    formula: 'HealthScore = 100 * Π(S_k/100)^w_k',
    meaning:
      '總分採 0~100 百分制，綜合 Exposure/Remediation/Quality/Reliability 四面向。',
    ideal: '建議 >= 80；低於 60 代表需優先改善核心維度。',
  },
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
};

const DASHBOARD_STAT_HELP = {
  fixedRate: {
    formula: 'fixedRate = fixed / total',
    meaning: '代表目前已處理漏洞的比例，越高代表清理進度越快。',
    ideal: '建議持續提升，並避免待處理長期累積。',
  },
  openRate: {
    formula: 'openRate = open / total',
    meaning: '代表目前仍待處理的壓力，比例越高風險暴露越大。',
    ideal: '建議維持在低水位，並優先處理高風險項目。',
  },
  reviewFlow: {
    formula: 'review = confirmed + pending + rejected + false_positive',
    meaning: '反映人工審核流量，已確認越多可推進修復，待審核越多代表決策堆積。',
    ideal: '待審核不宜長期偏高，應維持可消化節奏。',
  },
  criticalMix: {
    formula: '高風險組合 = 嚴重級 + 高風險級',
    meaning: '高風險組合比例越高，越需要先投入修復資源。',
    ideal: '嚴重級建議優先清零，再逐步壓低高風險級。',
  },
} as const;

const ALLOCATION_HELP: MetricHelpContent = {
  formula: '投入分數 = 嚴重級*5 + 高風險級*3 + 中風險*1.5 +（低風險/資訊）*0.7',
  meaning: '依嚴重度係數估算修復投入比例，協助先處理高影響項目。',
  ideal: '嚴重級優先清零，再逐步壓低高風險級，最後批次清理中低風險。',
};

const HealthMetricHelp: React.FC<{ content: MetricHelpContent }> = ({
  content,
}) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="border-cyber-border text-cyber-textmuted hover:border-cyber-primary hover:text-cyber-primary inline-flex h-4 w-4 items-center justify-center rounded-full border transition-colors"
          aria-label="查看指標說明"
        >
          <CircleHelp className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        collisionPadding={12}
        className="border-cyber-border bg-cyber-surface2 text-cyber-text w-[min(18rem,calc(100vw-2rem))] rounded-lg p-3 text-left text-xs leading-relaxed"
      >
        <span className="text-cyber-primary block text-xs font-black tracking-wider uppercase">
          怎麼算
        </span>
        <span className="text-cyber-textmuted mt-1 block font-mono">
          {content.formula}
        </span>
        <span className="text-cyber-primary mt-2 block text-xs font-black tracking-wider uppercase">
          代表什麼
        </span>
        <span className="text-cyber-textmuted mt-1 block">
          {content.meaning}
        </span>
        <span className="text-cyber-primary mt-2 block text-xs font-black tracking-wider uppercase">
          理想區間
        </span>
        <span className="text-cyber-textmuted mt-1 block">{content.ideal}</span>
      </TooltipContent>
    </Tooltip>
  );
};

const summaryToneBadgeClass: Record<SecuritySummary['tone'], string> = {
  safe: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  warning:
    'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-200',
  danger:
    'border-amber-400/55 bg-linear-to-r from-amber-400/20 to-cyber-primary/10 text-amber-800 dark:text-amber-100 shadow-[0_0_0_1px_rgba(227,179,65,0.18)]',
};

const summaryTonePanelClass: Record<SecuritySummary['tone'], string> = {
  safe: 'border-emerald-500/30 bg-emerald-500/8',
  warning: 'border-amber-500/30 bg-amber-500/8',
  danger: 'border-cyber-primary/40 bg-cyber-primary/8',
};

const summaryToneProgressClass: Record<SecuritySummary['tone'], string> = {
  safe: 'bg-linear-to-r from-emerald-400 to-cyber-primary',
  warning: 'bg-linear-to-r from-amber-400 to-cyber-primary',
  danger: 'bg-linear-to-r from-amber-300 via-cyber-primary to-sky-400',
};

const summaryDangerStepFocusClass =
  'border-amber-400/55 bg-linear-to-r from-amber-400/20 to-cyber-primary/10 text-amber-800 dark:text-amber-100 shadow-[0_0_0_1px_rgba(227,179,65,0.18)]';

const summaryToneAuroraLayerOneStyle: Record<
  SecuritySummary['tone'],
  React.CSSProperties
> = {
  safe: {
    background:
      'conic-gradient(from 120deg at 50% 50%, rgba(88,166,255,0.55), rgba(46,160,67,0.42), rgba(88,166,255,0.2), rgba(88,166,255,0.55))',
  },
  warning: {
    background:
      'conic-gradient(from 120deg at 50% 50%, rgba(88,166,255,0.52), rgba(227,179,65,0.42), rgba(88,166,255,0.2), rgba(88,166,255,0.52))',
  },
  danger: {
    background:
      'conic-gradient(from 115deg at 50% 50%, rgba(88,166,255,0.55), rgba(227,179,65,0.42), rgba(129,140,248,0.22), rgba(88,166,255,0.55))',
  },
};

const summaryToneAuroraLayerTwoStyle: Record<
  SecuritySummary['tone'],
  React.CSSProperties
> = {
  safe: {
    background:
      'radial-gradient(ellipse at 52% 48%, rgba(88,166,255,0.44) 0%, rgba(46,160,67,0.26) 38%, rgba(88,166,255,0.06) 62%, rgba(88,166,255,0) 82%)',
  },
  warning: {
    background:
      'radial-gradient(ellipse at 52% 48%, rgba(88,166,255,0.42) 0%, rgba(227,179,65,0.28) 38%, rgba(88,166,255,0.06) 62%, rgba(88,166,255,0) 82%)',
  },
  danger: {
    background:
      'radial-gradient(ellipse at 52% 48%, rgba(88,166,255,0.42) 0%, rgba(227,179,65,0.28) 38%, rgba(129,140,248,0.08) 62%, rgba(88,166,255,0) 82%)',
  },
};

const summaryToneAuroraLayerThreeStyle: Record<
  SecuritySummary['tone'],
  React.CSSProperties
> = {
  safe: {
    background:
      'linear-gradient(100deg, rgba(88,166,255,0) 0%, rgba(88,166,255,0.24) 28%, rgba(46,160,67,0.32) 55%, rgba(88,166,255,0) 100%)',
  },
  warning: {
    background:
      'linear-gradient(100deg, rgba(88,166,255,0) 0%, rgba(88,166,255,0.22) 28%, rgba(210,153,34,0.34) 55%, rgba(88,166,255,0) 100%)',
  },
  danger: {
    background:
      'linear-gradient(100deg, rgba(88,166,255,0) 0%, rgba(88,166,255,0.22) 26%, rgba(227,179,65,0.36) 55%, rgba(88,166,255,0) 100%)',
  },
};

const SUMMARY_MISSION_STEPS: Array<{
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'stop-bleed', label: '止血', Icon: Zap },
  { key: 'converge', label: '收斂', Icon: Activity },
  { key: 'stabilize', label: '穩定', Icon: Clock3 },
];

interface SecuritySummaryCardProps {
  summary: SecuritySummary;
  advice?: AdviceLatestResponse;
  onAction: (action: SecuritySummaryAction) => void;
}

const SecuritySummaryCard: React.FC<SecuritySummaryCardProps> = ({
  summary,
  advice,
  onAction,
}) => {
  const [expanded, setExpanded] = useState(false);
  const reduceMotion = useReducedMotion();
  const action = summary.action;
  const advicePayload = advice?.advice ?? null;
  const hasAdvice = Boolean(advice?.available && advicePayload);
  const adviceSourceEventLabel = advice?.sourceEvent
    ? adviceSourceEventLabels[advice.sourceEvent]
    : '尚未觸發';
  const adviceTriggerScoreLabel =
    typeof advice?.triggerScore === 'number'
      ? `${advice.triggerScore.toFixed(1)} / 100`
      : '尚無';
  const adviceCompactTime = hasAdvice
    ? formatTimeOnly(advice?.evaluatedAt ?? undefined)
    : formatTimeOnly(summary.dataTime ?? undefined);
  const adviceCompactSource = hasAdvice
    ? `AI 建議（${adviceSourceEventLabel}）`
    : summary.dataSourceLabel;
  const adviceBlockedReasonLabel = advice?.blockedReason
    ? adviceBlockedReasonLabels[advice.blockedReason]
    : '目前沿用規則摘要';
  const progress = summary.progress;
  const auroraLayerOneAnimate = reduceMotion
    ? { opacity: 0.44, x: 0, y: 0, scale: 1, rotate: 0 }
    : {
        opacity: [0.3, 0.58, 0.4, 0.3],
        x: [0, -12, 10, 0],
        y: [0, 9, -6, 0],
        scale: [0.98, 1.04, 1, 0.98],
        rotate: [-4, 2, -1, -4],
      };
  const auroraLayerTwoAnimate = reduceMotion
    ? { opacity: 0.36, x: 0, y: 0, scale: 1, rotate: 0 }
    : {
        opacity: [0.24, 0.42, 0.28, 0.24],
        x: [0, 8, -6, 0],
        y: [0, -7, 4, 0],
        scale: [0.95, 1.08, 0.98, 0.95],
        rotate: [3, -2, 1, 3],
      };
  const auroraLayerThreeAnimate = reduceMotion
    ? { opacity: 0.32, x: 0, y: 0, scaleX: 1 }
    : {
        opacity: [0.2, 0.34, 0.24, 0.2],
        x: [0, -10, 6, 0],
        y: [0, 4, -3, 0],
        scaleX: [0.95, 1.07, 1, 0.95],
      };
  const auroraLayerOneTransition = reduceMotion
    ? { duration: 0 }
    : {
        duration: 6.4,
        ease: 'easeInOut' as const,
        repeat: Number.POSITIVE_INFINITY,
      };
  const auroraLayerTwoTransition = reduceMotion
    ? { duration: 0 }
    : {
        duration: 5.4,
        ease: 'easeInOut' as const,
        repeat: Number.POSITIVE_INFINITY,
        delay: 0.4,
      };
  const auroraLayerThreeTransition = reduceMotion
    ? { duration: 0 }
    : {
        duration: 5.8,
        ease: 'easeInOut' as const,
        repeat: Number.POSITIVE_INFINITY,
        delay: 0.25,
      };

  return (
    <m.div
      className="group border-cyber-border/50 glass-panel hover:border-cyber-primary/60 animate-on-load motion-safe:animate-slide-up relative overflow-hidden rounded-xl border px-5 py-5 shadow-lg transition-[transform,box-shadow,border-color,opacity] delay-100 duration-300 hover:shadow-[0_0_30px_rgba(88,166,255,0.2)]"
      initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      whileHover={reduceMotion ? undefined : { y: -3, scale: 1.006 }}
      transition={{
        duration: MOTION_DURATIONS.slow,
        ease: MOTION_EASING.enter,
      }}
    >
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="via-cyber-primary/5 motion-safe:group-hover:animate-scanline h-16 w-full bg-linear-to-b from-transparent to-transparent opacity-0 transition-opacity delay-150 duration-300 group-hover:opacity-100" />
      </div>
      <div className="via-cyber-primary/45 pointer-events-none absolute inset-y-0 left-0 w-1 bg-linear-to-b from-transparent to-transparent" />
      <div className="via-cyber-primary/40 pointer-events-none absolute top-0 left-0 h-px w-full bg-linear-to-r from-transparent to-transparent shadow-[0_0_8px_rgba(88,166,255,0.2)]" />
      <m.div
        className="pointer-events-none absolute top-1/2 left-1/2 h-[62%] w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-[42%] opacity-85 blur-2xl"
        style={summaryToneAuroraLayerOneStyle[summary.tone]}
        initial={false}
        animate={auroraLayerOneAnimate}
        transition={auroraLayerOneTransition}
      />
      <m.div
        className="pointer-events-none absolute top-1/2 left-1/2 h-[52%] w-[68%] -translate-x-1/2 -translate-y-1/2 rounded-[38%] opacity-75 blur-xl"
        style={summaryToneAuroraLayerTwoStyle[summary.tone]}
        initial={false}
        animate={auroraLayerTwoAnimate}
        transition={auroraLayerTwoTransition}
      />
      <m.div
        className="pointer-events-none absolute top-1/2 left-1/2 h-16 w-[74%] -translate-x-1/2 -translate-y-1/2 -rotate-8 rounded-full opacity-65 blur-xl"
        style={summaryToneAuroraLayerThreeStyle[summary.tone]}
        initial={false}
        animate={auroraLayerThreeAnimate}
        transition={auroraLayerThreeTransition}
      />

      <div className="relative space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-cyber-textmuted/80 text-xs font-black tracking-[0.12em] uppercase">
            任務指揮面板
          </p>
          <span
            className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-black tracking-[0.14em] uppercase ${summaryToneBadgeClass[summary.tone]}`}
          >
            {progress.statusLabel}
          </span>
        </div>

        <p className="text-cyber-text text-xl leading-tight font-black md:text-2xl">
          {summary.headline}
        </p>

        <div
          className={`rounded-xl border p-3 ${summaryTonePanelClass[summary.tone]}`}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-cyber-textmuted text-[11px] font-black tracking-[0.1em] uppercase">
              任務推進
            </p>
            <span className="text-cyber-text font-mono text-xs font-black">
              {`${Math.round(progress.score)}%`}
            </span>
          </div>
          <div className="border-cyber-border bg-cyber-bg/60 mt-2 h-2 overflow-hidden rounded-full border">
            <m.div
              className={`h-full origin-left ${summaryToneProgressClass[summary.tone]}`}
              initial={reduceMotion ? false : { scaleX: 0.12, opacity: 0.6 }}
              animate={{ scaleX: progress.score / 100, opacity: 1 }}
              transition={{
                duration: MOTION_DURATIONS.slow,
                ease: MOTION_EASING.enter,
                delay: 0.08,
              }}
            />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {SUMMARY_MISSION_STEPS.map((step, index) => {
              const done = index < progress.stageIndex;
              const current = index === progress.stageIndex;
              const useDangerFocus =
                summary.tone === 'danger' &&
                current &&
                step.key === 'stop-bleed';
              const stepClass = current
                ? useDangerFocus
                  ? summaryDangerStepFocusClass
                  : 'border-cyber-primary/70 bg-cyber-primary/15 text-cyber-text'
                : done
                  ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                  : 'border-cyber-border/70 bg-cyber-bg/40 text-cyber-textmuted';
              return (
                <m.div
                  key={step.key}
                  className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${stepClass}`}
                  initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: MOTION_DURATIONS.fast,
                    ease: MOTION_EASING.enter,
                    delay: 0.04 + index * 0.04,
                  }}
                >
                  <step.Icon className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-black tracking-[0.04em]">
                    {step.label}
                  </span>
                </m.div>
              );
            })}
          </div>
          <p className="text-cyber-textmuted mt-2 text-xs leading-relaxed">
            {progress.stageReason}
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
          <div className="border-cyber-border bg-cyber-bg/40 rounded-lg border px-3 py-2">
            <p className="text-cyber-textmuted text-xs font-black tracking-[0.1em] uppercase">
              核心判讀
            </p>
            <p className="text-cyber-text mt-1 text-sm leading-relaxed font-bold">
              {summary.coreMessage}
            </p>
          </div>
          <div className="border-cyber-border bg-cyber-bg/40 rounded-lg border px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-cyber-textmuted inline-flex items-center gap-1.5 text-xs font-black tracking-[0.1em] uppercase">
                <Sparkles className="text-cyber-primary h-3.5 w-3.5" />
                建議解法
              </p>
              <span
                className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-black tracking-[0.08em] uppercase ${
                  hasAdvice
                    ? 'border-cyber-primary/35 bg-cyber-primary/10 text-cyber-primary'
                    : 'border-cyber-border bg-cyber-bg/60 text-cyber-textmuted'
                }`}
              >
                {hasAdvice ? 'AI 建議' : '規則備援'}
              </span>
            </div>
            <p className="text-cyber-primary mt-1 text-sm leading-relaxed font-bold">
              {hasAdvice && advicePayload
                ? advicePayload.summary
                : summary.solutionMessage}
            </p>
            <p className="text-cyber-textmuted/75 mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
              <span>{adviceCompactSource}</span>
              <span aria-hidden>•</span>
              <span>評估 {adviceCompactTime}</span>
              <span aria-hidden>•</span>
              <span>分數 {adviceTriggerScoreLabel}</span>
            </p>
            {hasAdvice && advicePayload ? (
              <div className="mt-2 space-y-1">
                <p className="text-cyber-textmuted text-xs">
                  信心分數：
                  <span className="text-cyber-text ml-1 font-mono">
                    {(Math.max(0, Math.min(1, advicePayload.confidence)) * 100).toFixed(0)}%
                  </span>
                  {advice?.stale && (
                    <span className="ml-2 rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-black tracking-[0.08em] text-amber-700 uppercase dark:text-amber-200">
                      可能過期
                    </span>
                  )}
                </p>
                {advicePayload.actions.slice(0, 2).map((next, index) => (
                  <p key={`${next.title}-${index}`} className="text-cyber-textmuted text-xs">
                    <span className="text-cyber-text font-black">
                      {index + 1}. {next.title}
                    </span>
                    <span className="ml-1">{next.reason}</span>
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-cyber-textmuted mt-2 text-xs">
                {adviceBlockedReasonLabel}，目前使用規則摘要推導建議。
              </p>
            )}
          </div>
        </div>

        {action ? (
          <div className="border-cyber-primary/35 bg-cyber-primary/10 rounded-xl border p-3">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <p className="text-cyber-textmuted text-[11px] font-black tracking-[0.1em] uppercase">
                  主行動
                </p>
                <p className="text-cyber-text text-sm font-bold">
                  {action.reason}
                </p>
                <p className="text-cyber-textmuted text-xs">
                  KPI：{action.kpi.label}
                  <span className="text-cyber-text ml-1 font-mono">
                    {action.kpi.current}
                  </span>
                  <span className="mx-1">→</span>
                  <span className="text-cyber-primary font-mono font-black">
                    {action.kpi.target}
                  </span>
                </p>
                {action.focusCount !== null && (
                  <p className="text-cyber-textmuted text-xs">
                    焦點待處理：
                    <span className="text-cyber-primary ml-1 font-mono font-black">
                      {action.focusCount}
                    </span>
                  </p>
                )}
              </div>
              <GlowButton
                size="sm"
                className="gap-2 text-xs"
                onClick={() => onAction(action)}
              >
                <Zap className="size-4" />
                {action.label}
              </GlowButton>
            </div>
          </div>
        ) : (
          <div className="inline-flex items-center justify-center rounded-md border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs font-black tracking-[0.14em] text-emerald-700 uppercase dark:text-emerald-300">
            目前無待處理風險
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="text-cyber-textmuted hover:text-cyber-primary mt-3 inline-flex items-center gap-2 text-xs font-black tracking-[0.1em] uppercase transition-colors"
      >
        <span
          className={`border-cyber-border inline-flex h-4 w-4 items-center justify-center rounded border transition-transform ${
            expanded ? 'border-cyber-primary text-cyber-primary rotate-180' : ''
          }`}
        >
          <ChevronDown className="h-3 w-3" />
        </span>
        任務情報
      </button>

      {expanded && (
        <m.div
          className="border-cyber-border bg-cyber-bg/50 text-cyber-textmuted mt-2 space-y-1 rounded-lg border px-3 py-2 text-xs leading-relaxed"
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: MOTION_DURATIONS.fast,
            ease: MOTION_EASING.enter,
          }}
        >
          {summary.rationale.map((item) => (
            <p key={item}>• {item}</p>
          ))}
          <p>
            • 資料來源：{summary.dataSourceLabel}
            {summary.dataTime ? `（${formatRecentTime(summary.dataTime)}）` : ''}
          </p>
        </m.div>
      )}
    </m.div>
  );
};

const adviceSourceEventLabels: Record<
  Exclude<AdviceLatestResponse['sourceEvent'], null>,
  string
> = {
  scan_completed: '掃描完成',
  scan_failed: '掃描失敗',
  review_saved: '審核儲存',
  status_changed: '狀態變更',
};

const adviceBlockedReasonLabels: Record<
  Exclude<AdviceLatestResponse['blockedReason'], null>,
  string
> = {
  threshold_not_met: '未達建議觸發門檻',
  cooldown_active: '冷卻時間內，暫不重複呼叫',
  same_fingerprint: '指標與上一輪相同，略過重複建議',
  daily_limit_reached: '已達今日建議次數上限',
};

const laneToneClass: Record<RiskPriorityLane['tone'], string> = {
  danger: 'border-red-500/35 bg-red-500/10 text-red-700 dark:text-red-300',
  warning:
    'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  info: 'border-cyber-primary/35 bg-cyber-primary/10 text-cyber-primary',
};

interface HealthDetailDrawerProps {
  open: boolean;
  onClose: () => void;
}

const HealthDetailDrawer: React.FC<HealthDetailDrawerProps> = ({
  open,
  onClose,
}) => {
  const [windowMode, setWindowMode] = useState<'7d' | '30d'>('30d');
  const windowDays: 7 | 30 = windowMode === '7d' ? 7 : 30;
  const { health, isLoading, isError } = useHealth(windowDays, open);

  if (!open) return null;

  const components = health
    ? ([
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
          ).toFixed(
            1
          )}% / p95=${Math.round(health.score.components.reliability.workspaceP95Ms)}ms`,
        },
      ] as const)
    : [];

  const lowest =
    components.length > 0
      ? components.reduce(
          (acc, cur) => (cur.value < acc.value ? cur : acc),
          components[0]
        )
      : null;
  const actionSuggestion = !lowest
    ? '暫無足夠資料產生建議。'
    : lowest.key === 'exposure'
      ? '先處理嚴重級與高風險待處理漏洞，優先降低 ORB 與 LEV。'
      : lowest.key === 'remediation'
        ? '優先縮短 MTTR：先處理已確認且可快速修復的 open 項目。'
        : lowest.key === 'quality'
          ? '提高審核覆蓋率與效率，優先完成 pending 審核。'
          : '優先改善掃描穩定度：降低 fallback 率並縮短 workspace P95。';

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/55 backdrop-blur-sm">
      <button
        className="h-full flex-1 cursor-default"
        aria-label="關閉健康抽屜遮罩"
        onClick={onClose}
      />
      <aside className="border-cyber-border bg-cyber-surface h-full w-full max-w-xl overflow-y-auto border-l p-6 shadow-2xl">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h2 className="text-cyber-text text-xl font-black tracking-tight">
              健康評分詳情
            </h2>
            {health ? (
              <p className="text-cyber-textmuted mt-1 text-xs">
                總分 {health.score.value.toFixed(1)} / Grade{' '}
                {health.score.grade}（更新：
                {new Date(health.evaluatedAt).toLocaleString('zh-TW', {
                  hour12: false,
                })}
                ）
              </p>
            ) : (
              <p className="text-cyber-textmuted mt-1 text-xs">
                健康資料載入中…
              </p>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-cyber-border bg-cyber-bg text-cyber-text hover:border-cyber-primary/60 hover:text-cyber-text"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="border-cyber-border bg-cyber-bg mb-4 inline-flex rounded-md border p-1">
          <button
            type="button"
            onClick={() => setWindowMode('7d')}
            className={`rounded px-3 py-1 text-xs font-black tracking-wider uppercase ${windowMode === '7d' ? 'bg-cyber-primary/20 text-cyber-primary' : 'text-cyber-textmuted'}`}
          >
            7D
          </button>
          <button
            type="button"
            onClick={() => setWindowMode('30d')}
            className={`rounded px-3 py-1 text-xs font-black tracking-wider uppercase ${windowMode === '30d' ? 'bg-cyber-primary/20 text-cyber-primary' : 'text-cyber-textmuted'}`}
          >
            30D
          </button>
        </div>

        <p className="text-cyber-textmuted mb-4 text-xs">
          {windowMode === '7d'
            ? '7D 視角：重點觀察 Reliability 與近期掃描成功率。'
            : '30D 視角：重點觀察 Exposure / Remediation / Quality 的趨勢。'}
        </p>

        {isError ? (
          <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
            無法載入健康評分資料，請稍後再試。
          </p>
        ) : isLoading || !health ? (
          <p className="border-cyber-border bg-cyber-bg/40 text-cyber-textmuted rounded-lg border px-4 py-3 text-xs">
            正在計算健康評分…
          </p>
        ) : (
          <div className="space-y-3">
            {components.map((item) => (
              <div
                key={item.key}
                className="border-cyber-border bg-cyber-bg/40 hover:border-cyber-primary/40 rounded-lg border px-4 py-3 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-cyber-textmuted text-xs font-black tracking-[0.12em] uppercase">
                      {item.label}
                    </span>
                    <HealthMetricHelp content={HEALTH_METRIC_HELP[item.key]} />
                  </div>
                  <span className="text-cyber-text font-mono text-xl font-black">
                    {item.value.toFixed(1)}
                  </span>
                </div>
                <p className="text-cyber-textmuted mt-2 text-xs">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <p className="text-xs font-black tracking-[0.12em] text-amber-700 uppercase dark:text-amber-300">
            優先行動建議
          </p>
          <p className="mt-2 text-xs text-amber-800 dark:text-amber-100">
            {actionSuggestion}
          </p>
        </div>
      </aside>
    </div>
  );
};

interface ExportDialogProps {
  open: boolean;
  isExporting: boolean;
  format: ExportFormat;
  filters: ExportDialogState;
  onClose: () => void;
  onConfirm: () => void;
  onFormatChange: (format: ExportFormat) => void;
  onFiltersChange: (patch: Partial<ExportDialogState>) => void;
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
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="匯出報告設定"
    >
      <div className="border-cyber-border bg-cyber-surface w-full max-w-2xl rounded-2xl border p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-cyber-text text-lg font-black tracking-tight">
              匯出報告
            </h2>
            <p className="text-cyber-textmuted mt-1 text-xs">
              先設定篩選條件，再選擇匯出格式。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="border-cyber-border text-cyber-textmuted hover:border-cyber-primary hover:text-cyber-text rounded border p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="關閉匯出設定"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-cyber-textmuted text-xs font-bold tracking-[0.08em] uppercase">
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
            <label className="text-cyber-textmuted text-xs font-bold tracking-[0.08em] uppercase">
              漏洞狀態
            </label>
            <CyberSelect
              value={filters.status}
              onValueChange={(value) =>
                onFiltersChange({
                  status: value as ExportDialogState['status'],
                })
              }
              options={Object.entries(STATUS_LABELS).map(([value, label]) => ({
                value,
                label,
              }))}
              triggerClassName="text-xs text-cyber-text"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-cyber-textmuted text-xs font-bold tracking-[0.08em] uppercase">
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
            <label className="text-cyber-textmuted text-xs font-bold tracking-[0.08em] uppercase">
              人工審核狀態
            </label>
            <CyberSelect
              value={filters.humanStatus}
              onValueChange={(value) =>
                onFiltersChange({
                  humanStatus: value as ExportDialogState['humanStatus'],
                })
              }
              options={Object.entries(HUMAN_STATUS_LABELS).map(
                ([value, label]) => ({
                  value,
                  label,
                })
              )}
              triggerClassName="text-xs text-cyber-text"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-cyber-textmuted text-xs font-bold tracking-[0.08em] uppercase">
              檔案路徑包含
            </label>
            <Input
              value={filters.filePath}
              onChange={(e) => onFiltersChange({ filePath: e.target.value })}
              placeholder="例如: src/server/routes"
              className="border-cyber-border bg-cyber-bg text-cyber-text placeholder:text-cyber-textmuted text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-cyber-textmuted text-xs font-bold tracking-[0.08em] uppercase">
              關鍵字搜尋
            </label>
            <Input
              value={filters.search}
              onChange={(e) => onFiltersChange({ search: e.target.value })}
              placeholder="描述 / 類型 / CWE / 路徑"
              className="border-cyber-border bg-cyber-bg text-cyber-text placeholder:text-cyber-textmuted text-sm"
            />
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isExporting}
            className="border-cyber-border bg-cyber-bg text-cyber-text hover:border-cyber-primary/60 hover:text-cyber-text"
          >
            取消
          </Button>
          <GlowButton
            type="button"
            onClick={onConfirm}
            disabled={isExporting}
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {isExporting ? '匯出中…' : '開始匯出'}
          </GlowButton>
        </div>
      </div>
    </div>
  );
};

// === 儀表盤主元件 ===

export const Dashboard: React.FC = () => {
  const reduceMotion = useReducedMotion();
  const { data: stats, isLoading, isError, refetch } = useVulnStats();
  const { data: trendData } = useVulnTrend();
  const { health } = useHealth(30);
  const { data: adviceLatest } = useAdviceLatest();
  const router = useRouter();
  const setVulnFilters = useSetAtom(vulnFiltersAtom);
  const setVulnPreset = useSetAtom(vulnerabilityPresetAtom);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isHealthDrawerOpen, setIsHealthDrawerOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('pdf');
  const [exportDialogState, setExportDialogState] = useState<ExportDialogState>(
    DEFAULT_EXPORT_DIALOG_STATE
  );
  const exportFilters = useMemo(
    () => toExportFilters(exportDialogState),
    [exportDialogState]
  );

  const handleOpenExportDialog = useCallback(() => {
    setIsExportDialogOpen(true);
  }, []);

  const handleCloseExportDialog = useCallback(() => {
    if (isExporting) return;
    setIsExportDialogOpen(false);
  }, [isExporting]);

  const handleExportFiltersChange = useCallback(
    (patch: Partial<ExportDialogState>) => {
      setExportDialogState((prev) => ({ ...prev, ...patch }));
    },
    []
  );

  const handleNavigateToPreset = useCallback(
    async (preset: VulnerabilityFilterPreset, sourceLabel: string) => {
      const targetLabel = PRESET_LABELS[preset];

      if (isInVscodeWebview()) {
        const toastId = toast.loading(`正在切換到漏洞列表（${targetLabel}）…`);
        try {
          const result = await sendFocusSidebarViewAndWait(
            'vulnerabilities',
            preset,
            8_000
          );
          if (result.success) {
            toast.success(`已切換並套用建議篩選：${targetLabel}`, {
              id: toastId,
            });
            return;
          }
          toast.error(`${sourceLabel} 導流失敗，請手動展開漏洞列表`, {
            id: toastId,
            description: toMoreInfo(
              result.message || 'Extension 未回覆成功結果'
            ),
          });
        } catch (error) {
          const detail = getErrorDetail(error) ?? '等待導航回執逾時';
          toast.error(`${sourceLabel} 導流失敗，請手動展開漏洞列表`, {
            id: toastId,
            description: toMoreInfo(detail),
          });
        }
        return;
      }

      const filters = presetToFilters(preset);
      setVulnFilters((prev) => ({ ...prev, ...filters }));
      setVulnPreset({
        preset,
        appliedAt: new Date().toISOString(),
      });
      router.push('/vulnerabilities');
      toast.success(`已套用建議篩選：${targetLabel}`);
    },
    [router, setVulnFilters, setVulnPreset]
  );

  const handleExportReport = useCallback(async () => {
    setIsExporting(true);
    const loadingToastId =
      exportFormat === 'pdf'
        ? toast.loading('正在準備 PDF 匯出，請稍候…')
        : undefined;

    try {
      if (exportFormat === 'pdf') {
        if (isInVscodeWebview()) {
          // Webview 內固定由 Extension 開啟外部瀏覽器列印，不下載 HTML。
          const requestId = createRequestId('export-pdf');
          postToExtension({
            type: 'export_pdf',
            requestId,
            data: {
              filters: exportFilters,
              filename: buildFallbackFilename('pdf'),
            },
          });
          if (loadingToastId !== undefined) {
            toast.success('已通知擴充套件開啟外部列印，請稍候…', {
              id: loadingToastId,
            });
          } else {
            toast.success('已通知擴充套件開啟外部列印，請稍候…');
          }
          setIsExportDialogOpen(false);
          return;
        }

        const response = await api.post(
          '/api/export',
          { format: 'pdf', filters: exportFilters },
          { responseType: 'text', timeout: 120_000 }
        );
        const html = String(response.data ?? '');
        await printHtmlReport(html);
        if (loadingToastId !== undefined) {
          toast.success('PDF 匯出流程已啟動', { id: loadingToastId });
        } else {
          toast.success('PDF 匯出流程已啟動');
        }

        setIsExportDialogOpen(false);
        return;
      }

      const response = await api.post(
        '/api/export',
        { format: exportFormat, filters: exportFilters },
        { responseType: 'blob', timeout: 120_000 }
      );
      const disposition = response.headers['content-disposition'] as
        | string
        | undefined;
      const filename = filenameFromDisposition(disposition, exportFormat);
      downloadBlob(response.data, filename);
      toast.success(`已下載 ${filename}`);
      setIsExportDialogOpen(false);
    } catch (err) {
      const detail = getErrorDetail(err);
      const message =
        exportFormat === 'pdf'
          ? 'PDF 匯出失敗，請稍後再試'
          : '匯出失敗，請稍後再試';
      const description =
        toMoreInfo(detail) ??
        (exportFormat === 'pdf'
          ? toMoreInfo('可改用 Markdown 或 JSON 匯出。')
          : undefined);
      if (loadingToastId !== undefined) {
        toast.error(message, { id: loadingToastId, description });
      } else {
        toast.error(message, { description });
      }
    } finally {
      setIsExporting(false);
    }
  }, [exportFilters, exportFormat]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="border-cyber-border/60 bg-cyber-surface h-16 border" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, idx) => (
            <Skeleton
              key={idx}
              className="border-cyber-border/60 bg-cyber-surface h-36 border"
            />
          ))}
        </div>
        <Skeleton className="border-cyber-border/60 bg-cyber-surface h-14 border" />
        <Skeleton className="border-cyber-border/60 bg-cyber-surface h-[420px] border" />
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="text-cyber-textmuted flex min-h-[400px] flex-col items-center justify-center gap-3">
        <p>暫時無法載入儀錶盤資料</p>
        <Button
          type="button"
          variant="outline"
          className="border-cyber-border bg-cyber-surface text-cyber-text hover:border-cyber-primary/60 hover:text-cyber-text"
          onClick={() => void refetch()}
        >
          重新整理
        </Button>
      </div>
    );
  }

  const openCount = stats.byStatus?.open ?? 0;
  const fixedCount = stats.byStatus?.fixed ?? 0;
  const ignoredCount = stats.byStatus?.ignored ?? 0;
  const criticalCount =
    stats.bySeverityOpen?.critical ?? stats.bySeverity?.critical ?? 0;
  const highCount = stats.bySeverityOpen?.high ?? stats.bySeverity?.high ?? 0;
  const criticalHighCount = criticalCount + highCount;
  const confirmedReviewCount = stats.byHumanStatus?.confirmed ?? 0;
  const pendingReviewCount = stats.byHumanStatus?.pending ?? 0;
  const totalCount = stats.total;
  const fixedRatePercent =
    totalCount > 0 ? Math.round((fixedCount / totalCount) * 100) : 0;
  const openRatePercent =
    totalCount > 0 ? Math.round((openCount / totalCount) * 100) : 0;
  const criticalOpenPercent =
    openCount > 0 ? Math.round((criticalHighCount / openCount) * 100) : 0;

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
            : 'C';

  const healthGrade = health?.score.grade ?? legacyHealthGrade;
  const gradeView = toGradeView(healthGrade as HealthGrade);
  const healthScoreValue =
    health?.score.value !== undefined
      ? health.score.value.toFixed(1)
      : `${Math.round(stats.fixRate * 100)}`;
  const healthScoreNumber =
    health?.score.value ?? Math.round(stats.fixRate * 100);
  const healthTrend = gradeView.label;
  const healthSubtext =
    health?.score.value !== undefined ? (
      <span className="inline-flex items-center gap-3 whitespace-nowrap">
        <span className="inline-flex items-center gap-1">
          暴露 {health.score.components.exposure.value.toFixed(1)}
          <HealthMetricHelp content={HEALTH_METRIC_HELP.exposure} />
        </span>
        <span className="inline-flex items-center gap-1">
          可靠 {health.score.components.reliability.value.toFixed(1)}
          <HealthMetricHelp content={HEALTH_METRIC_HELP.reliability} />
        </span>
      </span>
    ) : (
      `已修復 ${fixedCount}・已忽略 ${ignoredCount}`
    );
  const healthTrendUp = healthScoreNumber >= 60;
  const healthTopFactors = health?.score.topFactors ?? [];
  const canScanFromDashboard = isInVscodeWebview();

  const dashboardInsightInput = {
    totalCount,
    openCount,
    bySeverity: stats.bySeverity,
    bySeverityOpen: stats.bySeverityOpen,
    byHumanStatus: stats.byHumanStatus,
    health,
    trend: trendData,
  };

  const summaryCard = buildSecuritySummary(dashboardInsightInput);
  const priorityLanes = buildRiskPriorityLanes(dashboardInsightInput);

  const statCards: CyberStatCardProps[] = [
    {
      label: '漏洞總數',
      value: stats.total,
      trend: totalCount > 0 ? `已處理 ${fixedRatePercent}%` : '尚無資料',
      trendUp: fixedRatePercent >= 60,
      subtext: (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1">
            待處理 {openCount}
            <HealthMetricHelp content={DASHBOARD_STAT_HELP.openRate} />
          </span>
          <span className="inline-flex items-center gap-1">
            已修復 {fixedCount}
            <HealthMetricHelp content={DASHBOARD_STAT_HELP.fixedRate} />
          </span>
        </span>
      ),
      trendTone: 'info',
      barColor: 'bg-blue-500',
      hoverBorderColor: 'hover:border-blue-500 hover:shadow-blue-500/20',
      delay: 'delay-100',
      orbToneClass: 'border-blue-500/30 bg-blue-500/12',
    },
    {
      label: '待處理',
      value: openCount,
      trend: `佔比 ${openRatePercent}%`,
      trendUp: openRatePercent <= 25,
      subtext: (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1">
            已確認 {confirmedReviewCount}
          </span>
          <span className="inline-flex items-center gap-1">
            待審核 {pendingReviewCount}
            <HealthMetricHelp content={DASHBOARD_STAT_HELP.reviewFlow} />
          </span>
        </span>
      ),
      trendTone: 'warning',
      barColor: 'bg-amber-500',
      hoverBorderColor: 'hover:border-amber-500 hover:shadow-amber-500/20',
      delay: 'delay-200',
      orbToneClass: 'border-amber-500/30 bg-amber-500/12',
    },
    {
      label: '嚴重 / 高風險',
      value: criticalHighCount,
      trend:
        criticalHighCount > 0 ? `佔待處理 ${criticalOpenPercent}%` : '目前安全',
      trendUp: criticalHighCount === 0,
      subtext: (
        <span className="inline-flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1">
            嚴重級 {criticalCount}
          </span>
          <span className="inline-flex items-center gap-1">
            高風險級 {highCount}
            <HealthMetricHelp content={DASHBOARD_STAT_HELP.criticalMix} />
          </span>
        </span>
      ),
      trendTone: criticalHighCount > 0 ? 'danger' : 'success',
      barColor: 'bg-red-500',
      hoverBorderColor: 'hover:border-red-500 hover:shadow-red-500/20',
      delay: 'delay-300',
      orbToneClass: 'border-red-500/30 bg-red-500/10',
    },
    {
      label: '健康評分',
      value: healthScoreValue,
      valueSuffix: '/100',
      trend: healthTrend,
      trendUp: healthTrendUp,
      subtext: healthSubtext,
      trendTone: gradeView.tone,
      valueHelp: HEALTH_METRIC_HELP.score,
      barColor: 'bg-green-600',
      hoverBorderColor: 'hover:border-green-500 hover:shadow-green-500/20',
      delay: 'delay-400',
      onClick: () => setIsHealthDrawerOpen(true),
      clickTarget: 'action',
      actionButtonLabel: '查看詳情',
      actionHint: (
        <span className="inline-flex items-center gap-1">
          <Clock3 className="h-3.5 w-3.5" />
          更新 {formatTimeOnly(health?.evaluatedAt)}
        </span>
      ),
      orbToneClass: 'border-cyber-primary/25 bg-cyber-primary/12',
      showOrb: false,
    },
  ];

  return (
    <TooltipProvider delayDuration={120}>
      <div className="relative space-y-8">
        {/* 整體網格與發光背景 */}
        <div className="cyber-grid-bg pointer-events-none absolute -inset-4 z-0 [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)] opacity-15" />
        <div className="bg-cyber-primary/10 pointer-events-none absolute -top-10 left-1/2 h-32 w-3/4 -translate-x-1/2 rounded-full blur-[100px]" />
        <div className="relative z-10 space-y-8">
          {/* 標題區塊 */}
          <DashboardHeader onOpenExport={handleOpenExportDialog} />

          <m.div
            initial={reduceMotion ? false : 'hidden'}
            animate="show"
            variants={fadeInUp}
          >
            <SecuritySummaryCard
              summary={summaryCard}
              advice={adviceLatest}
              onAction={(action) =>
                void handleNavigateToPreset(action.preset, '摘要建議')
              }
            />
          </m.div>

          {/* 統計卡片 */}
          <m.div
            className="grid grid-cols-2 gap-4 lg:grid-cols-4"
            initial={reduceMotion ? false : 'hidden'}
            animate="show"
            variants={sectionContainer(
              getStaggerForCount(statCards.length, 12)
            )}
          >
            {statCards.map((card) => (
              <m.div key={card.label} variants={fadeInUp}>
                <CyberStatCard {...card} />
              </m.div>
            ))}
          </m.div>

          {healthTopFactors.length > 0 && (
            <m.div
              initial={reduceMotion ? false : 'hidden'}
              animate="show"
              variants={panelEnter}
              className="border-cyber-border bg-cyber-surface rounded-xl border px-4 py-3 shadow-lg"
            >
              <p className="text-cyber-textmuted inline-flex items-center gap-2 text-xs font-black tracking-[0.12em] uppercase">
                <span className="border-cyber-primary/35 bg-cyber-primary/10 text-cyber-primary inline-flex h-4 w-4 items-center justify-center rounded border">
                  <Activity className="h-3 w-3" />
                </span>
                健康分數關鍵因素 Top 3
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {healthTopFactors.map((factor) => (
                  <Tooltip key={factor.key}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-bold ${
                          factor.direction === 'negative'
                            ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-200'
                            : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
                        }`}
                      >
                        <span
                          className={`inline-flex h-1.5 w-1.5 rounded-full ${
                            factor.direction === 'negative'
                              ? 'bg-amber-300'
                              : 'bg-emerald-300'
                          }`}
                        />
                        <span>{factor.label}</span>
                        <span className="font-mono">{factor.valueText}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      align="start"
                      collisionPadding={12}
                      className="border-cyber-border bg-cyber-surface2 text-cyber-text w-[min(20rem,calc(100vw-2rem))] rounded-lg p-3 text-left text-xs leading-relaxed"
                    >
                      <span className="text-cyber-primary block text-xs font-black tracking-wider uppercase">
                        {factor.direction === 'negative'
                          ? '主要拉低因素'
                          : '主要加分因素'}
                      </span>
                      <span className="text-cyber-textmuted mt-1 block">
                        {factor.reason}
                      </span>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </m.div>
          )}

          {stats.total === 0 && (
            <div className="border-cyber-border bg-cyber-surface rounded-xl border px-4 py-4 shadow-lg">
              <p className="text-cyber-text text-sm font-bold">
                尚未產生漏洞資料
              </p>
              <p className="text-cyber-textmuted mt-1 text-xs">
                先執行工作區掃描，系統會建立最新風險摘要與健康評分。
              </p>
              {canScanFromDashboard ? (
                <GlowButton
                  size="sm"
                  className="mt-3 gap-2 text-xs"
                  onClick={() =>
                    postToExtension({
                      type: 'request_scan',
                      data: { scope: 'workspace' },
                    })
                  }
                >
                  <Zap className="size-4" />
                  執行工作區掃描
                </GlowButton>
              ) : (
                <p className="text-cyber-textmuted mt-3 text-xs">
                  請在 VS Code 面板內執行工作區掃描。
                </p>
              )}
            </div>
          )}

          {/* 圖表區 */}
          <m.div
            className="grid grid-cols-1 gap-6 lg:grid-cols-12"
            initial={reduceMotion ? false : 'hidden'}
            animate="show"
            variants={panelEnter}
          >
            {/* 嚴重性分佈甜甜圈圖 */}
            <CyberCard
              title="風險資源分配"
              subtitle="Threat Matrix Allocation"
              className="flex min-h-[440px] flex-col lg:col-span-4"
              delay="delay-400"
            >
              <SeverityChart
                bySeverity={stats.bySeverityOpen ?? stats.bySeverity}
                total={openCount}
              />
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-cyber-textmuted text-xs font-black tracking-[0.1em] uppercase">
                    Priority Lanes
                  </p>
                  <HealthMetricHelp content={ALLOCATION_HELP} />
                </div>
                {priorityLanes.map((lane) => (
                  <button
                    key={lane.key}
                    type="button"
                    onClick={() =>
                      void handleNavigateToPreset(lane.preset, '資源分配建議')
                    }
                    className="border-cyber-border bg-cyber-bg/40 hover:border-cyber-primary/55 w-full rounded-lg border px-3 py-2 text-left transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <p className="text-cyber-text text-xs font-black tracking-[0.14em] uppercase">
                          {lane.title}
                        </p>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              className="border-cyber-border text-cyber-textmuted inline-flex h-4 w-4 items-center justify-center rounded-full border"
                              aria-label={`${lane.title}說明`}
                            >
                              <CircleHelp className="h-3 w-3" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            align="start"
                            collisionPadding={12}
                            className="border-cyber-border bg-cyber-surface2 text-cyber-text w-[min(18rem,calc(100vw-2rem))] rounded-lg p-3 text-left text-xs leading-relaxed"
                          >
                            <span className="text-cyber-primary block text-xs font-black tracking-wider uppercase">
                              {lane.subtitle}
                            </span>
                            <span className="text-cyber-textmuted mt-1 block">
                              {lane.expectedBenefit}
                            </span>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded border px-2 py-0.5 text-xs font-black ${laneToneClass[lane.tone]}`}
                        >
                          佔比 {lane.ratioPercent}%
                        </span>
                        <span className="text-cyber-textmuted font-mono text-xs">
                          待處理 {lane.openCount}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </CyberCard>

            {/* 安全趨勢面積圖 */}
            <div className="lg:col-span-8">
              <TrendChart
                onNavigatePreset={(preset) =>
                  void handleNavigateToPreset(preset, '威脅演進建議')
                }
              />
            </div>

            <RecentScanCard />
          </m.div>

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
      </div>
    </TooltipProvider>
  );
};

'use client'

import { m, useReducedMotion } from 'framer-motion'
import {
  Bot,
  CircleHelp,
  Eye,
  EyeOff,
  Globe,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ScanLine,
  ShieldOff,
  Trash2,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import React, { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'

import { GlowButton } from '@/components/glow-button'
import { StickyActionBar } from '@/components/sticky-action-bar'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useConfig, useConfigQuery, useSaveConfig, useUpdateConfig } from '@/hooks/use-config'
import { useExtensionBridge } from '@/hooks/use-extension-bridge'
import { useI18n } from '@/hooks/use-i18n'
import type { ResolvedLocale } from '@/libs/i18n'
import type { PluginConfig } from '@/libs/types'
import { getSyncPhaseLabel, toMoreInfo } from '@/libs/ui-messages'

// === 兩欄表單列元件 ===

interface InlineHelpContent {
  title: string
  description: string
  points?: string[]
}

function tx(
  locale: ResolvedLocale,
  text: { 'zh-TW': string; 'zh-CN': string; en: string },
): string {
  return text[locale]
}

const InlineHelp: React.FC<{ content: InlineHelpContent; ariaLabel: string }> = ({
  content,
  ariaLabel,
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-cyber-border text-cyber-textmuted transition-colors hover:border-cyber-primary hover:text-cyber-primary"
        aria-label={ariaLabel}
      >
        <CircleHelp className="h-3 w-3" />
      </button>
    </TooltipTrigger>
    <TooltipContent
      side="top"
      align="start"
      collisionPadding={12}
      className="w-[min(20rem,calc(100vw-2rem))] rounded-lg border-cyber-border bg-cyber-surface2 p-3 text-left text-xs leading-relaxed text-cyber-text"
    >
      <span className="block text-xs font-black uppercase tracking-[0.08em] text-cyber-primary">
        {content.title}
      </span>
      <span className="mt-1 block text-cyber-textmuted">{content.description}</span>
      {content.points && content.points.length > 0 && (
        <ul className="mt-2 space-y-1 text-cyber-textmuted">
          {content.points.map((point) => (
            <li key={point}>• {point}</li>
          ))}
        </ul>
      )}
    </TooltipContent>
  </Tooltip>
)

interface FormRowProps {
  label: string
  description?: string
  htmlFor?: string
  labelHelp?: React.ReactNode
  children: React.ReactNode
}

/** 兩欄網格列：左側標籤描述、右側輸入控制項 */
const FormRow: React.FC<FormRowProps> = ({ label, description, htmlFor, labelHelp, children }) => (
  <div className="grid grid-cols-[1fr_1.2fr] items-start gap-4 border-b border-border/50 py-4 last:border-b-0">
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </Label>
        {labelHelp}
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
    <div>{children}</div>
  </div>
)

// === LLM 配置分頁 ===

interface LlmTabProps {
  locale: ResolvedLocale
  llm: PluginConfig['llm']
  onChange: (llm: Partial<PluginConfig['llm']>) => void
}

const LlmTab: React.FC<LlmTabProps> = ({ locale, llm, onChange }) => {
  const [showKey, setShowKey] = useState(false)
  const providerLabel = llm.provider === 'nvidia' ? 'NVIDIA Integrate' : 'Google Gemini'
  const apiKeyPlaceholder =
    llm.provider === 'nvidia'
      ? tx(locale, {
          'zh-TW': '輸入 NVIDIA API Key…',
          'zh-CN': '输入 NVIDIA API Key…',
          en: 'Enter NVIDIA API Key…',
        })
      : tx(locale, {
          'zh-TW': '輸入 Gemini API Key…',
          'zh-CN': '输入 Gemini API Key…',
          en: 'Enter Gemini API Key…',
        })
  const endpointPlaceholder =
    llm.provider === 'nvidia'
      ? 'https://integrate.api.nvidia.com/v1'
      : 'https://generativelanguage.googleapis.com/v1beta/models'
  const modelPlaceholder =
    llm.provider === 'nvidia' ? 'qwen/qwen2.5-coder-32b-instruct' : 'gemini-3-flash-preview'

  return (
    <div className="flex flex-col">
      <FormRow
        label={tx(locale, { 'zh-TW': '提供商', 'zh-CN': '提供商', en: 'Provider' })}
        description={tx(locale, {
          'zh-TW': '選擇 LLM 服務提供商',
          'zh-CN': '选择 LLM 服务提供商',
          en: 'Choose your LLM provider',
        })}
        htmlFor="llm-provider"
      >
        <Select
          value={llm.provider}
          onValueChange={(v) => onChange({ provider: v as PluginConfig['llm']['provider'] })}
        >
          <SelectTrigger id="llm-provider" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="nvidia">NVIDIA Integrate</SelectItem>
            <SelectItem value="gemini">Google Gemini</SelectItem>
          </SelectContent>
        </Select>
      </FormRow>

      <FormRow
        label="API Key"
        description={
          locale === 'en'
            ? `API key used to authenticate ${providerLabel} requests`
            : locale === 'zh-CN'
              ? `用于校验 ${providerLabel} API 请求的密钥`
              : `用於驗證 ${providerLabel} API 請求的金鑰`
        }
        htmlFor="llm-api-key"
      >
        <div className="flex gap-2">
          <Input
            id="llm-api-key"
            type={showKey ? 'text' : 'password'}
            value={llm.apiKey}
            onChange={(e) => onChange({ apiKey: e.target.value })}
            placeholder={apiKeyPlaceholder}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setShowKey((p) => !p)}
            aria-label={
              showKey
                ? tx(locale, { 'zh-TW': '隱藏 API Key', 'zh-CN': '隐藏 API Key', en: 'Hide API key' })
                : tx(locale, { 'zh-TW': '顯示 API Key', 'zh-CN': '显示 API Key', en: 'Show API key' })
            }
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </FormRow>

      <div className="mt-3 rounded-lg border border-cyber-border bg-cyber-bg/35 px-4">
        <Accordion type="single" collapsible>
          <AccordionItem value="llm-advanced" className="border-none">
            <AccordionTrigger className="text-xs font-black uppercase tracking-[0.08em] text-cyber-textmuted">
              {tx(locale, {
                'zh-TW': '進階：端點與模型覆寫',
                'zh-CN': '高级：端点与模型覆写',
                en: 'Advanced: Endpoint and Model Override',
              })}
            </AccordionTrigger>
            <AccordionContent className="space-y-1">
              <FormRow
                label={tx(locale, { 'zh-TW': '端點', 'zh-CN': '端点', en: 'Endpoint' })}
                description={
                  locale === 'en'
                    ? `Custom ${providerLabel} API endpoint (optional)`
                    : locale === 'zh-CN'
                      ? `自定义 ${providerLabel} API 端点（选填）`
                      : `自訂 ${providerLabel} API 端點（選填）`
                }
                htmlFor="llm-endpoint"
              >
                <Input
                  id="llm-endpoint"
                  value={llm.endpoint ?? ''}
                  onChange={(e) => onChange({ endpoint: e.target.value || undefined })}
                  placeholder={endpointPlaceholder}
                />
              </FormRow>

              <FormRow
                label={tx(locale, { 'zh-TW': '模型', 'zh-CN': '模型', en: 'Model' })}
                description={tx(locale, {
                  'zh-TW': '指定使用的模型名稱（選填）',
                  'zh-CN': '指定使用的模型名称（选填）',
                  en: 'Specify model name (optional)',
                })}
                htmlFor="llm-model"
              >
                <Input
                  id="llm-model"
                  value={llm.model ?? ''}
                  onChange={(e) => onChange({ model: e.target.value || undefined })}
                  placeholder={modelPlaceholder}
                />
              </FormRow>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  )
}

// === 分析觸發分頁 ===

interface AnalysisTabProps {
  locale: ResolvedLocale
  analysis: PluginConfig['analysis']
  onChange: (analysis: Partial<PluginConfig['analysis']>) => void
}

function getAnalysisDepthMeta(
  locale: ResolvedLocale,
): Record<PluginConfig['analysis']['depth'], { label: string; hint: string }> {
  switch (locale) {
    case 'zh-CN':
      return {
        quick: {
          label: '快速扫描（优先速度）',
          hint: '仅对高风险点位做模型分析，响应最快，适合日常开发即时检查。',
        },
        standard: {
          label: '平衡扫描（推荐）',
          hint: '每文件一次聚合分析，在速度、成本与覆盖率间取得平衡。',
        },
        deep: {
          label: '完整扫描（优先覆盖）',
          hint: '加入全文件宏观分析，覆盖更完整，但耗时与成本更高。',
        },
      }
    case 'en':
      return {
        quick: {
          label: 'Quick Scan (Speed First)',
          hint: 'Model analysis only on high-risk points for fastest feedback.',
        },
        standard: {
          label: 'Standard Scan (Recommended)',
          hint: 'One aggregated analysis per file for balanced speed and coverage.',
        },
        deep: {
          label: 'Deep Scan (Coverage First)',
          hint: 'Adds full-file analysis for better coverage with higher cost.',
        },
      }
    default:
      return {
        quick: {
          label: '快速掃描（優先速度）',
          hint: '僅針對高風險點位做模型分析，回應最快，適合日常開發即時檢查。',
        },
        standard: {
          label: '平衡掃描（建議）',
          hint: '每檔案做一次聚合分析，在速度、成本與覆蓋率之間取得平衡。',
        },
        deep: {
          label: '完整掃描（優先覆蓋）',
          hint: '加入全檔案宏觀分析，覆蓋更完整，但耗時與成本較高。',
        },
      }
  }
}

const AnalysisTab: React.FC<AnalysisTabProps> = ({ locale, analysis, onChange }) => {
  const ANALYSIS_DEPTH_META = getAnalysisDepthMeta(locale)
  const currentDepthMeta = ANALYSIS_DEPTH_META[analysis.depth]

  return (
    <div className="flex flex-col">
      <FormRow
        label={tx(locale, { 'zh-TW': '觸發方式', 'zh-CN': '触发方式', en: 'Trigger Mode' })}
        description={tx(locale, {
          'zh-TW': '設定漏洞分析的觸發時機',
          'zh-CN': '设置漏洞分析的触发时机',
          en: 'Choose when vulnerability analysis runs',
        })}
        htmlFor="trigger-mode"
      >
        <Select
          value={analysis.triggerMode}
          onValueChange={(v) =>
            onChange({ triggerMode: v as PluginConfig['analysis']['triggerMode'] })
          }
        >
          <SelectTrigger id="trigger-mode" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="onSave">
              {tx(locale, { 'zh-TW': '儲存時自動分析', 'zh-CN': '保存时自动分析', en: 'Auto on Save' })}
            </SelectItem>
            <SelectItem value="manual">
              {tx(locale, { 'zh-TW': '手動觸發', 'zh-CN': '手动触发', en: 'Manual Trigger' })}
            </SelectItem>
          </SelectContent>
        </Select>
      </FormRow>

      <FormRow
        label={tx(locale, { 'zh-TW': '分析深度', 'zh-CN': '分析深度', en: 'Scan Depth' })}
        description={tx(locale, {
          'zh-TW': '控制掃描的精細程度與耗時',
          'zh-CN': '控制扫描精细度与耗时',
          en: 'Control coverage and runtime',
        })}
        htmlFor="analysis-depth"
        labelHelp={
          <InlineHelp
            ariaLabel={tx(locale, { 'zh-TW': '分析深度說明', 'zh-CN': '分析深度说明', en: 'Scan depth help' })}
            content={{
              title: tx(locale, {
                'zh-TW': '分析深度怎麼選？',
                'zh-CN': '分析深度怎么选？',
                en: 'How to choose depth?',
              }),
              description: tx(locale, {
                'zh-TW': '深度越高，覆蓋通常越完整，但速度與成本會提高。',
                'zh-CN': '深度越高覆盖越完整，但速度与成本会提高。',
                en: 'Higher depth gives better coverage with more time and cost.',
              }),
              points:
                locale === 'en'
                  ? [
                      'Quick: speed first, ideal for frequent checks during coding.',
                      'Standard: default balance of speed and accuracy.',
                      'Deep: coverage first, good for release checks.',
                    ]
                  : locale === 'zh-CN'
                    ? [
                        '快速：优先速度，适合开发中频繁触发。',
                        '平衡：日常默认，兼顾速度与准确性。',
                        '完整：优先覆盖，适合发布前或重点稽核。',
                      ]
                    : [
                        '快速：優先速度，適合開發中頻繁觸發。',
                        '平衡：日常預設，兼顧速度與準確性。',
                        '完整：優先覆蓋，適合發布前或重點稽核。',
                      ],
            }}
          />
        }
      >
        <div className="space-y-2">
          <Select
            value={analysis.depth}
            onValueChange={(v) => onChange({ depth: v as PluginConfig['analysis']['depth'] })}
          >
            <SelectTrigger id="analysis-depth" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="quick">{ANALYSIS_DEPTH_META.quick.label}</SelectItem>
              <SelectItem value="standard">{ANALYSIS_DEPTH_META.standard.label}</SelectItem>
              <SelectItem value="deep">{ANALYSIS_DEPTH_META.deep.label}</SelectItem>
            </SelectContent>
          </Select>
          <p className="rounded-md border border-cyber-border/60 bg-cyber-bg/40 px-3 py-2 text-xs leading-relaxed text-cyber-textmuted">
            {currentDepthMeta.hint}
          </p>
        </div>
      </FormRow>

      <FormRow
        label={tx(locale, {
          'zh-TW': 'Debounce 延遲',
          'zh-CN': 'Debounce 延迟',
          en: 'Debounce Delay',
        })}
        description={tx(locale, {
          'zh-TW': '儲存後等待多久才觸發分析（毫秒）',
          'zh-CN': '保存后等待多久触发分析（毫秒）',
          en: 'Delay after save before analysis starts (ms)',
        })}
        htmlFor="debounce-ms"
      >
        <Input
          id="debounce-ms"
          type="number"
          min={100}
          max={5000}
          step={100}
          value={analysis.debounceMs}
          onChange={(e) => onChange({ debounceMs: Number(e.target.value) || 500 })}
        />
      </FormRow>
    </div>
  )
}

// === 忽略規則分頁 ===

interface IgnoreTabProps {
  locale: ResolvedLocale
  ignore: PluginConfig['ignore']
  onChange: (ignore: Partial<PluginConfig['ignore']>) => void
}

const IgnoreTab: React.FC<IgnoreTabProps> = ({ locale, ignore, onChange }) => {
  const [newPath, setNewPath] = useState('')
  const [newType, setNewType] = useState('')

  const addPath = useCallback(() => {
    const trimmed = newPath.trim()
    if (trimmed && !ignore.paths.includes(trimmed)) {
      onChange({ paths: [...ignore.paths, trimmed] })
      setNewPath('')
    }
  }, [newPath, ignore.paths, onChange])

  const removePath = useCallback(
    (path: string) => {
      onChange({ paths: ignore.paths.filter((p) => p !== path) })
    },
    [ignore.paths, onChange],
  )

  const addType = useCallback(() => {
    const trimmed = newType.trim()
    if (trimmed && !ignore.types.includes(trimmed)) {
      onChange({ types: [...ignore.types, trimmed] })
      setNewType('')
    }
  }, [newType, ignore.types, onChange])

  const removeType = useCallback(
    (type: string) => {
      onChange({ types: ignore.types.filter((t) => t !== type) })
    },
    [ignore.types, onChange],
  )

  return (
    <div className="flex flex-col">
      <div className="rounded-lg border border-cyber-border bg-cyber-bg/35 px-4">
        <div className="space-y-1">
          <FormRow
            label={tx(locale, { 'zh-TW': '忽略路徑', 'zh-CN': '忽略路径', en: 'Ignored Paths' })}
            description={tx(locale, {
              'zh-TW': '不需要分析的檔案路徑模式',
              'zh-CN': '不需要分析的文件路径模式',
              en: 'File path patterns to skip',
            })}
          >
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Input
                  value={newPath}
                  onChange={(e) => setNewPath(e.target.value)}
                  placeholder={tx(locale, {
                    'zh-TW': '例如：node_modules/**',
                    'zh-CN': '例如：node_modules/**',
                    en: 'e.g. node_modules/**',
                  })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addPath()
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={addPath}
                  aria-label={tx(locale, {
                    'zh-TW': '新增忽略路徑',
                    'zh-CN': '新增忽略路径',
                    en: 'Add ignored path',
                  })}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {ignore.paths.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {ignore.paths.map((path) => (
                    <Badge key={path} variant="secondary" className="gap-1 font-mono text-xs">
                      {path}
                      <button
                        type="button"
                        onClick={() => removePath(path)}
                        className="cursor-pointer opacity-60 hover:opacity-100"
                        aria-label={
                          locale === 'en'
                            ? `Remove ${path}`
                            : locale === 'zh-CN'
                              ? `移除 ${path}`
                              : `移除 ${path}`
                        }
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </FormRow>

          <FormRow
            label={tx(locale, {
              'zh-TW': '忽略漏洞類型',
              'zh-CN': '忽略漏洞类型',
              en: 'Ignored Vulnerability Types',
            })}
            description={tx(locale, {
              'zh-TW': '不需要報告的漏洞類型名稱',
              'zh-CN': '不需要报告的漏洞类型名称',
              en: 'Vulnerability type names to suppress',
            })}
          >
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Input
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  placeholder={tx(locale, {
                    'zh-TW': '例如：eval_usage',
                    'zh-CN': '例如：eval_usage',
                    en: 'e.g. eval_usage',
                  })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addType()
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={addType}
                  aria-label={tx(locale, {
                    'zh-TW': '新增忽略類型',
                    'zh-CN': '新增忽略类型',
                    en: 'Add ignored type',
                  })}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {ignore.types.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {ignore.types.map((type) => (
                    <Badge key={type} variant="secondary" className="gap-1 font-mono text-xs">
                      {type}
                      <button
                        type="button"
                        onClick={() => removeType(type)}
                        className="cursor-pointer opacity-60 hover:opacity-100"
                        aria-label={
                          locale === 'en'
                            ? `Remove ${type}`
                            : locale === 'zh-CN'
                              ? `移除 ${type}`
                              : `移除 ${type}`
                        }
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </FormRow>
        </div>
      </div>
    </div>
  )
}

// === API 地址分頁 ===

interface ApiTabProps {
  locale: ResolvedLocale
  api: PluginConfig['api']
  onChange: (api: Partial<PluginConfig['api']>) => void
}

const ApiTab: React.FC<ApiTabProps> = ({ locale, api, onChange }) => (
  <div className="flex flex-col">
    <FormRow
      label={tx(locale, { 'zh-TW': '連線模式', 'zh-CN': '连接模式', en: 'Connection Mode' })}
      description={tx(locale, {
        'zh-TW': '選擇本地開發或遠端伺服器',
        'zh-CN': '选择本地开发或远端服务器',
        en: 'Choose local development or remote server',
      })}
      htmlFor="api-mode"
    >
      <Select
        value={api.mode}
        onValueChange={(v) => onChange({ mode: v as PluginConfig['api']['mode'] })}
      >
        <SelectTrigger id="api-mode" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="local">
            {tx(locale, { 'zh-TW': '本地開發', 'zh-CN': '本地开发', en: 'Local' })}
          </SelectItem>
          <SelectItem value="remote">
            {tx(locale, { 'zh-TW': '遠端伺服器', 'zh-CN': '远端服务器', en: 'Remote' })}
          </SelectItem>
        </SelectContent>
      </Select>
    </FormRow>

    <FormRow
      label={tx(locale, { 'zh-TW': 'API 基礎 URL', 'zh-CN': 'API 基础 URL', en: 'API Base URL' })}
      description={tx(locale, {
        'zh-TW': '後端 API 的連線位址',
        'zh-CN': '后端 API 的连接地址',
        en: 'Backend API endpoint',
      })}
      htmlFor="api-base-url"
    >
      <Input
        id="api-base-url"
        value={api.baseUrl}
        onChange={(e) => onChange({ baseUrl: e.target.value })}
        placeholder="http://localhost:3000"
      />
    </FormRow>
  </div>
)

type ThemeMode = 'light' | 'dark' | 'system'

// === 同步狀態指示器 ===

interface SyncIndicatorProps {
  locale: ResolvedLocale
  phase:
    | 'idle'
    | 'syncing_extension'
    | 'extension_failed'
    | 'syncing_backend'
    | 'backend_failed'
    | 'synced'
  detail?: string | null
}

const SyncIndicator: React.FC<SyncIndicatorProps> = ({ locale, phase, detail }) => {
  if (phase === 'syncing_extension' || phase === 'syncing_backend') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-cyber-primary">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>{getSyncPhaseLabel(phase, locale)}</span>
      </div>
    )
  }

  if (phase === 'synced') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-safe">
        <span className="h-2 w-2 rounded-full bg-safe animate-pulse-glow" />
        <span>{getSyncPhaseLabel(phase, locale)}</span>
      </div>
    )
  }

  if (phase === 'extension_failed' || phase === 'backend_failed') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-severity-medium">
        <span className="h-2 w-2 rounded-full bg-severity-medium" />
        <span>{getSyncPhaseLabel(phase, locale)}</span>
        {detail && (
          <InlineHelp
            ariaLabel={tx(locale, {
              'zh-TW': '查看同步失敗詳情',
              'zh-CN': '查看同步失败详情',
              en: 'View sync failure details',
            })}
            content={{
              title: tx(locale, {
                'zh-TW': '同步失敗詳情',
                'zh-CN': '同步失败详情',
                en: 'Sync Failure Detail',
              }),
              description: detail,
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="h-2 w-2 rounded-full bg-muted-foreground/50" />
      <span>{getSyncPhaseLabel(phase, locale)}</span>
    </div>
  )
}

// === 設定面板主元件 ===

/** 預設配置，用於重置 */
const DEFAULT_CONFIG: PluginConfig = {
  llm: { provider: 'nvidia', apiKey: '' },
  analysis: { triggerMode: 'onSave', depth: 'standard', debounceMs: 500 },
  ignore: { paths: [], types: [] },
  api: { baseUrl: 'http://localhost:3000', mode: 'local' },
  ui: { language: 'auto' },
}

function getErrorDetail(error: unknown, fallback = '未知錯誤'): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return fallback
}

export const SettingsPanel: React.FC = () => {
  const reduceMotion = useReducedMotion()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const config = useConfig()
  const { locale, t, languageOptions } = useI18n()
  const updateConfig = useUpdateConfig()
  const { sendConfigToExtensionAndWait, isInVscodeWebview } = useExtensionBridge({ passive: true })
  const [themeMounted, setThemeMounted] = useState(false)
  const [syncPhase, setSyncPhase] = useState<
    'idle' | 'syncing_extension' | 'extension_failed' | 'syncing_backend' | 'backend_failed' | 'synced'
  >('idle')
  const [syncDetail, setSyncDetail] = useState<string | null>(null)

  useEffect(() => {
    setThemeMounted(true)
  }, [])

  // 掛載時從後端載入配置
  useConfigQuery()

  const saveConfig = useSaveConfig()

  const handleSave = useCallback(async () => {
    if (syncPhase === 'syncing_extension' || syncPhase === 'syncing_backend') return

    if (!isInVscodeWebview) {
      setSyncPhase('syncing_backend')
      setSyncDetail(null)
      try {
        await saveConfig.mutateAsync(config)
        setSyncPhase('synced')
        setSyncDetail(null)
        toast.success(t({ 'zh-TW': '設定已儲存', 'zh-CN': '设置已保存', en: 'Settings saved' }))
        setTimeout(() => {
          setSyncPhase((prev) => (prev === 'synced' ? 'idle' : prev))
        }, 2500)
      } catch (error) {
        const detail = getErrorDetail(
          error,
          t({
            'zh-TW': '後端服務暫時無回應',
            'zh-CN': '后端服务暂时无响应',
            en: 'Backend service is temporarily unavailable',
          }),
        )
        setSyncPhase('backend_failed')
        setSyncDetail(`後端：${detail}`)
        toast.error(
          t({
            'zh-TW': '設定同步失敗，請稍後再試',
            'zh-CN': '设置同步失败，请稍后再试',
            en: 'Failed to sync settings. Please try again later.',
          }),
          {
            description: toMoreInfo(detail, locale),
          },
        )
      }
      return
    }

    setSyncPhase('syncing_extension')
    setSyncDetail(null)
    try {
      const extResult = await sendConfigToExtensionAndWait(config)
      if (!extResult.success) {
        const detail =
          extResult.message?.trim() ||
          t({
            'zh-TW': 'Extension 未回覆同步結果',
            'zh-CN': 'Extension 未返回同步结果',
            en: 'Extension did not return a sync result',
          })
        setSyncPhase('extension_failed')
        setSyncDetail(`Extension：${detail}`)
        toast.error(
          t({
            'zh-TW': '設定同步失敗，請稍後再試',
            'zh-CN': '设置同步失败，请稍后再试',
            en: 'Failed to sync settings. Please try again later.',
          }),
          {
            description: toMoreInfo(detail, locale),
          },
        )
        return
      }
      toast.success(
        t({
          'zh-TW': '設定已套用到編輯器',
          'zh-CN': '设置已应用到编辑器',
          en: 'Settings applied to editor',
        })
      )
    } catch (err) {
      const msg = getErrorDetail(
        err,
        t({
          'zh-TW': 'Extension 未回覆同步結果',
          'zh-CN': 'Extension 未返回同步结果',
          en: 'Extension did not return a sync result',
        }),
      )
      setSyncPhase('extension_failed')
      setSyncDetail(`Extension：${msg}`)
      toast.error(
        t({
          'zh-TW': '設定同步失敗，請稍後再試',
          'zh-CN': '设置同步失败，请稍后再试',
          en: 'Failed to sync settings. Please try again later.',
        }),
        {
          description: toMoreInfo(msg, locale),
        },
      )
      return
    }

    setSyncPhase('syncing_backend')
    setSyncDetail(null)
    try {
      await saveConfig.mutateAsync(config)
      setSyncPhase('synced')
      setSyncDetail(null)
      toast.success(
        t({
          'zh-TW': '設定已完成同步',
          'zh-CN': '设置已完成同步',
          en: 'Settings fully synced',
        }),
      )
      setTimeout(() => {
        setSyncPhase((prev) => (prev === 'synced' ? 'idle' : prev))
      }, 2500)
    } catch (error) {
      const detail = getErrorDetail(
        error,
        t({
          'zh-TW': '後端服務暫時無回應',
          'zh-CN': '后端服务暂时无响应',
          en: 'Backend service is temporarily unavailable',
        }),
      )
      setSyncPhase('backend_failed')
      setSyncDetail(`後端：${detail}`)
      toast.warning(
        t({
          'zh-TW': '設定已套用到編輯器，但完整同步尚未完成',
          'zh-CN': '设置已应用到编辑器，但完整同步尚未完成',
          en: 'Applied in editor, but backend sync is not complete yet',
        }),
        {
          description: toMoreInfo(detail, locale),
        },
      )
    }
  }, [config, isInVscodeWebview, locale, saveConfig, sendConfigToExtensionAndWait, syncPhase, t])

  const handleReset = useCallback(() => {
    updateConfig(DEFAULT_CONFIG)
    setSyncPhase('idle')
    setSyncDetail(null)
    toast.success(
      t({
        'zh-TW': '已重置為預設設定',
        'zh-CN': '已重置为默认设置',
        en: 'Reset to defaults',
      })
    )
  }, [t, updateConfig])

  const handleLlmChange = useCallback(
    (llm: Partial<PluginConfig['llm']>) => updateConfig({ llm }),
    [updateConfig],
  )

  const handleAnalysisChange = useCallback(
    (analysis: Partial<PluginConfig['analysis']>) => updateConfig({ analysis }),
    [updateConfig],
  )

  const handleIgnoreChange = useCallback(
    (ignore: Partial<PluginConfig['ignore']>) => updateConfig({ ignore }),
    [updateConfig],
  )

  const handleApiChange = useCallback(
    (api: Partial<PluginConfig['api']>) => updateConfig({ api }),
    [updateConfig],
  )

  const handleUiChange = useCallback(
    (ui: Partial<PluginConfig['ui']>) => updateConfig({ ui }),
    [updateConfig],
  )

  const handleThemeChange = useCallback(
    (mode: ThemeMode) => {
      setTheme(mode)
      toast.success(
        locale === 'en'
          ? `Switched to ${mode === 'system' ? 'System' : mode === 'dark' ? 'Dark' : 'Light'} theme`
          : locale === 'zh-CN'
            ? `已切换为${mode === 'system' ? '跟随系统' : mode === 'dark' ? '深色' : '浅色'}模式`
            : `已切換為${mode === 'system' ? '跟隨系統' : mode === 'dark' ? '深色' : '淺色'}模式`,
      )
    },
    [locale, setTheme],
  )

  const preferredTheme: ThemeMode = theme === 'light' || theme === 'dark' ? theme : 'system'
  const effectiveTheme: 'light' | 'dark' | undefined =
    themeMounted && (resolvedTheme === 'light' || resolvedTheme === 'dark')
      ? resolvedTheme
      : undefined

  return (
    <TooltipProvider delayDuration={120}>
      <m.div
        className="relative flex h-full flex-col overflow-hidden"
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={
          reduceMotion
            ? { duration: 0 }
            : { duration: 0.24, ease: [0.22, 1, 0.36, 1] }
        }
      >
        {/* 可捲動內容區 */}
        <div className="custom-scrollbar flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6 lg:px-8">
            <h1 className="mb-6 text-2xl font-bold">
              {t({ 'zh-TW': '設定', 'zh-CN': '设置', en: 'Settings' })}
            </h1>

            <div className="mb-4 rounded-lg border border-cyber-border bg-cyber-bg/35 px-4">
              <FormRow
                label={t({ 'zh-TW': '介面語言', 'zh-CN': '界面语言', en: 'Language' })}
                description={t({
                  'zh-TW': '切換 Webview 顯示語言。Auto 會跟隨 VS Code/瀏覽器語言。',
                  'zh-CN': '切换 Webview 显示语言。Auto 会跟随 VS Code/浏览器语言。',
                  en: 'Switch Webview display language. Auto follows VS Code/Browser locale.',
                })}
                htmlFor="ui-language"
              >
                <Select
                  value={config.ui.language}
                  onValueChange={(value) =>
                    handleUiChange({
                      language: value as PluginConfig['ui']['language'],
                    })
                  }
                >
                  <SelectTrigger id="ui-language" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {languageOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormRow>

              <FormRow
                label={t({ 'zh-TW': '主題模式', 'zh-CN': '主题模式', en: 'Theme Mode' })}
                description={t({
                  'zh-TW': '選擇跟隨系統、淺色或深色',
                  'zh-CN': '选择跟随系统、浅色或深色',
                  en: 'Choose system, light, or dark theme',
                })}
                htmlFor="theme-mode"
              >
                <div className="space-y-2">
                  <Select
                    value={preferredTheme}
                    onValueChange={(value) => handleThemeChange(value as ThemeMode)}
                  >
                    <SelectTrigger id="theme-mode" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">
                        {t({ 'zh-TW': '跟隨系統', 'zh-CN': '跟随系统', en: 'System' })}
                      </SelectItem>
                      <SelectItem value="light">
                        {t({ 'zh-TW': '淺色', 'zh-CN': '浅色', en: 'Light' })}
                      </SelectItem>
                      <SelectItem value="dark">
                        {t({ 'zh-TW': '深色', 'zh-CN': '深色', en: 'Dark' })}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="rounded-md border border-cyber-border/60 bg-cyber-bg/40 px-3 py-2 text-xs leading-relaxed text-cyber-textmuted">
                    {t({ 'zh-TW': '目前生效：', 'zh-CN': '当前生效：', en: 'Current:' })}
                    {effectiveTheme === 'dark'
                      ? t({ 'zh-TW': '深色', 'zh-CN': '深色', en: 'Dark' })
                      : t({ 'zh-TW': '淺色', 'zh-CN': '浅色', en: 'Light' })}
                  </p>
                </div>
              </FormRow>
            </div>

            <Tabs defaultValue="llm">
              <TabsList
                className="w-full shrink-0 justify-start gap-1 rounded-lg bg-cyber-surface p-1"
              >
                <TabsTrigger value="llm" className="gap-1.5 text-xs">
                  <Bot className="h-3.5 w-3.5" />
                  LLM
                </TabsTrigger>
                <TabsTrigger value="analysis" className="gap-1.5 text-xs">
                  <ScanLine className="h-3.5 w-3.5" />
                  {t({ 'zh-TW': '觸發', 'zh-CN': '触发', en: 'Trigger' })}
                </TabsTrigger>
                <TabsTrigger value="ignore" className="gap-1.5 text-xs">
                  <ShieldOff className="h-3.5 w-3.5" />
                  {t({ 'zh-TW': '規則', 'zh-CN': '规则', en: 'Rules' })}
                </TabsTrigger>
                <TabsTrigger value="api" className="gap-1.5 text-xs">
                  <Globe className="h-3.5 w-3.5" />
                  API
                </TabsTrigger>
              </TabsList>

              <div className="pb-24">
                <TabsContent value="llm">
                  <LlmTab locale={locale} llm={config.llm} onChange={handleLlmChange} />
                </TabsContent>
                <TabsContent value="analysis">
                  <AnalysisTab
                    locale={locale}
                    analysis={config.analysis}
                    onChange={handleAnalysisChange}
                  />
                </TabsContent>
                <TabsContent value="ignore">
                  <IgnoreTab locale={locale} ignore={config.ignore} onChange={handleIgnoreChange} />
                </TabsContent>
                <TabsContent value="api">
                  <ApiTab locale={locale} api={config.api} onChange={handleApiChange} />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>

        {/* 固定底部儲存列 */}
        <StickyActionBar
          left={<SyncIndicator locale={locale} phase={syncPhase} detail={syncDetail} />}
          right={
            <>
              <Button type="button" variant="outline" size="sm" onClick={handleReset}>
                <RefreshCw className="h-3.5 w-3.5" />
                {t({ 'zh-TW': '重置', 'zh-CN': '重置', en: 'Reset' })}
              </Button>
              <GlowButton
                size="sm"
                onClick={() => {
                  void handleSave()
                }}
                disabled={syncPhase === 'syncing_extension' || syncPhase === 'syncing_backend'}
              >
                <Save className="h-3.5 w-3.5" />
                {syncPhase === 'syncing_extension' || syncPhase === 'syncing_backend'
                  ? t({ 'zh-TW': '同步中…', 'zh-CN': '同步中…', en: 'Syncing…' })
                  : t({ 'zh-TW': '儲存', 'zh-CN': '保存', en: 'Save' })}
              </GlowButton>
            </>
          }
        />
      </m.div>
    </TooltipProvider>
  )
}

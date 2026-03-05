'use client'

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
import React, { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { GlowButton } from '@/components/glow-button'
import { StickyActionBar } from '@/components/sticky-action-bar'
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
import type { PluginConfig } from '@/libs/types'

// === 兩欄表單列元件 ===

interface InlineHelpContent {
  title: string
  description: string
  points?: string[]
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
      className="w-[min(20rem,calc(100vw-2rem))] rounded-lg border-cyber-border bg-cyber-surface2 p-3 text-left text-[11px] leading-relaxed text-cyber-text"
    >
      <span className="block text-[10px] font-black uppercase tracking-wider text-cyber-primary">
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
  llm: PluginConfig['llm']
  onChange: (llm: Partial<PluginConfig['llm']>) => void
}

const LlmTab: React.FC<LlmTabProps> = ({ llm, onChange }) => {
  const [showKey, setShowKey] = useState(false)
  const providerLabel = llm.provider === 'nvidia' ? 'NVIDIA Integrate' : 'Google Gemini'
  const apiKeyPlaceholder = llm.provider === 'nvidia' ? '輸入 NVIDIA API Key…' : '輸入 Gemini API Key…'
  const endpointPlaceholder =
    llm.provider === 'nvidia'
      ? 'https://integrate.api.nvidia.com/v1'
      : 'https://generativelanguage.googleapis.com/v1beta/models'
  const modelPlaceholder =
    llm.provider === 'nvidia' ? 'qwen/qwen2.5-coder-32b-instruct' : 'gemini-3-flash-preview'

  return (
    <div className="flex flex-col">
      <FormRow label="提供商" description="選擇 LLM 服務提供商" htmlFor="llm-provider">
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
        description={`用於驗證 ${providerLabel} API 請求的金鑰`}
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
            aria-label={showKey ? '隱藏 API Key' : '顯示 API Key'}
          >
            {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </FormRow>

      <FormRow
        label="端點"
        description={`自訂 ${providerLabel} API 端點（選填）`}
        htmlFor="llm-endpoint"
      >
        <Input
          id="llm-endpoint"
          value={llm.endpoint ?? ''}
          onChange={(e) => onChange({ endpoint: e.target.value || undefined })}
          placeholder={endpointPlaceholder}
        />
      </FormRow>

      <FormRow label="模型" description="指定使用的模型名稱（選填）" htmlFor="llm-model">
        <Input
          id="llm-model"
          value={llm.model ?? ''}
          onChange={(e) => onChange({ model: e.target.value || undefined })}
          placeholder={modelPlaceholder}
        />
      </FormRow>
    </div>
  )
}

// === 分析觸發分頁 ===

interface AnalysisTabProps {
  analysis: PluginConfig['analysis']
  onChange: (analysis: Partial<PluginConfig['analysis']>) => void
}

const ANALYSIS_DEPTH_META: Record<
  PluginConfig['analysis']['depth'],
  { label: string; hint: string }
> = {
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

const AnalysisTab: React.FC<AnalysisTabProps> = ({ analysis, onChange }) => {
  const currentDepthMeta = ANALYSIS_DEPTH_META[analysis.depth]

  return (
    <div className="flex flex-col">
      <FormRow label="觸發方式" description="設定漏洞分析的觸發時機" htmlFor="trigger-mode">
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
            <SelectItem value="onSave">儲存時自動分析</SelectItem>
            <SelectItem value="manual">手動觸發</SelectItem>
          </SelectContent>
        </Select>
      </FormRow>

      <FormRow
        label="分析深度"
        description="控制掃描的精細程度與耗時"
        htmlFor="analysis-depth"
        labelHelp={
          <InlineHelp
            ariaLabel="分析深度說明"
            content={{
              title: '分析深度怎麼選？',
              description: '深度越高，覆蓋通常越完整，但速度與成本會提高。',
              points: [
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
          <p className="rounded-md border border-cyber-border/60 bg-cyber-bg/40 px-3 py-2 text-[11px] leading-relaxed text-cyber-textmuted">
            {currentDepthMeta.hint}
          </p>
        </div>
      </FormRow>

      <FormRow
        label="Debounce 延遲"
        description="儲存後等待多久才觸發分析（毫秒）"
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
  ignore: PluginConfig['ignore']
  onChange: (ignore: Partial<PluginConfig['ignore']>) => void
}

const IgnoreTab: React.FC<IgnoreTabProps> = ({ ignore, onChange }) => {
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
      <FormRow label="忽略路徑" description="不需要分析的檔案路徑模式">
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="例如：node_modules/**"
              onKeyDown={(e) => {
                if (e.key === 'Enter') addPath()
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={addPath}
              aria-label="新增忽略路徑"
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
                    aria-label={`移除 ${path}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </FormRow>

      <FormRow label="忽略漏洞類型" description="不需要報告的漏洞類型名稱">
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              placeholder="例如：eval_usage"
              onKeyDown={(e) => {
                if (e.key === 'Enter') addType()
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={addType}
              aria-label="新增忽略類型"
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
                    aria-label={`移除 ${type}`}
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
  )
}

// === API 地址分頁 ===

interface ApiTabProps {
  api: PluginConfig['api']
  onChange: (api: Partial<PluginConfig['api']>) => void
}

const ApiTab: React.FC<ApiTabProps> = ({ api, onChange }) => (
  <div className="flex flex-col">
    <FormRow label="連線模式" description="選擇本地開發或遠端伺服器" htmlFor="api-mode">
      <Select
        value={api.mode}
        onValueChange={(v) => onChange({ mode: v as PluginConfig['api']['mode'] })}
      >
        <SelectTrigger id="api-mode" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="local">本地開發</SelectItem>
          <SelectItem value="remote">遠端伺服器</SelectItem>
        </SelectContent>
      </Select>
    </FormRow>

    <FormRow label="API 基礎 URL" description="後端 API 的連線位址" htmlFor="api-base-url">
      <Input
        id="api-base-url"
        value={api.baseUrl}
        onChange={(e) => onChange({ baseUrl: e.target.value })}
        placeholder="http://localhost:3000"
      />
    </FormRow>
  </div>
)

// === 同步狀態指示器 ===

interface SyncIndicatorProps {
  phase:
    | 'idle'
    | 'syncing_extension'
    | 'extension_failed'
    | 'syncing_backend'
    | 'backend_failed'
    | 'synced'
  detail?: string | null
}

const SyncIndicator: React.FC<SyncIndicatorProps> = ({ phase, detail }) => {
  if (phase === 'syncing_extension' || phase === 'syncing_backend') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-cyber-primary">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>設定同步中</span>
      </div>
    )
  }

  if (phase === 'synced') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-safe">
        <span className="h-2 w-2 rounded-full bg-safe animate-pulse-glow" />
        <span>同步成功</span>
      </div>
    )
  }

  if (phase === 'extension_failed' || phase === 'backend_failed') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-severity-medium">
        <span className="h-2 w-2 rounded-full bg-severity-medium" />
        <span>同步失敗</span>
        {detail && (
          <InlineHelp
            ariaLabel="查看同步失敗詳情"
            content={{
              title: '同步失敗詳情',
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
      <span>未儲存</span>
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
}

function getErrorDetail(error: unknown, fallback = '未知錯誤'): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  return fallback
}

export const SettingsPanel: React.FC = () => {
  const config = useConfig()
  const updateConfig = useUpdateConfig()
  const { sendConfigToExtensionAndWait, isInVscodeWebview } = useExtensionBridge({ passive: true })
  const [syncPhase, setSyncPhase] = useState<
    'idle' | 'syncing_extension' | 'extension_failed' | 'syncing_backend' | 'backend_failed' | 'synced'
  >('idle')
  const [syncDetail, setSyncDetail] = useState<string | null>(null)

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
        toast.success('設定已儲存')
        setTimeout(() => {
          setSyncPhase((prev) => (prev === 'synced' ? 'idle' : prev))
        }, 2500)
      } catch (error) {
        const detail = getErrorDetail(error, '後端服務暫時無回應')
        setSyncPhase('backend_failed')
        setSyncDetail(`後端同步失敗：${detail}`)
        toast.error('設定同步失敗，請稍後再試', {
          description: `更多資訊：${detail}`,
        })
      }
      return
    }

    setSyncPhase('syncing_extension')
    setSyncDetail(null)
    try {
      const extResult = await sendConfigToExtensionAndWait(config)
      if (!extResult.success) {
        const detail = extResult.message?.trim() || 'Extension 未回覆同步結果'
        setSyncPhase('extension_failed')
        setSyncDetail(`Extension 套用失敗：${detail}`)
        toast.error('設定同步失敗，請稍後再試', {
          description: `更多資訊：${detail}`,
        })
        return
      }
      toast.success('設定已套用到編輯器')
    } catch (err) {
      const msg = getErrorDetail(err, 'Extension 未回覆同步結果')
      setSyncPhase('extension_failed')
      setSyncDetail(`Extension 套用失敗：${msg}`)
      toast.error('設定同步失敗，請稍後再試', {
        description: `更多資訊：${msg}`,
      })
      return
    }

    setSyncPhase('syncing_backend')
    setSyncDetail(null)
    try {
      await saveConfig.mutateAsync(config)
      setSyncPhase('synced')
      setSyncDetail(null)
      toast.success('設定已完成同步')
      setTimeout(() => {
        setSyncPhase((prev) => (prev === 'synced' ? 'idle' : prev))
      }, 2500)
    } catch (error) {
      const detail = getErrorDetail(error, '後端服務暫時無回應')
      setSyncPhase('backend_failed')
      setSyncDetail(`後端同步失敗：${detail}`)
      toast.warning('設定已套用到編輯器，但完整同步尚未完成', {
        description: `更多資訊：${detail}`,
      })
    }
  }, [config, isInVscodeWebview, saveConfig, sendConfigToExtensionAndWait, syncPhase])

  const handleReset = useCallback(() => {
    updateConfig(DEFAULT_CONFIG)
    setSyncPhase('idle')
    setSyncDetail(null)
    toast.success('已重置為預設設定')
  }, [updateConfig])

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

  return (
    <TooltipProvider delayDuration={120}>
      <div className="relative flex h-full flex-col overflow-hidden">
        {/* 可捲動內容區 */}
        <div className="custom-scrollbar flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6 lg:px-8">
            <h1 className="mb-6 text-2xl font-bold">設定</h1>

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
                  觸發
                </TabsTrigger>
                <TabsTrigger value="ignore" className="gap-1.5 text-xs">
                  <ShieldOff className="h-3.5 w-3.5" />
                  規則
                </TabsTrigger>
                <TabsTrigger value="api" className="gap-1.5 text-xs">
                  <Globe className="h-3.5 w-3.5" />
                  API
                </TabsTrigger>
              </TabsList>

              <div className="pb-24">
                <TabsContent value="llm">
                  <LlmTab llm={config.llm} onChange={handleLlmChange} />
                </TabsContent>
                <TabsContent value="analysis">
                  <AnalysisTab analysis={config.analysis} onChange={handleAnalysisChange} />
                </TabsContent>
                <TabsContent value="ignore">
                  <IgnoreTab ignore={config.ignore} onChange={handleIgnoreChange} />
                </TabsContent>
                <TabsContent value="api">
                  <ApiTab api={config.api} onChange={handleApiChange} />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>

        {/* 固定底部儲存列 */}
        <StickyActionBar
          left={<SyncIndicator phase={syncPhase} detail={syncDetail} />}
          right={
            <>
              <Button type="button" variant="outline" size="sm" onClick={handleReset}>
                <RefreshCw className="h-3.5 w-3.5" />
                重置
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
                  ? '同步中…'
                  : '儲存'}
              </GlowButton>
            </>
          }
        />
      </div>
    </TooltipProvider>
  )
}

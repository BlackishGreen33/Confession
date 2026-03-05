'use client'

import {
  Bot,
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
import { useConfig, useConfigQuery, useSaveConfig, useUpdateConfig } from '@/hooks/use-config'
import { useExtensionBridge } from '@/hooks/use-extension-bridge'
import type { PluginConfig } from '@/libs/types'

// === 兩欄表單列元件 ===

interface FormRowProps {
  label: string
  description?: string
  htmlFor?: string
  children: React.ReactNode
}

/** 兩欄網格列：左側標籤描述、右側輸入控制項 */
const FormRow: React.FC<FormRowProps> = ({ label, description, htmlFor, children }) => (
  <div className="grid grid-cols-[1fr_1.2fr] items-start gap-4 border-b border-border/50 py-4 last:border-b-0">
    <div className="flex flex-col gap-1">
      <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </Label>
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

const AnalysisTab: React.FC<AnalysisTabProps> = ({ analysis, onChange }) => (
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

    <FormRow label="分析深度" description="控制掃描的精細程度與耗時" htmlFor="analysis-depth">
      <Select
        value={analysis.depth}
        onValueChange={(v) => onChange({ depth: v as PluginConfig['analysis']['depth'] })}
      >
        <SelectTrigger id="analysis-depth" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="quick">快速（AST + 條件式 LLM）</SelectItem>
          <SelectItem value="standard">標準（AST + LLM）</SelectItem>
          <SelectItem value="deep">深度（AST + LLM 宏觀掃描）</SelectItem>
        </SelectContent>
      </Select>
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
}

const SyncIndicator: React.FC<SyncIndicatorProps> = ({ phase }) => {
  if (phase === 'syncing_extension') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-cyber-primary">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>同步 Extension 設定…</span>
      </div>
    )
  }

  if (phase === 'syncing_backend') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>同步後端鏡像…</span>
      </div>
    )
  }

  if (phase === 'synced') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-safe">
        <span className="h-2 w-2 rounded-full bg-safe animate-pulse-glow" />
        <span>已同步</span>
      </div>
    )
  }

  if (phase === 'extension_failed') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-severity-critical">
        <span className="h-2 w-2 rounded-full bg-severity-critical" />
        <span>Extension 套用失敗</span>
      </div>
    )
  }

  if (phase === 'backend_failed') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-severity-medium">
        <span className="h-2 w-2 rounded-full bg-severity-medium" />
        <span>後端鏡像失敗</span>
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

export const SettingsPanel: React.FC = () => {
  const config = useConfig()
  const updateConfig = useUpdateConfig()
  const { sendConfigToExtensionAndWait, isInVscodeWebview } = useExtensionBridge({ passive: true })
  const [syncPhase, setSyncPhase] = useState<
    'idle' | 'syncing_extension' | 'extension_failed' | 'syncing_backend' | 'backend_failed' | 'synced'
  >('idle')

  // 掛載時從後端載入配置
  useConfigQuery()

  const saveConfig = useSaveConfig()

  const handleSave = useCallback(async () => {
    if (syncPhase === 'syncing_extension' || syncPhase === 'syncing_backend') return

    if (!isInVscodeWebview) {
      setSyncPhase('syncing_backend')
      try {
        await saveConfig.mutateAsync(config)
        setSyncPhase('synced')
        toast.success('設定已儲存')
        setTimeout(() => {
          setSyncPhase((prev) => (prev === 'synced' ? 'idle' : prev))
        }, 2500)
      } catch {
        setSyncPhase('backend_failed')
        toast.error('儲存設定失敗')
      }
      return
    }

    setSyncPhase('syncing_extension')
    try {
      const extResult = await sendConfigToExtensionAndWait(config)
      if (!extResult.success) {
        setSyncPhase('extension_failed')
        toast.error(extResult.message || 'Extension 設定寫入失敗')
        return
      }
      toast.success(extResult.message || 'Extension 設定已套用')
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知錯誤'
      setSyncPhase('extension_failed')
      toast.error(`Extension 設定寫入失敗：${msg}`)
      return
    }

    setSyncPhase('syncing_backend')
    try {
      await saveConfig.mutateAsync(config)
      setSyncPhase('synced')
      toast.success('設定已完成同步')
      setTimeout(() => {
        setSyncPhase((prev) => (prev === 'synced' ? 'idle' : prev))
      }, 2500)
    } catch {
      setSyncPhase('backend_failed')
      toast.warning('Extension 設定已套用，但後端鏡像失敗')
    }
  }, [config, isInVscodeWebview, saveConfig, sendConfigToExtensionAndWait, syncPhase])

  const handleReset = useCallback(() => {
    updateConfig(DEFAULT_CONFIG)
    setSyncPhase('idle')
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
        left={<SyncIndicator phase={syncPhase} />}
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
              {syncPhase === 'syncing_extension'
                ? '套用 Extension…'
                : syncPhase === 'syncing_backend'
                  ? '同步後端…'
                  : '儲存'}
            </GlowButton>
          </>
        }
      />
    </div>
  )
}

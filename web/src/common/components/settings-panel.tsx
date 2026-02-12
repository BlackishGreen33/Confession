'use client'

import { Eye, EyeOff, Plus, Save, Trash2 } from 'lucide-react'
import React, { useCallback, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useConfig, useConfigQuery, useSaveConfig, useUpdateConfig } from '@/hooks/use-config'
import { useExtensionBridge } from '@/hooks/use-extension-bridge'
import type { PluginConfig } from '@/libs/types'

// === LLM 配置區塊 ===

interface LlmSectionProps {
  llm: PluginConfig['llm']
  onChange: (llm: Partial<PluginConfig['llm']>) => void
}

const LlmSection: React.FC<LlmSectionProps> = ({ llm, onChange }) => {
  const [showKey, setShowKey] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">LLM 配置</CardTitle>
        <CardDescription>設定大型語言模型的連線資訊</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="llm-provider">提供商</Label>
          <Select value={llm.provider} onValueChange={(v) => onChange({ provider: v as 'gemini' })}>
            <SelectTrigger id="llm-provider" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="gemini">Google Gemini</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="llm-api-key">API Key</Label>
          <div className="flex gap-2">
            <Input
              id="llm-api-key"
              type={showKey ? 'text' : 'password'}
              value={llm.apiKey}
              onChange={(e) => onChange({ apiKey: e.target.value })}
              placeholder="輸入 API Key…"
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
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="llm-endpoint">端點（選填）</Label>
          <Input
            id="llm-endpoint"
            value={llm.endpoint ?? ''}
            onChange={(e) => onChange({ endpoint: e.target.value || undefined })}
            placeholder="https://generativelanguage.googleapis.com/v1beta"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="llm-model">模型（選填）</Label>
          <Input
            id="llm-model"
            value={llm.model ?? ''}
            onChange={(e) => onChange({ model: e.target.value || undefined })}
            placeholder="gemini-2.5-flash"
          />
        </div>
      </CardContent>
    </Card>
  )
}

// === 分析觸發區塊 ===

interface AnalysisSectionProps {
  analysis: PluginConfig['analysis']
  onChange: (analysis: Partial<PluginConfig['analysis']>) => void
}

const AnalysisSection: React.FC<AnalysisSectionProps> = ({ analysis, onChange }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">分析觸發</CardTitle>
        <CardDescription>設定漏洞分析的觸發方式與深度</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="trigger-mode">觸發方式</Label>
          <Select
            value={analysis.triggerMode}
            onValueChange={(v) => onChange({ triggerMode: v as PluginConfig['analysis']['triggerMode'] })}
          >
            <SelectTrigger id="trigger-mode" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="onSave">儲存時自動分析</SelectItem>
              <SelectItem value="manual">手動觸發</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="analysis-depth">分析深度</Label>
          <Select
            value={analysis.depth}
            onValueChange={(v) => onChange({ depth: v as PluginConfig['analysis']['depth'] })}
          >
            <SelectTrigger id="analysis-depth" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="quick">快速（僅 AST）</SelectItem>
              <SelectItem value="standard">標準（AST + LLM）</SelectItem>
              <SelectItem value="deep">深度（AST + LLM 宏觀掃描）</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="debounce-ms">Debounce 延遲（毫秒）</Label>
          <Input
            id="debounce-ms"
            type="number"
            min={100}
            max={5000}
            step={100}
            value={analysis.debounceMs}
            onChange={(e) => onChange({ debounceMs: Number(e.target.value) || 500 })}
          />
        </div>
      </CardContent>
    </Card>
  )
}

// === 忽略規則區塊 ===

interface IgnoreSectionProps {
  ignore: PluginConfig['ignore']
  onChange: (ignore: Partial<PluginConfig['ignore']>) => void
}

const IgnoreSection: React.FC<IgnoreSectionProps> = ({ ignore, onChange }) => {
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
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">忽略規則</CardTitle>
        <CardDescription>設定不需要分析的檔案路徑與漏洞類型</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* 忽略路徑 */}
        <div className="flex flex-col gap-1.5">
          <Label>忽略路徑</Label>
          <div className="flex gap-2">
            <Input
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder="例如：node_modules/**"
              onKeyDown={(e) => {
                if (e.key === 'Enter') addPath()
              }}
            />
            <Button type="button" variant="outline" size="icon" onClick={addPath} aria-label="新增忽略路徑">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {ignore.paths.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
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

        {/* 忽略漏洞類型 */}
        <div className="flex flex-col gap-1.5">
          <Label>忽略漏洞類型</Label>
          <div className="flex gap-2">
            <Input
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              placeholder="例如：eval_usage"
              onKeyDown={(e) => {
                if (e.key === 'Enter') addType()
              }}
            />
            <Button type="button" variant="outline" size="icon" onClick={addType} aria-label="新增忽略類型">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          {ignore.types.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
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
      </CardContent>
    </Card>
  )
}

// === API 地址區塊 ===

interface ApiSectionProps {
  api: PluginConfig['api']
  onChange: (api: Partial<PluginConfig['api']>) => void
}

const ApiSection: React.FC<ApiSectionProps> = ({ api, onChange }) => {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">API 地址</CardTitle>
        <CardDescription>設定後端 API 的連線模式與位址</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="api-mode">連線模式</Label>
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
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="api-base-url">API 基礎 URL</Label>
          <Input
            id="api-base-url"
            value={api.baseUrl}
            onChange={(e) => onChange({ baseUrl: e.target.value })}
            placeholder="http://localhost:3000"
          />
        </div>
      </CardContent>
    </Card>
  )
}

// === 設定面板主元件 ===

export const SettingsPanel: React.FC = () => {
  const config = useConfig()
  const updateConfig = useUpdateConfig()
  const { sendConfigToExtension } = useExtensionBridge()
  const [saved, setSaved] = useState(false)

  // 掛載時從後端載入配置
  useConfigQuery()

  const saveConfig = useSaveConfig()

  const handleSave = useCallback(() => {
    // 寫入後端資料庫
    saveConfig.mutate(config)
    // 同步到 VS Code settings.json（若在 webview 內）
    sendConfigToExtension(config)
    setSaved(true)
    const timer = setTimeout(() => setSaved(false), 2000)
    return () => clearTimeout(timer)
  }, [config, saveConfig, sendConfigToExtension])

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
    <div className="flex flex-col gap-6">
      <LlmSection llm={config.llm} onChange={handleLlmChange} />
      <AnalysisSection analysis={config.analysis} onChange={handleAnalysisChange} />
      <IgnoreSection ignore={config.ignore} onChange={handleIgnoreChange} />
      <ApiSection api={config.api} onChange={handleApiChange} />

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saveConfig.isPending}>
          <Save className="h-4 w-4" />
          {saveConfig.isPending ? '儲存中…' : saved ? '已儲存' : '儲存設定'}
        </Button>
        {saved && <span className="text-safe text-sm">設定已更新</span>}
      </div>
    </div>
  )
}

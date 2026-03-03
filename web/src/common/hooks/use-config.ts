'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'

import { api } from '@/libs/api-client'
import { configAtom } from '@/libs/atoms'
import type { PluginConfig } from '@/libs/types'

// 從 atoms.ts 重新匯出，保持同檔共置慣例
export { configAtom } from '@/libs/atoms'

// === Hooks ===

/** 讀取完整配置（單一來源：全域 configAtom） */
export function useConfig() {
  return useAtomValue(configAtom)
}

/** 配置的深層部分更新型別 */
type DeepPartialConfig = {
  [K in keyof PluginConfig]?: Partial<PluginConfig[K]>
}

/** 更新配置（部分更新，自動合併） */
export function useUpdateConfig() {
  const setConfig = useSetAtom(configAtom)

  return (partial: DeepPartialConfig) => {
    setConfig((prev) => ({
      ...prev,
      ...partial,
      llm: { ...prev.llm, ...partial.llm },
      analysis: { ...prev.analysis, ...partial.analysis },
      ignore: { ...prev.ignore, ...partial.ignore },
      api: { ...prev.api, ...partial.api },
    }))
  }
}

/** LLM 是否已設定 API Key */
export function useIsLlmConfigured() {
  const config = useConfig()
  return config.llm.apiKey.length > 0
}

/** 目前 API 模式（local / remote） */
export function useApiMode() {
  const config = useConfig()
  return config.api.mode
}

// === React Query：後端配置持久化 ===

const CONFIG_QUERY_KEY = ['config'] as const

function isInVscodeWebview(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent !== window
  } catch {
    return false
  }
}

/** 從後端載入配置並同步到 configAtom */
export function useConfigQuery() {
  const setConfig = useSetAtom(configAtom)

  const query = useQuery<PluginConfig>({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: async () => {
      const res = await api.get<PluginConfig>('/api/config')
      return res.data
    },
    staleTime: Infinity,
  })

  // 後端資料載入後同步到 configAtom
  useEffect(() => {
    // 在 VS Code Webview 模式下以 Extension settings 為主來源，避免被後端舊值覆蓋
    if (query.data && !isInVscodeWebview()) {
      setConfig(query.data)
    }
  }, [query.data, setConfig])

  return query
}

/** 儲存配置到後端 */
export function useSaveConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (config: PluginConfig) => {
      const res = await api.put<PluginConfig>('/api/config', config)
      return res.data
    },
    onSuccess: (data) => {
      queryClient.setQueryData(CONFIG_QUERY_KEY, data)
    },
  })
}

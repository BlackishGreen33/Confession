'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { molecule, useMolecule } from 'bunshi/react'
import { atom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect } from 'react'

import { api } from '@/libs/api-client'
import type { PluginConfig } from '@/libs/types'

// 從 atoms.ts 重新匯出，保持同檔共置慣例
export { configAtom } from '@/libs/atoms'

// === Bunshi Molecule ===

/** 配置 molecule — 提供 configAtom 及衍生 atoms 的作用域封裝 */
export const configMolecule = molecule(() => {
  const configAtom = atom<PluginConfig>({
    llm: { provider: 'gemini', apiKey: '' },
    analysis: { triggerMode: 'onSave', depth: 'standard', debounceMs: 500 },
    ignore: { paths: [], types: [] },
    api: { baseUrl: 'http://localhost:3000', mode: 'local' },
  })

  /** 衍生 atom：LLM 是否已設定 API Key */
  const isLlmConfiguredAtom = atom((get) => {
    const config = get(configAtom)
    return config.llm.apiKey.length > 0
  })

  /** 衍生 atom：目前 API 模式 */
  const apiModeAtom = atom((get) => get(configAtom).api.mode)

  return {
    configAtom,
    isLlmConfiguredAtom,
    apiModeAtom,
  }
})

// === Hooks ===

/** 讀取完整配置（從全域 configAtom） */
export function useConfig() {
  const { configAtom } = useMolecule(configMolecule)
  return useAtomValue(configAtom)
}

/** 配置的深層部分更新型別 */
type DeepPartialConfig = {
  [K in keyof PluginConfig]?: Partial<PluginConfig[K]>
}

/** 更新配置（部分更新，自動合併） */
export function useUpdateConfig() {
  const { configAtom } = useMolecule(configMolecule)
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
  const { isLlmConfiguredAtom } = useMolecule(configMolecule)
  return useAtomValue(isLlmConfiguredAtom)
}

/** 目前 API 模式（local / remote） */
export function useApiMode() {
  const { apiModeAtom } = useMolecule(configMolecule)
  return useAtomValue(apiModeAtom)
}

// === React Query：後端配置持久化 ===

const CONFIG_QUERY_KEY = ['config'] as const

/** 從後端載入配置並同步到 Jotai atom */
export function useConfigQuery() {
  const { configAtom } = useMolecule(configMolecule)
  const setConfig = useSetAtom(configAtom)

  const query = useQuery<PluginConfig>({
    queryKey: CONFIG_QUERY_KEY,
    queryFn: async () => {
      const res = await api.get<PluginConfig>('/api/config')
      return res.data
    },
    staleTime: Infinity,
  })

  // 後端資料載入後同步到 Jotai atom
  useEffect(() => {
    if (query.data) {
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

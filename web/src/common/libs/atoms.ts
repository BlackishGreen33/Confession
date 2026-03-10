'use client'

import { atom } from 'jotai'

import type { PluginConfig, Vulnerability, VulnerabilityFilterPreset } from './types'

// === 漏洞相關 ===

/** 當前選中的漏洞 ID */
export const selectedVulnIdAtom = atom<string | null>(null)

/** 當前漏洞詳情資料（由 Extension Bridge 透過 postMessage 寫入） */
export const vulnerabilityDetailAtom = atom<Vulnerability | null>(null)


/** 漏洞列表篩選條件 */
export const vulnFiltersAtom = atom<{
  status?: Vulnerability['status']
  severity?: Vulnerability['severity']
  search: string
}>({ search: '' })

export const vulnerabilityPresetAtom = atom<{
  preset: VulnerabilityFilterPreset
  sourceRequestId?: string
  appliedAt: string
} | null>(null)

// === 掃描相關 ===

/** 掃描進度狀態 */
export const scanStatusAtom = atom<{
  isScanning: boolean
  progress: number
  message: string
}>({ isScanning: false, progress: 0, message: '' })

// === 配置相關 ===

/** 插件配置（預設值） */
export const configAtom = atom<PluginConfig>({
  llm: {
    provider: 'nvidia',
    apiKey: '',
  },
  analysis: {
    triggerMode: 'onSave',
    depth: 'standard',
    debounceMs: 500,
  },
  ignore: {
    paths: [],
    types: [],
  },
  api: {
    baseUrl: 'http://localhost:3000',
    mode: 'local',
  },
  ui: {
    language: 'auto',
  },
})

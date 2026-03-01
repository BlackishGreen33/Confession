import type { PluginConfig } from '@/libs/types'

import {
  callGemini,
  configFromEnv as geminiConfigFromEnv,
  configFromPlugin as geminiConfigFromPlugin,
  DEFAULT_GEMINI_MODEL,
} from './gemini'
import {
  callNvidia,
  configFromEnv as nvidiaConfigFromEnv,
  configFromPlugin as nvidiaConfigFromPlugin,
  DEFAULT_NVIDIA_MODEL,
} from './nvidia'

export type LlmProvider = PluginConfig['llm']['provider']

/** 統一 LLM 客戶端設定 */
export interface LlmClientConfig {
  provider: LlmProvider
  apiKey: string
  endpoint?: string
  model?: string
}

/** 統一 LLM Token 用量 */
export interface LlmUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** 統一 LLM 呼叫結果 */
export interface LlmCallResult {
  text: string
  usage: LlmUsage
}

export const DEFAULT_LLM_PROVIDER: LlmProvider = 'nvidia'

/** 取得指定 provider 的預設模型 */
export function resolveDefaultModel(provider: LlmProvider): string {
  return provider === 'gemini' ? DEFAULT_GEMINI_MODEL : DEFAULT_NVIDIA_MODEL
}

/**
 * 從 PluginConfig 建立統一 LLM 設定。
 * 規則：優先使用 config.apiKey，無值時才回退到對應 provider 的環境變數。
 */
export function configFromPlugin(config: PluginConfig['llm']): LlmClientConfig {
  if (config.provider === 'gemini') {
    return {
      provider: 'gemini',
      ...geminiConfigFromPlugin(config),
    }
  }

  return {
    provider: 'nvidia',
    ...nvidiaConfigFromPlugin(config),
  }
}

/**
 * 從環境變數建立統一 LLM 設定。
 * 未指定 provider 時，預設使用 NVIDIA。
 */
export function configFromEnv(provider: LlmProvider = DEFAULT_LLM_PROVIDER): LlmClientConfig {
  if (provider === 'gemini') {
    return {
      provider,
      ...geminiConfigFromEnv(),
    }
  }

  return {
    provider,
    ...nvidiaConfigFromEnv(),
  }
}

/** 依 provider 路由到對應實作 */
export async function callLlm(prompt: string, config: LlmClientConfig): Promise<LlmCallResult> {
  if (config.provider === 'gemini') {
    return callGemini(prompt, config)
  }

  return callNvidia(prompt, config)
}

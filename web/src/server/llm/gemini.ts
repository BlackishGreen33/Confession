import type { PluginConfig } from '@/libs/types'

/** Gemini API 回應結構（僅擷取需要的欄位） */
interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>
    }
  }>
  error?: { message: string; code: number }
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
}

/** Gemini 客戶端設定 */
export interface GeminiClientConfig {
  apiKey: string
  /** 自訂端點（不含 model path），預設為 Google 官方 */
  endpoint?: string
  /** 模型名稱，預設 gemini-3-flash-preview */
  model?: string
}

/** Gemini Token 用量 */
export interface GeminiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** Gemini 呼叫結果 */
export interface GeminiCallResult {
  text: string
  usage: GeminiUsage
}

const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_MODEL = 'gemini-3-flash-preview'

/**
 * 從 PluginConfig 建立 GeminiClientConfig。
 * apiKey 優先使用 config 傳入值，fallback 到環境變數 GEMINI_API_KEY。
 */
export function configFromPlugin(config: PluginConfig['llm']): GeminiClientConfig {
  return {
    apiKey: config.apiKey || process.env.GEMINI_API_KEY || '',
    endpoint: config.endpoint,
    model: config.model,
  }
}

/**
 * 從環境變數建立預設 GeminiClientConfig。
 * 適用於後端 agent 直接呼叫，不需要前端傳入完整 config 的場景。
 */
export function configFromEnv(): GeminiClientConfig {
  return {
    apiKey: process.env.GEMINI_API_KEY || '',
  }
}

/**
 * 呼叫 Gemini generateContent API，回傳原始文字。
 * 使用 JSON 回應模式 + 低溫度（0.1）以取得穩定的結構化輸出。
 */
export async function callGemini(prompt: string, config: GeminiClientConfig): Promise<GeminiCallResult> {
  const { apiKey, endpoint = DEFAULT_ENDPOINT, model = DEFAULT_MODEL } = config

  if (!apiKey) {
    throw new Error('Gemini API key 未設定')
  }

  const url = `${endpoint}/${model}:generateContent?key=${apiKey}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    }),
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as GeminiResponse | null
    const msg = body?.error?.message ?? `HTTP ${res.status}`
    throw new Error(`Gemini API 錯誤 (HTTP ${res.status})：${msg}`)
  }

  const data = (await res.json()) as GeminiResponse

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (text === undefined || text === null) {
    throw new Error('Gemini API 回應中無有效文字')
  }

  return {
    text,
    usage: {
      promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
    },
  }
}

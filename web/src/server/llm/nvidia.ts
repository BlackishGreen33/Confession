import type { PluginConfig } from '@/libs/types'

/** NVIDIA 相容 OpenAI Chat Completions API 回應（僅擷取必要欄位） */
interface NvidiaResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>
      reasoning_content?: string
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  error?: {
    message?: string
    type?: string
    code?: string | number
  }
}

type NvidiaMessageContent = string | Array<{ type?: string; text?: string }> | undefined

/** NVIDIA 客戶端設定 */
export interface NvidiaClientConfig {
  apiKey: string
  /** 自訂端點（不含 /chat/completions），預設為 NVIDIA Integrate */
  endpoint?: string
  /** 模型名稱，預設 qwen/qwen2.5-coder-32b-instruct */
  model?: string
}

/** NVIDIA Token 用量 */
export interface NvidiaUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** NVIDIA 呼叫結果 */
export interface NvidiaCallResult {
  text: string
  usage: NvidiaUsage
}

const DEFAULT_ENDPOINT = 'https://integrate.api.nvidia.com/v1'
export const DEFAULT_NVIDIA_MODEL = 'qwen/qwen2.5-coder-32b-instruct'

/**
 * 從 PluginConfig 建立 NvidiaClientConfig。
 * apiKey 優先使用 config 傳入值，fallback 到環境變數 NVIDIA_API_KEY。
 */
export function configFromPlugin(config: PluginConfig['llm']): NvidiaClientConfig {
  return {
    apiKey: config.apiKey || process.env.NVIDIA_API_KEY || '',
    endpoint: config.endpoint,
    model: config.model,
  }
}

/**
 * 從環境變數建立預設 NvidiaClientConfig。
 * 適用於後端 agent 直接呼叫，不需要前端傳入完整 config 的場景。
 */
export function configFromEnv(): NvidiaClientConfig {
  return {
    apiKey: process.env.NVIDIA_API_KEY || '',
  }
}

/**
 * 呼叫 NVIDIA OpenAI 相容 Chat Completions API，回傳原始文字。
 * 使用低溫度（0.1）以提高結構化輸出的穩定性。
 */
export async function callNvidia(prompt: string, config: NvidiaClientConfig): Promise<NvidiaCallResult> {
  const { apiKey, endpoint = DEFAULT_ENDPOINT, model = DEFAULT_NVIDIA_MODEL } = config

  if (!apiKey) {
    throw new Error('NVIDIA API key 未設定')
  }

  const url = `${endpoint.replace(/\/+$/, '')}/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      top_p: 0.7,
      max_tokens: 4096,
      stream: false,
    }),
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as NvidiaResponse | null
    const msg = body?.error?.message ?? `HTTP ${res.status}`
    throw new Error(`NVIDIA API 錯誤 (HTTP ${res.status})：${msg}`)
  }

  const data = (await res.json()) as NvidiaResponse

  const choice = data.choices?.[0]?.message
  const text = extractMessageText(choice?.content) ?? choice?.reasoning_content
  if (!text) {
    throw new Error('NVIDIA API 回應中無有效文字')
  }

  return {
    text,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      totalTokens: data.usage?.total_tokens ?? 0,
    },
  }
}

function extractMessageText(content: NvidiaMessageContent): string | undefined {
  if (typeof content === 'string') {
    const trimmed = content.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  if (!Array.isArray(content)) return undefined

  const text = content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim()

  return text.length > 0 ? text : undefined
}

import type { PluginConfig } from '@/libs/types';

/** MiniMax CN OpenAI 相容 Chat Completions API 回應（僅擷取必要欄位） */
interface MiniMaxCnResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      reasoning_content?: string;
      reasoning_details?: Array<{ text?: string }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
  };
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
}

type MiniMaxCnMessageContent =
  | string
  | Array<{ type?: string; text?: string }>
  | undefined;

/** MiniMax CN 客戶端設定 */
export interface MiniMaxCnClientConfig {
  apiKey: string;
  /** 自訂端點（不含 /chat/completions），預設為 MiniMax CN */
  endpoint?: string;
  /** 模型名稱，預設 MiniMax-M2.7 */
  model?: string;
}

/** MiniMax CN Token 用量 */
export interface MiniMaxCnUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** MiniMax CN 呼叫結果 */
export interface MiniMaxCnCallResult {
  text: string;
  usage: MiniMaxCnUsage;
}

type FetchSignal = NonNullable<Parameters<typeof fetch>[1]>['signal'];

export interface MiniMaxCnCallOptions {
  signal?: FetchSignal;
}

const DEFAULT_ENDPOINT = 'https://api.minimaxi.com/v1';
export const DEFAULT_MINIMAX_CN_MODEL = 'MiniMax-M2.7';

/**
 * 從 PluginConfig 建立 MiniMaxCnClientConfig。
 * apiKey 優先使用 config 傳入值，fallback 到 MiniMax 專用環境變數。
 */
export function configFromPlugin(
  config: PluginConfig['llm']
): MiniMaxCnClientConfig {
  return {
    apiKey:
      config.apiKey ||
      process.env.MINIMAX_CN_API_KEY ||
      process.env.MINIMAX_API_KEY ||
      '',
    endpoint:
      config.endpoint ||
      process.env.MINIMAX_CN_ENDPOINT ||
      process.env.MINIMAX_ENDPOINT,
    model:
      config.model || process.env.MINIMAX_CN_MODEL || process.env.MINIMAX_MODEL,
  };
}

/**
 * 從環境變數建立預設 MiniMaxCnClientConfig。
 * 適用於後端 agent 直接呼叫，不需要前端傳入完整 config 的場景。
 */
export function configFromEnv(): MiniMaxCnClientConfig {
  return {
    apiKey: process.env.MINIMAX_CN_API_KEY || process.env.MINIMAX_API_KEY || '',
    endpoint: process.env.MINIMAX_CN_ENDPOINT || process.env.MINIMAX_ENDPOINT,
    model: process.env.MINIMAX_CN_MODEL || process.env.MINIMAX_MODEL,
  };
}

/**
 * 呼叫 MiniMax CN OpenAI 相容 Chat Completions API，回傳原始文字。
 * 使用 reasoning_split 避免思考內容混入 JSON 主回應。
 */
export async function callMiniMaxCn(
  prompt: string,
  config: MiniMaxCnClientConfig,
  options: MiniMaxCnCallOptions = {}
): Promise<MiniMaxCnCallResult> {
  const {
    apiKey,
    endpoint = DEFAULT_ENDPOINT,
    model = DEFAULT_MINIMAX_CN_MODEL,
  } = config;

  if (!apiKey) {
    throw new Error('MiniMax CN API key 未設定');
  }

  const url = `${endpoint.replace(/\/+$/, '')}/chat/completions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    signal: options.signal,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      top_p: 0.7,
      max_completion_tokens: 2048,
      stream: false,
      reasoning_split: true,
    }),
  });

  const data = (await res.json().catch(() => null)) as MiniMaxCnResponse | null;

  if (!res.ok) {
    const msg =
      data?.error?.message ??
      data?.base_resp?.status_msg ??
      `HTTP ${res.status}`;
    throw new Error(`MiniMax CN API 錯誤 (HTTP ${res.status})：${msg}`);
  }

  if (
    data?.base_resp?.status_code !== undefined &&
    data.base_resp.status_code !== 0
  ) {
    const msg = data.base_resp.status_msg ?? 'unknown error';
    throw new Error(`MiniMax CN API 錯誤：${msg}`);
  }

  const choice = data?.choices?.[0]?.message;
  const text = stripThinkTags(extractMessageText(choice?.content));
  if (!text) {
    throw new Error('MiniMax CN API 回應中無有效文字');
  }

  return {
    text,
    usage: {
      promptTokens: data?.usage?.prompt_tokens ?? 0,
      completionTokens: data?.usage?.completion_tokens ?? 0,
      totalTokens: data?.usage?.total_tokens ?? 0,
    },
  };
}

function extractMessageText(
  content: MiniMaxCnMessageContent
): string | undefined {
  if (typeof content === 'string') {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (!Array.isArray(content)) return undefined;

  const text = content
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  return text.length > 0 ? text : undefined;
}

function stripThinkTags(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const stripped = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  return stripped.length > 0 ? stripped : undefined;
}

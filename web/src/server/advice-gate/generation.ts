import { z } from 'zod/v4'

import type { HealthResponseV2 } from '@/libs/types'

import { computeLlmPromptFingerprint, llmResponseCache } from '../cache'
import {
  callLlm,
  configFromEnv,
  type LlmCallResult,
  type LlmClientConfig,
  resolveDefaultModel,
} from '../llm/client'
import { computeAdviceMetricsFingerprint } from './scoring'
import {
  ADVICE_SOURCE_EVENTS,
  type AdviceActionItem,
  type AdviceBlockedReason,
  type AdvicePayload,
  type AdviceSourceEvent,
  type AdviceTriggerMetrics,
} from './types'

const ADVICE_LLM_TIMEOUT_MS = 30_000
const ADVICE_PROMPT_VERSION = 'advice-v1'

const adviceResponseSchema = z.object({
  summary: z.string().min(8).max(280),
  confidence: z.number().min(0).max(1),
  actions: z
    .array(
      z.object({
        title: z.string().min(4).max(40),
        reason: z.string().min(8).max(180),
        expectedImpact: z.string().min(4).max(120),
      }),
    )
    .length(3),
})

const storedActionsSchema = z.array(
  z.object({
    title: z.string(),
    reason: z.string(),
    expectedImpact: z.string(),
  }),
)

export async function generateAdvicePayload(input: {
  sourceEvent: AdviceSourceEvent
  triggerScore: number
  triggerReason: string
  metrics: AdviceTriggerMetrics
  health: HealthResponseV2
  llmConfig?: LlmClientConfig
}): Promise<AdvicePayload> {
  const config = input.llmConfig ?? configFromEnv()
  const modelName = config.model ?? resolveDefaultModel(config.provider)
  const prompt = buildAdvicePrompt(input)
  const key = computeLlmPromptFingerprint(prompt, modelName, 'standard', {
    strategyVersion: ADVICE_PROMPT_VERSION,
    engineMode: 'baseline',
    agentRole: 'advice',
    contextDigest: computeAdviceMetricsFingerprint(input.metrics),
  })

  const cached = llmResponseCache.get(key)
  const rawText = cached?.text ?? (await callLlmWithTimeout(prompt, config)).text

  if (!cached) {
    llmResponseCache.set(key, {
      text: rawText,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    })
  }

  const parsed = parseAdviceResponse(rawText)
  if (!parsed) {
    throw new Error('AI 建議解析失敗，略過覆蓋既有建議')
  }

  return parsed
}

export function parseStoredActions(value: string | undefined): AdviceActionItem[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    const result = storedActionsSchema.safeParse(parsed)
    return result.success ? result.data : []
  } catch {
    return []
  }
}

export function normalizeSourceEvent(
  value: string | undefined,
): AdviceSourceEvent | null {
  if (!value) return null
  return (ADVICE_SOURCE_EVENTS as readonly string[]).includes(value)
    ? (value as AdviceSourceEvent)
    : null
}

export function normalizeBlockedReason(
  value: string | null | undefined,
): AdviceBlockedReason | null {
  if (!value) return null
  if (value === 'threshold_not_met') return value
  if (value === 'cooldown_active') return value
  if (value === 'same_fingerprint') return value
  if (value === 'daily_limit_reached') return value
  return null
}

function buildAdvicePrompt(input: {
  sourceEvent: AdviceSourceEvent
  triggerScore: number
  triggerReason: string
  metrics: AdviceTriggerMetrics
  health: HealthResponseV2
}): string {
  const factors = input.health.score.topFactors
    .map((item) => `- ${item.label}(${item.valueText})：${item.reason}`)
    .join('\n')

  return [
    '你是 Confession 的資安決策助理。',
    '請依據輸入指標輸出「下一步三件事」給工程團隊。',
    '只回傳 JSON，禁止額外說明。',
    '',
    '回傳 JSON Schema：',
    '{',
    '  "summary": "一句重點（繁體中文）",',
    '  "confidence": 0.0,',
    '  "actions": [',
    '    {"title": "行動標題", "reason": "為何現在做", "expectedImpact": "預期影響"},',
    '    {"title": "行動標題", "reason": "為何現在做", "expectedImpact": "預期影響"},',
    '    {"title": "行動標題", "reason": "為何現在做", "expectedImpact": "預期影響"}',
    '  ]',
    '}',
    '',
    '規則：',
    '- action 只能 3 項，依優先度由高到低。',
    '- summary 需可直接放進 Dashboard。',
    '- confidence 範圍 0..1。',
    '- 不得建議背景輪詢或連續觸發模型。',
    '',
    '事件：',
    `- sourceEvent: ${input.sourceEvent}`,
    `- triggerScore: ${input.triggerScore}`,
    `- triggerReason: ${input.triggerReason}`,
    '',
    '指標快照：',
    `- healthScore: ${input.metrics.healthScore.toFixed(1)}`,
    `- reliabilityScore: ${input.metrics.reliabilityScore.toFixed(1)}`,
    `- fallbackRate: ${(input.metrics.fallbackRate * 100).toFixed(1)}%`,
    `- openCount: ${input.metrics.openCount}`,
    `- criticalOpenCount: ${input.metrics.criticalOpenCount}`,
    `- highOpenCount: ${input.metrics.highOpenCount}`,
    `- pendingOpenCount: ${input.metrics.pendingOpenCount}`,
    `- highRiskMix: ${(input.metrics.highRiskMix * 100).toFixed(1)}%`,
    `- pendingReviewPressure: ${(input.metrics.pendingReviewPressure * 100).toFixed(1)}%`,
    `- trendPressureHigh: ${input.metrics.trendPressureHigh ? 'true' : 'false'}`,
    `- openNet7d: ${input.metrics.openNet7d}`,
    '',
    'Top Factors：',
    factors || '- 無',
  ].join('\n')
}

function parseAdviceResponse(raw: string): AdvicePayload | null {
  const cleaned = stripCodeFence(raw)
  try {
    const parsed = JSON.parse(cleaned)
    const result = adviceResponseSchema.safeParse(parsed)
    if (!result.success) return null
    return result.data
  } catch {
    return null
  }
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const match = /^```(?:\w+)?\s*\n([\s\S]*?)\n\s*```$/.exec(trimmed)
  return match ? match[1] : trimmed
}

async function callLlmWithTimeout(
  prompt: string,
  config: LlmClientConfig,
): Promise<LlmCallResult> {
  const abortController = new globalThis.AbortController()
  let timer: ReturnType<typeof setTimeout> | null = null

  try {
    timer = setTimeout(() => abortController.abort(), ADVICE_LLM_TIMEOUT_MS)
    return await callLlm(prompt, config, { signal: abortController.signal })
  } catch (err) {
    if (isAbortError(err)) {
      throw new Error('AI 建議生成逾時')
    }
    throw err
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function isAbortError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'name' in err &&
      (err as { name?: unknown }).name === 'AbortError',
  )
}

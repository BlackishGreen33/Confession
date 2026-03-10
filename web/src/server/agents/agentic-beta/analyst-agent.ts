import { computeLlmPromptFingerprint, llmResponseCache } from '@server/cache'
import type { LlmCallResult, LlmClientConfig } from '@server/llm/client'
import { callLlm, configFromEnv, resolveDefaultModel } from '@server/llm/client'
import { parseLlmResponse } from '@server/llm/parser'
import type { VulnerabilityInput } from '@server/storage'

import type { ScanRequest } from '@/libs/types'

import type { AnalystResult, ContextBundle, PlannerPlan, SkillExecutionRecord } from './types'

const LLM_TIMEOUT_MS = 45_000
const RETRY_BASE_DELAY_MS = 1_000

export interface AnalystOptions {
  llmConfig?: LlmClientConfig
  depth: ScanRequest['depth']
  maxRetryAttempts: number
}

export async function runAnalyst(
  bundle: ContextBundle,
  plan: PlannerPlan,
  skills: SkillExecutionRecord[],
  options: AnalystOptions,
): Promise<AnalystResult> {
  const config = options.llmConfig ?? configFromEnv()
  const modelName = config.model ?? resolveDefaultModel(config.provider)
  const prompt = buildAnalystPrompt(bundle, plan, skills, options.depth)
  const key = computeLlmPromptFingerprint(prompt, modelName, options.depth, {
    strategyVersion: 'agentic-beta-v1',
    engineMode: 'agentic_beta',
    agentRole: 'analyst',
    contextDigest: bundle.contentDigest,
  })

  const cached = llmResponseCache.get(key)
  if (cached) {
    const parsed = parseLlmResponse(cached.text)
    return {
      candidates: parsed ? parsed.map((item) => toInput(item, bundle, modelName)) : [],
      usage: cached.usage,
      cacheHit: true,
      parseFailed: !parsed,
    }
  }

  const result = await callLlmWithRetry(prompt, config, options.maxRetryAttempts)
  llmResponseCache.set(key, { text: result.text, usage: result.usage })

  const parsed = parseLlmResponse(result.text)
  if (!parsed) {
    return {
      candidates: [],
      usage: result.usage,
      cacheHit: false,
      parseFailed: true,
    }
  }

  return {
    candidates: parsed.map((item) => toInput(item, bundle, modelName)),
    usage: result.usage,
    cacheHit: false,
    parseFailed: false,
  }
}

function buildAnalystPrompt(
  bundle: ContextBundle,
  plan: PlannerPlan,
  skills: SkillExecutionRecord[],
  depth: ScanRequest['depth'],
): string {
  const hypothesisText = plan.hypotheses.length > 0 ? plan.hypotheses.join('\n- ') : '（無）'
  const hotspotText =
    bundle.hotspots.length > 0
      ? bundle.hotspots
          .map(
            (point, index) =>
              `${index + 1}. ${point.type} ${point.patternName} @ ${point.line}:${point.column} confidence=${point.confidence}`,
          )
          .join('\n')
      : '（無）'

  const skillText = skills
    .map((record) => {
      const evidence = record.evidence.slice(0, 8).join(' | ')
      return `${record.skillName}: success=${record.success} confidence=${record.confidence} evidence=${evidence}`
    })
    .join('\n')

  const contextText = bundle.contextBlocks
    .slice(0, depth === 'quick' ? 2 : depth === 'standard' ? 4 : 6)
    .map(
      (block) =>
        `### ${block.id} (${block.startLine}-${block.endLine})\n${'```'}${bundle.language}\n${block.content}\n${'```'}`,
    )
    .join('\n\n')

  return `你是資安審計 Analyst Agent，請只依靜態證據輸出漏洞。\n\n## 分析規則\n- 不可執行程式碼\n- 每個漏洞至少要能對應一段可定位證據\n- 嚴格輸出 JSON 陣列\n- 無漏洞輸出 []\n- confidence 必須是 0..1\n\n## 檔案資訊\n- filePath: ${bundle.filePath}\n- language: ${bundle.language}\n- depth: ${depth}\n\n## 假設\n- ${hypothesisText}\n\n## AST Hotspots\n${hotspotText}\n\n## Skills\n${skillText}\n\n## Context Blocks\n${contextText}\n\n## JSON 欄位\n[{\n  "type": "string",\n  "cweId": "string|null",\n  "severity": "critical|high|medium|low|info",\n  "description": "string",\n  "riskDescription": "string|null",\n  "line": 1,\n  "column": 1,\n  "endLine": 1,\n  "endColumn": 1,\n  "fixOldCode": "string|null",\n  "fixNewCode": "string|null",\n  "fixExplanation": "string|null",\n  "confidence": 0.0,\n  "reasoning": "string"\n}]`
}

function toInput(
  vuln: {
    line: number
    column: number
    endLine: number
    endColumn: number
    type: string
    cweId: string | null
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
    description: string
    riskDescription?: string | null
    fixOldCode?: string | null
    fixNewCode?: string | null
    fixExplanation?: string | null
    confidence: number
    reasoning: string
  },
  bundle: ContextBundle,
  modelName: string,
): VulnerabilityInput {
  return {
    filePath: bundle.filePath,
    line: vuln.line,
    column: vuln.column,
    endLine: vuln.endLine,
    endColumn: vuln.endColumn,
    codeSnippet: extractSnippet(bundle.content, vuln.line, vuln.endLine),
    type: vuln.type,
    cweId: vuln.cweId,
    severity: vuln.severity,
    description: vuln.description,
    riskDescription: vuln.riskDescription ?? null,
    fixOldCode: vuln.fixOldCode ?? null,
    fixNewCode: vuln.fixNewCode ?? null,
    fixExplanation: vuln.fixExplanation ?? null,
    aiModel: modelName,
    aiConfidence: vuln.confidence,
    aiReasoning: vuln.reasoning,
  }
}

function extractSnippet(content: string, startLine: number, endLine: number): string {
  const lines = content.split('\n')
  const from = Math.max(1, startLine)
  const to = Math.max(from, endLine)
  return lines.slice(from - 1, to).join('\n').trim()
}

async function callLlmWithRetry(
  prompt: string,
  config: LlmClientConfig,
  maxRetryAttempts: number,
): Promise<LlmCallResult> {
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetryAttempts; attempt += 1) {
    try {
      return await callLlmWithTimeout(prompt, config)
    } catch (err) {
      lastError = err
      if (attempt >= maxRetryAttempts || !isRetryableLlmError(err)) {
        throw err
      }
      await sleep(RETRY_BASE_DELAY_MS * (attempt + 1))
    }
  }

  throw (lastError instanceof Error ? lastError : new Error('Analyst LLM 呼叫失敗'))
}

async function callLlmWithTimeout(
  prompt: string,
  config: LlmClientConfig,
): Promise<LlmCallResult> {
  const abortController = new globalThis.AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  try {
    timer = setTimeout(() => {
      abortController.abort()
    }, LLM_TIMEOUT_MS)
    return await callLlm(prompt, config, { signal: abortController.signal })
  } catch (err) {
    if (isAbortError(err)) {
      throw new Error('LLM 呼叫逾時')
    }
    throw err
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function isRetryableLlmError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('LLM 呼叫逾時')) return true
  if (/\b503\b/.test(msg)) return true
  if (msg.includes('UNAVAILABLE')) return true
  if (/high demand/i.test(msg)) return true
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAbortError(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === 'object' &&
      'name' in err &&
      (err as { name?: unknown }).name === 'AbortError',
  )
}

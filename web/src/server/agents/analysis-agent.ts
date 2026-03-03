import { computeLlmPromptFingerprint, llmResponseCache } from '@server/cache'
import type { VulnerabilityInput } from '@server/db'
import type { LlmCallResult, LlmClientConfig } from '@server/llm/client'
import { callLlm, configFromEnv, resolveDefaultModel } from '@server/llm/client'
import type { LlmVulnerability } from '@server/llm/parser'
import { parseLlmResponse } from '@server/llm/parser'
import {
  buildBatchAnalysisPrompt,
  buildDeepFileScanPrompt,
  type PromptContextBlock,
  type PromptInteractionPoint,
} from '@server/llm/prompts'

import type { InteractionPoint, ScanRequest } from '@/libs/types'

/** 檔案內容對照表，用於建構 Prompt 時取得檔案內容 */
export type FileContentMap = Map<string, { content: string; language: string }>

/** Analysis Agent 設定 */
export interface AnalysisAgentOptions {
  /** LLM 客戶端設定，未提供時從環境變數取得 */
  llmConfig?: LlmClientConfig
  /** 分析深度 */
  depth: ScanRequest['depth']
  /** 是否啟用 deep 宏觀掃描 */
  includeMacroScan: boolean
  /** 暫時性失敗的重試次數（不含首次請求） */
  maxRetryAttempts?: number
}

/** LLM 用量統計 */
export interface LlmUsageStats {
  requestCount: number
  cacheHits: number
  promptTokens: number
  completionTokens: number
  totalTokens: number
  skippedByPolicy: number
  processedFiles: number
  successfulFiles: number
  requestFailures: number
  parseFailures: number
  failureKinds: {
    quotaExceeded: number
    unavailable: number
    timeout: number
    other: number
  }
}

/** Analysis Agent 回傳值 */
export interface AnalyzeWithLlmResult {
  vulnerabilities: VulnerabilityInput[]
  stats: LlmUsageStats
}

const LLM_TIMEOUT_MS = 45_000
const LLM_RETRY_BASE_DELAY_MS = 1_000

const MAX_POINTS_BY_DEPTH: Record<ScanRequest['depth'], number> = {
  quick: 8,
  standard: 14,
  deep: 24,
}

const CONTEXT_WINDOW_LINES: Record<ScanRequest['depth'], number> = {
  quick: 6,
  standard: 12,
  deep: 16,
}

const HIGH_RISK_AST_TYPES = new Set<InteractionPoint['type']>([
  'dangerous_call',
  'unsafe_pattern',
  'prototype_mutation',
])

const CONFIDENCE_WEIGHT: Record<InteractionPoint['confidence'], number> = {
  high: 3,
  medium: 2,
  low: 1,
}

/**
 * Analysis Agent：依檔案聚合交互點後呼叫 LLM。
 * - quick：僅高風險 AST 點（條件式）
 * - standard：每檔案一次聚合分析（上下文區塊）
 * - deep：每檔案一次完整掃描（保留全檔）
 */
export async function analyzeWithLlm(
  points: InteractionPoint[],
  fileContents: FileContentMap,
  options: AnalysisAgentOptions,
): Promise<AnalyzeWithLlmResult> {
  const config = options.llmConfig ?? configFromEnv()
  const modelName = config.model ?? resolveDefaultModel(config.provider)
  const maxRetryAttempts = Math.max(0, options.maxRetryAttempts ?? 0)
  const stats = createEmptyStats()
  const results: VulnerabilityInput[] = []
  const grouped = groupPointsByFile(points)

  for (const [filePath, file] of fileContents) {
    const filePoints = grouped.get(filePath) ?? []
    const selected = selectPointsForDepth(filePoints, options.depth)
    stats.skippedByPolicy += filePoints.length - selected.length

    const shouldRunDeepFullScan = options.depth === 'deep' && options.includeMacroScan
    const shouldRunBatch = selected.length > 0

    if (!shouldRunDeepFullScan && !shouldRunBatch) continue

    const prompt = shouldRunDeepFullScan
      ? buildDeepFileScanPrompt(
          filePath,
          file.content,
          file.language,
          options.depth,
          toPromptPoints(selected),
        )
      : buildBatchAnalysisPrompt(
          filePath,
          file.language,
          options.depth,
          toPromptPoints(selected),
          buildContextBlocks(file.content, selected, CONTEXT_WINDOW_LINES[options.depth]),
        )

    stats.processedFiles += 1

    try {
      const raw = await callLlmWithCache(
        prompt,
        config,
        modelName,
        options.depth,
        maxRetryAttempts,
        stats,
      )
      const parsed = parseLlmResponse(raw)
      if (!parsed) {
        stats.parseFailures += 1
        continue
      }

      stats.successfulFiles += 1

      for (const vuln of deduplicateLlmVulns(parsed)) {
        results.push(llmVulnToInput(vuln, filePath, modelName))
      }
    } catch (err) {
      // LLM 呼叫失敗時先記錄錯誤，再跳過該檔案，不中斷整體流程
      stats.requestFailures += 1
      accumulateFailureKind(stats, err)
      continue
    }
  }

  return { vulnerabilities: results, stats }
}

function groupPointsByFile(points: InteractionPoint[]): Map<string, InteractionPoint[]> {
  const grouped = new Map<string, InteractionPoint[]>()
  for (const point of points) {
    const existing = grouped.get(point.filePath) ?? []
    existing.push(point)
    grouped.set(point.filePath, existing)
  }
  return grouped
}

function selectPointsForDepth(
  points: InteractionPoint[],
  depth: ScanRequest['depth'],
): InteractionPoint[] {
  if (points.length === 0) return []

  if (depth === 'quick') {
    return points
      .filter(isHighRiskAstPoint)
      .sort((a, b) => scorePoint(b) - scorePoint(a))
      .slice(0, MAX_POINTS_BY_DEPTH.quick)
  }

  return points
    .slice()
    .sort((a, b) => scorePoint(b) - scorePoint(a))
    .slice(0, MAX_POINTS_BY_DEPTH[depth])
}

function isHighRiskAstPoint(point: InteractionPoint): boolean {
  return (
    HIGH_RISK_AST_TYPES.has(point.type) &&
    point.confidence === 'high' &&
    !point.patternName.startsWith('keyword_')
  )
}

function scorePoint(point: InteractionPoint): number {
  const confidence = CONFIDENCE_WEIGHT[point.confidence]
  if (isHighRiskAstPoint(point)) return 1000 + confidence
  if (!point.patternName.startsWith('keyword_')) return 600 + confidence
  return 100 + confidence
}

function toPromptPoints(points: InteractionPoint[]): PromptInteractionPoint[] {
  return points.map((point) => ({
    type: point.type,
    patternName: point.patternName,
    confidence: point.confidence,
    line: point.line,
    column: point.column,
    codeSnippet: normalizeSnippet(point.codeSnippet),
  }))
}

function buildContextBlocks(
  fileContent: string,
  points: InteractionPoint[],
  windowLines: number,
): PromptContextBlock[] {
  const lines = fileContent.split('\n')
  if (lines.length === 0 || points.length === 0) return []

  const ranges = points
    .map((point) => ({
      start: Math.max(1, point.line - windowLines),
      end: Math.min(lines.length, point.endLine + windowLines),
    }))
    .sort((a, b) => a.start - b.start)

  const merged: Array<{ start: number; end: number }> = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (!last || range.start > last.end + 1) {
      merged.push({ ...range })
      continue
    }
    last.end = Math.max(last.end, range.end)
  }

  return merged.map((range) => {
    const content = lines
      .slice(range.start - 1, range.end)
      .map((line, index) => {
        const lineNo = range.start + index
        return `${lineNo}|${line}`
      })
      .join('\n')

    return {
      startLine: range.start,
      endLine: range.end,
      content,
    }
  })
}

async function callLlmWithCache(
  prompt: string,
  config: LlmClientConfig,
  modelName: string,
  depth: ScanRequest['depth'],
  maxRetryAttempts: number,
  stats: LlmUsageStats,
): Promise<string> {
  const key = computeLlmPromptFingerprint(prompt, modelName, depth)
  const cached = llmResponseCache.get(key)
  if (cached) {
    stats.cacheHits += 1
    return cached.text
  }

  const result = await callLlmWithRetry(prompt, config, maxRetryAttempts)
  stats.requestCount += 1
  stats.promptTokens += result.usage.promptTokens
  stats.completionTokens += result.usage.completionTokens
  stats.totalTokens += result.usage.totalTokens

  llmResponseCache.set(key, {
    text: result.text,
    usage: result.usage,
  })

  return result.text
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

      await sleep(LLM_RETRY_BASE_DELAY_MS * (attempt + 1))
    }
  }

  throw (lastError instanceof Error ? lastError : new Error('LLM 呼叫失敗'))
}

async function callLlmWithTimeout(
  prompt: string,
  config: LlmClientConfig,
): Promise<LlmCallResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      callLlm(prompt, config),
      new Promise<LlmCallResult>((_, reject) => {
        timer = setTimeout(() => reject(new Error('LLM 呼叫逾時')), LLM_TIMEOUT_MS)
      }),
    ])
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

function accumulateFailureKind(stats: LlmUsageStats, err: unknown): void {
  const kind = classifyLlmError(err)
  stats.failureKinds[kind] += 1
}

function classifyLlmError(err: unknown): 'quotaExceeded' | 'unavailable' | 'timeout' | 'other' {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (msg.includes('resource_exhausted') || msg.includes('quota exceeded') || /\b429\b/.test(msg)) {
    return 'quotaExceeded'
  }
  if (msg.includes('llm 呼叫逾時') || msg.includes('timeout')) {
    return 'timeout'
  }
  if (msg.includes('unavailable') || /\b503\b/.test(msg) || msg.includes('high demand')) {
    return 'unavailable'
  }
  return 'other'
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function normalizeSnippet(code: string): string {
  const squashed = code.replace(/\s+/g, ' ').trim()
  if (squashed.length <= 140) return squashed
  return `${squashed.slice(0, 137)}...`
}

function deduplicateLlmVulns(vulns: LlmVulnerability[]): LlmVulnerability[] {
  const map = new Map<string, LlmVulnerability>()
  for (const vuln of vulns) {
    const key = `${vuln.line}:${vuln.column}:${vuln.endLine}:${vuln.endColumn}:${vuln.type}`
    map.set(key, vuln)
  }
  return Array.from(map.values())
}

function createEmptyStats(): LlmUsageStats {
  return {
    requestCount: 0,
    cacheHits: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    skippedByPolicy: 0,
    processedFiles: 0,
    successfulFiles: 0,
    requestFailures: 0,
    parseFailures: 0,
    failureKinds: {
      quotaExceeded: 0,
      unavailable: 0,
      timeout: 0,
      other: 0,
    },
  }
}

/**
 * 將 LLM 解析結果轉換為 VulnerabilityInput。
 * 補充 filePath 和 AI 歸因欄位。
 */
function llmVulnToInput(vuln: LlmVulnerability, filePath: string, modelName: string): VulnerabilityInput {
  return {
    filePath,
    line: vuln.line,
    column: vuln.column,
    endLine: vuln.endLine,
    endColumn: vuln.endColumn,
    codeSnippet: vuln.fixOldCode ?? '',
    type: vuln.type,
    cweId: vuln.cweId ?? null,
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

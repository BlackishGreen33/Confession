import type { ScanEngineMode } from '@/libs/types'

interface LlmFailureKindsLike {
  quotaExceeded: number
  unavailable: number
  timeout: number
  other: number
}

interface LlmStatsLike {
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
  lastErrorMessage?: string | null
  failureKinds: LlmFailureKindsLike
}

interface EngineExecutionResultLike {
  llmStats: LlmStatsLike
  agenticTrace?: unknown[]
}

export function logLlmUsage(
  taskId: string,
  engineMode: ScanEngineMode,
  depth: 'quick' | 'standard' | 'deep',
  result: EngineExecutionResultLike,
): void {
  process.stdout.write(
    `[Confession][LLMUsage] ${JSON.stringify({
      taskId,
      engineMode,
      depth,
      requestCount: result.llmStats.requestCount,
      cacheHits: result.llmStats.cacheHits,
      promptTokens: result.llmStats.promptTokens,
      completionTokens: result.llmStats.completionTokens,
      totalTokens: result.llmStats.totalTokens,
      skippedByPolicy: result.llmStats.skippedByPolicy,
      processedFiles: result.llmStats.processedFiles,
      successfulFiles: result.llmStats.successfulFiles,
      requestFailures: result.llmStats.requestFailures,
      parseFailures: result.llmStats.parseFailures,
      lastErrorMessage: result.llmStats.lastErrorMessage ?? null,
      failureKinds: result.llmStats.failureKinds,
      agenticTraceCount:
        Array.isArray(result.agenticTrace) ? result.agenticTrace.length : 0,
    })}\n`,
  )

  if (Array.isArray(result.agenticTrace)) {
    process.stdout.write(
      `[Confession][AgenticTrace] ${JSON.stringify({
        taskId,
        engineMode,
        traces: result.agenticTrace,
      })}\n`,
    )
  }
}

export function isLlmAnalysisFailed(stats: {
  processedFiles: number
  successfulFiles: number
  requestFailures: number
  parseFailures: number
}): boolean {
  if (stats.processedFiles === 0) return false
  if (stats.successfulFiles > 0) return false
  return stats.requestFailures > 0 || stats.parseFailures > 0
}

export function buildLlmFailureMessage(stats: {
  requestFailures: number
  parseFailures: number
  lastErrorMessage?: string
  failureKinds: LlmFailureKindsLike
}): string {
  if (stats.failureKinds.quotaExceeded > 0) {
    return 'LLM 分析失敗：配額已用盡（429/RESOURCE_EXHAUSTED），請稍後重試或更換 API Key/方案'
  }

  const actionableRootCause = resolveActionableLlmFailureRootCause(
    stats.lastErrorMessage,
  )
  if (actionableRootCause) {
    return `LLM 分析失敗：${actionableRootCause}`
  }

  const parts: string[] = []
  if (stats.failureKinds.unavailable > 0) {
    parts.push(`服務暫時不可用 ${stats.failureKinds.unavailable} 次`)
  }
  if (stats.failureKinds.timeout > 0) {
    parts.push(`請求逾時 ${stats.failureKinds.timeout} 次`)
  }
  if (stats.failureKinds.other > 0) {
    parts.push(`其他錯誤 ${stats.failureKinds.other} 次`)
  }
  if (stats.requestFailures > 0) {
    parts.push(`LLM 呼叫失敗 ${stats.requestFailures} 次`)
  }
  if (stats.parseFailures > 0) {
    parts.push(`LLM 回應解析失敗 ${stats.parseFailures} 次`)
  }
  if (parts.length === 0) return 'LLM 分析失敗'
  return `LLM 分析失敗：${parts.join('，')}`
}

function resolveActionableLlmFailureRootCause(
  value: string | undefined,
): string | null {
  if (typeof value !== 'string') return null
  const message = value.trim()
  if (message.length === 0) return null

  if (message.includes('API key 未設定')) {
    return message
  }

  const lower = message.toLowerCase()
  const isAuthFailed =
    /\b401\b/.test(lower) ||
    /\b403\b/.test(lower) ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid_api_key')

  if (isAuthFailed) {
    return 'API Key 驗證失敗（401/403），請確認 provider 與 API Key 是否有效'
  }

  const isModelOrEndpointNotFound =
    /\b404\b/.test(lower) &&
    (lower.includes('model') ||
      lower.includes('endpoint') ||
      lower.includes('not found'))
  if (isModelOrEndpointNotFound) {
    return '模型或端點不存在（404），請檢查 model / endpoint 設定'
  }

  return null
}

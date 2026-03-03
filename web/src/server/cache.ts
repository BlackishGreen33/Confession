import { createHash } from 'crypto'

/**
 * 通用 TTL 快取
 *
 * 用於掃描結果快取與請求去重，避免重複分析未變更的檔案。
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

/** LLM 快取項目 */
export interface LlmCacheValue {
  text: string
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>()
  private readonly defaultTtlMs: number

  constructor(defaultTtlMs = 5 * 60 * 1000) {
    this.defaultTtlMs = defaultTtlMs
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.defaultTtlMs),
    })
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  delete(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }

  /** 清除所有過期項目 */
  prune(): void {
    const now = Date.now()
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key)
    }
  }

  get size(): number {
    this.prune()
    return this.store.size
  }
}

/**
 * 計算檔案內容雜湊（SHA-256），用於增量分析判斷檔案是否變更。
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * 計算掃描請求指紋，用於請求去重。
 * 以所有檔案路徑 + 內容雜湊 + depth 組合產生唯一鍵。
 */
export function computeScanFingerprint(
  files: Array<{ path: string; content: string }>,
  depth: string,
  forceRescan = false,
  engineMode = 'baseline',
): string {
  const parts = files
    .map((f) => `${f.path}:${computeContentHash(f.content)}`)
    .sort()
    .join('|')
  return createHash('sha256')
    .update(`${parts}::${depth}::force=${forceRescan ? 1 : 0}::engine=${engineMode}`)
    .digest('hex')
}

/**
 * 計算 LLM Prompt 指紋。
 * 策略版本納入 key，避免 Prompt 結構調整後誤命中舊快取。
 */
export function computeLlmPromptFingerprint(
  prompt: string,
  modelName: string,
  depth: string,
  options: {
    strategyVersion?: string
    engineMode?: 'baseline' | 'agentic_beta'
    agentRole?: string
    contextDigest?: string
  } = {},
): string {
  const {
    strategyVersion = 'v2',
    engineMode = 'baseline',
    agentRole = 'analysis',
    contextDigest = '',
  } = options
  return createHash('sha256')
    .update(`${strategyVersion}::${engineMode}::${agentRole}::${contextDigest}::${modelName}::${depth}::${prompt}`)
    .digest('hex')
}

// === 全域快取實例 ===

/** 檔案分析結果快取：key = filePath:contentHash，value = 是否已分析（5 分鐘 TTL） */
export const fileAnalysisCache = new TtlCache<boolean>(5 * 60 * 1000)

/** 進行中的掃描任務去重：key = scanFingerprint，value = taskId（10 分鐘 TTL） */
export const inflightScans = new TtlCache<string>(10 * 60 * 1000)

/** LLM 回應快取：key = llmPromptFingerprint，value = LLM 文字回應（30 分鐘 TTL） */
export const llmResponseCache = new TtlCache<LlmCacheValue>(30 * 60 * 1000)

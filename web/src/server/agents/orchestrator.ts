import { buildFileAnalysisCacheKey, computeContentHash, fileAnalysisCache } from '@server/cache'
import type { VulnerabilityInput } from '@server/db'
import { upsertVulnerabilities } from '@server/db'
import {
  hydrateFileAnalysisCacheFromDisk,
  persistFileAnalysisCacheToDisk,
  recordAnalyzedFile,
} from '@server/file-analysis-cache-store'
import type { LlmClientConfig } from '@server/llm/client'

import type { ScanRequest } from '@/libs/types'

import type { FileContentMap } from './analysis-agent'
import type { LlmUsageStats } from './analysis-agent'
import { analyzeWithLlm } from './analysis-agent'
import { analyzeGoFiles } from './go-agent'
import { analyzeJsTsFiles } from './jsts-agent'

/** 掃描結果摘要 */
export interface ScanSummary {
  totalFiles: number
  totalVulnerabilities: number
  bySeverity: Record<string, number>
  byLanguage: Record<string, number>
}

/** orchestrate 回傳值 */
export interface OrchestrateResult {
  vulnerabilities: VulnerabilityInput[]
  summary: ScanSummary
  llmStats: LlmUsageStats
}

export interface OrchestrateOptions {
  llmConfig?: LlmClientConfig
  onFilteredFiles?: (meta: { totalFiles: number; changedFiles: number }) => Promise<void> | void
  onFileCompleted?: (filePath: string) => Promise<void> | void
  assertNotCanceled?: () => void
}

/**
 * Orchestrator：接收掃描請求，按語言分組並行調度 Agent，
 * 合併交互點後交由 LLM 分析，最後冪等存儲漏洞記錄。
 *
 * 增量分析：透過檔案內容雜湊快取，跳過未變更的檔案。
 */
export async function orchestrate(
  request: ScanRequest,
  options: OrchestrateOptions = {},
): Promise<OrchestrateResult> {
  options.assertNotCanceled?.()
  await hydrateFileAnalysisCacheFromDisk()
  options.assertNotCanceled?.()
  const retryAttempts = resolveRetryAttempts(request)
  const maxParallelFiles = resolveBaselineParallelFiles(request)

  // 增量分析：過濾掉內容未變更的檔案
  const changedFiles = request.forceRescan ? request.files : filterChangedFiles(request.files)
  options.assertNotCanceled?.()
  await notifyFilteredFiles(options.onFilteredFiles, request.files.length, changedFiles.length)

  if (changedFiles.length === 0) {
    return {
      vulnerabilities: [],
      summary: buildSummary([], request.files),
      llmStats: {
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
      },
    }
  }

  const { go, jsts } = groupByLanguage(changedFiles)
  options.assertNotCanceled?.()

  // 並行調度語言 Agent
  const [goPoints, jstsPoints] = await Promise.all([
    go.length > 0 ? analyzeGoFiles(go.map((f) => ({ path: f.path, content: f.content }))) : [],
    jsts.length > 0
      ? analyzeJsTsFiles(
          jsts.map((f) => ({
            path: f.path,
            content: f.content,
            language: f.language as 'javascript' | 'typescript',
          })),
        )
      : [],
  ])

  const allPoints = [...goPoints, ...jstsPoints]
  options.assertNotCanceled?.()

  // 建構檔案內容對照表供 Analysis Agent 使用
  const fileContents: FileContentMap = new Map()
  for (const file of changedFiles) {
    options.assertNotCanceled?.()
    fileContents.set(file.path, { content: file.content, language: file.language })
  }

  // LLM 深度分析
  const analysisResult = await analyzeWithLlm(allPoints, fileContents, {
    depth: request.depth,
    scanScope: request.scanScope,
    includeMacroScan: request.includeLlmScan ?? false,
    maxParallelFiles,
    maxRetryAttempts: retryAttempts,
    llmConfig: options.llmConfig,
    onFileCompleted: options.onFileCompleted,
    assertNotCanceled: options.assertNotCanceled,
  })
  const vulns = analysisResult.vulnerabilities

  options.assertNotCanceled?.()
  // 冪等存儲
  await upsertVulnerabilities(vulns)

  // 標記已分析的檔案
  for (const file of changedFiles) {
    options.assertNotCanceled?.()
    const hash = computeContentHash(file.content)
    recordAnalyzedFile(file.path, hash)
  }

  try {
    await persistFileAnalysisCacheToDisk()
  } catch {
    // 快取持久化失敗不應影響掃描主流程
  }

  return {
    vulnerabilities: vulns,
    summary: buildSummary(vulns, request.files),
    llmStats: analysisResult.stats,
  }
}

function resolveRetryAttempts(request: ScanRequest): number {
  const scope =
    request.scanScope ?? (request.files.length > 1 ? 'workspace' : 'file')
  return scope === 'workspace' ? 1 : 0
}

function resolveBaselineParallelFiles(request: ScanRequest): number {
  const scope = request.scanScope ?? (request.files.length > 1 ? 'workspace' : 'file')
  if (scope !== 'workspace') return 1

  switch (request.depth) {
    case 'quick':
      return 6
    case 'standard':
      return 4
    case 'deep':
      return 2
  }
}

/**
 * 增量分析：過濾掉內容未變更的檔案（快取命中 = 已分析過相同內容）。
 */
function filterChangedFiles(files: ScanRequest['files']): ScanRequest['files'] {
  return files.filter((f) => {
    const hash = computeContentHash(f.content)
    return !fileAnalysisCache.has(buildFileAnalysisCacheKey(f.path, hash))
  })
}

/**
 * 按語言分組檔案：Go 歸 Go Agent，JS/TS 歸 JS/TS Agent。
 */
export function groupByLanguage(files: ScanRequest['files']) {
  return {
    go: files.filter((f) => f.language === 'go'),
    jsts: files.filter((f) => ['javascript', 'typescript'].includes(f.language)),
  }
}

/** 建構掃描結果摘要 */
function buildSummary(
  vulns: VulnerabilityInput[],
  files: ScanRequest['files'],
): ScanSummary {
  const bySeverity: Record<string, number> = {}
  const byLanguage: Record<string, number> = {}
  const languageByFilePath = new Map(files.map((file) => [file.path, file.language]))

  for (const v of vulns) {
    bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1

    const lang = languageByFilePath.get(v.filePath) ?? 'unknown'
    byLanguage[lang] = (byLanguage[lang] ?? 0) + 1
  }

  return {
    totalFiles: files.length,
    totalVulnerabilities: vulns.length,
    bySeverity,
    byLanguage,
  }
}

async function notifyFilteredFiles(
  callback: OrchestrateOptions['onFilteredFiles'],
  totalFiles: number,
  changedFiles: number,
): Promise<void> {
  if (!callback) return
  try {
    await callback({ totalFiles, changedFiles })
  } catch {
    // 進度通知失敗不應中斷主要掃描流程
  }
}

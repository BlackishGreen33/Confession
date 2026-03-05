import { computeContentHash, fileAnalysisCache } from '@server/cache'
import type { VulnerabilityInput } from '@server/db'
import { upsertVulnerabilities } from '@server/db'
import type { LlmClientConfig } from '@server/llm/client'

import type { ScanRequest } from '@/libs/types'

import type { LlmUsageStats } from '../analysis-agent'
import { analyzeGoFiles } from '../go-agent'
import { analyzeJsTsFiles } from '../jsts-agent'
import { runAnalyst } from './analyst-agent'
import { buildContextBundle } from './context-bundle'
import { runCritic } from './critic-agent'
import { runJudge } from './judge-agent'
import { planForContext } from './planner-agent'
import { runSkillPlan } from './skill-runner'
import type { AgenticTraceSummary } from './types'

export interface AgenticOrchestrateOptions {
  llmConfig?: LlmClientConfig
  onFilteredFiles?: (meta: { totalFiles: number; changedFiles: number }) => Promise<void> | void
  onFileCompleted?: (filePath: string) => Promise<void> | void
  assertNotCanceled?: () => void
}

export interface AgenticOrchestrateResult {
  vulnerabilities: VulnerabilityInput[]
  summary: {
    totalFiles: number
    totalVulnerabilities: number
    bySeverity: Record<string, number>
    byLanguage: Record<string, number>
  }
  llmStats: LlmUsageStats
  agenticTrace: AgenticTraceSummary[]
}

const MIN_PARALLEL_FILES = 1
const MAX_PARALLEL_BY_DEPTH_WORKSPACE: Record<ScanRequest['depth'], number> = {
  quick: 3,
  standard: 2,
  deep: 1,
}

/**
 * Agentic Beta Orchestrator：
 * AST/關鍵詞 -> ContextBundle -> Planner -> SkillRunner(+MCP) -> Analyst -> Critic -> Judge。
 */
export async function orchestrateAgenticBeta(
  request: ScanRequest,
  options: AgenticOrchestrateOptions = {},
): Promise<AgenticOrchestrateResult> {
  options.assertNotCanceled?.()
  const maxRetryAttempts = resolveRetryAttempts(request)
  const changedFiles = request.forceRescan ? request.files : filterChangedFiles(request.files)
  options.assertNotCanceled?.()
  await notifyFilteredFiles(options.onFilteredFiles, request.files.length, changedFiles.length)

  if (changedFiles.length === 0) {
    return {
      vulnerabilities: [],
      summary: buildSummary([], request.files),
      llmStats: createEmptyStats(),
      agenticTrace: [],
    }
  }

  const { go, jsts } = groupByLanguage(changedFiles)
  options.assertNotCanceled?.()
  const [goPoints, jstsPoints] = await Promise.all([
    go.length > 0 ? analyzeGoFiles(go.map((file) => ({ path: file.path, content: file.content }))) : [],
    jsts.length > 0
      ? analyzeJsTsFiles(
          jsts.map((file) => ({
            path: file.path,
            content: file.content,
            language: file.language as 'javascript' | 'typescript',
          })),
        )
      : [],
  ])

  const allPoints = [...goPoints, ...jstsPoints]
  options.assertNotCanceled?.()
  const pointsByFile = new Map<string, typeof allPoints>()

  for (const point of allPoints) {
    options.assertNotCanceled?.()
    const list = pointsByFile.get(point.filePath) ?? []
    list.push(point)
    pointsByFile.set(point.filePath, list)
  }

  const llmStats = createEmptyStats()
  const traces: AgenticTraceSummary[] = []
  const finalVulns: VulnerabilityInput[] = []
  let currentParallel = resolveParallelFiles(request)
  let transientFailureStreak = 0

  let cursor = 0
  while (cursor < changedFiles.length) {
    options.assertNotCanceled?.()
    const batch = changedFiles.slice(cursor, cursor + currentParallel)
    const outcomes = await Promise.all(
      batch.map(async (file) => {
        options.assertNotCanceled?.()
        let transientFailure = false
        try {
          const filePoints = pointsByFile.get(file.path) ?? []
          const bundle = buildContextBundle(file.path, file.language, file.content, filePoints, request.depth)
          llmStats.skippedByPolicy += Math.max(0, filePoints.length - bundle.hotspots.length)
          llmStats.processedFiles += 1

          const plan = planForContext(bundle)
          options.assertNotCanceled?.()
          const skillRecords = await runSkillPlan(bundle, plan)

          try {
            const analyst = await runAnalyst(bundle, plan, skillRecords, {
              llmConfig: options.llmConfig,
              depth: request.depth,
              maxRetryAttempts,
            })
            options.assertNotCanceled?.()

            if (analyst.cacheHit) {
              llmStats.cacheHits += 1
            } else {
              llmStats.requestCount += 1
              llmStats.promptTokens += analyst.usage.promptTokens
              llmStats.completionTokens += analyst.usage.completionTokens
              llmStats.totalTokens += analyst.usage.totalTokens
            }

            if (analyst.parseFailed) {
              llmStats.parseFailures += 1
              traces.push({
                filePath: file.path,
                hypotheses: plan.hypotheses,
                skillCount: skillRecords.length,
                acceptedCount: 0,
                rejectedCount: 1,
              })
              return { transientFailure: false }
            }

            const critic = runCritic(bundle, analyst.candidates, skillRecords)
            options.assertNotCanceled?.()
            const judged = runJudge(bundle, critic)

            llmStats.successfulFiles += 1
            finalVulns.push(...judged.vulnerabilities)
            traces.push({
              filePath: file.path,
              hypotheses: plan.hypotheses,
              skillCount: skillRecords.length,
              acceptedCount: judged.vulnerabilities.length,
              rejectedCount: judged.rejected.length,
            })
            return { transientFailure: false }
          } catch (err) {
            llmStats.requestFailures += 1
            accumulateFailureKind(llmStats, err)
            transientFailure = isConcurrencyThrottleError(err)
            traces.push({
              filePath: file.path,
              hypotheses: plan.hypotheses,
              skillCount: skillRecords.length,
              acceptedCount: 0,
              rejectedCount: 1,
            })
            return { transientFailure }
          }
        } finally {
          await notifyFileCompleted(options.onFileCompleted, file.path)
        }
      }),
    )

    for (const outcome of outcomes) {
      if (!outcome.transientFailure) {
        transientFailureStreak = 0
        continue
      }
      transientFailureStreak += 1
      if (transientFailureStreak >= 2 && currentParallel > MIN_PARALLEL_FILES) {
        currentParallel -= 1
        transientFailureStreak = 0
      }
    }
    cursor += batch.length
  }

  options.assertNotCanceled?.()
  await upsertVulnerabilities(finalVulns)

  for (const file of changedFiles) {
    options.assertNotCanceled?.()
    const hash = computeContentHash(file.content)
    fileAnalysisCache.set(`${file.path}:${hash}`, true)
  }

  return {
    vulnerabilities: finalVulns,
    summary: buildSummary(finalVulns, request.files),
    llmStats,
    agenticTrace: traces,
  }
}

function resolveRetryAttempts(request: ScanRequest): number {
  const scope = request.scanScope ?? (request.files.length > 1 ? 'workspace' : 'file')
  return scope === 'workspace' ? 1 : 0
}

function filterChangedFiles(files: ScanRequest['files']): ScanRequest['files'] {
  return files.filter((file) => {
    const hash = computeContentHash(file.content)
    return !fileAnalysisCache.has(`${file.path}:${hash}`)
  })
}

function groupByLanguage(files: ScanRequest['files']) {
  return {
    go: files.filter((file) => file.language === 'go'),
    jsts: files.filter((file) => ['javascript', 'typescript'].includes(file.language)),
  }
}

function buildSummary(vulns: VulnerabilityInput[], files: ScanRequest['files']) {
  const bySeverity: Record<string, number> = {}
  const byLanguage: Record<string, number> = {}

  for (const vuln of vulns) {
    bySeverity[vuln.severity] = (bySeverity[vuln.severity] ?? 0) + 1
    const file = files.find((item) => item.path === vuln.filePath)
    const language = file?.language ?? 'unknown'
    byLanguage[language] = (byLanguage[language] ?? 0) + 1
  }

  return {
    totalFiles: files.length,
    totalVulnerabilities: vulns.length,
    bySeverity,
    byLanguage,
  }
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

function accumulateFailureKind(stats: LlmUsageStats, err: unknown): void {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()

  if (msg.includes('resource_exhausted') || msg.includes('quota exceeded') || /\b429\b/.test(msg)) {
    stats.failureKinds.quotaExceeded += 1
    return
  }

  if (msg.includes('逾時') || msg.includes('timeout')) {
    stats.failureKinds.timeout += 1
    return
  }

  if (msg.includes('unavailable') || /\b503\b/.test(msg) || msg.includes('high demand')) {
    stats.failureKinds.unavailable += 1
    return
  }

  stats.failureKinds.other += 1
}

function isConcurrencyThrottleError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('LLM 呼叫逾時')) return true
  if (/\b503\b/.test(msg)) return true
  if (/\b429\b/.test(msg)) return true
  if (msg.includes('UNAVAILABLE')) return true
  if (/high demand/i.test(msg)) return true
  if (/resource_exhausted/i.test(msg)) return true
  if (/quota exceeded/i.test(msg)) return true
  return false
}

function resolveParallelFiles(request: ScanRequest): number {
  const scope = request.scanScope ?? (request.files.length > 1 ? 'workspace' : 'file')
  if (scope !== 'workspace') return MIN_PARALLEL_FILES
  return MAX_PARALLEL_BY_DEPTH_WORKSPACE[request.depth]
}

async function notifyFilteredFiles(
  callback: AgenticOrchestrateOptions['onFilteredFiles'],
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

async function notifyFileCompleted(
  callback: AgenticOrchestrateOptions['onFileCompleted'],
  filePath: string,
): Promise<void> {
  if (!callback) return
  try {
    await callback(filePath)
  } catch {
    // 進度通知失敗不應中斷主要掃描流程
  }
}

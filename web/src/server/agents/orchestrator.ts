import type { VulnerabilityInput } from '@server/db'
import { upsertVulnerabilities } from '@server/db'

import type { ScanRequest } from '@/libs/types'

import type { FileContentMap } from './analysis-agent'
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
}

/**
 * Orchestrator：接收掃描請求，按語言分組並行調度 Agent，
 * 合併交互點後交由 LLM 分析，最後冪等存儲漏洞記錄。
 */
export async function orchestrate(request: ScanRequest): Promise<OrchestrateResult> {
  const { go, jsts } = groupByLanguage(request.files)

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

  // 建構檔案內容對照表供 Analysis Agent 使用
  const fileContents: FileContentMap = new Map()
  for (const file of request.files) {
    fileContents.set(file.path, { content: file.content, language: file.language })
  }

  // LLM 深度分析
  const vulns = await analyzeWithLlm(allPoints, fileContents, {
    depth: request.depth,
    includeMacroScan: request.includeLlmScan ?? false,
  })

  // 冪等存儲
  await upsertVulnerabilities(vulns)

  return { vulnerabilities: vulns, summary: buildSummary(vulns, request.files) }
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

  for (const v of vulns) {
    bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1

    // 從檔案列表中找出對應語言
    const file = files.find((f) => f.path === v.filePath)
    const lang = file?.language ?? 'unknown'
    byLanguage[lang] = (byLanguage[lang] ?? 0) + 1
  }

  return {
    totalFiles: files.length,
    totalVulnerabilities: vulns.length,
    bySeverity,
    byLanguage,
  }
}

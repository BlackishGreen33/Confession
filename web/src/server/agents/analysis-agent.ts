import type { VulnerabilityInput } from '@server/db'
import type { GeminiClientConfig } from '@server/llm/gemini'
import { callGemini, configFromEnv } from '@server/llm/gemini'
import type { LlmVulnerability } from '@server/llm/parser'
import { parseLlmResponse } from '@server/llm/parser'
import { buildAnalysisPrompt, buildMacroScanPrompt } from '@server/llm/prompts'

import type { InteractionPoint, ScanRequest } from '@/libs/types'

/** 檔案內容對照表，用於建構 Prompt 時取得完整檔案 */
export type FileContentMap = Map<string, { content: string; language: string }>

/** Analysis Agent 設定 */
export interface AnalysisAgentOptions {
  /** Gemini 客戶端設定，未提供時從環境變數取得 */
  geminiConfig?: GeminiClientConfig
  /** 分析深度 */
  depth: ScanRequest['depth']
  /** 是否執行 Phase 2 宏觀掃描 */
  includeMacroScan: boolean
}

const DEFAULT_MODEL = 'gemini-2.5-flash'

/**
 * Analysis Agent：對交互點進行 LLM 深度分析，並可選地對整個檔案進行宏觀掃描。
 *
 * - Phase 1：逐一分析每個交互點，判斷是否為真實漏洞
 * - Phase 2（可選）：對每個檔案進行全面安全掃描，發現靜態規則未覆蓋的風險
 */
export async function analyzeWithLlm(
  points: InteractionPoint[],
  fileContents: FileContentMap,
  options: AnalysisAgentOptions,
): Promise<VulnerabilityInput[]> {
  const config = options.geminiConfig ?? configFromEnv()
  const modelName = config.model ?? DEFAULT_MODEL
  const results: VulnerabilityInput[] = []

  // Phase 1：交互點深度分析
  const phase1 = await analyzeInteractionPoints(points, fileContents, config, options.depth, modelName)
  results.push(...phase1)

  // Phase 2：宏觀掃描（僅在啟用時執行）
  if (options.includeMacroScan) {
    const phase2 = await macroScanFiles(fileContents, config, options.depth, modelName)
    // 去重：Phase 2 結果中與 Phase 1 同位置同類型的漏洞不重複加入
    const phase1Keys = new Set(phase1.map((v) => `${v.filePath}:${v.line}:${v.column}:${v.type}`))
    for (const vuln of phase2) {
      const key = `${vuln.filePath}:${vuln.line}:${vuln.column}:${vuln.type}`
      if (!phase1Keys.has(key)) {
        results.push(vuln)
      }
    }
  }

  return results
}


/**
 * Phase 1：逐一對交互點呼叫 LLM 深度分析。
 * 每個交互點獨立呼叫，避免單一 Prompt 過長導致品質下降。
 */
async function analyzeInteractionPoints(
  points: InteractionPoint[],
  fileContents: FileContentMap,
  config: GeminiClientConfig,
  depth: ScanRequest['depth'],
  modelName: string,
): Promise<VulnerabilityInput[]> {
  const results: VulnerabilityInput[] = []

  for (const point of points) {
    const fileInfo = fileContents.get(point.filePath)
    if (!fileInfo) continue

    const prompt = buildAnalysisPrompt(point, fileInfo.content, depth)

    try {
      const raw = await callGemini(prompt, config)
      const parsed = parseLlmResponse(raw)
      if (!parsed) continue

      const vulns = parsed.map((v) => llmVulnToInput(v, point.filePath, modelName))
      results.push(...vulns)
    } catch {
      // LLM 呼叫失敗時跳過該交互點，不中斷整體流程
      continue
    }
  }

  return results
}

/**
 * Phase 2：對每個檔案進行宏觀掃描。
 * 發現 AST 靜態規則未覆蓋的潛在風險。
 */
async function macroScanFiles(
  fileContents: FileContentMap,
  config: GeminiClientConfig,
  depth: ScanRequest['depth'],
  modelName: string,
): Promise<VulnerabilityInput[]> {
  const results: VulnerabilityInput[] = []

  for (const [filePath, { content, language }] of fileContents) {
    const prompt = buildMacroScanPrompt(filePath, content, language, depth)

    try {
      const raw = await callGemini(prompt, config)
      const parsed = parseLlmResponse(raw)
      if (!parsed) continue

      const vulns = parsed.map((v) => llmVulnToInput(v, filePath, modelName))
      results.push(...vulns)
    } catch {
      // LLM 呼叫失敗時跳過該檔案，不中斷整體流程
      continue
    }
  }

  return results
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

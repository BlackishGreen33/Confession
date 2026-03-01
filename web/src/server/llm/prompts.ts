import type { InteractionPoint, ScanRequest } from '@/libs/types'

/**
 * CWE 先驗知識庫 — 常見漏洞模式與對應 CWE 編號。
 * 注入 Prompt 讓 LLM 在分析時有明確的分類依據。
 */
const CWE_KNOWLEDGE = `
## CWE 先驗知識

- CWE-78: OS Command Injection
- CWE-79: Cross-site Scripting (XSS)
- CWE-89: SQL Injection
- CWE-94: Code Injection
- CWE-200: Exposure of Sensitive Information
- CWE-295: Improper Certificate Validation
- CWE-327: Use of a Broken Crypto Algorithm
- CWE-338: Use of Cryptographically Weak PRNG
- CWE-400: Uncontrolled Resource Consumption
- CWE-502: Deserialization of Untrusted Data
- CWE-601: URL Redirection to Untrusted Site
- CWE-798: Use of Hard-coded Credentials
- CWE-915: Prototype Pollution
`.trim()

/** LLM 回傳的單一漏洞結構（JSON schema 描述，嵌入 Prompt） */
const VULNERABILITY_JSON_SCHEMA = `
{
  "type": "string",
  "cweId": "string | null",
  "severity": "critical | high | medium | low | info",
  "description": "string",
  "riskDescription": "string | null",
  "line": "number",
  "column": "number",
  "endLine": "number",
  "endColumn": "number",
  "fixOldCode": "string | null",
  "fixNewCode": "string | null",
  "fixExplanation": "string | null",
  "confidence": "number (0..1)",
  "reasoning": "string"
}
`.trim()

/** 分析深度對應的 Prompt 指示 */
const DEPTH_INSTRUCTIONS: Record<ScanRequest['depth'], string> = {
  quick: '僅關注明確且高風險的漏洞，忽略低風險和推測性問題。',
  standard: '完整分析所有嚴重等級漏洞，包含明確與可能風險。',
  deep: '深度分析，包含潛在邏輯缺陷與弱訊號風險。',
}

/** 批次分析時的交互點摘要 */
export interface PromptInteractionPoint {
  type: InteractionPoint['type']
  patternName: string
  confidence: InteractionPoint['confidence']
  line: number
  column: number
  codeSnippet: string
}

/** 區塊化上下文 */
export interface PromptContextBlock {
  startLine: number
  endLine: number
  content: string
}

/**
 * 每檔案聚合分析 Prompt（quick / standard）。
 * 只提供交互點附近上下文，避免重複傳整個檔案。
 */
export function buildBatchAnalysisPrompt(
  filePath: string,
  language: string,
  depth: ScanRequest['depth'],
  points: PromptInteractionPoint[],
  contextBlocks: PromptContextBlock[],
): string {
  const pointList = points
    .map(
      (point, index) =>
        `${index + 1}. line=${point.line}, column=${point.column}, type=${point.type}, pattern=${point.patternName}, confidence=${point.confidence}\n   snippet: ${point.codeSnippet}`,
    )
    .join('\n')

  const contextList = contextBlocks
    .map(
      (block, index) =>
        `### 區塊 ${index + 1}（${block.startLine}-${block.endLine}）\n\`\`\`${language}\n${block.content}\n\`\`\``,
    )
    .join('\n\n')

  return `你是一位資深程式碼安全審計專家。請依據交互點與區塊上下文判斷漏洞。

${CWE_KNOWLEDGE}

## 分析深度
${DEPTH_INSTRUCTIONS[depth]}

## 檔案資訊
- 檔案：${filePath}
- 語言：${language}

## 交互點清單
${pointList}

## 區塊上下文（已含原始行號前綴）
${contextList}

## 輸出要求
- 只回傳 JSON 陣列
- 無漏洞回傳 []
- 每個漏洞物件結構：
${VULNERABILITY_JSON_SCHEMA}
- confidence 必須是 0 到 1 的小數（例如 0.72），不要使用 0 到 100
- line/column 必須對應原始檔案的真實位置`
}

/**
 * deep 模式 Prompt：保留全檔掃描能力，但同檔案只呼叫一次 LLM。
 */
export function buildDeepFileScanPrompt(
  filePath: string,
  fileContent: string,
  language: string,
  depth: ScanRequest['depth'],
  points: PromptInteractionPoint[],
): string {
  const hintPoints =
    points.length === 0
      ? '（無）'
      : points
          .map(
            (point, index) =>
              `${index + 1}. line=${point.line}, column=${point.column}, type=${point.type}, pattern=${point.patternName}, confidence=${point.confidence}`,
          )
          .join('\n')

  return `你是一位資深程式碼安全審計專家。請對以下檔案做完整安全掃描，並參考交互點提示。

${CWE_KNOWLEDGE}

## 分析深度
${DEPTH_INSTRUCTIONS[depth]}

## 檔案資訊
- 檔案：${filePath}
- 語言：${language}

## 交互點提示
${hintPoints}

## 完整檔案內容
\`\`\`${language}
${fileContent}
\`\`\`

## 輸出要求
- 只回傳 JSON 陣列
- 無漏洞回傳 []
- 每個漏洞物件結構：
${VULNERABILITY_JSON_SCHEMA}
- confidence 必須是 0 到 1 的小數（例如 0.72），不要使用 0 到 100
- 不要回報程式碼風格問題，只回報安全風險`
}

/** 匯出 CWE 知識供測試使用 */
export const CWE_KNOWLEDGE_TEXT = CWE_KNOWLEDGE

/** 匯出深度指示供測試使用 */
export const DEPTH_INSTRUCTIONS_MAP = DEPTH_INSTRUCTIONS

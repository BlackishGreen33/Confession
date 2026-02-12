import type { InteractionPoint, ScanRequest } from '@/libs/types';

/**
 * CWE 先驗知識庫 — 常見漏洞模式與對應 CWE 編號。
 * 注入 Prompt 讓 LLM 在分析時有明確的分類依據。
 */
const CWE_KNOWLEDGE = `
## CWE 先驗知識

- CWE-78: OS Command Injection — 未經驗證的輸入傳入 exec/spawn/Command
- CWE-79: Cross-site Scripting (XSS) — innerHTML/dangerouslySetInnerHTML 使用未過濾的資料
- CWE-89: SQL Injection — 字串拼接 SQL 查詢，未使用參數化查詢
- CWE-94: Code Injection — eval()、new Function()、vm.runInContext 執行動態程式碼
- CWE-200: Exposure of Sensitive Information — 日誌或回應中洩漏密碼、token、secret
- CWE-250: Execution with Unnecessary Privileges — 以過高權限執行操作
- CWE-295: Improper Certificate Validation — 停用 TLS 驗證（rejectUnauthorized: false）
- CWE-327: Use of a Broken Crypto Algorithm — 使用 MD5/SHA1 做安全用途
- CWE-338: Use of Cryptographically Weak PRNG — Math.random() 用於安全場景
- CWE-400: Uncontrolled Resource Consumption — 無限制的輸入大小或遞迴深度
- CWE-502: Deserialization of Untrusted Data — JSON.parse/deserialize 未驗證的外部資料
- CWE-601: URL Redirection to Untrusted Site — 未驗證的重導向目標
- CWE-676: Use of Potentially Dangerous Function — 使用已知不安全的函式
- CWE-798: Use of Hard-coded Credentials — 程式碼中寫死密碼或 API Key
- CWE-915: Improperly Controlled Modification of Dynamically-Determined Object Attributes — 原型鏈污染
`.trim();

/** LLM 回傳的單一漏洞結構（JSON schema 描述，嵌入 Prompt） */
const VULNERABILITY_JSON_SCHEMA = `
{
  "type": "string",           // 漏洞類型（如 "SQL Injection", "XSS"）
  "cweId": "string | null",   // CWE 編號（如 "CWE-89"），無法判定時為 null
  "severity": "critical | high | medium | low | info",
  "description": "string",    // 漏洞描述（一句話）
  "riskDescription": "string | null", // 風險說明（攻擊情境）
  "line": "number",           // 漏洞起始行號
  "column": "number",         // 漏洞起始列號
  "endLine": "number",        // 漏洞結束行號
  "endColumn": "number",      // 漏洞結束列號
  "fixOldCode": "string | null",     // 需要修改的原始程式碼
  "fixNewCode": "string | null",     // 修復後的程式碼
  "fixExplanation": "string | null", // 修復說明
  "confidence": "number",     // 信心度 0.0 ~ 1.0
  "reasoning": "string"       // 判斷推理過程
}
`.trim();

/**
 * 分析深度對應的 Prompt 指示。
 * quick: 僅檢查高風險模式；standard: 完整分析；deep: 含推測性風險。
 */
const DEPTH_INSTRUCTIONS: Record<ScanRequest['depth'], string> = {
  quick: '僅關注 critical 和 high 嚴重等級的明確漏洞，忽略低風險和推測性問題。',
  standard: '完整分析所有嚴重等級的漏洞，包含明確和可能的風險。',
  deep: '進行最深度分析，包含推測性風險、潛在的邏輯漏洞、以及不良實踐。即使信心度較低也應回報。',
};


/**
 * Phase 1：交互點深度分析 Prompt。
 * 針對 AST 靜態分析發現的交互點，請 LLM 判斷是否為真實漏洞並提供修復建議。
 */
export function buildAnalysisPrompt(
  point: InteractionPoint,
  fileContent: string,
  depth: ScanRequest['depth']
): string {
  return `你是一位資深的程式碼安全審計專家。請分析以下交互點是否構成安全漏洞。

${CWE_KNOWLEDGE}

## 分析深度

${DEPTH_INSTRUCTIONS[depth]}

## 交互點資訊

- 檔案：${point.filePath}
- 語言：${point.language}
- 位置：第 ${point.line} 行，第 ${point.column} 列
- 模式：${point.patternName}（${point.type}）
- 靜態分析信心度：${point.confidence}
- 程式碼片段：
\`\`\`
${point.codeSnippet}
\`\`\`

## 完整檔案內容

\`\`\`${point.language}
${fileContent}
\`\`\`

## 輸出要求

以 JSON 陣列回傳分析結果。若該交互點確實構成漏洞，回傳包含一個物件的陣列；若不構成漏洞，回傳空陣列 \`[]\`。

每個漏洞物件的結構：
${VULNERABILITY_JSON_SCHEMA}

注意事項：
- 行號和列號必須對應完整檔案內容中的實際位置
- 修復建議必須是可直接替換的程式碼
- reasoning 欄位請說明判斷依據
- 若無法確定 CWE 編號，cweId 設為 null
- 嚴格以 JSON 陣列格式回傳，不要包含其他文字`;
}

/**
 * Phase 2：宏觀掃描 Prompt。
 * 對整個檔案進行全面掃描，發現 AST 靜態規則未覆蓋的潛在風險。
 */
export function buildMacroScanPrompt(
  filePath: string,
  fileContent: string,
  language: string,
  depth: ScanRequest['depth']
): string {
  return `你是一位資深的程式碼安全審計專家。請對以下檔案進行全面的安全掃描，找出所有潛在的安全漏洞。

${CWE_KNOWLEDGE}

## 分析深度

${DEPTH_INSTRUCTIONS[depth]}

## 檔案資訊

- 檔案：${filePath}
- 語言：${language}

## 檔案內容

\`\`\`${language}
${fileContent}
\`\`\`

## 掃描重點

除了常見的注入和 XSS 問題，請特別關注：
- 認證與授權邏輯缺陷
- 敏感資料處理不當（硬編碼密碼、明文傳輸）
- 錯誤處理不完整（未捕獲的例外、錯誤訊息洩漏）
- 不安全的加密或雜湊使用
- 競態條件（Race Condition）
- 路徑遍歷（Path Traversal）
- 不安全的反序列化
- 原型鏈污染

## 輸出要求

以 JSON 陣列回傳所有發現的漏洞。若未發現任何漏洞，回傳空陣列 \`[]\`。

每個漏洞物件的結構：
${VULNERABILITY_JSON_SCHEMA}

注意事項：
- 行號和列號必須對應檔案內容中的實際位置
- 不要回報程式碼風格問題，僅關注安全漏洞
- 修復建議必須是可直接替換的程式碼
- reasoning 欄位請說明判斷依據
- 嚴格以 JSON 陣列格式回傳，不要包含其他文字`;
}

/** 匯出 CWE 知識供測試使用 */
export const CWE_KNOWLEDGE_TEXT = CWE_KNOWLEDGE;

/** 匯出深度指示供測試使用 */
export const DEPTH_INSTRUCTIONS_MAP = DEPTH_INSTRUCTIONS;

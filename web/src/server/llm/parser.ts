import { z } from 'zod/v4'

/**
 * LLM 回傳的單一漏洞原始結構。
 * 對應 prompts.ts 中 VULNERABILITY_JSON_SCHEMA 的欄位定義。
 */
const llmVulnerabilitySchema = z.object({
  type: z.string(),
  cweId: z.string().nullable(),
  severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
  description: z.string(),
  riskDescription: z.string().nullable().optional(),
  line: z.number(),
  column: z.number(),
  endLine: z.number(),
  endColumn: z.number(),
  fixOldCode: z.string().nullable().optional(),
  fixNewCode: z.string().nullable().optional(),
  fixExplanation: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
})

/** LLM 回傳的完整回應：漏洞陣列 */
const llmResponseSchema = z.array(llmVulnerabilitySchema)

/** 解析後的單一漏洞型別 */
export type LlmVulnerability = z.infer<typeof llmVulnerabilitySchema>

/**
 * 解析 LLM JSON 回應。
 *
 * - 合法 JSON 陣列且通過 schema 驗證 → 回傳 LlmVulnerability[]
 * - 非法 JSON 或驗證失敗 → 回傳 null，不拋異常
 *
 * 支援 LLM 回傳被 markdown code fence 包裹的 JSON（```json ... ```）。
 */
export function parseLlmResponse(raw: string): LlmVulnerability[] | null {
  try {
    const cleaned = stripCodeFence(raw)
    const parsed: unknown = JSON.parse(cleaned)
    const result = llmResponseSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/**
 * 移除 markdown code fence 包裹。
 * LLM 有時會回傳 ```json\n...\n``` 格式，需要先剝離。
 */
function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenceRegex = /^```(?:\w+)?\s*\n([\s\S]*?)\n\s*```$/
  const match = fenceRegex.exec(trimmed)
  return match ? match[1] : trimmed
}

export { llmResponseSchema, llmVulnerabilitySchema }

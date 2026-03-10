import type { VulnerabilityInput } from '@server/storage'

import type { InteractionPoint, ScanRequest } from '@/libs/types'

export type AgenticSkillName =
  | 'ast_hotspots'
  | 'context_slice'
  | 'sanitizer_check'
  | 'history_lookup'
  | 'cwe_mapper'
  | 'mcp_pattern_scan'
  | 'mcp_code_graph_lookup'

export interface ContextBlock {
  id: string
  startLine: number
  endLine: number
  content: string
}

export interface ContextBundle {
  traceId: string
  filePath: string
  language: string
  content: string
  contentDigest: string
  depth: ScanRequest['depth']
  hotspots: InteractionPoint[]
  contextBlocks: ContextBlock[]
  totalLines: number
  highRiskHotspotCount: number
}

export interface PlannerPlan {
  hypotheses: string[]
  skills: AgenticSkillName[]
  mcpTasks: Array<{ serverName: string; toolName: 'pattern_scan' | 'code_graph_lookup' }>
}

export interface SkillExecutionRecord {
  skillName: AgenticSkillName
  evidence: string[]
  confidence: number
  cost: number
  latencyMs: number
  traceId: string
  success: boolean
  error?: string
}

export interface AnalystResult {
  candidates: VulnerabilityInput[]
  usage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  cacheHit: boolean
  parseFailed: boolean
}

export interface CriticRejectedItem {
  vuln: VulnerabilityInput
  reason: string
}

export interface CriticResult {
  accepted: VulnerabilityInput[]
  rejected: CriticRejectedItem[]
}

export interface JudgeResult {
  vulnerabilities: VulnerabilityInput[]
  rejected: CriticRejectedItem[]
}

export interface AgenticTraceSummary {
  filePath: string
  hypotheses: string[]
  skillCount: number
  acceptedCount: number
  rejectedCount: number
}

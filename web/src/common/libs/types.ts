// === 交互點（Interaction Point） ===

export interface InteractionPoint {
  id: string
  type: 'dangerous_call' | 'sensitive_data' | 'unsafe_pattern' | 'prototype_mutation'
  language: 'go' | 'javascript' | 'typescript'
  filePath: string
  line: number
  column: number
  endLine: number
  endColumn: number
  codeSnippet: string
  patternName: string
  confidence: 'high' | 'medium' | 'low'
}

// === 漏洞（Vulnerability） ===

export interface Vulnerability {
  id: string
  filePath: string
  line: number
  column: number
  endLine: number
  endColumn: number
  codeSnippet: string
  codeHash: string
  type: string
  cweId: string | null
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  description: string
  riskDescription: string | null
  fixOldCode: string | null
  fixNewCode: string | null
  fixExplanation: string | null
  aiModel: string | null
  aiConfidence: number | null
  aiReasoning: string | null
  humanStatus: 'pending' | 'confirmed' | 'rejected' | 'false_positive'
  humanComment: string | null
  owaspCategory: string | null
  status: 'open' | 'fixed' | 'ignored'
  createdAt: string
  updatedAt: string
}

// === 掃描請求（Scan Request） ===

export interface ScanRequest {
  files: Array<{ path: string; content: string; language: string }>
  depth: 'quick' | 'standard' | 'deep'
  includeLlmScan?: boolean
}


// === 通信協議（Extension ↔ Webview） ===

export type ExtToWebMsg =
  | { type: 'vulnerabilities_updated'; data: Vulnerability[] }
  | { type: 'scan_progress'; data: { status: string; progress: number } }
  | { type: 'config_updated'; data: PluginConfig }

export type WebToExtMsg =
  | { type: 'request_scan'; data: { scope: 'file' | 'workspace' } }
  | { type: 'apply_fix'; data: { vulnerabilityId: string } }
  | { type: 'ignore_vulnerability'; data: { vulnerabilityId: string; reason?: string } }
  | { type: 'navigate_to_code'; data: { filePath: string; line: number; column: number } }
  | { type: 'update_config'; data: PluginConfig }
  | { type: 'request_config' }

// === 配置（Plugin Config） ===

export interface PluginConfig {
  llm: {
    provider: 'gemini'
    apiKey: string
    endpoint?: string
    model?: string
  }
  analysis: {
    triggerMode: 'onSave' | 'manual'
    depth: 'quick' | 'standard' | 'deep'
    debounceMs: number
  }
  ignore: {
    paths: string[]
    types: string[]
  }
  api: {
    baseUrl: string
    mode: 'local' | 'remote'
  }
}

// === 嚴重度 → 診斷等級映射 ===

export type Severity = Vulnerability['severity']

export type DiagnosticLevel = 'error' | 'warning' | 'information'

/**
 * 將漏洞嚴重度映射為診斷等級。
 * critical/high → error, medium → warning, low/info → information
 */
export function mapSeverityToLevel(severity: Severity): DiagnosticLevel {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'error'
    case 'medium':
      return 'warning'
    case 'low':
    case 'info':
      return 'information'
  }
}


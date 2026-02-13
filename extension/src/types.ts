// === 通訊協議型別（Extension ↔ Webview） ===

// 漏洞嚴重等級
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info'

// 漏洞記錄
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
  severity: Severity
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

// 插件配置
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

// Extension → Webview 訊息
export type ExtToWebMsg =
  | { type: 'vulnerabilities_updated'; data: Vulnerability[] }
  | { type: 'scan_progress'; data: { status: string; progress: number } }
  | { type: 'config_updated'; data: PluginConfig }
  | { type: 'navigate_to_view'; data: { route: string } }
  | { type: 'vulnerability_detail_data'; data: Vulnerability }

// Webview → Extension 訊息
export type WebToExtMsg =
  | { type: 'request_scan'; data: { scope: 'file' | 'workspace' } }
  | { type: 'apply_fix'; data: { vulnerabilityId: string } }
  | { type: 'ignore_vulnerability'; data: { vulnerabilityId: string; reason?: string } }
  | { type: 'navigate_to_code'; data: { filePath: string; line: number; column: number } }
  | { type: 'update_config'; data: PluginConfig }
  | { type: 'request_config' }
  | { type: 'open_vulnerability_detail'; data: { vulnerabilityId: string } }

// === 交互點（Interaction Point） ===

export interface InteractionPoint {
  id: string;
  type:
    | 'dangerous_call'
    | 'sensitive_data'
    | 'unsafe_pattern'
    | 'prototype_mutation';
  language: 'go' | 'javascript' | 'typescript';
  filePath: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  codeSnippet: string;
  patternName: string;
  confidence: 'high' | 'medium' | 'low';
}

// === 漏洞（Vulnerability） ===

export interface Vulnerability {
  id: string;
  filePath: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  codeSnippet: string;
  codeHash: string;
  type: string;
  cweId: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  description: string;
  riskDescription: string | null;
  fixOldCode: string | null;
  fixNewCode: string | null;
  fixExplanation: string | null;
  aiModel: string | null;
  aiConfidence: number | null;
  aiReasoning: string | null;
  stableFingerprint: string;
  source: 'sast' | 'dast';
  humanStatus: 'pending' | 'confirmed' | 'rejected' | 'false_positive';
  humanComment: string | null;
  owaspCategory: string | null;
  status: 'open' | 'fixed' | 'ignored';
  createdAt: string;
  updatedAt: string;
}

export type VulnerabilityEventType =
  | 'scan_detected'
  | 'review_saved'
  | 'status_changed'
  | 'scan_relocated';

export interface VulnerabilityEvent {
  id: string;
  vulnerabilityId: string;
  eventType: VulnerabilityEventType;
  message: string;
  fromStatus: Vulnerability['status'] | null;
  toStatus: Vulnerability['status'] | null;
  fromHumanStatus: Vulnerability['humanStatus'] | null;
  toHumanStatus: Vulnerability['humanStatus'] | null;
  fromFilePath: string | null;
  fromLine: number | null;
  toFilePath: string | null;
  toLine: number | null;
  createdAt: string;
}

export type ScanEngineMode = 'baseline' | 'agentic_beta';
export type ScanErrorCode =
  | 'BETA_ENGINE_FAILED'
  | 'LLM_ANALYSIS_FAILED'
  | 'UNKNOWN';

// === 掃描請求（Scan Request） ===

export interface ScanRequest {
  files: Array<{ path: string; content: string; language: string }>;
  depth: 'quick' | 'standard' | 'deep';
  includeLlmScan?: boolean;
  /** 手動掃描時可設為 true，強制重掃不走未變更快取 */
  forceRescan?: boolean;
  /** 掃描範圍，用於策略差異（例如重試策略） */
  scanScope?: 'file' | 'workspace';
  /** 工作區快照是否完整（未觸及上限截斷） */
  workspaceSnapshotComplete?: boolean;
  /** 工作區根路徑（用於限制快照收斂影響範圍） */
  workspaceRoots?: string[];
  /** 掃描引擎模式：baseline（現行）或 agentic_beta（Beta 多代理） */
  engineMode?: ScanEngineMode;
}

export type ExportFormat = 'json' | 'csv' | 'markdown' | 'pdf' | 'sarif';

export interface ExportFilters {
  status?: Vulnerability['status'];
  severity?: Vulnerability['severity'];
  humanStatus?: Vulnerability['humanStatus'];
  filePath?: string;
  search?: string;
}

export interface ExportReportV2 {
  schemaVersion: string;
  reportName: string;
  generatedBy: string;
  exportedAt: string;
  filters: ExportFilters;
  summary: {
    total: number;
    bySeverity: Record<string, number>;
    byStatus: Record<string, number>;
    byHumanStatus: Record<string, number>;
    byType: Record<string, number>;
  };
  items: Vulnerability[];
}

export interface RecentScanSummary {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  totalFiles: number;
  scannedFiles: number;
  engineMode: ScanEngineMode;
  fallbackUsed: boolean;
  fallbackFrom?: 'agentic_beta';
  fallbackTo?: 'baseline';
  fallbackReason?: string;
  errorMessage: string | null;
  errorCode: ScanErrorCode | null;
  createdAt: string;
  updatedAt: string;
}

export type VulnerabilityFilterPreset =
  | 'critical_open'
  | 'high_open'
  | 'open_all';

export type HealthStatus = 'ok' | 'degraded' | 'down';
export type HealthGrade = 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D';
export type HealthTopFactorKey =
  | 'fallback_rate'
  | 'mttr_hours'
  | 'workspace_p95'
  | 'lev'
  | 'closure_rate'
  | 'efficiency'
  | 'coverage'
  | 'success_rate';

export interface HealthTopFactor {
  key: HealthTopFactorKey;
  direction: 'positive' | 'negative';
  label: string;
  valueText: string;
  reason: string;
  impactScore: number;
}

export interface HealthScoreExposure {
  value: number;
  orb: number;
  lev: number;
}

export interface HealthScoreRemediation {
  value: number;
  mttrHours: number;
  closureRate: number;
}

export interface HealthScoreQuality {
  value: number;
  efficiency: number;
  coverage: number;
}

export interface HealthScoreReliability {
  value: number;
  successRate: number;
  fallbackRate: number;
  workspaceP95Ms: number;
}

export interface HealthResponseV2 {
  status: HealthStatus;
  evaluatedAt: string;
  score: {
    version: 'v2';
    value: number;
    grade: HealthGrade;
    components: {
      exposure: HealthScoreExposure;
      remediation: HealthScoreRemediation;
      quality: HealthScoreQuality;
      reliability: HealthScoreReliability;
    };
    topFactors: HealthTopFactor[];
  };
  engine: {
    latestTaskId?: string;
    latestStatus?: 'pending' | 'running' | 'completed' | 'failed';
    latestEngineMode?: ScanEngineMode;
  };
}

export type AdviceSourceEvent =
  | 'scan_completed'
  | 'scan_failed'
  | 'review_saved'
  | 'status_changed';
export type AdviceBlockedReason =
  | 'threshold_not_met'
  | 'cooldown_active'
  | 'same_fingerprint'
  | 'daily_limit_reached';

export interface AdviceActionItem {
  title: string;
  reason: string;
  expectedImpact: string;
}

export interface AdvicePayload {
  summary: string;
  confidence: number;
  actions: AdviceActionItem[];
}

export interface AdviceLatestResponse {
  available: boolean;
  evaluatedAt: string | null;
  triggerScore: number | null;
  triggerReason: string | null;
  sourceEvent: AdviceSourceEvent | null;
  stale: boolean;
  blockedReason: AdviceBlockedReason | null;
  advice: AdvicePayload | null;
}

// === 通信協議（Extension ↔ Webview） ===

export type ExtToWebMsg =
  | { type: 'vulnerabilities_updated'; data: Vulnerability[] }
  | { type: 'scan_progress'; data: { status: string; progress: number } }
  | { type: 'config_updated'; data: PluginConfig }
  | { type: 'clipboard_paste'; data: { text: string } }
  | {
      type: 'apply_vulnerability_preset';
      data: { preset: VulnerabilityFilterPreset; sourceRequestId?: string };
    }
  | { type: 'navigate_to_view'; data: { route: string } }
  | { type: 'vulnerability_detail_data'; data: Vulnerability }
  | {
      type: 'operation_result';
      data: {
        requestId: string;
        operation:
          | 'apply_fix'
          | 'ignore_vulnerability'
          | 'refresh_vulnerabilities'
          | 'update_config'
          | 'focus_sidebar_view'
          | 'export_pdf';
        success: boolean;
        message: string;
        payload?: {
          vulnerabilityId?: string;
          updatedVulnerability?: Vulnerability;
          config?: PluginConfig;
        };
      };
    };

export type WebToExtMsg =
  | { type: 'request_scan'; data: { scope: 'file' | 'workspace' } }
  | {
      type: 'focus_sidebar_view';
      requestId?: string;
      data: {
        view: 'dashboard' | 'vulnerabilities';
        preset?: VulnerabilityFilterPreset;
      };
    }
  | { type: 'apply_fix'; requestId: string; data: { vulnerabilityId: string } }
  | {
      type: 'ignore_vulnerability';
      requestId: string;
      data: { vulnerabilityId: string; reason?: string };
    }
  | { type: 'refresh_vulnerabilities'; requestId: string }
  | {
      type: 'navigate_to_code';
      data: { filePath: string; line: number; column: number };
    }
  | { type: 'update_config'; requestId: string; data: PluginConfig }
  | {
      type: 'export_pdf';
      requestId: string;
      data: {
        filters?: ExportFilters;
        filename?: string;
        locale?: 'zh-TW' | 'zh-CN' | 'en';
      };
    }
  | { type: 'request_config' }
  | { type: 'paste_clipboard' }
  | { type: 'open_vulnerability_detail'; data: { vulnerabilityId: string } };

// === 配置（Plugin Config） ===

export type LlmProvider = 'gemini' | 'nvidia';
export type UiLanguage = 'auto' | 'zh-TW' | 'zh-CN' | 'en';

export interface PluginConfig {
  llm: {
    provider: LlmProvider;
    apiKey: string;
    endpoint?: string;
    model?: string;
  };
  analysis: {
    triggerMode: 'onSave' | 'manual';
    depth: 'quick' | 'standard' | 'deep';
    debounceMs: number;
  };
  ignore: {
    paths: string[];
    types: string[];
  };
  api: {
    baseUrl: string;
    mode: 'local' | 'remote';
  };
  ui: {
    language: UiLanguage;
  };
}

// === 嚴重度 → 診斷等級映射 ===

export type Severity = Vulnerability['severity'];

export type DiagnosticLevel = 'error' | 'warning' | 'information';

/**
 * 將漏洞嚴重度映射為診斷等級。
 * critical/high → error, medium → warning, low/info → information
 */
export function mapSeverityToLevel(severity: Severity): DiagnosticLevel {
  switch (severity) {
    case 'critical':
    case 'high':
      return 'error';
    case 'medium':
      return 'warning';
    case 'low':
    case 'info':
      return 'information';
  }
}

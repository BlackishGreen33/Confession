// === 通訊協議型別（Extension ↔ Webview） ===

// 漏洞嚴重等級
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

// 漏洞記錄
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
  severity: Severity;
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

export type ScanEngineMode = 'baseline' | 'agentic';
export type ScanErrorCode =
  | 'AGENTIC_ENGINE_FAILED'
  | 'LLM_ANALYSIS_FAILED'
  | 'UNKNOWN';

// 插件配置
export type LlmProvider = 'gemini' | 'nvidia' | 'minimax-cn';
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

export interface ExportFilters {
  status?: Vulnerability['status'];
  severity?: Vulnerability['severity'];
  humanStatus?: Vulnerability['humanStatus'];
  filePath?: string;
  search?: string;
}

export type VulnerabilityFilterPreset =
  | 'critical_open'
  | 'high_open'
  | 'open_all';

// Extension → Webview 訊息
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

// Webview → Extension 訊息
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

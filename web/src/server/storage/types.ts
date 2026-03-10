import type { PluginConfig } from '@/libs/types'

export interface VulnerabilityRecord {
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
  severity: string
  description: string
  riskDescription: string | null
  fixOldCode: string | null
  fixNewCode: string | null
  fixExplanation: string | null
  aiModel: string | null
  aiConfidence: number | null
  aiReasoning: string | null
  stableFingerprint: string
  source: 'sast' | 'dast'
  humanStatus: string
  humanComment: string | null
  humanReviewedAt: Date | null
  owaspCategory: string | null
  status: string
  createdAt: Date
  updatedAt: Date
}

export interface VulnerabilityEventRecord {
  id: string
  vulnerabilityId: string
  eventType: string
  message: string
  fromStatus: string | null
  toStatus: string | null
  fromHumanStatus: string | null
  toHumanStatus: string | null
  fromFilePath: string | null
  fromLine: number | null
  toFilePath: string | null
  toLine: number | null
  createdAt: Date
}

export interface ScanTaskRecord {
  id: string
  status: string
  engineMode: string
  progress: number
  totalFiles: number
  scannedFiles: number
  fallbackUsed: boolean
  fallbackFrom: string | null
  fallbackTo: string | null
  fallbackReason: string | null
  errorMessage: string | null
  errorCode: string | null
  createdAt: Date
  updatedAt: Date
}

export interface AdviceSnapshotRecord {
  id: string
  summary: string
  confidence: number
  triggerScore: number
  triggerReason: string
  sourceEvent: string
  metricsFingerprint: string
  actionItems: string
  rawResponse: string | null
  createdAt: Date
  updatedAt: Date
}

export interface AdviceDecisionRecord {
  id: string
  sourceEvent: string
  sourceTaskId: string | null
  sourceVulnerabilityId: string | null
  triggerScore: number
  triggerReason: string
  metricsFingerprint: string
  shouldCallAi: boolean
  calledAi: boolean
  blockedReason: string | null
  llmError: string | null
  metricSnapshot: string
  adviceSnapshotId: string | null
  createdAt: Date
}

export interface MetaRecord {
  schemaVersion: string
  createdAt: string
  lastMigrationAt: string | null
  analysisCacheVersion: string
  stableFingerprintVersion: string
}

export interface Snapshot {
  vulnerabilities: VulnerabilityRecord[]
  vulnerabilityEvents: VulnerabilityEventRecord[]
  scanTasks: ScanTaskRecord[]
  adviceSnapshots: AdviceSnapshotRecord[]
  adviceDecisions: AdviceDecisionRecord[]
  config: PluginConfig | null
  configUpdatedAt: Date | null
  meta: MetaRecord
}

export interface PersistedSnapshot {
  vulnerabilities: Array<Omit<VulnerabilityRecord, 'createdAt' | 'updatedAt' | 'humanReviewedAt'> & {
    createdAt: string
    updatedAt: string
    humanReviewedAt: string | null
  }>
  vulnerabilityEvents: Array<Omit<VulnerabilityEventRecord, 'createdAt'> & { createdAt: string }>
  scanTasks: Array<Omit<ScanTaskRecord, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string }>
  adviceSnapshots: Array<Omit<AdviceSnapshotRecord, 'createdAt' | 'updatedAt'> & {
    createdAt: string
    updatedAt: string
  }>
  adviceDecisions: Array<Omit<AdviceDecisionRecord, 'createdAt'> & { createdAt: string }>
  config: PluginConfig | null
  configUpdatedAt: string | null
  meta: MetaRecord
}

export interface VulnerabilityInput {
  filePath: string
  line: number
  column: number
  endLine: number
  endColumn: number
  codeSnippet: string
  type: string
  cweId?: string | null
  severity: string
  description: string
  riskDescription?: string | null
  fixOldCode?: string | null
  fixNewCode?: string | null
  fixExplanation?: string | null
  aiModel?: string | null
  aiConfidence?: number | null
  aiReasoning?: string | null
  stableFingerprint?: string | null
  source?: 'sast' | 'dast'
  owaspCategory?: string | null
}

export interface LockTelemetry {
  waitMsSamples: number[]
  holdMsSamples: number[]
  timeoutCount: number
}

export interface WriteTelemetry {
  writeOps: number
}

export interface UpsertStorageMetrics {
  fs_write_ops_per_scan: number
  db_lock_wait_ms_p95: number
  db_lock_hold_ms_p95: number
  db_lock_timeout_count: number
}

export interface UpsertVulnerabilitiesResult {
  stableFingerprints: string[]
  relocationCount: number
  metrics: UpsertStorageMetrics
}

import type { ScanEngineMode } from '@/libs/types'

export type SyncPhaseMessage =
  | 'idle'
  | 'syncing_extension'
  | 'extension_failed'
  | 'syncing_backend'
  | 'backend_failed'
  | 'synced'

const SYNC_PHASE_LABELS: Record<SyncPhaseMessage, string> = {
  idle: '未儲存',
  syncing_extension: '設定同步中',
  extension_failed: '同步失敗',
  syncing_backend: '設定同步中',
  backend_failed: '同步失敗',
  synced: '同步成功',
}

const ENGINE_MODE_LABELS: Record<ScanEngineMode, string> = {
  agentic_beta: '智慧多代理分析',
  baseline: '基準分析引擎',
}

export function getSyncPhaseLabel(phase: SyncPhaseMessage): string {
  return SYNC_PHASE_LABELS[phase]
}

export function getEngineModeLabel(mode: ScanEngineMode): string {
  return ENGINE_MODE_LABELS[mode]
}

export function toMoreInfo(detail?: string | null): string | undefined {
  const cleaned = detail?.trim()
  if (!cleaned) return undefined
  return `更多資訊：${cleaned}`
}

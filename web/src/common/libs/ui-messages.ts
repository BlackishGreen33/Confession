import type { ResolvedLocale } from '@/libs/i18n'
import type { ScanEngineMode } from '@/libs/types'

export type SyncPhaseMessage =
  | 'idle'
  | 'syncing_extension'
  | 'extension_failed'
  | 'syncing_backend'
  | 'backend_failed'
  | 'synced'

const SYNC_PHASE_LABELS: Record<ResolvedLocale, Record<SyncPhaseMessage, string>> = {
  'zh-TW': {
    idle: '未儲存',
    syncing_extension: '設定同步中',
    extension_failed: '同步失敗',
    syncing_backend: '設定同步中',
    backend_failed: '同步失敗',
    synced: '同步成功',
  },
  'zh-CN': {
    idle: '未保存',
    syncing_extension: '设置同步中',
    extension_failed: '同步失败',
    syncing_backend: '设置同步中',
    backend_failed: '同步失败',
    synced: '同步成功',
  },
  en: {
    idle: 'Unsaved',
    syncing_extension: 'Syncing settings',
    extension_failed: 'Sync failed',
    syncing_backend: 'Syncing settings',
    backend_failed: 'Sync failed',
    synced: 'Synced',
  },
}

const ENGINE_MODE_LABELS: Record<ResolvedLocale, Record<ScanEngineMode, string>> = {
  'zh-TW': {
    agentic_beta: '智慧多代理分析',
    baseline: '基準分析引擎',
  },
  'zh-CN': {
    agentic_beta: '智能多代理分析',
    baseline: '基准分析引擎',
  },
  en: {
    agentic_beta: 'Agentic Multi-Agent Analysis',
    baseline: 'Baseline Analysis Engine',
  },
}

export function getSyncPhaseLabel(
  phase: SyncPhaseMessage,
  locale: ResolvedLocale = 'zh-TW',
): string {
  return SYNC_PHASE_LABELS[locale][phase]
}

export function getEngineModeLabel(
  mode: ScanEngineMode,
  locale: ResolvedLocale = 'zh-TW',
): string {
  return ENGINE_MODE_LABELS[locale][mode]
}

export function toMoreInfo(
  detail?: string | null,
  locale: ResolvedLocale = 'zh-TW',
): string | undefined {
  const cleaned = detail?.trim()
  if (!cleaned) return undefined

  switch (locale) {
    case 'zh-CN':
      return `更多信息：${cleaned}`
    case 'en':
      return `More info: ${cleaned}`
    default:
      return `更多資訊：${cleaned}`
  }
}

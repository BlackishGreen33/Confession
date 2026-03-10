import type { ScanProgressEvent } from '@server/scan-progress-bus'

import type { ScanEngineMode, ScanErrorCode } from '@/libs/types'

interface ScanTaskRecordLike {
  id?: unknown
  status?: unknown
  progress?: unknown
  totalFiles?: unknown
  scannedFiles?: unknown
  engineMode?: unknown
  fallbackUsed?: unknown
  fallbackFrom?: unknown
  fallbackTo?: unknown
  fallbackReason?: unknown
  errorMessage?: unknown
  errorCode?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

export function toScanProgressEvent(task: ScanTaskRecordLike): ScanProgressEvent {
  const fallbackUsed = Boolean(task.fallbackUsed)
  const createdAt = toDateOrNow(task.createdAt)
  const updatedAt = toDateOrNow(task.updatedAt)
  return {
    id: typeof task.id === 'string' ? task.id : '',
    status: normalizeTaskStatus(task.status),
    progress: typeof task.progress === 'number' ? task.progress : 0,
    totalFiles: typeof task.totalFiles === 'number' ? task.totalFiles : 0,
    scannedFiles: typeof task.scannedFiles === 'number' ? task.scannedFiles : 0,
    engineMode: normalizeEngineMode(task.engineMode),
    fallbackUsed,
    fallbackFrom: fallbackUsed
      ? normalizeFallbackFrom(
          typeof task.fallbackFrom === 'string' ? task.fallbackFrom : null,
        )
      : undefined,
    fallbackTo: fallbackUsed
      ? normalizeFallbackTo(
          typeof task.fallbackTo === 'string' ? task.fallbackTo : null,
        )
      : undefined,
    fallbackReason: fallbackUsed
      ? normalizeFallbackReason(
          typeof task.fallbackReason === 'string' ? task.fallbackReason : null,
        )
      : undefined,
    errorMessage: typeof task.errorMessage === 'string' ? task.errorMessage : null,
    errorCode: normalizeErrorCode(
      typeof task.errorCode === 'string' ? task.errorCode : null,
    ),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  }
}

function normalizeTaskStatus(value: unknown): ScanProgressEvent['status'] {
  if (value === 'running' || value === 'completed' || value === 'failed') {
    return value
  }
  return 'pending'
}

function normalizeEngineMode(value: unknown): ScanEngineMode {
  return value === 'agentic_beta' ? 'agentic_beta' : 'baseline'
}

function toDateOrNow(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date()
}

function normalizeErrorCode(value: string | null): ScanErrorCode | null {
  if (value === 'BETA_ENGINE_FAILED') return value
  if (value === 'LLM_ANALYSIS_FAILED') return value
  if (value === 'UNKNOWN') return value
  return null
}

function normalizeFallbackFrom(
  value: string | null,
): 'agentic_beta' | undefined {
  return value === 'agentic_beta' ? 'agentic_beta' : undefined
}

function normalizeFallbackTo(value: string | null): 'baseline' | undefined {
  return value === 'baseline' ? 'baseline' : undefined
}

function normalizeFallbackReason(value: string | null): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

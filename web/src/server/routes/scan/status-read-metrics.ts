import {
  getLatestScanProgress,
  getMostRecentScanProgress,
  rememberScanProgress,
  type ScanProgressEvent,
} from '@server/scan-progress-bus'

import { toScanProgressEvent } from './progress-event'

interface StatusReadTelemetry {
  totalReads: number
  cacheHits: number
  reloadMsSamples: number[]
}

interface ReadResult {
  event: ScanProgressEvent | null
  metrics: StatusReadMetrics
  shouldLog: boolean
}

export interface StatusReadMetrics {
  status_cache_hit_rate: number
  status_cache_reload_ms: number
  status_read_elapsed_ms: number
}

const MAX_RELOAD_MS_SAMPLES = 512
const telemetry: StatusReadTelemetry = {
  totalReads: 0,
  cacheHits: 0,
  reloadMsSamples: [],
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const rawIndex = Math.ceil(sorted.length * ratio) - 1
  const index = Math.max(0, Math.min(sorted.length - 1, rawIndex))
  return sorted[index]
}

function round(value: number, digits = 4): number {
  const base = 10 ** digits
  return Math.round(value * base) / base
}

function recordStatusRead(
  cacheHit: boolean,
  reloadMs: number,
  readElapsedMs: number,
): { metrics: StatusReadMetrics; shouldLog: boolean } {
  telemetry.totalReads += 1
  if (cacheHit) {
    telemetry.cacheHits += 1
  } else if (reloadMs > 0) {
    telemetry.reloadMsSamples.push(reloadMs)
    if (telemetry.reloadMsSamples.length > MAX_RELOAD_MS_SAMPLES) {
      telemetry.reloadMsSamples.shift()
    }
  }

  const hitRate =
    telemetry.totalReads > 0 ? telemetry.cacheHits / telemetry.totalReads : 0

  const metrics = {
    status_cache_hit_rate: round(hitRate, 4),
    status_cache_reload_ms: round(
      percentile(telemetry.reloadMsSamples, 0.95),
      2,
    ),
    status_read_elapsed_ms: round(readElapsedMs, 2),
  }
  return {
    metrics,
    shouldLog: !cacheHit || telemetry.totalReads % 100 === 0,
  }
}

export async function readScanStatusWithHotIndex(
  taskId: string,
  loader: () => Promise<unknown | null>,
): Promise<ReadResult> {
  const readStartedAt = Date.now()
  const cached = getLatestScanProgress(taskId)
  if (cached) {
    const { metrics, shouldLog } = recordStatusRead(
      true,
      0,
      Math.max(0, Date.now() - readStartedAt),
    )
    return {
      event: cached,
      metrics,
      shouldLog,
    }
  }

  const reloadStartedAt = Date.now()
  const loaded = await loader()
  const reloadMs = Math.max(0, Date.now() - reloadStartedAt)
  if (!loaded) {
    const { metrics, shouldLog } = recordStatusRead(
      false,
      reloadMs,
      Math.max(0, Date.now() - readStartedAt),
    )
    return {
      event: null,
      metrics,
      shouldLog,
    }
  }

  const event = toScanProgressEvent(loaded as Record<string, unknown>)
  rememberScanProgress(event)

  const { metrics, shouldLog } = recordStatusRead(
    false,
    reloadMs,
    Math.max(0, Date.now() - readStartedAt),
  )
  return {
    event,
    metrics,
    shouldLog,
  }
}

export async function readRecentScanWithHotIndex(
  loader: () => Promise<unknown | null>,
): Promise<ReadResult> {
  const readStartedAt = Date.now()
  const cached = getMostRecentScanProgress()
  if (cached) {
    const { metrics, shouldLog } = recordStatusRead(
      true,
      0,
      Math.max(0, Date.now() - readStartedAt),
    )
    return {
      event: cached,
      metrics,
      shouldLog,
    }
  }

  const reloadStartedAt = Date.now()
  const loaded = await loader()
  const reloadMs = Math.max(0, Date.now() - reloadStartedAt)
  if (!loaded) {
    const { metrics, shouldLog } = recordStatusRead(
      false,
      reloadMs,
      Math.max(0, Date.now() - readStartedAt),
    )
    return {
      event: null,
      metrics,
      shouldLog,
    }
  }

  const event = toScanProgressEvent(loaded as Record<string, unknown>)
  rememberScanProgress(event)

  const { metrics, shouldLog } = recordStatusRead(
    false,
    reloadMs,
    Math.max(0, Date.now() - readStartedAt),
  )
  return {
    event,
    metrics,
    shouldLog,
  }
}

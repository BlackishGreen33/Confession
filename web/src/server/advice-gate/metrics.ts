import {
  computeTrendInsights,
  type TrendSnapshotPoint,
} from '@/libs/dashboard-insights'
import type { HealthResponseV2 } from '@/libs/types'

import { buildHealthResponse } from '../health-score'
import { storage } from '../storage'
import {
  deduplicateVulnerabilities,
  type VulnerabilityDedupCandidate,
} from '../vulnerability-dedupe'
import type { AdviceTriggerMetrics } from './types'

export interface AdviceMetricContext {
  metrics: AdviceTriggerMetrics
  health: HealthResponseV2
}

interface DedupMetricsRow extends VulnerabilityDedupCandidate {
  status: string
  humanStatus: string
}

interface TrendEventRow {
  createdAt: Date
  eventType: string
  fromStatus: string | null
  toStatus: string | null
}

export async function collectAdviceMetricContext(
  now: Date,
): Promise<AdviceMetricContext> {
  const [health, vulnerabilityRows, trend] = await Promise.all([
    buildHealthResponse(now, { riskWindowDays: 30 }),
    storage.vulnerability.findMany({
      select: {
        filePath: true,
        line: true,
        column: true,
        endLine: true,
        endColumn: true,
        type: true,
        cweId: true,
        severity: true,
        description: true,
        codeSnippet: true,
        aiConfidence: true,
        stableFingerprint: true,
        status: true,
        humanStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    loadTrendPointsFromEvents(),
  ])

  const deduped = deduplicateVulnerabilities(
    vulnerabilityRows as unknown as DedupMetricsRow[],
  )
  const open = deduped.filter((item) => item.status === 'open')
  const criticalOpen = open.filter((item) => item.severity === 'critical').length
  const highOpen = open.filter((item) => item.severity === 'high').length
  const pendingOpen = open.filter((item) => item.humanStatus === 'pending').length
  const highRiskMix = open.length > 0 ? (criticalOpen + highOpen) / open.length : 0
  const pendingReviewPressure = open.length > 0 ? pendingOpen / open.length : 0

  const trendInsights = computeTrendInsights(trend)

  return {
    metrics: {
      healthScore: health.score.value,
      reliabilityScore: health.score.components.reliability.value,
      fallbackRate: health.score.components.reliability.fallbackRate,
      openCount: open.length,
      criticalOpenCount: criticalOpen,
      highOpenCount: highOpen,
      pendingOpenCount: pendingOpen,
      highRiskMix,
      pendingReviewPressure,
      trendPressureHigh: trendInsights.pressureHigh,
      openNet7d: trendInsights.openNet7d ?? 0,
    },
    health,
  }
}

async function loadTrendPointsFromEvents(): Promise<TrendSnapshotPoint[] | null> {
  const rowsRaw = await storage.vulnerabilityEvent.findMany({
    where: {
      eventType: { in: ['scan_detected', 'status_changed'] },
    },
    select: {
      createdAt: true,
      eventType: true,
      fromStatus: true,
      toStatus: true,
    },
    orderBy: { createdAt: 'asc' },
  })
  const rows = rowsRaw as unknown as TrendEventRow[]

  if (rows.length === 0) return null

  const daily = new Map<
    string,
    { total: number; open: number; fixed: number; ignored: number }
  >()

  for (const row of rows) {
    const date = row.createdAt.toISOString().slice(0, 10)
    const current = daily.get(date) ?? {
      total: 0,
      open: 0,
      fixed: 0,
      ignored: 0,
    }

    if (row.eventType === 'scan_detected') {
      current.total += 1
      current.open += 1
    } else if (row.eventType === 'status_changed') {
      if (row.fromStatus === 'open') current.open -= 1
      if (row.fromStatus === 'fixed') current.fixed -= 1
      if (row.fromStatus === 'ignored') current.ignored -= 1

      if (row.toStatus === 'open') current.open += 1
      if (row.toStatus === 'fixed') current.fixed += 1
      if (row.toStatus === 'ignored') current.ignored += 1
    }

    daily.set(date, current)
  }

  const sorted = [...daily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, delta]) => ({ date, ...delta }))

  let total = 0
  let open = 0
  let fixed = 0
  let ignored = 0

  return sorted.map((row) => {
    total += row.total
    open += row.open
    fixed += row.fixed
    ignored += row.ignored
    return {
      date: row.date,
      total,
      open,
      fixed,
      ignored,
    }
  })
}

import type { HealthResponseV2 } from '@/libs/types'

import {
  buildTopFactors,
  computeExposureScore,
  computeQualityScore,
  computeReliabilityScore,
  computeRemediationScore,
  DAY_MS,
  geometricWeightedScore,
  type HealthScoreBuildOptions,
  type HealthScoreInput,
  type HealthScoreInputTask,
  type HealthScoreInputVulnerability,
  normalizeEngineMode,
  normalizeTaskStatus,
  normalizeWindowDays,
  round,
  toHealthGrade,
  toHealthStatus,
} from './health-score-core'
import { storage } from './storage'
import { deduplicateVulnerabilities } from './vulnerability-dedupe'

export async function buildHealthResponse(
  now: Date = new Date(),
  options: HealthScoreBuildOptions = {},
): Promise<HealthResponseV2> {
  const riskWindowDays = normalizeWindowDays(options.riskWindowDays, 30)
  const reliabilityWindowDays = normalizeWindowDays(
    options.reliabilityWindowDays,
    7,
  )
  const recentReliabilityWindow = new Date(
    now.getTime() - reliabilityWindowDays * DAY_MS,
  )

  const [vulnerabilities, scanTasks, latestTask] = await Promise.all([
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
        aiConfidence: true,
        stableFingerprint: true,
        status: true,
        humanStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    storage.scanTask.findMany({
      where: { updatedAt: { gte: recentReliabilityWindow } },
      select: {
        id: true,
        status: true,
        engineMode: true,
        fallbackUsed: true,
        totalFiles: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    }),
    storage.scanTask.findFirst({
      select: {
        id: true,
        status: true,
        engineMode: true,
        fallbackUsed: true,
        totalFiles: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    }),
  ])

  return calculateHealthScore(
    {
      vulnerabilities: vulnerabilities as unknown as HealthScoreInputVulnerability[],
      scanTasks: scanTasks as unknown as HealthScoreInputTask[],
      latestTask: (latestTask as unknown as HealthScoreInputTask | null) ?? null,
      now,
    },
    { riskWindowDays },
  )
}

export function calculateHealthScore(
  input: HealthScoreInput,
  options: Pick<HealthScoreBuildOptions, 'riskWindowDays'> = {},
): HealthResponseV2 {
  const { vulnerabilities, scanTasks, latestTask, now } = input
  const nowTs = now.getTime()
  const riskWindowDays = normalizeWindowDays(options.riskWindowDays, 30)
  const recentRiskWindow = new Date(nowTs - riskWindowDays * DAY_MS)

  const deduped = deduplicateVulnerabilities(vulnerabilities)
  const openVulns = deduped.filter((item) => item.status === 'open')
  const recentDetected = deduped.filter(
    (item) => item.createdAt.getTime() >= recentRiskWindow.getTime(),
  )

  const exposure = computeExposureScore(openVulns, nowTs)
  const remediation = computeRemediationScore(
    deduped,
    recentDetected,
    recentRiskWindow,
  )
  const quality = computeQualityScore(recentDetected)
  const reliability = computeReliabilityScore(scanTasks)

  const scoreValue = geometricWeightedScore({
    exposure: exposure.value,
    remediation: remediation.value,
    quality: quality.value,
    reliability: reliability.value,
  })
  const topFactors = buildTopFactors({
    exposure,
    remediation,
    quality,
    reliability,
  })
  const grade = toHealthGrade(scoreValue)
  const status = toHealthStatus(
    scoreValue,
    reliability.successRate,
    latestTask?.status ?? null,
  )

  return {
    status,
    evaluatedAt: now.toISOString(),
    score: {
      version: 'v2',
      value: round(scoreValue, 2),
      grade,
      components: {
        exposure: {
          value: round(exposure.value, 2),
          orb: round(exposure.orb, 4),
          lev: round(exposure.lev, 4),
        },
        remediation: {
          value: round(remediation.value, 2),
          mttrHours: round(remediation.mttrHours, 2),
          closureRate: round(remediation.closureRate, 4),
        },
        quality: {
          value: round(quality.value, 2),
          efficiency: round(quality.efficiency, 4),
          coverage: round(quality.coverage, 4),
        },
        reliability: {
          value: round(reliability.value, 2),
          successRate: round(reliability.successRate, 4),
          fallbackRate: round(reliability.fallbackRate, 4),
          workspaceP95Ms: Math.round(reliability.workspaceP95Ms),
        },
      },
      topFactors,
    },
    engine: {
      latestTaskId: latestTask?.id,
      latestStatus: normalizeTaskStatus(latestTask?.status),
      latestEngineMode: normalizeEngineMode(latestTask?.engineMode),
    },
  }
}

export type {
  HealthScoreBuildOptions,
  HealthScoreInput,
  HealthScoreInputTask,
  HealthScoreInputVulnerability,
} from './health-score-core'

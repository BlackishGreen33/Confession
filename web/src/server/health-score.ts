import type { HealthGrade, HealthResponseV2, HealthStatus, ScanEngineMode } from '@/libs/types'

import { prisma } from './db'
import { deduplicateVulnerabilities } from './vulnerability-dedupe'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const SCORE_WEIGHT = {
  exposure: 0.4,
  remediation: 0.25,
  quality: 0.2,
  reliability: 0.15,
} as const
const LATENCY_TARGET_MS = 180_000

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 8,
  high: 5,
  medium: 3,
  low: 1.5,
  info: 0.7,
}

const HUMAN_STATUS_MULTIPLIER: Record<string, number> = {
  pending: 1,
  confirmed: 1.15,
  rejected: 0.25,
  false_positive: 0.1,
}

const DEFAULT_CONFIDENCE_BY_SEVERITY: Record<string, number> = {
  critical: 0.85,
  high: 0.75,
  medium: 0.6,
  low: 0.45,
  info: 0.3,
}

export interface HealthScoreInputVulnerability {
  filePath: string
  line: number
  column: number
  endLine: number
  endColumn: number
  type: string
  cweId: string | null
  severity: string
  description: string
  aiConfidence: number | null
  status: string
  humanStatus: string
  createdAt: Date
  updatedAt: Date
}

export interface HealthScoreInputTask {
  id: string
  status: string
  engineMode: string
  fallbackUsed: boolean
  totalFiles: number
  createdAt: Date
  updatedAt: Date
}

export interface HealthScoreInput {
  vulnerabilities: HealthScoreInputVulnerability[]
  scanTasks: HealthScoreInputTask[]
  latestTask: HealthScoreInputTask | null
  now: Date
}

export interface HealthScoreBuildOptions {
  riskWindowDays?: number
  reliabilityWindowDays?: number
}

export async function buildHealthResponse(
  now: Date = new Date(),
  options: HealthScoreBuildOptions = {},
): Promise<HealthResponseV2> {
  const riskWindowDays = normalizeWindowDays(options.riskWindowDays, 30)
  const reliabilityWindowDays = normalizeWindowDays(options.reliabilityWindowDays, 7)
  const recentReliabilityWindow = new Date(now.getTime() - reliabilityWindowDays * DAY_MS)

  const [vulnerabilities, scanTasks, latestTask] = await Promise.all([
    prisma.vulnerability.findMany({
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
        status: true,
        humanStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.scanTask.findMany({
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
    prisma.scanTask.findFirst({
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

  return calculateHealthScore({
    vulnerabilities,
    scanTasks,
    latestTask,
    now,
  }, { riskWindowDays })
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
  const recentDetected = deduped.filter((item) => item.createdAt.getTime() >= recentRiskWindow.getTime())

  const exposure = computeExposureScore(openVulns, nowTs)
  const remediation = computeRemediationScore(deduped, recentDetected, recentRiskWindow)
  const quality = computeQualityScore(recentDetected)
  const reliability = computeReliabilityScore(scanTasks)

  const scoreValue = geometricWeightedScore({
    exposure: exposure.value,
    remediation: remediation.value,
    quality: quality.value,
    reliability: reliability.value,
  })
  const grade = toHealthGrade(scoreValue)
  const status = toHealthStatus(scoreValue, reliability.successRate, latestTask?.status ?? null)

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
    },
    engine: {
      latestTaskId: latestTask?.id,
      latestStatus: normalizeTaskStatus(latestTask?.status),
      latestEngineMode: normalizeEngineMode(latestTask?.engineMode),
    },
  }
}

function computeExposureScore(items: HealthScoreInputVulnerability[], nowTs: number): {
  value: number
  orb: number
  lev: number
} {
  if (items.length === 0) {
    return { value: 100, orb: 0, lev: 0 }
  }

  const risks: number[] = []
  let levComplement = 1

  for (const item of items) {
    const severityWeight = SEVERITY_WEIGHT[item.severity] ?? 1
    const probability = estimateExploitProbability(item.aiConfidence, item.severity, item.humanStatus)
    const ageDays = Math.max(0, (nowTs - item.createdAt.getTime()) / DAY_MS)
    const ageFactor = 1 + (Math.min(ageDays, 30) / 30) * 0.5
    const risk = severityWeight * probability * ageFactor
    risks.push(risk)
    levComplement *= 1 - probability
  }

  const orb = risks.reduce((sum, value) => sum + value, 0)
  const p75 = percentile(risks, 0.75)
  const calibrationK = Math.max(6, p75 * Math.max(4, Math.sqrt(risks.length)))
  const value = 100 * Math.exp(-orb / calibrationK)
  const lev = 1 - levComplement

  return { value: clamp(value, 0, 100), orb, lev: clamp(lev, 0, 1) }
}

function computeRemediationScore(
  deduped: HealthScoreInputVulnerability[],
  recentDetected: HealthScoreInputVulnerability[],
  recent30d: Date,
): { value: number; mttrHours: number; closureRate: number } {
  const fixedRecently = deduped.filter(
    (item) => item.status === 'fixed' && item.updatedAt.getTime() >= recent30d.getTime(),
  )
  const mttrSamples = fixedRecently.map((item) =>
    Math.max(0, (item.updatedAt.getTime() - item.createdAt.getTime()) / HOUR_MS),
  )
  const mttrHours = percentile(mttrSamples, 0.5)
  const closureRate =
    recentDetected.length > 0
      ? recentDetected.filter((item) => item.status === 'fixed').length / recentDetected.length
      : 1

  const sMttr = 100 * Math.exp(-mttrHours / 72)
  const value = 0.7 * sMttr + 0.3 * (closureRate * 100)
  return {
    value: clamp(value, 0, 100),
    mttrHours,
    closureRate: clamp(closureRate, 0, 1),
  }
}

function computeQualityScore(recentDetected: HealthScoreInputVulnerability[]): {
  value: number
  efficiency: number
  coverage: number
} {
  if (recentDetected.length === 0) {
    return { value: 100, efficiency: 1, coverage: 1 }
  }

  const reviewed = recentDetected.filter((item) => item.humanStatus !== 'pending')
  const confirmed = reviewed.filter((item) => item.humanStatus === 'confirmed').length
  const falsePositive = reviewed.filter((item) => item.humanStatus === 'false_positive').length

  const efficiencyDen = confirmed + falsePositive
  const efficiency = efficiencyDen > 0 ? confirmed / efficiencyDen : 0.7
  const coverage = reviewed.length / recentDetected.length
  const value = 100 * (0.65 * efficiency + 0.35 * coverage)

  return {
    value: clamp(value, 0, 100),
    efficiency: clamp(efficiency, 0, 1),
    coverage: clamp(coverage, 0, 1),
  }
}

function computeReliabilityScore(tasks: HealthScoreInputTask[]): {
  value: number
  successRate: number
  fallbackRate: number
  workspaceP95Ms: number
} {
  if (tasks.length === 0) {
    return {
      value: 100,
      successRate: 1,
      fallbackRate: 0,
      workspaceP95Ms: 0,
    }
  }

  const completed = tasks.filter((item) => item.status === 'completed').length
  const successRate = completed / tasks.length

  const agenticScans = tasks.filter(
    (item) => item.engineMode === 'agentic_beta' || item.fallbackUsed,
  ).length
  const fallbackCount = tasks.filter((item) => item.fallbackUsed).length
  const fallbackRate = agenticScans > 0 ? fallbackCount / agenticScans : 0

  const workspaceDurations = tasks
    .filter((item) => item.totalFiles > 1)
    .map((item) => item.updatedAt.getTime() - item.createdAt.getTime())
  const durationSamples =
    workspaceDurations.length > 0
      ? workspaceDurations
      : tasks.map((item) => item.updatedAt.getTime() - item.createdAt.getTime())

  const workspaceP95Ms = percentile(durationSamples, 0.95)
  const latencyPenalty = Math.max(0, workspaceP95Ms - LATENCY_TARGET_MS) / LATENCY_TARGET_MS
  const sLatency = 100 * Math.exp(-latencyPenalty)

  const value = 0.5 * (successRate * 100) + 0.2 * ((1 - fallbackRate) * 100) + 0.3 * sLatency
  return {
    value: clamp(value, 0, 100),
    successRate: clamp(successRate, 0, 1),
    fallbackRate: clamp(fallbackRate, 0, 1),
    workspaceP95Ms: Math.max(0, workspaceP95Ms),
  }
}

function estimateExploitProbability(
  aiConfidence: number | null,
  severity: string,
  humanStatus: string,
): number {
  const baseConfidence =
    typeof aiConfidence === 'number' && Number.isFinite(aiConfidence)
      ? normalizeConfidence(aiConfidence)
      : DEFAULT_CONFIDENCE_BY_SEVERITY[severity] ?? 0.5

  const humanMultiplier = HUMAN_STATUS_MULTIPLIER[humanStatus] ?? 1
  const calibrated = baseConfidence * humanMultiplier
  return clamp(calibrated, 0, 1)
}

function normalizeConfidence(value: number): number {
  if (value > 1) return clamp(value / 100, 0, 1)
  return clamp(value, 0, 1)
}

function geometricWeightedScore(values: {
  exposure: number
  remediation: number
  quality: number
  reliability: number
}): number {
  const normalizedExposure = Math.max(0.0001, values.exposure / 100)
  const normalizedRemediation = Math.max(0.0001, values.remediation / 100)
  const normalizedQuality = Math.max(0.0001, values.quality / 100)
  const normalizedReliability = Math.max(0.0001, values.reliability / 100)

  const product =
    Math.pow(normalizedExposure, SCORE_WEIGHT.exposure) *
    Math.pow(normalizedRemediation, SCORE_WEIGHT.remediation) *
    Math.pow(normalizedQuality, SCORE_WEIGHT.quality) *
    Math.pow(normalizedReliability, SCORE_WEIGHT.reliability)

  return clamp(product * 100, 0, 100)
}

function toHealthGrade(score: number): HealthGrade {
  if (score >= 90) return 'A+'
  if (score >= 80) return 'A'
  if (score >= 70) return 'B+'
  if (score >= 60) return 'B'
  if (score >= 45) return 'C'
  return 'D'
}

function toHealthStatus(
  score: number,
  successRate: number,
  latestTaskStatus: string | null,
): HealthStatus {
  if (latestTaskStatus === 'failed' && successRate < 0.5) {
    return 'down'
  }
  if (score < 60 || latestTaskStatus === 'failed' || successRate < 0.8) {
    return 'degraded'
  }
  return 'ok'
}

function normalizeTaskStatus(value: string | undefined): 'pending' | 'running' | 'completed' | 'failed' | undefined {
  if (!value) return undefined
  if (value === 'pending' || value === 'running' || value === 'completed' || value === 'failed') {
    return value
  }
  return undefined
}

function normalizeEngineMode(value: string | undefined): ScanEngineMode | undefined {
  if (!value) return undefined
  return value === 'agentic_beta' ? 'agentic_beta' : 'baseline'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits = 2): number {
  const p = 10 ** digits
  return Math.round(value * p) / p
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const pos = clamp(p, 0, 1) * (sorted.length - 1)
  const lower = Math.floor(pos)
  const upper = Math.ceil(pos)
  if (lower === upper) return sorted[lower]
  const weight = pos - lower
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

function normalizeWindowDays(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const normalized = Math.floor(value)
  if (normalized <= 0) return fallback
  return Math.min(normalized, 90)
}

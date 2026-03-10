import {
  generateAdvicePayload,
  normalizeBlockedReason,
  normalizeSourceEvent,
  parseStoredActions,
} from './advice-gate/generation'
import {
  evaluateAdviceDecisionGuards,
  isAdviceStale,
  startOfUtcDay,
} from './advice-gate/guards'
import { collectAdviceMetricContext } from './advice-gate/metrics'
import {
  computeAdviceMetricsFingerprint,
  computeAdviceTriggerScore,
} from './advice-gate/scoring'
import type {
  AdviceGateTriggerInput,
  AdviceLatestResponse,
  AdviceTriggerMetrics,
} from './advice-gate/types'
import { loadRuntimeLlmConfigFromStorage } from './runtime-llm-config'
import { storage } from './storage'

export {
  ADVICE_SOURCE_EVENTS,
  type AdviceActionItem,
  type AdviceBlockedReason,
  type AdviceGuardInput,
  type AdviceGuardResult,
  type AdvicePayload,
  type AdviceSourceEvent,
  type AdviceTriggerContribution,
  type AdviceTriggerScoreResult,
} from './advice-gate/types'

export { computeAdviceTriggerScore, evaluateAdviceDecisionGuards, isAdviceStale }

interface LastCalledDecisionRow {
  createdAt: Date
  metricsFingerprint: string | null
}

interface LatestAdviceSnapshotRow {
  summary: string
  confidence: number
  triggerScore: number
  triggerReason: string
  sourceEvent: string
  actionItems: string
  updatedAt: Date
}

interface LatestAdviceDecisionRow {
  createdAt: Date
  triggerScore: number
  triggerReason: string
  sourceEvent: string
  blockedReason: string | null
}

export function triggerAdviceEvaluation(input: AdviceGateTriggerInput): void {
  void evaluateAdviceGate(input).catch((err) => {
    process.stdout.write(
      `[Confession][AdviceGate] ${JSON.stringify({
        sourceEvent: input.sourceEvent,
        sourceTaskId: input.sourceTaskId,
        sourceVulnerabilityId: input.sourceVulnerabilityId,
        error: err instanceof Error ? err.message : String(err),
      })}\n`,
    )
  })
}

export async function evaluateAdviceGate(
  input: AdviceGateTriggerInput,
  now: Date = new Date(),
): Promise<void> {
  const context = await collectAdviceMetricContext(now)
  const score = computeAdviceTriggerScore(context.metrics)
  const metricsFingerprint = computeAdviceMetricsFingerprint(context.metrics)

  const [lastCalledRaw, dailyCallCount] = await Promise.all([
    storage.adviceDecision.findFirst({
      where: { calledAi: true },
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        metricsFingerprint: true,
      },
    }),
    storage.adviceDecision.count({
      where: {
        calledAi: true,
        createdAt: { gte: startOfUtcDay(now) },
      },
    }),
  ])
  const lastCalled = lastCalledRaw as LastCalledDecisionRow | null

  const guard = evaluateAdviceDecisionGuards({
    triggerScore: score.triggerScore,
    metricsFingerprint,
    now,
    lastCalledAt: lastCalled?.createdAt,
    lastCalledFingerprint: lastCalled?.metricsFingerprint,
    dailyCallCount,
  })

  const decision = await storage.adviceDecision.create({
    data: {
      sourceEvent: input.sourceEvent,
      sourceTaskId: input.sourceTaskId,
      sourceVulnerabilityId: input.sourceVulnerabilityId,
      triggerScore: score.triggerScore,
      triggerReason: score.triggerReason,
      metricsFingerprint,
      shouldCallAi: guard.shouldCallAi,
      calledAi: false,
      blockedReason: guard.blockedReason,
      metricSnapshot: JSON.stringify({
        ...context.metrics,
        contributions: score.contributions,
        healthTopFactors: context.health.score.topFactors,
      }),
    },
    select: { id: true },
  })

  if (!guard.shouldCallAi) {
    process.stdout.write(
      `[Confession][AdviceGate] ${JSON.stringify({
        sourceEvent: input.sourceEvent,
        triggerScore: score.triggerScore,
        blockedReason: guard.blockedReason,
      })}\n`,
    )
    return
  }

  let snapshotId: string | null = null
  let llmError: string | null = null

  try {
    const llmConfig = await loadRuntimeLlmConfigFromStorage()
    const payload = await generateAdvicePayload({
      sourceEvent: input.sourceEvent,
      triggerScore: score.triggerScore,
      triggerReason: score.triggerReason,
      metrics: context.metrics,
      health: context.health,
      llmConfig,
    })

    const snapshotRaw = await storage.adviceSnapshot.create({
      data: {
        summary: payload.summary,
        confidence: payload.confidence,
        triggerScore: score.triggerScore,
        triggerReason: score.triggerReason,
        sourceEvent: input.sourceEvent,
        metricsFingerprint,
        actionItems: JSON.stringify(payload.actions),
        rawResponse: JSON.stringify(payload),
      },
      select: { id: true },
    })
    const snapshot = snapshotRaw as { id: string }
    snapshotId = snapshot.id
  } catch (err) {
    llmError = err instanceof Error ? err.message : String(err)
  }

  await storage.adviceDecision.update({
    where: { id: decision.id },
    data: {
      calledAi: true,
      adviceSnapshotId: snapshotId,
      llmError,
    },
  })

  process.stdout.write(
    `[Confession][AdviceGate] ${JSON.stringify({
      sourceEvent: input.sourceEvent,
      triggerScore: score.triggerScore,
      calledAi: true,
      adviceUpdated: Boolean(snapshotId),
      llmError,
    })}\n`,
  )
}

export async function getLatestAdvice(
  now: Date = new Date(),
): Promise<AdviceLatestResponse> {
  const [latestSnapshotRaw, latestDecisionRaw] = await Promise.all([
    storage.adviceSnapshot.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        summary: true,
        confidence: true,
        triggerScore: true,
        triggerReason: true,
        sourceEvent: true,
        actionItems: true,
        updatedAt: true,
      },
    }),
    storage.adviceDecision.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        createdAt: true,
        triggerScore: true,
        triggerReason: true,
        sourceEvent: true,
        blockedReason: true,
      },
    }),
  ])
  const latestSnapshot = latestSnapshotRaw as LatestAdviceSnapshotRow | null
  const latestDecision = latestDecisionRaw as LatestAdviceDecisionRow | null

  if (!latestSnapshot && !latestDecision) {
    return {
      available: false,
      evaluatedAt: null,
      triggerScore: null,
      triggerReason: null,
      sourceEvent: null,
      stale: true,
      blockedReason: null,
      advice: null,
    }
  }

  const parsedActions = parseStoredActions(latestSnapshot?.actionItems)
  const sourceEvent = normalizeSourceEvent(
    latestDecision?.sourceEvent ?? latestSnapshot?.sourceEvent,
  )

  return {
    available: Boolean(latestSnapshot),
    evaluatedAt: latestDecision?.createdAt.toISOString() ?? null,
    triggerScore: latestDecision?.triggerScore ?? latestSnapshot?.triggerScore ?? null,
    triggerReason:
      latestDecision?.triggerReason ?? latestSnapshot?.triggerReason ?? null,
    sourceEvent,
    stale: latestSnapshot ? isAdviceStale(latestSnapshot.updatedAt, now) : true,
    blockedReason: normalizeBlockedReason(latestDecision?.blockedReason),
    advice: latestSnapshot
      ? {
          summary: latestSnapshot.summary,
          confidence: clamp(latestSnapshot.confidence, 0, 1),
          actions: parsedActions,
        }
      : null,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export type { AdviceGateTriggerInput, AdviceLatestResponse, AdviceTriggerMetrics }

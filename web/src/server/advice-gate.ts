import { createHash } from 'crypto';
import { z } from 'zod/v4';

import {
  computeTrendInsights,
  type TrendSnapshotPoint,
} from '@/libs/dashboard-insights';
import type { HealthResponseV2 } from '@/libs/types';

import { computeLlmPromptFingerprint, llmResponseCache } from './cache';
import { prisma } from './db';
import { buildHealthResponse } from './health-score';
import {
  callLlm,
  configFromEnv,
  configFromPlugin,
  type LlmCallResult,
  type LlmClientConfig,
  resolveDefaultModel,
} from './llm/client';
import { deduplicateVulnerabilities } from './vulnerability-dedupe';

export const ADVICE_SOURCE_EVENTS = [
  'scan_completed',
  'scan_failed',
  'review_saved',
  'status_changed',
] as const;

export type AdviceSourceEvent = (typeof ADVICE_SOURCE_EVENTS)[number];

export type AdviceBlockedReason =
  | 'threshold_not_met'
  | 'cooldown_active'
  | 'same_fingerprint'
  | 'daily_limit_reached';

export interface AdviceActionItem {
  title: string;
  reason: string;
  expectedImpact: string;
}

export interface AdvicePayload {
  summary: string;
  confidence: number;
  actions: AdviceActionItem[];
}

export interface AdviceLatestResponse {
  available: boolean;
  evaluatedAt: string | null;
  triggerScore: number | null;
  triggerReason: string | null;
  sourceEvent: AdviceSourceEvent | null;
  stale: boolean;
  blockedReason: AdviceBlockedReason | null;
  advice: AdvicePayload | null;
}

export interface AdviceTriggerMetrics {
  healthScore: number;
  reliabilityScore: number;
  fallbackRate: number;
  openCount: number;
  criticalOpenCount: number;
  highOpenCount: number;
  pendingOpenCount: number;
  highRiskMix: number;
  pendingReviewPressure: number;
  trendPressureHigh: boolean;
  openNet7d: number;
}

export interface AdviceTriggerContribution {
  key: 'exposure' | 'reliability' | 'trend' | 'review';
  label: string;
  pressure: number;
}

export interface AdviceTriggerScoreResult {
  triggerScore: number;
  triggerReason: string;
  contributions: AdviceTriggerContribution[];
}

export interface AdviceGuardInput {
  triggerScore: number;
  metricsFingerprint: string;
  now: Date;
  lastCalledAt?: Date | null;
  lastCalledFingerprint?: string | null;
  dailyCallCount: number;
}

export interface AdviceGuardResult {
  shouldCallAi: boolean;
  blockedReason: AdviceBlockedReason | null;
}

export interface AdviceGateTriggerInput {
  sourceEvent: AdviceSourceEvent;
  sourceTaskId?: string;
  sourceVulnerabilityId?: string;
}

const ADVICE_TRIGGER_THRESHOLD = 55;
const ADVICE_COOLDOWN_HOURS = 6;
const ADVICE_DAILY_CALL_LIMIT = 6;
const ADVICE_STALE_HOURS = 72;
const ADVICE_LLM_TIMEOUT_MS = 30_000;
const ADVICE_PROMPT_VERSION = 'advice-v1';

const adviceResponseSchema = z.object({
  summary: z.string().min(8).max(280),
  confidence: z.number().min(0).max(1),
  actions: z
    .array(
      z.object({
        title: z.string().min(4).max(40),
        reason: z.string().min(8).max(180),
        expectedImpact: z.string().min(4).max(120),
      })
    )
    .length(3),
});

const storedActionsSchema = z.array(
  z.object({
    title: z.string(),
    reason: z.string(),
    expectedImpact: z.string(),
  })
);

const persistedConfigSchema = z.object({
  llm: z
    .object({
      provider: z.enum(['gemini', 'nvidia']).optional(),
      apiKey: z.string().nullable().optional(),
      endpoint: z.string().nullable().optional(),
      model: z.string().nullable().optional(),
    })
    .optional(),
});

interface AdviceMetricContext {
  metrics: AdviceTriggerMetrics;
  health: HealthResponseV2;
}

export function computeAdviceTriggerScore(
  metrics: AdviceTriggerMetrics
): AdviceTriggerScoreResult {
  const exposurePressure = clamp((metrics.highRiskMix - 0.2) / 0.5, 0, 1);
  const reliabilityPressure = clamp(
    Math.max(
      (70 - metrics.reliabilityScore) / 40,
      (metrics.fallbackRate - 0.08) / 0.22,
      metrics.healthScore < 60 ? (60 - metrics.healthScore) / 60 : 0
    ),
    0,
    1
  );
  const trendPressure = metrics.trendPressureHigh
    ? 1
    : metrics.openNet7d > 0
      ? clamp(metrics.openNet7d / Math.max(4, metrics.openCount || 1), 0, 0.85)
      : 0;
  const reviewPressure = clamp(
    (metrics.pendingReviewPressure - 0.2) / 0.4,
    0,
    1
  );

  const contributions: AdviceTriggerContribution[] = [
    { key: 'exposure', label: '高風險曝險', pressure: exposurePressure },
    { key: 'reliability', label: '掃描可靠度', pressure: reliabilityPressure },
    { key: 'trend', label: '風險演進壓力', pressure: trendPressure },
    { key: 'review', label: '審核堆積', pressure: reviewPressure },
  ];

  const triggerScore = round(
    (exposurePressure * 0.35 +
      reliabilityPressure * 0.3 +
      trendPressure * 0.2 +
      reviewPressure * 0.15) *
      100,
    2
  );

  const dominant = contributions
    .filter((item) => item.pressure >= 0.15)
    .sort((a, b) => b.pressure - a.pressure)
    .slice(0, 2);

  const triggerReason =
    dominant.length > 0
      ? `觸發壓力：${dominant.map((item) => `${item.label} ${(item.pressure * 100).toFixed(0)}%`).join('、')}`
      : '目前指標波動仍低於建議觸發區間';

  return { triggerScore, triggerReason, contributions };
}

export function evaluateAdviceDecisionGuards(
  input: AdviceGuardInput
): AdviceGuardResult {
  if (input.triggerScore < ADVICE_TRIGGER_THRESHOLD) {
    return { shouldCallAi: false, blockedReason: 'threshold_not_met' };
  }

  if (
    input.lastCalledFingerprint &&
    input.lastCalledFingerprint === input.metricsFingerprint
  ) {
    return { shouldCallAi: false, blockedReason: 'same_fingerprint' };
  }

  if (input.lastCalledAt) {
    const cooldownMs = ADVICE_COOLDOWN_HOURS * 60 * 60 * 1000;
    if (input.now.getTime() - input.lastCalledAt.getTime() < cooldownMs) {
      return { shouldCallAi: false, blockedReason: 'cooldown_active' };
    }
  }

  if (input.dailyCallCount >= ADVICE_DAILY_CALL_LIMIT) {
    return { shouldCallAi: false, blockedReason: 'daily_limit_reached' };
  }

  return { shouldCallAi: true, blockedReason: null };
}

export function isAdviceStale(
  updatedAt: Date,
  now: Date = new Date()
): boolean {
  const staleMs = ADVICE_STALE_HOURS * 60 * 60 * 1000;
  return now.getTime() - updatedAt.getTime() > staleMs;
}

export function triggerAdviceEvaluation(input: AdviceGateTriggerInput): void {
  void evaluateAdviceGate(input).catch((err) => {
    process.stdout.write(
      `[Confession][AdviceGate] ${JSON.stringify({
        sourceEvent: input.sourceEvent,
        sourceTaskId: input.sourceTaskId,
        sourceVulnerabilityId: input.sourceVulnerabilityId,
        error: err instanceof Error ? err.message : String(err),
      })}\n`
    );
  });
}

export async function evaluateAdviceGate(
  input: AdviceGateTriggerInput,
  now: Date = new Date()
): Promise<void> {
  try {
    const context = await collectAdviceMetricContext(now);
    const score = computeAdviceTriggerScore(context.metrics);
    const metricsFingerprint = computeAdviceMetricsFingerprint(context.metrics);

    const [lastCalled, dailyCallCount] = await Promise.all([
      prisma.adviceDecision.findFirst({
        where: { calledAi: true },
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          metricsFingerprint: true,
        },
      }),
      prisma.adviceDecision.count({
        where: {
          calledAi: true,
          createdAt: { gte: startOfUtcDay(now) },
        },
      }),
    ]);

    const guard = evaluateAdviceDecisionGuards({
      triggerScore: score.triggerScore,
      metricsFingerprint,
      now,
      lastCalledAt: lastCalled?.createdAt,
      lastCalledFingerprint: lastCalled?.metricsFingerprint,
      dailyCallCount,
    });

    const decision = await prisma.adviceDecision.create({
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
    });

    if (!guard.shouldCallAi) {
      process.stdout.write(
        `[Confession][AdviceGate] ${JSON.stringify({
          sourceEvent: input.sourceEvent,
          triggerScore: score.triggerScore,
          blockedReason: guard.blockedReason,
        })}\n`
      );
      return;
    }

    let snapshotId: string | null = null;
    let llmError: string | null = null;

    try {
      const llmConfig = await loadAdviceLlmConfigFromDb();
      const payload = await generateAdvicePayload({
        sourceEvent: input.sourceEvent,
        triggerScore: score.triggerScore,
        triggerReason: score.triggerReason,
        metrics: context.metrics,
        health: context.health,
        llmConfig,
      });

      const snapshot = await prisma.adviceSnapshot.create({
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
      });

      snapshotId = snapshot.id;
    } catch (err) {
      llmError = err instanceof Error ? err.message : String(err);
    }

    await prisma.adviceDecision.update({
      where: { id: decision.id },
      data: {
        calledAi: true,
        adviceSnapshotId: snapshotId,
        llmError,
      },
    });

    process.stdout.write(
      `[Confession][AdviceGate] ${JSON.stringify({
        sourceEvent: input.sourceEvent,
        triggerScore: score.triggerScore,
        calledAi: true,
        adviceUpdated: Boolean(snapshotId),
        llmError,
      })}\n`
    );
  } catch (err) {
    if (isMissingAdviceTablesError(err)) {
      process.stdout.write(
        `[Confession][AdviceGate] ${JSON.stringify({
          sourceEvent: input.sourceEvent,
          skipped: true,
          reason: 'missing_advice_tables',
        })}\n`
      );
      return;
    }
    throw err;
  }
}

export async function getLatestAdvice(
  now: Date = new Date()
): Promise<AdviceLatestResponse> {
  try {
    const [latestSnapshot, latestDecision] = await Promise.all([
      prisma.adviceSnapshot.findFirst({
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
      prisma.adviceDecision.findFirst({
        orderBy: { createdAt: 'desc' },
        select: {
          createdAt: true,
          triggerScore: true,
          triggerReason: true,
          sourceEvent: true,
          blockedReason: true,
        },
      }),
    ]);

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
      };
    }

    const parsedActions = parseStoredActions(latestSnapshot?.actionItems);
    const sourceEvent = normalizeSourceEvent(
      latestDecision?.sourceEvent ?? latestSnapshot?.sourceEvent
    );

    return {
      available: Boolean(latestSnapshot),
      evaluatedAt: latestDecision?.createdAt.toISOString() ?? null,
      triggerScore:
        latestDecision?.triggerScore ?? latestSnapshot?.triggerScore ?? null,
      triggerReason:
        latestDecision?.triggerReason ?? latestSnapshot?.triggerReason ?? null,
      sourceEvent,
      stale: latestSnapshot
        ? isAdviceStale(latestSnapshot.updatedAt, now)
        : true,
      blockedReason: normalizeBlockedReason(latestDecision?.blockedReason),
      advice: latestSnapshot
        ? {
            summary: latestSnapshot.summary,
            confidence: clamp(latestSnapshot.confidence, 0, 1),
            actions: parsedActions,
          }
        : null,
    };
  } catch (err) {
    if (!isMissingAdviceTablesError(err)) throw err;
    return {
      available: false,
      evaluatedAt: null,
      triggerScore: null,
      triggerReason: null,
      sourceEvent: null,
      stale: true,
      blockedReason: null,
      advice: null,
    };
  }
}

async function collectAdviceMetricContext(
  now: Date
): Promise<AdviceMetricContext> {
  const [health, vulnerabilityRows, trend] = await Promise.all([
    buildHealthResponse(now, { riskWindowDays: 30 }),
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
        codeSnippet: true,
        aiConfidence: true,
        status: true,
        humanStatus: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    loadTrendPointsFromEvents(),
  ]);

  const deduped = deduplicateVulnerabilities(vulnerabilityRows);
  const open = deduped.filter((item) => item.status === 'open');
  const criticalOpen = open.filter(
    (item) => item.severity === 'critical'
  ).length;
  const highOpen = open.filter((item) => item.severity === 'high').length;
  const pendingOpen = open.filter(
    (item) => item.humanStatus === 'pending'
  ).length;
  const highRiskMix =
    open.length > 0 ? (criticalOpen + highOpen) / open.length : 0;
  const pendingReviewPressure = open.length > 0 ? pendingOpen / open.length : 0;

  const trendInsights = computeTrendInsights(trend);

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
  };
}

async function loadTrendPointsFromEvents(): Promise<
  TrendSnapshotPoint[] | null
> {
  try {
    const rows = await prisma.vulnerabilityEvent.findMany({
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
    });

    if (rows.length === 0) return null;

    const daily = new Map<
      string,
      { total: number; open: number; fixed: number; ignored: number }
    >();

    for (const row of rows) {
      const date = row.createdAt.toISOString().slice(0, 10);
      const current = daily.get(date) ?? {
        total: 0,
        open: 0,
        fixed: 0,
        ignored: 0,
      };

      if (row.eventType === 'scan_detected') {
        current.total += 1;
        current.open += 1;
      } else if (row.eventType === 'status_changed') {
        if (row.fromStatus === 'open') current.open -= 1;
        if (row.fromStatus === 'fixed') current.fixed -= 1;
        if (row.fromStatus === 'ignored') current.ignored -= 1;

        if (row.toStatus === 'open') current.open += 1;
        if (row.toStatus === 'fixed') current.fixed += 1;
        if (row.toStatus === 'ignored') current.ignored += 1;
      }

      daily.set(date, current);
    }

    const sorted = [...daily.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, delta]) => ({ date, ...delta }));

    let total = 0;
    let open = 0;
    let fixed = 0;
    let ignored = 0;

    return sorted.map((row) => {
      total += row.total;
      open += row.open;
      fixed += row.fixed;
      ignored += row.ignored;
      return {
        date: row.date,
        total,
        open,
        fixed,
        ignored,
      };
    });
  } catch (err) {
    if (isMissingEventsTableError(err)) return null;
    throw err;
  }
}

function computeAdviceMetricsFingerprint(
  metrics: AdviceTriggerMetrics
): string {
  const stable = {
    healthScore: round(metrics.healthScore, 1),
    reliabilityScore: round(metrics.reliabilityScore, 1),
    fallbackRate: round(metrics.fallbackRate, 4),
    openCount: metrics.openCount,
    criticalOpenCount: metrics.criticalOpenCount,
    highOpenCount: metrics.highOpenCount,
    pendingOpenCount: metrics.pendingOpenCount,
    highRiskMix: round(metrics.highRiskMix, 4),
    pendingReviewPressure: round(metrics.pendingReviewPressure, 4),
    trendPressureHigh: metrics.trendPressureHigh,
    openNet7d: metrics.openNet7d,
  };
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

async function generateAdvicePayload(input: {
  sourceEvent: AdviceSourceEvent;
  triggerScore: number;
  triggerReason: string;
  metrics: AdviceTriggerMetrics;
  health: HealthResponseV2;
  llmConfig?: LlmClientConfig;
}): Promise<AdvicePayload> {
  const config = input.llmConfig ?? configFromEnv();
  const modelName = config.model ?? resolveDefaultModel(config.provider);
  const prompt = buildAdvicePrompt(input);
  const key = computeLlmPromptFingerprint(prompt, modelName, 'standard', {
    strategyVersion: ADVICE_PROMPT_VERSION,
    engineMode: 'baseline',
    agentRole: 'advice',
    contextDigest: computeAdviceMetricsFingerprint(input.metrics),
  });

  const cached = llmResponseCache.get(key);
  const rawText =
    cached?.text ?? (await callLlmWithTimeout(prompt, config)).text;

  if (!cached) {
    llmResponseCache.set(key, {
      text: rawText,
      usage: {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      },
    });
  }

  const parsed = parseAdviceResponse(rawText);
  if (!parsed) {
    throw new Error('AI 建議解析失敗，略過覆蓋既有建議');
  }

  return parsed;
}

function buildAdvicePrompt(input: {
  sourceEvent: AdviceSourceEvent;
  triggerScore: number;
  triggerReason: string;
  metrics: AdviceTriggerMetrics;
  health: HealthResponseV2;
}): string {
  const factors = input.health.score.topFactors
    .map((item) => `- ${item.label}(${item.valueText})：${item.reason}`)
    .join('\n');

  return [
    '你是 Confession 的資安決策助理。',
    '請依據輸入指標輸出「下一步三件事」給工程團隊。',
    '只回傳 JSON，禁止額外說明。',
    '',
    '回傳 JSON Schema：',
    '{',
    '  "summary": "一句重點（繁體中文）",',
    '  "confidence": 0.0,',
    '  "actions": [',
    '    {"title": "行動標題", "reason": "為何現在做", "expectedImpact": "預期影響"},',
    '    {"title": "行動標題", "reason": "為何現在做", "expectedImpact": "預期影響"},',
    '    {"title": "行動標題", "reason": "為何現在做", "expectedImpact": "預期影響"}',
    '  ]',
    '}',
    '',
    '規則：',
    '- action 只能 3 項，依優先度由高到低。',
    '- summary 需可直接放進 Dashboard。',
    '- confidence 範圍 0..1。',
    '- 不得建議背景輪詢或連續觸發模型。',
    '',
    '事件：',
    `- sourceEvent: ${input.sourceEvent}`,
    `- triggerScore: ${input.triggerScore}`,
    `- triggerReason: ${input.triggerReason}`,
    '',
    '指標快照：',
    `- healthScore: ${input.metrics.healthScore.toFixed(1)}`,
    `- reliabilityScore: ${input.metrics.reliabilityScore.toFixed(1)}`,
    `- fallbackRate: ${(input.metrics.fallbackRate * 100).toFixed(1)}%`,
    `- openCount: ${input.metrics.openCount}`,
    `- criticalOpenCount: ${input.metrics.criticalOpenCount}`,
    `- highOpenCount: ${input.metrics.highOpenCount}`,
    `- pendingOpenCount: ${input.metrics.pendingOpenCount}`,
    `- highRiskMix: ${(input.metrics.highRiskMix * 100).toFixed(1)}%`,
    `- pendingReviewPressure: ${(input.metrics.pendingReviewPressure * 100).toFixed(1)}%`,
    `- trendPressureHigh: ${input.metrics.trendPressureHigh ? 'true' : 'false'}`,
    `- openNet7d: ${input.metrics.openNet7d}`,
    '',
    'Top Factors：',
    factors || '- 無',
  ].join('\n');
}

function parseAdviceResponse(raw: string): AdvicePayload | null {
  const cleaned = stripCodeFence(raw);
  try {
    const parsed = JSON.parse(cleaned);
    const result = adviceResponseSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const match = /^```(?:\w+)?\s*\n([\s\S]*?)\n\s*```$/.exec(trimmed);
  return match ? match[1] : trimmed;
}

async function callLlmWithTimeout(
  prompt: string,
  config: LlmClientConfig
): Promise<LlmCallResult> {
  const abortController = new globalThis.AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;

  try {
    timer = setTimeout(() => abortController.abort(), ADVICE_LLM_TIMEOUT_MS);
    return await callLlm(prompt, config, { signal: abortController.signal });
  } catch (err) {
    if (isAbortError(err)) {
      throw new Error('AI 建議生成逾時');
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseStoredActions(value: string | undefined): AdviceActionItem[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    const result = storedActionsSchema.safeParse(parsed);
    return result.success ? result.data : [];
  } catch {
    return [];
  }
}

function normalizeSourceEvent(
  value: string | undefined
): AdviceSourceEvent | null {
  if (!value) return null;
  return (ADVICE_SOURCE_EVENTS as readonly string[]).includes(value)
    ? (value as AdviceSourceEvent)
    : null;
}

function normalizeBlockedReason(
  value: string | null | undefined
): AdviceBlockedReason | null {
  if (!value) return null;
  if (value === 'threshold_not_met') return value;
  if (value === 'cooldown_active') return value;
  if (value === 'same_fingerprint') return value;
  if (value === 'daily_limit_reached') return value;
  return null;
}

function normalizeOptional(
  value: string | null | undefined
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNvidiaModel(model: string | undefined): string | undefined {
  if (model !== 'deepseek-ai/deepseek-r1') return model;
  return 'qwen/qwen2.5-coder-32b-instruct';
}

async function loadAdviceLlmConfigFromDb(): Promise<
  LlmClientConfig | undefined
> {
  const row = await prisma.config.findUnique({ where: { id: 'default' } });
  if (!row) return undefined;

  try {
    const parsed = persistedConfigSchema.safeParse(JSON.parse(row.data));
    if (!parsed.success || !parsed.data.llm) {
      return undefined;
    }

    const provider = parsed.data.llm.provider ?? 'nvidia';
    const model = normalizeOptional(parsed.data.llm.model);

    return configFromPlugin({
      provider,
      apiKey: normalizeOptional(parsed.data.llm.apiKey) ?? '',
      endpoint: normalizeOptional(parsed.data.llm.endpoint),
      model: provider === 'nvidia' ? normalizeNvidiaModel(model) : model,
    });
  } catch {
    return undefined;
  }
}

function startOfUtcDay(now: Date): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 2): number {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function isAbortError(err: unknown): boolean {
  return Boolean(
    err &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

function isMissingEventsTableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code =
    typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : '';
  const message =
    typeof (err as { message?: unknown }).message === 'string'
      ? (err as { message: string }).message
      : '';
  return code === 'P2021' || /vulnerability_events/i.test(message);
}

function isMissingAdviceTablesError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code =
    typeof (err as { code?: unknown }).code === 'string'
      ? (err as { code: string }).code
      : '';
  const message =
    typeof (err as { message?: unknown }).message === 'string'
      ? (err as { message: string }).message
      : '';
  return code === 'P2021' || /advice_snapshots|advice_decisions/i.test(message);
}

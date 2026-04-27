import { createHash } from 'node:crypto';
import path from 'node:path';

import { z } from 'zod/v4';

import type { PluginConfig } from '@/libs/types';

import { resolveProjectRoot } from './bootstrap';
import type { MetaRecord, PersistedSnapshot, Snapshot } from './types';

const SCHEMA_VERSION = 'file-store-v1';
const ANALYSIS_CACHE_VERSION = 'analysis-cache-v1';
const STABLE_FINGERPRINT_VERSION = 'stable-fingerprint-v1';

export const DEFAULT_CONFIG: PluginConfig = {
  llm: { provider: 'nvidia', apiKey: '' },
  analysis: { triggerMode: 'onSave', depth: 'standard', debounceMs: 500 },
  ignore: { paths: [], types: [] },
  api: { baseUrl: 'http://localhost:3000', mode: 'local' },
  ui: { language: 'auto' },
};

const persistedSnapshotSchema = z
  .object({
    vulnerabilities: z.array(z.record(z.string(), z.unknown())).optional(),
    vulnerabilityEvents: z.array(z.record(z.string(), z.unknown())).optional(),
    scanTasks: z.array(z.record(z.string(), z.unknown())).optional(),
    adviceSnapshots: z.array(z.record(z.string(), z.unknown())).optional(),
    adviceDecisions: z.array(z.record(z.string(), z.unknown())).optional(),
    config: z.unknown().optional(),
    configUpdatedAt: z.union([z.string(), z.null()]).optional(),
    meta: z.record(z.string(), z.unknown()).optional(),
  })
  .partial();

export function now(): Date {
  return new Date();
}

export function toDate(value: unknown, fallback = new Date(0)): Date {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date(fallback.getTime());
}

export function cloneValue<T>(value: T): T {
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T;
  }

  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>
    )) {
      output[key] = cloneValue(item);
    }
    return output as T;
  }

  return value;
}

function normalizeStableFingerprintSnippet(codeSnippet: string): string {
  return codeSnippet
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '$STR')
    .replace(/\b\d+\b/g, '$NUM')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function normalizeStableFingerprintPath(filePath: string): string {
  const projectRoot = resolveProjectRoot();
  const rel = path.relative(projectRoot, filePath);
  const normalized = rel && !rel.startsWith('..') ? rel : filePath;
  return normalized.replace(/\\/g, '/').toLowerCase();
}

export function createStableFingerprint(input: {
  filePath: string;
  type: string;
  codeSnippet: string;
  index: number;
}): string {
  const normalizedPath = normalizeStableFingerprintPath(input.filePath);
  const normalizedType = input.type.trim().toLowerCase();
  const normalizedSnippet = normalizeStableFingerprintSnippet(
    input.codeSnippet
  );
  const normalizedIndex = Math.max(1, Math.floor(input.index));
  const payload = `${normalizedPath}::${normalizedType}::${normalizedSnippet}::${normalizedIndex}`;
  return createHash('sha256').update(payload).digest('hex');
}

function defaultMeta(): MetaRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now().toISOString(),
    lastMigrationAt: null,
    analysisCacheVersion: ANALYSIS_CACHE_VERSION,
    stableFingerprintVersion: STABLE_FINGERPRINT_VERSION,
  };
}

export function normalizeMetaRecord(raw: unknown): MetaRecord {
  const defaults = defaultMeta();
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }

  const input = raw as {
    schemaVersion?: unknown;
    createdAt?: unknown;
    lastMigrationAt?: unknown;
    analysisCacheVersion?: unknown;
    stableFingerprintVersion?: unknown;
  };

  return {
    schemaVersion:
      typeof input.schemaVersion === 'string' &&
      input.schemaVersion.trim().length > 0
        ? input.schemaVersion
        : defaults.schemaVersion,
    createdAt:
      typeof input.createdAt === 'string' && input.createdAt.trim().length > 0
        ? input.createdAt
        : defaults.createdAt,
    lastMigrationAt:
      typeof input.lastMigrationAt === 'string' &&
      input.lastMigrationAt.trim().length > 0
        ? input.lastMigrationAt
        : null,
    analysisCacheVersion:
      typeof input.analysisCacheVersion === 'string' &&
      input.analysisCacheVersion.trim().length > 0
        ? input.analysisCacheVersion
        : defaults.analysisCacheVersion,
    stableFingerprintVersion:
      typeof input.stableFingerprintVersion === 'string' &&
      input.stableFingerprintVersion.trim().length > 0
        ? input.stableFingerprintVersion
        : defaults.stableFingerprintVersion,
  };
}

export function normalizeScanTaskEngineMode(value: unknown): string {
  if (value === 'baseline') return 'baseline';
  if (value === 'agentic' || value === 'agentic_beta') return 'agentic';
  return 'agentic';
}

export function normalizeScanTaskFallbackFrom(value: unknown): string | null {
  if (value === 'agentic' || value === 'agentic_beta') return 'agentic';
  return typeof value === 'string' ? value : null;
}

export function normalizeScanTaskErrorCode(value: unknown): string | null {
  if (value === 'AGENTIC_ENGINE_FAILED' || value === 'BETA_ENGINE_FAILED') {
    return 'AGENTIC_ENGINE_FAILED';
  }
  return typeof value === 'string' ? value : null;
}

export function normalizeLlmProvider(
  value: unknown
): PluginConfig['llm']['provider'] {
  if (value === 'gemini' || value === 'nvidia' || value === 'minimax-cn') {
    return value;
  }
  return 'nvidia';
}

export function defaultSnapshot(): Snapshot {
  return {
    vulnerabilities: [],
    vulnerabilityEvents: [],
    scanTasks: [],
    adviceSnapshots: [],
    adviceDecisions: [],
    config: cloneValue(DEFAULT_CONFIG),
    configUpdatedAt: now(),
    meta: defaultMeta(),
  };
}

export function serializeSnapshot(snapshot: Snapshot): PersistedSnapshot {
  return {
    vulnerabilities: snapshot.vulnerabilities.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      humanReviewedAt: item.humanReviewedAt
        ? item.humanReviewedAt.toISOString()
        : null,
    })),
    vulnerabilityEvents: snapshot.vulnerabilityEvents.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
    })),
    scanTasks: snapshot.scanTasks.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    adviceSnapshots: snapshot.adviceSnapshots.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    adviceDecisions: snapshot.adviceDecisions.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
    })),
    config: snapshot.config,
    configUpdatedAt: snapshot.configUpdatedAt
      ? snapshot.configUpdatedAt.toISOString()
      : null,
    meta: snapshot.meta,
  };
}

function emitDecodeWarning(
  reason: string,
  details?: Record<string, unknown>
): void {
  process.stdout.write(
    `[Confession][StorageSnapshotDecodeWarning] ${JSON.stringify({
      reason,
      ...(details ?? {}),
    })}\n`
  );
}

export function decodeSnapshot(raw: unknown): Snapshot {
  const parsed = persistedSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    emitDecodeWarning('schema_validation_failed', {
      issueCount: parsed.error.issues.length,
      firstIssuePath: parsed.error.issues[0]?.path ?? [],
    });
  }

  const input = (
    parsed.success ? parsed.data : raw && typeof raw === 'object' ? raw : {}
  ) as Partial<PersistedSnapshot>;

  return {
    vulnerabilities: Array.isArray(input.vulnerabilities)
      ? input.vulnerabilities.map((item) => ({
          ...item,
          cweId: item.cweId ?? null,
          riskDescription: item.riskDescription ?? null,
          fixOldCode: item.fixOldCode ?? null,
          fixNewCode: item.fixNewCode ?? null,
          fixExplanation: item.fixExplanation ?? null,
          aiModel: item.aiModel ?? null,
          aiConfidence:
            typeof item.aiConfidence === 'number' ? item.aiConfidence : null,
          aiReasoning: item.aiReasoning ?? null,
          stableFingerprint:
            typeof item.stableFingerprint === 'string' &&
            item.stableFingerprint.trim().length > 0
              ? item.stableFingerprint
              : createStableFingerprint({
                  filePath: item.filePath,
                  type: item.type,
                  codeSnippet: item.codeSnippet,
                  index: 1,
                }),
          source: item.source === 'dast' ? 'dast' : 'sast',
          humanStatus: item.humanStatus ?? 'pending',
          humanComment: item.humanComment ?? null,
          humanReviewedAt: item.humanReviewedAt
            ? toDate(item.humanReviewedAt, now())
            : null,
          owaspCategory: item.owaspCategory ?? null,
          status: item.status ?? 'open',
          createdAt: toDate(item.createdAt, now()),
          updatedAt: toDate(item.updatedAt, now()),
        }))
      : [],
    vulnerabilityEvents: Array.isArray(input.vulnerabilityEvents)
      ? input.vulnerabilityEvents.map((item) => ({
          ...item,
          fromStatus: item.fromStatus ?? null,
          toStatus: item.toStatus ?? null,
          fromHumanStatus: item.fromHumanStatus ?? null,
          toHumanStatus: item.toHumanStatus ?? null,
          fromFilePath: item.fromFilePath ?? null,
          fromLine: typeof item.fromLine === 'number' ? item.fromLine : null,
          toFilePath: item.toFilePath ?? null,
          toLine: typeof item.toLine === 'number' ? item.toLine : null,
          createdAt: toDate(item.createdAt, now()),
        }))
      : [],
    scanTasks: Array.isArray(input.scanTasks)
      ? input.scanTasks.map((item) => ({
          ...item,
          status: item.status ?? 'pending',
          engineMode: normalizeScanTaskEngineMode(item.engineMode),
          progress: typeof item.progress === 'number' ? item.progress : 0,
          totalFiles: typeof item.totalFiles === 'number' ? item.totalFiles : 0,
          scannedFiles:
            typeof item.scannedFiles === 'number' ? item.scannedFiles : 0,
          fallbackUsed: Boolean(item.fallbackUsed),
          fallbackFrom: normalizeScanTaskFallbackFrom(item.fallbackFrom),
          fallbackTo: item.fallbackTo ?? null,
          fallbackReason: item.fallbackReason ?? null,
          errorMessage: item.errorMessage ?? null,
          errorCode: normalizeScanTaskErrorCode(item.errorCode),
          createdAt: toDate(item.createdAt, now()),
          updatedAt: toDate(item.updatedAt, now()),
        }))
      : [],
    adviceSnapshots: Array.isArray(input.adviceSnapshots)
      ? input.adviceSnapshots.map((item) => ({
          ...item,
          rawResponse: item.rawResponse ?? null,
          createdAt: toDate(item.createdAt, now()),
          updatedAt: toDate(item.updatedAt, now()),
        }))
      : [],
    adviceDecisions: Array.isArray(input.adviceDecisions)
      ? input.adviceDecisions.map((item) => ({
          ...item,
          sourceTaskId: item.sourceTaskId ?? null,
          sourceVulnerabilityId: item.sourceVulnerabilityId ?? null,
          shouldCallAi: Boolean(item.shouldCallAi),
          calledAi: Boolean(item.calledAi),
          blockedReason: item.blockedReason ?? null,
          llmError: item.llmError ?? null,
          adviceSnapshotId: item.adviceSnapshotId ?? null,
          createdAt: toDate(item.createdAt, now()),
        }))
      : [],
    config: normalizeConfigValue(input.config),
    configUpdatedAt: input.configUpdatedAt
      ? toDate(input.configUpdatedAt, now())
      : now(),
    meta: normalizeMetaRecord(input.meta),
  };
}

export function normalizeConfigValue(raw: unknown): PluginConfig {
  if (!raw || typeof raw !== 'object') return cloneValue(DEFAULT_CONFIG);
  const input = raw as {
    llm?: {
      provider?: PluginConfig['llm']['provider'];
      apiKey?: string;
      endpoint?: string | null;
      model?: string | null;
    };
    analysis?: {
      triggerMode?: PluginConfig['analysis']['triggerMode'];
      depth?: PluginConfig['analysis']['depth'];
      debounceMs?: number;
    };
    ignore?: {
      paths?: string[];
      types?: string[];
    };
    api?: {
      baseUrl?: string;
      mode?: PluginConfig['api']['mode'];
    };
    ui?: {
      language?: PluginConfig['ui']['language'];
    };
  };

  const config: PluginConfig = {
    llm: {
      provider: normalizeLlmProvider(input.llm?.provider),
      apiKey: typeof input.llm?.apiKey === 'string' ? input.llm.apiKey : '',
    },
    analysis: {
      triggerMode:
        input.analysis?.triggerMode === 'manual' ? 'manual' : 'onSave',
      depth:
        input.analysis?.depth === 'quick' || input.analysis?.depth === 'deep'
          ? input.analysis.depth
          : 'standard',
      debounceMs:
        typeof input.analysis?.debounceMs === 'number'
          ? Math.max(0, Math.floor(input.analysis.debounceMs))
          : 500,
    },
    ignore: {
      paths: Array.isArray(input.ignore?.paths) ? input.ignore.paths : [],
      types: Array.isArray(input.ignore?.types) ? input.ignore.types : [],
    },
    api: {
      baseUrl:
        typeof input.api?.baseUrl === 'string'
          ? input.api.baseUrl
          : 'http://localhost:3000',
      mode: input.api?.mode === 'remote' ? 'remote' : 'local',
    },
    ui: {
      language:
        input.ui?.language === 'zh-TW' ||
        input.ui?.language === 'zh-CN' ||
        input.ui?.language === 'en'
          ? input.ui.language
          : 'auto',
    },
  };

  if (typeof input.llm?.endpoint === 'string' && input.llm.endpoint.trim()) {
    config.llm.endpoint = input.llm.endpoint.trim();
  }
  if (typeof input.llm?.model === 'string' && input.llm.model.trim()) {
    config.llm.model = input.llm.model.trim();
  }

  return config;
}

export function extractConfigData(raw: unknown): PluginConfig {
  if (!raw || typeof raw !== 'object') return cloneValue(DEFAULT_CONFIG);
  const candidate = raw as { data?: unknown };
  if (typeof candidate.data === 'string') {
    try {
      return normalizeConfigValue(JSON.parse(candidate.data));
    } catch {
      emitDecodeWarning('config_json_parse_failed');
      return cloneValue(DEFAULT_CONFIG);
    }
  }
  return normalizeConfigValue(raw);
}

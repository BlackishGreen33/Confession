import { zValidator } from '@hono/zod-validator';
import { storage } from '@server/storage';
import { Hono } from 'hono';
import { z } from 'zod/v4';

import type { PluginConfig } from '@/libs/types';

/** 預設配置（與前端 atoms.ts 一致） */
const DEFAULT_CONFIG: PluginConfig = {
  llm: { provider: 'nvidia', apiKey: '' },
  analysis: { triggerMode: 'onSave', depth: 'standard', debounceMs: 500 },
  ignore: { paths: [] as string[], types: [] as string[] },
  api: { baseUrl: 'http://localhost:3000', mode: 'local' },
  ui: { language: 'auto' },
};

const configBodySchema = z.object({
  llm: z
    .object({
      provider: z.enum(['gemini', 'nvidia', 'minimax-cn']),
      apiKey: z.string(),
      endpoint: z.string().nullable().optional(),
      model: z.string().nullable().optional(),
    })
    .optional(),
  analysis: z
    .object({
      triggerMode: z.enum(['onSave', 'manual']),
      depth: z.enum(['quick', 'standard', 'deep']),
      debounceMs: z.number().int().min(0),
    })
    .optional(),
  ignore: z
    .object({
      paths: z.array(z.string()),
      types: z.array(z.string()),
    })
    .optional(),
  api: z
    .object({
      baseUrl: z.string(),
      mode: z.enum(['local', 'remote']),
    })
    .optional(),
  ui: z
    .object({
      language: z.enum(['auto', 'zh-TW', 'zh-CN', 'en']),
    })
    .optional(),
});

export const configRoutes = new Hono();

function normalizeLlmProvider(value: unknown): PluginConfig['llm']['provider'] {
  if (value === 'gemini' || value === 'nvidia' || value === 'minimax-cn') {
    return value;
  }
  return DEFAULT_CONFIG.llm.provider;
}

function normalizeConfig(raw: unknown): PluginConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_CONFIG;

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

  const endpoint = normalizeOptional(input.llm?.endpoint ?? undefined);
  const model = normalizeOptional(input.llm?.model ?? undefined);

  return {
    llm: {
      provider: normalizeLlmProvider(input.llm?.provider),
      apiKey: input.llm?.apiKey ?? DEFAULT_CONFIG.llm.apiKey,
      ...(endpoint ? { endpoint } : {}),
      ...(model ? { model } : {}),
    },
    analysis: {
      triggerMode:
        input.analysis?.triggerMode ?? DEFAULT_CONFIG.analysis.triggerMode,
      depth: input.analysis?.depth ?? DEFAULT_CONFIG.analysis.depth,
      debounceMs:
        typeof input.analysis?.debounceMs === 'number'
          ? input.analysis.debounceMs
          : DEFAULT_CONFIG.analysis.debounceMs,
    },
    ignore: {
      paths: Array.isArray(input.ignore?.paths)
        ? input.ignore.paths
        : DEFAULT_CONFIG.ignore.paths,
      types: Array.isArray(input.ignore?.types)
        ? input.ignore.types
        : DEFAULT_CONFIG.ignore.types,
    },
    api: {
      baseUrl: input.api?.baseUrl ?? DEFAULT_CONFIG.api.baseUrl,
      mode: input.api?.mode ?? DEFAULT_CONFIG.api.mode,
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
}

function normalizeOptional(
  value: string | null | undefined
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function mergeLlmConfig(
  prev: typeof DEFAULT_CONFIG.llm,
  nextPartial: z.infer<typeof configBodySchema>['llm']
): typeof DEFAULT_CONFIG.llm {
  if (!nextPartial) return prev;

  const merged: typeof DEFAULT_CONFIG.llm = { ...prev };

  if ('provider' in nextPartial) {
    merged.provider = nextPartial.provider;
  }
  if ('apiKey' in nextPartial) {
    merged.apiKey = nextPartial.apiKey;
  }

  if ('endpoint' in nextPartial) {
    const endpoint = normalizeOptional(nextPartial.endpoint);
    if (endpoint) {
      merged.endpoint = endpoint;
    } else {
      delete merged.endpoint;
    }
  }

  if ('model' in nextPartial) {
    const model = normalizeOptional(nextPartial.model);
    if (model) {
      merged.model = model;
    } else {
      delete merged.model;
    }
  }

  return merged;
}

/**
 * GET /api/config — 取得目前配置
 */
configRoutes.get('/', async (c) => {
  const row = await storage.config.findUnique({ where: { id: 'default' } });
  if (!row) return c.json(DEFAULT_CONFIG);
  return c.json(normalizeConfig(JSON.parse(row.data)));
});

/**
 * PUT /api/config — 儲存配置（完整覆寫）
 */
configRoutes.put('/', zValidator('json', configBodySchema), async (c) => {
  const body = c.req.valid('json');

  // 讀取現有配置，合併後寫入
  const existing = await storage.config.findUnique({
    where: { id: 'default' },
  });
  const prev = existing
    ? normalizeConfig(JSON.parse(existing.data))
    : DEFAULT_CONFIG;

  const merged = {
    llm: mergeLlmConfig(prev.llm, body.llm),
    analysis: { ...prev.analysis, ...body.analysis },
    ignore: { ...prev.ignore, ...body.ignore },
    api: { ...prev.api, ...body.api },
    ui: { ...prev.ui, ...body.ui },
  };

  await storage.config.upsert({
    where: { id: 'default' },
    create: { id: 'default', data: JSON.stringify(merged) },
    update: { data: JSON.stringify(merged) },
  });

  return c.json(merged);
});

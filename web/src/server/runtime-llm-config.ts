import { z } from 'zod/v4';

import { configFromPlugin, type LlmClientConfig } from './llm/client';
import { storage } from './storage';

const persistedConfigSchema = z.object({
  llm: z
    .object({
      provider: z.enum(['gemini', 'nvidia', 'minimax-cn']).optional(),
      apiKey: z.string().nullable().optional(),
      endpoint: z.string().nullable().optional(),
      model: z.string().nullable().optional(),
    })
    .optional(),
});

export function normalizeOptional(
  value: string | null | undefined
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeNvidiaModel(
  model: string | undefined
): string | undefined {
  if (model !== 'deepseek-ai/deepseek-r1') return model;
  return 'qwen/qwen2.5-coder-32b-instruct';
}

export async function loadRuntimeLlmConfigFromStorage(): Promise<
  LlmClientConfig | undefined
> {
  const row = await storage.config.findUnique({ where: { id: 'default' } });
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

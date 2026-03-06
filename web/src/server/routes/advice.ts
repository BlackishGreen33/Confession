import { getLatestAdvice } from '@server/advice-gate';
import { Hono } from 'hono';
import { z } from 'zod/v4';

const adviceSourceEventSchema = z.enum([
  'scan_completed',
  'scan_failed',
  'review_saved',
  'status_changed',
]);

const blockedReasonSchema = z.enum([
  'threshold_not_met',
  'cooldown_active',
  'same_fingerprint',
  'daily_limit_reached',
]);

const adviceLatestResponseSchema = z.object({
  available: z.boolean(),
  evaluatedAt: z.string().nullable(),
  triggerScore: z.number().nullable(),
  triggerReason: z.string().nullable(),
  sourceEvent: adviceSourceEventSchema.nullable(),
  stale: z.boolean(),
  blockedReason: blockedReasonSchema.nullable(),
  advice: z
    .object({
      summary: z.string(),
      confidence: z.number().min(0).max(1),
      actions: z.array(
        z.object({
          title: z.string(),
          reason: z.string(),
          expectedImpact: z.string(),
        })
      ),
    })
    .nullable(),
});

export const adviceRoutes = new Hono();

/**
 * GET /api/advice/latest — 取得最新 AI 建議與觸發中繼資料
 */
adviceRoutes.get('/latest', async (c) => {
  const payload = await getLatestAdvice();
  const normalized = adviceLatestResponseSchema.parse(payload);
  return c.json(normalized);
});

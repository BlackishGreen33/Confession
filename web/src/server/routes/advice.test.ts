import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetLatestAdvice = vi.hoisted(() => vi.fn());

vi.mock('@server/advice-gate', () => ({
  getLatestAdvice: mockGetLatestAdvice,
}));

import { adviceRoutes } from './advice';

describe('adviceRoutes', () => {
  const app = new Hono().route('/api/advice', adviceRoutes);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/advice/latest 會回傳最新 AI 建議', async () => {
    mockGetLatestAdvice.mockResolvedValue({
      available: true,
      evaluatedAt: '2026-03-06T10:00:00.000Z',
      triggerScore: 73.5,
      triggerReason: '觸發壓力：高風險曝險 80%、掃描可靠度 60%',
      sourceEvent: 'scan_completed',
      stale: false,
      blockedReason: null,
      advice: {
        summary: '優先處理高風險待處理項目，並降低 fallback 波動。',
        confidence: 0.82,
        actions: [
          {
            title: '先清 critical/open',
            reason: '高風險庫存比重過高，需先止血',
            expectedImpact: '快速降低暴露分數',
          },
          {
            title: '補齊 pending 審核',
            reason: '審核堆積會拖慢修復決策',
            expectedImpact: '縮短修復決策時間',
          },
          {
            title: '檢查 fallback 熱點',
            reason: 'fallback rate 波動影響可靠度',
            expectedImpact: '提升掃描穩定度',
          },
        ],
      },
    });

    const res = await app.request('/api/advice/latest');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.sourceEvent).toBe('scan_completed');
    expect(body.advice.actions).toHaveLength(3);
  });

  it('GET /api/advice/latest 無建議時回傳空資料結構', async () => {
    mockGetLatestAdvice.mockResolvedValue({
      available: false,
      evaluatedAt: null,
      triggerScore: null,
      triggerReason: null,
      sourceEvent: null,
      stale: true,
      blockedReason: null,
      advice: null,
    });

    const res = await app.request('/api/advice/latest');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({
      available: false,
      evaluatedAt: null,
      triggerScore: null,
      triggerReason: null,
      sourceEvent: null,
      stale: true,
      blockedReason: null,
      advice: null,
    });
  });

  it('GET /api/advice/latest 可回傳過期建議標記', async () => {
    mockGetLatestAdvice.mockResolvedValue({
      available: true,
      evaluatedAt: '2026-03-01T10:00:00.000Z',
      triggerScore: 60,
      triggerReason: '觸發壓力：審核堆積 70%',
      sourceEvent: 'review_saved',
      stale: true,
      blockedReason: null,
      advice: {
        summary: '建議先清理審核堆積，再安排高風險修復。',
        confidence: 0.73,
        actions: [
          {
            title: '先清 pending',
            reason: '審核堆積會阻斷修復流轉',
            expectedImpact: '縮短決策等待時間',
          },
          {
            title: '分流高風險修復',
            reason: '避免嚴重與高風險持續堆積',
            expectedImpact: '降低暴露壓力',
          },
          {
            title: '安排補掃',
            reason: '確認近期狀態變更後的風險收斂',
            expectedImpact: '提升建議時效性',
          },
        ],
      },
    });

    const res = await app.request('/api/advice/latest');
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.stale).toBe(true);
    expect(body.sourceEvent).toBe('review_saved');
  });
});

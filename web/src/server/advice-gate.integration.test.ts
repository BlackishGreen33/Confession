import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  vulnerability: {
    findMany: vi.fn(),
  },
  vulnerabilityEvent: {
    findMany: vi.fn(),
  },
  adviceDecision: {
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  adviceSnapshot: {
    create: vi.fn(),
    findFirst: vi.fn(),
  },
  config: {
    findUnique: vi.fn(),
  },
}));

const mockBuildHealthResponse = vi.hoisted(() => vi.fn());
const mockComputeTrendInsights = vi.hoisted(() => vi.fn());
const mockCallLlm = vi.hoisted(() => vi.fn());
const mockConfigFromEnv = vi.hoisted(() => vi.fn());
const mockConfigFromPlugin = vi.hoisted(() => vi.fn());
const mockResolveDefaultModel = vi.hoisted(() => vi.fn());
const mockDeduplicateVulnerabilities = vi.hoisted(() => vi.fn());

vi.mock('./storage', () => ({ storage: mockPrisma }));
vi.mock('./health-score', () => ({
  buildHealthResponse: mockBuildHealthResponse,
}));
vi.mock('@/libs/dashboard-insights', () => ({
  computeTrendInsights: mockComputeTrendInsights,
}));
vi.mock('./vulnerability-dedupe', () => ({
  deduplicateVulnerabilities: mockDeduplicateVulnerabilities,
}));
vi.mock('./llm/client', () => ({
  callLlm: mockCallLlm,
  configFromEnv: mockConfigFromEnv,
  configFromPlugin: mockConfigFromPlugin,
  resolveDefaultModel: mockResolveDefaultModel,
}));

import { evaluateAdviceGate } from './advice-gate';

describe('evaluateAdviceGate integration', () => {
  const now = new Date('2026-03-06T14:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();

    mockConfigFromEnv.mockReturnValue({
      provider: 'nvidia',
      apiKey: 'test-key',
      model: 'qwen/qwen2.5-coder-32b-instruct',
    });
    mockConfigFromPlugin.mockImplementation((cfg: unknown) => cfg);
    mockResolveDefaultModel.mockReturnValue('qwen/qwen2.5-coder-32b-instruct');
    mockDeduplicateVulnerabilities.mockImplementation((rows: unknown) => rows);
    mockPrisma.config.findUnique.mockResolvedValue(null);
    mockPrisma.vulnerabilityEvent.findMany.mockResolvedValue([]);
    mockPrisma.adviceDecision.findFirst.mockResolvedValue(null);
    mockPrisma.adviceDecision.count.mockResolvedValue(0);
  });

  it('未達 trigger 門檻時僅記錄決策，不呼叫 LLM', async () => {
    mockBuildHealthResponse.mockResolvedValue({
      status: 'ok',
      score: {
        value: 86,
        components: {
          reliability: { value: 92, fallbackRate: 0.02 },
        },
        topFactors: [],
      },
    });
    mockPrisma.vulnerability.findMany.mockResolvedValue([
      {
        severity: 'low',
        status: 'open',
        humanStatus: 'confirmed',
      },
    ]);
    mockComputeTrendInsights.mockReturnValue({
      pressureHigh: false,
      openNet7d: 0,
    });
    mockPrisma.adviceDecision.create.mockResolvedValue({ id: 'decision-low' });

    await evaluateAdviceGate(
      { sourceEvent: 'scan_completed', sourceTaskId: 'task-low' },
      now
    );

    expect(mockCallLlm).not.toHaveBeenCalled();
    expect(mockPrisma.adviceDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceEvent: 'scan_completed',
          shouldCallAi: false,
          blockedReason: 'threshold_not_met',
        }),
      })
    );
    expect(mockPrisma.adviceDecision.update).not.toHaveBeenCalled();
  });

  it('達門檻時才呼叫 LLM，成功後寫入 snapshot', async () => {
    mockBuildHealthResponse.mockResolvedValue({
      status: 'degraded',
      score: {
        value: 41,
        components: {
          reliability: { value: 36, fallbackRate: 0.33 },
        },
        topFactors: [
          {
            label: 'fallback rate',
            valueText: '33%',
            reason: '回退比例偏高',
          },
        ],
      },
    });
    mockPrisma.vulnerability.findMany.mockResolvedValue([
      {
        severity: 'critical',
        status: 'open',
        humanStatus: 'pending',
      },
      {
        severity: 'high',
        status: 'open',
        humanStatus: 'pending',
      },
      {
        severity: 'high',
        status: 'open',
        humanStatus: 'confirmed',
      },
    ]);
    mockComputeTrendInsights.mockReturnValue({
      pressureHigh: true,
      openNet7d: 8,
    });
    mockPrisma.adviceDecision.findFirst.mockResolvedValue({
      createdAt: new Date('2026-03-06T01:00:00.000Z'),
      metricsFingerprint: 'old-fingerprint',
    });
    mockPrisma.adviceDecision.create.mockResolvedValue({ id: 'decision-high' });
    mockPrisma.adviceSnapshot.create.mockResolvedValue({ id: 'snapshot-1' });
    mockCallLlm.mockResolvedValue({
      text: JSON.stringify({
        summary: '先止血再收斂，集中修 critical/high 並降低 fallback 波動。',
        confidence: 0.84,
        actions: [
          {
            title: '清理 critical/open',
            reason: '高風險曝險比例過高，需先止血',
            expectedImpact: '快速降低暴露面',
          },
          {
            title: '補齊 pending 審核',
            reason: '審核堆積會拖慢修復決策節奏',
            expectedImpact: '提升處置吞吐',
          },
          {
            title: '鎖定 fallback 熱點',
            reason: '回退率偏高會持續拉低可靠度',
            expectedImpact: '提高掃描成功率',
          },
        ],
      }),
    });

    await evaluateAdviceGate(
      { sourceEvent: 'scan_completed', sourceTaskId: 'task-high' },
      now
    );

    expect(mockCallLlm).toHaveBeenCalledTimes(1);
    expect(mockPrisma.adviceSnapshot.create).toHaveBeenCalledOnce();
    expect(mockPrisma.adviceDecision.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'decision-high' },
        data: expect.objectContaining({
          calledAi: true,
          adviceSnapshotId: 'snapshot-1',
          llmError: null,
        }),
      })
    );
  });
});

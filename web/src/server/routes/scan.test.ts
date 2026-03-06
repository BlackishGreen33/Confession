import { inflightScans } from '@server/cache';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  scanTask: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  vulnerability: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
  vulnerabilityEvent: {
    createMany: vi.fn(),
  },
  config: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const mockOrchestrate = vi.hoisted(() => vi.fn());
const mockOrchestrateAgenticBeta = vi.hoisted(() => vi.fn());
const mockTriggerAdviceEvaluation = vi.hoisted(() => vi.fn());

vi.mock('@server/db', () => ({ prisma: mockPrisma }));
vi.mock('@server/agents/orchestrator', () => ({
  orchestrate: mockOrchestrate,
}));
vi.mock('@server/agents/agentic-beta/orchestrator', () => ({
  orchestrateAgenticBeta: mockOrchestrateAgenticBeta,
}));
vi.mock('@server/advice-gate', () => ({
  triggerAdviceEvaluation: mockTriggerAdviceEvaluation,
}));

import { scanRoutes } from './scan';

interface TaskRecord {
  id: string;
  status: string;
  progress: number;
  totalFiles: number;
  scannedFiles: number;
  engineMode: string;
  fallbackUsed: boolean;
  fallbackFrom: string | null;
  fallbackTo: string | null;
  fallbackReason: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const app = new Hono().route('/api/scan', scanRoutes);

const now = () => new Date('2026-03-03T08:00:00.000Z');

function createDefaultTask(data: Partial<TaskRecord>): TaskRecord {
  return {
    id: data.id ?? 'task-1',
    status: data.status ?? 'running',
    progress: data.progress ?? 0,
    totalFiles: data.totalFiles ?? 0,
    scannedFiles: data.scannedFiles ?? 0,
    engineMode: data.engineMode ?? 'agentic_beta',
    fallbackUsed: data.fallbackUsed ?? false,
    fallbackFrom: data.fallbackFrom ?? null,
    fallbackTo: data.fallbackTo ?? null,
    fallbackReason: data.fallbackReason ?? null,
    errorMessage: data.errorMessage ?? null,
    errorCode: data.errorCode ?? null,
    createdAt: data.createdAt ?? now(),
    updatedAt: data.updatedAt ?? now(),
  };
}

const successStats = {
  requestCount: 1,
  cacheHits: 0,
  promptTokens: 10,
  completionTokens: 20,
  totalTokens: 30,
  skippedByPolicy: 0,
  processedFiles: 1,
  successfulFiles: 1,
  requestFailures: 0,
  parseFailures: 0,
  failureKinds: {
    quotaExceeded: 0,
    unavailable: 0,
    timeout: 0,
    other: 0,
  },
};

const failedStats = {
  requestCount: 1,
  cacheHits: 0,
  promptTokens: 10,
  completionTokens: 0,
  totalTokens: 10,
  skippedByPolicy: 0,
  processedFiles: 1,
  successfulFiles: 0,
  requestFailures: 1,
  parseFailures: 0,
  failureKinds: {
    quotaExceeded: 0,
    unavailable: 0,
    timeout: 0,
    other: 1,
  },
};

const baselineSuccessResult = {
  vulnerabilities: [],
  summary: {
    totalFiles: 1,
    totalVulnerabilities: 0,
    bySeverity: {},
    byLanguage: {},
  },
  llmStats: successStats,
};

const agenticSuccessResult = {
  vulnerabilities: [],
  summary: {
    totalFiles: 1,
    totalVulnerabilities: 0,
    bySeverity: {},
    byLanguage: {},
  },
  llmStats: successStats,
  agenticTrace: [],
};

const agenticFailedResult = {
  vulnerabilities: [],
  summary: {
    totalFiles: 1,
    totalVulnerabilities: 0,
    bySeverity: {},
    byLanguage: {},
  },
  llmStats: failedStats,
  agenticTrace: [],
};

const baselineFailedResult = {
  vulnerabilities: [],
  summary: {
    totalFiles: 1,
    totalVulnerabilities: 0,
    bySeverity: {},
    byLanguage: {},
  },
  llmStats: failedStats,
};

async function waitForTaskStatus(
  state: Map<string, TaskRecord>,
  taskId: string,
  status: 'completed' | 'failed'
): Promise<TaskRecord> {
  for (let i = 0; i < 80; i += 1) {
    const task = state.get(taskId);
    if (task?.status === status) return task;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`等待任務狀態逾時: ${taskId} -> ${status}`);
}

describe('Scan routes', () => {
  const taskState = new Map<string, TaskRecord>();

  beforeEach(() => {
    vi.clearAllMocks();
    inflightScans.clear();
    taskState.clear();

    mockPrisma.config.findUnique.mockResolvedValue(null);
    mockPrisma.vulnerability.findMany.mockResolvedValue([]);
    mockPrisma.vulnerability.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.vulnerabilityEvent.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.$transaction.mockImplementation(async (cb: unknown) => {
      if (typeof cb !== 'function') return null;
      return (cb as (tx: unknown) => unknown)({
        vulnerability: {
          findMany: mockPrisma.vulnerability.findMany,
          updateMany: mockPrisma.vulnerability.updateMany,
        },
        vulnerabilityEvent: {
          createMany: mockPrisma.vulnerabilityEvent.createMany,
        },
      });
    });

    mockPrisma.scanTask.create.mockImplementation(
      async ({ data }: { data: Partial<TaskRecord> }): Promise<TaskRecord> => {
        const task = createDefaultTask(data);
        taskState.set(task.id, task);
        return task;
      }
    );

    mockPrisma.scanTask.update.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<TaskRecord>;
      }): Promise<TaskRecord> => {
        const current =
          taskState.get(where.id) ?? createDefaultTask({ id: where.id });
        const next: TaskRecord = {
          ...current,
          ...data,
          updatedAt: now(),
        };
        taskState.set(where.id, next);
        return next;
      }
    );

    mockPrisma.scanTask.updateMany.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { id?: string; status?: { in?: string[] } };
        data: Partial<TaskRecord>;
      }): Promise<{ count: number }> => {
        const id = where.id;
        if (!id) return { count: 0 };

        const current = taskState.get(id);
        if (!current) return { count: 0 };

        const allowedStatuses = where.status?.in;
        if (Array.isArray(allowedStatuses) && allowedStatuses.length > 0) {
          if (!allowedStatuses.includes(current.status)) {
            return { count: 0 };
          }
        }

        const next: TaskRecord = {
          ...current,
          ...data,
          updatedAt: now(),
        };
        taskState.set(id, next);
        return { count: 1 };
      }
    );

    mockPrisma.scanTask.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) => {
        return taskState.get(where.id) ?? null;
      }
    );

    mockPrisma.scanTask.findFirst.mockImplementation(async () => {
      const tasks = Array.from(taskState.values());
      if (tasks.length === 0) return null;
      return (
        tasks.sort(
          (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
        )[0] ?? null
      );
    });
    mockPrisma.scanTask.findMany.mockResolvedValue([]);

    mockOrchestrate.mockResolvedValue(baselineSuccessResult);
    mockOrchestrateAgenticBeta.mockResolvedValue(agenticSuccessResult);
  });

  it('POST /api/scan 未傳 engineMode 時預設使用 agentic_beta', async () => {
    const res = await app.request('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [
          {
            path: '/repo/a.ts',
            content: 'const a = 1',
            language: 'typescript',
          },
        ],
        depth: 'standard',
        scanScope: 'file',
      }),
    });

    expect(res.status).toBe(201);

    const createArg = mockPrisma.scanTask.create.mock.calls[0]?.[0] as {
      data: TaskRecord;
    };
    expect(createArg.data.engineMode).toBe('agentic_beta');
  });

  it('GET /api/scan/recent 有最近掃描資料時回傳摘要與 fallback 欄位', async () => {
    const task = createDefaultTask({
      id: 'task-recent',
      status: 'completed',
      progress: 1,
      engineMode: 'baseline',
      totalFiles: 12,
      scannedFiles: 12,
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: new Date('2026-03-01T00:05:00.000Z'),
      fallbackUsed: true,
      fallbackFrom: 'agentic_beta',
      fallbackTo: 'baseline',
      fallbackReason: 'Agentic 引擎失敗：LLM 分析失敗',
    });
    taskState.set(task.id, task);

    const res = await app.request('/api/scan/recent');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      id: string;
      scannedFiles: number;
      totalFiles: number;
      engineMode: string;
      fallbackUsed: boolean;
      fallbackFrom?: string;
      fallbackTo?: string;
      fallbackReason?: string;
      createdAt: string;
      updatedAt: string;
    };

    expect(body.id).toBe('task-recent');
    expect(body.scannedFiles).toBe(12);
    expect(body.totalFiles).toBe(12);
    expect(body.engineMode).toBe('baseline');
    expect(body.fallbackUsed).toBe(true);
    expect(body.fallbackFrom).toBe('agentic_beta');
    expect(body.fallbackTo).toBe('baseline');
    expect(body.fallbackReason).toContain('Agentic 引擎失敗');
    expect(body.createdAt).toBe('2026-03-01T00:00:00.000Z');
    expect(body.updatedAt).toBe('2026-03-01T00:05:00.000Z');
  });

  it('GET /api/scan/recent 沒有掃描記錄時回傳 404', async () => {
    const res = await app.request('/api/scan/recent');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('尚無掃描記錄');
  });

  it('GET /api/scan/status/:id 未回退時回傳 fallbackUsed=false', async () => {
    const task = createDefaultTask({
      id: 'task-status',
      status: 'running',
      progress: 0.5,
      engineMode: 'agentic_beta',
      totalFiles: 10,
      scannedFiles: 5,
      fallbackUsed: false,
    });
    taskState.set(task.id, task);

    const res = await app.request('/api/scan/status/task-status');
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      id: string;
      fallbackUsed: boolean;
      fallbackFrom?: string;
      fallbackTo?: string;
      fallbackReason?: string;
    };

    expect(body.id).toBe('task-status');
    expect(body.fallbackUsed).toBe(false);
    expect(body.fallbackFrom).toBeUndefined();
    expect(body.fallbackTo).toBeUndefined();
    expect(body.fallbackReason).toBeUndefined();
  });

  it('GET /api/scan/stream/:id 會在 SSE payload 回傳 fallback 欄位', async () => {
    const task = createDefaultTask({
      id: 'task-stream',
      status: 'completed',
      progress: 1,
      engineMode: 'baseline',
      totalFiles: 3,
      scannedFiles: 3,
      fallbackUsed: true,
      fallbackFrom: 'agentic_beta',
      fallbackTo: 'baseline',
      fallbackReason: 'Agentic 引擎失敗：LLM 分析失敗',
    });
    taskState.set(task.id, task);

    const res = await app.request('/api/scan/stream/task-stream');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain(
      'text/event-stream'
    );

    const raw = await res.text();
    const matched = raw.match(/data:\s*(\{.*\})/);
    expect(matched).not.toBeNull();

    const payload = JSON.parse(matched?.[1] ?? '{}') as {
      id: string;
      fallbackUsed: boolean;
      fallbackFrom?: string;
      fallbackTo?: string;
      fallbackReason?: string;
    };

    expect(payload.id).toBe('task-stream');
    expect(payload.fallbackUsed).toBe(true);
    expect(payload.fallbackFrom).toBe('agentic_beta');
    expect(payload.fallbackTo).toBe('baseline');
    expect(payload.fallbackReason).toContain('Agentic 引擎失敗');
  });

  it('POST /api/scan/cancel/:id 任務不存在時回傳 404', async () => {
    const res = await app.request('/api/scan/cancel/not-found-task', {
      method: 'POST',
    });
    expect(res.status).toBe(404);

    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('掃描任務不存在');
  });

  it('POST /api/scan/cancel/:id 進行中任務會立刻標記 failed', async () => {
    const task = createDefaultTask({
      id: 'task-cancel-running',
      status: 'running',
      progress: 0.3,
      totalFiles: 10,
      scannedFiles: 3,
      engineMode: 'agentic_beta',
    });
    taskState.set(task.id, task);

    const res = await app.request('/api/scan/cancel/task-cancel-running', {
      method: 'POST',
    });
    expect(res.status).toBe(202);

    const body = (await res.json()) as {
      taskId: string;
      status: string;
      canceling: boolean;
      message: string;
    };
    expect(body.taskId).toBe('task-cancel-running');
    expect(body.canceling).toBe(true);
    expect(body.status).toBe('failed');
    expect(body.message).toBe('已取消掃描任務');

    const updated = taskState.get('task-cancel-running');
    expect(updated?.status).toBe('failed');
    expect(updated?.errorCode).toBe('UNKNOWN');
    expect(updated?.errorMessage).toBe('使用者已取消掃描');
    expect(mockTriggerAdviceEvaluation).toHaveBeenCalledWith({
      sourceEvent: 'scan_failed',
      sourceTaskId: 'task-cancel-running',
    });
  });

  it('掃描成功完成時會觸發 advice gate（非阻塞）', async () => {
    const res = await app.request('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [
          {
            path: '/repo/done.ts',
            content: 'const x = 1',
            language: 'typescript',
          },
        ],
        depth: 'standard',
      }),
    });
    expect(res.status).toBe(201);

    const created = (await res.json()) as { taskId: string };
    await waitForTaskStatus(taskState, created.taskId, 'completed');

    expect(mockTriggerAdviceEvaluation).toHaveBeenCalledWith({
      sourceEvent: 'scan_completed',
      sourceTaskId: created.taskId,
    });
  });

  it('POST /api/scan/cancel/:id 已結束任務不會重複取消', async () => {
    const task = createDefaultTask({
      id: 'task-cancel-completed',
      status: 'completed',
      progress: 1,
      totalFiles: 4,
      scannedFiles: 4,
      engineMode: 'baseline',
    });
    taskState.set(task.id, task);

    const res = await app.request('/api/scan/cancel/task-cancel-completed', {
      method: 'POST',
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      taskId: string;
      status: string;
      canceling: boolean;
      message: string;
    };
    expect(body.taskId).toBe('task-cancel-completed');
    expect(body.canceling).toBe(false);
    expect(body.status).toBe('completed');
    expect(body.message).toBe('任務已結束，無需取消');
  });

  it('POST /api/scan 發起新任務時會中止既有 running 任務', async () => {
    const oldTask = createDefaultTask({
      id: 'task-old-running',
      status: 'running',
      progress: 0.4,
      totalFiles: 10,
      scannedFiles: 4,
      engineMode: 'agentic_beta',
    });
    taskState.set(oldTask.id, oldTask);

    mockPrisma.scanTask.findMany.mockResolvedValueOnce([
      {
        id: oldTask.id,
        progress: oldTask.progress,
        scannedFiles: oldTask.scannedFiles,
        engineMode: oldTask.engineMode,
        fallbackUsed: oldTask.fallbackUsed,
        fallbackFrom: oldTask.fallbackFrom,
        fallbackTo: oldTask.fallbackTo,
        fallbackReason: oldTask.fallbackReason,
      },
    ]);

    const res = await app.request('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [
          {
            path: '/repo/new.ts',
            content: 'const b = 2',
            language: 'typescript',
          },
        ],
        depth: 'standard',
      }),
    });
    expect(res.status).toBe(201);

    const oldTaskAfter = taskState.get('task-old-running');
    expect(oldTaskAfter?.status).toBe('failed');
    expect(oldTaskAfter?.errorCode).toBe('UNKNOWN');
    expect(oldTaskAfter?.errorMessage).toBe(
      '新掃描任務已啟動，上一個掃描已中止'
    );
  });

  it('agentic 失敗時會自動回退 baseline，最終 completed + fallbackUsed=true', async () => {
    mockOrchestrateAgenticBeta.mockResolvedValue(agenticFailedResult);
    mockOrchestrate.mockResolvedValue(baselineSuccessResult);

    const res = await app.request('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [
          {
            path: '/repo/a.ts',
            content: 'const a = 1',
            language: 'typescript',
          },
        ],
        depth: 'standard',
      }),
    });
    expect(res.status).toBe(201);

    const created = (await res.json()) as { taskId: string };
    const finalTask = await waitForTaskStatus(
      taskState,
      created.taskId,
      'completed'
    );

    expect(mockOrchestrateAgenticBeta).toHaveBeenCalledOnce();
    expect(mockOrchestrate).toHaveBeenCalledOnce();
    expect(finalTask.engineMode).toBe('baseline');
    expect(finalTask.fallbackUsed).toBe(true);
    expect(finalTask.fallbackFrom).toBe('agentic_beta');
    expect(finalTask.fallbackTo).toBe('baseline');
    expect(finalTask.errorCode).toBeNull();
  });

  it('agentic 與 baseline 都失敗時，任務 failed 且 errorCode=BETA_ENGINE_FAILED', async () => {
    mockOrchestrateAgenticBeta.mockResolvedValue(agenticFailedResult);
    mockOrchestrate.mockResolvedValue(baselineFailedResult);

    const res = await app.request('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [
          {
            path: '/repo/a.ts',
            content: 'const a = 1',
            language: 'typescript',
          },
        ],
        depth: 'standard',
      }),
    });
    expect(res.status).toBe(201);

    const created = (await res.json()) as { taskId: string };
    const finalTask = await waitForTaskStatus(
      taskState,
      created.taskId,
      'failed'
    );

    expect(finalTask.errorCode).toBe('BETA_ENGINE_FAILED');
    expect(finalTask.errorMessage).toContain('Agentic 失敗');
    expect(finalTask.errorMessage).toContain('Baseline 回退失敗');
    expect(finalTask.fallbackUsed).toBe(true);
    expect(finalTask.fallbackFrom).toBe('agentic_beta');
    expect(finalTask.fallbackTo).toBe('baseline');
  });

  it('workspace 掃描完成後會自動關閉不在快照內的 open 漏洞', async () => {
    mockPrisma.vulnerability.findMany
      .mockResolvedValueOnce([
        {
          id: 'v-stale',
          filePath: '/repo/deleted.ts',
          humanStatus: 'pending',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'v-stale',
          humanStatus: 'pending',
        },
      ]);

    const res = await app.request('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [
          {
            path: '/repo/active.ts',
            content: 'const a = 1',
            language: 'typescript',
          },
        ],
        depth: 'standard',
        scanScope: 'workspace',
        workspaceSnapshotComplete: true,
        workspaceRoots: ['/repo'],
      }),
    });
    expect(res.status).toBe(201);

    const created = (await res.json()) as { taskId: string };
    const finalTask = await waitForTaskStatus(
      taskState,
      created.taskId,
      'completed'
    );

    expect(finalTask.status).toBe('completed');
    expect(mockPrisma.vulnerability.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['v-stale'] }, status: 'open' },
        data: { status: 'fixed' },
      })
    );
    expect(mockPrisma.vulnerabilityEvent.createMany).toHaveBeenCalledOnce();
  });

  it('workspace 快照不完整時跳過自動關閉，避免誤判', async () => {
    const res = await app.request('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [
          {
            path: '/repo/active.ts',
            content: 'const a = 1',
            language: 'typescript',
          },
        ],
        depth: 'standard',
        scanScope: 'workspace',
        workspaceSnapshotComplete: false,
        workspaceRoots: ['/repo'],
      }),
    });
    expect(res.status).toBe(201);

    const created = (await res.json()) as { taskId: string };
    const finalTask = await waitForTaskStatus(
      taskState,
      created.taskId,
      'completed'
    );

    expect(finalTask.status).toBe('completed');
    expect(mockPrisma.vulnerability.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.vulnerability.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.vulnerabilityEvent.createMany).not.toHaveBeenCalled();
  });
});

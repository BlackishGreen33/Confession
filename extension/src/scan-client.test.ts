import { afterEach, describe, expect, it, vi } from 'vitest';

import { pollUntilDone, type ScanTaskFailedError } from './scan-client';

function streamFromChunks(chunks: string[]) {
  return new globalThis.ReadableStream({
    start(controller) {
      const encoder = new globalThis.TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function sseResponse(chunks: string[], status = 200): Response {
  return new Response(status === 200 ? streamFromChunks(chunks) : null, {
    status,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scan-client SSE', () => {
  it('pollUntilDone 會忽略 keepalive 並在 completed 時完成', async () => {
    const progress = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'id: 1\nevent: keepalive\ndata: {}\n\n',
          'id: 2\nevent: scan_progress\ndata: {"id":"task-1","status":"completed","progress":100,"engineMode":"baseline"}\n\n',
        ])
      )
    );

    await pollUntilDone('http://localhost:3000', 'task-1', progress);

    expect(progress).toHaveBeenCalledWith(100);
  });

  it('pollUntilDone 可組回被切開的 SSE chunk', async () => {
    const progress = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'id: 9\nevent: scan_progress\ndata: {"id":"task-1","status":"',
          'completed","progress":100,"engineMode":"baseline"}\n\n',
        ])
      )
    );

    await pollUntilDone('http://localhost:3000', 'task-1', progress);

    expect(progress).toHaveBeenCalledWith(100);
  });

  it('pollUntilDone 會保留 failed 的 errorCode 與 engineMode', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'event: scan_progress\ndata: {"id":"task-1","status":"failed","progress":40,"engineMode":"agentic","errorCode":"llm_error","errorMessage":"LLM failed"}\n\n',
        ])
      )
    );

    await expect(
      pollUntilDone('http://localhost:3000', 'task-1')
    ).rejects.toMatchObject({
      name: 'ScanTaskFailedError',
      errorCode: 'llm_error',
      engineMode: 'agentic',
    } satisfies Partial<ScanTaskFailedError>);
  });

  it('SSE 不可用時會退回輪詢', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse([], 404))
      .mockResolvedValueOnce(
        Response.json({
          id: 'task-1',
          status: 'completed',
          progress: 100,
          engineMode: 'baseline',
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await pollUntilDone('http://localhost:3000', 'task-1', undefined, {
      intervalMs: 1,
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:3000/api/scan/status/task-1'
    );
  });

  it('串流中斷重連時會帶 Last-Event-ID', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        sseResponse([
          'id: 7\nevent: scan_progress\ndata: {"id":"task-1","status":"running","progress":20,"engineMode":"baseline"}\n\n',
        ])
      )
      .mockResolvedValueOnce(
        sseResponse([
          'id: 8\nevent: scan_progress\ndata: {"id":"task-1","status":"completed","progress":100,"engineMode":"baseline"}\n\n',
        ])
      );
    vi.stubGlobal('fetch', fetchMock);

    await pollUntilDone('http://localhost:3000', 'task-1');

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3000/api/scan/stream/task-1',
      expect.objectContaining({
        headers: { 'Last-Event-ID': '7' },
      })
    );
  });
});

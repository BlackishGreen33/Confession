import { llmResponseCache } from '@server/cache';
import type { LlmCallResult } from '@server/llm/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { InteractionPoint } from '@/libs/types';

import { analyzeWithLlm, type FileContentMap } from './analysis-agent';

const callLlmMock = vi.fn<
  Promise<LlmCallResult>,
  [string, { provider: 'gemini' | 'nvidia' | 'minimax-cn'; apiKey: string }]
>();

vi.mock('@server/llm/client', () => ({
  callLlm: (
    prompt: string,
    config: { provider: 'gemini' | 'nvidia' | 'minimax-cn'; apiKey: string }
  ) => callLlmMock(prompt, config),
  configFromEnv: () => ({ provider: 'nvidia', apiKey: 'env-test-key' }),
  resolveDefaultModel: (provider: 'gemini' | 'nvidia' | 'minimax-cn') =>
    provider === 'gemini'
      ? 'gemini-3-flash-preview'
      : provider === 'minimax-cn'
        ? 'MiniMax-M2.7'
        : 'deepseek-ai/deepseek-r1',
}));

const emptyLlmResult: LlmCallResult = {
  text: '[]',
  usage: {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
  },
};

let pointIdSeq = 0;

function buildPoint(overrides: Partial<InteractionPoint>): InteractionPoint {
  pointIdSeq += 1;
  return {
    id: overrides.id ?? `id-${pointIdSeq}`,
    type: overrides.type ?? 'sensitive_data',
    language: overrides.language ?? 'typescript',
    filePath: overrides.filePath ?? '/workspace/a.ts',
    line: overrides.line ?? 10,
    column: overrides.column ?? 3,
    endLine: overrides.endLine ?? overrides.line ?? 10,
    endColumn: overrides.endColumn ?? 20,
    codeSnippet: overrides.codeSnippet ?? 'const token = req.query.token',
    patternName: overrides.patternName ?? 'keyword_tokens_token',
    confidence: overrides.confidence ?? 'medium',
  };
}

function buildFileMap(
  entries: Array<{ path: string; content: string; language: string }>
): FileContentMap {
  const map: FileContentMap = new Map();
  for (const entry of entries) {
    map.set(entry.path, { content: entry.content, language: entry.language });
  }
  return map;
}

describe('analysis-agent', () => {
  beforeEach(() => {
    callLlmMock.mockReset();
    callLlmMock.mockResolvedValue(emptyLlmResult);
    llmResponseCache.clear();
    pointIdSeq = 0;
  });

  it('standard 模式同檔案多點僅發送一次 LLM 請求', async () => {
    const filePath = '/workspace/a.ts';
    const points = [
      buildPoint({ filePath, line: 8, patternName: 'direct_query_query' }),
      buildPoint({ filePath, line: 15, patternName: 'keyword_tokens_token' }),
      buildPoint({
        filePath,
        line: 30,
        type: 'dangerous_call',
        patternName: 'eval',
        confidence: 'high',
      }),
    ];
    const fileMap = buildFileMap([
      {
        path: filePath,
        content: 'line1\nline2\nline3\nline4\nline5',
        language: 'typescript',
      },
    ]);

    const result = await analyzeWithLlm(points, fileMap, {
      depth: 'standard',
      includeMacroScan: false,
      maxRetryAttempts: 1,
      llmConfig: { provider: 'nvidia', apiKey: 'test-key' },
    });

    expect(callLlmMock).toHaveBeenCalledTimes(1);
    expect(result.stats.requestCount).toBe(1);
    expect(result.stats.processedFiles).toBe(1);
  });

  it('quick 模式僅 keyword 點位時不觸發 LLM', async () => {
    const filePath = '/workspace/a.ts';
    const points = [
      buildPoint({
        filePath,
        type: 'sensitive_data',
        patternName: 'keyword_tokens_token',
        confidence: 'medium',
      }),
    ];
    const fileMap = buildFileMap([
      { path: filePath, content: 'const token = "x"', language: 'typescript' },
    ]);

    const result = await analyzeWithLlm(points, fileMap, {
      depth: 'quick',
      includeMacroScan: false,
      llmConfig: { provider: 'nvidia', apiKey: 'test-key' },
    });

    expect(callLlmMock).toHaveBeenCalledTimes(0);
    expect(result.stats.requestCount).toBe(0);
    expect(result.stats.processedFiles).toBe(0);
    expect(result.stats.skippedByPolicy).toBe(1);
  });

  it('quick 模式只保留高風險 AST 點位', async () => {
    const filePath = '/workspace/a.ts';
    const points = [
      buildPoint({
        filePath,
        type: 'dangerous_call',
        patternName: 'eval',
        confidence: 'high',
        line: 4,
      }),
      buildPoint({
        filePath,
        type: 'sensitive_data',
        patternName: 'keyword_tokens_token',
        confidence: 'medium',
        line: 20,
      }),
    ];
    const fileMap = buildFileMap([
      {
        path: filePath,
        content: 'const a = 1\nconst b = 2\neval(code)',
        language: 'typescript',
      },
    ]);

    await analyzeWithLlm(points, fileMap, {
      depth: 'quick',
      includeMacroScan: false,
      llmConfig: { provider: 'nvidia', apiKey: 'test-key' },
    });

    expect(callLlmMock).toHaveBeenCalledTimes(1);
    const prompt = callLlmMock.mock.calls[0][0];
    expect(prompt).toContain('dangerous_call');
    expect(prompt).not.toContain('keyword_tokens_token');
    expect(prompt).not.toContain('## 完整檔案內容');
  });

  it('deep + includeMacroScan 會對每個檔案各呼叫一次且保留全檔', async () => {
    const fileMap = buildFileMap([
      {
        path: '/workspace/a.ts',
        content: 'eval(code)',
        language: 'typescript',
      },
      {
        path: '/workspace/b.ts',
        content: 'const safe = true',
        language: 'typescript',
      },
    ]);
    const points = [
      buildPoint({
        filePath: '/workspace/a.ts',
        type: 'dangerous_call',
        patternName: 'eval',
        confidence: 'high',
      }),
    ];

    const result = await analyzeWithLlm(points, fileMap, {
      depth: 'deep',
      includeMacroScan: true,
      llmConfig: { provider: 'nvidia', apiKey: 'test-key' },
    });

    expect(callLlmMock).toHaveBeenCalledTimes(2);
    expect(callLlmMock.mock.calls[0][0]).toContain('## 完整檔案內容');
    expect(callLlmMock.mock.calls[1][0]).toContain('## 完整檔案內容');
    expect(result.stats.requestCount).toBe(2);
  });

  it('standard 會限制每檔點位上限為 14', async () => {
    const filePath = '/workspace/a.ts';
    const points = Array.from({ length: 30 }, (_, index) =>
      buildPoint({
        filePath,
        line: index + 1,
        patternName: `keyword_tokens_token_${index + 1}`,
        codeSnippet: `token_${index + 1}`,
      })
    );
    const fileMap = buildFileMap([
      {
        path: filePath,
        content: Array.from(
          { length: 60 },
          (_, index) => `line-${index + 1}`
        ).join('\n'),
        language: 'typescript',
      },
    ]);

    const result = await analyzeWithLlm(points, fileMap, {
      depth: 'standard',
      includeMacroScan: false,
      maxRetryAttempts: 1,
      llmConfig: { provider: 'nvidia', apiKey: 'test-key' },
    });

    expect(callLlmMock).toHaveBeenCalledTimes(1);
    const prompt = callLlmMock.mock.calls[0][0];
    expect(prompt).toMatch(/\n14\./);
    expect(prompt).not.toMatch(/\n15\./);
    expect(result.stats.skippedByPolicy).toBe(16);
  });

  it('相同 prompt 第二次掃描命中快取，不再呼叫 LLM', async () => {
    const filePath = '/workspace/a.ts';
    const points = [
      buildPoint({
        filePath,
        type: 'dangerous_call',
        patternName: 'eval',
        confidence: 'high',
      }),
    ];
    const fileMap = buildFileMap([
      { path: filePath, content: 'eval(code)', language: 'typescript' },
    ]);

    const first = await analyzeWithLlm(points, fileMap, {
      depth: 'standard',
      includeMacroScan: false,
      llmConfig: { provider: 'nvidia', apiKey: 'test-key' },
    });
    const second = await analyzeWithLlm(points, fileMap, {
      depth: 'standard',
      includeMacroScan: false,
      llmConfig: { provider: 'nvidia', apiKey: 'test-key' },
    });

    expect(first.stats.requestCount).toBe(1);
    expect(second.stats.requestCount).toBe(0);
    expect(second.stats.cacheHits).toBe(1);
    expect(callLlmMock).toHaveBeenCalledTimes(1);
  });

  it('503 或暫時性錯誤時會重試一次', async () => {
    const filePath = '/workspace/a.ts';
    const points = [
      buildPoint({
        filePath,
        type: 'dangerous_call',
        patternName: 'eval',
        confidence: 'high',
      }),
    ];
    const fileMap = buildFileMap([
      { path: filePath, content: 'eval(code)', language: 'typescript' },
    ]);

    callLlmMock
      .mockRejectedValueOnce(
        new Error('Gemini API 錯誤 (HTTP 503)：UNAVAILABLE')
      )
      .mockResolvedValueOnce(emptyLlmResult);

    const result = await analyzeWithLlm(points, fileMap, {
      depth: 'standard',
      includeMacroScan: false,
      maxRetryAttempts: 1,
      llmConfig: { provider: 'nvidia', apiKey: 'test-key' },
    });

    expect(callLlmMock).toHaveBeenCalledTimes(2);
    expect(result.stats.requestCount).toBe(1);
    expect(result.stats.requestFailures).toBe(0);
    expect(result.stats.parseFailures).toBe(0);
  });

  it('LLM 回應無法解析時會累計 parseFailures', async () => {
    const filePath = '/workspace/a.ts';
    const points = [
      buildPoint({
        filePath,
        type: 'dangerous_call',
        patternName: 'eval',
        confidence: 'high',
      }),
    ];
    const fileMap = buildFileMap([
      { path: filePath, content: 'eval(code)', language: 'typescript' },
    ]);

    callLlmMock.mockResolvedValue({
      text: '[{"type":"invalid"}]',
      usage: { promptTokens: 11, completionTokens: 6, totalTokens: 17 },
    });

    const result = await analyzeWithLlm(points, fileMap, {
      depth: 'standard',
      includeMacroScan: false,
      llmConfig: { provider: 'nvidia', apiKey: 'test-key' },
    });

    expect(result.vulnerabilities).toEqual([]);
    expect(result.stats.requestCount).toBe(1);
    expect(result.stats.parseFailures).toBe(1);
    expect(result.stats.requestFailures).toBe(0);
    expect(result.stats.successfulFiles).toBe(0);
  });

  it('LLM 呼叫失敗時會累計 requestFailures', async () => {
    const filePath = '/workspace/a.ts';
    const points = [
      buildPoint({
        filePath,
        type: 'dangerous_call',
        patternName: 'eval',
        confidence: 'high',
      }),
    ];
    const fileMap = buildFileMap([
      { path: filePath, content: 'eval(code)', language: 'typescript' },
    ]);

    callLlmMock.mockRejectedValue(new Error('quota exceeded'));

    const result = await analyzeWithLlm(points, fileMap, {
      depth: 'standard',
      includeMacroScan: false,
      llmConfig: { provider: 'nvidia', apiKey: 'test-key' },
    });

    expect(result.vulnerabilities).toEqual([]);
    expect(result.stats.requestCount).toBe(0);
    expect(result.stats.requestFailures).toBe(1);
    expect(result.stats.parseFailures).toBe(0);
    expect(result.stats.failureKinds.quotaExceeded).toBe(1);
    expect(result.stats.failureKinds.other).toBe(0);
    expect(result.stats.successfulFiles).toBe(0);
    expect(callLlmMock).toHaveBeenCalledTimes(1);
  });
});

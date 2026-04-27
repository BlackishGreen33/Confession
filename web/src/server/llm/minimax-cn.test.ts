import { afterEach, describe, expect, it, vi } from 'vitest';

import { configFromEnv, configFromPlugin, resolveDefaultModel } from './client';
import { callMiniMaxCn } from './minimax-cn';

const originalMiniMaxCnKey = process.env.MINIMAX_CN_API_KEY;
const originalMiniMaxKey = process.env.MINIMAX_API_KEY;
const originalMiniMaxCnEndpoint = process.env.MINIMAX_CN_ENDPOINT;
const originalMiniMaxEndpoint = process.env.MINIMAX_ENDPOINT;
const originalMiniMaxCnModel = process.env.MINIMAX_CN_MODEL;
const originalMiniMaxModel = process.env.MINIMAX_MODEL;

afterEach(() => {
  vi.unstubAllGlobals();
  restoreEnv('MINIMAX_CN_API_KEY', originalMiniMaxCnKey);
  restoreEnv('MINIMAX_API_KEY', originalMiniMaxKey);
  restoreEnv('MINIMAX_CN_ENDPOINT', originalMiniMaxCnEndpoint);
  restoreEnv('MINIMAX_ENDPOINT', originalMiniMaxEndpoint);
  restoreEnv('MINIMAX_CN_MODEL', originalMiniMaxCnModel);
  restoreEnv('MINIMAX_MODEL', originalMiniMaxModel);
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

describe('MiniMax CN LLM client', () => {
  it('configFromEnv 應優先使用 MINIMAX_CN_API_KEY 並解析預設模型', () => {
    process.env.MINIMAX_CN_API_KEY = 'cn-key';
    process.env.MINIMAX_API_KEY = 'generic-key';
    process.env.MINIMAX_CN_ENDPOINT = 'https://api.minimaxi.com/v1';
    process.env.MINIMAX_CN_MODEL = 'MiniMax-M2.7-highspeed';

    expect(resolveDefaultModel('minimax-cn')).toBe('MiniMax-M2.7');
    expect(configFromEnv('minimax-cn')).toEqual({
      provider: 'minimax-cn',
      apiKey: 'cn-key',
      endpoint: 'https://api.minimaxi.com/v1',
      model: 'MiniMax-M2.7-highspeed',
    });
  });

  it('configFromPlugin 應保留 MiniMax CN endpoint/model 覆寫', () => {
    expect(
      configFromPlugin({
        provider: 'minimax-cn',
        apiKey: 'plugin-key',
        endpoint: 'https://example.test/v1',
        model: 'MiniMax-M2.7-highspeed',
      })
    ).toEqual({
      provider: 'minimax-cn',
      apiKey: 'plugin-key',
      endpoint: 'https://example.test/v1',
      model: 'MiniMax-M2.7-highspeed',
    });
  });

  it('callMiniMaxCn 應呼叫 OpenAI 相容端點並移除 thinking 標籤', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '<think>推理內容</think>\n[{ "type": "xss", "severity": "high" }]',
            },
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20,
        },
        base_resp: { status_code: 0, status_msg: 'success' },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callMiniMaxCn('請輸出 JSON', {
      apiKey: 'test-key',
      endpoint: 'https://api.minimaxi.com/v1',
      model: 'MiniMax-M2.7',
    });

    expect(result).toEqual({
      text: '[{ "type": "xss", "severity": "high" }]',
      usage: {
        promptTokens: 12,
        completionTokens: 8,
        totalTokens: 20,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.minimaxi.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        }),
        body: expect.any(String),
      })
    );

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body).toMatchObject({
      model: 'MiniMax-M2.7',
      temperature: 0.1,
      top_p: 0.7,
      max_completion_tokens: 2048,
      stream: false,
      reasoning_split: true,
    });
  });
});

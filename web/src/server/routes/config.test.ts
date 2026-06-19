import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';

import { configRoutes } from './config';

const createdRoots: string[] = [];

function createApp() {
  const app = new Hono();
  app.route('/api/config', configRoutes);
  return app;
}

function createTempProjectRoot(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'confession-config-route-test-')
  );
  createdRoots.push(dir);
  process.env.CONFESSION_PROJECT_ROOT = dir;
  return dir;
}

afterEach(() => {
  delete process.env.CONFESSION_PROJECT_ROOT;
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('config routes', () => {
  it('PUT /api/config 應接受 minimax-cn provider 並在回應中遮蔽 apiKey', async () => {
    createTempProjectRoot();
    const app = createApp();

    const put = await app.request('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        llm: {
          provider: 'minimax-cn',
          apiKey: 'test-key',
          endpoint: 'https://api.minimaxi.com/v1',
          model: 'MiniMax-M2.7',
        },
      }),
    });

    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({
      llm: {
        provider: 'minimax-cn',
        apiKey: '',
        apiKeyConfigured: true,
        endpoint: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.7',
      },
    });

    const get = await app.request('/api/config');
    expect(await get.json()).toMatchObject({
      llm: {
        provider: 'minimax-cn',
        apiKey: '',
        apiKeyConfigured: true,
        endpoint: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.7',
      },
    });
  });

  it('省略 apiKey 時應保留既有 key，明確空字串才清除', async () => {
    createTempProjectRoot();
    const app = createApp();

    const initial = await app.request('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        llm: {
          provider: 'minimax-cn',
          apiKey: 'test-key',
          endpoint: 'https://api.minimaxi.com/v1',
        },
      }),
    });
    expect(initial.status).toBe(200);

    const preserve = await app.request('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        llm: {
          model: 'MiniMax-M2.7',
        },
      }),
    });
    expect(preserve.status).toBe(200);
    expect(await preserve.json()).toMatchObject({
      llm: {
        apiKey: '',
        apiKeyConfigured: true,
        model: 'MiniMax-M2.7',
      },
    });

    const clear = await app.request('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ llm: { apiKey: '' } }),
    });
    expect(clear.status).toBe(200);
    expect(await clear.json()).toMatchObject({
      llm: {
        apiKey: '',
        apiKeyConfigured: false,
      },
    });
  });

  it('自訂 LLM endpoint 應拒絕非 HTTPS 與 private/loopback 目標', async () => {
    createTempProjectRoot();
    const app = createApp();

    for (const endpoint of [
      'http://127.0.0.1:11434/v1',
      'http://localhost:11434/v1',
      'https://192.168.1.10/v1',
    ]) {
      const res = await app.request('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llm: { endpoint } }),
      });
      expect(res.status).toBe(400);
    }

    const allowed = await app.request('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        llm: { provider: 'minimax-cn', endpoint: 'https://api.minimaxi.com/v1' },
      }),
    });
    expect(allowed.status).toBe(200);
  });
});

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
  process.env.CONFESSION_PROJECT_ROOT = '';
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('config routes', () => {
  it('PUT /api/config 應接受並持久化 minimax-cn provider', async () => {
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
        apiKey: 'test-key',
        endpoint: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.7',
      },
    });

    const get = await app.request('/api/config');
    expect(await get.json()).toMatchObject({
      llm: {
        provider: 'minimax-cn',
        apiKey: 'test-key',
        endpoint: 'https://api.minimaxi.com/v1',
        model: 'MiniMax-M2.7',
      },
    });
  });
});

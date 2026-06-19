import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { app } from './index';

const createdRoots: string[] = [];
const originalProjectRoot = process.env.CONFESSION_PROJECT_ROOT;
const originalApiToken = process.env.CONFESSION_API_TOKEN;
const originalCorsOrigins = process.env.CONFESSION_CORS_ORIGINS;

function createTempProjectRoot(): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'confession-index-test-'));
  createdRoots.push(dir);
  process.env.CONFESSION_PROJECT_ROOT = dir;
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

afterEach(() => {
  restoreEnv('CONFESSION_PROJECT_ROOT', originalProjectRoot);
  restoreEnv('CONFESSION_API_TOKEN', originalApiToken);
  restoreEnv('CONFESSION_CORS_ORIGINS', originalCorsOrigins);
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('API control surface middleware', () => {
  it('非 allowlist CORS origin 應被拒絕', async () => {
    const res = await app.request('http://127.0.0.1:3000/api/config', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    });

    expect(res.status).toBe(403);
  });

  it('非 loopback host 的敏感 API 需 Bearer token，health 保持公開', async () => {
    createTempProjectRoot();
    process.env.CONFESSION_API_TOKEN = 'secret-token';

    const health = await app.request('http://confession.example/api/health');
    expect(health.status).toBe(200);

    const missingToken = await app.request('http://confession.example/api/config');
    expect(missingToken.status).toBe(401);

    const authorized = await app.request('http://confession.example/api/config', {
      headers: { Authorization: 'Bearer secret-token' },
    });
    expect(authorized.status).toBe(200);
  });
});

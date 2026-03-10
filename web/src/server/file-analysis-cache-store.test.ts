import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('file-analysis-cache-store', () => {
  const originalProjectRoot = process.env.CONFESSION_PROJECT_ROOT
  let projectRoot = ''

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'confession-analysis-cache-'))
    process.env.CONFESSION_PROJECT_ROOT = projectRoot
  })

  afterEach(async () => {
    vi.resetModules()
    if (originalProjectRoot) {
      process.env.CONFESSION_PROJECT_ROOT = originalProjectRoot
    } else {
      delete process.env.CONFESSION_PROJECT_ROOT
    }
    await fs.rm(projectRoot, { recursive: true, force: true })
  })

  it('hydrate 會載入版本相符的持久化快取', async () => {
    const confessionDir = path.join(projectRoot, '.confession')
    const cachePath = path.join(confessionDir, 'analysis-cache.json')
    await fs.mkdir(confessionDir, { recursive: true })
    await fs.writeFile(
      cachePath,
      JSON.stringify(
        {
          schemaVersion: 'analysis-cache-v1',
          analyzerVersion: 'ast-jsts-go-keywords-v1',
          promptVersion: 'llm-prompt-v2',
          updatedAt: new Date().toISOString(),
          entries: {
            '/repo/a.ts': 'hash-a',
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    const store = await import('./file-analysis-cache-store')
    const cache = await import('@server/cache')
    await store.hydrateFileAnalysisCacheFromDisk()

    expect(
      cache.fileAnalysisCache.has(cache.buildFileAnalysisCacheKey('/repo/a.ts', 'hash-a')),
    ).toBe(true)
  })

  it('版本不相符時會忽略舊快取', async () => {
    const confessionDir = path.join(projectRoot, '.confession')
    const cachePath = path.join(confessionDir, 'analysis-cache.json')
    await fs.mkdir(confessionDir, { recursive: true })
    await fs.writeFile(
      cachePath,
      JSON.stringify(
        {
          schemaVersion: 'analysis-cache-v1',
          analyzerVersion: 'ast-jsts-go-keywords-v0',
          promptVersion: 'llm-prompt-v1',
          updatedAt: new Date().toISOString(),
          entries: {
            '/repo/legacy.ts': 'legacy-hash',
          },
        },
        null,
        2,
      ),
      'utf8',
    )

    const store = await import('./file-analysis-cache-store')
    const cache = await import('@server/cache')
    await store.hydrateFileAnalysisCacheFromDisk()

    expect(
      cache.fileAnalysisCache.has(cache.buildFileAnalysisCacheKey('/repo/legacy.ts', 'legacy-hash')),
    ).toBe(false)
  })

  it('persist 會將新分析結果寫入 analysis-cache.json', async () => {
    const store = await import('./file-analysis-cache-store')
    store.recordAnalyzedFile('/repo/new.ts', 'hash-new')
    await store.persistFileAnalysisCacheToDisk()

    const payload = JSON.parse(
      await fs.readFile(path.join(projectRoot, '.confession', 'analysis-cache.json'), 'utf8'),
    ) as {
      schemaVersion: string
      entries: Record<string, string>
    }

    expect(payload.schemaVersion).toBe('analysis-cache-v1')
    expect(payload.entries['/repo/new.ts']).toBe('hash-new')
  })
})

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import * as fc from 'fast-check'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { storage, upsertVulnerabilities } from './storage'

interface VulnerabilityInput {
  filePath: string
  line: number
  column: number
  endLine: number
  endColumn: number
  codeSnippet: string
  type: string
  cweId?: string | null
  severity: string
  description: string
  riskDescription?: string | null
  fixOldCode?: string | null
  fixNewCode?: string | null
  fixExplanation?: string | null
  aiModel?: string | null
  aiConfidence?: number | null
  aiReasoning?: string | null
  stableFingerprint?: string | null
  source?: 'sast' | 'dast'
  owaspCategory?: string | null
}

const createdRoots: string[] = []

const DEFAULT_CONFIG = {
  llm: { provider: 'nvidia', apiKey: '' },
  analysis: { triggerMode: 'onSave', depth: 'standard', debounceMs: 500 },
  ignore: { paths: [], types: [] },
  api: { baseUrl: 'http://localhost:3000', mode: 'local' },
}

function createTempProjectRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'confession-filestore-test-'))
  createdRoots.push(dir)
  return dir
}

function setProjectRoot(root: string): void {
  process.env.CONFESSION_PROJECT_ROOT = root
}

const vulnInputArb: fc.Arbitrary<VulnerabilityInput> = fc.record({
  filePath: fc.string({ minLength: 1, maxLength: 20, unit: 'grapheme' }).map((s) =>
    `src/${s.replace(/\0/g, '_')}.ts`,
  ),
  line: fc.integer({ min: 1, max: 10000 }),
  column: fc.integer({ min: 0, max: 500 }),
  endLine: fc.integer({ min: 1, max: 10000 }),
  endColumn: fc.integer({ min: 0, max: 500 }),
  codeSnippet: fc.string({ minLength: 1, maxLength: 200, unit: 'grapheme' }),
  type: fc.constantFrom('xss', 'sql_injection', 'eval_usage', 'prototype_pollution', 'hardcoded_secret'),
  severity: fc.constantFrom('critical', 'high', 'medium', 'low', 'info'),
  description: fc.string({ minLength: 1, maxLength: 200, unit: 'grapheme' }),
  cweId: fc.option(fc.constantFrom('CWE-79', 'CWE-89', 'CWE-94', 'CWE-502', 'CWE-78'), { nil: null }),
  riskDescription: fc.option(fc.string({ minLength: 1, maxLength: 100, unit: 'grapheme' }), { nil: null }),
  fixOldCode: fc.option(fc.string({ minLength: 1, maxLength: 100, unit: 'grapheme' }), { nil: null }),
  fixNewCode: fc.option(fc.string({ minLength: 1, maxLength: 100, unit: 'grapheme' }), { nil: null }),
  fixExplanation: fc.option(fc.string({ minLength: 1, maxLength: 100, unit: 'grapheme' }), { nil: null }),
  aiModel: fc.option(fc.constant('gemini-2.0-flash'), { nil: null }),
  aiConfidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
  aiReasoning: fc.option(fc.string({ minLength: 1, maxLength: 100, unit: 'grapheme' }), { nil: null }),
  owaspCategory: fc.option(fc.constantFrom('A01', 'A02', 'A03', 'A04', 'A05'), { nil: null }),
})

beforeEach(async () => {
  const root = createTempProjectRoot()
  setProjectRoot(root)
  await storage.vulnerabilityEvent.deleteMany()
  await storage.vulnerability.deleteMany()
})

afterEach(() => {
  process.env.CONFESSION_PROJECT_ROOT = ''
})

afterAll(async () => {
  await storage.$disconnect()
  for (const root of createdRoots.splice(0, createdRoots.length)) {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

describe('FileStore: Vulnerability record idempotency', () => {
  it('inserting the same vulnerability twice produces exactly one record', async () => {
    await fc.assert(
      fc.asyncProperty(vulnInputArb, async (input) => {
        await storage.vulnerabilityEvent.deleteMany()
        await storage.vulnerability.deleteMany()

        await upsertVulnerabilities([input])
        await upsertVulnerabilities([input])

        const codeHash = createHash('sha256').update(input.codeSnippet).digest('hex')
        const count = await storage.vulnerability.count({
          where: {
            filePath: input.filePath,
            line: input.line,
            column: input.column,
            codeHash,
            type: input.type,
          },
        })

        expect(count).toBe(1)
      }),
      { numRuns: 30 },
    )
  })

  it('new vulnerability create should append one scan_detected event', async () => {
    await fc.assert(
      fc.asyncProperty(vulnInputArb, async (input) => {
        await storage.vulnerabilityEvent.deleteMany()
        await storage.vulnerability.deleteMany()

        await upsertVulnerabilities([input])

        const codeHash = createHash('sha256').update(input.codeSnippet).digest('hex')
        const vuln = await storage.vulnerability.findUnique({
          where: {
            vuln_idempotent: {
              filePath: input.filePath,
              line: input.line,
              column: input.column,
              codeHash,
              type: input.type,
            },
          },
        })
        expect(vuln).not.toBeNull()

        const count = await storage.vulnerabilityEvent.count({
          where: {
            vulnerabilityId: vuln.id,
            eventType: 'scan_detected',
            toStatus: 'open',
          },
        })
        expect(count).toBe(1)
      }),
      { numRuns: 20 },
    )
  })

  it('stableFingerprint relocation 會更新既有漏洞位置並寫入 scan_relocated 事件', async () => {
    const original: VulnerabilityInput = {
      filePath: 'src/original.ts',
      line: 10,
      column: 2,
      endLine: 10,
      endColumn: 20,
      codeSnippet: 'dangerousCall(userInput)',
      type: 'xss',
      severity: 'high',
      description: '可疑輸入直接進入輸出點',
      stableFingerprint: 'f'.repeat(64),
    }
    const moved: VulnerabilityInput = {
      ...original,
      filePath: 'src/renamed.ts',
      line: 30,
      column: 6,
      endLine: 30,
      endColumn: 26,
      codeSnippet: 'dangerousCall(userInput)\n// moved',
    }

    await upsertVulnerabilities([original])
    const result = await upsertVulnerabilities([moved])

    const rows = await storage.vulnerability.findMany({
      where: { stableFingerprint: 'f'.repeat(64) },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.filePath).toBe('src/renamed.ts')
    expect(rows[0]?.line).toBe(30)
    expect(result.relocationCount).toBe(1)
    expect(result.metrics.fs_write_ops_per_scan).toBe(3)

    const events = await storage.vulnerabilityEvent.findMany({
      where: { vulnerabilityId: rows[0]?.id },
      orderBy: { createdAt: 'asc' },
    })
    const relocation = events.find((item) => item.eventType === 'scan_relocated')
    expect(relocation).toBeTruthy()
    expect(relocation?.fromFilePath).toBe('src/original.ts')
    expect(relocation?.toFilePath).toBe('src/renamed.ts')
    expect(relocation?.fromLine).toBe(10)
    expect(relocation?.toLine).toBe(30)
  })

  it('transaction should keep status update and event write consistent', async () => {
    const input: VulnerabilityInput = {
      filePath: 'src/app.ts',
      line: 10,
      column: 2,
      endLine: 10,
      endColumn: 15,
      codeSnippet: 'eval(userInput)',
      type: 'eval_usage',
      severity: 'high',
      description: '危險函式呼叫',
    }

    await upsertVulnerabilities([input])

    const codeHash = createHash('sha256').update(input.codeSnippet).digest('hex')
    const vuln = await storage.vulnerability.findUnique({
      where: {
        vuln_idempotent: {
          filePath: input.filePath,
          line: input.line,
          column: input.column,
          codeHash,
          type: input.type,
        },
      },
    })

    expect(vuln).not.toBeNull()

    await storage.$transaction(async (tx) => {
      await tx.vulnerability.update({
        where: { id: vuln.id },
        data: { status: 'fixed' },
      })

      await tx.vulnerabilityEvent.createMany({
        data: [
          {
            vulnerabilityId: vuln.id,
            eventType: 'status_changed',
            message: '狀態流轉：open -> fixed',
            fromStatus: 'open',
            toStatus: 'fixed',
            fromHumanStatus: vuln.humanStatus,
            toHumanStatus: vuln.humanStatus,
          },
        ],
      })
    })

    const updated = await storage.vulnerability.findUnique({ where: { id: vuln.id } })
    expect(updated?.status).toBe('fixed')

    const eventCount = await storage.vulnerabilityEvent.count({
      where: {
        vulnerabilityId: vuln.id,
        eventType: 'status_changed',
        toStatus: 'fixed',
      },
    })
    expect(eventCount).toBe(1)
  })

  it('config upsert should write .confession/config.json', async () => {
    const root = process.env.CONFESSION_PROJECT_ROOT
    expect(root).toBeTruthy()

    await storage.config.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        data: JSON.stringify({
          ...DEFAULT_CONFIG,
          ignore: { paths: ['dist'], types: ['xss'] },
        }),
      },
      update: {
        data: JSON.stringify({
          ...DEFAULT_CONFIG,
          ignore: { paths: ['dist'], types: ['xss'] },
        }),
      },
    })

    const configPath = path.join(root, '.confession/config.json')
    expect(fs.existsSync(configPath)).toBe(true)

    const stored = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    expect(stored.ignore.paths).toEqual(['dist'])
    expect(stored.ignore.types).toEqual(['xss'])
  })
})

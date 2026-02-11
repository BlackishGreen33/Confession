/**
 * PBT：漏洞記錄冪等性測試（P3）
 * 驗證需求 2.6.2
 *
 * 性質：透過 upsertVulnerabilities 插入相同漏洞兩次，
 * 資料庫中應只存在一筆記錄（冪等寫入）。
 */
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import * as fc from 'fast-check'
import fs from 'fs'
import path from 'path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { PrismaClient } from '../../generated/prisma/client'

const TEST_DB_PATH = path.resolve(__dirname, '../../../../test-idempotency.db')
const TEST_DB_URL = `file:${TEST_DB_PATH}`

let prisma: PrismaClient

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
  owaspCategory?: string | null
}

/** 複製 db.ts 的 upsert 邏輯，使用測試用 prisma client */
async function upsertVulnerabilities(vulns: VulnerabilityInput[]) {
  for (const v of vulns) {
    const codeHash = createHash('sha256').update(v.codeSnippet).digest('hex')
    await prisma.vulnerability.upsert({
      where: {
        vuln_idempotent: {
          filePath: v.filePath,
          line: v.line,
          column: v.column,
          codeHash,
          type: v.type,
        },
      },
      create: { ...v, codeHash },
      update: {
        description: v.description,
        severity: v.severity,
        fixOldCode: v.fixOldCode,
        fixNewCode: v.fixNewCode,
        fixExplanation: v.fixExplanation,
      },
    })
  }
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "vulnerabilities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filePath" TEXT NOT NULL,
    "line" INTEGER NOT NULL,
    "column" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    "endColumn" INTEGER NOT NULL,
    "codeSnippet" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "cweId" TEXT,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "riskDescription" TEXT,
    "fixOldCode" TEXT,
    "fixNewCode" TEXT,
    "fixExplanation" TEXT,
    "aiModel" TEXT,
    "aiConfidence" REAL,
    "aiReasoning" TEXT,
    "humanStatus" TEXT NOT NULL DEFAULT 'pending',
    "humanComment" TEXT,
    "humanReviewedAt" DATETIME,
    "owaspCategory" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "vulnerabilities_filePath_line_column_codeHash_type_key"
  ON "vulnerabilities"("filePath", "line", "column", "codeHash", "type");
CREATE INDEX IF NOT EXISTS "vulnerabilities_status_idx" ON "vulnerabilities"("status");
CREATE INDEX IF NOT EXISTS "vulnerabilities_severity_idx" ON "vulnerabilities"("severity");
CREATE INDEX IF NOT EXISTS "vulnerabilities_filePath_idx" ON "vulnerabilities"("filePath");
`

const vulnInputArb: fc.Arbitrary<VulnerabilityInput> = fc.record({
  filePath: fc.string({ minLength: 1, maxLength: 20, unit: 'grapheme' }).map(s => `src/${s.replace(/\0/g, '_')}.ts`),
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

beforeAll(async () => {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH)

  // 透過 better-sqlite3 直接建立 schema（無需 CLI）
  const db = new Database(TEST_DB_PATH)
  db.exec(SCHEMA_SQL)
  db.close()

  const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL })
  prisma = new PrismaClient({ adapter })
})

afterEach(async () => {
  await prisma.vulnerability.deleteMany()
})

afterAll(async () => {
  await prisma.$disconnect()
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH)
})

describe('P3: Vulnerability record idempotency', () => {
  it('inserting the same vulnerability twice produces exactly one record', async () => {
    await fc.assert(
      fc.asyncProperty(vulnInputArb, async (input) => {
        await prisma.vulnerability.deleteMany()

        // 插入相同漏洞兩次
        await upsertVulnerabilities([input])
        await upsertVulnerabilities([input])

        // 計算符合唯一複合鍵的記錄數
        const codeHash = createHash('sha256').update(input.codeSnippet).digest('hex')
        const count = await prisma.vulnerability.count({
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
      { numRuns: 50 },
    )
  })
})

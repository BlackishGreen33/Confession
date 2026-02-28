import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { createHash } from 'crypto'

import { PrismaClient } from '../generated/prisma/client'

const connectionString = process.env.DATABASE_URL ?? 'file:./dev.db'
const adapter = new PrismaBetterSqlite3({ url: connectionString })

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }
export const prisma = globalForPrisma.prisma || new PrismaClient({ adapter })
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export interface VulnerabilityInput {
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

export async function upsertVulnerabilities(vulns: VulnerabilityInput[]) {
  for (const v of vulns) {
    const codeHash = createHash('sha256').update(v.codeSnippet).digest('hex')
    try {
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
        create: {
          ...v,
          codeHash,
          events: {
            create: {
              eventType: 'scan_detected',
              message: '掃描發現新漏洞',
              toStatus: 'open',
            },
          },
        },
        update: {
          description: v.description,
          severity: v.severity,
          fixOldCode: v.fixOldCode,
          fixNewCode: v.fixNewCode,
          fixExplanation: v.fixExplanation,
        },
      })
    } catch (err) {
      // 相容舊 DB：migration 尚未套用時回退舊 upsert，避免掃描全失敗
      if (!isMissingEventsTableError(err)) throw err
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
}

function isMissingEventsTableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const maybeCode = (err as { code?: unknown }).code
  const maybeMessage = (err as { message?: unknown }).message
  const code = typeof maybeCode === 'string' ? maybeCode : ''
  const message = typeof maybeMessage === 'string' ? maybeMessage : ''
  return code === 'P2021' || /vulnerability_events/i.test(message)
}

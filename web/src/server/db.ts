import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { createHash } from 'crypto'

import { PrismaClient } from '../generated/prisma/client'
import { deduplicateVulnerabilities } from './vulnerability-dedupe'

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

const UPSERT_CHUNK_SIZE = 50

export async function upsertVulnerabilities(vulns: VulnerabilityInput[]) {
  const deduped = deduplicateVulnerabilities(vulns)

  for (let start = 0; start < deduped.length; start += UPSERT_CHUNK_SIZE) {
    const chunk = deduped.slice(start, start + UPSERT_CHUNK_SIZE).map((item) => ({
      vuln: item,
      codeHash: createHash('sha256').update(item.codeSnippet).digest('hex'),
    }))

    try {
      await prisma.$transaction(async (tx) => {
        for (const { vuln, codeHash } of chunk) {
          await tx.vulnerability.upsert({
            where: {
              vuln_idempotent: {
                filePath: vuln.filePath,
                line: vuln.line,
                column: vuln.column,
                codeHash,
                type: vuln.type,
              },
            },
            create: {
              ...vuln,
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
              description: vuln.description,
              severity: vuln.severity,
              fixOldCode: vuln.fixOldCode,
              fixNewCode: vuln.fixNewCode,
              fixExplanation: vuln.fixExplanation,
            },
          })
        }
      })
    } catch (err) {
      // 相容舊 DB：migration 尚未套用時回退舊 upsert，避免掃描全失敗
      if (!isMissingEventsTableError(err)) throw err

      await prisma.$transaction(async (tx) => {
        for (const { vuln, codeHash } of chunk) {
          await tx.vulnerability.upsert({
            where: {
              vuln_idempotent: {
                filePath: vuln.filePath,
                line: vuln.line,
                column: vuln.column,
                codeHash,
                type: vuln.type,
              },
            },
            create: { ...vuln, codeHash },
            update: {
              description: vuln.description,
              severity: vuln.severity,
              fixOldCode: vuln.fixOldCode,
              fixNewCode: vuln.fixNewCode,
              fixExplanation: vuln.fixExplanation,
            },
          })
        }
      })
    }
  }

  await prunePendingOpenDuplicates(deduped)
}

async function prunePendingOpenDuplicates(vulns: VulnerabilityInput[]): Promise<void> {
  if (vulns.length === 0) return

  const linesByFile = new Map<string, Set<number>>()
  for (const vuln of vulns) {
    const lines = linesByFile.get(vuln.filePath) ?? new Set<number>()
    lines.add(vuln.line)
    linesByFile.set(vuln.filePath, lines)
  }

  const filePaths = Array.from(linesByFile.keys())
  if (filePaths.length === 0) return

  const candidates = await prisma.vulnerability.findMany({
    where: {
      filePath: { in: filePaths },
      status: 'open',
      humanStatus: 'pending',
    },
    select: {
      id: true,
      filePath: true,
      line: true,
      column: true,
      endLine: true,
      endColumn: true,
      type: true,
      cweId: true,
      severity: true,
      description: true,
      codeSnippet: true,
      aiConfidence: true,
      status: true,
      humanStatus: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  const scoped = candidates.filter((item) => linesByFile.get(item.filePath)?.has(item.line) ?? false)
  if (scoped.length <= 1) return

  const deduped = deduplicateVulnerabilities(scoped)
  if (deduped.length === scoped.length) return

  const keepIds = new Set(deduped.map((item) => item.id))
  const deleteIds = scoped.filter((item) => !keepIds.has(item.id)).map((item) => item.id)
  if (deleteIds.length === 0) return

  await prisma.vulnerability.deleteMany({
    where: { id: { in: deleteIds } },
  })
}

function isMissingEventsTableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const maybeCode = (err as { code?: unknown }).code
  const maybeMessage = (err as { message?: unknown }).message
  const code = typeof maybeCode === 'string' ? maybeCode : ''
  const message = typeof maybeMessage === 'string' ? maybeMessage : ''
  return code === 'P2021' || /vulnerability_events/i.test(message)
}

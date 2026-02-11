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

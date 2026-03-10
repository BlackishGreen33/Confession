import { createHash } from 'node:crypto'

import type { StorageScopedClient } from './client'
import { createStableFingerprint } from './snapshot-codec'
import type { VulnerabilityInput } from './types'

export interface NormalizedVulnerability extends VulnerabilityInput {
  stableFingerprint: string
  source: 'sast' | 'dast'
}

export interface NormalizedVulnerabilityWithHash extends NormalizedVulnerability {
  codeHash: string
}

interface RelocationCandidateRow {
  id: string
  stableFingerprint: string
  filePath: string
  line: number
  humanStatus: string
  status: string
  updatedAt: Date
  createdAt: Date
}

interface ExactMatchIndexRow {
  id: string
  filePath: string
  line: number
  column: number
  codeHash: string
  type: string
}

export function buildIdempotentKey(vuln: {
  filePath: string
  line: number
  column: number
  codeHash: string
  type: string
}): string {
  return `${vuln.filePath}::${vuln.line}::${vuln.column}::${vuln.codeHash}::${vuln.type}`
}

export async function buildExactIdByKey(
  client: StorageScopedClient,
  vulns: NormalizedVulnerabilityWithHash[],
): Promise<Map<string, string>> {
  if (vulns.length === 0) return new Map()

  const whereOr = vulns.map((item) => ({
    filePath: item.filePath,
    line: item.line,
    column: item.column,
    codeHash: item.codeHash,
    type: item.type,
  }))

  const rows = (await client.vulnerability.findMany({
    where: { OR: whereOr },
    select: {
      id: true,
      filePath: true,
      line: true,
      column: true,
      codeHash: true,
      type: true,
    },
  })) as unknown as ExactMatchIndexRow[]

  const index = new Map<string, string>()
  for (const row of rows) {
    const key = buildIdempotentKey({
      filePath: row.filePath,
      line: row.line,
      column: row.column,
      codeHash: row.codeHash,
      type: row.type,
    })
    index.set(key, row.id)
  }
  return index
}

export function normalizeVulnerabilityInputsForUpsert(
  vulns: VulnerabilityInput[],
): NormalizedVulnerability[] {
  const indexed = vulns
    .map((vuln, originalIndex) => ({ vuln, originalIndex }))
    .sort((left, right) => {
      const fileDiff = left.vuln.filePath.localeCompare(right.vuln.filePath)
      if (fileDiff !== 0) return fileDiff
      const typeDiff = left.vuln.type.localeCompare(right.vuln.type)
      if (typeDiff !== 0) return typeDiff
      const lineDiff = left.vuln.line - right.vuln.line
      if (lineDiff !== 0) return lineDiff
      return left.vuln.column - right.vuln.column
    })

  const counters = new Map<string, number>()
  const normalized = new Array<NormalizedVulnerability>(vulns.length)

  for (const item of indexed) {
    const source = item.vuln.source === 'dast' ? 'dast' : 'sast'
    const normalizedPath = normalizeStableFingerprintPath(item.vuln.filePath)
    const normalizedType = item.vuln.type.trim().toLowerCase()
    const normalizedSnippet = normalizeStableFingerprintSnippet(item.vuln.codeSnippet)
    const baseKey = `${normalizedPath}::${normalizedType}::${normalizedSnippet}`
    const nextIndex = (counters.get(baseKey) ?? 0) + 1
    counters.set(baseKey, nextIndex)
    const stableFingerprint =
      typeof item.vuln.stableFingerprint === 'string' &&
      item.vuln.stableFingerprint.trim().length > 0
        ? item.vuln.stableFingerprint
        : createStableFingerprint({
            filePath: item.vuln.filePath,
            type: item.vuln.type,
            codeSnippet: item.vuln.codeSnippet,
            index: nextIndex,
          })

    normalized[item.originalIndex] = {
      ...item.vuln,
      stableFingerprint,
      source,
    }
  }

  return normalized
}

export async function buildRelocationQueues(
  client: StorageScopedClient,
  stableFingerprints: string[],
): Promise<Map<string, RelocationCandidateRow[]>> {
  const dedupedFingerprints = Array.from(
    new Set(
      stableFingerprints
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  )
  if (dedupedFingerprints.length === 0) return new Map()

  const rows = await client.vulnerability.findMany({
    where: {
      stableFingerprint: { in: dedupedFingerprints },
      status: 'open',
    },
    select: {
      id: true,
      stableFingerprint: true,
      filePath: true,
      line: true,
      humanStatus: true,
      status: true,
      updatedAt: true,
      createdAt: true,
    },
  })

  const grouped = new Map<string, RelocationCandidateRow[]>()

  for (const row of rows) {
    const fingerprint = String(row.stableFingerprint)
    const queue = grouped.get(fingerprint) ?? []
    queue.push({
      id: String(row.id),
      stableFingerprint: fingerprint,
      filePath: String(row.filePath),
      line: Number(row.line),
      humanStatus: String(row.humanStatus),
      status: String(row.status),
      updatedAt: row.updatedAt as Date,
      createdAt: row.createdAt as Date,
    })
    grouped.set(fingerprint, queue)
  }

  for (const queue of grouped.values()) {
    queue.sort((left, right) => {
      const updatedDiff = right.updatedAt.getTime() - left.updatedAt.getTime()
      if (updatedDiff !== 0) return updatedDiff
      return right.createdAt.getTime() - left.createdAt.getTime()
    })
  }

  return grouped
}

export function takeRelocationCandidate(
  queue: RelocationCandidateRow[] | undefined,
  consumedIds: Set<string>,
): RelocationCandidateRow | null {
  if (!queue || queue.length === 0) return null
  while (queue.length > 0) {
    const candidate = queue.shift()
    if (!candidate) break
    if (consumedIds.has(candidate.id)) continue
    return candidate
  }
  return null
}

export function attachCodeHashForUpsert(
  items: NormalizedVulnerability[],
): NormalizedVulnerabilityWithHash[] {
  return items.map((vuln) => ({
    ...vuln,
    codeHash: createHash('sha256').update(vuln.codeSnippet).digest('hex'),
  }))
}

export function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const rawIndex = Math.ceil(sorted.length * ratio) - 1
  const index = Math.max(0, Math.min(sorted.length - 1, rawIndex))
  return Math.round(sorted[index])
}

function normalizeStableFingerprintSnippet(codeSnippet: string): string {
  return codeSnippet
    .replace(/\d+/g, '#')
    .replace(/["'`][^"'`]{1,64}["'`]/g, 'STR')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
}

function normalizeStableFingerprintPath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')
    .split('/')
    .slice(-3)
    .join('/')
}

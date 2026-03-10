import { deduplicateVulnerabilities } from '../vulnerability-dedupe'
import {
  type StorageScopedClient,
  withVulnerabilityWriteClient,
} from './client'
import type {
  LockTelemetry,
  UpsertStorageMetrics,
  UpsertVulnerabilitiesResult,
  VulnerabilityInput,
  WriteTelemetry,
} from './types'
import {
  attachCodeHashForUpsert,
  buildExactIdByKey,
  buildIdempotentKey,
  buildRelocationQueues,
  normalizeVulnerabilityInputsForUpsert,
  percentile,
  takeRelocationCandidate,
} from './upsert-vulnerabilities-helpers'

interface UpsertVulnerabilitiesOptions {
  taskId?: string
}

interface EventCreateInput {
  vulnerabilityId: string
  eventType: string
  message: string
  fromStatus?: string
  toStatus?: string
  fromHumanStatus?: string
  toHumanStatus?: string
  fromFilePath?: string
  fromLine?: number
  toFilePath?: string
  toLine?: number
}

interface PendingDedupCandidate {
  id: string
  filePath: string
  line: number
  column: number
  endLine: number
  endColumn: number
  type: string
  cweId: string | null
  severity: string
  description: string
  codeSnippet: string
  aiConfidence: number | null
  stableFingerprint: string
  status: string
  humanStatus: string
  createdAt: Date
  updatedAt: Date
}

export async function upsertVulnerabilities(
  vulns: VulnerabilityInput[],
  options: UpsertVulnerabilitiesOptions = {},
): Promise<UpsertVulnerabilitiesResult> {
  const startedAt = Date.now()
  const deduped = deduplicateVulnerabilities(vulns)
  const normalized = normalizeVulnerabilityInputsForUpsert(deduped)
  const stableFingerprints = normalized.map((item) => item.stableFingerprint)

  if (normalized.length === 0) {
    return {
      stableFingerprints,
      relocationCount: 0,
      metrics: {
        fs_write_ops_per_scan: 0,
        db_lock_wait_ms_p95: 0,
        db_lock_hold_ms_p95: 0,
        db_lock_timeout_count: 0,
      },
    }
  }

  const lockTelemetry: LockTelemetry = {
    waitMsSamples: [],
    holdMsSamples: [],
    timeoutCount: 0,
  }
  const writeTelemetry: WriteTelemetry = { writeOps: 0 }
  let relocationCount = 0
  let exactHitCount = 0

  await withVulnerabilityWriteClient(
    async (client) => {
      const normalizedWithHash = attachCodeHashForUpsert(normalized)
      const exactIdByKey = await buildExactIdByKey(client, normalizedWithHash)
      const relocationQueues = await buildRelocationQueues(client, stableFingerprints)
      const consumedRelocationIds = new Set<string>()
      const pendingEvents: EventCreateInput[] = []

      for (const vuln of normalizedWithHash) {
        const idempotentKey = buildIdempotentKey(vuln)
        const exactId = exactIdByKey.get(idempotentKey)

        if (!exactId) {
          const relocation = takeRelocationCandidate(
            relocationQueues.get(vuln.stableFingerprint),
            consumedRelocationIds,
          )

          if (relocation) {
            consumedRelocationIds.add(relocation.id)
            const moved =
              relocation.filePath !== vuln.filePath || relocation.line !== vuln.line

            await client.vulnerability.update({
              where: { id: relocation.id },
              data: {
                filePath: vuln.filePath,
                line: vuln.line,
                column: vuln.column,
                endLine: vuln.endLine,
                endColumn: vuln.endColumn,
                codeSnippet: vuln.codeSnippet,
                codeHash: vuln.codeHash,
                type: vuln.type,
                cweId: vuln.cweId,
                severity: vuln.severity,
                description: vuln.description,
                riskDescription: vuln.riskDescription,
                fixOldCode: vuln.fixOldCode,
                fixNewCode: vuln.fixNewCode,
                fixExplanation: vuln.fixExplanation,
                aiModel: vuln.aiModel,
                aiConfidence: vuln.aiConfidence,
                aiReasoning: vuln.aiReasoning,
                stableFingerprint: vuln.stableFingerprint,
                source: vuln.source,
              },
            })

            if (moved) {
              relocationCount += 1
              pendingEvents.push({
                vulnerabilityId: relocation.id,
                eventType: 'scan_relocated',
                message: `掃描關聯到既有漏洞（${relocation.filePath}:${relocation.line} -> ${vuln.filePath}:${vuln.line}）`,
                fromStatus: relocation.status,
                toStatus: relocation.status,
                fromHumanStatus: relocation.humanStatus,
                toHumanStatus: relocation.humanStatus,
                fromFilePath: relocation.filePath,
                fromLine: relocation.line,
                toFilePath: vuln.filePath,
                toLine: vuln.line,
              })
            }
            exactIdByKey.set(idempotentKey, relocation.id)
            continue
          }
        }

        if (exactId) {
          exactHitCount += 1
          await client.vulnerability.update({
            where: { id: exactId },
            data: {
              filePath: vuln.filePath,
              line: vuln.line,
              column: vuln.column,
              endLine: vuln.endLine,
              endColumn: vuln.endColumn,
              codeSnippet: vuln.codeSnippet,
              codeHash: vuln.codeHash,
              type: vuln.type,
              cweId: vuln.cweId,
              severity: vuln.severity,
              description: vuln.description,
              riskDescription: vuln.riskDescription,
              fixOldCode: vuln.fixOldCode,
              fixNewCode: vuln.fixNewCode,
              fixExplanation: vuln.fixExplanation,
              aiModel: vuln.aiModel,
              aiConfidence: vuln.aiConfidence,
              aiReasoning: vuln.aiReasoning,
              stableFingerprint: vuln.stableFingerprint,
              source: vuln.source,
            },
          })
          continue
        }

        const created = await client.vulnerability.create({
          data: {
            filePath: vuln.filePath,
            line: vuln.line,
            column: vuln.column,
            endLine: vuln.endLine,
            endColumn: vuln.endColumn,
            codeSnippet: vuln.codeSnippet,
            codeHash: vuln.codeHash,
            type: vuln.type,
            cweId: vuln.cweId,
            severity: vuln.severity,
            description: vuln.description,
            riskDescription: vuln.riskDescription,
            fixOldCode: vuln.fixOldCode,
            fixNewCode: vuln.fixNewCode,
            fixExplanation: vuln.fixExplanation,
            aiModel: vuln.aiModel,
            aiConfidence: vuln.aiConfidence,
            aiReasoning: vuln.aiReasoning,
            stableFingerprint: vuln.stableFingerprint,
            source: vuln.source,
          },
          select: { id: true },
        })
        exactIdByKey.set(idempotentKey, String(created.id))
        pendingEvents.push({
          vulnerabilityId: String(created.id),
          eventType: 'scan_detected',
          message: '掃描發現新漏洞',
          toStatus: 'open',
        })
      }

      if (pendingEvents.length > 0) {
        await client.vulnerabilityEvent.createMany({
          data: pendingEvents,
        })
      }

      await prunePendingOpenDuplicatesInSnapshot(client, normalized)
    },
    lockTelemetry,
    writeTelemetry,
  )

  const metrics: UpsertStorageMetrics = {
    fs_write_ops_per_scan: writeTelemetry.writeOps,
    db_lock_wait_ms_p95: percentile(lockTelemetry.waitMsSamples, 0.95),
    db_lock_hold_ms_p95: percentile(lockTelemetry.holdMsSamples, 0.95),
    db_lock_timeout_count: lockTelemetry.timeoutCount,
  }

  if (options.taskId) {
    process.stdout.write(
      `[Confession][StorageWriteMetrics] ${JSON.stringify({
        taskId: options.taskId,
        ...metrics,
        upsert_input_count: normalized.length,
        upsert_exact_hit_count: exactHitCount,
        upsert_relocation_count: relocationCount,
        upsert_elapsed_ms: Math.max(0, Date.now() - startedAt),
        relocation_count: relocationCount,
      })}\n`,
    )
  }

  return {
    stableFingerprints,
    relocationCount,
    metrics,
  }
}

async function prunePendingOpenDuplicatesInSnapshot(
  client: StorageScopedClient,
  vulns: VulnerabilityInput[],
): Promise<void> {
  if (vulns.length === 0) return

  const linesByFile = new Map<string, Set<number>>()
  for (const vuln of vulns) {
    const lines = linesByFile.get(vuln.filePath) ?? new Set<number>()
    lines.add(vuln.line)
    linesByFile.set(vuln.filePath, lines)
  }

  const filePaths = Array.from(linesByFile.keys())
  if (filePaths.length === 0) return

  const candidates = await client.vulnerability.findMany({
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
      stableFingerprint: true,
      status: true,
      humanStatus: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  const typedCandidates = candidates as unknown as PendingDedupCandidate[]
  const scoped = typedCandidates.filter(
    (item) => linesByFile.get(item.filePath)?.has(item.line) ?? false,
  )
  if (scoped.length <= 1) return

  const deduped = deduplicateVulnerabilities(scoped)
  if (deduped.length === scoped.length) return

  const keepIds = new Set(deduped.map((item) => item.id))
  const deleteIds = scoped
    .filter((item) => !keepIds.has(item.id))
    .map((item) => item.id)
  if (deleteIds.length === 0) return

  await client.vulnerability.deleteMany({
    where: { id: { in: deleteIds } },
  })
}

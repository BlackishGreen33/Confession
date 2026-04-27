import { randomUUID } from 'node:crypto'

import {
  applyOrderBy,
  applyPatch,
  applySelect,
  applyTakeSkip,
  applyWhere,
  findUniqueByWhere,
  matchesWhere,
  type QueryArgs,
} from './query-engine'
import {
  cloneValue,
  createStableFingerprint,
  extractConfigData,
  normalizeConfigValue,
  normalizeScanTaskEngineMode,
  normalizeScanTaskErrorCode,
  normalizeScanTaskFallbackFrom,
  now,
  toDate,
} from './snapshot-codec'
import type {
  AdviceDecisionRecord,
  AdviceSnapshotRecord,
  ScanTaskRecord,
  Snapshot,
  VulnerabilityEventRecord,
  VulnerabilityRecord,
} from './types'

type MutationArgs = QueryArgs & {
  data?: unknown
  create?: unknown
  update?: unknown
}

function generateId(): string {
  return randomUUID().replace(/-/g, '')
}

function normalizeVulnerabilityCreate(
  data: Record<string, unknown>
): VulnerabilityRecord {
  const createdAt = now()
  const filePath = String(data.filePath ?? '')
  const type = String(data.type ?? '')
  const codeSnippet = String(data.codeSnippet ?? '')
  const stableFingerprint =
    typeof data.stableFingerprint === 'string' &&
    data.stableFingerprint.trim().length > 0
      ? data.stableFingerprint
      : createStableFingerprint({
          filePath,
          type,
          codeSnippet,
          index:
            typeof data.stableFingerprintIndex === 'number'
              ? data.stableFingerprintIndex
              : 1,
        })

  return {
    id: typeof data.id === 'string' ? data.id : generateId(),
    filePath,
    line: Number(data.line ?? 0),
    column: Number(data.column ?? 0),
    endLine: Number(data.endLine ?? Number(data.line ?? 0)),
    endColumn: Number(data.endColumn ?? Number(data.column ?? 0)),
    codeSnippet,
    codeHash: String(data.codeHash ?? ''),
    type,
    cweId: typeof data.cweId === 'string' ? data.cweId : null,
    severity: String(data.severity ?? 'medium'),
    description: String(data.description ?? ''),
    riskDescription:
      typeof data.riskDescription === 'string' ? data.riskDescription : null,
    fixOldCode: typeof data.fixOldCode === 'string' ? data.fixOldCode : null,
    fixNewCode: typeof data.fixNewCode === 'string' ? data.fixNewCode : null,
    fixExplanation:
      typeof data.fixExplanation === 'string' ? data.fixExplanation : null,
    aiModel: typeof data.aiModel === 'string' ? data.aiModel : null,
    aiConfidence:
      typeof data.aiConfidence === 'number' ? data.aiConfidence : null,
    aiReasoning: typeof data.aiReasoning === 'string' ? data.aiReasoning : null,
    stableFingerprint,
    source: data.source === 'dast' ? 'dast' : 'sast',
    humanStatus:
      typeof data.humanStatus === 'string' ? data.humanStatus : 'pending',
    humanComment:
      typeof data.humanComment === 'string' ? data.humanComment : null,
    humanReviewedAt:
      data.humanReviewedAt instanceof Date
        ? new Date(data.humanReviewedAt.getTime())
        : typeof data.humanReviewedAt === 'string' && data.humanReviewedAt
          ? toDate(data.humanReviewedAt, createdAt)
          : null,
    owaspCategory:
      typeof data.owaspCategory === 'string' ? data.owaspCategory : null,
    status: typeof data.status === 'string' ? data.status : 'open',
    createdAt,
    updatedAt: createdAt,
  }
}

function normalizeVulnerabilityEventCreate(
  data: Record<string, unknown>
): VulnerabilityEventRecord {
  return {
    id: typeof data.id === 'string' ? data.id : generateId(),
    vulnerabilityId: String(data.vulnerabilityId ?? ''),
    eventType: String(data.eventType ?? ''),
    message: String(data.message ?? ''),
    fromStatus: typeof data.fromStatus === 'string' ? data.fromStatus : null,
    toStatus: typeof data.toStatus === 'string' ? data.toStatus : null,
    fromHumanStatus:
      typeof data.fromHumanStatus === 'string' ? data.fromHumanStatus : null,
    toHumanStatus:
      typeof data.toHumanStatus === 'string' ? data.toHumanStatus : null,
    fromFilePath:
      typeof data.fromFilePath === 'string' ? data.fromFilePath : null,
    fromLine:
      typeof data.fromLine === 'number' ? Math.floor(data.fromLine) : null,
    toFilePath: typeof data.toFilePath === 'string' ? data.toFilePath : null,
    toLine: typeof data.toLine === 'number' ? Math.floor(data.toLine) : null,
    createdAt: now(),
  }
}

function normalizeScanTaskCreate(
  data: Record<string, unknown>
): ScanTaskRecord {
  const createdAt = now()
  return {
    id: typeof data.id === 'string' ? data.id : generateId(),
    status: typeof data.status === 'string' ? data.status : 'pending',
    engineMode: normalizeScanTaskEngineMode(data.engineMode),
    progress: typeof data.progress === 'number' ? data.progress : 0,
    totalFiles: typeof data.totalFiles === 'number' ? data.totalFiles : 0,
    scannedFiles: typeof data.scannedFiles === 'number' ? data.scannedFiles : 0,
    fallbackUsed: Boolean(data.fallbackUsed),
    fallbackFrom: normalizeScanTaskFallbackFrom(data.fallbackFrom),
    fallbackTo: typeof data.fallbackTo === 'string' ? data.fallbackTo : null,
    fallbackReason:
      typeof data.fallbackReason === 'string' ? data.fallbackReason : null,
    errorMessage:
      typeof data.errorMessage === 'string' ? data.errorMessage : null,
    errorCode: normalizeScanTaskErrorCode(data.errorCode),
    createdAt,
    updatedAt: createdAt,
  }
}

function normalizeAdviceSnapshotCreate(
  data: Record<string, unknown>
): AdviceSnapshotRecord {
  const createdAt = now()
  return {
    id: typeof data.id === 'string' ? data.id : generateId(),
    summary: String(data.summary ?? ''),
    confidence: typeof data.confidence === 'number' ? data.confidence : 0,
    triggerScore: typeof data.triggerScore === 'number' ? data.triggerScore : 0,
    triggerReason: String(data.triggerReason ?? ''),
    sourceEvent: String(data.sourceEvent ?? ''),
    metricsFingerprint: String(data.metricsFingerprint ?? ''),
    actionItems: String(data.actionItems ?? '[]'),
    rawResponse: typeof data.rawResponse === 'string' ? data.rawResponse : null,
    createdAt,
    updatedAt: createdAt,
  }
}

function normalizeAdviceDecisionCreate(
  data: Record<string, unknown>
): AdviceDecisionRecord {
  return {
    id: typeof data.id === 'string' ? data.id : generateId(),
    sourceEvent: String(data.sourceEvent ?? ''),
    sourceTaskId:
      typeof data.sourceTaskId === 'string' ? data.sourceTaskId : null,
    sourceVulnerabilityId:
      typeof data.sourceVulnerabilityId === 'string'
        ? data.sourceVulnerabilityId
        : null,
    triggerScore: typeof data.triggerScore === 'number' ? data.triggerScore : 0,
    triggerReason: String(data.triggerReason ?? ''),
    metricsFingerprint: String(data.metricsFingerprint ?? ''),
    shouldCallAi: Boolean(data.shouldCallAi),
    calledAi: Boolean(data.calledAi),
    blockedReason:
      typeof data.blockedReason === 'string' ? data.blockedReason : null,
    llmError: typeof data.llmError === 'string' ? data.llmError : null,
    metricSnapshot: String(data.metricSnapshot ?? '{}'),
    adviceSnapshotId:
      typeof data.adviceSnapshotId === 'string' ? data.adviceSnapshotId : null,
    createdAt: now(),
  }
}

async function findFirstByQuery<T extends object>(
  rows: T[],
  args: QueryArgs = {}
): Promise<Record<string, unknown> | null> {
  const ordered = applyOrderBy(applyWhere(rows, args.where), args.orderBy)
  const limited = applyTakeSkip(ordered, args)
  const first = limited[0]
  if (!first) return null
  return applySelect(first, args.select)
}

export function buildScopedClient(snapshot: Snapshot) {
  return {
    vulnerability: {
      findMany: async (args: QueryArgs = {}) => {
        const ordered = applyOrderBy(
          applyWhere(snapshot.vulnerabilities, args.where),
          args.orderBy
        )
        const limited = applyTakeSkip(ordered, args)
        return limited.map((item) => cloneValue(applySelect(item, args.select)))
      },
      findUnique: async (args: QueryArgs) => {
        const found = findUniqueByWhere(snapshot.vulnerabilities, args?.where)
        if (!found) return null
        return cloneValue(applySelect(found, args?.select))
      },
      findFirst: async (args: QueryArgs = {}) =>
        findFirstByQuery(snapshot.vulnerabilities, args),
      count: async (args: QueryArgs = {}) =>
        applyWhere(snapshot.vulnerabilities, args.where).length,
      create: async (args: MutationArgs) => {
        const record = normalizeVulnerabilityCreate(
          (args.data ?? {}) as Record<string, unknown>
        )
        snapshot.vulnerabilities.push(record)
        return cloneValue(applySelect(record, args.select))
      },
      upsert: async (args: MutationArgs) => {
        const where = args.where
        let record = findUniqueByWhere(
          snapshot.vulnerabilities,
          where
        ) as VulnerabilityRecord | null

        if (!record) {
          const createData = {
            ...((args.create ?? {}) as Record<string, unknown>),
          }
          const events = createData.events as
            | Record<string, unknown>
            | undefined
          delete createData.events
          record = normalizeVulnerabilityCreate(createData)
          snapshot.vulnerabilities.push(record)

          const createEvent = events?.create
          if (createEvent && typeof createEvent === 'object') {
            snapshot.vulnerabilityEvents.push(
              normalizeVulnerabilityEventCreate({
                ...(createEvent as Record<string, unknown>),
                vulnerabilityId: record.id,
              })
            )
          }
        } else {
          applyPatch(record, (args.update ?? {}) as Record<string, unknown>)
          record.updatedAt = now()
        }

        return cloneValue(applySelect(record, args.select))
      },
      update: async (args: MutationArgs) => {
        const found = findUniqueByWhere(
          snapshot.vulnerabilities,
          args.where
        ) as VulnerabilityRecord | null
        if (!found) {
          throw new Error('Record to update not found')
        }
        applyPatch(found, (args.data ?? {}) as Record<string, unknown>)
        found.updatedAt = now()
        return cloneValue(applySelect(found, args.select))
      },
      updateMany: async (args: MutationArgs = {}) => {
        const matched = applyWhere(snapshot.vulnerabilities, args.where)
        for (const row of matched) {
          applyPatch(row, (args.data ?? {}) as Record<string, unknown>)
          row.updatedAt = now()
        }
        return { count: matched.length }
      },
      deleteMany: async (args: MutationArgs = {}) => {
        if (!args.where) {
          const count = snapshot.vulnerabilities.length
          snapshot.vulnerabilities = []
          return { count }
        }
        const before = snapshot.vulnerabilities.length
        snapshot.vulnerabilities = snapshot.vulnerabilities.filter(
          (item) => !matchesWhere(item, args.where)
        )
        return { count: before - snapshot.vulnerabilities.length }
      },
    },
    vulnerabilityEvent: {
      findMany: async (args: QueryArgs = {}) => {
        const ordered = applyOrderBy(
          applyWhere(snapshot.vulnerabilityEvents, args.where),
          args.orderBy
        )
        const limited = applyTakeSkip(ordered, args)
        return limited.map((item) => cloneValue(applySelect(item, args.select)))
      },
      createMany: async (args: MutationArgs = {}) => {
        const rows = Array.isArray(args.data) ? args.data : []
        for (const item of rows) {
          snapshot.vulnerabilityEvents.push(
            normalizeVulnerabilityEventCreate(item as Record<string, unknown>)
          )
        }
        return { count: rows.length }
      },
      deleteMany: async (args: MutationArgs = {}) => {
        if (!args.where) {
          const count = snapshot.vulnerabilityEvents.length
          snapshot.vulnerabilityEvents = []
          return { count }
        }
        const before = snapshot.vulnerabilityEvents.length
        snapshot.vulnerabilityEvents = snapshot.vulnerabilityEvents.filter(
          (item) => !matchesWhere(item, args.where)
        )
        return { count: before - snapshot.vulnerabilityEvents.length }
      },
      count: async (args: QueryArgs = {}) =>
        applyWhere(snapshot.vulnerabilityEvents, args.where).length,
    },
    scanTask: {
      findMany: async (args: QueryArgs = {}) => {
        const ordered = applyOrderBy(
          applyWhere(snapshot.scanTasks, args.where),
          args.orderBy
        )
        const limited = applyTakeSkip(ordered, args)
        return limited.map((item) => cloneValue(applySelect(item, args.select)))
      },
      findFirst: async (args: QueryArgs = {}) =>
        findFirstByQuery(snapshot.scanTasks, args),
      findUnique: async (args: QueryArgs) => {
        const found = findUniqueByWhere(snapshot.scanTasks, args?.where)
        if (!found) return null
        return cloneValue(applySelect(found, args?.select))
      },
      create: async (args: MutationArgs) => {
        const record = normalizeScanTaskCreate(
          (args.data ?? {}) as Record<string, unknown>
        )
        snapshot.scanTasks.push(record)
        return cloneValue(applySelect(record, args.select))
      },
      update: async (args: MutationArgs) => {
        const found = findUniqueByWhere(
          snapshot.scanTasks,
          args.where
        ) as ScanTaskRecord | null
        if (!found) throw new Error('Record to update not found')
        applyPatch(found, (args.data ?? {}) as Record<string, unknown>)
        found.updatedAt = now()
        return cloneValue(applySelect(found, args.select))
      },
      updateMany: async (args: MutationArgs = {}) => {
        const matched = applyWhere(snapshot.scanTasks, args.where)
        for (const row of matched) {
          applyPatch(row, (args.data ?? {}) as Record<string, unknown>)
          row.updatedAt = now()
        }
        return { count: matched.length }
      },
      count: async (args: QueryArgs = {}) =>
        applyWhere(snapshot.scanTasks, args.where).length,
    },
    adviceSnapshot: {
      findFirst: async (args: QueryArgs = {}) =>
        findFirstByQuery(snapshot.adviceSnapshots, args),
      create: async (args: MutationArgs) => {
        const record = normalizeAdviceSnapshotCreate(
          (args.data ?? {}) as Record<string, unknown>
        )
        snapshot.adviceSnapshots.push(record)
        return cloneValue(applySelect(record, args.select))
      },
    },
    adviceDecision: {
      findFirst: async (args: QueryArgs = {}) =>
        findFirstByQuery(snapshot.adviceDecisions, args),
      count: async (args: QueryArgs = {}) =>
        applyWhere(snapshot.adviceDecisions, args.where).length,
      create: async (args: MutationArgs) => {
        const record = normalizeAdviceDecisionCreate(
          (args.data ?? {}) as Record<string, unknown>
        )
        snapshot.adviceDecisions.push(record)
        return cloneValue(applySelect(record, args.select))
      },
      update: async (args: MutationArgs) => {
        const found = findUniqueByWhere(
          snapshot.adviceDecisions,
          args.where
        ) as AdviceDecisionRecord | null
        if (!found) throw new Error('Record to update not found')
        applyPatch(found, (args.data ?? {}) as Record<string, unknown>)
        return cloneValue(applySelect(found, args.select))
      },
    },
    config: {
      findUnique: async (args: QueryArgs) => {
        if (!snapshot.config) return null
        const requestedId = (args?.where as { id?: unknown } | undefined)?.id
        if (requestedId && requestedId !== 'default') return null
        return {
          id: 'default',
          data: JSON.stringify(snapshot.config),
          updatedAt: snapshot.configUpdatedAt ?? now(),
        }
      },
      upsert: async (args: MutationArgs) => {
        const updatePayload = (args.update as { data?: unknown } | undefined)
          ?.data
        const createPayload = (args.create as { data?: unknown } | undefined)
          ?.data
        const payload = updatePayload ?? createPayload
        const parsed =
          typeof payload === 'string'
            ? extractConfigData({ data: payload })
            : normalizeConfigValue(payload)
        snapshot.config = parsed
        snapshot.configUpdatedAt = now()
        return {
          id: 'default',
          data: JSON.stringify(snapshot.config),
          updatedAt: snapshot.configUpdatedAt,
        }
      },
    },
  }
}

export type StorageScopedClient = ReturnType<typeof buildScopedClient>

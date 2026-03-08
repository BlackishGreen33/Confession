import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'

import type { PluginConfig } from '@/libs/types'

import { deduplicateVulnerabilities } from './vulnerability-dedupe'

const CONFESSION_DIR_NAME = '.confession'
const LOCK_FILE_NAME = '.lock'
const LOCK_RETRY_MS = 50
const LOCK_TIMEOUT_MS = 8_000
const SCHEMA_VERSION = 'file-store-v1'

const UPSERT_CHUNK_SIZE = 50

const STORAGE_FILES = {
  vulnerabilities: 'vulnerabilities.json',
  vulnerabilityEvents: 'vulnerability-events.json',
  scanTasks: 'scan-tasks.json',
  adviceSnapshots: 'advice-snapshots.json',
  adviceDecisions: 'advice-decisions.json',
  config: 'config.json',
  meta: 'meta.json',
} as const

const DEFAULT_CONFIG: PluginConfig = {
  llm: { provider: 'nvidia', apiKey: '' },
  analysis: { triggerMode: 'onSave', depth: 'standard', debounceMs: 500 },
  ignore: { paths: [], types: [] },
  api: { baseUrl: 'http://localhost:3000', mode: 'local' },
}

interface VulnerabilityRecord {
  id: string
  filePath: string
  line: number
  column: number
  endLine: number
  endColumn: number
  codeSnippet: string
  codeHash: string
  type: string
  cweId: string | null
  severity: string
  description: string
  riskDescription: string | null
  fixOldCode: string | null
  fixNewCode: string | null
  fixExplanation: string | null
  aiModel: string | null
  aiConfidence: number | null
  aiReasoning: string | null
  humanStatus: string
  humanComment: string | null
  humanReviewedAt: Date | null
  owaspCategory: string | null
  status: string
  createdAt: Date
  updatedAt: Date
}

interface VulnerabilityEventRecord {
  id: string
  vulnerabilityId: string
  eventType: string
  message: string
  fromStatus: string | null
  toStatus: string | null
  fromHumanStatus: string | null
  toHumanStatus: string | null
  createdAt: Date
}

interface ScanTaskRecord {
  id: string
  status: string
  engineMode: string
  progress: number
  totalFiles: number
  scannedFiles: number
  fallbackUsed: boolean
  fallbackFrom: string | null
  fallbackTo: string | null
  fallbackReason: string | null
  errorMessage: string | null
  errorCode: string | null
  createdAt: Date
  updatedAt: Date
}

interface AdviceSnapshotRecord {
  id: string
  summary: string
  confidence: number
  triggerScore: number
  triggerReason: string
  sourceEvent: string
  metricsFingerprint: string
  actionItems: string
  rawResponse: string | null
  createdAt: Date
  updatedAt: Date
}

interface AdviceDecisionRecord {
  id: string
  sourceEvent: string
  sourceTaskId: string | null
  sourceVulnerabilityId: string | null
  triggerScore: number
  triggerReason: string
  metricsFingerprint: string
  shouldCallAi: boolean
  calledAi: boolean
  blockedReason: string | null
  llmError: string | null
  metricSnapshot: string
  adviceSnapshotId: string | null
  createdAt: Date
}

interface MetaRecord {
  schemaVersion: string
  createdAt: string
  lastMigrationAt: string | null
}

interface Snapshot {
  vulnerabilities: VulnerabilityRecord[]
  vulnerabilityEvents: VulnerabilityEventRecord[]
  scanTasks: ScanTaskRecord[]
  adviceSnapshots: AdviceSnapshotRecord[]
  adviceDecisions: AdviceDecisionRecord[]
  config: PluginConfig | null
  configUpdatedAt: Date | null
  meta: MetaRecord
}

interface PersistedSnapshot {
  vulnerabilities: Array<Omit<VulnerabilityRecord, 'createdAt' | 'updatedAt' | 'humanReviewedAt'> & {
    createdAt: string
    updatedAt: string
    humanReviewedAt: string | null
  }>
  vulnerabilityEvents: Array<Omit<VulnerabilityEventRecord, 'createdAt'> & { createdAt: string }>
  scanTasks: Array<Omit<ScanTaskRecord, 'createdAt' | 'updatedAt'> & { createdAt: string; updatedAt: string }>
  adviceSnapshots: Array<Omit<AdviceSnapshotRecord, 'createdAt' | 'updatedAt'> & {
    createdAt: string
    updatedAt: string
  }>
  adviceDecisions: Array<Omit<AdviceDecisionRecord, 'createdAt'> & { createdAt: string }>
  config: PluginConfig | null
  configUpdatedAt: string | null
  meta: MetaRecord
}

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

type AnyRecord = Record<string, any>

const bootstrapPromises = new Map<string, Promise<void>>()

function resolveProjectRoot(): string {
  const fromEnv = process.env.CONFESSION_PROJECT_ROOT?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.resolve(process.cwd())
}

function getConfessionDir(projectRoot: string): string {
  return path.join(projectRoot, CONFESSION_DIR_NAME)
}

function getStoragePath(projectRoot: string, key: keyof typeof STORAGE_FILES): string {
  return path.join(getConfessionDir(projectRoot), STORAGE_FILES[key])
}

function now(): Date {
  return new Date()
}

function toDate(value: unknown, fallback = new Date(0)): Date {
  if (value instanceof Date) return new Date(value.getTime())
  if (typeof value === 'string') {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return new Date(fallback.getTime())
}

function cloneValue<T>(value: T): T {
  if (value instanceof Date) {
    return new Date(value.getTime()) as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T
  }

  if (value && typeof value === 'object') {
    const output: AnyRecord = {}
    for (const [key, item] of Object.entries(value as AnyRecord)) {
      output[key] = cloneValue(item)
    }
    return output as T
  }

  return value
}

function generateId(): string {
  return randomUUID().replace(/-/g, '')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function defaultMeta(): MetaRecord {
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now().toISOString(),
    lastMigrationAt: null,
  }
}

function defaultSnapshot(): Snapshot {
  return {
    vulnerabilities: [],
    vulnerabilityEvents: [],
    scanTasks: [],
    adviceSnapshots: [],
    adviceDecisions: [],
    config: cloneValue(DEFAULT_CONFIG),
    configUpdatedAt: now(),
    meta: defaultMeta(),
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const payload = `${JSON.stringify(data, null, 2)}\n`
  await fs.writeFile(tempPath, payload, 'utf8')
  await fs.rename(tempPath, filePath)
}

function serializeSnapshot(snapshot: Snapshot): PersistedSnapshot {
  return {
    vulnerabilities: snapshot.vulnerabilities.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      humanReviewedAt: item.humanReviewedAt ? item.humanReviewedAt.toISOString() : null,
    })),
    vulnerabilityEvents: snapshot.vulnerabilityEvents.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
    })),
    scanTasks: snapshot.scanTasks.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    adviceSnapshots: snapshot.adviceSnapshots.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    })),
    adviceDecisions: snapshot.adviceDecisions.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
    })),
    config: snapshot.config,
    configUpdatedAt: snapshot.configUpdatedAt ? snapshot.configUpdatedAt.toISOString() : null,
    meta: snapshot.meta,
  }
}

function decodeSnapshot(raw: Partial<PersistedSnapshot>): Snapshot {
  return {
    vulnerabilities: Array.isArray(raw.vulnerabilities)
      ? raw.vulnerabilities.map((item) => ({
          ...item,
          cweId: item.cweId ?? null,
          riskDescription: item.riskDescription ?? null,
          fixOldCode: item.fixOldCode ?? null,
          fixNewCode: item.fixNewCode ?? null,
          fixExplanation: item.fixExplanation ?? null,
          aiModel: item.aiModel ?? null,
          aiConfidence: typeof item.aiConfidence === 'number' ? item.aiConfidence : null,
          aiReasoning: item.aiReasoning ?? null,
          humanStatus: item.humanStatus ?? 'pending',
          humanComment: item.humanComment ?? null,
          humanReviewedAt: item.humanReviewedAt ? toDate(item.humanReviewedAt, now()) : null,
          owaspCategory: item.owaspCategory ?? null,
          status: item.status ?? 'open',
          createdAt: toDate(item.createdAt, now()),
          updatedAt: toDate(item.updatedAt, now()),
        }))
      : [],
    vulnerabilityEvents: Array.isArray(raw.vulnerabilityEvents)
      ? raw.vulnerabilityEvents.map((item) => ({
          ...item,
          fromStatus: item.fromStatus ?? null,
          toStatus: item.toStatus ?? null,
          fromHumanStatus: item.fromHumanStatus ?? null,
          toHumanStatus: item.toHumanStatus ?? null,
          createdAt: toDate(item.createdAt, now()),
        }))
      : [],
    scanTasks: Array.isArray(raw.scanTasks)
      ? raw.scanTasks.map((item) => ({
          ...item,
          status: item.status ?? 'pending',
          engineMode: item.engineMode ?? 'agentic_beta',
          progress: typeof item.progress === 'number' ? item.progress : 0,
          totalFiles: typeof item.totalFiles === 'number' ? item.totalFiles : 0,
          scannedFiles: typeof item.scannedFiles === 'number' ? item.scannedFiles : 0,
          fallbackUsed: Boolean(item.fallbackUsed),
          fallbackFrom: item.fallbackFrom ?? null,
          fallbackTo: item.fallbackTo ?? null,
          fallbackReason: item.fallbackReason ?? null,
          errorMessage: item.errorMessage ?? null,
          errorCode: item.errorCode ?? null,
          createdAt: toDate(item.createdAt, now()),
          updatedAt: toDate(item.updatedAt, now()),
        }))
      : [],
    adviceSnapshots: Array.isArray(raw.adviceSnapshots)
      ? raw.adviceSnapshots.map((item) => ({
          ...item,
          rawResponse: item.rawResponse ?? null,
          createdAt: toDate(item.createdAt, now()),
          updatedAt: toDate(item.updatedAt, now()),
        }))
      : [],
    adviceDecisions: Array.isArray(raw.adviceDecisions)
      ? raw.adviceDecisions.map((item) => ({
          ...item,
          sourceTaskId: item.sourceTaskId ?? null,
          sourceVulnerabilityId: item.sourceVulnerabilityId ?? null,
          shouldCallAi: Boolean(item.shouldCallAi),
          calledAi: Boolean(item.calledAi),
          blockedReason: item.blockedReason ?? null,
          llmError: item.llmError ?? null,
          adviceSnapshotId: item.adviceSnapshotId ?? null,
          createdAt: toDate(item.createdAt, now()),
        }))
      : [],
    config: normalizeConfigValue(raw.config),
    configUpdatedAt: raw.configUpdatedAt ? toDate(raw.configUpdatedAt, now()) : now(),
    meta: raw.meta ?? defaultMeta(),
  }
}

function normalizeConfigValue(raw: unknown): PluginConfig {
  if (!raw || typeof raw !== 'object') return cloneValue(DEFAULT_CONFIG)
  const input = raw as {
    llm?: {
      provider?: PluginConfig['llm']['provider']
      apiKey?: string
      endpoint?: string | null
      model?: string | null
    }
    analysis?: {
      triggerMode?: PluginConfig['analysis']['triggerMode']
      depth?: PluginConfig['analysis']['depth']
      debounceMs?: number
    }
    ignore?: {
      paths?: string[]
      types?: string[]
    }
    api?: {
      baseUrl?: string
      mode?: PluginConfig['api']['mode']
    }
  }

  const config: PluginConfig = {
    llm: {
      provider: input.llm?.provider === 'gemini' ? 'gemini' : 'nvidia',
      apiKey: typeof input.llm?.apiKey === 'string' ? input.llm.apiKey : '',
    },
    analysis: {
      triggerMode: input.analysis?.triggerMode === 'manual' ? 'manual' : 'onSave',
      depth:
        input.analysis?.depth === 'quick' || input.analysis?.depth === 'deep'
          ? input.analysis.depth
          : 'standard',
      debounceMs:
        typeof input.analysis?.debounceMs === 'number' ? Math.max(0, Math.floor(input.analysis.debounceMs)) : 500,
    },
    ignore: {
      paths: Array.isArray(input.ignore?.paths) ? input.ignore.paths : [],
      types: Array.isArray(input.ignore?.types) ? input.ignore.types : [],
    },
    api: {
      baseUrl: typeof input.api?.baseUrl === 'string' ? input.api.baseUrl : 'http://localhost:3000',
      mode: input.api?.mode === 'remote' ? 'remote' : 'local',
    },
  }

  if (typeof input.llm?.endpoint === 'string' && input.llm.endpoint.trim()) {
    config.llm.endpoint = input.llm.endpoint.trim()
  }
  if (typeof input.llm?.model === 'string' && input.llm.model.trim()) {
    config.llm.model = input.llm.model.trim()
  }

  return config
}

function extractConfigData(raw: unknown): PluginConfig {
  if (!raw || typeof raw !== 'object') return cloneValue(DEFAULT_CONFIG)
  const candidate = raw as { data?: unknown }
  if (typeof candidate.data === 'string') {
    try {
      return normalizeConfigValue(JSON.parse(candidate.data))
    } catch {
      return cloneValue(DEFAULT_CONFIG)
    }
  }
  return normalizeConfigValue(raw)
}

async function loadSnapshot(projectRoot: string): Promise<Snapshot> {
  const confessionDir = getConfessionDir(projectRoot)
  const metaPath = getStoragePath(projectRoot, 'meta')
  const rawMeta = await readJsonFile<MetaRecord | null>(metaPath, null)

  const fileExists = await exists(confessionDir)
  if (!fileExists || !rawMeta) {
    return defaultSnapshot()
  }

  const [
    vulnerabilities,
    vulnerabilityEvents,
    scanTasks,
    adviceSnapshots,
    adviceDecisions,
    rawConfig,
    rawConfigStat,
  ] = await Promise.all([
    readJsonFile<PersistedSnapshot['vulnerabilities']>(getStoragePath(projectRoot, 'vulnerabilities'), []),
    readJsonFile<PersistedSnapshot['vulnerabilityEvents']>(getStoragePath(projectRoot, 'vulnerabilityEvents'), []),
    readJsonFile<PersistedSnapshot['scanTasks']>(getStoragePath(projectRoot, 'scanTasks'), []),
    readJsonFile<PersistedSnapshot['adviceSnapshots']>(getStoragePath(projectRoot, 'adviceSnapshots'), []),
    readJsonFile<PersistedSnapshot['adviceDecisions']>(getStoragePath(projectRoot, 'adviceDecisions'), []),
    readJsonFile<PluginConfig | null>(getStoragePath(projectRoot, 'config'), null),
    fs.stat(getStoragePath(projectRoot, 'config')).catch(() => null),
  ])

  return decodeSnapshot({
    vulnerabilities,
    vulnerabilityEvents,
    scanTasks,
    adviceSnapshots,
    adviceDecisions,
    config: rawConfig,
    configUpdatedAt: rawConfigStat ? rawConfigStat.mtime.toISOString() : null,
    meta: rawMeta,
  })
}

async function saveSnapshot(projectRoot: string, snapshot: Snapshot): Promise<void> {
  const confessionDir = getConfessionDir(projectRoot)
  await fs.mkdir(confessionDir, { recursive: true })

  const persisted = serializeSnapshot(snapshot)
  await Promise.all([
    writeJsonAtomic(getStoragePath(projectRoot, 'vulnerabilities'), persisted.vulnerabilities),
    writeJsonAtomic(getStoragePath(projectRoot, 'vulnerabilityEvents'), persisted.vulnerabilityEvents),
    writeJsonAtomic(getStoragePath(projectRoot, 'scanTasks'), persisted.scanTasks),
    writeJsonAtomic(getStoragePath(projectRoot, 'adviceSnapshots'), persisted.adviceSnapshots),
    writeJsonAtomic(getStoragePath(projectRoot, 'adviceDecisions'), persisted.adviceDecisions),
    writeJsonAtomic(getStoragePath(projectRoot, 'meta'), persisted.meta),
  ])

  await writeJsonAtomic(
    getStoragePath(projectRoot, 'config'),
    normalizeConfigValue(persisted.config),
  )
}

async function withFileLock<T>(projectRoot: string, callback: () => Promise<T>): Promise<T> {
  const confessionDir = getConfessionDir(projectRoot)
  await fs.mkdir(confessionDir, { recursive: true })
  const lockPath = path.join(confessionDir, LOCK_FILE_NAME)

  const deadline = Date.now() + LOCK_TIMEOUT_MS
  while (true) {
    try {
      const handle = await fs.open(lockPath, 'wx')
      try {
        return await callback()
      } finally {
        await handle.close().catch(() => undefined)
        await fs.unlink(lockPath).catch(() => undefined)
      }
    } catch (error) {
      const maybeCode = (error as { code?: unknown }).code
      if (maybeCode !== 'EEXIST') {
        throw error
      }
      if (Date.now() >= deadline) {
        throw new Error('Confession storage lock timeout')
      }
      await sleep(LOCK_RETRY_MS)
    }
  }
}

function compareValues(left: unknown, right: unknown): number {
  const normalize = (value: unknown): number | string => {
    if (value instanceof Date) return value.getTime()
    if (typeof value === 'number') return value
    if (typeof value === 'string') return value
    if (typeof value === 'boolean') return value ? 1 : 0
    return String(value ?? '')
  }

  const a = normalize(left)
  const b = normalize(right)

  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }
  return String(a).localeCompare(String(b))
}

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (condition && typeof condition === 'object' && !Array.isArray(condition) && !(condition instanceof Date)) {
    const cond = condition as Record<string, unknown>

    if ('contains' in cond) {
      return String(value ?? '').includes(String(cond.contains ?? ''))
    }
    if ('startsWith' in cond) {
      return String(value ?? '').startsWith(String(cond.startsWith ?? ''))
    }
    if ('in' in cond) {
      const list = Array.isArray(cond.in) ? cond.in : []
      return list.some((item) => compareValues(value, item) === 0)
    }

    let ok = true
    if ('gte' in cond) ok = ok && compareValues(value, cond.gte) >= 0
    if ('gt' in cond) ok = ok && compareValues(value, cond.gt) > 0
    if ('lte' in cond) ok = ok && compareValues(value, cond.lte) <= 0
    if ('lt' in cond) ok = ok && compareValues(value, cond.lt) < 0

    if ('equals' in cond) ok = ok && compareValues(value, cond.equals) === 0
    return ok
  }

  if (value === condition) return true
  return compareValues(value, condition) === 0
}

function matchesWhere<T extends AnyRecord>(row: T, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true
  const condition = where as Record<string, unknown>

  if (Array.isArray(condition.OR)) {
    const anyMatch = condition.OR.some((item) => matchesWhere(row, item))
    if (!anyMatch) return false
  }

  for (const [key, value] of Object.entries(condition)) {
    if (key === 'OR') continue
    if (!matchesCondition(row[key], value)) return false
  }

  return true
}

function applyWhere<T extends AnyRecord>(rows: T[], where: unknown): T[] {
  return rows.filter((row) => matchesWhere(row, where))
}

function normalizeOrderBy(orderBy: unknown): Array<Record<string, 'asc' | 'desc'>> {
  if (!orderBy) return []
  if (Array.isArray(orderBy)) {
    return orderBy.filter((item): item is Record<string, 'asc' | 'desc'> => Boolean(item && typeof item === 'object'))
  }
  if (typeof orderBy === 'object') {
    return [orderBy as Record<string, 'asc' | 'desc'>]
  }
  return []
}

function applyOrderBy<T extends AnyRecord>(rows: T[], orderBy: unknown): T[] {
  const specs = normalizeOrderBy(orderBy)
  if (specs.length === 0) return rows

  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const [field, direction] = Object.entries(spec)[0] ?? []
      if (!field) continue
      const compared = compareValues(a[field], b[field])
      if (compared !== 0) {
        return direction === 'asc' ? compared : -compared
      }
    }
    return 0
  })
}

function applySelect<T extends AnyRecord>(row: T, select: unknown): AnyRecord {
  if (!select || typeof select !== 'object') {
    return cloneValue(row)
  }

  const picked: AnyRecord = {}
  for (const [field, enabled] of Object.entries(select)) {
    if (enabled === true) {
      picked[field] = cloneValue(row[field])
    }
  }
  return picked
}

function applyTakeSkip<T>(rows: T[], args: AnyRecord): T[] {
  const skip = typeof args.skip === 'number' ? Math.max(0, Math.floor(args.skip)) : 0
  const take = typeof args.take === 'number' ? Math.max(0, Math.floor(args.take)) : undefined
  const sliced = rows.slice(skip)
  if (typeof take === 'number') {
    return sliced.slice(0, take)
  }
  return sliced
}

function normalizeVulnerabilityCreate(data: AnyRecord): VulnerabilityRecord {
  const createdAt = now()
  return {
    id: typeof data.id === 'string' ? data.id : generateId(),
    filePath: String(data.filePath ?? ''),
    line: Number(data.line ?? 0),
    column: Number(data.column ?? 0),
    endLine: Number(data.endLine ?? Number(data.line ?? 0)),
    endColumn: Number(data.endColumn ?? Number(data.column ?? 0)),
    codeSnippet: String(data.codeSnippet ?? ''),
    codeHash: String(data.codeHash ?? ''),
    type: String(data.type ?? ''),
    cweId: typeof data.cweId === 'string' ? data.cweId : null,
    severity: String(data.severity ?? 'medium'),
    description: String(data.description ?? ''),
    riskDescription: typeof data.riskDescription === 'string' ? data.riskDescription : null,
    fixOldCode: typeof data.fixOldCode === 'string' ? data.fixOldCode : null,
    fixNewCode: typeof data.fixNewCode === 'string' ? data.fixNewCode : null,
    fixExplanation: typeof data.fixExplanation === 'string' ? data.fixExplanation : null,
    aiModel: typeof data.aiModel === 'string' ? data.aiModel : null,
    aiConfidence: typeof data.aiConfidence === 'number' ? data.aiConfidence : null,
    aiReasoning: typeof data.aiReasoning === 'string' ? data.aiReasoning : null,
    humanStatus: typeof data.humanStatus === 'string' ? data.humanStatus : 'pending',
    humanComment: typeof data.humanComment === 'string' ? data.humanComment : null,
    humanReviewedAt:
      data.humanReviewedAt instanceof Date
        ? new Date(data.humanReviewedAt.getTime())
        : typeof data.humanReviewedAt === 'string' && data.humanReviewedAt
          ? toDate(data.humanReviewedAt, createdAt)
          : null,
    owaspCategory: typeof data.owaspCategory === 'string' ? data.owaspCategory : null,
    status: typeof data.status === 'string' ? data.status : 'open',
    createdAt,
    updatedAt: createdAt,
  }
}

function normalizeVulnerabilityEventCreate(data: AnyRecord): VulnerabilityEventRecord {
  return {
    id: typeof data.id === 'string' ? data.id : generateId(),
    vulnerabilityId: String(data.vulnerabilityId ?? ''),
    eventType: String(data.eventType ?? ''),
    message: String(data.message ?? ''),
    fromStatus: typeof data.fromStatus === 'string' ? data.fromStatus : null,
    toStatus: typeof data.toStatus === 'string' ? data.toStatus : null,
    fromHumanStatus: typeof data.fromHumanStatus === 'string' ? data.fromHumanStatus : null,
    toHumanStatus: typeof data.toHumanStatus === 'string' ? data.toHumanStatus : null,
    createdAt: now(),
  }
}

function normalizeScanTaskCreate(data: AnyRecord): ScanTaskRecord {
  const createdAt = now()
  return {
    id: typeof data.id === 'string' ? data.id : generateId(),
    status: typeof data.status === 'string' ? data.status : 'pending',
    engineMode: typeof data.engineMode === 'string' ? data.engineMode : 'agentic_beta',
    progress: typeof data.progress === 'number' ? data.progress : 0,
    totalFiles: typeof data.totalFiles === 'number' ? data.totalFiles : 0,
    scannedFiles: typeof data.scannedFiles === 'number' ? data.scannedFiles : 0,
    fallbackUsed: Boolean(data.fallbackUsed),
    fallbackFrom: typeof data.fallbackFrom === 'string' ? data.fallbackFrom : null,
    fallbackTo: typeof data.fallbackTo === 'string' ? data.fallbackTo : null,
    fallbackReason: typeof data.fallbackReason === 'string' ? data.fallbackReason : null,
    errorMessage: typeof data.errorMessage === 'string' ? data.errorMessage : null,
    errorCode: typeof data.errorCode === 'string' ? data.errorCode : null,
    createdAt,
    updatedAt: createdAt,
  }
}

function normalizeAdviceSnapshotCreate(data: AnyRecord): AdviceSnapshotRecord {
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

function normalizeAdviceDecisionCreate(data: AnyRecord): AdviceDecisionRecord {
  return {
    id: typeof data.id === 'string' ? data.id : generateId(),
    sourceEvent: String(data.sourceEvent ?? ''),
    sourceTaskId: typeof data.sourceTaskId === 'string' ? data.sourceTaskId : null,
    sourceVulnerabilityId:
      typeof data.sourceVulnerabilityId === 'string' ? data.sourceVulnerabilityId : null,
    triggerScore: typeof data.triggerScore === 'number' ? data.triggerScore : 0,
    triggerReason: String(data.triggerReason ?? ''),
    metricsFingerprint: String(data.metricsFingerprint ?? ''),
    shouldCallAi: Boolean(data.shouldCallAi),
    calledAi: Boolean(data.calledAi),
    blockedReason: typeof data.blockedReason === 'string' ? data.blockedReason : null,
    llmError: typeof data.llmError === 'string' ? data.llmError : null,
    metricSnapshot: String(data.metricSnapshot ?? '{}'),
    adviceSnapshotId: typeof data.adviceSnapshotId === 'string' ? data.adviceSnapshotId : null,
    createdAt: now(),
  }
}

function applyPatch<T extends AnyRecord>(target: T, patch: AnyRecord): T {
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'events') continue
    ;(target as AnyRecord)[key] = value
  }
  return target
}

function findUniqueByWhere<T extends AnyRecord>(rows: T[], where: unknown): T | null {
  if (!where || typeof where !== 'object') return null
  const query = where as AnyRecord

  if (typeof query.id === 'string') {
    return rows.find((item) => String(item.id) === query.id) ?? null
  }

  if (query.vuln_idempotent && typeof query.vuln_idempotent === 'object') {
    const idempotent = query.vuln_idempotent as AnyRecord
    return (
      rows.find(
        (item) =>
          item.filePath === idempotent.filePath &&
          item.line === idempotent.line &&
          item.column === idempotent.column &&
          item.codeHash === idempotent.codeHash &&
          item.type === idempotent.type,
      ) ?? null
    )
  }

  return rows.find((item) => matchesWhere(item, where)) ?? null
}

function buildScopedClient(snapshot: Snapshot) {
  return {
    vulnerability: {
      findMany: async (args: AnyRecord = {}) => {
        const where = args.where
        const selected = args.select
        const ordered = applyOrderBy(applyWhere(snapshot.vulnerabilities, where), args.orderBy)
        const limited = applyTakeSkip(ordered, args)
        return limited.map((item) => applySelect(item, selected))
      },
      findUnique: async (args: AnyRecord) => {
        const found = findUniqueByWhere(snapshot.vulnerabilities, args?.where)
        if (!found) return null
        return applySelect(found, args?.select)
      },
      findFirst: async (args: AnyRecord = {}) => {
        const rows = await (buildScopedClient(snapshot).vulnerability.findMany(args) as Promise<AnyRecord[]>)
        return rows[0] ?? null
      },
      count: async (args: AnyRecord = {}) => {
        const rows = applyWhere(snapshot.vulnerabilities, args.where)
        return rows.length
      },
      create: async (args: AnyRecord) => {
        const record = normalizeVulnerabilityCreate(args.data ?? {})
        snapshot.vulnerabilities.push(record)
        return applySelect(record, args.select)
      },
      upsert: async (args: AnyRecord) => {
        const where = args.where
        let record = findUniqueByWhere(snapshot.vulnerabilities, where) as VulnerabilityRecord | null

        if (!record) {
          const createData = { ...(args.create ?? {}) } as AnyRecord
          const events = createData.events as AnyRecord | undefined
          delete createData.events
          record = normalizeVulnerabilityCreate(createData)
          snapshot.vulnerabilities.push(record)

          const createEvent = events?.create
          if (createEvent && typeof createEvent === 'object') {
            snapshot.vulnerabilityEvents.push(
              normalizeVulnerabilityEventCreate({
                ...createEvent,
                vulnerabilityId: record.id,
              }),
            )
          }
        } else {
          applyPatch(record, (args.update ?? {}) as AnyRecord)
          record.updatedAt = now()
        }

        return applySelect(record, args.select)
      },
      update: async (args: AnyRecord) => {
        const found = findUniqueByWhere(snapshot.vulnerabilities, args.where) as VulnerabilityRecord | null
        if (!found) {
          throw new Error('Record to update not found')
        }
        applyPatch(found, (args.data ?? {}) as AnyRecord)
        found.updatedAt = now()
        return applySelect(found, args.select)
      },
      updateMany: async (args: AnyRecord = {}) => {
        const matched = applyWhere(snapshot.vulnerabilities, args.where)
        for (const row of matched) {
          applyPatch(row, (args.data ?? {}) as AnyRecord)
          row.updatedAt = now()
        }
        return { count: matched.length }
      },
      deleteMany: async (args: AnyRecord = {}) => {
        if (!args.where) {
          const count = snapshot.vulnerabilities.length
          snapshot.vulnerabilities = []
          return { count }
        }
        const before = snapshot.vulnerabilities.length
        snapshot.vulnerabilities = snapshot.vulnerabilities.filter((item) => !matchesWhere(item, args.where))
        return { count: before - snapshot.vulnerabilities.length }
      },
    },
    vulnerabilityEvent: {
      findMany: async (args: AnyRecord = {}) => {
        const where = args.where
        const selected = args.select
        const ordered = applyOrderBy(applyWhere(snapshot.vulnerabilityEvents, where), args.orderBy)
        const limited = applyTakeSkip(ordered, args)
        return limited.map((item) => applySelect(item, selected))
      },
      createMany: async (args: AnyRecord = {}) => {
        const rows = Array.isArray(args.data) ? args.data : []
        for (const item of rows) {
          snapshot.vulnerabilityEvents.push(normalizeVulnerabilityEventCreate(item))
        }
        return { count: rows.length }
      },
      deleteMany: async (args: AnyRecord = {}) => {
        if (!args.where) {
          const count = snapshot.vulnerabilityEvents.length
          snapshot.vulnerabilityEvents = []
          return { count }
        }
        const before = snapshot.vulnerabilityEvents.length
        snapshot.vulnerabilityEvents = snapshot.vulnerabilityEvents.filter(
          (item) => !matchesWhere(item, args.where),
        )
        return { count: before - snapshot.vulnerabilityEvents.length }
      },
      count: async (args: AnyRecord = {}) => applyWhere(snapshot.vulnerabilityEvents, args.where).length,
    },
    scanTask: {
      findMany: async (args: AnyRecord = {}) => {
        const where = args.where
        const selected = args.select
        const ordered = applyOrderBy(applyWhere(snapshot.scanTasks, where), args.orderBy)
        const limited = applyTakeSkip(ordered, args)
        return limited.map((item) => applySelect(item, selected))
      },
      findFirst: async (args: AnyRecord = {}) => {
        const rows = await (buildScopedClient(snapshot).scanTask.findMany(args) as Promise<AnyRecord[]>)
        return rows[0] ?? null
      },
      findUnique: async (args: AnyRecord) => {
        const found = findUniqueByWhere(snapshot.scanTasks, args?.where)
        if (!found) return null
        return applySelect(found, args?.select)
      },
      create: async (args: AnyRecord) => {
        const record = normalizeScanTaskCreate(args.data ?? {})
        snapshot.scanTasks.push(record)
        return applySelect(record, args.select)
      },
      update: async (args: AnyRecord) => {
        const found = findUniqueByWhere(snapshot.scanTasks, args.where) as ScanTaskRecord | null
        if (!found) throw new Error('Record to update not found')
        applyPatch(found, (args.data ?? {}) as AnyRecord)
        found.updatedAt = now()
        return applySelect(found, args.select)
      },
      updateMany: async (args: AnyRecord = {}) => {
        const matched = applyWhere(snapshot.scanTasks, args.where)
        for (const row of matched) {
          applyPatch(row, (args.data ?? {}) as AnyRecord)
          row.updatedAt = now()
        }
        return { count: matched.length }
      },
      count: async (args: AnyRecord = {}) => applyWhere(snapshot.scanTasks, args.where).length,
    },
    adviceSnapshot: {
      findFirst: async (args: AnyRecord = {}) => {
        const rows = applyOrderBy(applyWhere(snapshot.adviceSnapshots, args.where), args.orderBy)
        const first = rows[0]
        if (!first) return null
        return applySelect(first, args.select)
      },
      create: async (args: AnyRecord) => {
        const record = normalizeAdviceSnapshotCreate(args.data ?? {})
        snapshot.adviceSnapshots.push(record)
        return applySelect(record, args.select)
      },
    },
    adviceDecision: {
      findFirst: async (args: AnyRecord = {}) => {
        const rows = applyOrderBy(applyWhere(snapshot.adviceDecisions, args.where), args.orderBy)
        const first = rows[0]
        if (!first) return null
        return applySelect(first, args.select)
      },
      count: async (args: AnyRecord = {}) => applyWhere(snapshot.adviceDecisions, args.where).length,
      create: async (args: AnyRecord) => {
        const record = normalizeAdviceDecisionCreate(args.data ?? {})
        snapshot.adviceDecisions.push(record)
        return applySelect(record, args.select)
      },
      update: async (args: AnyRecord) => {
        const found = findUniqueByWhere(snapshot.adviceDecisions, args.where) as AdviceDecisionRecord | null
        if (!found) throw new Error('Record to update not found')
        applyPatch(found, (args.data ?? {}) as AnyRecord)
        return applySelect(found, args.select)
      },
    },
    config: {
      findUnique: async (args: AnyRecord) => {
        if (!snapshot.config) return null
        const requestedId = (args?.where as AnyRecord | undefined)?.id
        if (requestedId && requestedId !== 'default') return null
        return {
          id: 'default',
          data: JSON.stringify(snapshot.config),
          updatedAt: snapshot.configUpdatedAt ?? now(),
        }
      },
      upsert: async (args: AnyRecord) => {
        const payload = args.update?.data ?? args.create?.data
        const parsed =
          typeof payload === 'string' ? extractConfigData({ data: payload }) : normalizeConfigValue(payload)
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

async function withReadClient<T>(callback: (client: ReturnType<typeof buildScopedClient>) => Promise<T>): Promise<T> {
  const projectRoot = resolveProjectRoot()
  await ensureBootstrapped(projectRoot)
  const snapshot = await loadSnapshot(projectRoot)
  return callback(buildScopedClient(snapshot))
}

async function withWriteClient<T>(callback: (client: ReturnType<typeof buildScopedClient>) => Promise<T>): Promise<T> {
  const projectRoot = resolveProjectRoot()
  await ensureBootstrapped(projectRoot)
  return withFileLock(projectRoot, async () => {
    const snapshot = await loadSnapshot(projectRoot)
    const client = buildScopedClient(snapshot)
    const result = await callback(client)
    await saveSnapshot(projectRoot, snapshot)
    return result
  })
}

async function resolveLegacyDbPath(projectRoot: string): Promise<string | null> {
  const candidates = [
    path.resolve(projectRoot, 'dev.db'),
    path.resolve(projectRoot, 'web', 'dev.db'),
  ]

  const deduped = Array.from(new Set(candidates))
  for (const item of deduped) {
    if (await exists(item)) return item
  }
  return null
}

async function bootstrapProject(projectRoot: string): Promise<void> {
  const metaPath = getStoragePath(projectRoot, 'meta')
  if (await exists(metaPath)) return

  const legacyDbPath = await resolveLegacyDbPath(projectRoot)
  if (!legacyDbPath) return

  try {
    const module = await import('better-sqlite3')
    const BetterSqlite3 = module.default
    const sqlite = new BetterSqlite3(legacyDbPath, { readonly: true })

    const hasTable = (name: string): boolean =>
      Boolean(
        sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
          .get(name),
      )

    const fetchRows = (tableName: string) =>
      hasTable(tableName) ? sqlite.prepare(`SELECT * FROM ${tableName}`).all() : []

    const rawVulns = fetchRows('vulnerabilities') as AnyRecord[]
    const rawEvents = fetchRows('vulnerability_events') as AnyRecord[]
    const rawTasks = fetchRows('scan_tasks') as AnyRecord[]
    const rawSnapshots = fetchRows('advice_snapshots') as AnyRecord[]
    const rawDecisions = fetchRows('advice_decisions') as AnyRecord[]
    const rawConfigs = fetchRows('configs') as AnyRecord[]

    sqlite.close()

    const migrated: Snapshot = {
      vulnerabilities: rawVulns.map((item) => ({
        ...normalizeVulnerabilityCreate(item),
        id: typeof item.id === 'string' ? item.id : generateId(),
        codeHash: typeof item.codeHash === 'string' ? item.codeHash : '',
        createdAt: toDate(item.createdAt, now()),
        updatedAt: toDate(item.updatedAt, now()),
      })),
      vulnerabilityEvents: rawEvents.map((item) => ({
        ...normalizeVulnerabilityEventCreate(item),
        id: typeof item.id === 'string' ? item.id : generateId(),
        createdAt: toDate(item.createdAt, now()),
      })),
      scanTasks: rawTasks.map((item) => ({
        ...normalizeScanTaskCreate(item),
        id: typeof item.id === 'string' ? item.id : generateId(),
        createdAt: toDate(item.createdAt, now()),
        updatedAt: toDate(item.updatedAt, now()),
      })),
      adviceSnapshots: rawSnapshots.map((item) => ({
        ...normalizeAdviceSnapshotCreate(item),
        id: typeof item.id === 'string' ? item.id : generateId(),
        createdAt: toDate(item.createdAt, now()),
        updatedAt: toDate(item.updatedAt, now()),
      })),
      adviceDecisions: rawDecisions.map((item) => ({
        ...normalizeAdviceDecisionCreate(item),
        id: typeof item.id === 'string' ? item.id : generateId(),
        createdAt: toDate(item.createdAt, now()),
      })),
      config: null,
      configUpdatedAt: null,
      meta: {
        schemaVersion: SCHEMA_VERSION,
        createdAt: now().toISOString(),
        lastMigrationAt: now().toISOString(),
      },
    }

    const defaultConfigRow = rawConfigs.find((item) => item.id === 'default')
    if (defaultConfigRow && typeof defaultConfigRow.data === 'string') {
      migrated.config = extractConfigData({ data: defaultConfigRow.data })
      migrated.configUpdatedAt = toDate(defaultConfigRow.updatedAt, now())
    } else {
      migrated.config = cloneValue(DEFAULT_CONFIG)
      migrated.configUpdatedAt = now()
    }

    await saveSnapshot(projectRoot, migrated)

    await Promise.all([
      fs.unlink(legacyDbPath).catch(() => undefined),
      fs.unlink(`${legacyDbPath}-journal`).catch(() => undefined),
      fs.unlink(`${legacyDbPath}-wal`).catch(() => undefined),
      fs.unlink(`${legacyDbPath}-shm`).catch(() => undefined),
    ])

    process.stdout.write(
      `[Confession][StorageMigration] ${JSON.stringify({
        from: legacyDbPath,
        to: getConfessionDir(projectRoot),
        vulnerabilities: migrated.vulnerabilities.length,
        events: migrated.vulnerabilityEvents.length,
        scanTasks: migrated.scanTasks.length,
        adviceSnapshots: migrated.adviceSnapshots.length,
        adviceDecisions: migrated.adviceDecisions.length,
      })}\n`,
    )
  } catch (error) {
    process.stdout.write(
      `[Confession][StorageMigration] ${JSON.stringify({
        from: legacyDbPath,
        skipped: true,
        reason: error instanceof Error ? error.message : String(error),
      })}\n`,
    )
  }
}

async function ensureBootstrapped(projectRoot: string): Promise<void> {
  const existing = bootstrapPromises.get(projectRoot)
  if (existing) {
    await existing
    return
  }

  const promise = bootstrapProject(projectRoot)
  bootstrapPromises.set(projectRoot, promise)
  await promise
}

export const prisma = {
  vulnerability: {
    findMany: (args?: AnyRecord) => withReadClient((client) => client.vulnerability.findMany(args)),
    findUnique: (args: AnyRecord) => withReadClient((client) => client.vulnerability.findUnique(args)),
    findFirst: (args?: AnyRecord) => withReadClient((client) => client.vulnerability.findFirst(args)),
    count: (args?: AnyRecord) => withReadClient((client) => client.vulnerability.count(args)),
    create: (args: AnyRecord) => withWriteClient((client) => client.vulnerability.create(args)),
    upsert: (args: AnyRecord) => withWriteClient((client) => client.vulnerability.upsert(args)),
    update: (args: AnyRecord) => withWriteClient((client) => client.vulnerability.update(args)),
    updateMany: (args?: AnyRecord) => withWriteClient((client) => client.vulnerability.updateMany(args)),
    deleteMany: (args?: AnyRecord) => withWriteClient((client) => client.vulnerability.deleteMany(args)),
  },
  vulnerabilityEvent: {
    findMany: (args?: AnyRecord) => withReadClient((client) => client.vulnerabilityEvent.findMany(args)),
    createMany: (args?: AnyRecord) => withWriteClient((client) => client.vulnerabilityEvent.createMany(args)),
    deleteMany: (args?: AnyRecord) => withWriteClient((client) => client.vulnerabilityEvent.deleteMany(args)),
    count: (args?: AnyRecord) => withReadClient((client) => client.vulnerabilityEvent.count(args)),
  },
  scanTask: {
    findMany: (args?: AnyRecord) => withReadClient((client) => client.scanTask.findMany(args)),
    findFirst: (args?: AnyRecord) => withReadClient((client) => client.scanTask.findFirst(args)),
    findUnique: (args: AnyRecord) => withReadClient((client) => client.scanTask.findUnique(args)),
    create: (args: AnyRecord) => withWriteClient((client) => client.scanTask.create(args)),
    update: (args: AnyRecord) => withWriteClient((client) => client.scanTask.update(args)),
    updateMany: (args?: AnyRecord) => withWriteClient((client) => client.scanTask.updateMany(args)),
    count: (args?: AnyRecord) => withReadClient((client) => client.scanTask.count(args)),
  },
  adviceSnapshot: {
    findFirst: (args?: AnyRecord) => withReadClient((client) => client.adviceSnapshot.findFirst(args)),
    create: (args: AnyRecord) => withWriteClient((client) => client.adviceSnapshot.create(args)),
  },
  adviceDecision: {
    findFirst: (args?: AnyRecord) => withReadClient((client) => client.adviceDecision.findFirst(args)),
    count: (args?: AnyRecord) => withReadClient((client) => client.adviceDecision.count(args)),
    create: (args: AnyRecord) => withWriteClient((client) => client.adviceDecision.create(args)),
    update: (args: AnyRecord) => withWriteClient((client) => client.adviceDecision.update(args)),
  },
  config: {
    findUnique: (args: AnyRecord) => withReadClient((client) => client.config.findUnique(args)),
    upsert: (args: AnyRecord) => withWriteClient((client) => client.config.upsert(args)),
  },
  $transaction: async <T>(callback: (tx: ReturnType<typeof buildScopedClient>) => Promise<T>): Promise<T> => {
    const projectRoot = resolveProjectRoot()
    await ensureBootstrapped(projectRoot)

    return withFileLock(projectRoot, async () => {
      const snapshot = await loadSnapshot(projectRoot)
      const tx = buildScopedClient(snapshot)
      const result = await callback(tx)
      await saveSnapshot(projectRoot, snapshot)
      return result
    })
  },
  $disconnect: async () => undefined,
}

export async function upsertVulnerabilities(vulns: VulnerabilityInput[]) {
  const deduped = deduplicateVulnerabilities(vulns)

  for (let start = 0; start < deduped.length; start += UPSERT_CHUNK_SIZE) {
    const chunk = deduped.slice(start, start + UPSERT_CHUNK_SIZE).map((item) => ({
      vuln: item,
      codeHash: createHash('sha256').update(item.codeSnippet).digest('hex'),
    }))

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

  const scoped = candidates.filter((item: AnyRecord) => linesByFile.get(String(item.filePath))?.has(Number(item.line)) ?? false)
  if (scoped.length <= 1) return

  const deduped = deduplicateVulnerabilities(scoped as never[])
  if (deduped.length === scoped.length) return

  const keepIds = new Set(deduped.map((item: AnyRecord) => String(item.id)))
  const deleteIds = scoped.filter((item: AnyRecord) => !keepIds.has(String(item.id))).map((item: AnyRecord) => String(item.id))
  if (deleteIds.length === 0) return

  await prisma.vulnerability.deleteMany({
    where: { id: { in: deleteIds } },
  })
}

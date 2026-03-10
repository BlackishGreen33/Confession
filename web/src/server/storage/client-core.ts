import * as fs from 'node:fs/promises'
import path from 'node:path'

import {
  createBootstrapGuard,
  exists,
  getConfessionDir,
  getStoragePath,
  resolveProjectRoot,
} from './bootstrap'
import { buildScopedClient, type StorageScopedClient } from './repository'
import {
  cloneValue,
  decodeSnapshot,
  DEFAULT_CONFIG,
  defaultSnapshot,
  normalizeConfigValue,
  now,
  serializeSnapshot,
} from './snapshot-codec'
import type {
  LockTelemetry,
  MetaRecord,
  PersistedSnapshot,
  Snapshot,
  WriteTelemetry,
} from './types'

export { getConfessionDir, getStoragePath, resolveProjectRoot } from './bootstrap'
export type { StorageScopedClient } from './repository'

const LOCK_FILE_NAME = '.lock'
const LOCK_RETRY_MS = 50
const LOCK_TIMEOUT_MS = 8_000

type QueryArgs = Record<string, unknown>

interface ScanTaskSnapshotCacheEntry {
  scanTasksMtimeMs: number
  metaMtimeMs: number
  snapshot: Snapshot
}

interface VulnerabilitySnapshotCacheEntry {
  vulnerabilitiesMtimeMs: number
  vulnerabilityEventsMtimeMs: number
  metaMtimeMs: number
  snapshot: Snapshot
}

const scanTaskSnapshotCache = new Map<string, ScanTaskSnapshotCacheEntry>()
const vulnerabilitySnapshotCache = new Map<string, VulnerabilitySnapshotCacheEntry>()

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

async function readFileMtimeMs(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath)
    return stat.mtimeMs
  } catch {
    return -1
  }
}

function buildScanTaskOnlySnapshot(raw: Snapshot): Snapshot {
  return {
    vulnerabilities: [],
    vulnerabilityEvents: [],
    scanTasks: raw.scanTasks,
    adviceSnapshots: [],
    adviceDecisions: [],
    config: cloneValue(DEFAULT_CONFIG),
    configUpdatedAt: now(),
    meta: raw.meta,
  }
}

function buildVulnerabilityOnlySnapshot(raw: Snapshot): Snapshot {
  return {
    vulnerabilities: raw.vulnerabilities,
    vulnerabilityEvents: raw.vulnerabilityEvents,
    scanTasks: [],
    adviceSnapshots: [],
    adviceDecisions: [],
    config: cloneValue(DEFAULT_CONFIG),
    configUpdatedAt: now(),
    meta: raw.meta,
  }
}

export async function loadSnapshot(projectRoot: string): Promise<Snapshot> {
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
    readJsonFile<PersistedSnapshot['vulnerabilityEvents']>(
      getStoragePath(projectRoot, 'vulnerabilityEvents'),
      [],
    ),
    readJsonFile<PersistedSnapshot['scanTasks']>(getStoragePath(projectRoot, 'scanTasks'), []),
    readJsonFile<PersistedSnapshot['adviceSnapshots']>(
      getStoragePath(projectRoot, 'adviceSnapshots'),
      [],
    ),
    readJsonFile<PersistedSnapshot['adviceDecisions']>(
      getStoragePath(projectRoot, 'adviceDecisions'),
      [],
    ),
    readJsonFile<unknown>(getStoragePath(projectRoot, 'config'), null),
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

export async function loadScanTaskOnlySnapshot(projectRoot: string): Promise<Snapshot> {
  const scanTasksPath = getStoragePath(projectRoot, 'scanTasks')
  const metaPath = getStoragePath(projectRoot, 'meta')
  const [scanTasksMtimeMs, metaMtimeMs] = await Promise.all([
    readFileMtimeMs(scanTasksPath),
    readFileMtimeMs(metaPath),
  ])

  const cached = scanTaskSnapshotCache.get(projectRoot)
  if (
    cached &&
    cached.scanTasksMtimeMs === scanTasksMtimeMs &&
    cached.metaMtimeMs === metaMtimeMs
  ) {
    return cloneValue(cached.snapshot)
  }

  const [rawScanTasks, rawMeta] = await Promise.all([
    readJsonFile<PersistedSnapshot['scanTasks']>(scanTasksPath, []),
    readJsonFile<MetaRecord | null>(metaPath, null),
  ])

  const decoded = decodeSnapshot({
    scanTasks: rawScanTasks,
    meta: rawMeta ?? defaultSnapshot().meta,
  })
  const snapshot = buildScanTaskOnlySnapshot(decoded)

  scanTaskSnapshotCache.set(projectRoot, {
    scanTasksMtimeMs,
    metaMtimeMs,
    snapshot: cloneValue(snapshot),
  })

  return snapshot
}

export async function loadVulnerabilityOnlySnapshot(projectRoot: string): Promise<Snapshot> {
  const vulnerabilitiesPath = getStoragePath(projectRoot, 'vulnerabilities')
  const vulnerabilityEventsPath = getStoragePath(projectRoot, 'vulnerabilityEvents')
  const metaPath = getStoragePath(projectRoot, 'meta')
  const [vulnerabilitiesMtimeMs, vulnerabilityEventsMtimeMs, metaMtimeMs] =
    await Promise.all([
      readFileMtimeMs(vulnerabilitiesPath),
      readFileMtimeMs(vulnerabilityEventsPath),
      readFileMtimeMs(metaPath),
    ])

  const cached = vulnerabilitySnapshotCache.get(projectRoot)
  if (
    cached &&
    cached.vulnerabilitiesMtimeMs === vulnerabilitiesMtimeMs &&
    cached.vulnerabilityEventsMtimeMs === vulnerabilityEventsMtimeMs &&
    cached.metaMtimeMs === metaMtimeMs
  ) {
    return cloneValue(cached.snapshot)
  }

  const [rawVulnerabilities, rawVulnerabilityEvents, rawMeta] = await Promise.all([
    readJsonFile<PersistedSnapshot['vulnerabilities']>(vulnerabilitiesPath, []),
    readJsonFile<PersistedSnapshot['vulnerabilityEvents']>(
      vulnerabilityEventsPath,
      [],
    ),
    readJsonFile<MetaRecord | null>(metaPath, null),
  ])

  const decoded = decodeSnapshot({
    vulnerabilities: rawVulnerabilities,
    vulnerabilityEvents: rawVulnerabilityEvents,
    meta: rawMeta ?? defaultSnapshot().meta,
  })
  const snapshot = buildVulnerabilityOnlySnapshot(decoded)

  vulnerabilitySnapshotCache.set(projectRoot, {
    vulnerabilitiesMtimeMs,
    vulnerabilityEventsMtimeMs,
    metaMtimeMs,
    snapshot: cloneValue(snapshot),
  })

  return snapshot
}

export async function saveScanTaskOnlySnapshot(projectRoot: string, snapshot: Snapshot): Promise<void> {
  const confessionDir = getConfessionDir(projectRoot)
  await fs.mkdir(confessionDir, { recursive: true })
  const persisted = serializeSnapshot(snapshot)

  await Promise.all([
    writeJsonAtomic(getStoragePath(projectRoot, 'scanTasks'), persisted.scanTasks),
    writeJsonAtomic(getStoragePath(projectRoot, 'meta'), persisted.meta),
  ])

  const [scanTasksMtimeMs, metaMtimeMs] = await Promise.all([
    readFileMtimeMs(getStoragePath(projectRoot, 'scanTasks')),
    readFileMtimeMs(getStoragePath(projectRoot, 'meta')),
  ])

  scanTaskSnapshotCache.set(projectRoot, {
    scanTasksMtimeMs,
    metaMtimeMs,
    snapshot: cloneValue(buildScanTaskOnlySnapshot(snapshot)),
  })
}

export async function saveVulnerabilityOnlySnapshot(
  projectRoot: string,
  snapshot: Snapshot,
  telemetry?: WriteTelemetry,
): Promise<void> {
  const confessionDir = getConfessionDir(projectRoot)
  await fs.mkdir(confessionDir, { recursive: true })
  const persisted = serializeSnapshot(snapshot)

  await Promise.all([
    writeJsonAtomic(
      getStoragePath(projectRoot, 'vulnerabilities'),
      persisted.vulnerabilities,
    ),
    writeJsonAtomic(
      getStoragePath(projectRoot, 'vulnerabilityEvents'),
      persisted.vulnerabilityEvents,
    ),
    writeJsonAtomic(getStoragePath(projectRoot, 'meta'), persisted.meta),
  ])
  if (telemetry) {
    telemetry.writeOps += 3
  }

  const [vulnerabilitiesMtimeMs, vulnerabilityEventsMtimeMs, metaMtimeMs] =
    await Promise.all([
      readFileMtimeMs(getStoragePath(projectRoot, 'vulnerabilities')),
      readFileMtimeMs(getStoragePath(projectRoot, 'vulnerabilityEvents')),
      readFileMtimeMs(getStoragePath(projectRoot, 'meta')),
    ])

  vulnerabilitySnapshotCache.set(projectRoot, {
    vulnerabilitiesMtimeMs,
    vulnerabilityEventsMtimeMs,
    metaMtimeMs,
    snapshot: cloneValue(buildVulnerabilityOnlySnapshot(snapshot)),
  })
}

export async function saveSnapshot(projectRoot: string, snapshot: Snapshot): Promise<void> {
  const confessionDir = getConfessionDir(projectRoot)
  await fs.mkdir(confessionDir, { recursive: true })

  const persisted = serializeSnapshot(snapshot)
  await Promise.all([
    writeJsonAtomic(
      getStoragePath(projectRoot, 'vulnerabilities'),
      persisted.vulnerabilities,
    ),
    writeJsonAtomic(
      getStoragePath(projectRoot, 'vulnerabilityEvents'),
      persisted.vulnerabilityEvents,
    ),
    writeJsonAtomic(getStoragePath(projectRoot, 'scanTasks'), persisted.scanTasks),
    writeJsonAtomic(
      getStoragePath(projectRoot, 'adviceSnapshots'),
      persisted.adviceSnapshots,
    ),
    writeJsonAtomic(
      getStoragePath(projectRoot, 'adviceDecisions'),
      persisted.adviceDecisions,
    ),
    writeJsonAtomic(getStoragePath(projectRoot, 'meta'), persisted.meta),
  ])

  await writeJsonAtomic(
    getStoragePath(projectRoot, 'config'),
    normalizeConfigValue(persisted.config),
  )

  scanTaskSnapshotCache.delete(projectRoot)
  vulnerabilitySnapshotCache.delete(projectRoot)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withFileLock<T>(
  projectRoot: string,
  callback: () => Promise<T>,
  telemetry?: LockTelemetry,
): Promise<T> {
  const confessionDir = getConfessionDir(projectRoot)
  await fs.mkdir(confessionDir, { recursive: true })
  const lockPath = path.join(confessionDir, LOCK_FILE_NAME)

  const waitStartedAt = Date.now()
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  while (true) {
    try {
      const handle = await fs.open(lockPath, 'wx')
      const lockAcquiredAt = Date.now()
      if (telemetry) {
        telemetry.waitMsSamples.push(Math.max(0, Date.now() - waitStartedAt))
      }
      try {
        return await callback()
      } finally {
        if (telemetry) {
          telemetry.holdMsSamples.push(Math.max(0, Date.now() - lockAcquiredAt))
        }
        await handle.close().catch(() => undefined)
        await fs.unlink(lockPath).catch(() => undefined)
      }
    } catch (error) {
      const maybeCode = (error as { code?: unknown }).code
      if (maybeCode !== 'EEXIST') {
        throw error
      }
      if (Date.now() >= deadline) {
        if (telemetry) {
          telemetry.timeoutCount += 1
        }
        throw new Error('Confession storage lock timeout')
      }
      await sleep(LOCK_RETRY_MS)
    }
  }
}

async function bootstrapProject(projectRoot: string): Promise<void> {
  const metaPath = getStoragePath(projectRoot, 'meta')
  if (await exists(metaPath)) return

  const snapshot = defaultSnapshot()
  snapshot.config = cloneValue(DEFAULT_CONFIG)
  snapshot.configUpdatedAt = now()
  await saveSnapshot(projectRoot, snapshot)
}

const ensureBootstrapped = createBootstrapGuard(bootstrapProject)

async function withReadClient<T>(
  callback: (client: StorageScopedClient) => Promise<T>,
): Promise<T> {
  const projectRoot = resolveProjectRoot()
  await ensureBootstrapped(projectRoot)
  const snapshot = await loadSnapshot(projectRoot)
  return callback(buildScopedClient(snapshot))
}

async function withScanTaskReadClient<T>(
  callback: (client: StorageScopedClient) => Promise<T>,
): Promise<T> {
  const projectRoot = resolveProjectRoot()
  await ensureBootstrapped(projectRoot)
  const snapshot = await loadScanTaskOnlySnapshot(projectRoot)
  return callback(buildScopedClient(snapshot))
}

async function withVulnerabilityReadClient<T>(
  callback: (client: StorageScopedClient) => Promise<T>,
): Promise<T> {
  const projectRoot = resolveProjectRoot()
  await ensureBootstrapped(projectRoot)
  const snapshot = await loadVulnerabilityOnlySnapshot(projectRoot)
  return callback(buildScopedClient(snapshot))
}

async function withWriteClient<T>(
  callback: (client: StorageScopedClient) => Promise<T>,
): Promise<T> {
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

async function withScanTaskWriteClient<T>(
  callback: (client: StorageScopedClient) => Promise<T>,
): Promise<T> {
  const projectRoot = resolveProjectRoot()
  await ensureBootstrapped(projectRoot)
  return withFileLock(projectRoot, async () => {
    const snapshot = await loadScanTaskOnlySnapshot(projectRoot)
    const client = buildScopedClient(snapshot)
    const result = await callback(client)
    await saveScanTaskOnlySnapshot(projectRoot, snapshot)
    return result
  })
}

export async function withVulnerabilityWriteClient<T>(
  callback: (client: StorageScopedClient) => Promise<T>,
  lockTelemetry?: LockTelemetry,
  writeTelemetry?: WriteTelemetry,
): Promise<T> {
  const projectRoot = resolveProjectRoot()
  await ensureBootstrapped(projectRoot)
  return withFileLock(
    projectRoot,
    async () => {
      const snapshot = await loadVulnerabilityOnlySnapshot(projectRoot)
      const client = buildScopedClient(snapshot)
      const result = await callback(client)
      await saveVulnerabilityOnlySnapshot(projectRoot, snapshot, writeTelemetry)
      return result
    },
    lockTelemetry,
  )
}

export const storage = {
  vulnerability: {
    findMany: (args?: QueryArgs) =>
      withVulnerabilityReadClient((client) => client.vulnerability.findMany(args)),
    findUnique: (args: QueryArgs) =>
      withVulnerabilityReadClient((client) => client.vulnerability.findUnique(args)),
    findFirst: (args?: QueryArgs) =>
      withVulnerabilityReadClient((client) => client.vulnerability.findFirst(args)),
    count: (args?: QueryArgs) =>
      withVulnerabilityReadClient((client) => client.vulnerability.count(args)),
    create: (args: QueryArgs) =>
      withVulnerabilityWriteClient((client) => client.vulnerability.create(args)),
    upsert: (args: QueryArgs) =>
      withVulnerabilityWriteClient((client) => client.vulnerability.upsert(args)),
    update: (args: QueryArgs) =>
      withVulnerabilityWriteClient((client) => client.vulnerability.update(args)),
    updateMany: (args?: QueryArgs) =>
      withVulnerabilityWriteClient((client) => client.vulnerability.updateMany(args)),
    deleteMany: (args?: QueryArgs) =>
      withVulnerabilityWriteClient((client) => client.vulnerability.deleteMany(args)),
  },
  vulnerabilityEvent: {
    findMany: (args?: QueryArgs) =>
      withVulnerabilityReadClient((client) => client.vulnerabilityEvent.findMany(args)),
    createMany: (args?: QueryArgs) =>
      withVulnerabilityWriteClient((client) => client.vulnerabilityEvent.createMany(args)),
    deleteMany: (args?: QueryArgs) =>
      withVulnerabilityWriteClient((client) => client.vulnerabilityEvent.deleteMany(args)),
    count: (args?: QueryArgs) =>
      withVulnerabilityReadClient((client) => client.vulnerabilityEvent.count(args)),
  },
  scanTask: {
    findMany: (args?: QueryArgs) =>
      withScanTaskReadClient((client) => client.scanTask.findMany(args)),
    findFirst: (args?: QueryArgs) =>
      withScanTaskReadClient((client) => client.scanTask.findFirst(args)),
    findUnique: (args: QueryArgs) =>
      withScanTaskReadClient((client) => client.scanTask.findUnique(args)),
    create: (args: QueryArgs) =>
      withScanTaskWriteClient((client) => client.scanTask.create(args)),
    update: (args: QueryArgs) =>
      withScanTaskWriteClient((client) => client.scanTask.update(args)),
    updateMany: (args?: QueryArgs) =>
      withScanTaskWriteClient((client) => client.scanTask.updateMany(args)),
    count: (args?: QueryArgs) =>
      withScanTaskReadClient((client) => client.scanTask.count(args)),
  },
  adviceSnapshot: {
    findFirst: (args?: QueryArgs) =>
      withReadClient((client) => client.adviceSnapshot.findFirst(args)),
    create: (args: QueryArgs) =>
      withWriteClient((client) => client.adviceSnapshot.create(args)),
  },
  adviceDecision: {
    findFirst: (args?: QueryArgs) =>
      withReadClient((client) => client.adviceDecision.findFirst(args)),
    count: (args?: QueryArgs) =>
      withReadClient((client) => client.adviceDecision.count(args)),
    create: (args: QueryArgs) =>
      withWriteClient((client) => client.adviceDecision.create(args)),
    update: (args: QueryArgs) =>
      withWriteClient((client) => client.adviceDecision.update(args)),
  },
  config: {
    findUnique: (args: QueryArgs) =>
      withReadClient((client) => client.config.findUnique(args)),
    upsert: (args: QueryArgs) =>
      withWriteClient((client) => client.config.upsert(args)),
  },
  $transaction: async <T>(
    callback: (tx: StorageScopedClient) => Promise<T>,
  ): Promise<T> => {
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

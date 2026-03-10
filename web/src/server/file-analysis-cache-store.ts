import { promises as fs } from 'node:fs'
import path from 'node:path'

import {
  buildFileAnalysisCacheKey,
  FILE_ANALYSIS_CACHE_TTL_MS,
  fileAnalysisCache,
} from '@server/cache'

const ANALYSIS_CACHE_FILE_NAME = 'analysis-cache.json'
const ANALYSIS_CACHE_SCHEMA_VERSION = 'analysis-cache-v1'
const ANALYSIS_ANALYZER_VERSION = 'ast-jsts-go-keywords-v1'
const ANALYSIS_PROMPT_VERSION = 'llm-prompt-v2'
const MAX_ANALYSIS_CACHE_ENTRIES = 20_000

interface PersistedAnalysisCache {
  schemaVersion: string
  analyzerVersion: string
  promptVersion: string
  updatedAt: string
  entries: Record<string, string>
}

interface HydratedState {
  projectRoot: string
  filePath: string
  profileKey: string
  mtimeMs: number
}

const persistedHashesByPath = new Map<string, string>()
let hydratedState: HydratedState | null = null

function resolveProjectRoot(): string {
  const fromEnv = process.env.CONFESSION_PROJECT_ROOT?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return process.cwd()
}

function getAnalysisCachePath(projectRoot: string): string {
  return path.join(projectRoot, '.confession', ANALYSIS_CACHE_FILE_NAME)
}

function getProfileKey(): string {
  return `${ANALYSIS_ANALYZER_VERSION}::${ANALYSIS_PROMPT_VERSION}`
}

async function readFileMtimeMs(filePath: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath)
    return stat.mtimeMs
  } catch {
    return -1
  }
}

function isValidPersistedCache(input: unknown): input is PersistedAnalysisCache {
  if (!input || typeof input !== 'object') return false
  const raw = input as Record<string, unknown>
  if (typeof raw.schemaVersion !== 'string') return false
  if (typeof raw.analyzerVersion !== 'string') return false
  if (typeof raw.promptVersion !== 'string') return false
  if (typeof raw.updatedAt !== 'string') return false
  if (!raw.entries || typeof raw.entries !== 'object') return false
  return true
}

function clearMemoryCache(): void {
  persistedHashesByPath.clear()
  fileAnalysisCache.clear()
}

export async function hydrateFileAnalysisCacheFromDisk(): Promise<void> {
  const projectRoot = resolveProjectRoot()
  const filePath = getAnalysisCachePath(projectRoot)
  const profileKey = getProfileKey()
  const mtimeMs = await readFileMtimeMs(filePath)

  if (
    hydratedState &&
    hydratedState.projectRoot === projectRoot &&
    hydratedState.filePath === filePath &&
    hydratedState.profileKey === profileKey &&
    hydratedState.mtimeMs === mtimeMs
  ) {
    return
  }

  clearMemoryCache()

  if (mtimeMs < 0) {
    hydratedState = { projectRoot, filePath, profileKey, mtimeMs }
    return
  }

  try {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf8')) as unknown
    if (!isValidPersistedCache(raw)) {
      hydratedState = { projectRoot, filePath, profileKey, mtimeMs }
      return
    }

    if (
      raw.schemaVersion !== ANALYSIS_CACHE_SCHEMA_VERSION ||
      raw.analyzerVersion !== ANALYSIS_ANALYZER_VERSION ||
      raw.promptVersion !== ANALYSIS_PROMPT_VERSION
    ) {
      hydratedState = { projectRoot, filePath, profileKey, mtimeMs }
      return
    }

    for (const [filePathKey, contentHash] of Object.entries(raw.entries)) {
      if (typeof contentHash !== 'string' || contentHash.length === 0) continue
      persistedHashesByPath.set(filePathKey, contentHash)
      fileAnalysisCache.set(
        buildFileAnalysisCacheKey(filePathKey, contentHash),
        true,
        FILE_ANALYSIS_CACHE_TTL_MS,
      )
    }
  } catch {
    // 快取載入失敗時採保守策略：忽略舊快取，維持掃描可用性。
  }

  hydratedState = { projectRoot, filePath, profileKey, mtimeMs }
}

export function recordAnalyzedFile(filePath: string, contentHash: string): void {
  persistedHashesByPath.set(filePath, contentHash)
  fileAnalysisCache.set(
    buildFileAnalysisCacheKey(filePath, contentHash),
    true,
    FILE_ANALYSIS_CACHE_TTL_MS,
  )
}

function trimPersistedEntries(): void {
  if (persistedHashesByPath.size <= MAX_ANALYSIS_CACHE_ENTRIES) return
  const overflow = persistedHashesByPath.size - MAX_ANALYSIS_CACHE_ENTRIES
  let removed = 0
  for (const key of persistedHashesByPath.keys()) {
    persistedHashesByPath.delete(key)
    removed += 1
    if (removed >= overflow) break
  }
}

export async function persistFileAnalysisCacheToDisk(): Promise<void> {
  const projectRoot = resolveProjectRoot()
  const filePath = getAnalysisCachePath(projectRoot)
  const profileKey = getProfileKey()

  trimPersistedEntries()

  const payload: PersistedAnalysisCache = {
    schemaVersion: ANALYSIS_CACHE_SCHEMA_VERSION,
    analyzerVersion: ANALYSIS_ANALYZER_VERSION,
    promptVersion: ANALYSIS_PROMPT_VERSION,
    updatedAt: new Date().toISOString(),
    entries: Object.fromEntries(persistedHashesByPath),
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  await fs.rename(tempPath, filePath)

  const mtimeMs = await readFileMtimeMs(filePath)
  hydratedState = { projectRoot, filePath, profileKey, mtimeMs }
}


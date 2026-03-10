import * as fs from 'node:fs/promises'
import path from 'node:path'

const CONFESSION_DIR_NAME = '.confession'

export const STORAGE_FILES = {
  vulnerabilities: 'vulnerabilities.json',
  vulnerabilityEvents: 'vulnerability-events.json',
  scanTasks: 'scan-tasks.json',
  adviceSnapshots: 'advice-snapshots.json',
  adviceDecisions: 'advice-decisions.json',
  config: 'config.json',
  meta: 'meta.json',
} as const

export type StorageFileKey = keyof typeof STORAGE_FILES

export function resolveProjectRoot(): string {
  const fromEnv = process.env.CONFESSION_PROJECT_ROOT?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  return path.resolve(process.cwd())
}

export function getConfessionDir(projectRoot: string): string {
  return path.join(projectRoot, CONFESSION_DIR_NAME)
}

export function getStoragePath(projectRoot: string, key: StorageFileKey): string {
  return path.join(getConfessionDir(projectRoot), STORAGE_FILES[key])
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export function createBootstrapGuard(
  bootstrap: (projectRoot: string) => Promise<void>,
): (projectRoot: string) => Promise<void> {
  const bootstrapPromises = new Map<string, Promise<void>>()
  return async (projectRoot: string) => {
    const existing = bootstrapPromises.get(projectRoot)
    if (existing) {
      await existing
      return
    }
    const promise = bootstrap(projectRoot)
    bootstrapPromises.set(projectRoot, promise)
    await promise
  }
}

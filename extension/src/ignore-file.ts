import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'

import path from 'path'
import * as vscode from 'vscode'

import type { PluginConfig } from './types'

export const CONFESSION_DIR_NAME = '.confession'
export const CONFESSION_CONFIG_FILE_NAME = 'config.json'
export const CONFESSION_CONFIG_RELATIVE_PATH = `${CONFESSION_DIR_NAME}/${CONFESSION_CONFIG_FILE_NAME}`

const DEFAULT_CONFIG: PluginConfig = {
  llm: { provider: 'nvidia', apiKey: '' },
  analysis: { triggerMode: 'onSave', depth: 'standard', debounceMs: 500 },
  ignore: { paths: [], types: [] },
  api: { baseUrl: 'http://localhost:3000', mode: 'local' },
}

function cloneDefaultConfig(): PluginConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as PluginConfig
}

export interface ScopedConfigReadResult {
  exists: boolean
  config: PluginConfig
  rootPath?: string
  filePath?: string
}

export interface WriteScopedConfigResult {
  written: boolean
  reason?: 'no_workspace_root'
  config: PluginConfig
  rootPath?: string
  filePath?: string
}

export interface IgnoreFileReadResult {
  exists: boolean
  paths: string[]
  types: string[]
  rootPath?: string
  filePath?: string
}

export interface WriteScopedIgnoreFileResult {
  written: boolean
  reason?: 'no_workspace_root'
  paths: string[]
  rootPath?: string
  filePath?: string
}

function toCanonicalPath(value: string): string {
  return value.replace(/\\/g, '/')
}

function normalizeIgnoreEntry(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return toCanonicalPath(trimmed)
}

function normalizeIgnoreType(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed
}

function isMissingFileError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

function isPathInRoot(filePath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, filePath)
  if (!relative) return true
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

function fallbackResolveWorkspaceFolder(filePath: string): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders
  if (!folders || folders.length === 0) return undefined
  return folders.find((folder) => isPathInRoot(filePath, folder.uri.fsPath))
}

function getWorkspaceFolderByUri(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
  const getWorkspaceFolder = (vscode.workspace as typeof vscode.workspace & {
    getWorkspaceFolder?: (uri: vscode.Uri) => vscode.WorkspaceFolder | undefined
  }).getWorkspaceFolder

  if (typeof getWorkspaceFolder === 'function') {
    const matched = getWorkspaceFolder(uri)
    if (matched) return matched
  }

  return fallbackResolveWorkspaceFolder(uri.fsPath)
}

function normalizeConfigValue(raw: unknown): PluginConfig {
  if (!raw || typeof raw !== 'object') {
    return cloneDefaultConfig()
  }

  const input = raw as {
    llm?: {
      provider?: PluginConfig['llm']['provider']
      apiKey?: string
      endpoint?: string
      model?: string
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
      paths: normalizeIgnorePaths(Array.isArray(input.ignore?.paths) ? input.ignore.paths : []),
      types: normalizeIgnoreTypes(Array.isArray(input.ignore?.types) ? input.ignore.types : []),
    },
    api: {
      baseUrl: typeof input.api?.baseUrl === 'string' ? input.api.baseUrl : 'http://localhost:3000',
      mode: input.api?.mode === 'remote' ? 'remote' : 'local',
    },
  }

  const endpoint = typeof input.llm?.endpoint === 'string' ? input.llm.endpoint.trim() : ''
  const model = typeof input.llm?.model === 'string' ? input.llm.model.trim() : ''
  if (endpoint) config.llm.endpoint = endpoint
  if (model) config.llm.model = model

  return config
}

function readConfigFileByPath(filePath: string): { exists: boolean; config: PluginConfig } {
  try {
    const content = fs.readFileSync(filePath, 'utf8')
    const raw = JSON.parse(content)
    return { exists: true, config: normalizeConfigValue(raw) }
  } catch (error) {
    if (isMissingFileError(error)) {
      return { exists: false, config: cloneDefaultConfig() }
    }

    return { exists: true, config: cloneDefaultConfig() }
  }
}

export function normalizeIgnorePaths(paths: string[]): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()

  for (const value of paths) {
    const entry = normalizeIgnoreEntry(value)
    if (!entry || seen.has(entry)) continue
    seen.add(entry)
    normalized.push(entry)
  }

  return normalized
}

export function normalizeIgnoreTypes(types: string[]): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()

  for (const value of types) {
    const entry = normalizeIgnoreType(value)
    if (!entry || seen.has(entry)) continue
    seen.add(entry)
    normalized.push(entry)
  }

  return normalized
}

export function resolveWorkspaceRootForPath(filePath: string): vscode.WorkspaceFolder | undefined {
  try {
    return getWorkspaceFolderByUri(vscode.Uri.file(filePath))
  } catch {
    return undefined
  }
}

export function resolveScopedWorkspaceRoot(): vscode.WorkspaceFolder | undefined {
  const activeEditor = vscode.window.activeTextEditor
  if (activeEditor?.document?.uri) {
    const fromActiveEditor = getWorkspaceFolderByUri(activeEditor.document.uri)
    if (fromActiveEditor) return fromActiveEditor
  }

  const folders = vscode.workspace.workspaceFolders
  if (!folders || folders.length === 0) return undefined
  return folders[0]
}

export function getConfigFilePathForRoot(rootPath: string): string {
  return path.join(rootPath, CONFESSION_CONFIG_RELATIVE_PATH)
}

export function readProjectConfigForRoot(rootPath: string): ScopedConfigReadResult {
  const filePath = getConfigFilePathForRoot(rootPath)
  const result = readConfigFileByPath(filePath)
  return {
    ...result,
    rootPath,
    filePath,
  }
}

export function readScopedProjectConfig(): ScopedConfigReadResult {
  const scopedRoot = resolveScopedWorkspaceRoot()
  if (!scopedRoot) {
    return {
      exists: false,
      config: cloneDefaultConfig(),
    }
  }
  return readProjectConfigForRoot(scopedRoot.uri.fsPath)
}

export async function writeScopedProjectConfig(config: PluginConfig): Promise<WriteScopedConfigResult> {
  const scopedRoot = resolveScopedWorkspaceRoot()
  const normalizedConfig = normalizeConfigValue(config)

  if (!scopedRoot) {
    return {
      written: false,
      reason: 'no_workspace_root',
      config: normalizedConfig,
    }
  }

  const rootPath = scopedRoot.uri.fsPath
  const filePath = getConfigFilePathForRoot(rootPath)
  await fsPromises.mkdir(path.dirname(filePath), { recursive: true })
  await fsPromises.writeFile(filePath, `${JSON.stringify(normalizedConfig, null, 2)}\n`, 'utf8')

  return {
    written: true,
    config: normalizedConfig,
    rootPath,
    filePath,
  }
}

// 向後相容：沿用既有 ignore-file API 名稱，底層改讀寫 .confession/config.json
export function readIgnoreFileForRoot(rootPath: string): IgnoreFileReadResult {
  const snapshot = readProjectConfigForRoot(rootPath)
  return {
    exists: snapshot.exists,
    paths: snapshot.config.ignore.paths,
    types: snapshot.config.ignore.types,
    rootPath: snapshot.rootPath,
    filePath: snapshot.filePath,
  }
}

export function readScopedIgnoreFile(): IgnoreFileReadResult {
  const snapshot = readScopedProjectConfig()
  return {
    exists: snapshot.exists,
    paths: snapshot.config.ignore.paths,
    types: snapshot.config.ignore.types,
    rootPath: snapshot.rootPath,
    filePath: snapshot.filePath,
  }
}

export async function writeScopedIgnoreFile(
  paths: string[],
  types?: string[],
): Promise<WriteScopedIgnoreFileResult> {
  const scoped = readScopedProjectConfig()
  const nextConfig: PluginConfig = {
    ...scoped.config,
    ignore: {
      paths: normalizeIgnorePaths(paths),
      types: normalizeIgnoreTypes(types ?? scoped.config.ignore.types),
    },
  }

  const result = await writeScopedProjectConfig(nextConfig)
  return {
    written: result.written,
    reason: result.reason,
    paths: nextConfig.ignore.paths,
    rootPath: result.rootPath,
    filePath: result.filePath,
  }
}

export function resolveIgnorePathsForFile(filePath: string, fallbackPaths: string[]): string[] {
  const normalizedFallback = normalizeIgnorePaths(fallbackPaths)
  const scopedRoot = resolveWorkspaceRootForPath(filePath)
  if (!scopedRoot) return normalizedFallback

  const fromRootConfig = readProjectConfigForRoot(scopedRoot.uri.fsPath)
  if (!fromRootConfig.exists) return normalizedFallback
  return fromRootConfig.config.ignore.paths
}

export function buildWorkspaceRootIgnoreMap(fallbackPaths: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const normalizedFallback = normalizeIgnorePaths(fallbackPaths)
  const folders = vscode.workspace.workspaceFolders ?? []

  for (const folder of folders) {
    const snapshot = readProjectConfigForRoot(folder.uri.fsPath)
    map.set(
      folder.uri.fsPath,
      snapshot.exists ? snapshot.config.ignore.paths : normalizedFallback,
    )
  }

  return map
}

export function resolveIgnorePathsFromRootMap(
  filePath: string,
  rootMap: Map<string, string[]>,
  fallbackPaths: string[],
): string[] {
  const normalizedFallback = normalizeIgnorePaths(fallbackPaths)
  const root = resolveWorkspaceRootForPath(filePath)
  if (!root) return normalizedFallback
  return rootMap.get(root.uri.fsPath) ?? normalizedFallback
}

export function isFilePathIgnored(filePath: string, ignorePaths: string[]): boolean {
  const normalizedFilePath = toCanonicalPath(filePath)
  return ignorePaths.some((pattern) => normalizedFilePath.includes(toCanonicalPath(pattern)))
}

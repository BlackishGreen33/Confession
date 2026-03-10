import * as fs from 'node:fs'

import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import * as vscode from 'vscode'

import {
  buildWorkspaceRootIgnoreMap,
  getConfigFilePathForRoot,
  isFilePathIgnored,
  normalizeIgnorePaths,
  normalizeIgnoreTypes,
  readScopedIgnoreFile,
  readScopedProjectConfig,
  resolveIgnorePathsForFile,
  resolveIgnorePathsFromRootMap,
  writeScopedIgnoreFile,
  writeScopedProjectConfig,
} from './ignore-file'
import type { PluginConfig } from './types'

interface WorkspaceMockState {
  folders: vscode.WorkspaceFolder[]
}

const workspaceState: WorkspaceMockState = {
  folders: [],
}

const createdDirs: string[] = []

const DEFAULT_CONFIG: PluginConfig = {
  llm: { provider: 'nvidia', apiKey: '' },
  analysis: { triggerMode: 'onSave', depth: 'standard', debounceMs: 500 },
  ignore: { paths: [], types: [] },
  api: { baseUrl: 'http://localhost:3000', mode: 'local' },
  ui: { language: 'auto' },
}

function createTempWorkspaceDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  createdDirs.push(dir)
  return dir
}

function isFileInFolder(filePath: string, folderPath: string): boolean {
  const relative = path.relative(folderPath, filePath)
  if (!relative) return true
  return !relative.startsWith('..') && !path.isAbsolute(relative)
}

function toWorkspaceFolder(rootPath: string, index: number): vscode.WorkspaceFolder {
  return {
    uri: vscode.Uri.file(rootPath),
    name: `workspace-${index + 1}`,
    index,
  } as unknown as vscode.WorkspaceFolder
}

function setWorkspaceContext(params: { roots: string[]; activeFilePath?: string }): void {
  const folders = params.roots.map((root, index) => toWorkspaceFolder(root, index))
  workspaceState.folders = folders

  const workspaceExt = vscode.workspace as typeof vscode.workspace & {
    workspaceFolders?: vscode.WorkspaceFolder[]
    getWorkspaceFolder?: (uri: vscode.Uri) => vscode.WorkspaceFolder | undefined
  }
  workspaceExt.workspaceFolders = folders
  workspaceExt.getWorkspaceFolder = (uri) =>
    workspaceState.folders.find((folder) => isFileInFolder(uri.fsPath, folder.uri.fsPath))

  const windowExt = vscode.window as typeof vscode.window & {
    activeTextEditor?: vscode.TextEditor
  }
  if (params.activeFilePath) {
    windowExt.activeTextEditor = {
      document: {
        uri: vscode.Uri.file(params.activeFilePath),
      },
    } as unknown as vscode.TextEditor
    return
  }
  windowExt.activeTextEditor = undefined
}

function writeProjectConfig(rootPath: string, config: PluginConfig): void {
  const filePath = getConfigFilePathForRoot(rootPath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

afterEach(() => {
  workspaceState.folders = []
  setWorkspaceContext({ roots: [] })

  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('.confession/config.json 正規化', () => {
  it('normalizeIgnorePaths 與 normalizeIgnoreTypes 應去重與去空白', () => {
    expect(normalizeIgnorePaths([' dist ', 'src/generated', 'dist', ''])).toEqual([
      'dist',
      'src/generated',
    ])
    expect(normalizeIgnoreTypes([' xss ', 'xss', '', 'hardcoded_secret'])).toEqual([
      'xss',
      'hardcoded_secret',
    ])
  })
})

describe('.confession/config.json 作用域行為', () => {
  it('readScopedProjectConfig 應回傳作用中 root 的 config', () => {
    const rootA = createTempWorkspaceDir('confession-config-a-')
    const rootB = createTempWorkspaceDir('confession-config-b-')

    writeProjectConfig(rootA, {
      ...DEFAULT_CONFIG,
      ignore: { paths: ['packages/a'], types: ['xss'] },
    })
    writeProjectConfig(rootB, {
      ...DEFAULT_CONFIG,
      ignore: { paths: ['packages/b'], types: ['sql_injection'] },
    })

    setWorkspaceContext({
      roots: [rootA, rootB],
      activeFilePath: path.join(rootB, 'src/index.ts'),
    })

    const snapshot = readScopedProjectConfig()
    expect(snapshot.exists).toBe(true)
    expect(snapshot.rootPath).toBe(rootB)
    expect(snapshot.config.ignore.paths).toEqual(['packages/b'])
    expect(snapshot.config.ignore.types).toEqual(['sql_injection'])
  })

  it('writeScopedProjectConfig 應在缺檔時自動建立 .confession/config.json', async () => {
    const root = createTempWorkspaceDir('confession-config-write-')
    setWorkspaceContext({
      roots: [root],
      activeFilePath: path.join(root, 'app.ts'),
    })

    const result = await writeScopedProjectConfig({
      ...DEFAULT_CONFIG,
      ignore: {
        paths: ['dist', 'src/generated'],
        types: ['xss'],
      },
    })

    expect(result.written).toBe(true)
    expect(result.filePath).toBe(path.join(root, '.confession/config.json'))

    const stored = JSON.parse(fs.readFileSync(path.join(root, '.confession/config.json'), 'utf8'))
    expect(stored.ignore.paths).toEqual(['dist', 'src/generated'])
    expect(stored.ignore.types).toEqual(['xss'])
  })

  it('writeScopedIgnoreFile 應以 .confession/config.json 覆寫 ignore.paths 並保留 ignore.types', async () => {
    const root = createTempWorkspaceDir('confession-config-ignore-write-')
    writeProjectConfig(root, {
      ...DEFAULT_CONFIG,
      ignore: { paths: ['old'], types: ['xss'] },
    })
    setWorkspaceContext({
      roots: [root],
      activeFilePath: path.join(root, 'app.ts'),
    })

    const result = await writeScopedIgnoreFile(['dist', 'dist', 'src/generated'])

    expect(result.written).toBe(true)
    expect(result.paths).toEqual(['dist', 'src/generated'])

    const stored = JSON.parse(fs.readFileSync(path.join(root, '.confession/config.json'), 'utf8'))
    expect(stored.ignore.paths).toEqual(['dist', 'src/generated'])
    expect(stored.ignore.types).toEqual(['xss'])

    const scopedIgnore = readScopedIgnoreFile()
    expect(scopedIgnore.paths).toEqual(['dist', 'src/generated'])
    expect(scopedIgnore.types).toEqual(['xss'])
  })

  it('無工作區時，writeScopedProjectConfig / writeScopedIgnoreFile 應回傳略過結果', async () => {
    setWorkspaceContext({ roots: [] })

    const configResult = await writeScopedProjectConfig(DEFAULT_CONFIG)
    expect(configResult.written).toBe(false)
    expect(configResult.reason).toBe('no_workspace_root')

    const ignoreResult = await writeScopedIgnoreFile(['dist'])
    expect(ignoreResult.written).toBe(false)
    expect(ignoreResult.reason).toBe('no_workspace_root')
  })
})

describe('root-aware 忽略路徑解析', () => {
  it('resolveIgnorePathsForFile：有 config 時用 config，缺檔時回退 settings', () => {
    const rootA = createTempWorkspaceDir('confession-config-map-a-')
    const rootB = createTempWorkspaceDir('confession-config-map-b-')

    writeProjectConfig(rootA, {
      ...DEFAULT_CONFIG,
      ignore: { paths: ['packages/a'], types: [] },
    })

    setWorkspaceContext({ roots: [rootA, rootB] })

    expect(resolveIgnorePathsForFile(path.join(rootA, 'src/a.ts'), ['fallback'])).toEqual([
      'packages/a',
    ])
    expect(resolveIgnorePathsForFile(path.join(rootB, 'src/b.ts'), ['fallback'])).toEqual([
      'fallback',
    ])
  })

  it('buildWorkspaceRootIgnoreMap + resolveIgnorePathsFromRootMap 應避免跨 root 汙染', () => {
    const rootA = createTempWorkspaceDir('confession-config-map2-a-')
    const rootB = createTempWorkspaceDir('confession-config-map2-b-')

    writeProjectConfig(rootA, {
      ...DEFAULT_CONFIG,
      ignore: { paths: ['packages/a'], types: [] },
    })
    writeProjectConfig(rootB, {
      ...DEFAULT_CONFIG,
      ignore: { paths: ['packages/b'], types: [] },
    })

    setWorkspaceContext({ roots: [rootA, rootB] })

    const rootMap = buildWorkspaceRootIgnoreMap(['fallback'])
    expect(resolveIgnorePathsFromRootMap(path.join(rootA, 'src/a.ts'), rootMap, ['fallback'])).toEqual([
      'packages/a',
    ])
    expect(resolveIgnorePathsFromRootMap(path.join(rootB, 'src/b.ts'), rootMap, ['fallback'])).toEqual([
      'packages/b',
    ])
  })

  it('isFilePathIgnored 應以字串包含規則判定，並相容斜線差異', () => {
    expect(isFilePathIgnored('/repo/src/generated/file.ts', ['src/generated'])).toBe(true)
    expect(isFilePathIgnored('C:\\repo\\dist\\main.js', ['dist/'])).toBe(true)
    expect(isFilePathIgnored('/repo/src/main.ts', ['src/generated'])).toBe(false)
  })
})

#!/usr/bin/env node

const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')

const CONFESSION_DIR_NAME = '.confession'
const SCHEMA_VERSION = 'file-store-v1'
const FILE_LIMIT = 5000
const POLL_INTERVAL_MS = 1500
const SCAN_TIMEOUT_MS = 30 * 60 * 1000

const STORAGE_FILES = {
  config: 'config.json',
  vulnerabilities: 'vulnerabilities.json',
  vulnerabilityEvents: 'vulnerability-events.json',
  scanTasks: 'scan-tasks.json',
  adviceSnapshots: 'advice-snapshots.json',
  adviceDecisions: 'advice-decisions.json',
  meta: 'meta.json',
}

const DEFAULT_CONFIG = {
  llm: { provider: 'nvidia', apiKey: '' },
  analysis: { triggerMode: 'onSave', depth: 'standard', debounceMs: 500 },
  ignore: { paths: [], types: [] },
  api: { baseUrl: 'http://localhost:3000', mode: 'local' },
}

const SUPPORTED_EXTS = new Set(['.go', '.js', '.jsx', '.ts', '.tsx'])

function resolveProjectRoot() {
  const fromEnv = process.env.CONFESSION_PROJECT_ROOT
  return fromEnv && fromEnv.trim().length > 0
    ? path.resolve(fromEnv.trim())
    : path.resolve(process.cwd())
}

function getConfessionDir(projectRoot) {
  return path.join(projectRoot, CONFESSION_DIR_NAME)
}

function getStoragePath(projectRoot, key) {
  return path.join(getConfessionDir(projectRoot), STORAGE_FILES[key])
}

function normalizeSlash(value) {
  return String(value).replace(/\\/g, '/')
}

function normalizeIgnorePaths(paths) {
  if (!Array.isArray(paths)) return []
  const seen = new Set()
  const output = []

  for (const raw of paths) {
    const normalized = normalizeSlash(String(raw).trim())
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    output.push(normalized)
  }

  return output
}

function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  const llm = input.llm && typeof input.llm === 'object' ? input.llm : {}
  const analysis =
    input.analysis && typeof input.analysis === 'object' ? input.analysis : {}
  const ignore = input.ignore && typeof input.ignore === 'object' ? input.ignore : {}
  const api = input.api && typeof input.api === 'object' ? input.api : {}

  const config = {
    llm: {
      provider: llm.provider === 'gemini' ? 'gemini' : 'nvidia',
      apiKey: typeof llm.apiKey === 'string' ? llm.apiKey : '',
    },
    analysis: {
      triggerMode: analysis.triggerMode === 'manual' ? 'manual' : 'onSave',
      depth:
        analysis.depth === 'quick' || analysis.depth === 'deep'
          ? analysis.depth
          : 'standard',
      debounceMs:
        typeof analysis.debounceMs === 'number'
          ? Math.max(0, Math.floor(analysis.debounceMs))
          : 500,
    },
    ignore: {
      paths: normalizeIgnorePaths(ignore.paths),
      types: Array.isArray(ignore.types)
        ? Array.from(
            new Set(
              ignore.types
                .map((item) => String(item).trim())
                .filter((item) => item.length > 0),
            ),
          )
        : [],
    },
    api: {
      baseUrl:
        typeof api.baseUrl === 'string' && api.baseUrl.trim().length > 0
          ? api.baseUrl.trim()
          : 'http://localhost:3000',
      mode: api.mode === 'remote' ? 'remote' : 'local',
    },
  }

  if (typeof llm.endpoint === 'string' && llm.endpoint.trim().length > 0) {
    config.llm.endpoint = llm.endpoint.trim()
  }
  if (typeof llm.model === 'string' && llm.model.trim().length > 0) {
    config.llm.model = llm.model.trim()
  }

  return config
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function initProject(projectRoot) {
  const confessionDir = getConfessionDir(projectRoot)
  await fs.mkdir(confessionDir, { recursive: true })

  const now = new Date().toISOString()
  const targets = [
    { key: 'config', defaultValue: DEFAULT_CONFIG },
    { key: 'vulnerabilities', defaultValue: [] },
    { key: 'vulnerabilityEvents', defaultValue: [] },
    { key: 'scanTasks', defaultValue: [] },
    { key: 'adviceSnapshots', defaultValue: [] },
    { key: 'adviceDecisions', defaultValue: [] },
    {
      key: 'meta',
      defaultValue: {
        schemaVersion: SCHEMA_VERSION,
        createdAt: now,
        lastMigrationAt: null,
      },
    },
  ]

  for (const target of targets) {
    const filePath = getStoragePath(projectRoot, target.key)
    if (fsSync.existsSync(filePath)) continue
    await writeJson(filePath, target.defaultValue)
  }
}

async function loadProjectConfig(projectRoot) {
  const configPath = getStoragePath(projectRoot, 'config')
  const raw = await readJson(configPath, DEFAULT_CONFIG)
  return normalizeConfig(raw)
}

function isIgnored(filePath, ignorePaths) {
  const normalized = normalizeSlash(filePath)
  return ignorePaths.some((pattern) => normalized.includes(normalizeSlash(pattern)))
}

function inferLanguage(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.go') return 'go'
  if (ext === '.js' || ext === '.jsx') return 'javascript'
  if (ext === '.ts' || ext === '.tsx') return 'typescript'
  return null
}

async function collectWorkspaceFiles(projectRoot, ignorePaths) {
  const results = []
  let snapshotComplete = true

  async function walk(dirPath) {
    if (results.length >= FILE_LIMIT) {
      snapshotComplete = false
      return
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (results.length >= FILE_LIMIT) {
        snapshotComplete = false
        break
      }

      const absolutePath = path.join(dirPath, entry.name)
      const relativePath = path.relative(projectRoot, absolutePath)

      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        if (entry.name === '.git') continue
        if (entry.name === CONFESSION_DIR_NAME) continue
        await walk(absolutePath)
        continue
      }

      if (!entry.isFile()) continue
      if (!SUPPORTED_EXTS.has(path.extname(entry.name).toLowerCase())) continue
      if (isIgnored(absolutePath, ignorePaths) || isIgnored(relativePath, ignorePaths)) {
        continue
      }

      const language = inferLanguage(absolutePath)
      if (!language) continue

      const content = await fs.readFile(absolutePath, 'utf8')
      results.push({ path: absolutePath, content, language })
    }
  }

  await walk(projectRoot)
  return { files: results, workspaceSnapshotComplete: snapshotComplete }
}

async function triggerScan(baseUrl, payload) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`觸發掃描失敗 (${response.status}) ${text}`)
  }

  return response.json()
}

async function fetchScanStatus(baseUrl, taskId) {
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, '')}/api/scan/status/${encodeURIComponent(taskId)}`,
  )
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`讀取掃描狀態失敗 (${response.status}) ${text}`)
  }
  return response.json()
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseFlags(argv) {
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      flags[key] = true
      continue
    }
    flags[key] = next
    i += 1
  }
  return flags
}

function printHelp() {
  process.stdout.write(`\nConfession CLI\n\n`)
  process.stdout.write(`Usage:\n`)
  process.stdout.write(`  confession init\n`)
  process.stdout.write(`  confession scan [--api <baseUrl>] [--depth quick|standard|deep]\n`)
  process.stdout.write(
    `  confession list [--status open|fixed|ignored] [--severity critical|high|medium|low|info] [--search <keyword>]\n`,
  )
  process.stdout.write(`  confession status\n\n`)
}

async function commandInit(projectRoot) {
  await initProject(projectRoot)
  process.stdout.write(`已初始化：${path.join(projectRoot, '.confession')}\n`)
}

async function commandScan(projectRoot, flags) {
  await initProject(projectRoot)
  const config = await loadProjectConfig(projectRoot)
  const depth =
    flags.depth === 'quick' || flags.depth === 'deep' ? flags.depth : config.analysis.depth
  const baseUrl =
    typeof flags.api === 'string' && flags.api.trim().length > 0
      ? flags.api.trim()
      : config.api.baseUrl

  const { files, workspaceSnapshotComplete } = await collectWorkspaceFiles(
    projectRoot,
    config.ignore.paths,
  )

  if (files.length === 0) {
    process.stdout.write('沒有可掃描檔案（可能全部被 ignore）\n')
    return
  }

  process.stdout.write(`準備掃描 ${files.length} 個檔案，呼叫 ${baseUrl}\n`)
  const created = await triggerScan(baseUrl, {
    files,
    depth,
    includeLlmScan: depth === 'deep',
    forceRescan: true,
    scanScope: 'workspace',
    workspaceSnapshotComplete,
    workspaceRoots: [projectRoot],
  })

  const taskId = created.taskId
  if (!taskId) {
    throw new Error('掃描任務建立失敗：未取得 taskId')
  }

  const startedAt = Date.now()
  while (true) {
    if (Date.now() - startedAt > SCAN_TIMEOUT_MS) {
      throw new Error('掃描等待逾時（30 分鐘）')
    }

    const status = await fetchScanStatus(baseUrl, taskId)
    const scanned = Number(status.scannedFiles ?? 0)
    const total = Number(status.totalFiles ?? 0)
    const progress = total > 0 ? `${scanned}/${total}` : `${Math.round(Number(status.progress ?? 0) * 100)}%`
    process.stdout.write(`\r[task:${taskId}] ${status.status} ${progress}                    `)

    if (status.status === 'completed') {
      process.stdout.write('\n掃描完成\n')
      return
    }

    if (status.status === 'failed') {
      process.stdout.write('\n掃描失敗\n')
      if (status.errorMessage) {
        process.stdout.write(`${status.errorMessage}\n`)
      }
      process.exitCode = 1
      return
    }

    await sleep(POLL_INTERVAL_MS)
  }
}

function truncate(text, limit) {
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1)}…`
}

async function commandList(projectRoot, flags) {
  await initProject(projectRoot)
  const rows = await readJson(getStoragePath(projectRoot, 'vulnerabilities'), [])

  const statusFilter = typeof flags.status === 'string' ? flags.status : null
  const severityFilter = typeof flags.severity === 'string' ? flags.severity : null
  const search = typeof flags.search === 'string' ? flags.search.toLowerCase() : null

  const filtered = rows
    .filter((row) => !statusFilter || row.status === statusFilter)
    .filter((row) => !severityFilter || row.severity === severityFilter)
    .filter((row) => {
      if (!search) return true
      const text = `${row.filePath ?? ''} ${row.type ?? ''} ${row.description ?? ''}`.toLowerCase()
      return text.includes(search)
    })
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))

  if (filtered.length === 0) {
    process.stdout.write('沒有符合條件的漏洞\n')
    return
  }

  for (const row of filtered) {
    const id = String(row.id ?? '')
    const severity = String(row.severity ?? '')
    const status = String(row.status ?? '')
    const filePath = String(row.filePath ?? '')
    const line = Number(row.line ?? 0)
    const type = String(row.type ?? '')
    const description = truncate(String(row.description ?? ''), 80)
    process.stdout.write(`${id}  [${severity}/${status}] ${filePath}:${line}  ${type}  ${description}\n`)
  }
}

function countBy(rows, selector) {
  const counter = {}
  for (const row of rows) {
    const key = selector(row)
    counter[key] = (counter[key] || 0) + 1
  }
  return counter
}

async function commandStatus(projectRoot) {
  await initProject(projectRoot)
  const [tasks, vulns] = await Promise.all([
    readJson(getStoragePath(projectRoot, 'scanTasks'), []),
    readJson(getStoragePath(projectRoot, 'vulnerabilities'), []),
  ])

  const latestTask = [...tasks].sort((a, b) =>
    String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')),
  )[0]

  const byStatus = countBy(vulns, (row) => String(row.status || 'unknown'))
  const bySeverityOpen = countBy(
    vulns.filter((row) => row.status === 'open'),
    (row) => String(row.severity || 'unknown'),
  )

  process.stdout.write(`project: ${projectRoot}\n`)
  process.stdout.write(`vulnerabilities: total=${vulns.length} open=${byStatus.open || 0} fixed=${byStatus.fixed || 0} ignored=${byStatus.ignored || 0}\n`)
  process.stdout.write(
    `open severity: critical=${bySeverityOpen.critical || 0} high=${bySeverityOpen.high || 0} medium=${bySeverityOpen.medium || 0} low=${bySeverityOpen.low || 0} info=${bySeverityOpen.info || 0}\n`,
  )

  if (!latestTask) {
    process.stdout.write('latest scan: 尚無掃描任務\n')
    return
  }

  process.stdout.write(
    `latest scan: id=${latestTask.id} status=${latestTask.status} engine=${latestTask.engineMode} fallback=${latestTask.fallbackUsed ? 'yes' : 'no'} updatedAt=${latestTask.updatedAt}\n`,
  )
}

async function main() {
  const argv = process.argv.slice(2)
  const command = argv[0]

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp()
    return
  }

  const flags = parseFlags(argv.slice(1))
  const projectRoot = resolveProjectRoot()

  switch (command) {
    case 'init':
      await commandInit(projectRoot)
      break
    case 'scan':
      await commandScan(projectRoot, flags)
      break
    case 'list':
      await commandList(projectRoot, flags)
      break
    case 'status':
      await commandStatus(projectRoot)
      break
    default:
      process.stderr.write(`未知命令：${command}\n`)
      printHelp()
      process.exitCode = 1
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[confession] ${message}\n`)
  process.exitCode = 1
})

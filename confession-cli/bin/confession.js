#!/usr/bin/env node

const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')

const CONFESSION_DIR_NAME = '.confession'
const SCHEMA_VERSION = 'file-store-v1'
const FILE_LIMIT = 5000
const DEFAULT_POLL_INTERVAL_MS = 1500
const DEFAULT_SCAN_TIMEOUT_MS = 30 * 60 * 1000

const VALID_DEPTHS = new Set(['quick', 'standard', 'deep'])
const VALID_STATUSES = new Set(['open', 'fixed', 'ignored'])
const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info'])

const COMMAND_FLAG_SPEC = {
  init: new Set(),
  scan: new Set(['api', 'depth']),
  list: new Set(['status', 'severity', 'search']),
  status: new Set(),
}

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

class CliError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'CliError'
    this.exitCode = options.exitCode ?? 1
    this.showHelp = options.showHelp ?? false
  }
}

function normalizeCwd(cwdValue) {
  if (typeof cwdValue === 'function') {
    return cwdValue
  }
  if (typeof cwdValue === 'string' && cwdValue.trim().length > 0) {
    return () => cwdValue
  }
  return () => process.cwd()
}

function resolveDurationFromEnv(env, key, fallback) {
  const raw = env[key]
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return fallback
  }

  const parsed = Number.parseInt(raw.trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return parsed
}

function createRuntime(overrides = {}) {
  const env = overrides.env ?? process.env

  return {
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    env,
    cwd: normalizeCwd(overrides.cwd),
    fetchImpl: overrides.fetchImpl ?? globalThis.fetch,
    sleepImpl: overrides.sleepImpl ?? sleep,
    now: overrides.now ?? Date.now,
    pollIntervalMs:
      overrides.pollIntervalMs ??
      resolveDurationFromEnv(
        env,
        'CONFESSION_CLI_POLL_INTERVAL_MS',
        DEFAULT_POLL_INTERVAL_MS,
      ),
    scanTimeoutMs:
      overrides.scanTimeoutMs ??
      resolveDurationFromEnv(
        env,
        'CONFESSION_CLI_SCAN_TIMEOUT_MS',
        DEFAULT_SCAN_TIMEOUT_MS,
      ),
    registerSigint:
      overrides.registerSigint ??
      ((handler) => {
        process.once('SIGINT', handler)
        return () => process.off('SIGINT', handler)
      }),
  }
}

function resolveProjectRoot(runtime) {
  const fromEnv = runtime.env.CONFESSION_PROJECT_ROOT
  return fromEnv && fromEnv.trim().length > 0
    ? path.resolve(fromEnv.trim())
    : path.resolve(runtime.cwd())
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
      depth: VALID_DEPTHS.has(analysis.depth) ? analysis.depth : 'standard',
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

function ensureFetchAvailable(runtime) {
  if (typeof runtime.fetchImpl !== 'function') {
    throw new CliError('目前環境不支援 fetch，無法執行掃描命令')
  }
}

async function triggerScan(baseUrl, payload, runtime) {
  ensureFetchAvailable(runtime)

  const response = await runtime.fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new CliError(`觸發掃描失敗 (${response.status}) ${text}`)
  }

  return response.json()
}

async function fetchScanStatus(baseUrl, taskId, runtime) {
  ensureFetchAvailable(runtime)

  const response = await runtime.fetchImpl(
    `${baseUrl.replace(/\/+$/, '')}/api/scan/status/${encodeURIComponent(taskId)}`,
  )

  if (!response.ok) {
    const text = await response.text()
    throw new CliError(`讀取掃描狀態失敗 (${response.status}) ${text}`)
  }

  return response.json()
}

async function cancelScanTask(baseUrl, taskId, runtime) {
  ensureFetchAvailable(runtime)

  const response = await runtime.fetchImpl(
    `${baseUrl.replace(/\/+$/, '')}/api/scan/cancel/${encodeURIComponent(taskId)}`,
    { method: 'POST' },
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`取消掃描失敗 (${response.status}) ${text}`)
  }
}

async function tryCancelScanTask(baseUrl, taskId, runtime, reason) {
  try {
    await cancelScanTask(baseUrl, taskId, runtime)
    runtime.stdout.write(`${reason}，已送出取消請求\n`)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    runtime.stderr.write(`[confession] ${reason}，取消請求失敗：${message}\n`)
    return false
  }
}

function parseFlags(argv, allowedFlags) {
  const flags = {}

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (!token.startsWith('--')) {
      throw new CliError(`未知參數：${token}`)
    }

    const key = token.slice(2)
    if (!allowedFlags.has(key)) {
      throw new CliError(`未知參數：--${key}`)
    }

    const next = argv[i + 1]
    if (!next || next.startsWith('--')) {
      throw new CliError(`參數 --${key} 需要提供值`)
    }

    flags[key] = next
    i += 1
  }

  return flags
}

function validateEnumFlag(name, value, allowedSet) {
  if (value == null) {
    return null
  }

  if (!allowedSet.has(value)) {
    throw new CliError(
      `參數 --${name} 僅接受：${Array.from(allowedSet).join('|')}（目前為 ${value}）`,
    )
  }

  return value
}

function printHelp(stdout = process.stdout) {
  stdout.write('\nConfession CLI\n\n')
  stdout.write('Usage:\n')
  stdout.write('  confession init\n')
  stdout.write('  confession scan [--api <baseUrl>] [--depth quick|standard|deep]\n')
  stdout.write(
    '  confession list [--status open|fixed|ignored] [--severity critical|high|medium|low|info] [--search <keyword>]\n',
  )
  stdout.write('  confession status\n\n')
}

async function commandInit(projectRoot, runtime) {
  await initProject(projectRoot)
  runtime.stdout.write(`已初始化：${path.join(projectRoot, '.confession')}\n`)
}

async function commandScan(projectRoot, flags, runtime) {
  await initProject(projectRoot)

  const config = await loadProjectConfig(projectRoot)
  const depth = flags.depth
    ? validateEnumFlag('depth', flags.depth, VALID_DEPTHS)
    : config.analysis.depth
  const baseUrl =
    typeof flags.api === 'string' && flags.api.trim().length > 0
      ? flags.api.trim()
      : config.api.baseUrl

  const { files, workspaceSnapshotComplete } = await collectWorkspaceFiles(
    projectRoot,
    config.ignore.paths,
  )

  if (files.length === 0) {
    runtime.stdout.write('沒有可掃描檔案（可能全部被 ignore）\n')
    return
  }

  runtime.stdout.write(`準備掃描 ${files.length} 個檔案，呼叫 ${baseUrl}\n`)
  const created = await triggerScan(
    baseUrl,
    {
      files,
      depth,
      includeLlmScan: depth === 'deep',
      forceRescan: true,
      scanScope: 'workspace',
      workspaceSnapshotComplete,
      workspaceRoots: [projectRoot],
    },
    runtime,
  )

  const taskId = created.taskId
  if (!taskId) {
    throw new CliError('掃描任務建立失敗：未取得 taskId')
  }

  const pollIntervalMs = Math.max(50, Math.floor(runtime.pollIntervalMs))
  const scanTimeoutMs = Math.max(1000, Math.floor(runtime.scanTimeoutMs))
  const startedAt = runtime.now()
  let interrupted = false

  const unregisterSigint = runtime.registerSigint(() => {
    interrupted = true
  })

  try {
    while (true) {
      if (interrupted) {
        runtime.stdout.write('\n收到 SIGINT，正在取消掃描任務...\n')
        await tryCancelScanTask(baseUrl, taskId, runtime, '掃描已中斷')
        throw new CliError('掃描已中斷，已嘗試取消後端任務', { exitCode: 130 })
      }

      if (runtime.now() - startedAt > scanTimeoutMs) {
        runtime.stdout.write(
          `\n掃描等待逾時（${Math.ceil(scanTimeoutMs / 1000)} 秒），正在取消掃描任務...\n`,
        )
        await tryCancelScanTask(baseUrl, taskId, runtime, '掃描逾時')
        throw new CliError(
          `掃描等待逾時（${Math.ceil(scanTimeoutMs / 1000)} 秒），已嘗試取消後端任務`,
        )
      }

      const status = await fetchScanStatus(baseUrl, taskId, runtime)
      const scanned = Number(status.scannedFiles ?? 0)
      const total = Number(status.totalFiles ?? 0)
      const progress =
        total > 0
          ? `${scanned}/${total}`
          : `${Math.round(Number(status.progress ?? 0) * 100)}%`

      runtime.stdout.write(
        `\r[task:${taskId}] ${status.status} ${progress}                    `,
      )

      if (status.status === 'completed') {
        runtime.stdout.write('\n掃描完成\n')
        return
      }

      if (status.status === 'failed') {
        const reason =
          typeof status.errorMessage === 'string' && status.errorMessage.trim().length > 0
            ? status.errorMessage.trim()
            : '未知錯誤'
        throw new CliError(`掃描失敗：${reason}`)
      }

      await runtime.sleepImpl(pollIntervalMs)
    }
  } finally {
    unregisterSigint()
  }
}

function truncate(text, limit) {
  if (text.length <= limit) return text
  return `${text.slice(0, limit - 1)}…`
}

async function commandList(projectRoot, flags, runtime) {
  await initProject(projectRoot)
  const rows = await readJson(getStoragePath(projectRoot, 'vulnerabilities'), [])

  const statusFilter = validateEnumFlag('status', flags.status ?? null, VALID_STATUSES)
  const severityFilter = validateEnumFlag(
    'severity',
    flags.severity ?? null,
    VALID_SEVERITIES,
  )
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
    runtime.stdout.write('沒有符合條件的漏洞\n')
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
    runtime.stdout.write(
      `${id}  [${severity}/${status}] ${filePath}:${line}  ${type}  ${description}\n`,
    )
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

async function commandStatus(projectRoot, runtime) {
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

  runtime.stdout.write(`project: ${projectRoot}\n`)
  runtime.stdout.write(
    `vulnerabilities: total=${vulns.length} open=${byStatus.open || 0} fixed=${byStatus.fixed || 0} ignored=${byStatus.ignored || 0}\n`,
  )
  runtime.stdout.write(
    `open severity: critical=${bySeverityOpen.critical || 0} high=${bySeverityOpen.high || 0} medium=${bySeverityOpen.medium || 0} low=${bySeverityOpen.low || 0} info=${bySeverityOpen.info || 0}\n`,
  )

  if (!latestTask) {
    runtime.stdout.write('latest scan: 尚無掃描任務\n')
    return
  }

  runtime.stdout.write(
    `latest scan: id=${latestTask.id} status=${latestTask.status} engine=${latestTask.engineMode} fallback=${latestTask.fallbackUsed ? 'yes' : 'no'} updatedAt=${latestTask.updatedAt}\n`,
  )
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toCliFailure(error) {
  if (error instanceof CliError) {
    return {
      message: error.message,
      exitCode: error.exitCode,
      showHelp: error.showHelp,
    }
  }

  return {
    message: error instanceof Error ? error.message : String(error),
    exitCode: 1,
    showHelp: false,
  }
}

async function runCli(argv, runtimeOverrides = {}) {
  const runtime = createRuntime(runtimeOverrides)

  try {
    const args = Array.isArray(argv) ? argv : []
    const command = args[0]

    if (!command || command === '--help' || command === '-h' || command === 'help') {
      printHelp(runtime.stdout)
      return 0
    }

    if (!Object.prototype.hasOwnProperty.call(COMMAND_FLAG_SPEC, command)) {
      throw new CliError(`未知命令：${command}`, { showHelp: true })
    }

    if (args[1] === '--help' || args[1] === '-h') {
      printHelp(runtime.stdout)
      return 0
    }

    const flags = parseFlags(args.slice(1), COMMAND_FLAG_SPEC[command])
    const projectRoot = resolveProjectRoot(runtime)

    switch (command) {
      case 'init':
        await commandInit(projectRoot, runtime)
        break
      case 'scan':
        await commandScan(projectRoot, flags, runtime)
        break
      case 'list':
        await commandList(projectRoot, flags, runtime)
        break
      case 'status':
        await commandStatus(projectRoot, runtime)
        break
      default:
        throw new CliError(`未知命令：${command}`, { showHelp: true })
    }

    return 0
  } catch (error) {
    const failure = toCliFailure(error)
    runtime.stderr.write(`[confession] ${failure.message}\n`)

    if (failure.showHelp) {
      printHelp(runtime.stdout)
    }

    return failure.exitCode
  }
}

module.exports = {
  runCli,
  createRuntime,
  parseFlags,
  commandInit,
  commandScan,
  commandList,
  commandStatus,
}

if (require.main === module) {
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode
  })
}

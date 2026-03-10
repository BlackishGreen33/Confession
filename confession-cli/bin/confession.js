#!/usr/bin/env node

const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const CONFESSION_DIR_NAME = '.confession'
const SCHEMA_VERSION = 'file-store-v1'
const FILE_LIMIT = 5000
const DEFAULT_POLL_INTERVAL_MS = 1500
const DEFAULT_SCAN_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_VERIFY_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_DAST_RATE_LIMIT = 5
const DEFAULT_DAST_CONCURRENCY = 4

const VALID_DEPTHS = new Set(['quick', 'standard', 'deep'])
const VALID_STATUSES = new Set(['open', 'fixed', 'ignored'])
const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info'])
const VALID_VERIFY_TARGETS = new Set(['web'])

const COMMAND_FLAG_SPEC = {
  init: new Set(),
  scan: new Set(['api', 'depth']),
  list: new Set(['status', 'severity', 'search']),
  status: new Set(),
  verify: new Set([
    'url',
    'zap-bin',
    'nuclei-bin',
    'timeout-ms',
    'rate-limit',
    'concurrency',
  ]),
}

const STORAGE_FILES = {
  config: 'config.json',
  vulnerabilities: 'vulnerabilities.json',
  vulnerabilityEvents: 'vulnerability-events.json',
  scanTasks: 'scan-tasks.json',
  adviceSnapshots: 'advice-snapshots.json',
  adviceDecisions: 'advice-decisions.json',
  analysisCache: 'analysis-cache.json',
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
    spawnImpl: overrides.spawnImpl ?? spawn,
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
      key: 'analysisCache',
      defaultValue: {
        schemaVersion: 'analysis-cache-v1',
        analyzerVersion: 'ast-jsts-go-keywords-v1',
        promptVersion: 'llm-prompt-v2',
        updatedAt: now,
        entries: {},
      },
    },
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

function parsePositiveIntegerFlag(name, value, fallback) {
  if (value == null) return fallback
  const parsed = Number.parseInt(String(value), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError(`參數 --${name} 需為正整數（目前為 ${value}）`)
  }
  return parsed
}

function normalizeCommandPath(value, fallback) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim()
  }
  return fallback
}

function isHttpUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function createDastTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

async function runExternalCommand(command, args, runtime, options = {}) {
  const timeoutMs = Math.max(1_000, Math.floor(options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS))
  const cwd = options.cwd ?? runtime.cwd()

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false

    const child = runtime.spawnImpl(command, args, {
      cwd,
      env: runtime.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timeoutId = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 1500)
    }, timeoutMs)

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })

    child.once('error', (error) => {
      clearTimeout(timeoutId)
      resolve({
        ok: false,
        timedOut,
        exitCode: null,
        stdout,
        stderr,
        error,
      })
    })

    child.once('close', (code) => {
      clearTimeout(timeoutId)
      resolve({
        ok: !timedOut && code === 0,
        timedOut,
        exitCode: typeof code === 'number' ? code : null,
        stdout,
        stderr,
        error: null,
      })
    })
  })
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
  stdout.write(
    '  confession verify web --url <http(s)://target> [--zap-bin <path>] [--nuclei-bin <path>] [--timeout-ms <ms>] [--rate-limit <n>] [--concurrency <n>]\n\n',
  )
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

async function commandVerify(projectRoot, target, flags, runtime) {
  await initProject(projectRoot)
  const normalizedTarget = validateEnumFlag('target', target, VALID_VERIFY_TARGETS)

  if (normalizedTarget !== 'web') {
    throw new CliError(`尚未支援 verify target: ${normalizedTarget}`)
  }

  const targetUrl = typeof flags.url === 'string' ? flags.url.trim() : ''
  if (!isHttpUrl(targetUrl)) {
    throw new CliError('verify web 需要提供合法的 --url（http:// 或 https://）')
  }

  const timeoutMs = parsePositiveIntegerFlag(
    'timeout-ms',
    flags['timeout-ms'],
    DEFAULT_VERIFY_TIMEOUT_MS,
  )
  const rateLimit = parsePositiveIntegerFlag(
    'rate-limit',
    flags['rate-limit'],
    DEFAULT_DAST_RATE_LIMIT,
  )
  const concurrency = parsePositiveIntegerFlag(
    'concurrency',
    flags.concurrency,
    DEFAULT_DAST_CONCURRENCY,
  )
  const zapBin = normalizeCommandPath(
    flags['zap-bin'],
    runtime.env.CONFESSION_ZAP_BIN || 'zap-baseline.py',
  )
  const nucleiBin = normalizeCommandPath(
    flags['nuclei-bin'],
    runtime.env.CONFESSION_NUCLEI_BIN || 'nuclei',
  )

  const timestamp = createDastTimestamp()
  const outputDir = path.join(getConfessionDir(projectRoot), 'dast')
  await fs.mkdir(outputDir, { recursive: true })

  const zapReportPath = path.join(outputDir, `zap-baseline-${timestamp}.json`)
  const nucleiReportPath = path.join(outputDir, `nuclei-${timestamp}.jsonl`)
  const summaryPath = path.join(outputDir, `summary-${timestamp}.json`)

  const summary = {
    target: normalizedTarget,
    url: targetUrl,
    startedAt: new Date().toISOString(),
    timeoutMs,
    rateLimit,
    concurrency,
    tools: {},
  }

  runtime.stdout.write(`開始 DAST 驗證：target=${targetUrl}\n`)
  runtime.stdout.write(
    `預設保守策略：timeout=${timeoutMs}ms rateLimit=${rateLimit} concurrency=${concurrency}\n`,
  )

  const zapArgs = ['-t', targetUrl, '-J', zapReportPath, '-m', '3', '-I']
  const zapResult = await runExternalCommand(zapBin, zapArgs, runtime, {
    timeoutMs,
    cwd: projectRoot,
  })
  summary.tools.zap = normalizeToolResult('zap', zapBin, zapArgs, zapResult, zapReportPath)

  const nucleiArgs = [
    '-u',
    targetUrl,
    '-jsonl',
    '-o',
    nucleiReportPath,
    '-rate-limit',
    String(rateLimit),
    '-c',
    String(concurrency),
  ]
  const nucleiResult = await runExternalCommand(nucleiBin, nucleiArgs, runtime, {
    timeoutMs,
    cwd: projectRoot,
  })
  summary.tools.nuclei = normalizeToolResult(
    'nuclei',
    nucleiBin,
    nucleiArgs,
    nucleiResult,
    nucleiReportPath,
  )

  summary.finishedAt = new Date().toISOString()

  await writeJson(summaryPath, summary)

  const statuses = [summary.tools.zap.status, summary.tools.nuclei.status]
  const executedCount = statuses.filter((status) => status !== 'missing').length
  const failedCount = statuses.filter((status) => status === 'failed').length

  if (executedCount === 0) {
    throw new CliError('找不到可執行的 DAST 工具（zap-baseline.py / nuclei）')
  }

  runtime.stdout.write(`DAST 驗證完成，摘要：${summaryPath}\n`)
  runtime.stdout.write(
    `工具結果：zap=${summary.tools.zap.status} nuclei=${summary.tools.nuclei.status}\n`,
  )

  if (failedCount > 0) {
    throw new CliError('部分 DAST 工具執行失敗，請檢查摘要與錯誤輸出')
  }
}

function normalizeToolResult(toolName, command, args, result, reportPath) {
  const common = {
    command,
    args,
    reportPath,
  }

  if (result.error && result.error.code === 'ENOENT') {
    return {
      ...common,
      status: 'missing',
      error: `${toolName} 指令不存在`,
    }
  }

  if (result.timedOut) {
    return {
      ...common,
      status: 'failed',
      exitCode: result.exitCode,
      error: '執行逾時',
    }
  }

  if (!result.ok) {
    return {
      ...common,
      status: 'failed',
      exitCode: result.exitCode,
      error:
        result.error instanceof Error
          ? result.error.message
          : String(result.stderr || result.stdout || '工具執行失敗'),
    }
  }

  return {
    ...common,
    status: 'ok',
    exitCode: result.exitCode,
  }
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
    const projectRoot = resolveProjectRoot(runtime)

    switch (command) {
      case 'init': {
        parseFlags(args.slice(1), COMMAND_FLAG_SPEC.init)
        await commandInit(projectRoot, runtime)
        break
      }
      case 'scan': {
        const flags = parseFlags(args.slice(1), COMMAND_FLAG_SPEC.scan)
        await commandScan(projectRoot, flags, runtime)
        break
      }
      case 'list': {
        const flags = parseFlags(args.slice(1), COMMAND_FLAG_SPEC.list)
        await commandList(projectRoot, flags, runtime)
        break
      }
      case 'status':
        parseFlags(args.slice(1), COMMAND_FLAG_SPEC.status)
        await commandStatus(projectRoot, runtime)
        break
      case 'verify': {
        const target = args[1]
        if (!target || target.startsWith('--')) {
          throw new CliError('verify 命令需要 target（目前支援：web）', {
            showHelp: true,
          })
        }
        const flags = parseFlags(args.slice(2), COMMAND_FLAG_SPEC.verify)
        await commandVerify(projectRoot, target, flags, runtime)
        break
      }
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
  commandVerify,
}

if (require.main === module) {
  void runCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode
  })
}

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const { runCli } = require('./confession.js')

const STORAGE_FILES = [
  'config.json',
  'vulnerabilities.json',
  'vulnerability-events.json',
  'scan-tasks.json',
  'advice-snapshots.json',
  'advice-decisions.json',
  'analysis-cache.json',
  'meta.json',
]

function createBufferStream() {
  let content = ''

  return {
    write(chunk) {
      content += String(chunk)
      return true
    },
    toString() {
      return content
    },
  }
}

function createJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload
    },
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload)
    },
  }
}

function createSpawnChild(options = {}) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => {}

  process.nextTick(() => {
    if (options.error) {
      child.emit('error', options.error)
      return
    }

    if (options.stdout) {
      child.stdout.emit('data', options.stdout)
    }
    if (options.stderr) {
      child.stderr.emit('data', options.stderr)
    }
    child.emit('close', options.code ?? 0)
  })

  return child
}

async function createTempProject(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'confession-cli-test-'))
  await fs.writeFile(path.join(dir, 'sample.ts'), 'const answer = 42\n', 'utf8')
  t.after(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })
  return dir
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8')
  return JSON.parse(raw)
}

function createRuntime(cwd, options = {}) {
  const stdout = createBufferStream()
  const stderr = createBufferStream()

  return {
    stdout,
    stderr,
    runtime: {
      cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdout,
      stderr,
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
      spawnImpl: options.spawnImpl,
      now: options.now,
      registerSigint: options.registerSigint,
      pollIntervalMs: options.pollIntervalMs,
      scanTimeoutMs: options.scanTimeoutMs,
    },
  }
}

test('init 會建立儲存檔案且重跑維持冪等', async (t) => {
  const projectRoot = await createTempProject(t)
  const first = createRuntime(projectRoot)
  const firstCode = await runCli(['init'], first.runtime)

  assert.equal(firstCode, 0)

  const confessionDir = path.join(projectRoot, '.confession')
  for (const fileName of STORAGE_FILES) {
    const fullPath = path.join(confessionDir, fileName)
    await fs.access(fullPath)
  }

  const beforeMeta = await readJson(path.join(confessionDir, 'meta.json'))

  const second = createRuntime(projectRoot)
  const secondCode = await runCli(['init'], second.runtime)
  assert.equal(secondCode, 0)

  const afterMeta = await readJson(path.join(confessionDir, 'meta.json'))
  assert.deepEqual(afterMeta, beforeMeta)
})

test('list 支援篩選，無結果時回傳固定訊息', async (t) => {
  const projectRoot = await createTempProject(t)
  const first = createRuntime(projectRoot)
  assert.equal(await runCli(['init'], first.runtime), 0)

  const vulnerabilitiesPath = path.join(
    projectRoot,
    '.confession',
    'vulnerabilities.json'
  )

  await fs.writeFile(
    vulnerabilitiesPath,
    `${JSON.stringify(
      [
        {
          id: 'vuln-1',
          severity: 'high',
          status: 'open',
          filePath: 'src/a.ts',
          line: 10,
          type: 'sql_injection',
          description: 'token 直接拼接 SQL',
          updatedAt: '2026-03-10T00:00:00.000Z',
        },
        {
          id: 'vuln-2',
          severity: 'low',
          status: 'fixed',
          filePath: 'src/b.ts',
          line: 20,
          type: 'hardcoded_secret',
          description: '已處理',
          updatedAt: '2026-03-09T00:00:00.000Z',
        },
      ],
      null,
      2
    )}\n`,
    'utf8'
  )

  const filtered = createRuntime(projectRoot)
  const filteredCode = await runCli(
    ['list', '--status', 'open', '--severity', 'high', '--search', 'token'],
    filtered.runtime
  )
  assert.equal(filteredCode, 0)
  assert.match(filtered.stdout.toString(), /vuln-1/)
  assert.doesNotMatch(filtered.stdout.toString(), /vuln-2/)

  const empty = createRuntime(projectRoot)
  const emptyCode = await runCli(
    ['list', '--status', 'ignored', '--search', 'not-exist'],
    empty.runtime
  )
  assert.equal(emptyCode, 0)
  assert.match(empty.stdout.toString(), /沒有符合條件的漏洞/)
})

test('status 會輸出最新掃描與 fallback 摘要', async (t) => {
  const projectRoot = await createTempProject(t)
  const first = createRuntime(projectRoot)
  assert.equal(await runCli(['init'], first.runtime), 0)

  const confessionDir = path.join(projectRoot, '.confession')
  await fs.writeFile(
    path.join(confessionDir, 'vulnerabilities.json'),
    `${JSON.stringify(
      [
        { status: 'open', severity: 'critical' },
        { status: 'open', severity: 'high' },
        { status: 'fixed', severity: 'low' },
      ],
      null,
      2
    )}\n`,
    'utf8'
  )
  await fs.writeFile(
    path.join(confessionDir, 'scan-tasks.json'),
    `${JSON.stringify(
      [
        {
          id: 'task-old',
          status: 'completed',
          engineMode: 'agentic',
          fallbackUsed: false,
          updatedAt: '2026-03-09T00:00:00.000Z',
        },
        {
          id: 'task-new',
          status: 'failed',
          engineMode: 'baseline',
          fallbackUsed: true,
          updatedAt: '2026-03-10T00:00:00.000Z',
        },
      ],
      null,
      2
    )}\n`,
    'utf8'
  )

  const runtime = createRuntime(projectRoot)
  const code = await runCli(['status'], runtime.runtime)
  assert.equal(code, 0)

  const output = runtime.stdout.toString()
  assert.match(output, /vulnerabilities: total=3 open=2 fixed=1 ignored=0/)
  assert.match(
    output,
    /latest scan: id=task-new status=failed engine=baseline fallback=yes/
  )
})

test('參數驗證：未知旗標與非法列舉值會失敗', async (t) => {
  const projectRoot = await createTempProject(t)

  const unknown = createRuntime(projectRoot)
  assert.equal(await runCli(['init', '--x', '1'], unknown.runtime), 1)
  assert.match(unknown.stderr.toString(), /未知參數：--x/)

  const depth = createRuntime(projectRoot)
  assert.equal(await runCli(['scan', '--depth', 'extreme'], depth.runtime), 1)
  assert.match(
    depth.stderr.toString(),
    /參數 --depth 僅接受：quick\|standard\|deep/
  )

  const status = createRuntime(projectRoot)
  assert.equal(await runCli(['list', '--status', 'all'], status.runtime), 1)
  assert.match(
    status.stderr.toString(),
    /參數 --status 僅接受：open\|fixed\|ignored/
  )

  const severity = createRuntime(projectRoot)
  assert.equal(
    await runCli(['list', '--severity', 'urgent'], severity.runtime),
    1
  )
  assert.match(
    severity.stderr.toString(),
    /參數 --severity 僅接受：critical\|high\|medium\|low\|info/
  )
})

test('verify web 會執行 ZAP 與 Nuclei 並輸出摘要', async (t) => {
  const projectRoot = await createTempProject(t)
  const spawned = []

  const runtime = createRuntime(projectRoot, {
    spawnImpl: (command, args) => {
      spawned.push({ command, args })
      return createSpawnChild({ code: 0 })
    },
  })

  const code = await runCli(
    ['verify', 'web', '--url', 'https://example.com'],
    runtime.runtime
  )

  assert.equal(code, 0)
  assert.equal(spawned.length, 2)
  assert.match(runtime.stdout.toString(), /DAST 驗證完成/)

  const dastDir = path.join(projectRoot, '.confession', 'dast')
  const files = await fs.readdir(dastDir)
  const summaryName = files.find((name) => name.startsWith('summary-'))
  assert.ok(summaryName)

  const summary = await readJson(path.join(dastDir, summaryName))
  assert.equal(summary.target, 'web')
  assert.equal(summary.tools.zap.status, 'ok')
  assert.equal(summary.tools.nuclei.status, 'ok')
})

test('verify web 在工具皆不存在時回傳失敗', async (t) => {
  const projectRoot = await createTempProject(t)

  const runtime = createRuntime(projectRoot, {
    spawnImpl: () => {
      const error = new Error('not found')
      error.code = 'ENOENT'
      return createSpawnChild({ error })
    },
  })

  const code = await runCli(
    ['verify', 'web', '--url', 'https://example.com'],
    runtime.runtime
  )

  assert.equal(code, 1)
  assert.match(runtime.stderr.toString(), /找不到可執行的 DAST 工具/)
})

test('scan 成功完成', async (t) => {
  const projectRoot = await createTempProject(t)
  let statusCalls = 0
  let cancelCalled = false

  const runtime = createRuntime(projectRoot, {
    fetchImpl: async (url, init = {}) => {
      if (url.endsWith('/api/scan') && init.method === 'POST') {
        return createJsonResponse(201, { taskId: 'task-1' })
      }

      if (url.endsWith('/api/scan/status/task-1')) {
        statusCalls += 1
        if (statusCalls === 1) {
          return createJsonResponse(200, {
            id: 'task-1',
            status: 'running',
            scannedFiles: 0,
            totalFiles: 1,
            progress: 0,
          })
        }
        return createJsonResponse(200, {
          id: 'task-1',
          status: 'completed',
          scannedFiles: 1,
          totalFiles: 1,
          progress: 1,
        })
      }

      if (url.endsWith('/api/scan/cancel/task-1') && init.method === 'POST') {
        cancelCalled = true
        return createJsonResponse(202, {})
      }

      return createJsonResponse(404, { error: 'not found' })
    },
    sleepImpl: async () => {},
    pollIntervalMs: 1,
    scanTimeoutMs: 5_000,
  })

  const code = await runCli(
    ['scan', '--api', 'http://mock-server', '--depth', 'standard'],
    runtime.runtime
  )

  assert.equal(code, 0)
  assert.equal(cancelCalled, false)
  assert.match(runtime.stdout.toString(), /掃描完成/)
})

test('scan 任務失敗時回傳非 0', async (t) => {
  const projectRoot = await createTempProject(t)

  const runtime = createRuntime(projectRoot, {
    fetchImpl: async (url, init = {}) => {
      if (url.endsWith('/api/scan') && init.method === 'POST') {
        return createJsonResponse(201, { taskId: 'task-2' })
      }

      if (url.endsWith('/api/scan/status/task-2')) {
        return createJsonResponse(200, {
          id: 'task-2',
          status: 'failed',
          errorMessage: '模擬錯誤',
          scannedFiles: 0,
          totalFiles: 1,
          progress: 0,
        })
      }

      return createJsonResponse(404, { error: 'not found' })
    },
    sleepImpl: async () => {},
    pollIntervalMs: 1,
    scanTimeoutMs: 5_000,
  })

  const code = await runCli(
    ['scan', '--api', 'http://mock-server'],
    runtime.runtime
  )
  assert.equal(code, 1)
  assert.match(runtime.stderr.toString(), /掃描失敗：模擬錯誤/)
})

test('scan 逾時會主動 cancel 任務', async (t) => {
  const projectRoot = await createTempProject(t)
  let currentTime = 0
  let cancelCalled = false

  const runtime = createRuntime(projectRoot, {
    fetchImpl: async (url, init = {}) => {
      if (url.endsWith('/api/scan') && init.method === 'POST') {
        return createJsonResponse(201, { taskId: 'task-3' })
      }

      if (url.endsWith('/api/scan/status/task-3')) {
        return createJsonResponse(200, {
          id: 'task-3',
          status: 'running',
          scannedFiles: 0,
          totalFiles: 1,
          progress: 0.1,
        })
      }

      if (url.endsWith('/api/scan/cancel/task-3') && init.method === 'POST') {
        cancelCalled = true
        return createJsonResponse(202, {})
      }

      return createJsonResponse(404, { error: 'not found' })
    },
    now: () => currentTime,
    sleepImpl: async () => {
      currentTime += 60
    },
    pollIntervalMs: 1,
    scanTimeoutMs: 100,
  })

  const code = await runCli(
    ['scan', '--api', 'http://mock-server'],
    runtime.runtime
  )
  assert.equal(code, 1)
  assert.equal(cancelCalled, true)
  assert.match(runtime.stderr.toString(), /掃描等待逾時/)
})

test('scan 收到 SIGINT 會主動 cancel 任務', async (t) => {
  const projectRoot = await createTempProject(t)
  let cancelCalled = false
  let sigintHandler = null
  let statusCalls = 0

  const runtime = createRuntime(projectRoot, {
    fetchImpl: async (url, init = {}) => {
      if (url.endsWith('/api/scan') && init.method === 'POST') {
        return createJsonResponse(201, { taskId: 'task-4' })
      }

      if (url.endsWith('/api/scan/status/task-4')) {
        statusCalls += 1
        if (statusCalls === 1 && sigintHandler) {
          sigintHandler()
        }
        return createJsonResponse(200, {
          id: 'task-4',
          status: 'running',
          scannedFiles: 0,
          totalFiles: 1,
          progress: 0.1,
        })
      }

      if (url.endsWith('/api/scan/cancel/task-4') && init.method === 'POST') {
        cancelCalled = true
        return createJsonResponse(202, {})
      }

      return createJsonResponse(404, { error: 'not found' })
    },
    sleepImpl: async () => {},
    pollIntervalMs: 1,
    scanTimeoutMs: 10_000,
    registerSigint: (handler) => {
      sigintHandler = handler
      return () => {
        sigintHandler = null
      }
    },
  })

  const code = await runCli(
    ['scan', '--api', 'http://mock-server'],
    runtime.runtime
  )
  assert.equal(code, 130)
  assert.equal(cancelCalled, true)
  assert.match(runtime.stderr.toString(), /掃描已中斷/)
})

#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_OPTIONS = {
  apiBaseUrl: 'http://localhost:3000',
  sizes: [1000, 3000],
  runs: 5,
  warmupRuns: 1,
  pollIntervalMs: 250,
  statusClients: 4,
  depth: 'quick',
  engineMode: 'baseline',
  outputPath: null,
}

function parsePositiveInteger(name, raw) {
  const value = Number.parseInt(String(raw), 10)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`參數 --${name} 需為正整數（目前為 ${raw}）`)
  }
  return value
}

function parseNonNegativeInteger(name, raw) {
  const value = Number.parseInt(String(raw), 10)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`參數 --${name} 需為非負整數（目前為 ${raw}）`)
  }
  return value
}

function parseSizes(raw) {
  const values = String(raw)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => parsePositiveInteger('sizes', item))
  if (values.length === 0) {
    throw new Error('參數 --sizes 需提供至少一個檔案數量，例如 1000,3000')
  }
  return values
}

function parseArgs(argv) {
  const options = { ...DEFAULT_OPTIONS }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === '--') continue
    if (!token.startsWith('--')) {
      throw new Error(`未知參數：${token}`)
    }

    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      throw new Error(`參數 --${key} 需要值`)
    }
    index += 1

    if (key === 'api') {
      options.apiBaseUrl = next
      continue
    }
    if (key === 'sizes') {
      options.sizes = parseSizes(next)
      continue
    }
    if (key === 'runs') {
      options.runs = parsePositiveInteger('runs', next)
      continue
    }
    if (key === 'warmup-runs') {
      options.warmupRuns = parseNonNegativeInteger('warmup-runs', next)
      continue
    }
    if (key === 'poll-interval-ms') {
      options.pollIntervalMs = parsePositiveInteger('poll-interval-ms', next)
      continue
    }
    if (key === 'status-clients') {
      options.statusClients = parsePositiveInteger('status-clients', next)
      continue
    }
    if (key === 'depth') {
      if (!['quick', 'standard', 'deep'].includes(next)) {
        throw new Error(`參數 --depth 僅接受 quick|standard|deep（目前為 ${next}）`)
      }
      options.depth = next
      continue
    }
    if (key === 'engine-mode') {
      if (!['baseline', 'agentic_beta'].includes(next)) {
        throw new Error(`參數 --engine-mode 僅接受 baseline|agentic_beta（目前為 ${next}）`)
      }
      options.engineMode = next
      continue
    }
    if (key === 'output') {
      options.outputPath = next
      continue
    }

    throw new Error(`未知參數：--${key}`)
  }

  return options
}

function percentile(values, ratio) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const rawIndex = Math.ceil(sorted.length * ratio) - 1
  const index = Math.max(0, Math.min(sorted.length - 1, rawIndex))
  return sorted[index]
}

function average(values) {
  if (values.length === 0) return 0
  return values.reduce((sum, current) => sum + current, 0) / values.length
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl).replace(/\/+$/, '')
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson(baseUrl, endpoint, init) {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${endpoint}`, init)
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${endpoint} 請求失敗 (${response.status}) ${text}`)
  }
  return response.json()
}

function buildSyntheticFiles(fileCount, suiteId, runId) {
  const files = []

  for (let index = 0; index < fileCount; index += 1) {
    const suffix = String(index).padStart(5, '0')
    const variable = `value_${suiteId}_${runId}_${index}`
    files.push({
      path: `/benchmark/src/file-${suffix}.ts`,
      content: `export const ${variable} = ${index};\nexport function f_${index}(x: number) { return x + ${variable}; }\n`,
      language: 'typescript',
    })
  }

  return files
}

async function runSingleScan(options, fileCount, runLabel) {
  const files = buildSyntheticFiles(fileCount, fileCount, runLabel)
  const created = await fetchJson(options.apiBaseUrl, '/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files,
      depth: options.depth,
      engineMode: options.engineMode,
      includeLlmScan: false,
      forceRescan: true,
      scanScope: 'workspace',
      workspaceSnapshotComplete: true,
      workspaceRoots: ['/benchmark'],
    }),
  })

  const taskId = created?.taskId
  if (typeof taskId !== 'string' || taskId.length === 0) {
    throw new Error('建立掃描任務失敗：未取得 taskId')
  }

  let done = false
  let failedMessage = null
  let primaryRequests = 0
  let extraRequests = 0

  const startMs = Date.now()
  const extraPollers = Array.from({ length: Math.max(0, options.statusClients - 1) }, () =>
    (async () => {
      while (!done) {
        await sleep(options.pollIntervalMs)
        if (done) break
        try {
          await fetchJson(options.apiBaseUrl, `/api/scan/status/${encodeURIComponent(taskId)}`)
          extraRequests += 1
        } catch {
          // 壓測中斷線不影響主流程判定，由主輪詢負責狀態收斂。
        }
      }
    })(),
  )

  try {
    while (true) {
      await sleep(options.pollIntervalMs)

      const status = await fetchJson(
        options.apiBaseUrl,
        `/api/scan/status/${encodeURIComponent(taskId)}`,
      )
      primaryRequests += 1

      if (status.status === 'completed') {
        done = true
        break
      }

      if (status.status === 'failed') {
        done = true
        failedMessage =
          typeof status.errorMessage === 'string' && status.errorMessage.trim().length > 0
            ? status.errorMessage.trim()
            : 'unknown error'
        break
      }
    }
  } finally {
    done = true
    await Promise.all(extraPollers)
  }

  if (failedMessage) {
    throw new Error(`掃描任務失敗（taskId=${taskId}）：${failedMessage}`)
  }

  const durationMs = Date.now() - startMs
  const statusRequests = primaryRequests + extraRequests
  const statusApiRps = durationMs > 0 ? statusRequests / (durationMs / 1000) : 0

  return {
    taskId,
    durationMs,
    statusRequests,
    statusApiRps,
  }
}

function defaultOutputPath() {
  const now = new Date()
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate(),
  ).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(
    now.getMinutes(),
  ).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
  return path.resolve(process.cwd(), `scan-benchmark-${stamp}.json`)
}

async function runBenchmark(options) {
  await fetchJson(options.apiBaseUrl, '/api/health')
  const outputPath = options.outputPath ? path.resolve(options.outputPath) : defaultOutputPath()

  const report = {
    generatedAt: new Date().toISOString(),
    options: {
      ...options,
      outputPath,
    },
    suites: [],
  }

  process.stdout.write(
    `開始掃描基準：sizes=${options.sizes.join(',')} runs=${options.runs} warmup=${options.warmupRuns} engine=${options.engineMode}\n`,
  )

  for (const fileCount of options.sizes) {
    process.stdout.write(`\n== 檔案數 ${fileCount} ==\n`)

    for (let warmup = 1; warmup <= options.warmupRuns; warmup += 1) {
      process.stdout.write(`[warmup ${warmup}/${options.warmupRuns}] 執行中...\n`)
      await runSingleScan(options, fileCount, `warmup-${warmup}`)
    }

    const runs = []
    for (let run = 1; run <= options.runs; run += 1) {
      process.stdout.write(`[run ${run}/${options.runs}] 執行中...\n`)
      const result = await runSingleScan(options, fileCount, `run-${run}`)
      runs.push({ run, ...result })
      process.stdout.write(
        `  duration=${Math.round(result.durationMs)}ms status_rps=${result.statusApiRps.toFixed(
          2,
        )}\n`,
      )
    }

    const durations = runs.map((run) => run.durationMs)
    const rpsValues = runs.map((run) => run.statusApiRps)

    const aggregates = {
      scan_workspace_p95_ms: Math.round(percentile(durations, 0.95)),
      scan_workspace_avg_ms: Math.round(average(durations)),
      status_api_rps_p95: Number(percentile(rpsValues, 0.95).toFixed(2)),
      status_api_rps_avg: Number(average(rpsValues).toFixed(2)),
    }

    report.suites.push({
      fileCount,
      runs,
      aggregates,
    })

    process.stdout.write(
      `  => p95=${aggregates.scan_workspace_p95_ms}ms avg=${aggregates.scan_workspace_avg_ms}ms status_rps_p95=${aggregates.status_api_rps_p95}\n`,
    )
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  process.stdout.write(`\n基準報告已輸出：${outputPath}\n`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  try {
    await runBenchmark(options)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`[benchmark] ${message}\n`)
    process.exitCode = 1
  }
}

await main()

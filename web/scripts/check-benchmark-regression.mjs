#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import path from 'node:path'

function parseArgs(argv) {
  const options = {
    baseline: '',
    current: '',
    latencyThreshold: 0.15,
    rpsThreshold: 0.2,
    enforceAfter: '',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      throw new Error(`未知參數：${token}`)
    }

    const key = token.slice(2)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`參數 --${key} 需要值`)
    }
    index += 1

    if (key === 'baseline') {
      options.baseline = value
      continue
    }
    if (key === 'current') {
      options.current = value
      continue
    }
    if (key === 'latency-threshold') {
      options.latencyThreshold = Number.parseFloat(value)
      continue
    }
    if (key === 'rps-threshold') {
      options.rpsThreshold = Number.parseFloat(value)
      continue
    }
    if (key === 'enforce-after') {
      options.enforceAfter = value
      continue
    }

    throw new Error(`未知參數：--${key}`)
  }

  if (!options.baseline || !options.current) {
    throw new Error('必須提供 --baseline 與 --current')
  }

  return options
}

function normalizeSuites(report) {
  const suites = Array.isArray(report?.suites) ? report.suites : []
  const map = new Map()

  for (const suite of suites) {
    const fileCount = Number(suite?.fileCount)
    if (!Number.isFinite(fileCount)) continue
    map.set(fileCount, suite)
  }

  return map
}

function compareSuite(fileCount, baselineSuite, currentSuite, thresholds) {
  const baseline = baselineSuite?.aggregates ?? {}
  const current = currentSuite?.aggregates ?? {}
  const findings = []

  const baselineLatency = Number(baseline.scan_workspace_p95_ms)
  const currentLatency = Number(current.scan_workspace_p95_ms)
  if (Number.isFinite(baselineLatency) && Number.isFinite(currentLatency) && baselineLatency > 0) {
    const ratio = (currentLatency - baselineLatency) / baselineLatency
    if (ratio > thresholds.latencyThreshold) {
      findings.push(
        `fileCount=${fileCount} scan_workspace_p95_ms 惡化 ${(ratio * 100).toFixed(2)}% ` +
          `(baseline=${baselineLatency}, current=${currentLatency})`,
      )
    }
  }

  const baselineRps = Number(baseline.status_api_rps_p95)
  const currentRps = Number(current.status_api_rps_p95)
  if (Number.isFinite(baselineRps) && Number.isFinite(currentRps) && baselineRps > 0) {
    const ratio = (baselineRps - currentRps) / baselineRps
    if (ratio > thresholds.rpsThreshold) {
      findings.push(
        `fileCount=${fileCount} status_api_rps_p95 惡化 ${(ratio * 100).toFixed(2)}% ` +
          `(baseline=${baselineRps}, current=${currentRps})`,
      )
    }
  }

  return findings
}

function resolveWarnOnly(enforceAfterRaw) {
  if (!enforceAfterRaw) return true
  const now = new Date()
  const enforceAfter = new Date(enforceAfterRaw)
  if (Number.isNaN(enforceAfter.getTime())) return true
  return now.getTime() < enforceAfter.getTime()
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const [baselineRaw, currentRaw] = await Promise.all([
    readFile(path.resolve(options.baseline), 'utf8'),
    readFile(path.resolve(options.current), 'utf8'),
  ])

  const baseline = JSON.parse(baselineRaw)
  const current = JSON.parse(currentRaw)

  const baselineSuites = normalizeSuites(baseline)
  const currentSuites = normalizeSuites(current)
  const fileCounts = Array.from(new Set([...baselineSuites.keys(), ...currentSuites.keys()])).sort(
    (left, right) => left - right,
  )

  const findings = []
  for (const fileCount of fileCounts) {
    const suiteFindings = compareSuite(
      fileCount,
      baselineSuites.get(fileCount),
      currentSuites.get(fileCount),
      {
        latencyThreshold: options.latencyThreshold,
        rpsThreshold: options.rpsThreshold,
      },
    )
    findings.push(...suiteFindings)
  }

  const warnOnly = resolveWarnOnly(options.enforceAfter)

  process.stdout.write(
    `[benchmark-regression] ${JSON.stringify({
      warnOnly,
      findingCount: findings.length,
      findings,
      latencyThreshold: options.latencyThreshold,
      rpsThreshold: options.rpsThreshold,
      enforceAfter: options.enforceAfter || null,
    })}\n`,
  )

  if (findings.length > 0 && !warnOnly) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[benchmark-regression] ${message}\n`)
  process.exitCode = 1
})

#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildSarifPayloadWithGuards } from '../src/server/sarif-generator.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function parseArgs(argv) {
  const options = {
    output: '',
    fixture: path.join(__dirname, 'code-scanning-fixture.json'),
    engineMode: 'baseline',
    depth: 'standard',
    maxResults: 5000,
    maxBytes: 9_000_000,
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

    if (key === 'output') {
      options.output = value
      continue
    }
    if (key === 'fixture') {
      options.fixture = value
      continue
    }
    if (key === 'engine-mode') {
      if (value === 'agentic_beta') {
        options.engineMode = 'agentic'
        continue
      }
      if (!['baseline', 'agentic'].includes(value)) {
        throw new Error(
          `--engine-mode 僅接受 baseline|agentic（目前 ${value}）`
        )
      }
      options.engineMode = value
      continue
    }
    if (key === 'depth') {
      if (!['quick', 'standard', 'deep'].includes(value)) {
        throw new Error(`--depth 僅接受 quick|standard|deep（目前 ${value}）`)
      }
      options.depth = value
      continue
    }
    if (key === 'max-results') {
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--max-results 需為正整數（目前 ${value}）`)
      }
      options.maxResults = parsed
      continue
    }
    if (key === 'max-bytes') {
      const parsed = Number.parseInt(value, 10)
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`--max-bytes 需為正整數（目前 ${value}）`)
      }
      options.maxBytes = parsed
      continue
    }

    throw new Error(`未知參數：--${key}`)
  }

  if (!options.output) {
    throw new Error('缺少 --output')
  }

  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const fixtureRaw = await readFile(path.resolve(options.fixture), 'utf8')
  const fixture = JSON.parse(fixtureRaw)
  const items = Array.isArray(fixture.items) ? fixture.items : []

  const category = `confession-${options.engineMode}-${options.depth}`
  const built = buildSarifPayloadWithGuards({
    items,
    reportSchemaVersion: '2.0.0',
    exportedAt: new Date().toISOString(),
    filters: {
      source: 'ci-fixture',
    },
    category,
    maxResults: options.maxResults,
    maxBytes: options.maxBytes,
  })

  const outputPath = path.resolve(options.output)
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(
    outputPath,
    `${JSON.stringify(built.payload, null, 2)}\n`,
    'utf8'
  )

  const summary = {
    category,
    resultCount: built.resultCount,
    byteSize: built.byteSize,
    warningCount: built.warnings.length,
    warnings: built.warnings,
  }

  process.stdout.write(`[sarif-ci] ${JSON.stringify(summary)}\n`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`[sarif-ci] ${message}\n`)
  process.exitCode = 1
})

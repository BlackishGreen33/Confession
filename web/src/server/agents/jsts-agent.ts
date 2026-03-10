import fsSync from 'node:fs'
import { cpus } from 'node:os'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

import { analyzeJsTs } from '@server/analyzers/jsts'
import { keywordHitsToInteractionPoints, scanKeywords } from '@server/analyzers/keywords'

import type { InteractionPoint } from '@/libs/types'

/** 單一檔案輸入 */
export interface JsTsFileInput {
  path: string
  content: string
  language: 'javascript' | 'typescript'
}

const JSTS_ANALYZER_SOURCE_PATH = fileURLToPath(
  new URL('../analyzers/jsts.ts', import.meta.url),
)
const DEFAULT_AST_WORKER_POOL_SIZE = Math.max(1, Math.min(4, cpus().length - 1))

const JSTS_AST_WORKER_SCRIPT = String.raw`
const fs = require('node:fs')
const ts = require('typescript')
const { parentPort, workerData } = require('node:worker_threads')

function loadAnalyzeJsTs() {
  const source = fs.readFileSync(workerData.analyzerSourcePath, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText

  const mod = { exports: {} }
  const fn = new Function('require', 'module', 'exports', transpiled)
  fn(require, mod, mod.exports)
  if (typeof mod.exports.analyzeJsTs !== 'function') {
    throw new Error('無法載入 analyzeJsTs')
  }
  return mod.exports.analyzeJsTs
}

const analyzeJsTs = loadAnalyzeJsTs()

parentPort.on('message', (payload) => {
  const jobId = payload && typeof payload.jobId === 'number' ? payload.jobId : -1
  try {
    const file = payload.file
    const points = analyzeJsTs(file.content, file.path, file.language)
    parentPort.postMessage({ jobId, ok: true, points })
  } catch (error) {
    parentPort.postMessage({
      jobId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
`

interface WorkerTaskResult {
  jobId: number
  ok: boolean
  points?: InteractionPoint[]
  error?: string
}

/**
 * JS/TS Agent：對一組檔案執行 AST 靜態分析 + 關鍵詞掃描，
 * 合併去重後回傳 InteractionPoint[]。
 */
export async function analyzeJsTsFiles(files: JsTsFileInput[]): Promise<InteractionPoint[]> {
  if (files.length === 0) return []

  const workerPoolSize = resolveAstWorkerPoolSize(files.length)
  const useWorkers = shouldUseAstWorkerPool(files.length, workerPoolSize)

  if (!useWorkers) {
    return analyzeSequential(files)
  }

  try {
    const astPointsByFile = await analyzeAstWithWorkerPool(files, workerPoolSize)
    return mergePointsWithKeywordScan(files, astPointsByFile)
  } catch {
    // worker 路徑失敗時回退單執行緒，避免影響掃描可用性。
    return analyzeSequential(files)
  }
}

function analyzeSequential(files: JsTsFileInput[]): InteractionPoint[] {
  const results: InteractionPoint[] = []

  for (const file of files) {
    // AST 靜態分析
    const astPoints = analyzeJsTs(file.content, file.path, file.language)

    // 關鍵詞掃描
    const keywordHits = scanKeywords(file.content)
    const keywordPoints = keywordHitsToInteractionPoints(keywordHits, file.path, file.language)

    // 去重：同一位置（filePath + line + column）只保留信心度較高的
    const merged = deduplicatePoints([...astPoints, ...keywordPoints])
    results.push(...merged)
  }

  return results
}

function shouldUseAstWorkerPool(fileCount: number, workerPoolSize: number): boolean {
  if (fileCount < 2) return false
  if (workerPoolSize <= 1) return false
  if (!fsSync.existsSync(JSTS_ANALYZER_SOURCE_PATH)) return false
  if (process.env.CONFESSION_DISABLE_JSTS_WORKERS === '1') return false
  return true
}

function resolveAstWorkerPoolSize(fileCount: number): number {
  const configured = process.env.CONFESSION_JSTS_WORKER_POOL_SIZE
  if (typeof configured === 'string' && configured.trim().length > 0) {
    const parsed = Number.parseInt(configured.trim(), 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.max(1, Math.min(parsed, fileCount))
    }
  }
  return Math.max(1, Math.min(DEFAULT_AST_WORKER_POOL_SIZE, fileCount))
}

async function analyzeAstWithWorkerPool(
  files: JsTsFileInput[],
  poolSize: number,
): Promise<InteractionPoint[][]> {
  const workers = Array.from({ length: poolSize }, () =>
    new Worker(JSTS_AST_WORKER_SCRIPT, {
      eval: true,
      workerData: {
        analyzerSourcePath: JSTS_ANALYZER_SOURCE_PATH,
      },
    }),
  )

  const astPointsByFile: InteractionPoint[][] = new Array(files.length)
  let cursor = 0

  try {
    await Promise.all(
      workers.map(async (worker) => {
        while (true) {
          const index = cursor
          cursor += 1
          if (index >= files.length) return

          const points = await runWorkerTask(worker, index, files[index])
          astPointsByFile[index] = points
        }
      }),
    )
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate().catch(() => 0)))
  }

  return astPointsByFile
}

function runWorkerTask(
  worker: Worker,
  jobId: number,
  file: JsTsFileInput,
): Promise<InteractionPoint[]> {
  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      worker.off('message', onMessage)
      worker.off('error', onError)
      worker.off('exit', onExit)
    }

    const settleResolve = (points: InteractionPoint[]) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(points)
    }

    const settleReject = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }

    const onMessage = (message: WorkerTaskResult) => {
      if (!message || message.jobId !== jobId) return

      if (message.ok) {
        settleResolve(Array.isArray(message.points) ? message.points : [])
        return
      }

      settleReject(new Error(message.error ?? 'JS/TS AST worker 執行失敗'))
    }

    const onError = (error: Error) => {
      settleReject(error)
    }

    const onExit = (code: number) => {
      if (code === 0) return
      settleReject(new Error(`JS/TS AST worker 非預期結束（code=${code}）`))
    }

    worker.on('message', onMessage)
    worker.on('error', onError)
    worker.on('exit', onExit)
    worker.postMessage({ jobId, file })
  })
}

function mergePointsWithKeywordScan(
  files: JsTsFileInput[],
  astPointsByFile: InteractionPoint[][],
): InteractionPoint[] {
  const mergedAll: InteractionPoint[] = []

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    const astPoints = astPointsByFile[index] ?? []
    const keywordHits = scanKeywords(file.content)
    const keywordPoints = keywordHitsToInteractionPoints(
      keywordHits,
      file.path,
      file.language,
    )
    const merged = deduplicatePoints([...astPoints, ...keywordPoints])
    mergedAll.push(...merged)
  }

  return mergedAll
}

/** 信心度排序權重 */
const CONFIDENCE_WEIGHT: Record<InteractionPoint['confidence'], number> = {
  high: 3,
  medium: 2,
  low: 1,
}

/**
 * 依位置（filePath + line + column）去重，
 * 同一位置保留信心度較高的交互點。
 */
function deduplicatePoints(points: InteractionPoint[]): InteractionPoint[] {
  const map = new Map<string, InteractionPoint>()

  for (const point of points) {
    const key = `${point.filePath}:${point.line}:${point.column}`
    const existing = map.get(key)

    if (!existing || CONFIDENCE_WEIGHT[point.confidence] > CONFIDENCE_WEIGHT[existing.confidence]) {
      map.set(key, point)
    }
  }

  return Array.from(map.values())
}

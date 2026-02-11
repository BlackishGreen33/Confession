/**
 * Go WASM AST 分析器橋接層。
 * 載入 go-analyzer.wasm 並透過 globalThis.analyzeGo 呼叫 Go AST 分析。
 * 使用懶載入單例模式：首次呼叫時初始化 WASM，後續呼叫重複使用。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInThisContext } from 'node:vm'

import type { InteractionPoint } from '@/libs/types'

// ---------------------------------------------------------------------------
// 型別定義
// ---------------------------------------------------------------------------

/** Go WASM 分析回應格式（對應 Go 端 analyzeResponse） */
interface GoAnalyzeResponse {
  points: InteractionPoint[]
  error?: string
}

/** Go WASM 執行環境（wasm_exec.js 注入 globalThis.Go） */
interface GoRuntime {
  new (): GoInstance
}

interface GoInstance {
  importObject: WebAssembly.Imports
  run: (instance: WebAssembly.Instance) => Promise<void>
}

// ---------------------------------------------------------------------------
// 全域擴充：Go WASM 注入的函式
// ---------------------------------------------------------------------------

/** globalThis 上由 wasm_exec.js 與 Go WASM 動態注入的屬性 */
interface GoWasmGlobals {
  Go?: GoRuntime
  analyzeGo?: (input: string) => string
}

// ---------------------------------------------------------------------------
// 單例狀態
// ---------------------------------------------------------------------------

let initialized = false
let initPromise: Promise<void> | null = null

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

/**
 * 載入 wasm_exec.js 執行環境並實例化 go-analyzer.wasm。
 * 僅在首次呼叫時執行，後續呼叫直接返回。
 */
async function ensureInitialized(): Promise<void> {
  if (initialized) return
  if (initPromise) return initPromise

  initPromise = doInit()
  await initPromise
}

async function doInit(): Promise<void> {
  const g = globalThis as unknown as GoWasmGlobals

  // 1. 載入 wasm_exec.js — 將 Go 類別注入 globalThis
  const wasmExecPath = join(process.cwd(), 'public', 'wasm_exec.js')
  const wasmExecCode = readFileSync(wasmExecPath, 'utf-8')
  runInThisContext(wasmExecCode, { filename: 'wasm_exec.js' })

  if (!g.Go) {
    throw new Error('wasm_exec.js 載入失敗：globalThis.Go 未定義')
  }

  // 2. 載入 WASM 二進位檔
  const wasmPath = join(process.cwd(), 'public', 'go-analyzer.wasm')
  const wasmBuffer = readFileSync(wasmPath)

  // 3. 實例化 Go WASM
  const go = new g.Go()
  const { instance } = await WebAssembly.instantiate(wasmBuffer, go.importObject)

  // 4. 啟動 Go 程式（非同步，不 await — Go main 會 select{} 持續運行）
  void go.run(instance)

  // 5. 確認 analyzeGo 函式已註冊到 globalThis
  if (typeof g.analyzeGo !== 'function') {
    throw new Error('Go WASM 初始化失敗：globalThis.analyzeGo 未註冊')
  }

  initialized = true
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

/**
 * 透過 Go WASM 分析單一 Go 原始碼檔案。
 * @param filePath 檔案路徑
 * @param content 檔案內容
 * @returns 偵測到的交互點列表
 */
export async function analyzeGoWasm(
  filePath: string,
  content: string,
): Promise<InteractionPoint[]> {
  await ensureInitialized()

  const g = globalThis as unknown as GoWasmGlobals
  const input = JSON.stringify({ filePath, content })
  const raw = g.analyzeGo!(input)

  const response: GoAnalyzeResponse = JSON.parse(raw)

  if (response.error) {
    throw new Error(`[go-wasm] 分析失敗 (${filePath}): ${response.error}`)
  }

  return response.points
}

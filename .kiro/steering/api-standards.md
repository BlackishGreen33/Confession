---
inclusion: fileMatch
fileMatchPattern: "**/src/server/**/*"
---

# API 標準

後端使用 Hono 框架，透過 Next.js catch-all route `web/src/app/api/[...route]/route.ts` 掛載。

## 路由表

| 路由 | 方法 | 用途 |
|------|------|------|
| `/api/health` | GET | 健康檢查 |
| `/api/config` | GET | 取得目前配置 |
| `/api/config` | PUT | 儲存配置（局部更新後合併） |
| `/api/scan` | POST | 觸發掃描 |
| `/api/scan/status/:id` | GET | 掃描進度 |
| `/api/scan/stream/:id` | GET | 掃描進度 SSE 即時推送 |
| `/api/scan/recent` | GET | 最近一次掃描摘要 |
| `/api/scan/cancel/:id` | POST | 取消進行中的掃描任務 |
| `/api/vulnerabilities` | GET | 列表（篩選/排序/分頁） |
| `/api/vulnerabilities/trend` | GET | 歷史趨勢（事件驅動，依日期聚合後累計；無事件時回退舊聚合） |
| `/api/vulnerabilities/stats` | GET | 統計資料 |
| `/api/vulnerabilities/:id` | GET | 單筆漏洞詳情 |
| `/api/vulnerabilities/:id/events` | GET | 單筆漏洞事件流（新到舊） |
| `/api/vulnerabilities/:id` | PATCH | 更新狀態/歸因 |
| `/api/export` | POST | 匯出報告（JSON/CSV/Markdown/PDF） |
| `/api/monitoring/generate` | POST | 產生嵌入式監測代碼 |

## 規範

- `GET /api/health` 回應需提供健康評分 V2 結構，至少包含：
  - `status: ok|degraded|down`
  - `evaluatedAt`
  - `score.version = "v2"`、`score.value(0..100)`、`score.grade`
  - `score.components.exposure/remediation/quality/reliability`
  - `engine.latestTaskId/latestStatus/latestEngineMode`
  - 支援 `windowDays=7|30` query（預設 30），供 Dashboard 詳情切換時間窗
- 請求驗證一律使用 `zod/v4` + `@hono/zod-validator`
- 錯誤回應格式統一：`{ error: string, details?: unknown }`
- 資料庫操作透過 Prisma Client，定義於 #[[file:web/src/server/db.ts]]
- Schema 定義：#[[file:web/prisma/schema.prisma]]
- 掃描任務需支援請求去重（fingerprint）與背景執行，不阻塞回應
- `POST /api/scan` 支援 `forceRescan?: boolean`：
  - `true`：忽略未變更檔案快取，強制重掃
  - `false/undefined`：啟用增量快取（未變更可跳過）
- `POST /api/scan` 支援 `scanScope?: "file" | "workspace"`，用於控制掃描策略（例如重試僅套用 workspace）
- `POST /api/scan` 支援 `workspaceSnapshotComplete?: boolean`（僅 `scanScope=workspace` 有效）：
  - `true/undefined`：允許後端在掃描完成後執行工作區快照收斂
  - `false`：代表快照可能截斷，後端需跳過收斂避免誤判
- `POST /api/scan` 支援 `workspaceRoots?: string[]`（僅 `scanScope=workspace` 有效）：
  - 後端收斂僅可影響 `workspaceRoots` 範圍內的漏洞，避免跨工作區誤關閉
- `POST /api/scan` 支援 `engineMode?: "baseline" | "agentic_beta"`：
  - 若有傳值，優先使用請求值
  - 若未傳值，固定預設 `agentic_beta`
  - 若建立新掃描任務時存在 `pending/running` 舊任務，後端需先中止舊任務（標記 `failed`）再啟動新任務
- `ScanTask` 需記錄 `engineMode`、`errorCode` 與 fallback 欄位（`fallbackUsed/fallbackFrom/fallbackTo/fallbackReason`）
- `GET /api/scan/status/:id` / `GET /api/scan/recent` 必須回傳 `engineMode`、`errorCode` 與 fallback 欄位
- `GET /api/scan/stream/:id` 回應 `text/event-stream`，需即時推送 `{ id, status, progress, totalFiles, scannedFiles, engineMode, fallbackUsed, fallbackFrom?, fallbackTo?, fallbackReason?, errorMessage, errorCode, createdAt, updatedAt }`
  - 掃描狀態到 `completed` / `failed` 後可關閉串流
- `POST /api/scan/cancel/:id`：
  - 任務不存在回 `404`
  - 任務已結束（`completed/failed`）回 `200` 並 `canceling=false`
  - 任務進行中（`pending/running`）需立刻標記為 `failed`，並寫入可追蹤錯誤訊息（例如 `使用者已取消掃描`），同時觸發 SSE 進度事件，回 `202` 與 `canceling=true`
- `GET /api/scan/recent` 回傳最近一次掃描摘要；若尚無掃描記錄回 `404 { error: "尚無掃描記錄" }`
- Vercel 部署的 API catch-all route 需設定 Node runtime 與動態回應（避免快取中斷 SSE）：
  - `runtime = "nodejs"`
  - `dynamic = "force-dynamic"`
  - `maxDuration = 300`（實際上限仍受方案限制）
- 掃描執行時，LLM 設定（provider/apiKey/endpoint/model）優先讀取持久化 config（`config.id=default`），再回退環境變數
  - `provider` 支援 `gemini | nvidia`，預設 `nvidia`
  - `llm.endpoint` / `llm.model` 若傳 `null` 或空字串，視為清空並回退 provider 預設
- 若 LLM 在本次任務中「所有待分析檔案皆失敗」（呼叫失敗或回應解析失敗），`/api/scan/status/:id` 必須回報 `failed`，且附帶 `errorMessage`
  - 若為 429 / `RESOURCE_EXHAUSTED`（quota exceeded），`errorMessage` 需明確提示配額用盡與後續行動
- 若 `engineMode=agentic_beta` 失敗，需自動回退 `baseline`；僅在雙引擎都失敗時，`errorCode` 才回 `BETA_ENGINE_FAILED`
- LLM 回應 `confidence` 需以 0..1 儲存；若模型回傳 0..100 百分制，後端需正規化後再驗證
- 漏洞事件規範：
  - `scan_detected`：新漏洞建立時寫入
  - `review_saved`：`humanStatus/humanComment/owaspCategory` 任一變更時寫入
  - `status_changed`：`status` 變更時寫入
  - 狀態更新與事件寫入需在同一 transaction，確保一致性
  - 相容舊 DB：`vulnerability_events` 尚未存在時，`/trend` 回退舊邏輯，`/:id/events` 回空陣列
- 漏洞語義去重規範：
  - `upsertVulnerabilities` 寫入前需做語義去重（同一行同一敏感資料主題僅保留一筆）
  - `hardcoded_secret` 與 `keyword_*` 重疊時，優先保留 `hardcoded_secret`
  - `GET /api/vulnerabilities` 與 `GET /api/vulnerabilities/stats` 需基於語義去重後資料回傳，避免同源重複告警膨脹
- 工作區快照收斂規範：
  - 僅 `scanScope=workspace` 且 `workspaceSnapshotComplete !== false` 時啟用
  - 必須以 `workspaceRoots` 限定收斂範圍；缺少 roots 時跳過收斂
  - 若開放漏洞的 `filePath` 不在本次快照清單，後端需自動將其 `status` 由 `open` 轉為 `fixed`
  - 收斂時需寫入 `status_changed` 事件，訊息需說明來源檔案不在本次工作區快照（可能刪除或改名）
  - 收斂失敗不得中斷整體掃描任務完成；需輸出結構化 log 供追查
- `POST /api/export` 規範：
  - request body：`format = json|csv|markdown|pdf`，`filters` 支援 `status/severity/humanStatus/filePath/search`
  - `json`：`application/json`，回傳 `ExportReportV2`（schemaVersion、filters、summary、items）
  - CSV 回應需帶 UTF-8 BOM（避免繁中在部分試算表開啟亂碼）
  - `markdown`：`text/markdown; charset=utf-8`
  - `pdf`：`text/html; charset=utf-8`（列印版 HTML，由前端觸發瀏覽器列印另存 PDF）
  - `Content-Disposition` 檔名格式統一：`confession-vulnerabilities-YYYYMMDD-HHmmss.<ext>`
- 掃描完成需輸出結構化 LLM 用量 log（`[Confession][LLMUsage]`），至少含 requestCount、token 用量、cacheHits、skippedByPolicy、successfulFiles、requestFailures、parseFailures、failureKinds
- 掃描完成需輸出引擎結構化 log（`[Confession][EngineMetrics]`），至少含 `agentic_attempt_count`、`agentic_failure_count`、`baseline_fallback_count`、`fallback_success_rate`

## Agent 系統

1. **Engine Router** — 根據 `engineMode` 分流到 baseline 或 agentic_beta
2. **Orchestrator（baseline）** — 依語言分組 → 平行分派 → 合併 → LLM 分析 → 冪等寫入
3. **Orchestrator（agentic_beta）** — ContextBundle → Planner → Skills/MCP → Analyst → Critic → Judge → 冪等寫入
4. **JS/TS Agent** — TypeScript Compiler API AST，偵測：eval、innerHTML、直接查詢、原型鏈變異
5. **Go Agent** — Go WASM 沙箱（`go/ast` + `go/parser`）
6. **Analysis Agent（baseline）** — LLM（Gemini / NVIDIA，檔案聚合策略）
   - `quick`：僅高風險 AST 點位觸發（條件式 LLM）
   - `standard`：每檔案一次聚合分析（交互點排序 + 上限 + 區塊上下文）
   - `deep`：每檔案一次完整檔案掃描（保留宏觀能力）
   - LLM 呼叫逾時為 45 秒；僅 `workspace` 掃描在逾時或 HTTP 503（UNAVAILABLE）時自動重試 1 次
   - LLM 回應快取：以 prompt 指紋去重（TTL）
7. **MCP Broker + Policy** — 僅允許白名單 server 與安全能力（pattern_scan/code_graph_lookup）

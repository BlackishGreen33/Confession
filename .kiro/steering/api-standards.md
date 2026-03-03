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
| `/api/scan/recent` | GET | 最近一次掃描摘要 |
| `/api/vulnerabilities` | GET | 列表（篩選/排序/分頁） |
| `/api/vulnerabilities/trend` | GET | 歷史趨勢（事件驅動，依日期聚合後累計；無事件時回退舊聚合） |
| `/api/vulnerabilities/stats` | GET | 統計資料 |
| `/api/vulnerabilities/:id` | GET | 單筆漏洞詳情 |
| `/api/vulnerabilities/:id/events` | GET | 單筆漏洞事件流（新到舊） |
| `/api/vulnerabilities/:id` | PATCH | 更新狀態/歸因 |
| `/api/export` | POST | 匯出報告（JSON/CSV/Markdown/PDF） |
| `/api/monitoring/generate` | POST | 產生嵌入式監測代碼 |

## 規範

- 請求驗證一律使用 `zod/v4` + `@hono/zod-validator`
- 錯誤回應格式統一：`{ error: string, details?: unknown }`
- 資料庫操作透過 Prisma Client，定義於 #[[file:web/src/server/db.ts]]
- Schema 定義：#[[file:web/prisma/schema.prisma]]
- 掃描任務需支援請求去重（fingerprint）與背景執行，不阻塞回應
- `POST /api/scan` 支援 `forceRescan?: boolean`：
  - `true`：忽略未變更檔案快取，強制重掃
  - `false/undefined`：啟用增量快取（未變更可跳過）
- `POST /api/scan` 支援 `scanScope?: "file" | "workspace"`，用於控制掃描策略（例如重試僅套用 workspace）
- `GET /api/scan/recent` 回傳最近一次掃描摘要；若尚無掃描記錄回 `404 { error: "尚無掃描記錄" }`
- 掃描執行時，LLM 設定（provider/apiKey/endpoint/model）優先讀取持久化 config（`config.id=default`），再回退環境變數
  - `provider` 支援 `gemini | nvidia`，預設 `nvidia`
  - `llm.endpoint` / `llm.model` 若傳 `null` 或空字串，視為清空並回退 provider 預設
- 若 LLM 在本次任務中「所有待分析檔案皆失敗」（呼叫失敗或回應解析失敗），`/api/scan/status/:id` 必須回報 `failed`，且附帶 `errorMessage`
  - 若為 429 / `RESOURCE_EXHAUSTED`（quota exceeded），`errorMessage` 需明確提示配額用盡與後續行動
- LLM 回應 `confidence` 需以 0..1 儲存；若模型回傳 0..100 百分制，後端需正規化後再驗證
- 漏洞事件規範：
  - `scan_detected`：新漏洞建立時寫入
  - `review_saved`：`humanStatus/humanComment/owaspCategory` 任一變更時寫入
  - `status_changed`：`status` 變更時寫入
  - 狀態更新與事件寫入需在同一 transaction，確保一致性
  - 相容舊 DB：`vulnerability_events` 尚未存在時，`/trend` 回退舊邏輯，`/:id/events` 回空陣列
- `POST /api/export` 規範：
  - request body：`format = json|csv|markdown|pdf`，`filters` 支援 `status/severity/humanStatus/filePath/search`
  - `json`：`application/json`，回傳 `ExportReportV2`（schemaVersion、filters、summary、items）
  - CSV 回應需帶 UTF-8 BOM（避免繁中在部分試算表開啟亂碼）
  - `markdown`：`text/markdown; charset=utf-8`
  - `pdf`：`text/html; charset=utf-8`（列印版 HTML，由前端觸發瀏覽器列印另存 PDF）
  - `Content-Disposition` 檔名格式統一：`confession-vulnerabilities-YYYYMMDD-HHmmss.<ext>`
- 掃描完成需輸出結構化 LLM 用量 log（`[Confession][LLMUsage]`），至少含 requestCount、token 用量、cacheHits、skippedByPolicy、successfulFiles、requestFailures、parseFailures、failureKinds

## Agent 系統

1. **Orchestrator** — 依語言分組 → 平行分派 → 合併 → LLM 分析 → 冪等寫入
2. **JS/TS Agent** — TypeScript Compiler API AST，偵測：eval、innerHTML、直接查詢、原型鏈變異
3. **Go Agent** — Go WASM 沙箱（`go/ast` + `go/parser`）
4. **Analysis Agent** — LLM（Gemini / NVIDIA，檔案聚合策略）
   - `quick`：僅高風險 AST 點位觸發（條件式 LLM）
   - `standard`：每檔案一次聚合分析（交互點排序 + 上限 + 區塊上下文）
   - `deep`：每檔案一次完整檔案掃描（保留宏觀能力）
   - LLM 呼叫逾時為 45 秒；僅 `workspace` 掃描在逾時或 HTTP 503（UNAVAILABLE）時自動重試 1 次
   - LLM 回應快取：以 prompt 指紋去重（TTL）

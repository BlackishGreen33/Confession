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
| `/api/vulnerabilities` | GET | 列表（篩選/排序/分頁） |
| `/api/vulnerabilities/trend` | GET | 歷史趨勢（事件驅動，依日期聚合後累計；無事件時回退舊聚合） |
| `/api/vulnerabilities/stats` | GET | 統計資料 |
| `/api/vulnerabilities/:id` | GET | 單筆漏洞詳情 |
| `/api/vulnerabilities/:id/events` | GET | 單筆漏洞事件流（新到舊） |
| `/api/vulnerabilities/:id` | PATCH | 更新狀態/歸因 |
| `/api/export` | POST | 匯出報告（JSON/CSV） |
| `/api/monitoring/generate` | POST | 產生嵌入式監測代碼 |

## 規範

- 請求驗證一律使用 `zod/v4` + `@hono/zod-validator`
- 錯誤回應格式統一：`{ error: string, details?: unknown }`
- 資料庫操作透過 Prisma Client，定義於 #[[file:web/src/server/db.ts]]
- Schema 定義：#[[file:web/prisma/schema.prisma]]
- 掃描任務需支援請求去重（fingerprint）與背景執行，不阻塞回應
- 漏洞事件規範：
  - `scan_detected`：新漏洞建立時寫入
  - `review_saved`：`humanStatus/humanComment/owaspCategory` 任一變更時寫入
  - `status_changed`：`status` 變更時寫入
  - 狀態更新與事件寫入需在同一 transaction，確保一致性
  - 相容舊 DB：`vulnerability_events` 尚未存在時，`/trend` 回退舊邏輯，`/:id/events` 回空陣列
- `POST /api/export` 規範：
  - CSV 回應需帶 UTF-8 BOM（避免繁中在部分試算表開啟亂碼）
  - `Content-Disposition` 檔名格式統一：`confession-vulnerabilities-YYYYMMDD-HHmmss.<ext>`

## Agent 系統

1. **Orchestrator** — 依語言分組 → 平行分派 → 合併 → LLM 分析 → 冪等寫入
2. **JS/TS Agent** — TypeScript Compiler API AST，偵測：eval、innerHTML、直接查詢、原型鏈變異
3. **Go Agent** — Go WASM 沙箱（`go/ast` + `go/parser`）
4. **Analysis Agent** — Gemini LLM：第一階段逐點深度分析，第二階段巨觀檔案掃描

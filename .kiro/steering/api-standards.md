---
inclusion: fileMatch
fileMatchPattern: "**/api/**/*"
---

# API 標準

後端使用 Hono 框架，透過 Next.js catch-all route `/api/[...route]` 掛載。

## 路由表

| 路由 | 方法 | 用途 |
|------|------|------|
| `/api/config` | GET | 取得目前配置 |
| `/api/config` | PUT | 儲存配置（完整覆寫） |
| `/api/scan` | POST | 觸發掃描 |
| `/api/scan/status/:id` | GET | 掃描進度 |
| `/api/vulnerabilities` | GET | 列表（篩選/排序/分頁） |
| `/api/vulnerabilities/trend` | GET | 歷史趨勢（依日期聚合，累計值） |
| `/api/vulnerabilities/stats` | GET | 統計資料 |
| `/api/vulnerabilities/:id` | GET | 單筆漏洞詳情 |
| `/api/vulnerabilities/:id` | PATCH | 更新狀態/歸因 |
| `/api/export` | POST | 匯出報告（JSON/CSV） |
| `/api/monitoring/generate` | POST | 產生嵌入式監測代碼 |

## 規範

- 請求驗證一律使用 Zod + `@hono/zod-validator`
- 錯誤回應格式統一：`{ error: string, details?: unknown }`
- 資料庫操作透過 Prisma Client，定義於 #[[file:web/src/common/server/db.ts]]
- Schema 定義：#[[file:web/prisma/schema.prisma]]

## Agent 系統

1. **Orchestrator** — 依語言分組 → 平行分派 → 合併 → LLM 分析 → 冪等寫入
2. **JS/TS Agent** — TypeScript Compiler API AST，偵測：eval、innerHTML、直接查詢、原型鏈變異
3. **Go Agent** — Go WASM 沙箱（`go/ast` + `go/parser`）
4. **Analysis Agent** — Gemini LLM：第一階段逐點深度分析，第二階段巨觀檔案掃描

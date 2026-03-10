---
inclusion: always
---

# 技術棧

| 層級 | 選擇 |
|------|------|
| 套件管理 | pnpm 9.x + Turborepo |
| 語言 | TypeScript strict mode（CLI 為 Node.js 腳本） |
| 前端 | Next.js 16 App Router + Tailwind CSS 4 + shadcn/ui + sonner + next-themes + framer-motion + next/font |
| 狀態管理 | Jotai（主要）+ Bunshi（保留於依賴） |
| 資料取得 | React Query + Axios |
| 圖表 | Recharts |
| 後端 | Hono（透過 Next.js catch-all `/api/[...route]`） |
| 驗證 | zod/v4 + @hono/zod-validator |
| 儲存層 | 專案本地 FileStore（`.confession/*.json`） |
| 舊資料遷移 | `better-sqlite3`（僅一次性 SQLite → FileStore 遷移） |
| 擴充套件打包 | esbuild（CJS, external: vscode） |
| LLM | Google Gemini API + NVIDIA Integrate（OpenAI 相容；預設 NVIDIA） |
| Agentic Engine | Planner/Skill/Analyst/Critic/Judge 多代理管線（正式預設，失敗自動回退 baseline） |
| MCP | 內建 broker + policy（白名單 server、僅允許安全能力） |
| 測試 | Vitest + fast-check（web/extension）+ Node.js `node:test`（CLI） |
| CI/CD | GitHub Actions（`lint`/`build`/`test` 並行 + `quality` 聚合 + `commit-check`） |
| Commit 檢查 | commitlint + husky（`commit-msg` hook） |

## CI 快取與觸發

- `ci.yml` 需使用 `paths`/`paths-ignore` 做精準觸發，避免無關變更浪費 CI。
- Turborepo Remote Cache 以環境變數注入：
  - `TURBO_TOKEN`
  - `TURBO_TEAM`
  - `TURBO_REMOTE_CACHE_SIGNATURE_KEY`
- CI 環境需設定 `TURBO_TELEMETRY_DISABLED=1`。

## 部署備註（Vercel）

- API 入口 `web/src/app/api/[...route]/route.ts` 需固定：
  - `runtime = "nodejs"`（SSE 走 Node Functions）
  - `dynamic = "force-dynamic"`（避免快取造成串流失效）
  - `maxDuration = 300`（實際可用上限仍受方案限制）
- SSE 端點（例如 `/api/scan/stream/:id`）適合即時進度推送；若未來同時連線數很高，需評估成本與連線上限（可考慮拆分專用 realtime 通道）。

## 掃描快取

- `fileAnalysisCache` 需持久化到 `.confession/analysis-cache.json`。
- 快取命中需同時受 `analyzerVersion` / `promptVersion` 約束；版本不相容時必須忽略舊快取。

## 掃描吞吐

- JS/TS AST 分析需支援 worker pool：
  - 預設並行度：`min(4, cpuCores - 1)`
  - 可由 `CONFESSION_JSTS_WORKER_POOL_SIZE` 覆寫
  - 若 worker 啟動/執行失敗，必須自動回退單執行緒流程，不得中斷掃描

## 核心指令

- 安裝依賴：`pnpm install`
- 本地開發（全專案）：`pnpm dev`
- 型別檢查與 lint：`pnpm lint`
- 建置：`pnpm build`
- 全部測試：`pnpm test`
- CI lint 檢查：`pnpm check:lint`
- CI build 檢查：`pnpm check:build`
- CI test 檢查：`pnpm check:test`
- 測試（web）：`pnpm --filter web test`
- 測試（extension）：`pnpm --filter confession-extension test`
- 測試（CLI）：`pnpm --filter confession-cli test`
- 掃描基準（1000/3000 檔）：`pnpm --filter web benchmark:scan`
- 程式碼格式化：`pnpm format`
- 格式檢查：`pnpm format:check`
- CI 檢查彙總：`pnpm check:ci`
- Commit 訊息檢查（最近一筆）：`pnpm commitlint --from HEAD~1 --to HEAD`
- Extension 打包 VSIX：`pnpm --filter confession-extension package`
- CLI 執行（本地）：`pnpm --filter confession-cli build && node confession-cli/bin/confession.js --help`
- CLI DAST 驗證：`node confession-cli/bin/confession.js verify web --url <http(s)://target>`

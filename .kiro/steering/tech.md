---
inclusion: always
---

# 技術棧

| 層級 | 選擇 |
|------|------|
| 套件管理 | pnpm 9.x + Turborepo |
| 語言 | TypeScript strict mode |
| 前端 | Next.js 16 App Router + Tailwind CSS 4 + shadcn/ui + sonner + next-themes |
| 狀態管理 | Jotai（主要）+ Bunshi（保留於依賴） |
| 資料取得 | React Query + Axios |
| 圖表 | Recharts |
| 後端 | Hono（透過 Next.js catch-all `/api/[...route]`） |
| 驗證 | zod/v4 + @hono/zod-validator |
| 資料庫 | Prisma + SQLite（PostgreSQL 相容 schema） |
| 擴充套件打包 | esbuild（CJS, external: vscode） |
| LLM | Google Gemini API + NVIDIA Integrate（OpenAI 相容；預設 NVIDIA） |
| Beta Agentic | Planner/Skill/Analyst/Critic/Judge 多代理管線（可切換） |
| MCP | 內建 broker + policy（白名單 server、僅允許安全能力） |
| 測試 | Vitest + fast-check（PBT） |
| CI/CD | GitHub Actions（`quality` + `commit-check`） |
| Commit 檢查 | commitlint + husky（`commit-msg` hook） |

## 部署備註（Vercel）

- API 入口 `web/src/app/api/[...route]/route.ts` 需固定：
  - `runtime = "nodejs"`（SSE 走 Node Functions）
  - `dynamic = "force-dynamic"`（避免快取造成串流失效）
  - `maxDuration = 300`（實際可用上限仍受方案限制）
- SSE 端點（例如 `/api/scan/stream/:id`）適合即時進度推送；若未來同時連線數很高，需評估成本與連線上限（可考慮拆分專用 realtime 通道）。

## 核心指令

- 安裝依賴：`pnpm install`
- 本地開發（全專案）：`pnpm dev`
- 型別檢查與 lint：`pnpm lint`
- 建置：`pnpm build`
- 全部測試：`pnpm test`
- 測試（web）：`pnpm --filter web test`
- 測試（extension）：`pnpm --filter confession-extension test`
- 程式碼格式化：`pnpm format`
- 格式檢查：`pnpm format:check`
- CI 檢查彙總：`pnpm check:ci`
- Commit 訊息檢查（最近一筆）：`pnpm commitlint --from HEAD~1 --to HEAD`
- 資料庫遷移：`pnpm --filter web exec prisma migrate dev`
- 產生 Prisma Client：`pnpm --filter web exec prisma generate`
- 開啟 Prisma Studio：`pnpm --filter web db:studio`
- Extension 打包 VSIX：`pnpm --filter confession-extension package`

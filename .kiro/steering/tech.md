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
| 測試 | Vitest + fast-check（PBT） |
| CI/CD | GitHub Actions（`quality` + `commit-check`） |
| Commit 檢查 | commitlint + husky（`commit-msg` hook） |

## 核心指令

- 安裝依賴：`pnpm install`
- 型別檢查與 lint：`pnpm lint`
- 建置：`pnpm build`
- 全部測試：`pnpm test`
- 測試（web）：`pnpm --filter web test`
- 測試（extension）：`pnpm --filter confession-extension test`
- CI 檢查彙總：`pnpm check:ci`
- Commit 訊息檢查（最近一筆）：`pnpm commitlint --from HEAD~1 --to HEAD`
- 資料庫遷移：`pnpm --filter web exec prisma migrate dev`
- 產生 Prisma Client：`pnpm --filter web exec prisma generate`

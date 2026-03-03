---
inclusion: always
---

# 技術棧

| 層級 | 選擇 |
|------|------|
| 套件管理 | pnpm 9.x + Turborepo |
| 語言 | TypeScript strict mode |
| 前端 | Next.js 16 App Router + Tailwind CSS 4 + shadcn/ui + next-themes |
| 狀態管理 | Jotai + Bunshi（單一 `libs/atoms.ts`） |
| 資料取得 | React Query + Axios |
| 圖表 | Recharts |
| 後端 | Hono（透過 Next.js catch-all `/api/[...route]`） |
| 驗證 | zod/v4 + @hono/zod-validator |
| 資料庫 | Prisma + SQLite（PostgreSQL 相容 schema） |
| 擴充套件打包 | esbuild（CJS, external: vscode） |
| LLM | Google Gemini API（可設定端點） |
| 測試 | Vitest + fast-check（PBT） |

## 核心指令

- 安裝依賴：`pnpm install`
- 型別檢查與 lint：`pnpm lint`
- 建置：`pnpm build`
- 測試：`pnpm test`
- 資料庫遷移：`pnpm --filter web exec prisma migrate dev`
- 產生 Prisma Client：`pnpm --filter web exec prisma generate`

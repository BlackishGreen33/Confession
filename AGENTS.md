# AGENTS.md

本文件定義在 `Confession` 專案中，Agent 執行任務時的統一規範。

## 0. 核心原則

- 專案 single source of truth：`.kiro/steering/`
- 任務優先順序：
  1. 先讀 steering
  2. 再比對實際程式碼與目錄
  3. 修正 steering 的過時內容
  4. 同步更新 `AGENTS.md`
- 若 steering 與程式碼衝突：不得忽略，必須同步修正到一致
- 全程使用繁體中文（對話、文件、程式碼註釋）

## 1. 每次任務的標準流程

1. 讀取 `.kiro/steering/*.md` 全部檔案。
2. 盤點實際專案現況（結構、路由、依賴、型別、測試）。
3. 標記差異：
   - 缺失（steering 未覆蓋）
   - 遺漏（新能力未記錄）
   - 過舊（與現況不符）
4. 先更新 `.kiro/steering`。
5. 依最新 steering 產生或更新 `AGENTS.md`。
6. 執行品質檢查：
   - `pnpm lint`
   - `pnpm build`
7. 若失敗，修復後重跑，直到全數通過。

## 2. 產品與邊界

- 名稱：Confession（薄暮靜析的告解詩）
- 定位：VS Code 靜態程式碼漏洞分析插件
- 哲學：靜態而非執行、觀測而非干預、揭露而非審判
- 嚴格限制：不執行使用者程式碼，只做 AST + LLM 分析
- AI 觸發策略：一律被動觸發（手動掃描或 onSave 事件），不得主動背景連續呼叫模型 API

## 3. 專案結構（最新）

```text
confession/
├── extension/              # VSCode 擴充套件（esbuild → CommonJS）
│   ├── src/extension.ts
│   ├── src/diagnostics.ts
│   ├── src/file-watcher.ts
│   ├── src/scan-client.ts
│   ├── src/monitoring.ts
│   ├── src/webview.ts
│   ├── src/status-bar.ts
│   └── src/types.ts
├── web/                    # Next.js App Router + Hono
│   ├── src/generated/       # Prisma 產生型別與 client
│   ├── src/app/
│   │   ├── page.tsx
│   │   ├── vulnerabilities/page.tsx
│   │   ├── settings/page.tsx
│   │   ├── vulnerability-detail/page.tsx
│   │   └── api/[...route]/route.ts
│   ├── src/common/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── libs/
│   │   └── utils/
│   └── src/server/
│       ├── agents/
│       ├── analyzers/
│       ├── llm/
│       ├── routes/
│       ├── cache.ts
│       ├── db.ts
│       ├── index.ts
│       └── monitoring.ts
├── go-analyzer/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

補充（近期新增）：
- `web/src/common/components/cyber-dropdown-menu.tsx`：共用 cyber 風格下拉封裝
- `web/src/common/components/ui/dropdown-menu.tsx`：shadcn/Radix Portal 下拉元件

邊界規則：
- 前端程式碼僅在 `web/`
- 擴充套件程式碼僅在 `extension/`
- 共用型別優先集中於 `web/src/common/libs/types.ts`

## 4. 路徑別名

- `@/*` → `web/src/common/*`
- `@app/*` → `web/src/app/*`
- `@server` → `web/src/server/index.ts`
- `@server/*` → `web/src/server/*`

## 5. 技術棧

- 套件管理：pnpm 9.x + Turborepo
- 語言：TypeScript strict mode
- 前端：Next.js 16 App Router + Tailwind CSS 4 + shadcn/ui + next-themes
- 狀態管理：Jotai + Bunshi
- 資料取得：React Query + Axios
- 後端：Hono（掛載於 Next.js `/api/[...route]`）
- 驗證：`zod/v4` + `@hono/zod-validator`
- 資料庫：Prisma + SQLite
- 測試：Vitest + fast-check（PBT）
- LLM：Google Gemini API（可自訂 endpoint/model）

## 6. API 規範

Hono app 由 `web/src/server/index.ts` 統一掛載於 `/api`。

目前路由：
- `GET /api/health`
- `GET /api/config`
- `PUT /api/config`（局部更新後合併）
- `POST /api/scan`
- `GET /api/scan/status/:id`
- `GET /api/vulnerabilities`
- `GET /api/vulnerabilities/trend`
- `GET /api/vulnerabilities/stats`
- `GET /api/vulnerabilities/:id`
- `PATCH /api/vulnerabilities/:id`
- `POST /api/export`
- `POST /api/monitoring/generate`

規範：
- 所有請求驗證使用 `zod/v4` + `@hono/zod-validator`
- 錯誤回應格式：`{ error: string, details?: unknown }`
- Prisma client 入口：`web/src/server/db.ts`
- Schema：`web/prisma/schema.prisma`
- 掃描流程需保留去重（fingerprint）與背景執行
- `POST /api/export`：
  - CSV 回應需附加 UTF-8 BOM，避免繁中開啟亂碼
  - 下載檔名格式統一為 `confession-vulnerabilities-YYYYMMDD-HHmmss.<ext>`

## 7. Extension 規範

- 打包：esbuild，格式 CJS，`external: vscode`
- 指令前綴：`codeVuln.*`
- 設定前綴：`confession.*`
- 嚴重度映射：critical/high → Error，medium → Warning，low/info → Information
- 儲存觸發：`onDidSaveTextDocument` + debounce（預設 500ms）
- 僅處理：Go / JavaScript / TypeScript（含 React 變體）
- Webview 與 Extension 以 postMessage 雙向同步配置與狀態

現行指令：
- `codeVuln.scanFile`
- `codeVuln.scanWorkspace`
- `codeVuln.openDashboard`
- `codeVuln.showDashboard`
- `codeVuln.showVulnerabilities`
- `codeVuln.showSettings`
- `codeVuln.ignoreVulnerability`

通訊訊息（依 `web/src/common/libs/types.ts` / `extension/src/types.ts`）：
- Ext → Web：`config_updated`、`navigate_to_view`、`vulnerability_detail_data`、`scan_progress`、`vulnerabilities_updated`
- Web → Ext：`request_scan`、`apply_fix`、`ignore_vulnerability`、`navigate_to_code`、`open_vulnerability_detail`、`update_config`、`request_config`

## 8. 程式碼規範

- ESLint flat config + Prettier（根層級）
- SQLite 不使用原生 enum：以字串欄位 + Zod 驗證
- 禁止無理由新增 runtime 依賴
- 禁止濫用 `@ts-ignore` / `eslint-disable`
- React 元件使用箭頭函式 + `React.FC<Props>`
- hooks 檔案維持「React Query hooks 與 Jotai atoms 同檔共置」
- 漏洞冪等鍵：`[filePath, line, column, codeHash, type]`

## 9. 測試規範

- 測試框架：Vitest
- 屬性測試：fast-check
- 命名：
  - 單元測試：`<name>.test.ts`
  - 屬性測試：`<name>.pbt.test.ts`
- 指令：
  - 全部測試：`pnpm test`
  - web 單檔：`pnpm --filter web exec vitest run <path>`
  - extension：`pnpm --filter extension test`

## 10. Steering 同步責任

以下任一變更發生時，必須同步更新 `.kiro/steering` 與 `AGENTS.md`：
- 目錄結構變動
- 路徑別名變動
- 依賴增減或版本策略調整
- 程式碼規範調整
- 測試策略調整
- API 路由或行為調整

完成定義：
- steering 與 `AGENTS.md` 內容一致
- 與當前程式碼一致
- `pnpm lint`、`pnpm build` 通過

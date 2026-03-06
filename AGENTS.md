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
- 介面目標環境：VS Code Webview（桌面場景優先），不以行動端為需求邊界
- 哲學：靜態而非執行、觀測而非干預、揭露而非審判
- 嚴格限制：不執行使用者程式碼，只做 AST + LLM 分析
- AI 觸發策略：一律被動觸發（手動掃描或 onSave 事件），不得主動背景連續呼叫模型 API
- AI 掃描策略（成本優先）：
  - `quick`：僅高風險 AST 點位觸發 LLM（條件式）
  - `standard`：交互點聚合為每檔案單次 LLM（區塊上下文）
  - `deep`：每檔案單次 LLM 完整掃描（保留宏觀分析）
  - 工作區掃描需支援檔案級併行與自動降併發（429/503/timeout 連續失敗時下調），兼顧速度與穩定性
  - 引擎模式：`baseline`（既有流程）/`agentic_beta`（Planner→Skills/MCP→Analyst→Critic→Judge）
  - 正式預設引擎為 `agentic_beta`（使用者端不提供手動開關）
  - `agentic_beta` 失敗時，後端需在同一 task 內自動回退 `baseline`
  - LLM 呼叫逾時為 45 秒；僅 `workspace` 掃描在逾時或 HTTP 503（UNAVAILABLE）時自動重試 1 次
  - 同 Prompt 需做指紋快取，避免重複消耗 token
- 專家審核流程：
  - 審核狀態變更需按「儲存審核」成功後才生效
  - 僅 `humanStatus = confirmed` 時可顯示/執行修復或忽略操作
  - 服務可用性文案需依 `/api/health` 動態顯示，不可寫死
  - 前端可見狀態以二態為主：`正常運行` / `無法運行`（不直接對使用者暴露 `degraded` 字樣）
  - Dashboard 健康卡摘要不可重複顯示同一資訊（例如分數重覆），需改為互補資訊（等級/更新時間/關鍵因子）
  - Dashboard 健康卡需提供 `Score / Exposure / Reliability` 的快速引導說明（含「怎麼算/代表什麼/理想區間」）
  - Dashboard 四卡上方需提供「一句總結 + 3 信號 + 1 主行動」摘要卡，支援一鍵導流漏洞列表
  - `風險資源分配` 需提供 Priority Lanes（優先序 + 建議投入比例 + 一鍵導流）
  - `安全威脅演進` 需提供 Trend Insights（7 日淨變化、修復速度、清空估算 ETA）與壓力警示

## 3. 專案結構（最新）

```text
confession/
├── .github/
│   └── workflows/
│       └── ci.yml                  # GitHub Actions（quality + commit-check）
├── .husky/
│   └── commit-msg                  # commit 訊息檢查 hook
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
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx
│   │   ├── loading.tsx
│   │   ├── vulnerabilities/page.tsx
│   │   ├── vulnerabilities/loading.tsx
│   │   ├── settings/page.tsx
│   │   ├── settings/loading.tsx
│   │   ├── vulnerability-detail/page.tsx
│   │   ├── vulnerability-detail/loading.tsx
│   │   └── api/[...route]/route.ts
│   ├── src/common/
│   │   ├── components/
│   │   │   ├── dashboard/main.tsx
│   │   │   ├── vulnerability-list/main.tsx
│   │   │   ├── vulnerability-detail/main.tsx
│   │   │   ├── settings/main.tsx
│   │   │   ├── loading/page-loading.tsx
│   │   │   ├── theme-toggle.tsx
│   │   │   ├── elements/          # 通用原子元件（cyber-select、cyber-dropdown-menu）
│   │   │   └── ui/                # shadcn 元件封裝（accordion/sheet/skeleton/select/dropdown/tooltip/sonner 等）
│   │   ├── hooks/
│   │   ├── motion/                # Framer Motion token、variants、provider、reveal
│   │   ├── libs/
│   │   ├── providers.tsx          # Theme + Motion + Query + Jotai provider
│   │   └── utils/
│   └── src/server/
│       ├── agents/
│       │   └── agentic-beta/       # Beta 多代理管線與 skills
│       ├── analyzers/
│       ├── llm/
│       ├── mcp/                    # MCP broker + policy（白名單/能力管制）
│       ├── routes/
│       ├── cache.ts
│       ├── db.ts
│       ├── index.ts
│       └── monitoring.ts
├── go-analyzer/
├── commitlint.config.mjs   # commitlint 規則（emoji + conventional + 必填 scope）
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

補充（近期新增）：
- `web/src/common/components/elements/cyber-select.tsx`：共用 cyber 風格 Select（基於 shadcn Select 樣式覆蓋）
- `web/src/common/components/elements/cyber-dropdown-menu.tsx`：共用 cyber 風格 DropdownMenu（基於 shadcn DropdownMenu 樣式覆蓋）
- `web/src/common/components/ui/dropdown-menu.tsx`：shadcn/Radix Portal 下拉元件
- `web/src/common/components/ui/tooltip.tsx`：shadcn/Radix Tooltip 元件封裝（支援碰撞避讓與 Portal）
- `web/src/common/components/ui/sonner.tsx`：shadcn/sonner Toast 樣式封裝元件
- `web/src/common/components/ui/accordion.tsx`、`web/src/common/components/ui/sheet.tsx`、`web/src/common/components/ui/skeleton.tsx`：shadcn primitives 擴充封裝
- `web/src/common/components/loading/page-loading.tsx`：各 route 共用 loading skeleton + motion
- `web/src/common/components/theme-toggle.tsx`：`light/dark/system` 主題切換入口
- `web/src/common/motion/*`：Framer Motion 統一 token、variants、provider 與 reduced-motion 適配
- `web/src/common/libs/dashboard-insights.ts`：Dashboard 洞察計算（摘要卡、Priority Lanes、Trend Insights、preset 導流）

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
- 前端：Next.js 16 App Router + Tailwind CSS 4 + shadcn/ui + sonner + next-themes + framer-motion + next/font
- 狀態管理：Jotai（主要）+ Bunshi（保留於依賴）
- 資料取得：React Query + Axios
- 後端：Hono（掛載於 Next.js `/api/[...route]`）
- 驗證：`zod/v4` + `@hono/zod-validator`
- 資料庫：Prisma + SQLite
- 測試：Vitest + fast-check（PBT）
- LLM：Google Gemini API + NVIDIA Integrate（OpenAI 相容；可自訂 endpoint/model，預設 NVIDIA）
- CI/CD：GitHub Actions（`quality` + `commit-check`）
- Commit 檢查：commitlint + husky（`commit-msg` hook）

## 5.1 工作流程與常用指令

- 全專案本地開發：`pnpm dev`
- 品質檢查彙總（lint + build + test）：`pnpm check:ci`
- 程式碼格式化：`pnpm format`
- 格式檢查：`pnpm format:check`
- Prisma migrate：`pnpm --filter web db:migrate`
- Prisma generate：`pnpm --filter web db:generate`
- Prisma Studio：`pnpm --filter web db:studio`
- Extension 打包 VSIX：`pnpm --filter confession-extension package`
- Commit range 檢查：`pnpm commitlint:range --from <from> --to <to>`

## 6. API 規範

Hono app 由 `web/src/server/index.ts` 統一掛載於 `/api`。

目前路由：
- `GET /api/health`
- `GET /api/config`
- `PUT /api/config`（局部更新後合併）
- `POST /api/scan`
- `GET /api/scan/status/:id`
- `GET /api/scan/stream/:id`
- `GET /api/scan/recent`
- `POST /api/scan/cancel/:id`
- `GET /api/vulnerabilities`
- `GET /api/vulnerabilities/trend`
- `GET /api/vulnerabilities/stats`
- `GET /api/vulnerabilities/:id`
- `GET /api/vulnerabilities/:id/events`
- `PATCH /api/vulnerabilities/:id`
- `POST /api/export`
- `POST /api/monitoring/generate`

規範：
- `GET /api/health` 回傳健康評分 V2，至少包含：
  - `status = ok|degraded|down`
  - `evaluatedAt`
  - `score.version = "v2"`、`score.value`、`score.grade`
  - `score.components.exposure/remediation/quality/reliability`
  - `score.topFactors`（Top 3 影響因素，含 `label/direction/valueText/reason/impactScore`）
  - `engine.latestTaskId/latestStatus/latestEngineMode`
  - 支援 `windowDays=7|30` query（預設 30），供 Dashboard 詳情切換時間窗
- 所有請求驗證使用 `zod/v4` + `@hono/zod-validator`
- 錯誤回應格式：`{ error: string, details?: unknown }`
- Prisma client 入口：`web/src/server/db.ts`
- Schema：`web/prisma/schema.prisma`
- 掃描流程需保留去重（fingerprint）與背景執行
- `POST /api/scan` 支援 `forceRescan?: boolean`：
  - `true`：忽略未變更檔案快取，強制重掃
  - `false/undefined`：啟用增量快取（未變更可跳過）
- `POST /api/scan` 支援 `scanScope?: "file" | "workspace"`，用於控制掃描策略（例如重試僅套用 workspace）
- `POST /api/scan` 支援 `workspaceSnapshotComplete?: boolean`（僅 workspace 掃描使用）：
  - `false` 代表快照可能截斷，後端需跳過刪檔自動收斂，避免誤判
- `POST /api/scan` 支援 `workspaceRoots?: string[]`（僅 workspace 掃描使用）：
  - 後端收斂僅可影響 `workspaceRoots` 範圍，避免跨工作區誤關閉
- `POST /api/scan` 支援 `engineMode?: "baseline" | "agentic_beta"`（未傳值時固定預設 `agentic_beta`）
- `POST /api/scan` 建立新任務前，需先中止既有 `pending/running` 任務（標記 `failed`），避免多個掃描任務並行互相覆寫狀態
- `GET /api/scan/recent` 回傳最近一次掃描摘要；若尚無掃描記錄回 `404 { error: "尚無掃描記錄" }`
- `GET /api/scan/status/:id` / `GET /api/scan/recent` 回傳需包含 `engineMode`、`errorCode` 與 `fallbackUsed/fallbackFrom/fallbackTo/fallbackReason`
- `GET /api/scan/stream/:id` 提供 `text/event-stream` 即時推送掃描進度（含 `scannedFiles/totalFiles`）
  - 掃描完成或失敗後可關閉串流
- `POST /api/scan/cancel/:id`：
  - 任務不存在回 `404`
  - 任務已結束（`completed/failed`）回 `200` 且 `canceling=false`
  - 任務進行中（`pending/running`）需立刻標記 `failed`，填寫可追蹤 `errorMessage`，並推送 SSE 事件，回 `202` 且 `canceling=true`
- `web/src/app/api/[...route]/route.ts` 需設定 `runtime = "nodejs"`、`dynamic = "force-dynamic"`、`maxDuration = 300` 以支援 SSE（最終可用時長仍受 Vercel 方案限制）
- 掃描執行時，LLM 設定（provider/apiKey/endpoint/model）優先讀取持久化 config（`config.id=default`），再回退環境變數
  - `provider` 支援 `gemini | nvidia`，預設 `nvidia`
  - `llm.endpoint` / `llm.model` 若傳 `null` 或空字串，視為清空並回退 provider 預設
- 若 LLM 在本次任務中「所有待分析檔案皆失敗」（呼叫失敗或回應解析失敗），`/api/scan/status/:id` 必須回報 `failed` 並附帶 `errorMessage`
  - 若為 429 / `RESOURCE_EXHAUSTED`（quota exceeded），`errorMessage` 需明確提示配額用盡與後續行動
- 若 `engineMode=agentic_beta` 失敗，需自動回退 `baseline`；僅在雙引擎都失敗時 `errorCode` 回 `BETA_ENGINE_FAILED`
- LLM 回應 `confidence` 需以 0..1 儲存；若模型回傳 0..100 百分制，後端需正規化後再驗證
- 掃描完成需輸出結構化 LLM 用量 log（`[Confession][LLMUsage]`），至少含 requestCount、token 用量、cacheHits、skippedByPolicy、successfulFiles、requestFailures、parseFailures、failureKinds
- 掃描完成需輸出引擎結構化 log（`[Confession][EngineMetrics]`），至少含 `agentic_attempt_count`、`agentic_failure_count`、`baseline_fallback_count`、`fallback_success_rate`
- 漏洞事件流：
  - `scan_detected`：新漏洞建立時記錄
  - `review_saved`：`humanStatus/humanComment/owaspCategory` 任一變更時記錄
  - `status_changed`：`status` 變更時記錄
  - 漏洞狀態更新與事件寫入必須同 transaction
  - 相容舊 DB：`vulnerability_events` 尚未存在時，`/trend` 回退舊聚合，`/:id/events` 回空陣列
- 漏洞語義去重：
  - 寫入層（`upsertVulnerabilities`）需先做語義去重（同一行同一敏感資料主題僅保留一筆）
  - `hardcoded_secret` 與 `keyword_*` 重疊時，優先保留 `hardcoded_secret`
  - 查詢層（`GET /api/vulnerabilities`、`GET /api/vulnerabilities/stats`）需以語義去重後資料回傳，避免列表與統計膨脹
  - `GET /api/vulnerabilities/stats` 需提供 `bySeverityOpen`（僅 `status=open` 的嚴重度分佈），供 Dashboard 風險資源分配使用
- 工作區快照收斂：
  - 僅 `scanScope=workspace` 且 `workspaceSnapshotComplete !== false` 時啟用
  - 需以 `workspaceRoots` 限定收斂範圍；缺少 roots 時跳過收斂
  - 本次快照不存在的來源檔案，其 `open` 漏洞需自動收斂為 `fixed`，並寫入 `status_changed` 事件（說明可能刪除/改名）
  - 收斂失敗不得讓整體掃描轉失敗，需寫結構化 log 供追查
- `POST /api/export`：
  - request body：`format = json|csv|markdown|pdf`，`filters` 支援 `status/severity/humanStatus/filePath/search`
  - `json`：回傳 `ExportReportV2`（schemaVersion、filters、summary、items）
  - CSV 回應需附加 UTF-8 BOM，避免繁中開啟亂碼
  - `markdown`：回應 `text/markdown; charset=utf-8`
  - `pdf`：回應 `text/html; charset=utf-8`（列印版 HTML，由前端觸發列印另存 PDF）
  - 下載檔名格式統一為 `confession-vulnerabilities-YYYYMMDD-HHmmss.<ext>`

## 7. Extension 規範

- 打包：esbuild，格式 CJS，`external: vscode`
- 指令前綴：`codeVuln.*`
- 設定前綴：`confession.*`
- LLM provider：支援 `gemini` / `nvidia`，預設 `nvidia`
- 嚴重度映射：critical/high → Error，medium → Warning，low/info → Information
- 儲存觸發：`onDidSaveTextDocument` + debounce（預設 500ms）
- 手動掃描（當前檔案/工作區）需使用 `forceRescan=true`，避免被未變更快取跳過
- 僅處理：Go / JavaScript / TypeScript（含 React 變體）
- Webview 與 Extension 以 postMessage 雙向同步配置與狀態
- 狀態列需區分掃描失敗，不得在失敗時顯示「安全」
- 分析深度語義：
  - `quick`：AST + 條件式 LLM（僅高風險 AST 點位）
  - `standard`：AST + 檔案聚合 LLM（每檔案一次）
  - `deep`：AST + 檔案聚合 LLM + 全檔宏觀掃描（每檔案一次）
- 掃描引擎策略：預設 `agentic_beta`，由後端自動回退 `baseline`
- Extension 端不顯示「改用 baseline」互動提示
- 重試策略：
  - `掃描當前檔案` / `onSave`：不重試（快速回應）
  - `掃描工作區`：逾時或 HTTP 503（UNAVAILABLE）重試 1 次
- Timeout 與中斷策略：
  - `掃描當前檔案` timeout：8 分鐘；`onSave` timeout：4 分鐘；`掃描工作區` timeout：30 分鐘
  - 一旦前端輪詢逾時，Extension 必須呼叫 `POST /api/scan/cancel/:id` 主動中止後端任務，避免殘留 `running` 任務
- 即時同步策略：
  - 單檔/增量掃描完成後，Extension 需拉取全域開放漏洞並廣播 `vulnerabilities_updated`
  - Web 端收到 `vulnerabilities_updated` 或 `scan_progress=completed/failed` 後，需立即重抓 `vulnerabilities`、`vuln-stats`、`vuln-trend`
  - 工作區掃描完成後，需先清空再重建 diagnostics，避免已刪除/已修復檔案殘留舊標記
  - `navigate_to_code` 若檔案不存在，需顯示非阻塞提示並引導重掃工作區
  - `scanWorkspace` 需附帶 `workspaceRoots` 與 `workspaceSnapshotComplete`，供後端安全收斂舊漏洞

現行指令：
- `codeVuln.scanFile`
- `codeVuln.scanWorkspace`
- `codeVuln.openDashboard`
- `codeVuln.showDashboard`
- `codeVuln.showVulnerabilities`
- `codeVuln.showSettings`
- `codeVuln.ignoreVulnerability`

通訊訊息（依 `web/src/common/libs/types.ts` / `extension/src/types.ts`）：
- Ext → Web（含回執，跨視圖廣播）：`config_updated`、`navigate_to_view`、`vulnerability_detail_data`、`scan_progress`、`vulnerabilities_updated`、`operation_result`
- Ext → Web（導流/貼上）：`apply_vulnerability_preset`、`clipboard_paste`
- Web → Ext：`request_scan`、`focus_sidebar_view(requestId?, preset?)`、`apply_fix(requestId)`、`ignore_vulnerability(requestId)`、`refresh_vulnerabilities(requestId)`、`navigate_to_code`、`open_vulnerability_detail`、`update_config(requestId)`、`export_pdf(requestId)`、`request_config`、`paste_clipboard`
- `focus_sidebar_view` 若帶 `requestId`，Extension 必須回 `operation_result(operation='focus_sidebar_view')` 供前端做導航成功/失敗回饋
- `focus_sidebar_view + preset` 成功後需廣播 `apply_vulnerability_preset`，且需短暫重試避免 view 尚未 ready 時丟失
- `vulnerabilities_updated` 為變更通知事件，前端不可依賴 payload 完整性，需以 query invalidate/refetch 收斂。

## 8. 程式碼規範

- ESLint flat config + Prettier（根層級）
- SQLite 不使用原生 enum：以字串欄位 + Zod 驗證
- 禁止無理由新增 runtime 依賴
- 禁止濫用 `@ts-ignore` / `eslint-disable`
- 可點擊 UI 元素需提供明確游標回饋：
  - 可操作：`cursor: pointer`
  - 不可操作（disabled/aria-disabled）：`cursor: not-allowed`
- 可點擊 UI 元素需提供一致互動動效：
  - `hover`：輕微高亮（亮度/邊框/背景）
  - `active`：按壓回饋（微縮放或位移）
  - `focus-visible`：可視焦點框（cyber primary ring）
- React 元件使用箭頭函式 + `React.FC<Props>`
- hooks 檔案維持「React Query hooks 與 Jotai atoms 同檔共置」
- 漏洞冪等鍵：`[filePath, line, column, codeHash, type]`
- Commit 訊息格式：`<emoji> <type>(<scope>): <description>`
- `scope` 必填，`type` 僅允許：`feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert`
- Commit 檢查必須同時覆蓋本機 hook 與 CI

## 9. 測試規範

- 測試框架：Vitest
- 屬性測試：fast-check
- 命名：
  - 單元測試：`<name>.test.ts`
  - 屬性測試：`<name>.pbt.test.ts`
- 指令：
  - 全部測試（根層級）：`pnpm test`
  - 全部測試：`pnpm --filter web test && pnpm --filter confession-extension test`
  - web 單檔：`pnpm --filter web exec vitest run <path>`
  - extension：`pnpm --filter confession-extension test`

## 10. CI 與 Commit 檢查

- CI workflow 位置：`.github/workflows/ci.yml`
- CI 觸發：`pull_request(main)`、`push(main)`
- `quality` job：`pnpm install --frozen-lockfile` + `pnpm check:ci`
- `commit-check` job：依事件計算 commit range 後執行 `pnpm commitlint:range --from <from> --to <to>`
- 本機 hook：`.husky/commit-msg` 執行 `pnpm commitlint --edit "$1"`

## 11. Steering 同步責任

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

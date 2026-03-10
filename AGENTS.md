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
- 全程使用繁體中文（對話、程式碼註釋）；`README.md` 預設英文並提供中譯版本

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
- 介面目標環境：VS Code Webview（桌面場景優先）
- Webview UI 語言：支援 `zh-TW` / `zh-CN` / `en`，預設 `zh-TW`，`auto` 需跟隨宿主語言
- 文件語言：`README.md` 為英文主版，另提供 `README.zh-TW.md` 與 `README.zh-CN.md`
- 哲學：靜態而非執行、觀測而非干預、揭露而非審判
- 嚴格限制：不執行使用者程式碼，只做 AST + LLM 分析
- AI 觸發策略：一律被動觸發（手動掃描或 onSave 事件）
- AI 下一步建議策略：
  - 僅在 `scan_completed` / `scan_failed` / `review_saved` / `status_changed` 事件後評估
  - 必須通過公式門檻才可呼叫 AI，未達標只保留決策紀錄
  - 必須套用 cooldown、指標去重與日上限
- AI 掃描策略（成本優先）：
  - `quick`：僅高風險 AST 點位觸發 LLM（條件式）
  - `standard`：交互點聚合為每檔案單次 LLM（區塊上下文）
  - `deep`：每檔案單次 LLM 完整掃描（保留宏觀分析）
  - 引擎模式：`baseline` / `agentic_beta`
  - 正式預設引擎為 `agentic_beta`
  - `agentic_beta` 失敗時，後端需在同一 task 內自動回退 `baseline`

## 3. 專案結構（最新）

```text
confession/
├── .github/
│   └── workflows/
│       ├── ci.yml
│       ├── code-scanning.yml
│       └── benchmark-regression.yml
├── .husky/
├── confession-cli/
│   └── bin/
│       ├── confession.js
│       └── confession.test.js
├── extension/
│   ├── src/extension.ts
│   ├── src/diagnostics.ts
│   ├── src/file-watcher.ts
│   ├── src/ignore-file.ts
│   ├── src/scan-client.ts
│   ├── src/monitoring.ts
│   ├── src/webview.ts
│   ├── src/status-bar.ts
│   └── src/types.ts
├── web/
│   ├── benchmarks/
│   │   └── scan-baseline.json
│   ├── scripts/
│   │   ├── code-scanning-fixture.json
│   │   ├── generate-sarif-ci.mjs
│   │   └── check-benchmark-regression.mjs
│   ├── src/app/
│   ├── src/common/
│   └── src/server/
│       ├── routes/
│       │   ├── scan/
│       │       ├── cancel-control.ts
│       │       ├── constants.ts
│       │       ├── progress-event.ts
│       │       ├── runner.ts
│       │       ├── runner-llm.ts
│       │       ├── runner-reconcile.ts
│       │       ├── schema.ts
│       │       └── status-read-metrics.ts
│       │   └── vulnerabilities/
│       │       ├── constants.ts
│       │       ├── listing.ts
│       │       ├── patch-delta.ts
│       │       └── trend.ts
│       ├── agents/
│       ├── analyzers/
│       ├── advice-gate/
│       │   ├── generation.ts
│       │   ├── guards.ts
│       │   ├── metrics.ts
│       │   ├── scoring.ts
│       │   └── types.ts
│       ├── export/
│       │   ├── common.ts
│       │   ├── printable-html.ts
│       │   ├── printable-text.ts
│       │   └── renderers.ts
│       ├── llm/
│       ├── mcp/
│       ├── storage/
│       │   ├── bootstrap.ts
│       │   ├── client.ts
│       │   ├── client-core.ts
│       │   ├── query-engine.ts
│       │   ├── repository.ts
│       │   ├── snapshot-codec.ts
│       │   ├── snapshot-io.ts
│       │   ├── lock.ts
│       │   ├── types.ts
│       │   ├── upsert-vulnerabilities-helpers.ts
│       │   ├── upsert-vulnerabilities.ts
│       │   └── index.ts
│       ├── file-analysis-cache-store.ts
│       ├── runtime-llm-config.ts
│       ├── vulnerability-presenter.ts
│       ├── vulnerability-query.ts
│       ├── sarif-generator.js
│       ├── advice-gate.ts
│       ├── health-score-core.ts
│       ├── health-score.ts
│       └── monitoring.ts
├── go-analyzer/
├── package.json
├── pnpm-workspace.yaml
├── README.zh-CN.md
├── README.zh-TW.md
├── turbo.json
└── README.md
```

`.confession` 儲存契約（每個專案根目錄）：

- `.confession/config.json`
- `.confession/vulnerabilities.json`
- `.confession/vulnerability-events.json`
- `.confession/scan-tasks.json`
- `.confession/advice-snapshots.json`
- `.confession/advice-decisions.json`
- `.confession/analysis-cache.json`
- `.confession/meta.json`

`meta` 最低必備欄位：

- `schemaVersion = "file-store-v1"`
- `analysisCacheVersion = "analysis-cache-v1"`
- `stableFingerprintVersion = "stable-fingerprint-v1"`

## 4. 路徑別名

- `@/*` → `web/src/common/*`
- `@app/*` → `web/src/app/*`
- `@server` → `web/src/server/index.ts`
- `@server/*` → `web/src/server/*`

## 5. 技術棧

- 套件管理：pnpm 9.x + Turborepo
- 語言：TypeScript strict mode（CLI 為 Node.js 腳本）
- 前端：Next.js 16 App Router + Tailwind CSS 4 + shadcn/ui + sonner + next-themes + framer-motion + next/font
- 狀態管理：Jotai（主要）+ Bunshi（保留於依賴）
- 資料取得：React Query + Axios
- 後端：Hono（掛載於 Next.js `/api/[...route]`）
- 驗證：`zod/v4` + `@hono/zod-validator`
- 儲存層：專案本地 FileStore（`.confession/*.json`）
- 舊資料遷移：已移除（不再支援 SQLite 回遷）
- 掃描快取：`fileAnalysisCache` 持久化至 `.confession/analysis-cache.json`（含 analyzer/prompt version）
- 掃描吞吐：JS/TS AST worker pool（預設 `min(4, cpuCores-1)`，失敗自動 fallback 單執行緒）
- 測試：Vitest + fast-check（web/extension）+ Node.js `node:test`（CLI）
- CI/CD：GitHub Actions（`ci.yml` + `code-scanning.yml` + `benchmark-regression.yml`）
- Commit 檢查：commitlint + husky（`commit-msg` hook）

## 5.1 工作流程與常用指令

- 全專案本地開發：`pnpm dev`
- 品質檢查彙總（lint + build + test）：`pnpm check:ci`
- CI lint 檢查：`pnpm check:lint`
- 維護守門（server `max-lines` 例外檢查）：`pnpm maint:check`
- CI build 檢查：`pnpm check:build`
- CI test 檢查：`pnpm check:test`
- 掃描基準（1000/3000 檔，預設 baseline）：`pnpm --filter web benchmark:scan`
- 建議固定 benchmark 參數（可比性）：`--seed <int>`、`--workspace-root /benchmark`
- CI SARIF（本地模擬）：`pnpm --filter web sarif:ci -- --output /tmp/confession.sarif.json`
- 效能回歸比對：`node web/scripts/check-benchmark-regression.mjs --baseline <baseline.json> --current <current.json>`
- 程式碼格式化：`pnpm format`
- 格式檢查：`pnpm format:check`
- Extension 打包 VSIX：`pnpm --filter confession-extension package`
- CLI 本地執行：`node confession-cli/bin/confession.js --help`
- CLI DAST 驗證：`node confession-cli/bin/confession.js verify web --url <http(s)://target>`
- CLI 測試：`pnpm --filter confession-cli test`
- Commit range 檢查：`pnpm commitlint:range --from <from> --to <to>`

## 6. API 規範

Hono app 由 `web/src/server/index.ts` 統一掛載於 `/api`。

目前路由：

- `GET /api/health`
- `GET /api/advice/latest`
- `GET /api/config`
- `PUT /api/config`
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

規範重點：

- 請求驗證使用 `zod/v4` + `@hono/zod-validator`
- 錯誤回應格式：`{ error: string, details?: unknown }`
- 儲存來源固定為 `.confession/*.json`
- project root 解析：`CONFESSION_PROJECT_ROOT`（有值時）否則 `process.cwd()`
- 掃描流程需保留去重（fingerprint）與背景執行
- `agentic_beta` 失敗需自動回退 `baseline`
- `/api/scan/status/:id`、`/api/scan/recent` 需回傳 `engineMode`、`errorCode`、fallback 欄位
- `/api/scan/status/:id`、`/api/scan/recent` 讀路徑需優先命中記憶體熱索引，未命中再回退 FileStore
- `/api/scan/stream/:id` 需：
  - 回傳 `text/event-stream`
  - `scan_progress` 事件附帶遞增 `id`
  - 支援 `Last-Event-ID` 以利中斷續傳
  - 每 15 秒發送 `keepalive` 事件
- `/api/export` `format` 需支援：`json` / `csv` / `markdown` / `pdf` / `sarif`
- `/api/export` request body 需支援 `locale?: 'zh-TW' | 'zh-CN' | 'en'`
- `/api/export` 未帶 `locale` 時，後端需使用 `config.ui.language` 解析；`auto` 或不可判定時回退 `zh-TW`
- `sarif` 匯出需符合 `2.1.0`，包含 `partialFingerprints.stableFingerprint`
- `sarif` 匯出需套用 `maxResults`/`maxBytes` guard；發生截斷時以 `X-Confession-Sarif-Warning` 回傳警告
- 漏洞事件需支援 `scan_relocated`，並帶 `fromFilePath/fromLine/toFilePath/toLine`
- 工作區快照收斂需 fingerprint-aware：`filePath` 不在快照且 `stableFingerprint` 未出現時才 auto-fix
- 掃描引擎 metrics 需包含 `fs_write_ops_per_scan`、`db_lock_wait_ms_p95`、`db_lock_hold_ms_p95`、`db_lock_timeout_count`
- 狀態查詢 metrics 需包含 `status_cache_hit_rate`、`status_cache_reload_ms`、`status_read_elapsed_ms`

## 7. Extension 規範

- 打包：esbuild，格式 CJS，`external: vscode`
- 指令前綴：`codeVuln.*`
- 設定前綴：`confession.*`
- LLM provider：`gemini` / `nvidia`（預設 `nvidia`）
- 嚴重度映射：critical/high → Error，medium → Warning，low/info → Information
- 儲存觸發：`onDidSaveTextDocument` + debounce（預設 500ms）
- 手動掃描（當前檔案/工作區）需使用 `forceRescan=true`
- 僅處理：Go / JavaScript / TypeScript（含 React 變體）
- Webview 與 Extension 以 postMessage 雙向同步配置與狀態
- 狀態列需區分掃描失敗，不得在失敗時顯示「安全」
- `scan-client` 需以 SSE（`/api/scan/stream/:id`）作為主通道
- 只有在 SSE 不可用或中斷時才降級輪詢，並採退避重試（500ms→1s→2s→5s→10s）
- 逾時後需呼叫 `POST /api/scan/cancel/:id` 主動中止後端任務

ignore / config 同步規範：

- Ignore 不使用 `.confessionignore`
- Ignore 僅存在 `.confession/config.json.ignore.paths/types`
- 設定頁儲存時，需同步寫入 VS Code settings 與 `.confession/config.json`
- 語言設定需支援 `confession.ui.language = auto|zh-TW|zh-CN|en`，並同步到 `.confession/config.json.ui.language`
- Extension 需監聽 `**/.confession/config.json` 的 create/change/delete 並推送 `config_updated`
- `scanWorkspace` 與 onSave 忽略判斷需 root-aware：依檔案所屬 root 套用對應 `.confession/config.json`

## 8. 程式碼規範

- ESLint flat config + Prettier（根層級）
- lint script 必須使用 `--max-warnings=0`
- `unused-imports/*`、`simple-import-sort/*`、`no-console` 一律為 error
- 啟用 `@typescript-eslint/consistent-type-imports`（error）
- `max-lines`（資料邏輯目錄）：
  - `web/src/server/**`：600（不含 `*.test.*`）
  - `extension/src/**`：600（不含 `*.test.*`）
  - `confession-cli/bin/**`：600（不含 `*.test.*`）
- `web/src/server/**` 不允許 `max-lines` 例外；由 `pnpm maint:check` 守門
- `extension` / `confession-cli` 暫可保留少量例外，但需標記為「待拆分」
- 列舉以字串儲存 + Zod 驗證
- `PluginConfig` 需包含 `ui.language`（`auto|zh-TW|zh-CN|en`）
- 禁止無理由新增 runtime 依賴
- 禁止濫用 `@ts-ignore` / `eslint-disable`
- React 元件使用箭頭函式 + `React.FC<Props>`
- hooks 僅匯出 hooks；atoms 統一由 `@/libs/atoms` 直接引用，禁止在 hooks 內二次導出
- 漏洞冪等鍵：`[filePath, line, column, codeHash, type]`
- 穩定關聯鍵：`stableFingerprint`（用於 trend/advice/歷史關聯）
- 漏洞事件型別：`scan_detected | scan_relocated | review_saved | status_changed`
- 漏洞來源欄位：`source = "sast" | "dast"`
- Commit 訊息格式：`<emoji> <type>(<scope>): <description>`

## 9. 測試規範

- 測試框架：Vitest（web/extension）+ Node.js `node:test`（CLI）
- 屬性測試：fast-check
- 命名：
  - 單元測試：`<name>.test.ts`
  - 屬性測試：`<name>.pbt.test.ts`
  - CLI 測試：`<name>.test.js`
- 全部測試（根層級）：`pnpm test`
- web 測試：`pnpm --filter web test`
- extension 測試：`pnpm --filter confession-extension test`
- CLI 測試：`pnpm --filter confession-cli test`
- FileStore 需覆蓋讀寫、transaction 一致性與 upsert 冪等
- FileStore 需覆蓋 relocation match（同 fingerprint 位移不重建）與 `scan_relocated` 事件
- 匯出需覆蓋 SARIF 2.1.0 輸出與 `stableFingerprint` 欄位
- 匯出需覆蓋 SARIF `maxResults`/`maxBytes` guard 與 warning
- 掃描進度需覆蓋 SSE keepalive 與斷線降級輪詢流程
- 效能基準需可重跑並輸出 `scan_workspace_p95_ms`、`status_api_rps`
- benchmark regression 門檻：`scan_workspace_p95_ms > +15%` 或 `status_api_rps_p95 < -20%`
- CLI 需覆蓋：
  - `init` 建檔與重跑冪等
  - `scan` 成功 / 失敗 / 逾時 cancel / SIGINT cancel
  - `list` 篩選與空結果輸出
  - `status` 最新任務與 fallback 摘要
  - `verify web`（工具存在成功路徑、工具缺失錯誤路徑）
  - 參數驗證（未知旗標與非法列舉值）

## 10. CI 與 Commit 檢查

- CI workflow：
  - `.github/workflows/ci.yml`
  - `.github/workflows/code-scanning.yml`
  - `.github/workflows/benchmark-regression.yml`
- `code-scanning.yml`：安全相關路徑觸發，產生 SARIF 並上傳 GitHub Code Scanning（category=`confession-{engineMode}-{depth}`）
  - workflow permissions 需包含 `actions: read`、`security-events: write`
  - PR 僅保留 SARIF artifact；`upload-sarif` 僅在 push 執行
  - `upload-sarif` 採 non-blocking（`continue-on-error`），避免 repo 尚未啟用 Code Scanning 時阻擋 CI
- `benchmark-regression.yml`：夜間排程 + 手動觸發 + server 路徑相關 PR/Push 觸發，依 `BENCHMARK_ENFORCE_AFTER` 控制 warning-only/阻擋
  - server 啟動命令固定使用 `pnpm --filter web exec next start -p 3000 -H 127.0.0.1`
  - health check timeout 時需輸出 web server log 便於除錯
- CI 觸發：`pull_request(main)`、`push(main)` + `paths` 精準過濾
- CI 需注入 Turborepo Remote Cache 環境變數：
  - `TURBO_TOKEN`
  - `TURBO_TEAM`
  - `TURBO_REMOTE_CACHE_SIGNATURE_KEY`
  - `TURBO_TELEMETRY_DISABLED=1`
- `lint` job：`pnpm install --frozen-lockfile` + `pnpm check:lint`
- `build` job：`pnpm install --frozen-lockfile` + `pnpm check:build`
- `test` job：`pnpm install --frozen-lockfile` + `pnpm check:test`
- `quality` job：聚合 gate（`needs: lint/build/test`），保留 required check 名稱
- `commit-check` job：`pnpm commitlint:range --from <from> --to <to>`
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

# 薄暮靜析的告解詩 — Confession

> Before the Light Fades, the Code Speaks.

基於 LLM 的 VS Code 靜態程式碼漏洞分析插件。透過 AST 解析與 Gemini API 語義分析，偵測 Go、JavaScript、TypeScript 中的安全漏洞，並提供修復建議。

## 設計哲學

- **靜態而非執行** — 不執行使用者程式碼，僅分析結構與語法
- **觀測而非干預** — 觀察程式碼的結構、流程與意圖
- **揭露而非審判** — 揭示潛在問題，不做決定

## 專案結構

```
confession/
├── .github/workflows/ # GitHub Actions CI
├── .husky/            # Git hooks（commit-msg）
├── extension/       # VS Code 擴充套件（esbuild → CJS）
├── web/             # Next.js App Router + Hono 後端
├── go-analyzer/     # Go AST → WASM 分析器
├── commitlint.config.mjs # commit 訊息規則
├── turbo.json       # Turborepo 設定
└── pnpm-workspace.yaml
```

## 技術棧

| 層級 | 選擇 |
|------|------|
| 套件管理 | pnpm 9.x + Turborepo |
| 語言 | TypeScript strict mode |
| 前端 | Next.js App Router + Tailwind CSS + shadcn/ui |
| 狀態管理 | Jotai + Bunshi |
| 資料取得 | React Query + Axios |
| 圖表 | Recharts |
| 後端 | Hono（Next.js catch-all `/api/[...route]`） |
| 驗證 | Zod + @hono/zod-validator |
| 資料庫 | Prisma + SQLite（PostgreSQL 相容） |
| 擴充套件打包 | esbuild（CJS, external: vscode） |
| LLM | Google Gemini API |
| 測試 | Vitest + fast-check（PBT） |

## 前置需求

- Node.js ≥ 18
- pnpm 9.x
- Go 1.21+（僅編譯 WASM 時需要）

## 快速開始

```bash
# 安裝依賴
pnpm install

# 資料庫初始化
pnpm --filter web exec prisma generate
pnpm --filter web exec prisma migrate dev

# 啟動開發伺服器
pnpm dev
```

## 環境變數

在 `web/.env.local` 中設定：

```env
DATABASE_URL="file:./dev.db"
GEMINI_API_KEY="your-gemini-api-key"
```

## 常用指令

```bash
# 安裝依賴
pnpm install

# 開發模式
pnpm dev

# 建置
pnpm build

# Lint
pnpm lint

# 測試
pnpm test

# CI 檢查（lint + build + test）
pnpm check:ci

# Commit 訊息檢查（最近一筆）
pnpm commitlint --from HEAD~1 --to HEAD

# 格式化
pnpm format
```

## CI 與 Commit 規範

- CI 使用 GitHub Actions，workflow 位於 `.github/workflows/ci.yml`
- 觸發條件：`pull_request(main)` 與 `push(main)`
- `quality` job 執行 `pnpm check:ci`
- `commit-check` job 針對 commit range 執行 `pnpm commitlint:range`
- 本機提交會由 `.husky/commit-msg` 觸發檢查

### Commit 格式

提交訊息必須符合：

```text
<emoji> <type>(<scope>): <description>
```

`type` 僅允許：`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`，且 `scope` 必填。

## Go WASM 分析器

```bash
cd go-analyzer
make all    # 編譯 WASM + 複製 wasm_exec.js 到 web/public/
make clean  # 清理產物
```

## 擴充套件打包

```bash
cd extension
pnpm build              # 建置
pnpm package            # 打包 .vsix
```

## API 路由

| 路由 | 方法 | 說明 |
|------|------|------|
| `/api/scan` | POST | 觸發掃描 |
| `/api/scan/status/:id` | GET | 掃描進度 |
| `/api/vulnerabilities` | GET | 漏洞列表（篩選/排序/分頁） |
| `/api/vulnerabilities/stats` | GET | 統計數據 |
| `/api/vulnerabilities/:id` | PATCH | 更新狀態/歸因 |
| `/api/export` | POST | 導出報告（JSON/CSV） |

## 偵測能力

### JS/TS（TypeScript Compiler API）

- `eval()` / `new Function()` / `setTimeout(string)`
- `innerHTML` / `outerHTML` 賦值
- `req.query` / `req.body` / `req.params` 直接存取
- `__proto__` / `Object.setPrototypeOf` / `prototype` 修改
- 敏感關鍵詞索引（password、secret、token 等）

### Go（WASM + go/ast）

- `exec.Command` / `exec.CommandContext`（命令注入）
- `sql.Query` / `sql.Exec` 字串拼接（SQL 注入）
- `os.Setenv` / `os.Getenv` 敏感環境變數
- `md5` / `sha1` 不安全雜湊
- `http.ListenAndServe`（無 TLS）
- HTTP 回應未處理錯誤

### LLM 語義分析（Gemini API）

- quick：僅高風險 AST 點位觸發（條件式 LLM）
- standard：交互點檔案聚合分析（每檔案單次請求）
- deep：完整檔案宏觀掃描（每檔案單次請求）
- Prompt 指紋快取，避免重複請求
- 結構化 JSON 輸出（漏洞類型、CWE 編號、修復建議）

## VS Code 擴充套件功能

- **Diagnostics**：問題面板即時高亮漏洞（critical/high → Error, medium → Warning, low/info → Info）
- **Hover**：懸浮顯示漏洞詳情與修復建議
- **Code Actions**：一鍵修復 / 忽略
- **狀態列**：分析狀態指示（分析中 / 完成 / 發現風險）
- **自動分析**：檔案儲存時 debounce 觸發增量分析
- **Webview 儀表盤**：嵌入 Next.js 安全儀表盤

### 擴充套件指令

- `Confession: Scan Current File` — 掃描當前檔案
- `Confession: Scan Workspace` — 掃描工作區
- `Confession: Open Security Dashboard` — 開啟安全儀表盤

### 擴充套件設定（`confession.*`）

| 設定 | 預設值 | 說明 |
|------|--------|------|
| `confession.api.baseUrl` | `http://localhost:3000` | API 伺服器位址 |
| `confession.api.mode` | `local` | 連線模式（local/remote） |
| `confession.llm.apiKey` | — | Gemini API Key |
| `confession.analysis.triggerMode` | `onSave` | 觸發方式（onSave/manual） |
| `confession.analysis.depth` | `standard` | 分析深度（quick/standard/deep） |
| `confession.analysis.debounceMs` | `500` | 防抖延遲（ms） |
| `confession.ignore.paths` | `[]` | 忽略的檔案路徑 |
| `confession.ignore.types` | `[]` | 忽略的漏洞類型 |

## 測試

專案使用 Vitest + fast-check 進行單元測試與屬性基礎測試（PBT）。

```bash
# 執行所有測試
pnpm test

# 執行單一測試檔案
pnpm --filter web exec vitest run src/server/analyzers/jsts.test.ts
```

### 正確性屬性（PBT）

| 屬性 | 驗證內容 |
|------|----------|
| P1 | AST 分析器完整性 — 含已知模式的代碼必須返回對應交互點 |
| P2 | 關鍵詞索引正確性 — 含敏感關鍵詞的檔案必須出現在索引中 |
| P3 | 漏洞記錄冪等性 — 同一漏洞插入兩次只存一條 |
| P4 | Agent 消息序列化往返 — JSON 序列化反序列化不丟失 |
| P5 | LLM 響應解析健壯性 — 合法 JSON 成功解析，非法返回 null |
| P6 | Orchestrator 語言路由 — Go 到 Go Agent，JS/TS 到 JS/TS Agent |
| P7 | Diagnostics 嚴重等級映射 — critical/high → Error, medium → Warning |
| P8 | Debounce 正確性 — 窗口內多次保存只觸發一次分析 |

## 授權

MIT

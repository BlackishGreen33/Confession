---
inclusion: always
---

# 專案結構

```
confession/
├── .github/
│   └── workflows/
│       └── ci.yml         # GitHub Actions：quality + commit-check
├── .husky/
│   └── commit-msg         # 本機 commit 訊息檢查 hook
├── extension/              # VSCode 擴充套件（esbuild → CommonJS）
│   ├── src/extension.ts    # 入口：activate/deactivate、指令、providers
│   ├── src/diagnostics.ts  # DiagnosticsProvider + HoverProvider + CodeActionProvider
│   ├── src/file-watcher.ts # 檔案儲存監聽 + debounce 增量分析觸發
│   ├── src/scan-client.ts  # 共用掃描 API 客戶端（觸發掃描、輪詢、取得漏洞）
│   ├── src/monitoring.ts   # 嵌入式監測代碼產生器（修復後日誌上報）
│   ├── src/webview.ts      # Webview 面板 + postMessage
│   ├── src/status-bar.ts   # 狀態列指示器
│   └── src/types.ts        # 通訊協議型別
├── web/                    # Next.js (App Router) + Hono 後端
│   ├── src/generated/       # Prisma 產生型別與 client
│   ├── src/app/            # 頁面路由
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx               # / 儀表盤首頁
│   │   ├── loading.tsx
│   │   ├── vulnerabilities/
│   │   │   ├── page.tsx           # /vulnerabilities 漏洞列表
│   │   │   └── loading.tsx
│   │   ├── settings/
│   │   │   ├── page.tsx           # /settings 設定頁
│   │   │   └── loading.tsx
│   │   ├── vulnerability-detail/
│   │   │   ├── page.tsx           # /vulnerability-detail 漏洞詳情（Editor_Panel）
│   │   │   └── loading.tsx
│   │   └── api/[...route]/ # Hono catch-all
│   ├── src/common/         # @/ 別名目標
│   │   ├── components/     # UI 元件（feature folders + shadcn 包裝）
│   │   │   ├── dashboard/main.tsx
│   │   │   ├── vulnerability-list/main.tsx
│   │   │   ├── vulnerability-detail/main.tsx
│   │   │   ├── settings/main.tsx
│   │   │   ├── loading/page-loading.tsx
│   │   │   ├── theme-toggle.tsx
│   │   │   ├── elements/   # 通用原子元件（cyber-select.tsx、cyber-dropdown-menu.tsx）
│   │   │   └── ui/         # shadcn 元件（含 accordion/sheet/skeleton/select/dropdown/tooltip/sonner）
│   │   ├── hooks/          # React Query hooks + Jotai atoms（同檔共置）+ use-extension-bridge.ts（擴充套件橋接）
│   │   ├── motion/         # Framer Motion token、variants、provider、reveal
│   │   ├── libs/           # types.ts, atoms.ts, api-client.ts, debounce.ts, ui-messages.ts, dashboard-insights.ts
│   │   ├── providers.tsx   # Theme + Motion + Query + Jotai 統一 provider
│   │   └── utils/          # cn() 等工具函數
│   └── src/server/         # @server/ 別名目標 — Hono app, routes/, agents/, analyzers/, llm/, mcp/, db.ts, cache.ts, monitoring.ts
│       ├── routes/         # Hono 路由模組：config.ts, scan.ts, vulnerabilities.ts, export.ts, monitoring.ts（health 由 index.ts + health-score.ts）
│       ├── health-score.ts # 健康評分 V2 計算（Exposure/Remediation/Quality/Reliability）
│       ├── agents/agentic-beta/ # Beta 多代理：planner/skills/analyst/critic/judge/context-bundle
│       └── mcp/            # MCP broker + policy（白名單與能力管制）
├── go-analyzer/            # Go AST → WASM
│   ├── main.go             # 入口：go/parser + go/ast 遍歷，WASM 橋接
│   ├── go.mod              # Go module 定義
│   └── Makefile            # GOOS=js GOARCH=wasm 編譯腳本
├── package.json            # 根 pnpm workspace
├── commitlint.config.mjs   # commitlint 規則（emoji + conventional + 必填 scope）
├── pnpm-workspace.yaml     # workspaces: web, extension
├── turbo.json
└── README.md               # 專案文件
```

補充（近期資料模型變更）：
- `web/prisma/schema.prisma` 的 `ScanTask` 新增 `fallbackUsed/fallbackFrom/fallbackTo/fallbackReason`，用於記錄 agentic 自動回退 baseline 的執行情況。

補充（近期前端架構變更）：
- 新增 route 級 `loading.tsx`（首頁/漏洞列表/設定/漏洞詳情），統一使用 skeleton + motion。
- 新增 `web/src/common/motion/*`，統一 Framer Motion token 與 reduced-motion 行為。
- `dashboard`、`vulnerability-list`、`vulnerability-detail`、`settings` 改為 feature folder 入口（`main.tsx`），原檔案改 thin re-export。
- 新增 `web/src/common/components/theme-toggle.tsx`，提供 `light/dark/system` 主題切換。

## 邊界規則

- 前端程式碼僅在 `web/` 內
- 擴充套件程式碼僅在 `extension/` 內
- 共用型別放 `web/src/common/libs/types.ts`
- 目錄巢狀最多 3 層

## 路徑別名

- `@/` → `web/src/common/`
- `@app/` → `web/src/app/`
- `@server/` → `web/src/server/`（`@server` 不帶斜線指向 `index.ts`）

## 命名慣例

- 目錄與檔案：`kebab-case`（go-analyzer, api-client.ts）
- 類別/介面：`PascalCase`（VulnerabilityStore）
- 函式/變數：`camelCase`（useVulnerabilities）
- 擴充套件指令：`codeVuln.*` 前綴
- 擴充套件設定：`confession.*` 前綴

---
inclusion: always
---

# 專案結構

```
confession/
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
│   │   ├── page.tsx        # / 儀表盤首頁
│   │   ├── vulnerabilities/page.tsx  # /vulnerabilities 漏洞列表
│   │   ├── settings/page.tsx         # /settings 設定頁
│   │   ├── vulnerability-detail/page.tsx  # /vulnerability-detail 漏洞詳情（Editor_Panel）
│   │   └── api/[...route]/ # Hono catch-all
│   ├── src/common/         # @/ 別名目標
│   │   ├── components/     # UI 元件（含 cyber-dropdown-menu.tsx 共用 cyber 下拉）與 components/ui/dropdown-menu.tsx（shadcn Radix Portal 下拉）
│   │   ├── hooks/          # React Query hooks + Jotai atoms（同檔共置）+ use-extension-bridge.ts（擴充套件橋接）
│   │   ├── libs/           # types.ts, atoms.ts, api-client.ts, debounce.ts
│   │   └── utils/          # cn() 等工具函數
│   └── src/server/         # @server/ 別名目標 — Hono app, routes/, agents/, analyzers/, llm/, db.ts, cache.ts, monitoring.ts
│       └── routes/         # Hono 路由模組：config.ts, scan.ts, vulnerabilities.ts, export.ts, monitoring.ts（health 由 index.ts 宣告）
├── go-analyzer/            # Go AST → WASM
│   ├── main.go             # 入口：go/parser + go/ast 遍歷，WASM 橋接
│   ├── go.mod              # Go module 定義
│   └── Makefile            # GOOS=js GOARCH=wasm 編譯腳本
├── package.json            # 根 pnpm workspace
├── pnpm-workspace.yaml     # workspaces: web, extension
├── turbo.json
└── README.md               # 專案文件
```

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

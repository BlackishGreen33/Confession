---
inclusion: always
---

# 專案結構

```text
confession/
├── .github/
│   └── workflows/
│       └── ci.yml         # GitHub Actions：quality + commit-check
├── .husky/
│   └── commit-msg         # 本機 commit 訊息檢查 hook
├── confession-cli/        # npm 全域 CLI（bin: confession）
│   └── bin/confession.js  # init / scan / list / status
├── extension/             # VSCode 擴充套件（esbuild → CommonJS）
│   ├── src/extension.ts
│   ├── src/diagnostics.ts
│   ├── src/file-watcher.ts
│   ├── src/ignore-file.ts # .confession/config.json 讀寫與 root-aware ignore 解析
│   ├── src/scan-client.ts
│   ├── src/monitoring.ts
│   ├── src/webview.ts
│   ├── src/status-bar.ts
│   └── src/types.ts
├── web/                   # Next.js (App Router) + Hono 後端
│   ├── src/app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── page.tsx
│   │   ├── loading.tsx
│   │   ├── vulnerabilities/
│   │   ├── settings/
│   │   ├── vulnerability-detail/
│   │   └── api/[...route]/
│   ├── src/common/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── motion/
│   │   ├── libs/
│   │   ├── providers.tsx
│   │   └── utils/
│   └── src/server/
│       ├── routes/
│       ├── agents/
│       ├── analyzers/
│       ├── llm/
│       ├── mcp/
│       ├── db.ts          # FileStore（.confession）+ SQLite 一次性遷移
│       ├── advice-gate.ts
│       ├── health-score.ts
│       └── monitoring.ts
├── go-analyzer/
├── commitlint.config.mjs
├── package.json
├── pnpm-workspace.yaml    # workspaces: web, extension, confession-cli
├── turbo.json
└── README.md
```

## `.confession` 專案本地儲存契約

每個專案根目錄使用 `.confession/` 作為唯一持久化來源：

- `.confession/config.json`
- `.confession/vulnerabilities.json`
- `.confession/vulnerability-events.json`
- `.confession/scan-tasks.json`
- `.confession/advice-snapshots.json`
- `.confession/advice-decisions.json`
- `.confession/meta.json`

`meta.schemaVersion` 目前為 `file-store-v1`。

## 邊界規則

- 前端程式碼僅在 `web/` 內
- 擴充套件程式碼僅在 `extension/` 內
- CLI 程式碼僅在 `confession-cli/` 內
- 共用型別放 `web/src/common/libs/types.ts`

## 路徑別名

- `@/` → `web/src/common/`
- `@app/` → `web/src/app/`
- `@server/` → `web/src/server/`（`@server` 不帶斜線指向 `index.ts`）

## 命名慣例

- 目錄與檔案：`kebab-case`
- 類別/介面：`PascalCase`
- 函式/變數：`camelCase`
- 擴充套件指令：`codeVuln.*`
- 擴充套件設定：`confession.*`

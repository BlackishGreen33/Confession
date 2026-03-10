---
inclusion: always
---

# 專案結構

```text
confession/
├── .github/
│   └── workflows/
│       ├── ci.yml                   # GitHub Actions：lint/build/test + quality + commit-check
│       ├── code-scanning.yml        # 產生 SARIF 並上傳 GitHub Code Scanning
│       └── benchmark-regression.yml # 夜間/手動掃描效能回歸守門
├── .husky/
│   └── commit-msg         # 本機 commit 訊息檢查 hook
├── confession-cli/        # npm 全域 CLI（bin: confession）
│   └── bin/
│       ├── confession.js       # init / scan / list / status / verify web
│       └── confession.test.js  # Node node:test 覆蓋 CLI 主流程
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
│   ├── benchmarks/
│   │   └── scan-baseline.json       # benchmark:scan 基線
│   ├── scripts/
│   │   ├── code-scanning-fixture.json
│   │   ├── generate-sarif-ci.mjs    # CI SARIF 產生器（category/限制）
│   │   └── check-benchmark-regression.mjs
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
│       │   └── renderers.ts
│       ├── llm/
│       ├── mcp/
│       ├── storage/
│       │   ├── bootstrap.ts
│       │   ├── client.ts                # storage façade（薄入口）
│       │   ├── client-core.ts           # FileStore 核心組裝層
│       │   ├── query-engine.ts
│       │   ├── repository.ts
│       │   ├── snapshot-codec.ts
│       │   ├── snapshot-io.ts
│       │   ├── lock.ts
│       │   ├── types.ts
│       │   ├── upsert-vulnerabilities-helpers.ts
│       │   ├── upsert-vulnerabilities.ts# 漏洞寫入與 relocation
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
- `.confession/analysis-cache.json`
- `.confession/meta.json`

`meta` 目前至少需包含：

- `schemaVersion = "file-store-v1"`
- `analysisCacheVersion = "analysis-cache-v1"`
- `stableFingerprintVersion = "stable-fingerprint-v1"`

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

<div align="center">

# Confession

### Before the Light Fades, the Code Speaks.

[![CI](https://github.com/BlackishGreen33/Confession/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/BlackishGreen33/Confession/actions/workflows/ci.yml)
[![Code Scanning](https://github.com/BlackishGreen33/Confession/actions/workflows/code-scanning.yml/badge.svg?branch=main)](https://github.com/BlackishGreen33/Confession/actions/workflows/code-scanning.yml)
[![Benchmark Regression](https://github.com/BlackishGreen33/Confession/actions/workflows/benchmark-regression.yml/badge.svg?branch=main)](https://github.com/BlackishGreen33/Confession/actions/workflows/benchmark-regression.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0F766E.svg)](./LICENSE)
[![VS Code ^1.85](https://img.shields.io/badge/VS_Code-%5E1.85-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![Next.js 16.1](https://img.shields.io/badge/Next.js-16.1.6-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Tailwind CSS 4.1](https://img.shields.io/badge/Tailwind_CSS-4.1.10-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Hono 4.11](https://img.shields.io/badge/Hono-4.11.9-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm 9](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript Strict](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[English](./README.md) | **繁體中文** | [简体中文](./README.zh-CN.md)

</div>

## 概覽

Confession 是以 VS Code 為核心的靜態安全分析工具。它把 AST 規則分析、LLM 語義審視、Webview 儀表板、Hono API 與 CLI 串成同一套流程，並把資料統一保存到專案本地的 `.confession/` 契約中。

核心原則很明確：不執行使用者程式碼、不主動干預工作區，只揭露風險訊號與修復建議。

## 亮點

- **靜態優先**：只做 AST 與模型分析，不做 runtime 執行。
- **雙引擎掃描**：預設使用 `agentic`，失敗時同一 task 內自動回退 `baseline`。
- **VS Code 原生體驗**：Diagnostics、Hover、Code Actions、Status Bar 與 Webview 儀表板共用同一份狀態。
- **事件驅動 AI 建議**：只有在掃描或審核事件後，且通過門檻、cooldown 與去重規則時才會觸發。
- **本地檔案儲存**：設定、漏洞、任務、建議快照與分析快取都保存在 `.confession/*.json`。
- **匯出完整**：內建 `json`、`csv`、`markdown`、`pdf`、`sarif`。

## 重要提示

> [!IMPORTANT]
> Confession 嚴格限制在靜態分析範圍內，不會執行使用者程式碼，也不會啟動目標服務或做 runtime 注入。

> [!TIP]
> 日常使用建議以 `standard` 為主，`quick` 適合儲存後即時回饋，`deep` 則保留給發版前檢查、稽核或完整安全 review。

> [!NOTE]
> 預設掃描引擎是 `agentic`，若失敗後端會在同一個 task 內自動回退 `baseline`。`pdf` 匯出實際回傳的是列印版 HTML，需要透過瀏覽器或 Webview 列印流程另存為 PDF。

## 快速開始

### 前置需求

- Node.js `>= 18`
- pnpm `9.x`
- Go `1.21+`，僅在重建 Go WASM analyzer 時需要

### 啟動專案

```bash
pnpm install
pnpm dev
```

### LLM 金鑰

在 `web/.env.local` 至少提供一組 provider 金鑰：

```env
GEMINI_API_KEY="<set-in-web-env-local>"
NVIDIA_API_KEY="<set-in-web-env-local>"
```

### CLI 範例

```bash
node confession-cli/bin/confession.js init
node confession-cli/bin/confession.js scan
node confession-cli/bin/confession.js list --status open
node confession-cli/bin/confession.js status
```

## 掃描模式

| 模式       | LLM 行為                          | 適合情境         |
| ---------- | --------------------------------- | ---------------- |
| `quick`    | 只對高風險 AST 點位條件式呼叫 LLM | 儲存後快速回饋   |
| `standard` | 每檔案一次聚合分析                | 日常主流程       |
| `deep`     | 每檔案一次完整掃描                | 發版前或深度檢查 |

## 常用指令

| 用途           | 指令                                                                |
| -------------- | ------------------------------------------------------------------- |
| 本地開發       | `pnpm dev`                                                          |
| Lint           | `pnpm lint`                                                         |
| Build          | `pnpm build`                                                        |
| 全部測試       | `pnpm test`                                                         |
| CI 等價檢查    | `pnpm check:ci`                                                     |
| Extension 打包 | `pnpm --filter confession-extension package`                        |
| CLI 測試       | `pnpm --filter confession-cli test`                                 |
| 掃描 benchmark | `pnpm --filter web benchmark:scan`                                  |
| 產生 SARIF     | `pnpm --filter web sarif:ci -- --output /tmp/confession.sarif.json` |

## 語系與匯出

- Webview 支援：`zh-TW`、`zh-CN`、`en`
- 預設語系：`zh-TW`
- 設定鍵：`confession.ui.language = auto | zh-TW | zh-CN | en`
- `auto` 會持續跟隨宿主語言
- `/api/export` 支援：`json`、`csv`、`markdown`、`pdf`、`sarif`
- 未指定 `locale` 時，後端依 `config.ui.language` 解析，無法判定時回退 `zh-TW`

## 進一步閱讀

完整 API、架構、偵測覆蓋範圍、CI 規則與儲存契約，請參考英文主版 README：  
[README.md](./README.md)

## 授權

本專案採用 MIT License，詳見 [LICENSE](./LICENSE)。

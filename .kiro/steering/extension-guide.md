---
inclusion: fileMatch
fileMatchPattern: "extension/**/*"
---

# 擴充套件開發指南

VSCode 擴充套件，使用 esbuild 打包為 CommonJS，external: vscode。

## 行為規範

- 嚴重度對應：critical/high → Error、medium → Warning、low/info → Information
- 檔案儲存監聽：`onDidSaveTextDocument` + 500ms 防抖，僅 Go/JS/TS 檔案
- 手動掃描（當前檔案/工作區）需使用 `forceRescan=true`，避免被未變更快取跳過
- Webview：嵌入 Next.js 應用，雙向 postMessage
- 狀態列：分析狀態（分析中 / 完成 / 發現風險 / 分析失敗）
- AI 呼叫策略：僅被動觸發（手動掃描或 onSave 事件），不得主動背景連續呼叫模型 API
- LLM provider：支援 `gemini` / `nvidia`，預設 `nvidia`
- 分析深度語義：
  - `quick`：AST + 條件式 LLM（僅高風險 AST 點位）
  - `standard`：AST + 檔案聚合 LLM（每檔案一次）
  - `deep`：AST + 檔案聚合 LLM + 全檔宏觀掃描（每檔案一次）
- Beta 開關：`confession.analysis.betaAgenticEnabled`
  - `true`：預設走 `agentic_beta`
  - `false`：預設走 `baseline`
- 重試策略：
  - `掃描當前文件` / `onSave`：不重試（快速回應）
  - `掃描整個工作區`：逾時或 HTTP 503（UNAVAILABLE）重試 1 次
  - 若 `agentic_beta` 失敗且 `errorCode=BETA_ENGINE_FAILED`：
    - 手動掃描顯示互動提示，允許改用 baseline 重試
    - `onSave` 僅顯示非阻塞提示，不可彈 modal

## 指令與設定前綴

- 擴充套件指令：`codeVuln.*`
- 擴充套件設定：`confession.*`

### 目前指令

- `codeVuln.scanFile`
- `codeVuln.scanWorkspace`
- `codeVuln.openDashboard`
- `codeVuln.showDashboard`
- `codeVuln.showVulnerabilities`
- `codeVuln.showSettings`
- `codeVuln.ignoreVulnerability`

## 通訊協議

擴充套件與 webview 間使用 postMessage 通訊，型別定義於 #[[file:web/src/common/libs/types.ts]] 與 #[[file:extension/src/types.ts]]：

- **ExtToWebMsg**：擴充套件 → Webview
  - `config_updated`（推送配置）
  - `clipboard_paste`（回傳剪貼簿文字，作為 Cmd/Ctrl+V fallback）
  - `navigate_to_view`（切換到指定路由）
  - `vulnerability_detail_data`（推送單筆漏洞詳情）
  - `scan_progress`（推送掃描進度）
  - `vulnerabilities_updated`（通知漏洞資料已更新）
  - `operation_result`（回覆需 requestId 的操作成功/失敗與訊息，採跨視圖廣播）
- **WebToExtMsg**：Webview → 擴充套件
  - `request_scan`（請求掃描 file/workspace）
  - `apply_fix`（套用修復，需 `requestId`）
  - `ignore_vulnerability`（忽略漏洞，需 `requestId`）
  - `refresh_vulnerabilities`（請求全視圖漏洞資料刷新，需 `requestId`）
  - `navigate_to_code`（跳轉代碼位置）
  - `open_vulnerability_detail`（開啟 Editor Panel 詳情）
  - `update_config`（寫回 settings.json，需 `requestId`）
  - `export_pdf`（由 Extension 開啟外部列印預覽，需 `requestId`）
  - `request_config`（請求目前配置）
  - `paste_clipboard`（請求 Extension 讀取剪貼簿）

補充語義：
- `vulnerabilities_updated` 為「變更通知 + 可選資料」，Web 端需以 invalidate / refetch 為主，不依賴 payload 完整性。

### 配置雙向同步

- VS Code settings.json 變更 → `onDidChangeConfiguration` → `sendConfigUpdate()` → Webview Jotai atom
- Webview 設定面板儲存 → `update_config` postMessage → Extension `writeConfigToSettings()` → settings.json

## 檔案結構

- `src/extension.ts` — 入口：activate/deactivate、指令、providers
- `src/diagnostics.ts` — DiagnosticsProvider + HoverProvider + CodeActionProvider
- `src/file-watcher.ts` — 檔案儲存監聽 + debounce 增量分析觸發
- `src/scan-client.ts` — 掃描 API 客戶端（觸發掃描、輪詢、漏洞查詢）
- `src/monitoring.ts` — 監測代碼請求封裝
- `src/webview.ts` — Webview 面板 + postMessage
- `src/status-bar.ts` — 狀態列指示器
- `src/types.ts` — 通訊協議型別

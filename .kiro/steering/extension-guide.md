---
inclusion: fileMatch
fileMatchPattern: 'extension/**/*'
---

# 擴充套件開發指南

VSCode 擴充套件，使用 esbuild 打包為 CommonJS，external: vscode。

## 行為規範

- 嚴重度對應：critical/high → Error、medium → Warning、low/info → Information
- 檔案儲存監聽：`onDidSaveTextDocument` + 500ms 防抖，僅 Go/JS/TS 檔案
- 忽略規則主來源：`.confession/config.json.ignore.paths/types`
- `ignore.paths` 比對語義維持「字串包含」，不做 glob 擴展
- 設定頁儲存時需同步：
  - 回寫 VS Code `confession.*`（相容 fallback）
  - 回寫作用中 root 的 `.confession/config.json`
- 語言設定需支援 `confession.ui.language = auto|zh-TW|zh-CN|en`，並同步到 `.confession/config.json.ui.language`
- 讀取優先序：
  - 若作用中 root 有 `.confession/config.json`，設定頁與掃描使用該檔內容
  - 若不存在，回退 `confession.*` settings
- root 作用域判定：active editor 所屬 root，否則第一個 root
- 手動掃描（當前檔案/工作區）需使用 `forceRescan=true`
- Webview：嵌入 Next.js 應用，雙向 postMessage
- 狀態列：分析狀態（分析中 / 完成 / 發現風險 / 分析失敗）
- AI 呼叫策略：僅被動觸發（手動掃描或 onSave 事件），不得主動背景連續呼叫模型 API
- LLM provider：支援 `gemini` / `nvidia` / `minimax-cn`，預設 `nvidia`
- 分析深度語義：
  - `quick`：AST + 條件式 LLM（僅高風險 AST 點位）
  - `standard`：AST + 檔案聚合 LLM（每檔案一次）
  - `deep`：AST + 檔案聚合 LLM + 全檔宏觀掃描（每檔案一次）
- 掃描引擎：預設由後端以 `agentic` 啟動，失敗時自動回退 `baseline`
- 重試策略：
  - `掃描當前文件` / `onSave`：不重試（快速回應）
  - `掃描整個工作區`：逾時或 HTTP 503（UNAVAILABLE）重試 1 次
  - Extension 不顯示「是否改用 baseline」互動提示，回退行為完全由後端處理
- Timeout 與中斷策略：
  - `scan-client` 需優先使用 SSE（`/api/scan/stream/:id`）接收進度，輪詢僅做降級備援
  - SSE 中斷時才啟用輪詢，並採 500ms→1s→2s→5s→10s 退避重試
  - `掃描當前文件` timeout：8 分鐘
  - `onSave` timeout：4 分鐘
  - `掃描整個工作區` timeout：30 分鐘
  - 若最終逾時，Extension 必須呼叫 `POST /api/scan/cancel/:id` 主動中止後端任務
- 即時同步策略：
  - 單檔/增量掃描完成後，Extension 需同步拉取「全域開放漏洞」並廣播 `vulnerabilities_updated`
  - Web 端收到 `vulnerabilities_updated` 或 `scan_progress=completed/failed` 後，需立即重抓 `vulnerabilities`、`vuln-stats`、`vuln-trend`、`health`、`advice-latest`
  - Web 端刷新策略以事件驅動為主，不使用固定高頻輪詢；事件後僅允許有限次延遲補抓
  - 工作區掃描完成後，需先清空再重建 diagnostics，避免已刪除/已修復檔案殘留舊標記
- 工作區快照一致性：
  - `scanWorkspace` 送出 `/api/scan` 時需帶 `workspaceSnapshotComplete` 與 `workspaceRoots`
  - 若檔案數達查找上限（目前 5000），`workspaceSnapshotComplete=false`
  - 若 `navigate_to_code` 目標檔案不存在，需顯示非阻塞提示並引導使用者重新掃描工作區
- 工作區掃描忽略規則需 root-aware：依每個檔案所屬 root 套用對應 `.confession/config.json.ignore.paths`，不得跨 root 套用

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

擴充套件與 webview 間使用 postMessage 通訊，型別定義於 #[[file:web/src/common/libs/types.ts]] 與 #[[file:extension/src/types.ts]]。

- **ExtToWebMsg**：`config_updated`、`clipboard_paste`、`apply_vulnerability_preset`、`navigate_to_view`、`vulnerability_detail_data`、`scan_progress`、`vulnerabilities_updated`、`operation_result`
- **WebToExtMsg**：`request_scan`、`focus_sidebar_view`、`apply_fix`、`ignore_vulnerability`、`refresh_vulnerabilities`、`navigate_to_code`、`open_vulnerability_detail`、`update_config`、`export_pdf`、`request_config`、`paste_clipboard`

補充語義：

- `vulnerabilities_updated` 為「變更通知 + 可選資料」，Web 端需以 invalidate / refetch 為主，不依賴 payload 完整性。
- `focus_sidebar_view + preset` 需在切 view 成功後廣播 `apply_vulnerability_preset`，並採短暫重試避免 view 尚未 ready 時丟失訊息。

### 配置雙向同步

- VS Code settings.json 變更 → `onDidChangeConfiguration` → `sendConfigUpdate()` → Webview Jotai atom
- Webview 設定面板儲存 → `update_config` postMessage → Extension 同步寫入 settings 與 `.confession/config.json`
- `ui.language=auto` 代表持續跟隨宿主語言（VS Code / 瀏覽器），非一次性偵測
- Extension 需監聽 `**/.confession/config.json` 的 create/change/delete 事件並主動推送 `config_updated`

## 檔案結構

- `src/extension.ts` — 入口：activate/deactivate、指令、providers
- `src/diagnostics.ts` — DiagnosticsProvider + HoverProvider + CodeActionProvider
- `src/file-watcher.ts` — 檔案儲存監聽 + debounce 增量分析觸發
- `src/ignore-file.ts` — `.confession/config.json` 解析、讀寫與 root-aware 忽略規則解析
- `src/scan-client.ts` — 掃描 API 客戶端（觸發掃描、SSE 主通道、輪詢備援、漏洞查詢）
- `src/monitoring.ts` — 監測代碼請求封裝
- `src/webview.ts` — Webview 面板 + postMessage
- `src/status-bar.ts` — 狀態列指示器
- `src/types.ts` — 通訊協議型別

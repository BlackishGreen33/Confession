---
inclusion: fileMatch
fileMatchPattern: "extension/**/*"
---

# 擴充套件開發指南

VSCode 擴充套件，使用 esbuild 打包為 CommonJS，external: vscode。

## 行為規範

- 嚴重度對應：critical/high → Error、medium → Warning、low/info → Information
- 檔案儲存監聽：`onDidSaveTextDocument` + 500ms 防抖，僅 Go/JS/TS 檔案
- Webview：嵌入 Next.js 應用，雙向 postMessage
- 狀態列：分析狀態（分析中 / 完成 / 發現風險）

## 指令與設定前綴

- 擴充套件指令：`codeVuln.*`
- 擴充套件設定：`confession.*`

## 通訊協議

擴充套件與 webview 間使用 postMessage 通訊，型別定義於 #[[file:web/src/common/lib/types.ts]]：

- **ExtToWebMsg**：擴充套件 → Webview（`config_updated` 推送配置）
- **WebToExtMsg**：Webview → 擴充套件（`update_config` 寫回 settings.json、`request_config` 請求目前配置）

### 配置雙向同步

- VS Code settings.json 變更 → `onDidChangeConfiguration` → `sendConfigUpdate()` → Webview Jotai atom
- Webview 設定面板儲存 → `update_config` postMessage → Extension `writeConfigToSettings()` → settings.json

## 檔案結構

- `src/extension.ts` — 入口：activate/deactivate、指令、providers
- `src/diagnostics.ts` — DiagnosticsProvider + HoverProvider + CodeActionProvider
- `src/file-watcher.ts` — 檔案儲存監聽 + debounce 增量分析觸發
- `src/webview.ts` — Webview 面板 + postMessage
- `src/status-bar.ts` — 狀態列指示器
- `src/types.ts` — 通訊協議型別

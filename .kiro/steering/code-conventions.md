---
inclusion: always
---

# 程式碼規範

## 通用

- ESLint flat config + Prettier（根層級）
- lint script 必須使用 `--max-warnings=0`
- `unused-imports/*`、`simple-import-sort/*`、`no-console` 一律視為 error
- 啟用 `@typescript-eslint/consistent-type-imports`（error）
- `max-lines`（資料邏輯目錄）：
  - `web/src/server/**`：600（暫不含 `*.test.*`）
  - `extension/src/**`：600（暫不含 `*.test.*`）
  - `confession-cli/bin/**`：600（暫不含 `*.test.*`）
- `web/src/server/**` 不允許 `max-lines` 例外；由 `pnpm maint:check` 守門
- `extension` / `confession-cli` 暫可保留少量例外，但需在規則中註明「待拆分」
- 列舉以 `string` 儲存 + Zod 驗證（FileStore JSON 契約）
- 不要引入新的 runtime 依賴而不說明理由
- 避免 `@ts-ignore`，用正確的型別解決問題
- 所有可點擊 UI 元素需有明確互動游標：
  - 可操作：`cursor: pointer`
  - 不可操作（disabled/aria-disabled）：`cursor: not-allowed`
- 所有可點擊 UI 元素需提供一致互動動效：
  - `hover`：輕微高亮（亮度/邊框/背景）
  - `active`：按壓回饋（微縮放或位移）
  - `focus-visible`：可視焦點框（cyber primary ring）

## Commit 訊息

- 格式必須為：`<emoji> <type>(<scope>): <description>`
- `scope` 必填，不可省略
- `type` 僅允許：`feat`、`fix`、`docs`、`style`、`refactor`、`perf`、`test`、`build`、`ci`、`chore`、`revert`
- 本機由 `.husky/commit-msg` 執行 commitlint；CI 同步執行 commit range 檢查

## React 組件

必須使用箭頭函數 + `React.FC<Props>` 定義，禁止 `function` 聲明組件：

```tsx
// ✅ 正確
const MyComponent: React.FC<MyComponentProps> = ({ children }) => {
  return <div>{children}</div>;
};

// ❌ 禁止
export default function MyComponent({ children }: MyComponentProps) {
  return <div>{children}</div>;
}
```

## Hooks

hooks 僅負責匯出 React Query hooks；Jotai atoms 統一由 `@/libs/atoms` 直接引用，禁止在 hooks 做二次導出。

## 資料模型

皆定義於 #[[file:web/src/common/libs/types.ts]]：

- **InteractionPoint**：AST 輸出（type, language, location, codeSnippet, patternName, confidence）
- **Vulnerability**：完整記錄，含位置、分類（type, cweId, severity）、修復建議、歸因、狀態、`stableFingerprint`、`source(sast|dast)`
- **VulnerabilityEvent**：漏洞事件流（scan_detected / scan_relocated / review_saved / status_changed），relocation 事件需帶 `fromFilePath/fromLine/toFilePath/toLine`
- **ScanRequest**：files + depth + includeLlmScan
- **PluginConfig**：llm、analysis、ignore、api、ui 設定（`ui.language = auto|zh-TW|zh-CN|en`）
- **ExtToWebMsg / WebToExtMsg**：擴充套件與 webview 間的 postMessage 協議

冪等鍵：`[filePath, line, column, codeHash, type]`，其中 `codeHash = SHA-256(codeSnippet)`  
穩定關聯鍵：`stableFingerprint`（用於 trend/advice/歷史關聯，避免純行號位移造成 churn）

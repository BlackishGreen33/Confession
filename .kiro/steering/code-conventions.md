---
inclusion: always
---

# 程式碼規範

## 通用

- ESLint flat config + Prettier（根層級）
- 列舉以 `String` 儲存 + Zod 驗證（SQLite 不支援原生 enum）
- 不要引入新的 runtime 依賴而不說明理由
- 避免 `@ts-ignore`，用正確的型別解決問題

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

每個 hook 檔案同時匯出 React Query hooks 與相關 Jotai atoms（同檔共置）。

## 資料模型

皆定義於 #[[file:web/src/common/libs/types.ts]]：

- **InteractionPoint**：AST 輸出（type, language, location, codeSnippet, patternName, confidence）
- **Vulnerability**：完整記錄，含位置、分類（type, cweId, severity）、修復建議、歸因、狀態
- **ScanRequest**：files + depth + includeLlmScan
- **PluginConfig**：llm、analysis、ignore、api 設定
- **ExtToWebMsg / WebToExtMsg**：擴充套件與 webview 間的 postMessage 協議

冪等鍵：`[filePath, line, column, codeHash, type]`，其中 `codeHash = SHA-256(codeSnippet)`

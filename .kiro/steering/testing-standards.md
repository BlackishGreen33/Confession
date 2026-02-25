---
inclusion: fileMatch
fileMatchPattern: "**/*.test.*"
---

# 測試規範

- 測試框架：Vitest
- 設定檔：#[[file:web/vitest.config.ts]]
- 執行測試：`pnpm test`
- 單一檔案：`pnpm --filter web exec vitest run <path>`

## 慣例

- 測試檔案與原始檔案同目錄，命名為 `<name>.test.ts`
- 修 bug 時先寫失敗測試，再修復
- 不要 mock 不必要的東西，優先使用真實實作

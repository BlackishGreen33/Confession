---
inclusion: fileMatch
fileMatchPattern: "**/*.test.*"
---

# 測試規範

- 測試框架：Vitest + fast-check（屬性測試）
- 設定檔：#[[file:web/vitest.config.ts]]
- 執行測試（全部）：`pnpm --filter web test && pnpm --filter confession-extension test`
- 單一檔案：`pnpm --filter web exec vitest run <path>`
- 擴充套件測試：`pnpm --filter confession-extension test`

## 慣例

- 測試檔案與原始檔案同目錄，命名為 `<name>.test.ts`
- 屬性測試命名為 `<name>.pbt.test.ts`
- 修 bug 時先寫失敗測試，再修復
- 不要 mock 不必要的東西，優先使用真實實作
- Beta 能力需補齊：
  - Agentic Planner/Skill/MCP policy 單元測試
  - `engineMode` 與 `errorCode` API 回傳測試

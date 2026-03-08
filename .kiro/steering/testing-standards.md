---
inclusion: fileMatch
fileMatchPattern: '**/*.test.*'
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
- Advice Gate 需補齊：
  - triggerScore/guard（threshold、cooldown、fingerprint、daily limit）單元測試
  - `GET /api/advice/latest` 路由測試（有資料/無資料）
  - 掃描與審核事件觸發 Advice Gate 的整合測試
- FileStore 需補齊：
  - `.confession/*.json` 讀寫與原子寫入測試
  - `prisma` 外觀相容層（find/update/upsert/transaction）測試
- CLI MVP 需補齊：
  - `init` 建檔
  - `scan` 任務建立與輪詢
  - `list` / `status` 輸出與檔案資料一致

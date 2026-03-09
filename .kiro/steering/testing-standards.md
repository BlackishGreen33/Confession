---
inclusion: fileMatch
fileMatchPattern: '**/*.test.*'
---

# 測試規範

- 測試框架：Vitest + fast-check（web/extension）+ Node.js `node:test`（CLI）
- 設定檔：#[[file:web/vitest.config.ts]]
- 執行測試（全部）：`pnpm test`
- 單一檔案：`pnpm --filter web exec vitest run <path>`
- 擴充套件測試：`pnpm --filter confession-extension test`
- CLI 測試：`pnpm --filter confession-cli test`

## 慣例

- 測試檔案與原始檔案同目錄，命名為 `<name>.test.ts`
- 屬性測試命名為 `<name>.pbt.test.ts`
- CLI 測試命名為 `<name>.test.js`（Node `node:test`）
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
- CLI 需覆蓋：
  - `init` 建檔與重跑冪等
  - `scan` 成功 / 失敗 / 逾時 cancel / SIGINT cancel
  - `list` 篩選與空結果輸出
  - `status` 最新任務與 fallback 摘要
  - 參數驗證（未知旗標與非法列舉值）

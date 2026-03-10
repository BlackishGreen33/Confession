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
  - SSE 進度串流測試（含 keepalive 與斷線重連/降級）
- Advice Gate 需補齊：
  - triggerScore/guard（threshold、cooldown、fingerprint、daily limit）單元測試
  - `GET /api/advice/latest` 路由測試（有資料/無資料）
  - 掃描與審核事件觸發 Advice Gate 的整合測試
- FileStore 需補齊：
  - `.confession/*.json` 讀寫與原子寫入測試
  - `storage` 外觀相容層（find/update/upsert/transaction）測試
  - `scanTask` 快速寫路徑測試（僅寫 `scan-tasks.json` + `meta.json`）
  - vulnerability 單次掃描單鎖/單次寫回測試（避免 chunk 交易放大）
  - relocation match 測試（同 `stableFingerprint` rename/移行不重建、需產生 `scan_relocated`）
  - `analysis-cache.json` 版本不相容清空與持久化測試
- 匯出能力需補齊：
  - SARIF 2.1.0 schema 相容測試（含 `partialFingerprints.stableFingerprint`）
  - SARIF `maxResults`/`maxBytes` guard 與 warning header 測試
  - CSV 新欄位（`stableFingerprint`、`source`）與 BOM 驗證
- 效能基準需可重複執行：
  - `pnpm --filter web benchmark:scan` 量測 `scan_workspace_p95_ms` 與 `status_api_rps`（預設 `engineMode=baseline`）
  - 至少覆蓋 1000 與 3000 檔工作區場景
  - benchmark regression script 需驗證門檻：`scan_workspace_p95_ms > +15%`、`status_api_rps_p95 < -20%`
- CLI 需覆蓋：
  - `init` 建檔與重跑冪等
  - `scan` 成功 / 失敗 / 逾時 cancel / SIGINT cancel
  - `list` 篩選與空結果輸出
  - `status` 最新任務與 fallback 摘要
  - `verify web`（工具存在成功路徑、工具缺失錯誤路徑）
  - 參數驗證（未知旗標與非法列舉值）

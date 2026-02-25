---
inclusion: always
---

# 產品概述

- 名稱：Confession（薄暮靜析的告解詩）
- 定位：VS Code 靜態程式碼漏洞分析插件
- 哲學：靜態而非執行、觀測而非干預、揭露而非審判
- 不執行使用者程式碼，僅透過 AST 解析與 LLM 分析揭露潛在風險

## 語言偏好

- 對話、程式碼註釋、文件一律使用繁體中文
- 精簡直白，只說必要內容

## AI 觸發策略

- AI/LLM 分析一律採被動觸發
- 僅允許由使用者操作或明確事件（如手動掃描、檔案儲存）啟動
- 禁止在背景主動輪詢、主動防禦或自動連續呼叫模型 API

## 品質檢查

每次任務結束後必須執行：

1. `pnpm lint` — 確認無任何 ESLint warning/error
2. `pnpm build` — 確認 build 成功且無任何 warning/error

有問題就修，修完重跑，直到全過。
不得用 `// eslint-disable` 或 `// @ts-ignore` 繞過，除非有明確理由並加註釋。

## Steering 同步

每次任務結束後，若有以下變更，必須同步更新 `.kiro/steering/` 對應檔案：

- 目錄結構變動（新增、移動、重新命名資料夾或檔案）→ 更新 `structure.md`
- 路徑別名變動 → 更新 `structure.md` + `tech.md`
- 新增或移除依賴 → 更新 `tech.md`
- 程式碼規範變動 → 更新 `code-conventions.md`
- 測試規範變動 → 更新 `testing-standards.md`
- API 路由變動 → 更新 `api-standards.md`

原則：steering 是專案的 single source of truth，程式碼改了 steering 就要跟著改。

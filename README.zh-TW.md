# Confession（繁體中文）

> Before the Light Fades, the Code Speaks.

語言切換：[English](./README.md) | **繁體中文** | [简体中文](./README.zh-CN.md)

Confession 是一套以 VS Code 為核心的 LLM 輔助靜態安全分析工具。  
系統結合 AST 規則與 Gemini / NVIDIA Integrate 語義分析，偵測 Go、JavaScript、TypeScript 的潛在漏洞，並提供修復建議。

## 設計哲學

- **靜態，不執行**：不執行使用者程式碼
- **觀測，不干預**：分析結構、流程與風險訊號
- **揭露，不審判**：給出證據與建議，不強制決策

## Webview i18n

- 支援語系：`zh-TW`、`zh-CN`、`en`
- 產品預設顯示語系：`zh-TW`
- 設定鍵：`confession.ui.language = auto | zh-TW | zh-CN | en`
- `auto` 為持續跟隨模式（依 VS Code / 瀏覽器語言）
- 匯出語系化：`CSV` / `Markdown` / `PDF`
- 機器可讀匯出維持穩定：`JSON` / `SARIF` 不翻譯鍵名

## 快速開始

```bash
pnpm install
pnpm dev
```

如需全域 CLI：

```bash
npm i -g confession-cli
confession init
```

## 常用指令

```bash
pnpm dev
pnpm lint
pnpm build
pnpm test
pnpm check:ci
```

## 匯出與語系

- API：`POST /api/export`
- `locale` 可選：`zh-TW` / `zh-CN` / `en`
- 未帶 `locale` 時：後端依 `config.ui.language` 解析；不可判定回退 `zh-TW`
- 支援格式：`json` / `csv` / `markdown` / `pdf` / `sarif`

## VS Code 設定重點（`confession.*`）

- `confession.api.baseUrl`
- `confession.analysis.depth`
- `confession.analysis.triggerMode`
- `confession.ignore.paths`
- `confession.ignore.types`
- `confession.ui.language`

## 延伸說明

完整 API、掃描策略、CI 流程與測試細節，請參考英文主版 README：  
[README.md](./README.md)

# Confession（简体中文）

> Before the Light Fades, the Code Speaks.

语言切换：[English](./README.md) | [繁體中文](./README.zh-TW.md) | **简体中文**

Confession 是一套以 VS Code 为核心的 LLM 辅助静态安全分析工具。  
系统结合 AST 规则与 Gemini / NVIDIA Integrate 语义分析，检测 Go、JavaScript、TypeScript 的潜在漏洞，并提供修复建议。

## 设计哲学

- **静态，不执行**：不执行用户代码
- **观测，不干预**：分析结构、流程与风险信号
- **揭露，不审判**：给出证据与建议，不强制决策

## Webview i18n

- 支持语言：`zh-TW`、`zh-CN`、`en`
- 产品默认显示语言：`zh-TW`
- 配置键：`confession.ui.language = auto | zh-TW | zh-CN | en`
- `auto` 为持续跟随模式（根据 VS Code / 浏览器语言）
- 导出内容本地化：`CSV` / `Markdown` / `PDF`
- 机器可读导出保持稳定：`JSON` / `SARIF` 不翻译键名

## 快速开始

```bash
pnpm install
pnpm dev
```

如需全局 CLI：

```bash
npm i -g confession-cli
confession init
```

## 常用命令

```bash
pnpm dev
pnpm lint
pnpm build
pnpm test
pnpm check:ci
```

## 导出与语言

- API：`POST /api/export`
- `locale` 可选：`zh-TW` / `zh-CN` / `en`
- 未传 `locale` 时：后端根据 `config.ui.language` 解析；无法判定时回退 `zh-TW`
- 支持格式：`json` / `csv` / `markdown` / `pdf` / `sarif`

## VS Code 配置重点（`confession.*`）

- `confession.api.baseUrl`
- `confession.analysis.depth`
- `confession.analysis.triggerMode`
- `confession.ignore.paths`
- `confession.ignore.types`
- `confession.ui.language`

## 延伸说明

完整 API、扫描策略、CI 流程与测试细节，请参考英文主版 README：  
[README.md](./README.md)

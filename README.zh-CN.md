<div align="center">

# Confession

### Before the Light Fades, the Code Speaks.

[![CI](https://github.com/BlackishGreen33/Confession/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/BlackishGreen33/Confession/actions/workflows/ci.yml)
[![Code Scanning](https://github.com/BlackishGreen33/Confession/actions/workflows/code-scanning.yml/badge.svg?branch=main)](https://github.com/BlackishGreen33/Confession/actions/workflows/code-scanning.yml)
[![Benchmark Regression](https://github.com/BlackishGreen33/Confession/actions/workflows/benchmark-regression.yml/badge.svg?branch=main)](https://github.com/BlackishGreen33/Confession/actions/workflows/benchmark-regression.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-0F766E.svg)](./LICENSE)
[![VS Code ^1.85](https://img.shields.io/badge/VS_Code-%5E1.85-007ACC?logo=visualstudiocode&logoColor=white)](https://code.visualstudio.com/)
[![Next.js 16.1](https://img.shields.io/badge/Next.js-16.1.6-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![Tailwind CSS 4.1](https://img.shields.io/badge/Tailwind_CSS-4.1.10-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Hono 4.11](https://img.shields.io/badge/Hono-4.11.9-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm 9](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript Strict](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

[English](./README.md) | [繁體中文](./README.zh-TW.md) | **简体中文**

</div>

## 概览

Confession 是一套围绕 VS Code 工作流设计的静态安全分析工具。它把 AST 规则分析、LLM 语义审查、Webview 仪表板、Hono API 与 CLI 串成同一条链路，并把数据统一保存在项目本地的 `.confession/` 契约中。

它坚持三个边界：不执行用户代码、不主动干预工作区、只揭露风险信号与修复建议。

## 亮点

- **静态优先**：只做 AST 与模型分析，不做 runtime 执行。
- **双引擎扫描**：默认使用 `agentic`，失败时同一 task 内自动回退 `baseline`。
- **VS Code 原生体验**：Diagnostics、Hover、Code Actions、Status Bar 与 Webview 仪表板共享同一份状态。
- **事件驱动 AI 建议**：只有在扫描或审核事件之后，并通过门槛、cooldown 与去重规则时才会触发。
- **本地文件存储**：配置、漏洞、任务、建议快照与分析缓存都保存在 `.confession/*.json`。
- **导出完整**：内建 `json`、`csv`、`markdown`、`pdf`、`sarif`。

## 重要提示

> [!IMPORTANT]
> Confession 严格限制在静态分析范围内，不会执行用户代码，也不会启动目标服务或做 runtime 注入。

> [!TIP]
> 日常使用建议以 `standard` 为主，`quick` 适合保存后的即时反馈，`deep` 则保留给发版前检查、审计或完整安全 review。

> [!NOTE]
> 默认扫描引擎是 `agentic`，如果失败，后端会在同一个 task 内自动回退 `baseline`。`pdf` 导出实际返回的是可打印 HTML，需要通过浏览器或 Webview 的打印流程另存为 PDF。

## 快速开始

### 前置要求

- Node.js `>= 18`
- pnpm `9.x`
- Go `1.21+`，仅在重建 Go WASM analyzer 时需要

### 启动项目

```bash
pnpm install
pnpm dev
```

### LLM 密钥

在 `web/.env.local` 至少提供一组 provider 密钥：

```env
GEMINI_API_KEY="<set-in-web-env-local>"
NVIDIA_API_KEY="<set-in-web-env-local>"
```

### CLI 示例

```bash
node confession-cli/bin/confession.js init
node confession-cli/bin/confession.js scan
node confession-cli/bin/confession.js list --status open
node confession-cli/bin/confession.js status
```

## 扫描模式

| 模式       | LLM 行为                          | 适合场景         |
| ---------- | --------------------------------- | ---------------- |
| `quick`    | 仅对高风险 AST 点位条件式调用 LLM | 保存后快速反馈   |
| `standard` | 每文件一次聚合分析                | 日常主流程       |
| `deep`     | 每文件一次完整扫描                | 发版前或深度检查 |

## 常用命令

| 用途           | 命令                                                                |
| -------------- | ------------------------------------------------------------------- |
| 本地开发       | `pnpm dev`                                                          |
| Lint           | `pnpm lint`                                                         |
| Build          | `pnpm build`                                                        |
| 全部测试       | `pnpm test`                                                         |
| CI 等价检查    | `pnpm check:ci`                                                     |
| Extension 打包 | `pnpm --filter confession-extension package`                        |
| CLI 测试       | `pnpm --filter confession-cli test`                                 |
| 扫描 benchmark | `pnpm --filter web benchmark:scan`                                  |
| 生成 SARIF     | `pnpm --filter web sarif:ci -- --output /tmp/confession.sarif.json` |

## 语言与导出

- Webview 支持：`zh-TW`、`zh-CN`、`en`
- 默认语言：`zh-TW`
- 配置键：`confession.ui.language = auto | zh-TW | zh-CN | en`
- `auto` 会持续跟随宿主语言
- `/api/export` 支持：`json`、`csv`、`markdown`、`pdf`、`sarif`
- 未指定 `locale` 时，后端根据 `config.ui.language` 解析，无法判定时回退 `zh-TW`

## 延伸阅读

完整 API、架构、检测覆盖范围、CI 规则与存储契约，请参考英文主版 README：  
[README.md](./README.md)

## 授权

本项目采用 MIT License，详见 [LICENSE](./LICENSE)。

<div align="center">

# Confession

### Before the Light Fades, the Code Speaks.

[![CI](https://github.com/BlackishGreen33/Confession/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/BlackishGreen33/Confession/actions/workflows/ci.yml)
[![Code Scanning](https://github.com/BlackishGreen33/Confession/actions/workflows/code-scanning.yml/badge.svg?branch=main)](https://github.com/BlackishGreen33/Confession/actions/workflows/code-scanning.yml)
[![Benchmark Regression](https://github.com/BlackishGreen33/Confession/actions/workflows/benchmark-regression.yml/badge.svg?branch=main)](https://github.com/BlackishGreen33/Confession/actions/workflows/benchmark-regression.yml)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm 9](https://img.shields.io/badge/pnpm-9-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript Strict](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

LLM-assisted static security analysis for VS Code.  
AST-first detection, tri-language Webview UX, local FileStore persistence, and export-ready reporting in one workflow.

[Quick Start](#quick-start) · [Highlights](#highlights) · [Scan Modes](#scan-modes) · [API Surface](#api-surface) · [Development Workflow](#development-workflow)

**English** | [繁體中文](./README.zh-TW.md) | [简体中文](./README.zh-CN.md)

</div>

## Overview

Confession is a static security analysis toolkit centered on the VS Code workflow. It combines AST analyzers with LLM semantic review for Go, JavaScript, and TypeScript, then stores findings in a local `.confession/` workspace contract that the extension, dashboard, API, and CLI all share.

The product follows three hard constraints: it never executes user code, it observes rather than interferes with the workspace, and it surfaces evidence and remediation guidance without forcing the final decision.

## Highlights

- **AST-first, never runtime**: analysis is limited to syntax trees, structure, and model-assisted reasoning.
- **Two-engine scan pipeline**: `agentic_beta` is the default engine, with automatic in-task fallback to `baseline` when beta fails.
- **VS Code-native workflow**: diagnostics, hover details, code actions, status bar feedback, and a Webview dashboard stay aligned with the same backend state.
- **Event-driven AI advice**: next-step suggestions only run after defined scan or review events and must pass score, cooldown, dedupe, and daily-limit guards.
- **Local-first persistence**: configuration, vulnerabilities, scan tasks, advice snapshots, and analysis cache live under `.confession/*.json`.
- **Export-ready outputs**: built-in `json`, `csv`, `markdown`, printable HTML for PDF, and SARIF 2.1.0 reporting.

## Quick Start

### Prerequisites

- Node.js `>= 18`
- pnpm `9.x`
- Go `1.21+` only when rebuilding the Go WASM analyzer

### Install and run

```bash
pnpm install
pnpm dev
```

### Configure LLM credentials

Create `web/.env.local` and provide at least one provider key:

```env
GEMINI_API_KEY="<set-in-web-env-local>"
NVIDIA_API_KEY="<set-in-web-env-local>"
```

### Run the CLI from this workspace

```bash
node confession-cli/bin/confession.js init
node confession-cli/bin/confession.js scan
node confession-cli/bin/confession.js list --status open
node confession-cli/bin/confession.js status
```

## Scan Modes

| Mode | LLM behavior | Best for |
| --- | --- | --- |
| `quick` | Conditional LLM only on high-risk AST points | Fast feedback on save |
| `standard` | One aggregated LLM pass per file | Default day-to-day review |
| `deep` | One full-file LLM scan per file | Broad inspection before reporting |

## Architecture at a Glance

| Surface | Responsibility |
| --- | --- |
| `extension/` | VS Code extension, diagnostics, save-triggered scans, SSE-first progress handling |
| `web/` | Next.js App Router frontend plus Hono API mounted at `/api` |
| `confession-cli/` | CLI for `init`, `scan`, `list`, `status`, and `verify web` |
| `go-analyzer/` | Go AST analyzer compiled to WASM |
| `.confession/` | Local FileStore contract shared by dashboard, API, extension, and CLI |

### Local Storage Contract

- `.confession/config.json`
- `.confession/vulnerabilities.json`
- `.confession/vulnerability-events.json`
- `.confession/scan-tasks.json`
- `.confession/advice-snapshots.json`
- `.confession/advice-decisions.json`
- `.confession/analysis-cache.json`
- `.confession/meta.json`

## API Surface

### System and Config

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/health` | GET | Health check and score summary |
| `/api/advice/latest` | GET | Latest AI next-step advice |
| `/api/config` | GET | Read current configuration |
| `/api/config` | PUT | Persist merged configuration updates |

### Scan

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/scan` | POST | Trigger a new scan |
| `/api/scan/status/:id` | GET | Read task status |
| `/api/scan/stream/:id` | GET | Receive SSE progress events |
| `/api/scan/recent` | GET | Read the most recent scan summary |
| `/api/scan/cancel/:id` | POST | Cancel a running task |

### Vulnerabilities

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/vulnerabilities` | GET | List vulnerabilities with filtering and pagination |
| `/api/vulnerabilities/trend` | GET | Read time-series trend data |
| `/api/vulnerabilities/stats` | GET | Read aggregate vulnerability statistics |
| `/api/vulnerabilities/:id` | GET | Read vulnerability detail |
| `/api/vulnerabilities/:id/events` | GET | Read the vulnerability event stream |
| `/api/vulnerabilities/:id` | PATCH | Update status and attribution |

### Export and Monitoring

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/export` | POST | Export `json`, `csv`, `markdown`, `pdf`, or `sarif` |
| `/api/monitoring/generate` | POST | Generate embedded monitoring code |

## Detection Coverage

| Domain | Coverage |
| --- | --- |
| JavaScript / TypeScript | `eval`, `new Function`, string-based timers, `innerHTML`, direct request access, prototype mutation, sensitive keyword patterns |
| Go | `exec.Command`, concatenated SQL calls, env-var handling, weak hashes, plain HTTP serving, unhandled HTTP response errors |
| LLM semantic review | `quick`, `standard`, `deep` strategies with prompt fingerprint caching and structured JSON findings |

## Localization and Exports

- Supported Webview locales: `zh-TW`, `zh-CN`, `en`
- Default product locale: `zh-TW`
- Config key: `confession.ui.language = auto | zh-TW | zh-CN | en`
- `auto` continuously follows the host locale instead of performing one-time detection
- Localized export content: `csv`, `markdown`, and `pdf`
- Machine-readable export remains stable: `json` and `sarif`
- When `/api/export` omits `locale`, the backend resolves it from `config.ui.language` and falls back to `zh-TW`

## Key VS Code Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `confession.api.baseUrl` | `http://localhost:3000` | API server base URL |
| `confession.api.mode` | `local` | Switch between local and remote backend |
| `confession.llm.provider` | `nvidia` | Select `nvidia` or `gemini` |
| `confession.analysis.triggerMode` | `onSave` | Passive trigger mode for analysis |
| `confession.analysis.depth` | `standard` | Choose `quick`, `standard`, or `deep` |
| `confession.analysis.debounceMs` | `500` | Save-trigger debounce time |
| `confession.ignore.paths` | `[]` | Excluded file path patterns |
| `confession.ignore.types` | `[]` | Excluded vulnerability types |
| `confession.ui.language` | `auto` | Follow host locale or pin a UI language |

## Development Workflow

| Purpose | Command |
| --- | --- |
| Install dependencies | `pnpm install` |
| Start local development | `pnpm dev` |
| Lint everything | `pnpm lint` |
| Build everything | `pnpm build` |
| Run all tests | `pnpm test` |
| Run CI-equivalent checks | `pnpm check:ci` |
| Run server maintenance guard | `pnpm maint:check` |
| Package the VS Code extension | `pnpm --filter confession-extension package` |
| Run CLI tests | `pnpm --filter confession-cli test` |
| Run scan benchmark | `pnpm --filter web benchmark:scan` |
| Generate SARIF in CI mode | `pnpm --filter web sarif:ci -- --output /tmp/confession.sarif.json` |
| Rebuild the Go WASM analyzer | `cd go-analyzer && make all` |
| Format the repository | `pnpm format` |

## CI and Commit Rules

- GitHub Actions workflows: `CI`, `Code Scanning`, and `Benchmark Regression`
- Aggregate required gate: `quality`
- Commit range validation: `pnpm commitlint:range --from <from> --to <to>`
- Local commit hook: `.husky/commit-msg`

Commit messages must follow:

```text
<emoji> <type>(<scope>): <description>
```

Allowed `type`: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

## Repository Layout

```text
confession/
├── .github/workflows/
├── .husky/
├── confession-cli/
├── extension/
├── go-analyzer/
├── web/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── README.md
├── README.zh-TW.md
└── README.zh-CN.md
```

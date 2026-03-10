# Confession

> Before the Light Fades, the Code Speaks.

Language: **English (Default)** | [繁體中文](./README.zh-TW.md) | [简体中文](./README.zh-CN.md)

Confession is an LLM-assisted VS Code static security analysis extension.
It combines AST analysis with Gemini / NVIDIA Integrate semantic analysis to detect vulnerabilities in Go, JavaScript, and TypeScript, then provides remediation guidance.

## Design Philosophy

- **Static, not runtime execution**: never executes user code.
- **Observation, not intervention**: inspects structure, flow, and intent.
- **Disclosure, not judgment**: reveals risk signals, does not force decisions.

## i18n (Webview)

- Supported UI locales: `zh-TW`, `zh-CN`, `en`
- Product default locale: `zh-TW`
- Config key: `confession.ui.language = auto | zh-TW | zh-CN | en`
- `auto` continuously follows host locale (VS Code / browser), not one-time detection.
- Localized export content: `CSV` / `Markdown` / `PDF` follow locale.
- Machine-readable export remains stable: `JSON` / `SARIF` keys are not localized.

## Project Structure

```text
confession/
├── .github/workflows/      # GitHub Actions CI
├── .husky/                 # Git hooks (commit-msg)
├── confession-cli/         # Global CLI (init / scan / list / status / verify)
├── extension/              # VS Code extension (esbuild -> CJS)
├── web/                    # Next.js App Router + Hono backend
├── go-analyzer/            # Go AST -> WASM analyzer
├── commitlint.config.mjs   # Commit message rules
├── turbo.json              # Turborepo config
└── pnpm-workspace.yaml
```

## Tech Stack

| Layer | Choice |
|------|------|
| Package manager | pnpm 9.x + Turborepo |
| Language | TypeScript strict mode |
| Frontend | Next.js 16 App Router + Tailwind CSS 4 + shadcn/ui + sonner + next-themes |
| State | Jotai + Bunshi |
| Data fetching | React Query + Axios |
| Charts | Recharts |
| Backend | Hono (`/api/[...route]` via Next.js catch-all) |
| Validation | zod/v4 + @hono/zod-validator |
| Storage | Local FileStore (`.confession/*.json`) |
| Extension bundling | esbuild (CJS, external: vscode) |
| LLM | Google Gemini API + NVIDIA Integrate |
| Testing | Vitest + fast-check (web/extension) + Node.js `node:test` (CLI) |

## Prerequisites

- Node.js >= 18
- pnpm 9.x
- Go 1.21+ (only needed when building WASM analyzer)

## Quick Start

```bash
# Install dependencies
pnpm install

# Optional: install CLI globally
npm i -g confession-cli

# Optional: initialize local storage
confession init

# Start local development
pnpm dev
```

## Environment Variables

Set in `web/.env.local` (at least one LLM provider key is required):

```env
GEMINI_API_KEY="your-gemini-api-key"
NVIDIA_API_KEY="your-nvidia-api-key"
```

## Common Commands

```bash
# Install dependencies
pnpm install

# Development
pnpm dev

# Build
pnpm build

# Lint
pnpm lint

# Test
pnpm test

# CI checks
pnpm check:lint
pnpm check:build
pnpm check:test
pnpm check:ci

# CLI
confession init
confession scan
confession list --status open
confession status

# CLI (without global install)
node confession-cli/bin/confession.js init
node confession-cli/bin/confession.js scan
node confession-cli/bin/confession.js list --status open
node confession-cli/bin/confession.js status

# CLI tests
pnpm --filter confession-cli test

# Commit message checks
pnpm commitlint --from HEAD~1 --to HEAD
pnpm commitlint:range --from <from> --to <to>

# Formatting
pnpm format
pnpm format:check
```

## CI and Commit Rules

- CI uses GitHub Actions (`.github/workflows/ci.yml`).
- Trigger: `pull_request(main)` and `push(main)`.
- `lint` / `build` / `test` run in parallel.
- `quality` is the aggregate required gate.
- `commit-check` validates commit range by `pnpm commitlint:range`.
- Local commits are checked by `.husky/commit-msg`.

### Commit Format

```text
<emoji> <type>(<scope>): <description>
```

Allowed `type`: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
`scope` is required.

## CLI Behavior Notes

- Argument validation is strict: unknown flags or invalid enum values fail with non-zero exit code.
- On polling timeout or `SIGINT` (`Ctrl+C`), `scan` attempts `POST /api/scan/cancel/:id` before exiting, to avoid stale `running` tasks.

## Go WASM Analyzer

```bash
cd go-analyzer
make all    # build WASM + copy wasm_exec.js to web/public/
make clean  # clean artifacts
```

## Extension Packaging

```bash
cd extension
pnpm build
pnpm package
```

## API Routes

| Route | Method | Description |
|------|------|------|
| `/api/health` | GET | Health check |
| `/api/advice/latest` | GET | Latest AI next-step advice |
| `/api/config` | GET | Get current config |
| `/api/config` | PUT | Partial config update (merge) |
| `/api/scan` | POST | Trigger scan |
| `/api/scan/status/:id` | GET | Scan status |
| `/api/scan/stream/:id` | GET | SSE progress stream |
| `/api/scan/recent` | GET | Most recent scan summary |
| `/api/scan/cancel/:id` | POST | Cancel running scan |
| `/api/vulnerabilities` | GET | Vulnerability list (filter/sort/paginate) |
| `/api/vulnerabilities/trend` | GET | Vulnerability trend |
| `/api/vulnerabilities/stats` | GET | Vulnerability stats |
| `/api/vulnerabilities/:id` | GET | Vulnerability detail |
| `/api/vulnerabilities/:id/events` | GET | Vulnerability event stream |
| `/api/vulnerabilities/:id` | PATCH | Update status / attribution |
| `/api/export` | POST | Export report (`json/csv/markdown/pdf/sarif`) |
| `/api/monitoring/generate` | POST | Generate monitoring code |

## Detection Coverage

### JS/TS (TypeScript Compiler API)

- `eval()` / `new Function()` / `setTimeout(string)`
- `innerHTML` / `outerHTML` assignment
- direct access from `req.query` / `req.body` / `req.params`
- `__proto__` / `Object.setPrototypeOf` / `prototype` mutation
- sensitive keyword indexing (`password`, `secret`, `token`, etc.)

### Go (WASM + go/ast)

- `exec.Command` / `exec.CommandContext` (command injection)
- string-concatenated `sql.Query` / `sql.Exec` (SQL injection)
- sensitive environment variable operations (`os.Setenv`, `os.Getenv`)
- weak hash usage (`md5`, `sha1`)
- `http.ListenAndServe` without TLS
- unhandled HTTP response errors

### LLM Semantic Analysis (Gemini / NVIDIA)

- `quick`: conditional LLM on high-risk AST points
- `standard`: one aggregated analysis request per file
- `deep`: one full-file macro analysis per file
- prompt fingerprint cache to reduce duplicate requests
- structured JSON output (vulnerability type, CWE, remediation)

## Export Reports

- Formats: `JSON`, `CSV` (with UTF-8 BOM), `Markdown`, `PDF`, `SARIF 2.1.0`
- `POST /api/export` supports `locale?: 'zh-TW' | 'zh-CN' | 'en'`
- If `locale` is omitted, backend resolves from `config.ui.language`; falls back to `zh-TW` when undecidable
- PDF flow returns printable HTML; user saves as PDF via browser print dialog
- Filename pattern: `confession-vulnerabilities-YYYYMMDD-HHmmss.<ext>`

## VS Code Extension Features

- **Diagnostics**: real-time panel highlights (critical/high -> Error, medium -> Warning, low/info -> Info)
- **Hover**: vulnerability details and remediation guidance
- **Code Actions**: one-click fix / ignore
- **Status Bar**: scan state indicator
- **Auto scan**: debounce-triggered incremental scan on save
- **Webview Dashboard**: embedded Next.js security dashboard

### Extension Commands

- `Confession: Scan Current File`
- `Confession: Scan Workspace`
- `Confession: Open Security Dashboard`
- `Confession: 儀表盤`
- `Confession: 漏洞列表`
- `Confession: 設定`

### Extension Settings (`confession.*`)

| Setting | Default | Description |
|------|------|------|
| `confession.api.baseUrl` | `http://localhost:3000` | API server base URL |
| `confession.api.mode` | `local` | Connection mode (`local` / `remote`) |
| `confession.llm.apiKey` | — | Gemini API key |
| `confession.analysis.triggerMode` | `onSave` | Trigger mode (`onSave` / `manual`) |
| `confession.analysis.depth` | `standard` | Scan depth (`quick` / `standard` / `deep`) |
| `confession.analysis.debounceMs` | `500` | Debounce delay (ms) |
| `confession.ignore.paths` | `[]` | Ignored file paths |
| `confession.ignore.types` | `[]` | Ignored vulnerability types |
| `confession.ui.language` | `auto` | Webview locale (`auto` / `zh-TW` / `zh-CN` / `en`) |

## Testing

This project uses Vitest + fast-check for unit and property-based testing.

```bash
# Run all tests
pnpm test

# Run a single test file
pnpm --filter web exec vitest run src/server/analyzers/jsts.test.ts
```

### Property-Based Checks (PBT)

| Property | What it validates |
|------|------|
| P1 | AST analyzer completeness for known patterns |
| P2 | Sensitive keyword index correctness |
| P3 | Vulnerability idempotency (duplicate insert remains one record) |
| P4 | Agent message serialization round-trip integrity |
| P5 | LLM response parser robustness |
| P6 | Orchestrator language routing correctness |
| P7 | Diagnostics severity mapping correctness |
| P8 | Debounce correctness (single trigger in window) |

## License

MIT

const DEFAULT_POLL_INTERVAL_MS = 1500;
const DEFAULT_SCAN_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_VERIFY_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_DAST_RATE_LIMIT = 5;
const DEFAULT_DAST_CONCURRENCY = 4;
const FILE_LIMIT = 5000;
const CONFESSION_DIR_NAME = '.confession';
const SCHEMA_VERSION = 'file-store-v1';

const VALID_DEPTHS = new Set(['quick', 'standard', 'deep']);
const VALID_LLM_PROVIDERS = new Set(['gemini', 'nvidia', 'minimax-cn']);
const VALID_STATUSES = new Set(['open', 'fixed', 'ignored']);
const VALID_SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const VALID_VERIFY_TARGETS = new Set(['web']);
const SUPPORTED_EXTS = new Set(['.go', '.js', '.jsx', '.ts', '.tsx']);

const COMMAND_FLAG_SPEC = {
  init: new Set(),
  scan: new Set(['api', 'depth']),
  list: new Set(['status', 'severity', 'search']),
  status: new Set(),
  verify: new Set([
    'url',
    'zap-bin',
    'nuclei-bin',
    'timeout-ms',
    'rate-limit',
    'concurrency',
  ]),
};

const STORAGE_FILES = {
  config: 'config.json',
  vulnerabilities: 'vulnerabilities.json',
  vulnerabilityEvents: 'vulnerability-events.json',
  scanTasks: 'scan-tasks.json',
  adviceSnapshots: 'advice-snapshots.json',
  adviceDecisions: 'advice-decisions.json',
  analysisCache: 'analysis-cache.json',
  meta: 'meta.json',
};

const DEFAULT_CONFIG = {
  llm: { provider: 'nvidia', apiKey: '' },
  analysis: { triggerMode: 'onSave', depth: 'standard', debounceMs: 500 },
  ignore: { paths: [], types: [] },
  api: { baseUrl: 'http://localhost:3000', mode: 'local' },
};

class CliError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'CliError';
    this.exitCode = options.exitCode ?? 1;
    this.showHelp = options.showHelp ?? false;
  }
}

function normalizeSlash(value) {
  return String(value).replace(/\\/g, '/');
}

function parseFlags(argv, allowedFlags) {
  const flags = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new CliError(`未知參數：${token}`);
    }

    const key = token.slice(2);
    if (!allowedFlags.has(key)) {
      throw new CliError(`未知參數：--${key}`);
    }

    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      throw new CliError(`參數 --${key} 需要提供值`);
    }

    flags[key] = next;
    i += 1;
  }

  return flags;
}

function validateEnumFlag(name, value, allowedSet) {
  if (value == null) {
    return null;
  }

  if (!allowedSet.has(value)) {
    throw new CliError(
      `參數 --${name} 僅接受：${Array.from(allowedSet).join('|')}（目前為 ${value}）`
    );
  }

  return value;
}

function parsePositiveIntegerFlag(name, value, fallback) {
  if (value == null) return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new CliError(`參數 --${name} 需為正整數（目前為 ${value}）`);
  }
  return parsed;
}

function normalizeCommandPath(value, fallback) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

function isHttpUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function truncate(text, limit) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function countBy(rows, selector) {
  const counter = {};
  for (const row of rows) {
    const key = selector(row);
    counter[key] = (counter[key] || 0) + 1;
  }
  return counter;
}

function normalizeScanEngineModeLabel(value) {
  if (value === 'agentic_beta') return 'agentic';
  return String(value || 'unknown');
}

module.exports = {
  CliError,
  COMMAND_FLAG_SPEC,
  CONFESSION_DIR_NAME,
  DEFAULT_CONFIG,
  DEFAULT_DAST_CONCURRENCY,
  DEFAULT_DAST_RATE_LIMIT,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_SCAN_TIMEOUT_MS,
  DEFAULT_VERIFY_TIMEOUT_MS,
  FILE_LIMIT,
  SCHEMA_VERSION,
  STORAGE_FILES,
  SUPPORTED_EXTS,
  VALID_DEPTHS,
  VALID_LLM_PROVIDERS,
  VALID_SEVERITIES,
  VALID_STATUSES,
  VALID_VERIFY_TARGETS,
  countBy,
  isHttpUrl,
  normalizeCommandPath,
  normalizeScanEngineModeLabel,
  normalizeSlash,
  parseFlags,
  parsePositiveIntegerFlag,
  truncate,
  validateEnumFlag,
};

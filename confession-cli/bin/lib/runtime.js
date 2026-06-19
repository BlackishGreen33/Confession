const { spawn } = require('node:child_process');

const {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_SCAN_TIMEOUT_MS,
} = require('./common');

function normalizeCwd(cwdValue) {
  if (typeof cwdValue === 'function') {
    return cwdValue;
  }
  if (typeof cwdValue === 'string' && cwdValue.trim().length > 0) {
    return () => cwdValue;
  }
  return () => process.cwd();
}

function resolveDurationFromEnv(env, key, fallback) {
  const raw = env[key];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRuntime(overrides = {}) {
  const env = overrides.env ?? process.env;

  return {
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    env,
    cwd: normalizeCwd(overrides.cwd),
    fetchImpl: overrides.fetchImpl ?? globalThis.fetch,
    sleepImpl: overrides.sleepImpl ?? sleep,
    spawnImpl: overrides.spawnImpl ?? spawn,
    now: overrides.now ?? Date.now,
    pollIntervalMs:
      overrides.pollIntervalMs ??
      resolveDurationFromEnv(
        env,
        'CONFESSION_CLI_POLL_INTERVAL_MS',
        DEFAULT_POLL_INTERVAL_MS
      ),
    scanTimeoutMs:
      overrides.scanTimeoutMs ??
      resolveDurationFromEnv(
        env,
        'CONFESSION_CLI_SCAN_TIMEOUT_MS',
        DEFAULT_SCAN_TIMEOUT_MS
      ),
    registerSigint:
      overrides.registerSigint ??
      ((handler) => {
        process.once('SIGINT', handler);
        return () => process.off('SIGINT', handler);
      }),
  };
}

module.exports = { createRuntime, sleep };

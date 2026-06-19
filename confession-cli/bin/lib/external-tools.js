const { DEFAULT_VERIFY_TIMEOUT_MS } = require('./common');

function createDastTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

async function runExternalCommand(command, args, runtime, options = {}) {
  const timeoutMs = Math.max(
    1_000,
    Math.floor(options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS)
  );
  const cwd = options.cwd ?? runtime.cwd();

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = runtime.spawnImpl(command, args, {
      cwd,
      env: runtime.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500);
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });

    child.once('error', (error) => {
      clearTimeout(timeoutId);
      resolve({
        ok: false,
        timedOut,
        exitCode: null,
        stdout,
        stderr,
        error,
      });
    });

    child.once('close', (code) => {
      clearTimeout(timeoutId);
      resolve({
        ok: !timedOut && code === 0,
        timedOut,
        exitCode: typeof code === 'number' ? code : null,
        stdout,
        stderr,
        error: null,
      });
    });
  });
}

function normalizeToolResult(toolName, command, args, result, reportPath) {
  const common = {
    command,
    args,
    reportPath,
  };

  if (result.error && result.error.code === 'ENOENT') {
    return {
      ...common,
      status: 'missing',
      error: `${toolName} 指令不存在`,
    };
  }

  if (result.timedOut) {
    return {
      ...common,
      status: 'failed',
      exitCode: result.exitCode,
      error: '執行逾時',
    };
  }

  if (!result.ok) {
    return {
      ...common,
      status: 'failed',
      exitCode: result.exitCode,
      error:
        result.error instanceof Error
          ? result.error.message
          : String(result.stderr || result.stdout || '工具執行失敗'),
    };
  }

  return {
    ...common,
    status: 'ok',
    exitCode: result.exitCode,
  };
}

module.exports = {
  createDastTimestamp,
  normalizeToolResult,
  runExternalCommand,
};

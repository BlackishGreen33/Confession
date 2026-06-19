const fs = require('node:fs/promises');
const path = require('node:path');

const {
  CliError,
  DEFAULT_DAST_CONCURRENCY,
  DEFAULT_DAST_RATE_LIMIT,
  DEFAULT_VERIFY_TIMEOUT_MS,
  VALID_DEPTHS,
  VALID_SEVERITIES,
  VALID_STATUSES,
  VALID_VERIFY_TARGETS,
  countBy,
  isHttpUrl,
  normalizeCommandPath,
  normalizeScanEngineModeLabel,
  parsePositiveIntegerFlag,
  truncate,
  validateEnumFlag,
} = require('./common');
const {
  createDastTimestamp,
  normalizeToolResult,
  runExternalCommand,
} = require('./external-tools');
const {
  fetchScanStatus,
  triggerScan,
  tryCancelScanTask,
} = require('./scan-api');
const {
  collectWorkspaceFiles,
  getConfessionDir,
  getStoragePath,
  initProject,
  loadProjectConfig,
  readJson,
  writeJson,
} = require('./storage');

function printHelp(stdout = process.stdout) {
  stdout.write('\nConfession CLI\n\n');
  stdout.write('Usage:\n');
  stdout.write('  confession init\n');
  stdout.write(
    '  confession scan [--api <baseUrl>] [--depth quick|standard|deep]\n'
  );
  stdout.write(
    '  confession list [--status open|fixed|ignored] [--severity critical|high|medium|low|info] [--search <keyword>]\n'
  );
  stdout.write('  confession status\n\n');
  stdout.write(
    '  confession verify web --url <http(s)://target> [--zap-bin <path>] [--nuclei-bin <path>] [--timeout-ms <ms>] [--rate-limit <n>] [--concurrency <n>]\n\n'
  );
}

async function commandInit(projectRoot, runtime) {
  await initProject(projectRoot);
  runtime.stdout.write(`已初始化：${path.join(projectRoot, '.confession')}\n`);
}

async function commandScan(projectRoot, flags, runtime) {
  await initProject(projectRoot);

  const config = await loadProjectConfig(projectRoot);
  const depth = flags.depth
    ? validateEnumFlag('depth', flags.depth, VALID_DEPTHS)
    : config.analysis.depth;
  const baseUrl =
    typeof flags.api === 'string' && flags.api.trim().length > 0
      ? flags.api.trim()
      : config.api.baseUrl;

  const { files, workspaceSnapshotComplete } = await collectWorkspaceFiles(
    projectRoot,
    config.ignore.paths
  );

  if (files.length === 0) {
    runtime.stdout.write('沒有可掃描檔案（可能全部被 ignore）\n');
    return;
  }

  runtime.stdout.write(`準備掃描 ${files.length} 個檔案，呼叫 ${baseUrl}\n`);
  const created = await triggerScan(
    baseUrl,
    {
      files,
      depth,
      includeLlmScan: depth === 'deep',
      forceRescan: true,
      scanScope: 'workspace',
      workspaceSnapshotComplete,
      workspaceRoots: [projectRoot],
    },
    runtime
  );

  const taskId = created.taskId;
  if (!taskId) {
    throw new CliError('掃描任務建立失敗：未取得 taskId');
  }

  await waitForScanCompletion(baseUrl, taskId, runtime);
}

async function waitForScanCompletion(baseUrl, taskId, runtime) {
  const pollIntervalMs = Math.max(50, Math.floor(runtime.pollIntervalMs));
  const scanTimeoutMs = Math.max(1000, Math.floor(runtime.scanTimeoutMs));
  const startedAt = runtime.now();
  let interrupted = false;

  const unregisterSigint = runtime.registerSigint(() => {
    interrupted = true;
  });

  try {
    while (true) {
      await throwIfScanShouldStop({
        baseUrl,
        interrupted,
        runtime,
        scanTimeoutMs,
        startedAt,
        taskId,
      });

      const status = await fetchScanStatus(baseUrl, taskId, runtime);
      if (handleScanStatus(taskId, status, runtime)) return;

      await runtime.sleepImpl(pollIntervalMs);
    }
  } finally {
    unregisterSigint();
  }
}

async function throwIfScanShouldStop(params) {
  const { baseUrl, interrupted, runtime, scanTimeoutMs, startedAt, taskId } =
    params;

  if (interrupted) {
    runtime.stdout.write('\n收到 SIGINT，正在取消掃描任務...\n');
    await tryCancelScanTask(baseUrl, taskId, runtime, '掃描已中斷');
    throw new CliError('掃描已中斷，已嘗試取消後端任務', { exitCode: 130 });
  }

  if (runtime.now() - startedAt <= scanTimeoutMs) return;

  const seconds = Math.ceil(scanTimeoutMs / 1000);
  runtime.stdout.write(`\n掃描等待逾時（${seconds} 秒），正在取消掃描任務...\n`);
  await tryCancelScanTask(baseUrl, taskId, runtime, '掃描逾時');
  throw new CliError(`掃描等待逾時（${seconds} 秒），已嘗試取消後端任務`);
}

function handleScanStatus(taskId, status, runtime) {
  runtime.stdout.write(
    `\r[task:${taskId}] ${status.status} ${formatScanProgress(status)}                    `
  );

  if (status.status === 'completed') {
    runtime.stdout.write('\n掃描完成\n');
    return true;
  }

  if (status.status === 'failed') {
    throw new CliError(`掃描失敗：${readScanFailureReason(status)}`);
  }

  return false;
}

function formatScanProgress(status) {
  const scanned = Number(status.scannedFiles ?? 0);
  const total = Number(status.totalFiles ?? 0);
  if (total > 0) return `${scanned}/${total}`;
  return `${Math.round(Number(status.progress ?? 0) * 100)}%`;
}

function readScanFailureReason(status) {
  if (
    typeof status.errorMessage === 'string' &&
    status.errorMessage.trim().length > 0
  ) {
    return status.errorMessage.trim();
  }
  return '未知錯誤';
}

async function commandList(projectRoot, flags, runtime) {
  await initProject(projectRoot);
  const rows = await readJson(
    getStoragePath(projectRoot, 'vulnerabilities'),
    []
  );

  const filtered = filterVulnerabilities(rows, flags);
  if (filtered.length === 0) {
    runtime.stdout.write('沒有符合條件的漏洞\n');
    return;
  }

  for (const row of filtered) {
    runtime.stdout.write(formatVulnerabilityRow(row));
  }
}

function filterVulnerabilities(rows, flags) {
  const statusFilter = validateEnumFlag(
    'status',
    flags.status ?? null,
    VALID_STATUSES
  );
  const severityFilter = validateEnumFlag(
    'severity',
    flags.severity ?? null,
    VALID_SEVERITIES
  );
  const search =
    typeof flags.search === 'string' ? flags.search.toLowerCase() : null;

  return rows
    .filter((row) => !statusFilter || row.status === statusFilter)
    .filter((row) => !severityFilter || row.severity === severityFilter)
    .filter((row) => matchesSearch(row, search))
    .sort((a, b) =>
      String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))
    );
}

function matchesSearch(row, search) {
  if (!search) return true;
  const text =
    `${row.filePath ?? ''} ${row.type ?? ''} ${row.description ?? ''}`.toLowerCase();
  return text.includes(search);
}

function formatVulnerabilityRow(row) {
  const id = String(row.id ?? '');
  const severity = String(row.severity ?? '');
  const status = String(row.status ?? '');
  const filePath = String(row.filePath ?? '');
  const line = Number(row.line ?? 0);
  const type = String(row.type ?? '');
  const description = truncate(String(row.description ?? ''), 80);
  return `${id}  [${severity}/${status}] ${filePath}:${line}  ${type}  ${description}\n`;
}

async function commandStatus(projectRoot, runtime) {
  await initProject(projectRoot);
  const [tasks, vulns] = await Promise.all([
    readJson(getStoragePath(projectRoot, 'scanTasks'), []),
    readJson(getStoragePath(projectRoot, 'vulnerabilities'), []),
  ]);

  const latestTask = [...tasks].sort((a, b) =>
    String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))
  )[0];

  const byStatus = countBy(vulns, (row) => String(row.status || 'unknown'));
  const bySeverityOpen = countBy(
    vulns.filter((row) => row.status === 'open'),
    (row) => String(row.severity || 'unknown')
  );

  runtime.stdout.write(`project: ${projectRoot}\n`);
  runtime.stdout.write(
    `vulnerabilities: total=${vulns.length} open=${byStatus.open || 0} fixed=${byStatus.fixed || 0} ignored=${byStatus.ignored || 0}\n`
  );
  runtime.stdout.write(
    `open severity: critical=${bySeverityOpen.critical || 0} high=${bySeverityOpen.high || 0} medium=${bySeverityOpen.medium || 0} low=${bySeverityOpen.low || 0} info=${bySeverityOpen.info || 0}\n`
  );

  if (!latestTask) {
    runtime.stdout.write('latest scan: 尚無掃描任務\n');
    return;
  }

  runtime.stdout.write(
    `latest scan: id=${latestTask.id} status=${latestTask.status} engine=${normalizeScanEngineModeLabel(latestTask.engineMode)} fallback=${latestTask.fallbackUsed ? 'yes' : 'no'} updatedAt=${latestTask.updatedAt}\n`
  );
}

async function commandVerify(projectRoot, target, flags, runtime) {
  await initProject(projectRoot);
  const normalizedTarget = validateEnumFlag(
    'target',
    target,
    VALID_VERIFY_TARGETS
  );

  if (normalizedTarget !== 'web') {
    throw new CliError(`尚未支援 verify target: ${normalizedTarget}`);
  }

  const targetUrl = typeof flags.url === 'string' ? flags.url.trim() : '';
  if (!isHttpUrl(targetUrl)) {
    throw new CliError(
      'verify web 需要提供合法的 --url（http:// 或 https://）'
    );
  }

  const options = resolveVerifyOptions(flags, runtime);
  ensureDastPaths(projectRoot, options);
  const summary = createVerifySummary(normalizedTarget, targetUrl, options);

  runtime.stdout.write(`開始 DAST 驗證：target=${targetUrl}\n`);
  runtime.stdout.write(
    `預設保守策略：timeout=${options.timeoutMs}ms rateLimit=${options.rateLimit} concurrency=${options.concurrency}\n`
  );

  await fs.mkdir(options.outputDir, { recursive: true });
  summary.tools.zap = await runZapBaseline(projectRoot, targetUrl, options, runtime);
  summary.tools.nuclei = await runNuclei(projectRoot, targetUrl, options, runtime);
  summary.finishedAt = new Date().toISOString();

  await writeJson(options.summaryPath, summary);
  reportVerifyResult(summary, options.summaryPath, runtime);
}

function resolveVerifyOptions(flags, runtime) {
  const timeoutMs = parsePositiveIntegerFlag(
    'timeout-ms',
    flags['timeout-ms'],
    DEFAULT_VERIFY_TIMEOUT_MS
  );
  const rateLimit = parsePositiveIntegerFlag(
    'rate-limit',
    flags['rate-limit'],
    DEFAULT_DAST_RATE_LIMIT
  );
  const concurrency = parsePositiveIntegerFlag(
    'concurrency',
    flags.concurrency,
    DEFAULT_DAST_CONCURRENCY
  );
  const zapBin = normalizeCommandPath(
    flags['zap-bin'],
    runtime.env.CONFESSION_ZAP_BIN || 'zap-baseline.py'
  );
  const nucleiBin = normalizeCommandPath(
    flags['nuclei-bin'],
    runtime.env.CONFESSION_NUCLEI_BIN || 'nuclei'
  );

  return { concurrency, nucleiBin, rateLimit, timeoutMs, zapBin };
}

function createVerifySummary(target, targetUrl, options) {
  return {
    target,
    url: targetUrl,
    startedAt: new Date().toISOString(),
    timeoutMs: options.timeoutMs,
    rateLimit: options.rateLimit,
    concurrency: options.concurrency,
    tools: {},
  };
}

async function runZapBaseline(projectRoot, targetUrl, options, runtime) {
  const args = ['-t', targetUrl, '-J', options.zapReportPath, '-m', '3', '-I'];
  const result = await runExternalCommand(options.zapBin, args, runtime, {
    timeoutMs: options.timeoutMs,
    cwd: projectRoot,
  });
  return normalizeToolResult(
    'zap',
    options.zapBin,
    args,
    result,
    options.zapReportPath
  );
}

async function runNuclei(projectRoot, targetUrl, options, runtime) {
  const args = [
    '-u',
    targetUrl,
    '-jsonl',
    '-o',
    options.nucleiReportPath,
    '-rate-limit',
    String(options.rateLimit),
    '-c',
    String(options.concurrency),
  ];
  const result = await runExternalCommand(options.nucleiBin, args, runtime, {
    timeoutMs: options.timeoutMs,
    cwd: projectRoot,
  });
  return normalizeToolResult(
    'nuclei',
    options.nucleiBin,
    args,
    result,
    options.nucleiReportPath
  );
}

function ensureDastPaths(projectRoot, options) {
  if (options.outputDir) return options;

  const timestamp = createDastTimestamp();
  const outputDir = path.join(getConfessionDir(projectRoot), 'dast');
  options.outputDir = outputDir;
  options.zapReportPath = path.join(outputDir, `zap-baseline-${timestamp}.json`);
  options.nucleiReportPath = path.join(outputDir, `nuclei-${timestamp}.jsonl`);
  options.summaryPath = path.join(outputDir, `summary-${timestamp}.json`);
  return options;
}

function reportVerifyResult(summary, summaryPath, runtime) {
  const statuses = [summary.tools.zap.status, summary.tools.nuclei.status];
  const executedCount = statuses.filter(
    (status) => status !== 'missing'
  ).length;
  const failedCount = statuses.filter((status) => status === 'failed').length;

  if (executedCount === 0) {
    throw new CliError('找不到可執行的 DAST 工具（zap-baseline.py / nuclei）');
  }

  runtime.stdout.write(`DAST 驗證完成，摘要：${summaryPath}\n`);
  runtime.stdout.write(
    `工具結果：zap=${summary.tools.zap.status} nuclei=${summary.tools.nuclei.status}\n`
  );

  if (failedCount > 0) {
    throw new CliError('部分 DAST 工具執行失敗，請檢查摘要與錯誤輸出');
  }
}

module.exports = {
  commandInit,
  commandList,
  commandScan,
  commandStatus,
  commandVerify,
  printHelp,
};

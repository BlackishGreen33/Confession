const { CliError } = require('./common');

function ensureFetchAvailable(runtime) {
  if (typeof runtime.fetchImpl !== 'function') {
    throw new CliError('目前環境不支援 fetch，無法執行掃描命令');
  }
}

async function triggerScan(baseUrl, payload, runtime) {
  ensureFetchAvailable(runtime);

  const response = await runtime.fetchImpl(
    `${baseUrl.replace(/\/+$/, '')}/api/scan`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new CliError(`觸發掃描失敗 (${response.status}) ${text}`);
  }

  return response.json();
}

async function fetchScanStatus(baseUrl, taskId, runtime) {
  ensureFetchAvailable(runtime);

  const response = await runtime.fetchImpl(
    `${baseUrl.replace(/\/+$/, '')}/api/scan/status/${encodeURIComponent(taskId)}`
  );

  if (!response.ok) {
    const text = await response.text();
    throw new CliError(`讀取掃描狀態失敗 (${response.status}) ${text}`);
  }

  return response.json();
}

async function cancelScanTask(baseUrl, taskId, runtime) {
  ensureFetchAvailable(runtime);

  const response = await runtime.fetchImpl(
    `${baseUrl.replace(/\/+$/, '')}/api/scan/cancel/${encodeURIComponent(taskId)}`,
    { method: 'POST' }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`取消掃描失敗 (${response.status}) ${text}`);
  }
}

async function tryCancelScanTask(baseUrl, taskId, runtime, reason) {
  try {
    await cancelScanTask(baseUrl, taskId, runtime);
    runtime.stdout.write(`${reason}，已送出取消請求\n`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runtime.stderr.write(`[confession] ${reason}，取消請求失敗：${message}\n`);
    return false;
  }
}

module.exports = {
  fetchScanStatus,
  triggerScan,
  tryCancelScanTask,
};

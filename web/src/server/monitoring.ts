/**
 * 嵌入式監測代碼產生器（伺服器端）。
 * 根據漏洞資訊與語言產生日誌上報代碼片段。
 */

/** 漏洞輸入（僅需產生監測代碼的欄位） */
export interface MonitoringInput {
  id: string
  type: string
  cweId: string | null
  severity: string
  filePath: string
  line: number
}

/** 產生結果 */
export interface MonitoringOutput {
  code: string
  language: string
}

/**
 * 根據漏洞資訊與語言產生嵌入式監測代碼。
 * 回傳 null 表示不支援該語言。
 */
export function generateMonitoringCode(
  vuln: MonitoringInput,
  language: string,
): MonitoringOutput | null {
  const timestamp = new Date().toISOString()
  const cweLabel = vuln.cweId ?? 'N/A'

  switch (language) {
    case 'go':
      return { code: generateGoMonitoring(vuln, cweLabel, timestamp), language: 'go' }
    case 'javascript':
    case 'typescript':
      return { code: generateJsTsMonitoring(vuln, cweLabel, timestamp), language }
    default:
      return null
  }
}

/** 產生 JS/TS 監測代碼 */
function generateJsTsMonitoring(vuln: MonitoringInput, cweLabel: string, timestamp: string): string {
  const payload = JSON.stringify({
    vulnId: vuln.id,
    type: vuln.type,
    cweId: cweLabel,
    severity: vuln.severity,
    file: vuln.filePath,
    line: vuln.line,
    fixedAt: timestamp,
  })

  return [
    `// [Confession] 漏洞修復監測 — ${vuln.type} (${cweLabel}) — ${timestamp}`,
    `console.warn('[Confession:Monitor]', ${payload})`,
  ].join('\n')
}

/** 產生 Go 監測代碼 */
function generateGoMonitoring(vuln: MonitoringInput, cweLabel: string, timestamp: string): string {
  return [
    `// [Confession] 漏洞修復監測 — ${vuln.type} (${cweLabel}) — ${timestamp}`,
    `log.Printf("[Confession:Monitor] vulnId=%s type=%s cweId=%s severity=%s file=%s line=%d fixedAt=%s", ${JSON.stringify(vuln.id)}, ${JSON.stringify(vuln.type)}, ${JSON.stringify(cweLabel)}, ${JSON.stringify(vuln.severity)}, ${JSON.stringify(vuln.filePath)}, ${vuln.line}, ${JSON.stringify(timestamp)})`,
  ].join('\n')
}

import type { Vulnerability } from './types'

/** 支援的語言類型 */
type MonitoringLanguage = 'go' | 'javascript' | 'typescript' | 'typescriptreact' | 'javascriptreact'

/**
 * 根據漏洞資訊與語言，產生嵌入式監測日誌代碼。
 * 修復套用後插入於修復代碼下方，用於上報修復事件。
 */
export function generateMonitoringCode(vuln: Vulnerability, languageId: string): string | null {
  const lang = languageId as MonitoringLanguage
  const timestamp = new Date().toISOString()
  const cweLabel = vuln.cweId ?? 'N/A'

  switch (lang) {
    case 'go':
      return generateGoMonitoring(vuln, cweLabel, timestamp)
    case 'javascript':
    case 'javascriptreact':
    case 'typescript':
    case 'typescriptreact':
      return generateJsTsMonitoring(vuln, cweLabel, timestamp)
    default:
      return null
  }
}

/** 產生 JS/TS 監測代碼 */
function generateJsTsMonitoring(vuln: Vulnerability, cweLabel: string, timestamp: string): string {
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
function generateGoMonitoring(vuln: Vulnerability, cweLabel: string, timestamp: string): string {
  return [
    `// [Confession] 漏洞修復監測 — ${vuln.type} (${cweLabel}) — ${timestamp}`,
    `log.Printf("[Confession:Monitor] vulnId=%s type=%s cweId=%s severity=%s file=%s line=%d fixedAt=%s", ${JSON.stringify(vuln.id)}, ${JSON.stringify(vuln.type)}, ${JSON.stringify(cweLabel)}, ${JSON.stringify(vuln.severity)}, ${JSON.stringify(vuln.filePath)}, ${vuln.line}, ${JSON.stringify(timestamp)})`,
  ].join('\n')
}

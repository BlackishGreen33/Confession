import type {
  ExportReportV2,
  SerializedVulnerability,
} from '@server/vulnerability-presenter'

import type { ResolvedLocale } from '@/libs/i18n'

import { escapeHtml, formatCounter, groupBySeverity } from './common'
import { PRINTABLE_TEXT, type PrintableText } from './printable-text'

export function renderPrintableHtml(
  report: ExportReportV2,
  locale: ResolvedLocale = 'zh-TW',
): string {
  const text = PRINTABLE_TEXT[locale]
  const openCount = report.summary.byStatus.open ?? 0
  const fixedCount = report.summary.byStatus.fixed ?? 0
  const ignoredCount = report.summary.byStatus.ignored ?? 0
  const criticalCount = report.summary.bySeverity.critical ?? 0
  const highCount = report.summary.bySeverity.high ?? 0

  const summaryCards = [
    [text.statTotal, String(report.summary.total), 'total'],
    [text.statOpen, String(openCount), 'open'],
    [text.statFixed, String(fixedCount), 'fixed'],
    [text.statIgnored, String(ignoredCount), 'ignored'],
    [text.statDanger, String(criticalCount + highCount), 'danger'],
  ]
    .map(
      ([label, value, kind]) => `
        <article class="stat stat-${kind}">
          <span class="stat-label">${escapeHtml(label)}</span>
          <span class="stat-value">${escapeHtml(value)}</span>
        </article>
      `,
    )
    .join('')

  const sections = groupBySeverity(report.items, locale)
    .filter((section) => section.items.length > 0)
    .map(
      (section) => `
        <section class="panel severity-section">
          <h2><span class="section-index">SEC</span>${escapeHtml(section.label)}（${section.items.length}）</h2>
          ${section.items.map((item) => renderIssueCardHtml(item, text)).join('\n')}
        </section>
      `,
    )
    .join('\n')

  const summaryRows = [
    [text.summaryTotal, String(report.summary.total)],
    [text.summaryBySeverity, formatCounter(report.summary.bySeverity)],
    [text.summaryByStatus, formatCounter(report.summary.byStatus)],
    [text.summaryByHumanStatus, formatCounter(report.summary.byHumanStatus)],
    [text.summaryByType, formatCounter(report.summary.byType)],
  ]
    .map(
      ([k, v]) =>
        `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`,
    )
    .join('')

  const filterRows = Object.entries(report.filters ?? {})
    .map(
      ([k, v]) =>
        `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(String(v))}</td></tr>`,
    )
    .join('')

  const filterTable =
    filterRows.length > 0
      ? `<table class="kv">${filterRows}</table>`
      : `<p class="muted">${text.noFilters}</p>`

  return `<!DOCTYPE html>
<html lang="${text.htmlLang}">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(text.title)}</title>
  <style>
    :root {
      --bg: #020617;
      --surface: #0b1220;
      --surface-strong: #121f35;
      --line: #1d3557;
      --line-strong: #35608d;
      --text: #e6f0ff;
      --muted: #9ab2d4;
      --primary: #58a6ff;
      --danger: #ff6767;
      --warn: #f0b454;
      --ok: #49d3a2;
    }
    @page { size: A4; margin: 1.2cm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); }
    body {
      font-family: "Noto Sans TC", "Microsoft JhengHei", sans-serif;
      line-height: 1.55;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .report {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line-strong);
      border-radius: 14px;
      padding: 16px;
      background:
        radial-gradient(1200px 360px at -10% -40%, rgba(88, 166, 255, 0.2), transparent 65%),
        radial-gradient(1000px 360px at 110% -50%, rgba(73, 211, 162, 0.12), transparent 70%),
        linear-gradient(170deg, #08111f 0%, #060d1a 55%, #091325 100%);
    }
    .report::before {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0.22;
      background-image:
        linear-gradient(to right, rgba(88, 166, 255, 0.18) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(88, 166, 255, 0.12) 1px, transparent 1px);
      background-size: 24px 24px;
    }
    .report::after {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0.08;
      background: repeating-linear-gradient(
        to bottom,
        rgba(255, 255, 255, 0.8) 0px,
        rgba(255, 255, 255, 0.8) 1px,
        transparent 1px,
        transparent 5px
      );
    }
    .hero {
      position: relative;
      z-index: 1;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px 16px;
      margin-bottom: 12px;
      background: linear-gradient(160deg, rgba(14, 27, 48, 0.86), rgba(8, 19, 34, 0.9));
    }
    .logo-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .logo-badge {
      width: 36px;
      height: 36px;
      border: 1px solid var(--line-strong);
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: rgba(9, 22, 40, 0.9);
      box-shadow: inset 0 0 0 1px rgba(88, 166, 255, 0.2);
    }
    .logo-badge svg {
      width: 24px;
      height: 24px;
      stroke: var(--primary);
      fill: none;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .logo-text {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .logo-title {
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #f4fbff;
    }
    .logo-subtitle {
      font-size: 10px;
      color: var(--muted);
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.25;
      letter-spacing: 0.02em;
      color: #f6fbff;
      text-shadow: 0 0 14px rgba(88, 166, 255, 0.25);
    }
    .meta {
      margin-top: 6px;
      font-size: 12px;
      color: var(--muted);
    }
    .meta-top {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      font-size: 10px;
      color: #9ec1eb;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      font-family: "JetBrains Mono", "Cascadia Code", "Consolas", monospace;
    }
    .meta-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--primary);
      box-shadow: 0 0 8px rgba(88, 166, 255, 0.8);
    }
    .summary-grid {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 12px;
    }
    .stat {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 8px;
      min-height: 56px;
      background: linear-gradient(170deg, rgba(14, 28, 48, 0.82), rgba(8, 17, 30, 0.9));
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .stat-label {
      font-size: 10px;
      color: #9db6d8;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .stat-value {
      font-size: 18px;
      font-weight: 800;
      line-height: 1;
      color: #f4fbff;
      font-family: "JetBrains Mono", "Cascadia Code", "Consolas", monospace;
    }
    .stat-open .stat-value { color: #ffd38e; }
    .stat-fixed .stat-value { color: #abf7de; }
    .stat-ignored .stat-value { color: #d1d9e7; }
    .stat-danger .stat-value { color: #ffabab; }
    .stat-total .stat-value { color: #b4daff; }
    .panel {
      position: relative;
      z-index: 1;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px;
      margin-bottom: 12px;
      background: linear-gradient(165deg, rgba(10, 19, 34, 0.92), rgba(7, 14, 26, 0.92));
    }
    h2 {
      margin: 0 0 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0.06em;
      color: #dff0ff;
      text-transform: uppercase;
    }
    .section-index {
      border: 1px solid var(--line-strong);
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 10px;
      color: var(--primary);
      letter-spacing: 0.12em;
    }
    .kv {
      width: 100%;
      border-collapse: collapse;
    }
    .kv th, .kv td {
      border: 1px solid var(--line);
      padding: 7px 9px;
      text-align: left;
      vertical-align: top;
      font-size: 11px;
    }
    .kv th {
      width: 170px;
      color: #9db5d8;
      background: rgba(19, 39, 66, 0.52);
    }
    .kv td {
      color: #d9e8fc;
      background: rgba(9, 21, 38, 0.44);
      word-break: break-word;
    }
    .muted { color: var(--muted); font-size: 11px; }
    .severity-section { page-break-inside: avoid; }
    .issue {
      border: 1px solid var(--line);
      border-left-width: 3px;
      border-radius: 10px;
      padding: 10px;
      margin: 10px 0 0;
      background: rgba(8, 19, 35, 0.9);
      page-break-inside: avoid;
      box-shadow: inset 0 0 0 1px rgba(88, 166, 255, 0.08);
    }
    .issue-critical { border-left-color: rgba(255, 103, 103, 0.92); }
    .issue-high { border-left-color: rgba(240, 180, 84, 0.92); }
    .issue-medium { border-left-color: rgba(255, 215, 102, 0.9); }
    .issue-low { border-left-color: rgba(88, 166, 255, 0.9); }
    .issue-info { border-left-color: rgba(143, 162, 186, 0.9); }
    .issue-title {
      margin: 0 0 8px;
      font-size: 13px;
      font-weight: 700;
      color: #f0f7ff;
      word-break: break-all;
    }
    .tags {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .tag {
      font-size: 10px;
      border-radius: 999px;
      padding: 2px 8px;
      border: 1px solid var(--line);
      background: rgba(10, 23, 41, 0.82);
      color: #aac2e6;
      letter-spacing: 0.03em;
    }
    .severity-critical {
      color: #ffd5d5;
      border-color: rgba(255, 103, 103, 0.7);
      background: rgba(255, 103, 103, 0.15);
    }
    .severity-high {
      color: #ffe1bf;
      border-color: rgba(240, 180, 84, 0.68);
      background: rgba(240, 180, 84, 0.18);
    }
    .severity-medium {
      color: #fff2b4;
      border-color: rgba(255, 215, 102, 0.62);
      background: rgba(255, 215, 102, 0.16);
    }
    .severity-low {
      color: #cff6ff;
      border-color: rgba(88, 166, 255, 0.64);
      background: rgba(88, 166, 255, 0.16);
    }
    .severity-info {
      color: #d4dbeb;
      border-color: rgba(144, 165, 191, 0.58);
      background: rgba(144, 165, 191, 0.16);
    }
    .status-open {
      color: #ffe1bf;
      border-color: rgba(240, 180, 84, 0.68);
      background: rgba(240, 180, 84, 0.18);
    }
    .status-fixed {
      color: #c8ffea;
      border-color: rgba(73, 211, 162, 0.68);
      background: rgba(73, 211, 162, 0.16);
    }
    .status-ignored {
      color: #d6deee;
      border-color: rgba(143, 162, 186, 0.56);
      background: rgba(143, 162, 186, 0.16);
    }
    pre {
      margin: 6px 0;
      border: 1px solid rgba(88, 166, 255, 0.32);
      background: rgba(4, 10, 18, 0.98);
      color: #d4e7ff;
      padding: 8px;
      border-radius: 8px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 10px;
      line-height: 1.45;
      font-family: "JetBrains Mono", "Cascadia Code", "Consolas", monospace;
    }
    .small {
      margin: 6px 0;
      font-size: 11px;
      color: #c6d8f5;
      word-break: break-word;
    }
    .footer {
      position: relative;
      z-index: 1;
      margin-top: 14px;
      text-align: right;
      font-size: 10px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #8ca5c8;
    }
    @media print {
      .summary-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
      .stat {
        min-height: 52px;
      }
    }
  </style>
</head>
<body>
  <main class="report">
    <header class="hero">
      <div class="logo-row">
        <div class="logo-badge" aria-hidden="true">
          <svg viewBox="0 0 24 24" role="img">
            <path d="M12 3.5L18.5 7.2V14.8L12 18.5L5.5 14.8V7.2L12 3.5Z" />
            <path d="M15.2 8.8H10.3L8.8 12L10.3 15.2H15.2" />
          </svg>
        </div>
        <div class="logo-text">
          <span class="logo-title">Confession</span>
          <span class="logo-subtitle">${escapeHtml(text.logoSubtitle)}</span>
        </div>
      </div>
      <div class="meta-top">
        <span class="meta-dot" aria-hidden="true"></span>
        <span>${escapeHtml(text.topCaption)}</span>
      </div>
      <h1>${escapeHtml(text.title)}</h1>
      <div class="meta">${escapeHtml(text.version)}：${escapeHtml(report.schemaVersion)} ｜ ${escapeHtml(text.exportedAt)}：${escapeHtml(report.exportedAt)}</div>
    </header>

    <section class="summary-grid" aria-label="${escapeHtml(text.summaryAria)}">
      ${summaryCards}
    </section>

    <section class="panel">
      <h2><span class="section-index">01</span>${escapeHtml(text.filtersSection)}</h2>
      ${filterTable}
    </section>

    <section class="panel">
      <h2><span class="section-index">02</span>${escapeHtml(text.summarySection)}</h2>
      <table class="kv">${summaryRows}</table>
    </section>

    <section class="panel">
      <h2><span class="section-index">03</span>${escapeHtml(text.detailsSection)}</h2>
      ${sections || `<p class="muted">${escapeHtml(text.noDetails)}</p>`}
    </section>

    <div class="footer">${escapeHtml(text.generatedBy)}</div>
  </main>
</body>
</html>`
}

function renderIssueCardHtml(
  item: SerializedVulnerability,
  text: PrintableText,
): string {
  return `<article class="issue ${issueSeverityClass(item.severity)}">
    <p class="issue-title">${escapeHtml(item.cweId ?? item.type)} — ${escapeHtml(item.filePath)}:${item.line}:${item.column}</p>
    <div class="tags">
      <span class="tag ${severityTagClass(item.severity)}">${escapeHtml(text.severityTag)}: ${escapeHtml(item.severity)}</span>
      <span class="tag ${statusTagClass(item.status)}">${escapeHtml(text.statusTag)}: ${escapeHtml(item.status)}</span>
      <span class="tag">${escapeHtml(text.humanStatusTag)}: ${escapeHtml(item.humanStatus)}</span>
    </div>
    <p class="small"><strong>${escapeHtml(text.description)}：</strong>${escapeHtml(item.description)}</p>
    <p class="small"><strong>${escapeHtml(text.risk)}：</strong>${escapeHtml(item.riskDescription ?? text.na)}</p>
    <pre>${escapeHtml(item.codeSnippet)}</pre>
    <p class="small"><strong>${escapeHtml(text.fixSuggestion)}：</strong>${escapeHtml(item.fixExplanation ?? text.na)}</p>
  </article>`
}

function issueSeverityClass(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'issue-critical'
    case 'high':
      return 'issue-high'
    case 'medium':
      return 'issue-medium'
    case 'low':
      return 'issue-low'
    case 'info':
      return 'issue-info'
    default:
      return ''
  }
}

function severityTagClass(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'severity-critical'
    case 'high':
      return 'severity-high'
    case 'medium':
      return 'severity-medium'
    case 'low':
      return 'severity-low'
    case 'info':
      return 'severity-info'
    default:
      return ''
  }
}

function statusTagClass(status: string): string {
  switch (status) {
    case 'open':
      return 'status-open'
    case 'fixed':
      return 'status-fixed'
    case 'ignored':
      return 'status-ignored'
    default:
      return ''
  }
}

import type { SerializedVulnerability } from '@server/vulnerability-presenter'

export function groupBySeverity(items: SerializedVulnerability[]) {
  const labels: Array<{ key: string; label: string }> = [
    { key: 'critical', label: '嚴重（critical）' },
    { key: 'high', label: '高風險（high）' },
    { key: 'medium', label: '中風險（medium）' },
    { key: 'low', label: '低風險（low）' },
    { key: 'info', label: '資訊（info）' },
  ]

  const sections = labels.map(({ key, label }) => ({
    key,
    label,
    items: items.filter((item) => item.severity === key),
  }))

  const known = new Set(labels.map((v) => v.key))
  const others = items.filter((item) => !known.has(item.severity))
  if (others.length > 0) {
    sections.push({ key: 'other', label: '其他', items: others })
  }

  return sections
}

export function formatCounter(counter: Record<string, number>): string {
  const entries = Object.entries(counter)
  if (entries.length === 0) return '無'
  return entries.map(([k, v]) => `${k}: ${v}`).join(' | ')
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

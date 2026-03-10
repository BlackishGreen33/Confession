import type { SerializedVulnerability } from '@server/vulnerability-presenter'

import type { ResolvedLocale } from '@/libs/i18n'

function getSeveritySectionLabels(locale: ResolvedLocale): Array<{ key: string; label: string }> {
  switch (locale) {
    case 'zh-CN':
      return [
        { key: 'critical', label: '严重（critical）' },
        { key: 'high', label: '高风险（high）' },
        { key: 'medium', label: '中风险（medium）' },
        { key: 'low', label: '低风险（low）' },
        { key: 'info', label: '信息（info）' },
      ]
    case 'en':
      return [
        { key: 'critical', label: 'Critical' },
        { key: 'high', label: 'High' },
        { key: 'medium', label: 'Medium' },
        { key: 'low', label: 'Low' },
        { key: 'info', label: 'Info' },
      ]
    default:
      return [
        { key: 'critical', label: '嚴重（critical）' },
        { key: 'high', label: '高風險（high）' },
        { key: 'medium', label: '中風險（medium）' },
        { key: 'low', label: '低風險（low）' },
        { key: 'info', label: '資訊（info）' },
      ]
  }
}

export function groupBySeverity(
  items: SerializedVulnerability[],
  locale: ResolvedLocale = 'zh-TW',
) {
  const labels = getSeveritySectionLabels(locale)

  const sections = labels.map(({ key, label }) => ({
    key,
    label,
    items: items.filter((item) => item.severity === key),
  }))

  const known = new Set(labels.map((v) => v.key))
  const others = items.filter((item) => !known.has(item.severity))
  if (others.length > 0) {
    const otherLabel =
      locale === 'en' ? 'Other' : locale === 'zh-CN' ? '其他' : '其他'
    sections.push({ key: 'other', label: otherLabel, items: others })
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

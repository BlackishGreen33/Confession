import type { VulnerabilityDedupCandidate } from '@server/vulnerability-dedupe'

export type VulnerabilitySortBy =
  | 'severity'
  | 'createdAt'
  | 'updatedAt'
  | 'filePath'
  | 'line'

export type DedupedVulnerabilityRow = VulnerabilityDedupCandidate & {
  filePath: string
  line: number
  severity: string
  status: string
  humanStatus: string
  humanReviewedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export function sortVulnerabilities<
  T extends {
    severity: string
    createdAt: Date
    updatedAt: Date
    filePath: string
    line: number
  },
>(items: T[], sortBy: VulnerabilitySortBy, sortOrder: 'asc' | 'desc'): T[] {
  const sorted = [...items].sort((a, b) => {
    if (sortBy === 'severity') {
      const weightA = severityWeight(a.severity)
      const weightB = severityWeight(b.severity)
      return weightA - weightB
    }
    if (sortBy === 'createdAt') {
      return a.createdAt.getTime() - b.createdAt.getTime()
    }
    if (sortBy === 'updatedAt') {
      return a.updatedAt.getTime() - b.updatedAt.getTime()
    }
    if (sortBy === 'line') {
      return a.line - b.line
    }
    return a.filePath.localeCompare(b.filePath)
  })

  if (sortOrder === 'desc') sorted.reverse()
  return sorted
}

export function countBy<T>(
  items: T[],
  selector: (item: T) => string,
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const item of items) {
    const key = selector(item)
    result[key] = (result[key] ?? 0) + 1
  }
  return result
}

function severityWeight(severity: string): number {
  switch (severity) {
    case 'critical':
      return 5
    case 'high':
      return 4
    case 'medium':
      return 3
    case 'low':
      return 2
    case 'info':
      return 1
    default:
      return 0
  }
}

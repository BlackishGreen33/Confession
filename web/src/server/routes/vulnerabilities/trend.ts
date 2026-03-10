import { storage } from '@server/storage'

export interface VulnerabilityTrendDelta {
  date: string
  total: number
  open: number
  fixed: number
  ignored: number
}

interface TrendEventRow {
  createdAt: Date
  eventType: string
  fromStatus: string | null
  toStatus: string | null
}

export function aggregateDailyTrendDeltas(
  rows: TrendEventRow[],
): VulnerabilityTrendDelta[] {
  const map = new Map<string, VulnerabilityTrendDelta>()

  for (const row of rows) {
    const date = row.createdAt.toISOString().slice(0, 10)
    const entry = map.get(date) ?? {
      date,
      total: 0,
      open: 0,
      fixed: 0,
      ignored: 0,
    }

    if (row.eventType === 'scan_detected') {
      entry.total += 1
      entry.open += 1
      map.set(date, entry)
      continue
    }

    if (row.eventType === 'status_changed') {
      if (row.fromStatus === 'open') entry.open -= 1
      if (row.fromStatus === 'fixed') entry.fixed -= 1
      if (row.fromStatus === 'ignored') entry.ignored -= 1

      if (row.toStatus === 'open') entry.open += 1
      if (row.toStatus === 'fixed') entry.fixed += 1
      if (row.toStatus === 'ignored') entry.ignored += 1
      map.set(date, entry)
    }
  }

  return [...map.values()]
}

export function toCumulativeTrend(dailyDeltas: VulnerabilityTrendDelta[]) {
  let cumTotal = 0
  let cumOpen = 0
  let cumFixed = 0
  let cumIgnored = 0

  return dailyDeltas.map(({ date, total, open, fixed, ignored }) => {
    cumTotal += total
    cumOpen += open
    cumFixed += fixed
    cumIgnored += ignored
    return {
      date,
      total: cumTotal,
      open: cumOpen,
      fixed: cumFixed,
      ignored: cumIgnored,
    }
  })
}

export async function buildLegacyTrend() {
  const rowsRaw = await storage.vulnerability.findMany({
    select: { createdAt: true, status: true },
    orderBy: { createdAt: 'asc' },
  })
  const rows = rowsRaw as Array<{ createdAt: Date; status: string }>

  const map = new Map<
    string,
    { total: number; open: number; fixed: number; ignored: number }
  >()
  for (const row of rows) {
    const date = row.createdAt.toISOString().slice(0, 10)
    const entry = map.get(date) ?? {
      total: 0,
      open: 0,
      fixed: 0,
      ignored: 0,
    }
    entry.total += 1
    if (row.status === 'open') entry.open += 1
    else if (row.status === 'fixed') entry.fixed += 1
    else if (row.status === 'ignored') entry.ignored += 1
    map.set(date, entry)
  }

  return toCumulativeTrend(
    [...map.entries()].map(([date, counts]) => ({
      date,
      total: counts.total,
      open: counts.open,
      fixed: counts.fixed,
      ignored: counts.ignored,
    })),
  )
}

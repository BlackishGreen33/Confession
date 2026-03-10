export interface QueryArgs {
  where?: unknown
  select?: unknown
  orderBy?: unknown
  skip?: unknown
  take?: unknown
}

function compareValues(left: unknown, right: unknown): number {
  const normalize = (value: unknown): number | string => {
    if (value instanceof Date) return value.getTime()
    if (typeof value === 'number') return value
    if (typeof value === 'string') return value
    if (typeof value === 'boolean') return value ? 1 : 0
    return String(value ?? '')
  }

  const a = normalize(left)
  const b = normalize(right)
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b
  }
  return String(a).localeCompare(String(b))
}

function matchesCondition(value: unknown, condition: unknown): boolean {
  if (
    condition &&
    typeof condition === 'object' &&
    !Array.isArray(condition) &&
    !(condition instanceof Date)
  ) {
    const cond = condition as Record<string, unknown>

    if ('contains' in cond) {
      return String(value ?? '').includes(String(cond.contains ?? ''))
    }
    if ('startsWith' in cond) {
      return String(value ?? '').startsWith(String(cond.startsWith ?? ''))
    }
    if ('in' in cond) {
      const list = Array.isArray(cond.in) ? cond.in : []
      return list.some((item) => compareValues(value, item) === 0)
    }

    let ok = true
    if ('gte' in cond) ok = ok && compareValues(value, cond.gte) >= 0
    if ('gt' in cond) ok = ok && compareValues(value, cond.gt) > 0
    if ('lte' in cond) ok = ok && compareValues(value, cond.lte) <= 0
    if ('lt' in cond) ok = ok && compareValues(value, cond.lt) < 0
    if ('equals' in cond) ok = ok && compareValues(value, cond.equals) === 0
    return ok
  }

  if (value === condition) return true
  return compareValues(value, condition) === 0
}

export function matchesWhere<T extends object>(
  row: T,
  where: unknown,
): boolean {
  if (!where || typeof where !== 'object') return true
  const condition = where as Record<string, unknown>

  if (Array.isArray(condition.OR)) {
    const anyMatch = condition.OR.some((item) => matchesWhere(row, item))
    if (!anyMatch) return false
  }

  for (const [key, value] of Object.entries(condition)) {
    if (key === 'OR') continue
    const rowRecord = row as Record<string, unknown>
    if (!matchesCondition(rowRecord[key], value)) return false
  }

  return true
}

export function applyWhere<T extends object>(
  rows: T[],
  where: unknown,
): T[] {
  return rows.filter((row) => matchesWhere(row, where))
}

function normalizeOrderBy(
  orderBy: unknown,
): Array<Record<string, 'asc' | 'desc'>> {
  if (!orderBy) return []
  if (Array.isArray(orderBy)) {
    return orderBy.filter(
      (item): item is Record<string, 'asc' | 'desc'> =>
        Boolean(item && typeof item === 'object'),
    )
  }
  if (typeof orderBy === 'object') {
    return [orderBy as Record<string, 'asc' | 'desc'>]
  }
  return []
}

export function applyOrderBy<T extends object>(
  rows: T[],
  orderBy: unknown,
): T[] {
  const specs = normalizeOrderBy(orderBy)
  if (specs.length === 0) return rows

  return [...rows].sort((a, b) => {
    const left = a as Record<string, unknown>
    const right = b as Record<string, unknown>
    for (const spec of specs) {
      const [field, direction] = Object.entries(spec)[0] ?? []
      if (!field) continue
      const compared = compareValues(left[field], right[field])
      if (compared !== 0) {
        return direction === 'asc' ? compared : -compared
      }
    }
    return 0
  })
}

export function applySelect<T extends object>(
  row: T,
  select: unknown,
): Record<string, unknown> {
  if (!select || typeof select !== 'object') {
    return { ...(row as Record<string, unknown>) }
  }

  const rowRecord = row as Record<string, unknown>
  const picked: Record<string, unknown> = {}
  for (const [field, enabled] of Object.entries(select)) {
    if (enabled === true) {
      picked[field] = rowRecord[field]
    }
  }
  return picked
}

export function applyTakeSkip<T>(
  rows: T[],
  args: QueryArgs,
): T[] {
  const skip =
    typeof args.skip === 'number' ? Math.max(0, Math.floor(args.skip)) : 0
  const take =
    typeof args.take === 'number' ? Math.max(0, Math.floor(args.take)) : undefined
  const sliced = rows.slice(skip)
  if (typeof take === 'number') {
    return sliced.slice(0, take)
  }
  return sliced
}

export function applyPatch<T extends object>(
  target: T,
  patch: Record<string, unknown>,
): T {
  const writableTarget = target as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'events') continue
    writableTarget[key] = value
  }
  return target
}

export function findUniqueByWhere<T extends object>(
  rows: T[],
  where: unknown,
): T | null {
  if (!where || typeof where !== 'object') return null
  const query = where as Record<string, unknown>

  if (typeof query.id === 'string') {
    return (
      rows.find((item) => String((item as Record<string, unknown>).id) === query.id) ??
      null
    )
  }

  if (
    query.vuln_idempotent &&
    typeof query.vuln_idempotent === 'object' &&
    query.vuln_idempotent
  ) {
    const idempotent = query.vuln_idempotent as Record<string, unknown>
    return (
      rows.find(
        (item) => {
          const row = item as Record<string, unknown>
          return (
            row.filePath === idempotent.filePath &&
            row.line === idempotent.line &&
            row.column === idempotent.column &&
            row.codeHash === idempotent.codeHash &&
            row.type === idempotent.type
          )
        },
      ) ?? null
    )
  }

  return rows.find((item) => matchesWhere(item, where)) ?? null
}

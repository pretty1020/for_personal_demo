/** Weeks before plan start shown in the capacity matrix (≈ 6 months). */
export const VISIBLE_HISTORY_WEEKS = 26
/** Default planned weeks shown in the matrix (user can expand via week picker / “all future”). */
export const DEFAULT_VISIBLE_FUTURE_WEEKS = 8
/** Maximum future weeks available in the plan horizon / week picker. */
export const MAX_FUTURE_WEEKS = 52

export type CapacityTimeline = 'historical_actual' | 'forward_plan'
export type CapacityStatusLabel = 'Actual' | 'Planned'

export function sliceCapacityWindow<T extends { week: string; timeline: CapacityTimeline }>(
  rows: T[],
  options?: {
    planningWeek?: string | null
    pastWeeks?: number
    futureWeeks?: number
    showFuture?: boolean
    showPast?: boolean
    /** When set, return all rows whose week is in this list (template upload mode). */
    importedWeeks?: string[]
  },
): T[] {
  if (!rows.length) return []

  const importedWeeks = options?.importedWeeks?.filter(Boolean)
  if (importedWeeks?.length) {
    const allowed = new Set(importedWeeks)
    const importedRows = rows.filter((row) => allowed.has(row.week))
    const planningWeek = options?.planningWeek
    const historicalRows =
      options?.showPast === false
        ? []
        : rows.filter((row) => {
            if (row.timeline !== 'historical_actual') return false
            if (planningWeek && row.week >= planningWeek) return false
            return true
          })
    const byWeek = new Map<string, T>()
    for (const row of historicalRows) byWeek.set(row.week, row)
    for (const row of importedRows) byWeek.set(row.week, row)
    // When past is hidden, also drop imported weeks before the current/planning week.
    const values = [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week))
    if (options?.showPast === false && planningWeek) {
      return values.filter((row) => row.week >= planningWeek)
    }
    return values
  }

  const showPast = options?.showPast !== false
  const pastWeeks = showPast ? (options?.pastWeeks ?? VISIBLE_HISTORY_WEEKS) : 0
  const showFuture = options?.showFuture !== false
  const futureWeeks = showFuture
    ? (options?.futureWeeks ?? DEFAULT_VISIBLE_FUTURE_WEEKS)
    : 1
  const planningWeek =
    options?.planningWeek ?? rows.find((row) => row.timeline === 'forward_plan')?.week ?? null

  if (planningWeek) {
    // Prefer anchoring on the real current week when present in the row set.
    let anchorIndex = rows.findIndex((row) => row.week === planningWeek)
    if (anchorIndex < 0) {
      // If calendar current week is before the first ledger week, start at first week ≥ current.
      anchorIndex = rows.findIndex((row) => row.week >= planningWeek)
    }
    if (anchorIndex >= 0) {
      const start = Math.max(0, anchorIndex - pastWeeks)
      const end = anchorIndex + futureWeeks
      return rows.slice(start, end)
    }
  }

  const actualRows = rows.filter((row) => row.timeline === 'historical_actual')
  const futureRows = rows.filter((row) => row.timeline === 'forward_plan')
  return [...actualRows.slice(-pastWeeks), ...futureRows.slice(0, futureWeeks)]
}

export function capacityStatusClass(status: CapacityStatusLabel): string {
  return status === 'Actual'
    ? 'cap-ledger-matrix__week-status cap-ledger-matrix__week-status--actual'
    : 'cap-ledger-matrix__week-status cap-ledger-matrix__week-status--planned'
}

export function capacityWeekHeaderClass(timeline: CapacityTimeline): string {
  return timeline === 'forward_plan'
    ? 'cap-ledger-matrix__week cap-ledger-matrix__week--planned'
    : 'cap-ledger-matrix__week cap-ledger-matrix__week--actual'
}

export function capacityWeekCellClass(timeline: CapacityTimeline): string {
  return timeline === 'forward_plan' ? 'cap-ledger-matrix__cell--planned-week' : 'cap-ledger-matrix__cell--actual-week'
}

export function capacityReadOnlyCellClass(timeline: CapacityTimeline, tone = 'neutral'): string {
  return `pva-ref-table__num pva-ref-table__num--${tone} cap-ledger-matrix__cell cap-ledger-matrix__cell--locked cap-ledger-matrix__cell--calculated ${capacityWeekCellClass(timeline)}`
}

import type { CalendarQuarter, PeriodView } from '../utils/executiveQuarter'
import { capacityMonthOptions, uniqCapacityWeeks } from '../utils/capacityWeekRange'

const STORAGE_KEY = 'wfp-capacity-period-v2'
const LEGACY_STORAGE_KEY = 'wfp-capacity-period-v1'

/** Weekly = no calendar clamp (default matrix window). Other values match Money period views. */
export type CapacityPeriodMode = 'weekly' | PeriodView

export type CapacityPeriodState = {
  mode: CapacityPeriodMode
  /** Selected years for quarterly / H1 / H2 / yearly. */
  years: string[]
  /** Selected months as YYYY-MM for monthly multi-select. */
  months: string[]
  /** Selected quarters (combined with each selected year). */
  quarters: CalendarQuarter[]
}

export const CAPACITY_PERIOD_OPTIONS: { value: CapacityPeriodMode; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'h1', label: 'H1' },
  { value: 'h2', label: 'H2' },
  { value: 'full_year', label: 'Yearly' },
]

const ALL_QUARTERS: CalendarQuarter[] = ['Q1', 'Q2', 'Q3', 'Q4']

function monthNumFromWeek(week: string): number | null {
  if (week.length < 7) return null
  const month = Number.parseInt(week.slice(5, 7), 10)
  return Number.isFinite(month) ? month : null
}

function quarterForMonth(monthNum: number): CalendarQuarter {
  if (monthNum <= 3) return 'Q1'
  if (monthNum <= 6) return 'Q2'
  if (monthNum <= 9) return 'Q3'
  return 'Q4'
}

function toggleInList<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

export function defaultCapacityPeriodState(anchorWeek?: string): CapacityPeriodState {
  const year = anchorWeek && anchorWeek.length >= 4 ? anchorWeek.slice(0, 4) : String(new Date().getFullYear())
  const month = anchorWeek && anchorWeek.length >= 7 ? anchorWeek.slice(0, 7) : `${year}-01`
  const monthNum = Number.parseInt(month.slice(5, 7), 10)
  return {
    mode: 'month',
    years: [year],
    months: [month],
    quarters: [quarterForMonth(Number.isFinite(monthNum) ? monthNum : 1)],
  }
}

function normalizePeriodState(raw: Partial<CapacityPeriodState> & {
  calendarYear?: string
  month?: string
  quarter?: CalendarQuarter | ''
}, fallback: CapacityPeriodState): CapacityPeriodState {
  const mode = CAPACITY_PERIOD_OPTIONS.some((item) => item.value === raw.mode)
    ? (raw.mode as CapacityPeriodMode)
    : 'month'

  const years =
    Array.isArray(raw.years) && raw.years.length
      ? [...new Set(raw.years.filter(Boolean))].sort()
      : raw.calendarYear
        ? [raw.calendarYear]
        : fallback.years

  const months =
    Array.isArray(raw.months) && raw.months.length
      ? [...new Set(raw.months.filter(Boolean))].sort()
      : raw.month
        ? [raw.month]
        : fallback.months

  const quarters =
    Array.isArray(raw.quarters) && raw.quarters.length
      ? (ALL_QUARTERS.filter((q) => raw.quarters!.includes(q)) as CalendarQuarter[])
      : raw.quarter
        ? [raw.quarter as CalendarQuarter]
        : fallback.quarters

  return {
    mode,
    years: years.length ? years : fallback.years,
    months: months.length ? months : fallback.months,
    quarters: quarters.length ? quarters : fallback.quarters,
  }
}

export function loadCapacityPeriod(anchorWeek?: string): CapacityPeriodState {
  const fallback = defaultCapacityPeriodState(anchorWeek)
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<CapacityPeriodState> & {
      calendarYear?: string
      month?: string
      quarter?: CalendarQuarter | ''
    }
    return normalizePeriodState(parsed, fallback)
  } catch {
    return fallback
  }
}

export function saveCapacityPeriod(state: CapacityPeriodState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function formatMonthLabel(month: string): string {
  if (month.length < 7) return month
  const date = new Date(`${month}-01T12:00:00`)
  if (Number.isNaN(date.getTime())) return month
  return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

export function capacityPeriodLabel(state: CapacityPeriodState): string {
  if (state.mode === 'weekly') return 'Weekly'
  if (state.mode === 'month') {
    if (!state.months.length) return 'Monthly'
    if (state.months.length === 1) return formatMonthLabel(state.months[0]!)
    if (state.months.length <= 3) return state.months.map(formatMonthLabel).join(' · ')
    return `${state.months.length} months`
  }
  if (state.mode === 'quarter') {
    const pairs = state.years.flatMap((year) => state.quarters.map((quarter) => `${quarter} ${year}`))
    if (!pairs.length) return 'Quarterly'
    if (pairs.length === 1) return pairs[0]!
    if (pairs.length <= 3) return pairs.join(' · ')
    return `${pairs.length} quarters`
  }
  if (state.mode === 'h1') {
    if (!state.years.length) return 'H1'
    if (state.years.length === 1) return `H1 ${state.years[0]}`
    return `H1 · ${state.years.length} years`
  }
  if (state.mode === 'h2') {
    if (!state.years.length) return 'H2'
    if (state.years.length === 1) return `H2 ${state.years[0]}`
    return `H2 · ${state.years.length} years`
  }
  if (state.mode === 'full_year') {
    if (!state.years.length) return 'Yearly'
    if (state.years.length === 1) return `FY ${state.years[0]}`
    if (state.years.length <= 3) return state.years.map((year) => `FY ${year}`).join(' · ')
    return `${state.years.length} years`
  }
  return 'Period'
}

export function capacityYearOptions(weeks: string[], fallbackYears?: string[]): string[] {
  const years = new Set<string>(fallbackYears ?? [])
  weeks.forEach((week) => {
    if (week.length >= 4) years.add(week.slice(0, 4))
  })
  const current = String(new Date().getFullYear())
  years.add(current)
  years.add(String(Number(current) + 1))
  return [...years].sort()
}

/** Weeks that belong to any of the selected period datasets (union). */
export function weeksMatchingCapacityPeriod(weeks: string[], state: CapacityPeriodState): string[] {
  if (state.mode === 'weekly' || !weeks.length) return weeks

  if (state.mode === 'month') {
    const selected = new Set(state.months.map((month) => month.slice(0, 7)))
    if (!selected.size) return weeks
    return weeks.filter((week) => selected.has(week.slice(0, 7)))
  }

  if (state.mode === 'quarter') {
    const yearSet = new Set(state.years)
    const quarterSet = new Set(state.quarters)
    if (!yearSet.size || !quarterSet.size) return weeks
    return weeks.filter((week) => {
      if (!yearSet.has(week.slice(0, 4))) return false
      const month = monthNumFromWeek(week)
      return month != null && quarterSet.has(quarterForMonth(month))
    })
  }

  if (state.mode === 'h1') {
    const yearSet = new Set(state.years)
    if (!yearSet.size) return weeks
    return weeks.filter((week) => yearSet.has(week.slice(0, 4)) && (monthNumFromWeek(week) ?? 0) <= 6)
  }

  if (state.mode === 'h2') {
    const yearSet = new Set(state.years)
    if (!yearSet.size) return weeks
    return weeks.filter((week) => yearSet.has(week.slice(0, 4)) && (monthNumFromWeek(week) ?? 0) >= 7)
  }

  if (state.mode === 'full_year') {
    const yearSet = new Set(state.years)
    if (!yearSet.size) return weeks
    return weeks.filter((week) => yearSet.has(week.slice(0, 4)))
  }

  return weeks
}

export function resolvePeriodWindowForWeeks(
  weeks: string[],
  state: CapacityPeriodState,
): { weekStart: string; weekEnd: string; active: boolean; matchedWeeks: string[] } {
  if (state.mode === 'weekly' || !weeks.length) {
    return { weekStart: '', weekEnd: '', active: false, matchedWeeks: weeks }
  }
  const matched = weeksMatchingCapacityPeriod(weeks, state)
  if (!matched.length) {
    return { weekStart: '', weekEnd: '', active: false, matchedWeeks: [] }
  }
  return {
    weekStart: matched[0]!,
    weekEnd: matched[matched.length - 1]!,
    active: true,
    matchedWeeks: matched,
  }
}

export function filterRowsByCapacityPeriod<T extends { week: string }>(
  rows: T[],
  state: CapacityPeriodState,
): T[] {
  if (state.mode === 'weekly') return rows
  const weeks = uniqCapacityWeeks(rows)
  const matched = new Set(weeksMatchingCapacityPeriod(weeks, state))
  if (!matched.size) return []
  return rows.filter((row) => matched.has(row.week))
}

/** Optional ISO week-start clamp (inclusive). Empty strings are ignored. */
export function filterRowsByDateRange<T extends { week: string }>(
  rows: T[],
  rangeStart: string,
  rangeEnd: string,
): T[] {
  if (!rangeStart && !rangeEnd) return rows
  return rows.filter((row) => {
    if (rangeStart && row.week < rangeStart) return false
    if (rangeEnd && row.week > rangeEnd) return false
    return true
  })
}

export function resolvePeriodSnapshotWeek(
  weeks: string[],
  state: CapacityPeriodState,
  fallbackWeek: string,
): string {
  const window = resolvePeriodWindowForWeeks(weeks, state)
  if (!window.active || !window.matchedWeeks.length) return fallbackWeek
  return window.matchedWeeks[window.matchedWeeks.length - 1]!
}

/**
 * Matrix aggregation mode for Summary / read-only roll-ups.
 * Longer calendar periods use monthly buckets so H1 / H2 / Yearly stay readable and accurate.
 */
export function capacityMatrixViewForPeriod(
  mode: CapacityPeriodMode,
): 'weekly' | 'monthly' | 'quarterly' {
  if (mode === 'month' || mode === 'h1' || mode === 'h2' || mode === 'full_year') return 'monthly'
  if (mode === 'quarter') return 'quarterly'
  return 'weekly'
}

export function togglePeriodYear(state: CapacityPeriodState, year: string): CapacityPeriodState {
  const years = toggleInList(state.years, year)
  return { ...state, years: years.length ? years.sort() : state.years }
}

export function togglePeriodMonth(state: CapacityPeriodState, month: string): CapacityPeriodState {
  const months = toggleInList(state.months, month)
  return { ...state, months: months.length ? months.sort() : state.months }
}

export function togglePeriodQuarter(state: CapacityPeriodState, quarter: CalendarQuarter): CapacityPeriodState {
  const quarters = toggleInList(state.quarters, quarter)
  return { ...state, quarters: quarters.length ? (ALL_QUARTERS.filter((q) => quarters.includes(q)) as CalendarQuarter[]) : state.quarters }
}

export { capacityMonthOptions, uniqCapacityWeeks, ALL_QUARTERS }

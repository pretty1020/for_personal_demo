import type { DerivedCapacityRow } from '../planner/capacityPlanDerived'
import type { CalendarQuarter, PeriodView } from './executiveQuarter'
import { dominantMonthKeyFromWeekStart } from './staffingCapacity/calendarWeek'

export function uniqCapacityWeeks(rows: DerivedCapacityRow[]): string[] {
  return [...new Set(rows.map((row) => row.week).filter(Boolean))].sort()
}

export function filterCapacityRowsByWeekRange(
  rows: DerivedCapacityRow[],
  weekStart: string,
  weekEnd: string,
): DerivedCapacityRow[] {
  if (!weekStart && !weekEnd) return rows
  return rows.filter((row) => {
    if (weekStart && row.week < weekStart) return false
    if (weekEnd && row.week > weekEnd) return false
    return true
  })
}

function monthKeyFromWeek(week: string): string {
  return dominantMonthKeyFromWeekStart(week)
}

function monthNumFromWeek(week: string): number | null {
  const key = monthKeyFromWeek(week)
  if (key.length < 7) return null
  const month = Number.parseInt(key.slice(5, 7), 10)
  return Number.isFinite(month) ? month : null
}

function yearFromWeek(week: string): string {
  const key = monthKeyFromWeek(week)
  return key.length >= 4 ? key.slice(0, 4) : week.slice(0, 4)
}

function weeksInCalendarYear(weeks: string[], year: string): string[] {
  return weeks.filter((week) => yearFromWeek(week) === year)
}

function weeksInMonth(weeks: string[], monthPrefix: string): string[] {
  const prefix = monthPrefix.length >= 7 ? monthPrefix.slice(0, 7) : monthPrefix
  return weeks.filter((week) => monthKeyFromWeek(week) === prefix)
}

function weeksInQuarter(weeks: string[], quarter: CalendarQuarter, year: string): string[] {
  const quarterMonths: Record<CalendarQuarter, number[]> = {
    Q1: [1, 2, 3],
    Q2: [4, 5, 6],
    Q3: [7, 8, 9],
    Q4: [10, 11, 12],
  }
  return weeks.filter((week) => {
    if (yearFromWeek(week) !== year) return false
    const month = monthNumFromWeek(week)
    return month != null && quarterMonths[quarter].includes(month)
  })
}

/** Weeks that fall in the selected period. Empty when the period has no matching weeks. */
export function listWeeksInPeriod(
  weeks: string[],
  periodView: PeriodView,
  calendarYear: string,
  month: string,
  quarter: CalendarQuarter | '',
): string[] {
  if (!weeks.length) return []
  if (periodView === 'month' && month) return weeksInMonth(weeks, month)
  if (periodView === 'quarter' && quarter && calendarYear) return weeksInQuarter(weeks, quarter, calendarYear)
  if (periodView === 'h1' && calendarYear) {
    return weeks.filter((week) => yearFromWeek(week) === calendarYear && (monthNumFromWeek(week) ?? 0) <= 6)
  }
  if (periodView === 'h2' && calendarYear) {
    return weeks.filter((week) => yearFromWeek(week) === calendarYear && (monthNumFromWeek(week) ?? 0) >= 7)
  }
  if (periodView === 'full_year' && calendarYear) return weeksInCalendarYear(weeks, calendarYear)
  return weeks
}

export function resolveCapacityWeekWindow(
  weeks: string[],
  periodView: PeriodView,
  calendarYear: string,
  month: string,
  quarter: CalendarQuarter | '',
): { weekStart: string; weekEnd: string } {
  if (!weeks.length) return { weekStart: '', weekEnd: '' }
  const scoped = listWeeksInPeriod(weeks, periodView, calendarYear, month, quarter)
  const use = scoped.length ? scoped : weeks
  return { weekStart: use[0]!, weekEnd: use[use.length - 1]! }
}

/** Inclusive custom week window. Returns [] when start is after end. */
export function listWeeksInCustomRange(weeks: string[], weekStart: string, weekEnd: string): string[] {
  if (!weekStart && !weekEnd) return weeks
  return weeks.filter((week) => {
    if (weekStart && week < weekStart) return false
    if (weekEnd && week > weekEnd) return false
    return true
  })
}

export function resolveFiscalYearWeekWindow(
  weeks: string[],
  calendarYear: string,
  includeNextYear = false,
): { weekStart: string; weekEnd: string } {
  if (!weeks.length) return { weekStart: '', weekEnd: '' }
  const years = includeNextYear
    ? [calendarYear, String(Number(calendarYear) + 1)]
    : [calendarYear]
  const scoped = weeks.filter((week) => years.some((year) => yearFromWeek(week) === year))
  const use = scoped.length ? scoped : weeks
  return { weekStart: use[0]!, weekEnd: use[use.length - 1]! }
}

export function capacityMonthOptions(weeks: string[]): string[] {
  const months = new Set<string>()
  weeks.forEach((week) => {
    const key = monthKeyFromWeek(week)
    if (key.length >= 7) months.add(key)
  })
  return [...months].sort()
}

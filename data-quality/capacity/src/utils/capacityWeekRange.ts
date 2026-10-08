import type { CalendarQuarter, PeriodView } from './executiveQuarter'

export function uniqCapacityWeeks(rows: Array<{ week: string }>): string[] {
  return [...new Set(rows.map((row) => row.week).filter(Boolean))].sort()
}

export function filterCapacityRowsByWeekRange<T extends { week: string }>(
  rows: T[],
  weekStart: string,
  weekEnd: string,
): T[] {
  if (!weekStart && !weekEnd) return rows
  return rows.filter((row) => {
    if (weekStart && row.week < weekStart) return false
    if (weekEnd && row.week > weekEnd) return false
    return true
  })
}

function monthNumFromWeek(week: string): number | null {
  if (week.length < 7) return null
  const month = Number.parseInt(week.slice(5, 7), 10)
  return Number.isFinite(month) ? month : null
}

function weeksInCalendarYear(weeks: string[], year: string): string[] {
  return weeks.filter((week) => week.startsWith(year))
}

function weeksInMonth(weeks: string[], monthPrefix: string): string[] {
  const prefix = monthPrefix.length >= 7 ? monthPrefix.slice(0, 7) : monthPrefix
  return weeks.filter((week) => week.startsWith(prefix))
}

function weeksInQuarter(weeks: string[], quarter: CalendarQuarter, year: string): string[] {
  const quarterMonths: Record<CalendarQuarter, number[]> = {
    Q1: [1, 2, 3],
    Q2: [4, 5, 6],
    Q3: [7, 8, 9],
    Q4: [10, 11, 12],
  }
  return weeks.filter((week) => {
    if (!week.startsWith(year)) return false
    const month = monthNumFromWeek(week)
    return month != null && quarterMonths[quarter].includes(month)
  })
}

export function resolveCapacityWeekWindow(
  weeks: string[],
  periodView: PeriodView,
  calendarYear: string,
  month: string,
  quarter: CalendarQuarter | '',
): { weekStart: string; weekEnd: string } {
  if (!weeks.length) return { weekStart: '', weekEnd: '' }

  let scoped = weeks
  if (periodView === 'month' && month) {
    scoped = weeksInMonth(weeks, month)
  } else if (periodView === 'quarter' && quarter && calendarYear) {
    scoped = weeksInQuarter(weeks, quarter, calendarYear)
  } else if (periodView === 'h1' && calendarYear) {
    scoped = weeks.filter((week) => week.startsWith(calendarYear) && (monthNumFromWeek(week) ?? 0) <= 6)
  } else if (periodView === 'h2' && calendarYear) {
    scoped = weeks.filter((week) => week.startsWith(calendarYear) && (monthNumFromWeek(week) ?? 0) >= 7)
  } else if (periodView === 'full_year' && calendarYear) {
    scoped = weeksInCalendarYear(weeks, calendarYear)
  }

  if (!scoped.length) scoped = weeks
  return { weekStart: scoped[0]!, weekEnd: scoped[scoped.length - 1]! }
}

export function capacityMonthOptions(weeks: string[]): string[] {
  const months = new Set<string>()
  weeks.forEach((week) => {
    if (week.length >= 7) months.add(week.slice(0, 7))
  })
  return [...months].sort()
}

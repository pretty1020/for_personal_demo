import type { ExecutiveUnifiedRow } from '../types/dashboard'

export type CalendarQuarter = 'Q1' | 'Q2' | 'Q3' | 'Q4'

export type PeriodView = 'month' | 'quarter' | 'h1' | 'h2' | 'full_year'

const QM: Record<CalendarQuarter, number[]> = {
  Q1: [1, 2, 3],
  Q2: [4, 5, 6],
  Q3: [7, 8, 9],
  Q4: [10, 11, 12],
}

const H1_MONTHS = [1, 2, 3, 4, 5, 6]
const H2_MONTHS = [7, 8, 9, 10, 11, 12]

/** Calendar year from month_bucket (YYYY-MM-01) */
export function yearFromMonthBucket(mb: string | null): string | null {
  if (!mb || mb.length < 7) return null
  return mb.slice(0, 4)
}

export function monthNumFromMonthBucket(mb: string | null): number | null {
  if (!mb || mb.length < 7) return null
  return Number.parseInt(mb.slice(5, 7), 10)
}

export function rowInCalendarQuarter(
  r: ExecutiveUnifiedRow,
  quarter: CalendarQuarter | '',
  calendarYear: string,
): boolean {
  if (!quarter || !calendarYear) return true
  const mb = r.month_bucket
  if (!mb) return false
  if (yearFromMonthBucket(mb) !== calendarYear) return false
  const m = monthNumFromMonthBucket(mb)
  if (m == null || Number.isNaN(m)) return false
  return QM[quarter].includes(m)
}

export function uniqYearsFromRows(rows: ExecutiveUnifiedRow[]): string[] {
  const ys = new Set<string>()
  for (const r of rows) {
    const y = yearFromMonthBucket(r.month_bucket)
    if (y) ys.add(y)
  }
  return [...ys].sort()
}

export function rowInHalfYear(
  r: ExecutiveUnifiedRow,
  half: 'h1' | 'h2',
  calendarYear: string,
): boolean {
  if (!calendarYear) return true
  const mb = r.month_bucket
  if (!mb) return false
  if (yearFromMonthBucket(mb) !== calendarYear) return false
  const m = monthNumFromMonthBucket(mb)
  if (m == null || Number.isNaN(m)) return false
  return (half === 'h1' ? H1_MONTHS : H2_MONTHS).includes(m)
}

export function rowInFullYear(r: ExecutiveUnifiedRow, calendarYear: string): boolean {
  if (!calendarYear) return true
  return yearFromMonthBucket(r.month_bucket) === calendarYear
}

export function rowInPeriod(
  r: ExecutiveUnifiedRow,
  view: PeriodView,
  calendarYear: string,
  monthPrefix: string,
  quarter: CalendarQuarter | '',
): boolean {
  if (view === 'month' && monthPrefix) {
    const mb = r.month_bucket
    return Boolean(mb && mb.startsWith(monthPrefix.slice(0, 7)))
  }
  if (view === 'quarter' && quarter && calendarYear) {
    return rowInCalendarQuarter(r, quarter, calendarYear)
  }
  if (view === 'h1' && calendarYear) return rowInHalfYear(r, 'h1', calendarYear)
  if (view === 'h2' && calendarYear) return rowInHalfYear(r, 'h2', calendarYear)
  if (view === 'full_year' && calendarYear) return rowInFullYear(r, calendarYear)
  return true
}

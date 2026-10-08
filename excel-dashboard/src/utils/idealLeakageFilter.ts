import type { CalendarQuarter, PeriodView } from './executiveQuarter'
import { normalizeWeekStartKey } from './staffingCapacity/calendarWeek'
import { inferQuarterFromMonthShort } from './staffingCapacity/calendarQuarter'
import type { StaffingEnrichedRow } from './staffingCapacity/types'

function monthBucketFromWeekStart(weekStartIso: string): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(weekStartIso)
  return m ? `${m[1]}-${m[2]}` : null
}

function staffingRowInPeriod(
  r: StaffingEnrichedRow,
  opts: {
    periodView: PeriodView
    calendarYear: string
    monthPrefix: string
    quarter: CalendarQuarter | ''
  },
): boolean {
  const mb = r.weekStartDate ? monthBucketFromWeekStart(r.weekStartDate) : null
  if (!mb) return false
  const year = mb.slice(0, 4)
  const monthNum = Number.parseInt(mb.slice(5, 7), 10)

  if (opts.periodView === 'month' && opts.monthPrefix) {
    return mb.startsWith(opts.monthPrefix.slice(0, 7))
  }
  if (opts.periodView === 'quarter' && opts.quarter && opts.calendarYear) {
    if (year !== opts.calendarYear) return false
    const q = inferQuarterFromMonthShort(r.month || mb.slice(5, 7))
    if (!q) {
      const qFromNum = monthNum <= 3 ? 1 : monthNum <= 6 ? 2 : monthNum <= 9 ? 3 : 4
      return (`Q${qFromNum}` as CalendarQuarter) === opts.quarter
    }
    return (`Q${q}` as CalendarQuarter) === opts.quarter
  }
  if (opts.periodView === 'h1' && opts.calendarYear) {
    return year === opts.calendarYear && monthNum >= 1 && monthNum <= 6
  }
  if (opts.periodView === 'h2' && opts.calendarYear) {
    return year === opts.calendarYear && monthNum >= 7 && monthNum <= 12
  }
  if (opts.periodView === 'full_year' && opts.calendarYear) {
    return year === opts.calendarYear
  }
  return true
}

export function filterStaffingLeakageRows(
  rows: StaffingEnrichedRow[],
  opts: {
    client?: string
    weekStart?: string
    weekEnd?: string
    periodView?: PeriodView
    calendarYear?: string
    monthPrefix?: string
    quarter?: CalendarQuarter | ''
    useWeekRange?: boolean
  },
): StaffingEnrichedRow[] {
  const ws = opts.weekStart ? normalizeWeekStartKey(opts.weekStart) : ''
  const we = opts.weekEnd ? normalizeWeekStartKey(opts.weekEnd) : ''
  const useWeekRange = opts.useWeekRange ?? false

  return rows.filter((r) => {
    if (opts.client && r.client !== opts.client) return false
    if (opts.periodView && opts.calendarYear) {
      if (
        !staffingRowInPeriod(r, {
          periodView: opts.periodView,
          calendarYear: opts.calendarYear,
          monthPrefix: opts.monthPrefix ?? '',
          quarter: opts.quarter ?? '',
        })
      ) {
        return false
      }
    }
    if (!useWeekRange || (!ws && !we)) return true
    const wk = normalizeWeekStartKey(r.weekStartDate)
    if (!wk) return false
    if (ws && wk < ws) return false
    if (we && wk > we) return false
    return true
  })
}

export function staffingWeeksInData(rows: StaffingEnrichedRow[]): string[] {
  return [...new Set(rows.map((r) => normalizeWeekStartKey(r.weekStartDate)).filter(Boolean))].sort()
}

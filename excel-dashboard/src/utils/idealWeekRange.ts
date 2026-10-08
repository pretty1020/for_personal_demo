import type { ExecutiveUnifiedRow } from '../types/dashboard'

export const IDEAL_DEFAULT_WEEK_COUNT = 12

export function uniqIdealWeeks(rows: ExecutiveUnifiedRow[]): string[] {
  return [...new Set(rows.map((r) => r.week_start ?? '').filter(Boolean))].sort()
}

export function defaultWeekWindow(
  weeks: string[],
  count: number = IDEAL_DEFAULT_WEEK_COUNT,
): { weekStart: string; weekEnd: string } {
  if (!weeks.length) return { weekStart: '', weekEnd: '' }
  const weekEnd = weeks[weeks.length - 1]!
  const weekStart = weeks[Math.max(0, weeks.length - count)] ?? weekEnd
  return { weekStart, weekEnd }
}

export function filterRowsByWeekRange(
  rows: ExecutiveUnifiedRow[],
  weekStart: string,
  weekEnd: string,
): ExecutiveUnifiedRow[] {
  if (!weekStart && !weekEnd) return rows
  return rows.filter((r) => {
    const w = r.week_start ?? ''
    if (!w) return true
    if (weekStart && w < weekStart) return false
    if (weekEnd && w > weekEnd) return false
    return true
  })
}

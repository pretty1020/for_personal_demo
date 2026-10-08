import type { WeekStart } from './types'
import { normalizeTimeZone, todayIsoInTimeZone } from './clientTimezones'

/** Local calendar YYYY-MM-DD (avoids UTC day shifts from toISOString). */
export function isoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function addWeeks(date: Date, weeks: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + weeks * 7)
  return next
}

export function startOfWeek(date: Date, weekStart: WeekStart): Date {
  const out = new Date(date)
  out.setHours(12, 0, 0, 0)
  const day = out.getDay()
  const diff = weekStart === 'monday' ? (day + 6) % 7 : day
  out.setDate(out.getDate() - diff)
  return out
}

/** Snap an ISO date (or Date) to the configured week-start boundary. */
export function snapToWeekStart(value: string | Date, weekStart: WeekStart): string {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T12:00:00`) : value
  return isoDate(startOfWeek(date, weekStart))
}

/**
 * Default plan start = current week boundary in the client timezone.
 * Falls back to Asia/Manila when timezone is missing.
 */
export function defaultCapacityPlanStartWeek(
  weekStart: WeekStart = 'sunday',
  timeZone?: string | null,
): string {
  return snapToWeekStart(todayIsoInTimeZone(timeZone), weekStart)
}

/** Real calendar “this week” in the client timezone (same boundary as defaultCapacityPlanStartWeek). */
export function resolveCurrentCalendarWeek(
  weekStart: WeekStart = 'sunday',
  timeZone?: string | null,
): string {
  return defaultCapacityPlanStartWeek(weekStart, timeZone)
}

export function resolveCapacityPlanStartWeek(plan: {
  weekStart: WeekStart
  capacityPlanStartWeek?: string
  timezone?: string | null
}): string {
  if (plan.capacityPlanStartWeek) {
    return snapToWeekStart(plan.capacityPlanStartWeek, plan.weekStart)
  }
  return defaultCapacityPlanStartWeek(plan.weekStart, plan.timezone)
}

export function compareIsoWeeks(a: string, b: string): number {
  return a.localeCompare(b)
}

export function uniqueSortedWeeks(weeks: string[]): string[] {
  return [...new Set(weeks.map((w) => w.slice(0, 10)).filter(Boolean))].sort(compareIsoWeeks)
}

/** True when the week start date is before the current week boundary in the client timezone. */
export function weekHasPassed(
  weekIso: string,
  weekStart: WeekStart,
  timeZone?: string | null,
): boolean {
  return weekIso < snapToWeekStart(todayIsoInTimeZone(timeZone), weekStart)
}

export function resolveCapacityWeekStatus(
  weekIso: string,
  timeline: 'historical_actual' | 'forward_plan',
  weekStart: WeekStart,
  timeZone?: string | null,
): 'Actual' | 'Planned' {
  if (timeline === 'historical_actual' || weekHasPassed(weekIso, weekStart, timeZone)) return 'Actual'
  return 'Planned'
}

export function normalizePlanTimeZone(value?: string | null): string {
  return normalizeTimeZone(value)
}

import type { WeekStart } from './types'

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

/** Default plan start = current week boundary (Sunday or Monday). */
export function defaultCapacityPlanStartWeek(weekStart: WeekStart = 'sunday'): string {
  return snapToWeekStart(new Date(), weekStart)
}

/** Real calendar “this week” (same boundary as defaultCapacityPlanStartWeek). */
export function resolveCurrentCalendarWeek(weekStart: WeekStart = 'sunday'): string {
  return defaultCapacityPlanStartWeek(weekStart)
}

export function resolveCapacityPlanStartWeek(
  plan: { weekStart: WeekStart; capacityPlanStartWeek?: string },
): string {
  if (plan.capacityPlanStartWeek) {
    return snapToWeekStart(plan.capacityPlanStartWeek, plan.weekStart)
  }
  return defaultCapacityPlanStartWeek(plan.weekStart)
}

export function compareIsoWeeks(a: string, b: string): number {
  return a.localeCompare(b)
}

export function uniqueSortedWeeks(weeks: string[]): string[] {
  return [...new Set(weeks.map((w) => w.slice(0, 10)).filter(Boolean))].sort(compareIsoWeeks)
}

/** True when the week start date is before the current week boundary. */
export function weekHasPassed(weekIso: string, weekStart: WeekStart): boolean {
  return weekIso < snapToWeekStart(new Date(), weekStart)
}

export function resolveCapacityWeekStatus(
  weekIso: string,
  timeline: 'historical_actual' | 'forward_plan',
  weekStart: WeekStart,
): 'Actual' | 'Planned' {
  if (timeline === 'historical_actual' || weekHasPassed(weekIso, weekStart)) return 'Actual'
  return 'Planned'
}

/** Fiscal capacity horizon: April 2026 through March 2027. */
export const CAPACITY_FISCAL_START_ISO = '2026-04-01'
export const CAPACITY_FISCAL_END_ISO = '2027-03-31'

/** First week boundary on or after the fiscal year start (April 2026). */
export function resolveCapacityFiscalStartWeek(weekStart: WeekStart): string {
  return snapToWeekStart(CAPACITY_FISCAL_START_ISO, weekStart)
}

/** Last week boundary that still falls within March 2027. */
export function resolveCapacityFiscalEndWeek(weekStart: WeekStart): string {
  let cursor = startOfWeek(new Date(`${CAPACITY_FISCAL_END_ISO}T12:00:00`), weekStart)
  while (cursor.getFullYear() > 2027 || (cursor.getFullYear() === 2027 && cursor.getMonth() > 2)) {
    cursor = addWeeks(cursor, -1)
  }
  return isoDate(cursor)
}

export function countInclusiveIsoWeeks(fromWeek: string, toWeek: string): number {
  const from = fromWeek.slice(0, 10)
  const to = toWeek.slice(0, 10)
  if (from > to) return 0
  let count = 0
  let cursor = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  while (cursor <= end) {
    count += 1
    cursor = addWeeks(cursor, 1)
  }
  return count
}

/** Planned weeks from plan start through the fiscal end (March 2027). */
export function resolvePlanHorizonWeeks(planStartWeek: string, weekStart: WeekStart): number {
  const fiscalEnd = resolveCapacityFiscalEndWeek(weekStart)
  if (planStartWeek > fiscalEnd) return 1
  return countInclusiveIsoWeeks(planStartWeek, fiscalEnd)
}

/** Forward weeks from an anchor (e.g. current planning week) through fiscal end. */
export function resolveFutureWeeksToFiscalEnd(anchorWeek: string, weekStart: WeekStart): number {
  return resolvePlanHorizonWeeks(anchorWeek, weekStart)
}

import { evaluateFormulaOrFallback, type FormulaScope } from './formulas/formulaRegistry'
import { networkDaysInMonth } from './revenueProjections/networkDays'
import { dominantMonthKeyFromWeekStart } from '../utils/staffingCapacity/calendarWeek'

/** Fallback weeks used when a week has no calendar month. Prefer networkDays / 5. */
export const WEEKS_PER_MONTH = 4.33
export const NETWORK_DAYS_PER_WEEK = 5

export type WeeklyHoursSpec = {
  loginHours?: number
  absenteeismPct?: number
  shrinkagePct?: number
}

export function weeksInMonthForWeek(weekIso?: string, scope?: FormulaScope): number {
  const monthKey = weekIso ? dominantMonthKeyFromWeekStart(weekIso) : ''
  const networkDays = monthKey ? networkDaysInMonth(monthKey) : 0
  const days = networkDays > 0 ? networkDays : WEEKS_PER_MONTH * NETWORK_DAYS_PER_WEEK
  const fallback = days / NETWORK_DAYS_PER_WEEK
  return Math.max(
    0.01,
    evaluateFormulaOrFallback('financial.weeksInMonth', { networkDays: days }, fallback, scope),
  )
}

export function resolveWeeklyProductiveHours(
  spec: WeeklyHoursSpec | undefined,
  standardHoursPerWeek: number,
  scope?: FormulaScope,
): number {
  const fallbackHours = standardHoursPerWeek > 0 ? standardHoursPerWeek : 40
  if (!spec || (spec.loginHours == null && spec.absenteeismPct == null && spec.shrinkagePct == null)) {
    return fallbackHours
  }
  const loginHours =
    spec.loginHours != null && spec.loginHours > 0 ? spec.loginHours : fallbackHours / NETWORK_DAYS_PER_WEEK
  const absenteeismPct = spec.absenteeismPct ?? 0
  const shrinkagePct = spec.shrinkagePct ?? 0
  const fallback =
    NETWORK_DAYS_PER_WEEK * loginHours * Math.max(0, 1 - absenteeismPct / 100 - shrinkagePct / 100)
  return Math.max(
    0,
    evaluateFormulaOrFallback(
      'financial.weeklyProductiveHours',
      {
        networkDays: NETWORK_DAYS_PER_WEEK,
        loginHours,
        absenteeismPct,
        shrinkagePct,
      },
      fallback,
      scope,
    ),
  )
}

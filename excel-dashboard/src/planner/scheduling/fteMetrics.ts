import { allIntervalTimes } from './intervalSlots'

import type { IntervalMetricRow } from './types'

/** Sum a numeric field across all interval metric rows (all 48 slots). */
export function sumIntervalMetricRows(
  intervals: IntervalMetricRow[],
  pick: (row: IntervalMetricRow) => number,
): number {
  let sum = 0
  for (const row of intervals) sum += pick(row)
  return sum
}

/** FTE from interval-row sums — matches Excel SUM(column)/shiftHours/(60÷intervalMinutes). */
export function dailyFteFromIntervalMetricRows(
  intervals: IntervalMetricRow[],
  pick: (row: IntervalMetricRow) => number,
  shiftLengthHours: number,
  intervalMinutes: number,
): number {
  return dailyScheduledFromIntervalSum(
    sumIntervalMetricRows(intervals, pick),
    shiftLengthHours,
    intervalMinutes,
  )
}

/** Interval staffing units → person-hours (30-min slot = 0.5h per agent). */
export function intervalHeadcountToPersonHours(headcount: number, intervalMinutes: number): number {
  return headcount * (intervalMinutes / 60)
}

/** Sum productive interval headcounts across all 48 slots — Excel: SUM(interval column). */
export function sumAllIntervalHeadcounts(intervals: Record<string, number>): number {
  let sum = 0
  for (const interval of allIntervalTimes()) {
    sum += intervals[interval] ?? 0
  }
  return sum
}
/** Sum HoOP interval headcounts into person-hours. */
export function sumHooppIntervalPersonHours(
  intervals: Record<string, number>,
  hoopIntervals: string[],
  intervalMinutes: number,
): number {
  let sum = 0
  for (const interval of hoopIntervals) {
    sum += intervalHeadcountToPersonHours(intervals[interval] ?? 0, intervalMinutes)
  }
  return sum
}

/**
 * Daily scheduled FTE = SUM(day Net FTE intervals) ÷ shiftHours ÷ (60 ÷ intervalMinutes).
 * Excel daily: =SUM(column)/8/2 for 8h shifts and 30-min slots.
 */
export function dailyScheduledFromIntervalSum(
  intervalSum: number,
  shiftLengthHours: number,
  intervalMinutes: number,
): number {
  if (shiftLengthHours <= 0 || intervalMinutes <= 0) return 0
  return intervalSum / (shiftLengthHours * (60 / intervalMinutes))
}

/**
 * Daily FTE from all interval headcounts — alias for {@link dailyScheduledFromIntervalSum}.
 */
export function dailyFteFromAllIntervalHeadcounts(
  intervals: Record<string, number>,
  shiftLengthHours: number,
  intervalMinutes: number,
): number {
  return dailyScheduledFromIntervalSum(
    sumAllIntervalHeadcounts(intervals),
    shiftLengthHours,
    intervalMinutes,
  )
}

/**
 * Weekly scheduled FTE = SUM(week Net FTE intervals) ÷ paidHoursPerWeek ÷ (60 ÷ intervalMinutes).
 * Excel weekly (net Scheduled FTE): =SUM(all days)/45/2 for 45 divisor hours and 30-min slots.
 */
export function weeklyScheduledFromIntervalSum(
  intervalSum: number,
  paidHoursPerWeek: number,
  intervalMinutes: number,
): number {
  if (paidHoursPerWeek <= 0 || intervalMinutes <= 0) return 0
  return intervalSum / (paidHoursPerWeek * (60 / intervalMinutes))
}
/**
 * Daily FTE from HoOP interval headcounts — person-hours in HoOP ÷ shift length.
 * Prefer {@link dailyFteFromAllIntervalHeadcounts} when matching Excel daily totals.
 */
export function dailyFteFromHooppHeadcounts(
  intervals: Record<string, number>,
  hoopIntervals: string[],
  shiftLengthHours: number,
  intervalMinutes: number,
): number {
  return dailyFteFromIntervalSum(
    sumHooppIntervalPersonHours(intervals, hoopIntervals, intervalMinutes),
    shiftLengthHours,
  )
}

/** Daily FTE = sum of interval person-hours ÷ shift hours. */
export function dailyFteFromIntervalSum(intervalSum: number, shiftLengthHours: number): number {
  if (shiftLengthHours <= 0) return 0
  return intervalSum / shiftLengthHours
}

/** Weekly avg daily FTE = sum(daily FTE) ÷ working days. */
export function weeklyAvgFromDailySum(dailySum: number, workingDayCount: number): number {
  if (workingDayCount <= 0) return 0
  return dailySum / workingDayCount
}

export function staffingPct(scheduled: number, required: number): number | null {
  if (required <= 0) return null
  return (scheduled / required) * 100
}

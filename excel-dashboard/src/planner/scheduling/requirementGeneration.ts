import { capacityPlannedProductionHc, capacityPlannedRequiredFte } from '../capacityLookup'
import type { DerivedCapacityRow } from '../capacityPlanDerived'
import type { FteSourceMode, IntervalPatternRow, ScheduleHcSourceMode, WeekIntervalPattern } from './types'
import { allIntervalTimes } from './intervalSlots'
import { reconcilePatternRowsToWeekDates } from './intervalPattern'
import { dailyFteFromAllIntervalHeadcounts } from './fteMetrics'
import { buildRequiredIntervalsForDay } from './patternIntervalShape'

export type DailyFteTargets = Record<string, number>

export type RawDayIntervalBuckets = Record<string, Record<string, number>>

/** Raw uploaded values per day/interval (pattern trend, not re-normalized across week). */
export function buildRawDayIntervalBuckets(
  rows: IntervalPatternRow[],
  weekDates: string[],
): RawDayIntervalBuckets {
  const aligned = reconcilePatternRowsToWeekDates(rows, weekDates)
  const buckets: RawDayIntervalBuckets = {}
  for (const day of weekDates) buckets[day] = {}
  for (const row of aligned) {
    if (!weekDates.includes(row.day)) continue
    const dayBucket = buckets[row.day] ?? {}
    dayBucket[row.interval] = (dayBucket[row.interval] ?? 0) + row.value
    buckets[row.day] = dayBucket
  }
  return buckets
}

export function rawDayTotal(bucket: Record<string, number>, activeIntervals?: string[]): number {
  if (activeIntervals?.length) {
    return activeIntervals.reduce((sum, interval) => sum + Math.max(0, bucket[interval] ?? 0), 0)
  }
  return Object.values(bucket).reduce((sum, value) => sum + Math.max(0, value), 0)
}

/** Sum uploaded volume per calendar day — drives day-to-day requirement trend. */
export function buildDayVolumeWeights(
  rows: IntervalPatternRow[],
  weekDates: string[],
): Record<string, number> {
  const aligned = reconcilePatternRowsToWeekDates(rows, weekDates)
  const weights: Record<string, number> = {}
  for (const day of weekDates) weights[day] = 0
  for (const row of aligned) {
    if (!weekDates.includes(row.day)) continue
    weights[row.day] = (weights[row.day] ?? 0) + row.value
  }
  return weights
}

export function resolveWeeklyFte(
  capacityRow: DerivedCapacityRow | null,
  fteSource: FteSourceMode,
  manualWeeklyFte: number,
): number {
  if (fteSource === 'manual') return Math.max(0, manualWeeklyFte)
  return capacityPlannedRequiredFte(capacityRow)
}

/**
 * Distribute weekly FTE across calendar days using uploaded day-level volume weights.
 * Weekly FTE = sum(daily FTE across the week) ÷ paid working days (Excel: sum÷5).
 * So daily budgets sum to weeklyFte × paidWorkingDays before interval shaping.
 */
export function resolveDailyFteTargets(
  weekDates: string[],
  weeklyFte: number,
  dayWeights: Record<string, number>,
  manualDailyFteByDay: Record<string, number>,
  workingDayIsos?: string[],
  paidWorkingDays = 5,
): DailyFteTargets {
  const weeklyDailyBudget = weeklyFte * Math.max(1, paidWorkingDays)
  const eligibleDays = workingDayIsos?.length
    ? weekDates.filter((day) => workingDayIsos.includes(day))
    : weekDates

  const totalWeight = eligibleDays.reduce((sum, day) => sum + Math.max(0, dayWeights[day] ?? 0), 0)
  const evenShare = eligibleDays.length > 0 ? weeklyDailyBudget / eligibleDays.length : 0

  const targets: DailyFteTargets = {}
  for (const day of weekDates) {
    const perDayOverride = manualDailyFteByDay[day]
    if (perDayOverride != null && perDayOverride > 0) {
      targets[day] = perDayOverride
      continue
    }
    if (!eligibleDays.includes(day)) {
      targets[day] = 0
      continue
    }
    if (totalWeight <= 0) {
      targets[day] = evenShare
      continue
    }
    const weight = Math.max(0, dayWeights[day] ?? 0)
    targets[day] = weeklyDailyBudget * (weight / totalWeight)
  }

  return targets
}

export function resolveProductionHc(
  capacityRow: DerivedCapacityRow | null,
  scheduleHcSource: ScheduleHcSourceMode,
  manualProductionHc: number,
  rosterHeadcount = 0,
): number {
  if (scheduleHcSource === 'manual') return Math.max(0, manualProductionHc)
  if (scheduleHcSource === 'roster') return Math.max(0, rosterHeadcount)
  return capacityPlannedProductionHc(capacityRow) || Math.max(0, manualProductionHc)
}

export type GeneratedRequirementDay = {
  day: string
  dailyFte: number
  intervals: Record<string, number>
}

export type GeneratedRequirementTable = {
  days: GeneratedRequirementDay[]
  totals: Record<string, number>
  weeklyFteTarget: number
}

/**
 * Interval required headcount from upload trend — same units as scheduled interval HC.
 */
export function generateIntervalRequirements(
  pattern: WeekIntervalPattern,
  weekDates: string[],
  dailyFteTargets: DailyFteTargets,
  weeklyFteTarget: number,
  fteDailyDivisorHours = 7.5,
  hoopByDay?: Record<string, string[]>,
  rawRows?: IntervalPatternRow[],
  intervalMinutes = 30,
  followUploadedPattern = true,
): GeneratedRequirementTable {
  const slots = allIntervalTimes()
  const days: GeneratedRequirementDay[] = []
  const totals: Record<string, number> = {}
  const rawBuckets = rawRows?.length ? buildRawDayIntervalBuckets(rawRows, weekDates) : null

  for (const day of weekDates) {
    const dailyFte = Math.max(0, dailyFteTargets[day] ?? 0)
    const dayPattern = pattern[day] ?? {}
    const rawBucket = rawBuckets?.[day] ?? {}
    const hasRawDayData = Object.values(rawBucket).some((value) => value > 0)
    const hoopSlots = hoopByDay?.[day] ?? []

    let activeSlots: string[]
    if (hasRawDayData) {
      activeSlots = slots.filter((interval) => (rawBucket[interval] ?? 0) > 0)
    } else if (hoopSlots.length) {
      activeSlots = hoopSlots.filter((interval) => (dayPattern[interval] ?? 0) > 0)
    } else {
      activeSlots = slots.filter((interval) => (dayPattern[interval] ?? 0) > 0)
    }

    const intervals: Record<string, number> = {}
    for (const interval of slots) intervals[interval] = 0

    if (dailyFte > 0 && activeSlots.length > 0) {
      const shaped = buildRequiredIntervalsForDay(
        dailyFte,
        rawBucket,
        dayPattern,
        activeSlots,
        fteDailyDivisorHours,
        intervalMinutes,
        followUploadedPattern,
      )
      for (const interval of activeSlots) {
        intervals[interval] = roundReq(shaped[interval] ?? 0)
        totals[interval] = (totals[interval] ?? 0) + intervals[interval]
      }
    }

    const computedDailyFte = dailyFteFromAllIntervalHeadcounts(
      intervals,
      fteDailyDivisorHours,
      intervalMinutes,
    )
    days.push({ day, dailyFte: computedDailyFte > 0 ? roundReq(computedDailyFte) : roundReq(dailyFte), intervals })
  }

  for (const interval of Object.keys(totals)) {
    totals[interval] = roundReq(totals[interval]!)
  }

  return { days, totals, weeklyFteTarget }
}

function roundReq(value: number): number {
  if (!Number.isFinite(value) || value === 0) return 0
  return Math.round(value * 100) / 100
}

export function sumDailyIntervalTotals(intervals: Record<string, number>): number {
  return Object.values(intervals).reduce((sum, value) => sum + value, 0)
}

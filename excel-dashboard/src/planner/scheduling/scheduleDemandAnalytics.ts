import type { GeneratedSchedulingPackage, SchedulingResult } from './types'
import { staffingNetFteFromRow } from './applyShrinkage'
import { intervalToMinutes } from './intervalSlots'

export type DemandIntervalPoint = {
  day: string
  interval: string
  required: number
  scheduled: number
  gap: number
}

export type ScheduleDemandAnalytics = {
  openDays: number
  demandIntervals: number
  peak: DemandIntervalPoint | null
  valley: DemandIntervalPoint | null
  peakDay: { day: string; required: number } | null
  valleyDay: { day: string; required: number } | null
  topPeakSharePct: number
  understaffedIntervals: number
  overstaffedIntervals: number
  coverageEfficiencyPct: number | null
  peakRequiredHc: number
  rosterHc: number
  scheduledHc: number
  requiredWeekFte: number
  scheduledWeekFte: number
  staffingGapFte: number
  overUnderPct: number | null
  startDistribution: Array<{ start: string; count: number; sharePct: number }>
  demandSpan: { earliest: string; latest: string } | null
}

function demandPoints(result: SchedulingResult): DemandIntervalPoint[] {
  const points: DemandIntervalPoint[] = []
  for (const day of result.days) {
    if (day.isClosed) continue
    for (const row of day.intervals) {
      if (row.requiredFte <= 0.01) continue
      const scheduled = staffingNetFteFromRow(row)
      points.push({
        day: day.day,
        interval: row.interval,
        required: row.requiredFte,
        scheduled,
        gap: row.requiredFte - scheduled,
      })
    }
  }
  return points
}

function startFromCell(value: string): string | null {
  if (!value || value === 'OFF') return null
  const match = /^(\d{2}:\d{2})/.exec(value.trim())
  return match?.[1] ?? null
}

export function analyzeScheduleDemand(pkg: GeneratedSchedulingPackage): ScheduleDemandAnalytics {
  const result = pkg.schedulingResult
  const points = demandPoints(result)
  const openDays = result.days.filter((day) => !day.isClosed)
  const peak = points.reduce<DemandIntervalPoint | null>(
    (best, point) => (!best || point.required > best.required ? point : best),
    null,
  )
  const valley = points.reduce<DemandIntervalPoint | null>(
    (best, point) => (!best || point.required < best.required ? point : best),
    null,
  )

  const dayTotals = openDays.map((day) => ({
    day: day.day,
    required: day.dailyRequiredTotal,
  }))
  const peakDay = dayTotals.reduce<{ day: string; required: number } | null>(
    (best, row) => (!best || row.required > best.required ? row : best),
    null,
  )
  const valleyDay = dayTotals.reduce<{ day: string; required: number } | null>(
    (best, row) => (!best || row.required < best.required ? row : best),
    null,
  )

  const requiredSum = points.reduce((sum, point) => sum + point.required, 0)
  const sorted = [...points].sort((a, b) => b.required - a.required)
  const topCount = Math.max(1, Math.ceil(sorted.length * 0.2))
  const topSum = sorted.slice(0, topCount).reduce((sum, point) => sum + point.required, 0)
  const topPeakSharePct = requiredSum > 0 ? (topSum / requiredSum) * 100 : 0

  const understaffedIntervals = points.filter((point) => point.gap > 0.01).length
  const overstaffedIntervals = points.filter((point) => point.gap < -0.01).length
  const coverageEfficiencyPct =
    points.length > 0 ? (1 - (understaffedIntervals + overstaffedIntervals) / points.length) * 100 : null

  const requiredWeekFte = result.totals.weeklySumRequired ?? result.totals.requiredFte
  const scheduledWeekFte = result.totals.weeklySumScheduled ?? result.totals.scheduledFte
  const staffingGapFte = scheduledWeekFte - requiredWeekFte
  const overUnderPct = requiredWeekFte > 0 ? (staffingGapFte / requiredWeekFte) * 100 : null

  const startCounts = new Map<string, number>()
  let scheduledRows = 0
  for (const row of pkg.weeklyAgentGrid.rows) {
    for (const day of pkg.weeklyAgentGrid.weekDates) {
      const start = startFromCell(row.days[day] ?? 'OFF')
      if (!start) continue
      scheduledRows += 1
      startCounts.set(start, (startCounts.get(start) ?? 0) + 1)
    }
  }
  const startDistribution = [...startCounts.entries()]
    .map(([start, count]) => ({
      start,
      count,
      sharePct: scheduledRows > 0 ? (count / scheduledRows) * 100 : 0,
    }))
    .sort((a, b) => intervalToMinutes(a.start) - intervalToMinutes(b.start))

  const demandSpan =
    points.length > 0
      ? {
          earliest: [...points].sort((a, b) => intervalToMinutes(a.interval) - intervalToMinutes(b.interval))[0]!.interval,
          latest: [...points].sort((a, b) => intervalToMinutes(b.interval) - intervalToMinutes(a.interval))[0]!.interval,
        }
      : null

  return {
    openDays: openDays.length,
    demandIntervals: points.length,
    peak,
    valley,
    peakDay,
    valleyDay,
    topPeakSharePct,
    understaffedIntervals,
    overstaffedIntervals,
    coverageEfficiencyPct,
    peakRequiredHc: peak?.required ?? 0,
    rosterHc: result.totals.rosterPoolHc ?? pkg.productionHc,
    scheduledHc: result.totals.rosterAgentsWithShifts ?? 0,
    requiredWeekFte,
    scheduledWeekFte,
    staffingGapFte,
    overUnderPct,
    startDistribution,
    demandSpan,
  }
}

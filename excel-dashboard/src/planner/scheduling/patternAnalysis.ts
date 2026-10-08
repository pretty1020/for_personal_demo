import type { IntervalPatternRow } from './types'
import { allIntervalTimes, intervalToMinutes, minutesToInterval } from './intervalSlots'
import { buildDayVolumeWeights } from './requirementGeneration'

export type DayHoOP = {
  day: string
  intervals: string[]
  start: string
  end: string
  label: string
}

export type PatternScheduleMeta = {
  workingDays: string[]
  restDays: string[]
  /** Envelope across all working days */
  hoursOfOperation: {
    intervals: string[]
    start: string
    end: string
    label: string
  }
  hoopByDay: Record<string, DayHoOP>
  hoopIntervalSet: Set<string>
}

function formatHoopLabel(start: string, end: string): string {
  return `${start} – ${end}`
}

function buildDayHoOP(day: string, rows: IntervalPatternRow[]): DayHoOP | null {
  const intervals = allIntervalTimes()
  const active = intervals.filter((interval) =>
    rows.some((row) => row.day === day && row.interval === interval && row.value > 0),
  )
  if (!active.length) return null
  const start = active[0]!
  const last = active[active.length - 1]!
  const endMinutes = intervalToMinutes(last) + 30
  return {
    day,
    intervals: active,
    start,
    end: minutesToInterval(endMinutes),
    label: formatHoopLabel(start, minutesToInterval(endMinutes)),
  }
}

/**
 * Working/rest days and Hours of Operation from uploaded pattern volume only.
 * Any day with interval value &gt; 0 is open — never closed by scheduling settings.
 */
export function analyzeUploadedPattern(
  rows: IntervalPatternRow[],
  weekDates: string[],
): PatternScheduleMeta {
  const dayWeights = buildDayVolumeWeights(rows, weekDates)
  const workingDays = weekDates.filter((day) => (dayWeights[day] ?? 0) > 0)
  const restDays = weekDates.filter((day) => (dayWeights[day] ?? 0) <= 0)

  const hoopByDay: Record<string, DayHoOP> = {}
  const hoopIntervalSet = new Set<string>()
  let globalStart = 24 * 60
  let globalEnd = 0

  for (const day of workingDays) {
    const hoop = buildDayHoOP(day, rows)
    if (!hoop) continue
    hoopByDay[day] = hoop
    for (const interval of hoop.intervals) {
      hoopIntervalSet.add(interval)
      const start = intervalToMinutes(interval)
      const end = start + 30
      globalStart = Math.min(globalStart, start)
      globalEnd = Math.max(globalEnd, end)
    }
  }

  const globalIntervals = allIntervalTimes().filter((interval) => {
    const start = intervalToMinutes(interval)
    return start >= globalStart && start < globalEnd
  })

  const hoursOfOperation = {
    intervals: globalIntervals,
    start: globalStart < 24 * 60 ? minutesToInterval(globalStart) : '—',
    end: globalEnd > 0 ? minutesToInterval(globalEnd) : '—',
    label:
      globalStart < 24 * 60 && globalEnd > 0
        ? formatHoopLabel(minutesToInterval(globalStart), minutesToInterval(globalEnd))
        : 'Not detected',
  }

  return {
    workingDays,
    restDays,
    hoursOfOperation,
    hoopByDay,
    hoopIntervalSet,
  }
}

export function hoopIntervalsForDay(meta: PatternScheduleMeta, day: string): string[] {
  return meta.hoopByDay[day]?.intervals ?? []
}

export function isIntervalInHoOP(meta: PatternScheduleMeta, day: string, interval: string): boolean {
  const dayHoOP = meta.hoopByDay[day]
  if (dayHoOP) return dayHoOP.intervals.includes(interval)
  return meta.hoopIntervalSet.has(interval)
}

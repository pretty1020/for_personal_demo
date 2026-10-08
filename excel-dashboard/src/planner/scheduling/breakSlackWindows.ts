import type { SchedulingSettings } from './schedulingSettingsTypes'
import { parseTimeToMinutes, snapToQuarterHour } from './schedulingTimeUtils'

export type ReliefStartWindow = {
  earliest: number
  latest: number
  target: number
}

/**
 * Allowed start times after shift start: target ± slack, snapped to :00/:15/:30/:45.
 * Example: target 120 and slack 30 → 1.5h to 2.5h after shift start.
 */
export function reliefStartWindow(
  shiftStartMinutes: number,
  targetOffsetMinutes: number,
  slackMinutes: number,
  durationMinutes: number,
  shiftLengthHours: number,
  absoluteMinOffset = 0,
): ReliefStartWindow {
  const shiftEnd = shiftStartMinutes + shiftLengthHours * 60
  const slack = Math.max(0, slackMinutes || 0)
  const targetOffset = Math.max(absoluteMinOffset, targetOffsetMinutes || 0)
  const maxStart = shiftEnd - Math.max(durationMinutes, 0)
  const earliest = snapToQuarterHour(
    Math.min(maxStart, shiftStartMinutes + Math.max(absoluteMinOffset, targetOffset - slack)),
  )
  const latest = snapToQuarterHour(Math.min(maxStart, shiftStartMinutes + targetOffset + slack))
  const target = snapToQuarterHour(Math.min(maxStart, shiftStartMinutes + targetOffset))
  const lo = Math.min(earliest, latest)
  const hi = Math.max(earliest, latest)
  return { earliest: lo, latest: hi, target: Math.min(Math.max(target, lo), hi) }
}

export function firstBreakStartWindow(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
): ReliefStartWindow {
  return reliefStartWindow(
    shiftStartMinutes,
    settings.minMinutesBeforeFirstBreak,
    settings.breakSlackMinutes ?? 0,
    settings.breakDurationMinutes,
    settings.shiftLengthHours,
    0,
  )
}

export function lunchStartWindow(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
): ReliefStartWindow {
  return reliefStartWindow(
    shiftStartMinutes,
    settings.minMinutesBeforeLunch,
    settings.lunchSlackMinutes ?? 0,
    settings.unpaidLunchMinutes,
    settings.shiftLengthHours,
    15,
  )
}

export function isInReliefWindow(startMinutes: number, window: ReliefStartWindow): boolean {
  return startMinutes >= window.earliest && startMinutes <= window.latest
}

export function iterateWindowStarts(window: ReliefStartWindow, stepMinutes = 15): number[] {
  const starts: number[] = []
  for (let minute = window.earliest; minute <= window.latest; minute += stepMinutes) {
    starts.push(snapToQuarterHour(minute))
  }
  return [...new Set(starts)]
}

export function clockWindowMinutes(start: string, end: string): { start: number; end: number } {
  return { start: parseTimeToMinutes(start), end: parseTimeToMinutes(end) }
}

/** Prefer clock-window times when they overlap the slack window; never drop slack-valid times. */
export function orderStartsPreferringClock(
  starts: number[],
  clockStart: number,
  clockEnd: number,
): number[] {
  const inside: number[] = []
  const outside: number[] = []
  for (const start of starts) {
    if (start >= clockStart && start <= clockEnd) inside.push(start)
    else outside.push(start)
  }
  return [...inside, ...outside]
}

export function formatHoursLabel(minutes: number): string {
  const hours = Math.round((minutes / 60) * 100) / 100
  if (hours === 1) return '1 hour'
  if (Number.isInteger(hours)) return `${hours} hours`
  return `${hours} hours`
}

export function formatSlackRangeLabel(targetMinutes: number, slackMinutes: number): string {
  const slack = Math.max(0, slackMinutes || 0)
  const earliest = Math.max(0, (targetMinutes || 0) - slack)
  const latest = (targetMinutes || 0) + slack
  if (slack <= 0) return formatHoursLabel(targetMinutes || 0)
  return `${formatHoursLabel(earliest)} – ${formatHoursLabel(latest)}`
}

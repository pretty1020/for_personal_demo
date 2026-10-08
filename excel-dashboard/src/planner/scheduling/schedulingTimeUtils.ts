import type { AllowedStartMinute, ScheduleIntervalMinutes, SchedulingSettings } from './schedulingSettingsTypes'
import { buildCompleteBreakPlan } from './breakScheduleCandidates'
import { minutesToInterval } from './intervalSlots'

export function parseTimeToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return 0
  return Number(match[1]) * 60 + Number(match[2])
}

export function snapToQuarterHour(minutes: number): number {
  // Allow values past 24:00 for overnight shifts (e.g. 22:00 + 9h → 07:00 next day).
  if (!Number.isFinite(minutes)) return 0
  return Math.round(minutes / 15) * 15
}

export function snapMinutesToGrid(
  minutes: number,
  gridMinutes: ScheduleIntervalMinutes,
  allowedOffsets: AllowedStartMinute[] = [0, 15, 30, 45],
): number {
  const quarter = snapToQuarterHour(minutes)
  const minuteOfHour = quarter % 60
  if (allowedOffsets.includes(minuteOfHour as AllowedStartMinute)) return quarter
  const hourBase = Math.floor(quarter / 60) * 60
  const candidates = allowedOffsets
    .map((offset) => hourBase + offset)
    .filter((candidate) => candidate % gridMinutes === 0 || gridMinutes === 15)
  if (!candidates.length) return quarter
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - minutes) < Math.abs(best - minutes) ? candidate : best,
  )
}

export function generateShiftStartOptions(settings: SchedulingSettings): number[] {
  const earliest = parseTimeToMinutes(settings.earliestShiftStart)
  const latest = parseTimeToMinutes(settings.latestShiftStart)
  const shiftDuration = settings.shiftLengthHours * 60
  const grid = settings.scheduleIntervalMinutes

  // Fixed and Flexible both allow the full start window so different agents can cover
  // different intervals. Fixed mode locks each agent to one start for the whole week later.
  const starts: number[] = []
  for (let minute = earliest; minute <= latest; minute += grid) {
    const minuteOfHour = minute % 60
    if (!settings.allowedStartIntervals.includes(minuteOfHour as AllowedStartMinute)) continue
    if (minute + shiftDuration <= 24 * 60) starts.push(minute)
  }
  return starts
}

export function isWithinWindow(minutes: number, start: string, end: string): boolean {
  const from = parseTimeToMinutes(start)
  const to = parseTimeToMinutes(end)
  return minutes >= from && minutes + 1 <= to
}

/** @deprecated Use buildCompleteBreakPlan from breakScheduleCandidates */
export function placeBreakSchedule(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
  agentIndex: number,
  _agentCount: number,
): { lunchStart: number; lunchEnd: number; breaks: Array<[number, number]> } {
  return buildCompleteBreakPlan(settings, shiftStartMinutes, agentIndex)
}

export function formatMinutes(value: number): string {
  return minutesToInterval(value)
}

export function workingMinutesBetween(startMinutes: number, endMinutes: number, grid: number): number {
  return Math.max(0, Math.floor((endMinutes - startMinutes) / grid))
}

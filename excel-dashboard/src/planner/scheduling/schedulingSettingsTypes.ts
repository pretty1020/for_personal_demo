import type { WeekStart } from '../types'

export type WeekDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export type WorkingDayCount = 5 | 6 | 7 | 'custom'

/** How non-working days are placed when using a fixed working-day count. */
export type RestDayLayout = 'consecutive' | 'scattered'

export type ScheduleIntervalMinutes = 15 | 30

export type ShiftStartMode = 'fixed' | 'flexible'

export type AllowedStartMinute = 0 | 15 | 30 | 45

export type ShiftLengthHours = 8 | 9 | 10 | 12

export type BreakLunchSchedulePattern = 'break_break_lunch' | 'break_lunch_break' | 'lunch_break_break'

export const BREAK_LUNCH_PATTERN_OPTIONS: readonly {
  value: BreakLunchSchedulePattern
  label: string
}[] = [
  { value: 'break_break_lunch', label: 'Break · Break · Lunch' },
  { value: 'break_lunch_break', label: 'Break · Lunch · Break' },
  { value: 'lunch_break_break', label: 'Lunch · Break · Break' },
] as const

export type SchedulingConstraints = {
  followUploadedPattern: boolean
  minimizeOverUnder: boolean
  evenlyDistributeLunches: boolean
  evenlyDistributeBreaks: boolean
  preventBreakLunchOverlapShortages: boolean
  /** When checked, lunch↔break separation must be ≥ 1 hour. */
  enforceMinLunchBreakGap: boolean
  /** When checked, generate lunch/breaks in the selected chronological pattern. */
  followBreakLunchPattern: boolean
  breakLunchPattern: BreakLunchSchedulePattern
  /** When checked, saved Supervisor/team block schedules lock those agents to the block start. */
  useTeamBlockSchedules: boolean
}

export type SchedulingSettings = {
  weekStartDay: WeekStart
  planningWeeks: number
  workingDayCount: WorkingDayCount
  workingWeekStartDay: WeekDayKey
  workingDays: WeekDayKey[]
  /** Rest-day placement when working days are auto-derived from count (complement = rest days). */
  restDayLayout: RestDayLayout
  shiftLengthHours: ShiftLengthHours
  paidHours: number
  /** Daily Scheduled FTE divisor hours (SUM intervals ÷ this ÷ interval slots). Default 7.5. */
  fteDailyDivisorHours: number
  /** Daily Required FTE divisor hours (SUM intervals ÷ this ÷ interval slots). Default 8. */
  fteRequiredDailyDivisorHours: number
  /** Weekly Scheduled FTE (net) divisor hours (SUM intervals ÷ this ÷ interval slots). Default 45. */
  fteWeeklyDivisorHours: number
  unpaidLunchMinutes: number
  breakCount: number
  breakDurationMinutes: number
  breakWindowStart: string
  breakWindowEnd: string
  lunchWindowStart: string
  lunchWindowEnd: string
  minMinutesBeforeFirstBreak: number
  /** Earliest lunch start offset from shift start — lunch never begins at shift start. */
  minMinutesBeforeLunch: number
  /** How far first break may move earlier/later than the target (minutes). */
  breakSlackMinutes: number
  /** How far lunch may move earlier/later than the target (minutes). */
  lunchSlackMinutes: number
  minMinutesBetweenBreaksAndLunch: number
  maxConsecutiveWorkingMinutes: number
  scheduleIntervalMinutes: ScheduleIntervalMinutes
  earliestShiftStart: string
  latestShiftStart: string
  allowedStartIntervals: AllowedStartMinute[]
  shiftStartMode: ShiftStartMode
  maxEmployeesPerShiftTemplate: number
  minStaffingCoverage: number
  constraints: SchedulingConstraints
  optimizeShiftStarts: boolean
  maxShiftStartAdjustMinutes: number
}

export type SchedulingRuleTemplate = {
  id: string
  name: string
  clientId: string
  clientName: string
  lobName: string
  scenarioId?: string
  isDefault: boolean
  settings: SchedulingSettings
  createdAt: string
  updatedAt: string
}

export type SchedulingTemplateStore = {
  templates: SchedulingRuleTemplate[]
  /** `${clientId}|${lobName}` → template id */
  defaults: Record<string, string>
}

export const WEEK_DAY_ORDER: WeekDayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export function weekDayFromDate(isoDate: string): WeekDayKey {
  const day = new Date(`${isoDate}T12:00:00`).getDay()
  const map: WeekDayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  return map[day] ?? 'mon'
}

export function templateScopeKey(clientId: string, lobName: string): string {
  return `${clientId}|${lobName.trim().toLowerCase()}`
}

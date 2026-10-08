import type { RestDayLayout, SchedulingSettings, WeekDayKey } from './schedulingSettingsTypes'

export const ALL_WEEK_DAYS: WeekDayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export const WEEK_DAY_LABELS: Record<WeekDayKey, string> = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
}

export const WEEK_DAY_SHORT: Record<WeekDayKey, string> = {
  sun: 'Sun',
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
}

/** Build N consecutive working days starting on any day (wraps around the week). */
export function buildConsecutiveWorkingDays(startDay: WeekDayKey, count: number): WeekDayKey[] {
  const startIndex = ALL_WEEK_DAYS.indexOf(startDay)
  if (startIndex < 0 || count <= 0) return []
  const days: WeekDayKey[] = []
  for (let index = 0; index < count; index += 1) {
    days.push(ALL_WEEK_DAYS[(startIndex + index) % 7]!)
  }
  return days
}

/** Spread N working days across the week (rest days fall between working blocks). */
export function buildScatteredWorkingDays(startDay: WeekDayKey, count: number): WeekDayKey[] {
  if (count <= 0) return []
  if (count >= 7) return [...ALL_WEEK_DAYS]
  const startIndex = ALL_WEEK_DAYS.indexOf(startDay)
  if (startIndex < 0) return buildConsecutiveWorkingDays(startDay, count)

  const offsets = new Set<number>()
  for (let index = 0; index < count; index += 1) {
    offsets.add(Math.min(6, Math.round((index * 7) / count)))
  }
  while (offsets.size < count) {
    for (let offset = 0; offset < 7 && offsets.size < count; offset += 1) {
      offsets.add(offset)
    }
  }

  return [...offsets]
    .sort((a, b) => a - b)
    .map((offset) => ALL_WEEK_DAYS[(startIndex + offset) % 7]!)
}

export function buildWorkingDaysFromSchedule(
  startDay: WeekDayKey,
  count: number,
  layout: RestDayLayout,
): WeekDayKey[] {
  return layout === 'scattered'
    ? buildScatteredWorkingDays(startDay, count)
    : buildConsecutiveWorkingDays(startDay, count)
}

export function formatWorkingDaysRange(days: WeekDayKey[]): string {
  if (!days.length) return 'No working days'
  if (days.length === 1) return `${WEEK_DAY_SHORT[days[0]!]} (1 day)`
  const first = WEEK_DAY_SHORT[days[0]!]
  const last = WEEK_DAY_SHORT[days[days.length - 1]!]
  return `${days.length} days · ${first}–${last}`
}

export function formatRestDaysRange(days: WeekDayKey[]): string {
  if (!days.length) return 'No rest days'
  if (days.length === 1) return `${WEEK_DAY_SHORT[days[0]!]} (1 day)`
  return `${days.length} days · ${days.map((day) => WEEK_DAY_SHORT[day]).join(', ')}`
}

export function resolveWorkingDays(
  settings: Pick<SchedulingSettings, 'workingDayCount' | 'workingWeekStartDay' | 'workingDays' | 'restDayLayout'>,
): WeekDayKey[] {
  if (settings.workingDayCount === 'custom') {
    return ALL_WEEK_DAYS.filter((day) => settings.workingDays.includes(day))
  }
  return buildWorkingDaysFromSchedule(
    settings.workingWeekStartDay,
    settings.workingDayCount,
    settings.restDayLayout ?? 'consecutive',
  )
}

export function resolveRestDays(
  settings: Pick<SchedulingSettings, 'workingDayCount' | 'workingWeekStartDay' | 'workingDays' | 'restDayLayout'>,
): WeekDayKey[] {
  const working = new Set(resolveWorkingDays(settings))
  return ALL_WEEK_DAYS.filter((day) => !working.has(day))
}

export function restDayCountFromSettings(
  settings: Pick<SchedulingSettings, 'workingDayCount' | 'workingDays'>,
): number {
  if (settings.workingDayCount === 'custom') {
    return Math.max(0, 7 - settings.workingDays.length)
  }
  return Math.max(0, 7 - settings.workingDayCount)
}

export function paidWorkingDaysFromSettings(
  settings: Pick<SchedulingSettings, 'workingDayCount' | 'workingDays'>,
): number {
  if (settings.workingDayCount === 'custom') {
    return Math.max(1, settings.workingDays.length)
  }
  return Math.max(1, settings.workingDayCount)
}

export function syncWorkingDaysFromSchedule(settings: SchedulingSettings): SchedulingSettings {
  if (settings.workingDayCount === 'custom') return settings
  const workingDays = buildWorkingDaysFromSchedule(
    settings.workingWeekStartDay,
    settings.workingDayCount,
    settings.restDayLayout ?? 'consecutive',
  )
  return { ...settings, workingDays }
}

type LegacySettings = SchedulingSettings & {
  workingDaysPreset?: '5-day' | '6-day' | 'custom'
}

export function migrateSchedulingSettings(settings: SchedulingSettings): SchedulingSettings {
  const legacy = settings as LegacySettings
  const withRestLayout: SchedulingSettings = {
    ...settings,
    restDayLayout: settings.restDayLayout ?? 'scattered',
    fteDailyDivisorHours: settings.fteDailyDivisorHours ?? 7.5,
    fteRequiredDailyDivisorHours: settings.fteRequiredDailyDivisorHours ?? 8,
    fteWeeklyDivisorHours:
      settings.fteWeeklyDivisorHours === 37.5 ? 45 : (settings.fteWeeklyDivisorHours ?? 45),
    minMinutesBeforeLunch: Math.max(
      settings.minMinutesBeforeLunch ?? Math.max(settings.minMinutesBeforeFirstBreak ?? 120, 60),
      60,
    ),
    breakSlackMinutes: settings.breakSlackMinutes ?? 30,
    lunchSlackMinutes: settings.lunchSlackMinutes ?? 30,
  }

  let migrated: SchedulingSettings
  if (legacy.workingDayCount != null && legacy.workingWeekStartDay != null) {
    migrated = syncWorkingDaysFromSchedule(withRestLayout)
  } else {
    const preset = legacy.workingDaysPreset ?? '5-day'
    if (preset === 'custom') {
      migrated = {
        ...withRestLayout,
        workingDayCount: 'custom',
        workingWeekStartDay: settings.workingDays[0] ?? 'mon',
        workingDays: settings.workingDays?.length ? settings.workingDays : buildConsecutiveWorkingDays('mon', 5),
      }
    } else {
      const count = preset === '6-day' ? 6 : 5
      const startDay =
        settings.workingDays?.length && settings.workingDays[0] ? settings.workingDays[0] : ('mon' as WeekDayKey)
      migrated = syncWorkingDaysFromSchedule({
        ...withRestLayout,
        workingDayCount: count,
        workingWeekStartDay: startDay,
      })
    }
  }

  // Keep calendar week start in sync with First working day (Sunday / Monday).
  let next = migrated
  if (migrated.workingWeekStartDay === 'sun') {
    next = { ...migrated, weekStartDay: 'sunday' }
  } else if (migrated.workingWeekStartDay === 'mon') {
    next = { ...migrated, weekStartDay: 'monday' }
  }

  const constraints = next.constraints ?? ({} as SchedulingSettings['constraints'])
  return {
    ...next,
    constraints: {
      followUploadedPattern: constraints.followUploadedPattern ?? true,
      minimizeOverUnder: constraints.minimizeOverUnder ?? true,
      evenlyDistributeLunches: constraints.evenlyDistributeLunches ?? true,
      evenlyDistributeBreaks: constraints.evenlyDistributeBreaks ?? true,
      preventBreakLunchOverlapShortages: constraints.preventBreakLunchOverlapShortages ?? true,
      enforceMinLunchBreakGap: constraints.enforceMinLunchBreakGap ?? true,
      followBreakLunchPattern: constraints.followBreakLunchPattern ?? true,
      breakLunchPattern: constraints.breakLunchPattern ?? 'break_lunch_break',
      useTeamBlockSchedules: constraints.useTeamBlockSchedules ?? true,
    },
  }
}

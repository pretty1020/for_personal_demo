import type { AgentRestDayMap } from './agentRestPattern'
import { isAgentScheduledOnDay } from './agentRestPattern'
import type {
  AgentScheduleDetail,
  BreakLunchColumnKey,
  DayAgentSchedules,
  WeeklyAgentScheduleGrid,
  WeeklyAgentScheduleRow,
} from './types'
import { WEEK_DAY_SHORT } from './workingDaysUtils'
import type { SchedulingSettings } from './schedulingSettingsTypes'
import { weekDayFromDate } from './schedulingSettingsTypes'
import { intervalToMinutes, minutesToInterval } from './intervalSlots'
import { defaultAgentName, isGenericAgentName } from './scheduleRosterAgents'

export type { WeeklyAgentScheduleGrid, WeeklyAgentScheduleRow } from './types'

/** Column order/labels for the agent grid based on checked break/lunch pattern. */
export function resolveBreakLunchColumns(
  settings?: SchedulingSettings | null,
): Array<{ key: BreakLunchColumnKey; label: string }> {
  if (!settings?.constraints?.followBreakLunchPattern) {
    return [
      { key: 'lunch', label: 'Lunch' },
      { key: 'break1', label: 'Break 1' },
      { key: 'break2', label: 'Break 2' },
    ]
  }
  const pattern = settings.constraints.breakLunchPattern
  if (pattern === 'break_break_lunch') {
    return [
      { key: 'break1', label: 'Break 1' },
      { key: 'break2', label: 'Break 2' },
      { key: 'lunch', label: 'Lunch' },
    ]
  }
  if (pattern === 'lunch_break_break') {
    return [
      { key: 'lunch', label: 'Lunch' },
      { key: 'break1', label: 'Break 1' },
      { key: 'break2', label: 'Break 2' },
    ]
  }
  // break_lunch_break (BLB) and any unknown/corrupt value
  return [
    { key: 'break1', label: 'Break 1' },
    { key: 'lunch', label: 'Lunch' },
    { key: 'break2', label: 'Break 2' },
  ]
}

export function breakColumnValues(
  row: WeeklyAgentScheduleRow,
  columns: Array<{ key: BreakLunchColumnKey; label: string }>,
): string[] {
  return columns.map((column) => row[column.key])
}

export function formatOffsetFromShiftStart(offsetMinutes: number): string {
  if (offsetMinutes <= 0) return '—'
  const snapped = Math.round(offsetMinutes / 15) * 15
  const hours = Math.floor(snapped / 60)
  const minutes = snapped % 60
  if (![0, 15, 30, 45].includes(minutes)) return '—'
  return `${hours}:${String(minutes).padStart(2, '0')}`
}

/** True when an absolute clock time falls inside the agent's shift window (supports overnight). */
function isTimeWithinShift(timeMinutes: number, shiftStart: number, shiftEnd: number): boolean {
  let end = shiftEnd
  if (end <= shiftStart) end += 24 * 60
  let time = timeMinutes
  if (time < shiftStart) time += 24 * 60
  return time >= shiftStart && time < end
}

/** Map a clock time onto the agent's shift timeline (handles overnight wraps). */
function minutesOnShiftTimeline(timeMinutes: number, shiftStart: number): number {
  const day = 24 * 60
  let time = ((timeMinutes % day) + day) % day
  if (time < shiftStart) time += day
  return time
}

/**
 * Lunch / Break1 / Break2 as clock times that fall inside the agent's shift.
 * Times outside the shift are omitted (shown as —).
 */
function breakClockTimes(agent: AgentScheduleDetail): { lunch: string; break1: string; break2: string } {
  const shiftStart = intervalToMinutes(agent.shiftStart)
  const shiftEnd = intervalToMinutes(agent.shiftEnd)

  const withinOrDash = (value: string): string => {
    if (!value || value === '—') return '—'
    const minutes = intervalToMinutes(value)
    if (!isTimeWithinShift(minutes, shiftStart, shiftEnd)) return '—'
    return minutesToInterval(minutes)
  }

  const lunch = withinOrDash(agent.lunchStart)
  const raw1 = withinOrDash(agent.break1Start)
  const raw2 = withinOrDash(agent.break2Start)
  // Order Break1/Break2 along the shift timeline (not raw HH:MM, which fails overnight).
  if (
    raw1 !== '—' &&
    raw2 !== '—' &&
    minutesOnShiftTimeline(intervalToMinutes(raw1), shiftStart) >
      minutesOnShiftTimeline(intervalToMinutes(raw2), shiftStart)
  ) {
    return { lunch, break1: raw2, break2: raw1 }
  }
  return { lunch, break1: raw1, break2: raw2 }
}

function scoreBreakCompleteness(agent: AgentScheduleDetail): number {
  const times = breakClockTimes(agent)
  const shiftStart = intervalToMinutes(agent.shiftStart)
  let score = 0
  if (times.lunch !== '—') score += 1
  if (times.break1 !== '—') score += 2
  if (times.break2 !== '—') score += 2
  if (times.break1 !== '—' && times.break2 !== '—' && times.lunch !== '—') {
    const lunch = minutesOnShiftTimeline(intervalToMinutes(times.lunch), shiftStart)
    const b1 = minutesOnShiftTimeline(intervalToMinutes(times.break1), shiftStart)
    const b2 = minutesOnShiftTimeline(intervalToMinutes(times.break2), shiftStart)
    const gap1 = Math.abs(lunch - b1)
    const gap2 = Math.abs(b2 - lunch)
    if (gap1 >= 60) score += 2
    else score -= 8
    if (gap2 >= 60) score += 2
    else score -= 8
    if (b1 === b2) score -= 20
    // Prefer Break → Lunch → Break chronology when both breaks exist
    if (b1 < lunch && lunch < b2) score += 6
    else if (b1 < b2 && b2 <= lunch) score += 1
    else if (lunch <= b1 && b1 < b2) score += 1
    else score -= 5
  }
  if (times.lunch !== '—' && (times.lunch === times.break1 || times.lunch === times.break2)) score -= 15
  return score
}

/** Weekly agent grid — OFF per agent from individual rest pattern + daily assignment. */
export function buildWeeklyAgentScheduleGrid(
  weekDates: string[],
  agentSchedules: DayAgentSchedules[],
  productionHc: number,
  agentRestMap?: AgentRestDayMap,
  openDays?: string[],
  agentNames?: Record<string, string>,
  settings?: SchedulingSettings | null,
  agents?: Array<{ index: number; supervisor?: string }>,
): WeeklyAgentScheduleGrid {
  const scheduleByDay = new Map(agentSchedules.map((day) => [day.day, day]))
  const openDaySet = new Set(openDays?.length ? openDays : weekDates)
  const dayHeaders = weekDates.map((day) => WEEK_DAY_SHORT[weekDayFromDate(day)])
  const breakColumns = resolveBreakLunchColumns(settings)
  const supervisorByIndex = new Map((agents ?? []).map((agent) => [agent.index, agent.supervisor ?? '']))
  const rows: WeeklyAgentScheduleRow[] = []

  for (let index = 0; index < productionHc; index += 1) {
    const row: WeeklyAgentScheduleRow = {
      agentIndex: index,
      agentLabel: (() => {
        const custom = agentNames?.[String(index)]?.trim()
        return custom && !isGenericAgentName(custom) ? custom : defaultAgentName(index)
      })(),
      supervisor: supervisorByIndex.get(index) || undefined,
      days: {},
      lunch: '—',
      break1: '—',
      break2: '—',
    }

    let bestTimes: ReturnType<typeof breakClockTimes> | null = null
    let bestScore = -1

    for (const dayIso of weekDates) {
      if (!openDaySet.has(dayIso)) {
        row.days[dayIso] = 'OFF'
        continue
      }

      // Rest days stay OFF — never display VL on an agent's rest day.
      if (agentRestMap && !isAgentScheduledOnDay(agentRestMap, index, dayIso)) {
        row.days[dayIso] = 'OFF'
        continue
      }

      const daySchedule = scheduleByDay.get(dayIso)
      const agent = daySchedule?.agents.find((item) => item.agentIndex === index)
      if (agent?.shiftStart === 'VL' || agent?.templateLabel === 'VL') {
        row.days[dayIso] = 'VL'
        continue
      }
      if (agent?.shiftStart && agent.shiftStart !== '—') {
        row.days[dayIso] = `${agent.shiftStart}-${agent.shiftEnd}`
        const times = breakClockTimes(agent)
        const score = scoreBreakCompleteness(agent)
        if (score > bestScore) {
          bestScore = score
          bestTimes = times
        }
      } else {
        row.days[dayIso] = 'OFF'
      }
    }

    if (bestTimes) {
      row.lunch = bestTimes.lunch
      row.break1 = bestTimes.break1
      row.break2 = bestTimes.break2
    }

    rows.push(row)
  }

  return { weekDates, dayHeaders, breakColumns, rows }
}

export function countAgentRestDays(row: WeeklyAgentScheduleRow, weekDates: string[]): number {
  return weekDates.filter((day) => (row.days[day] ?? 'OFF') === 'OFF').length
}

export function countOnShiftAgentsPerInterval(
  weekDates: string[],
  agentSchedules: DayAgentSchedules[],
): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {}
  const scheduleByDay = new Map(agentSchedules.map((day) => [day.day, day]))

  for (const dayIso of weekDates) {
    counts[dayIso] = {}
    const daySchedule = scheduleByDay.get(dayIso)
    if (!daySchedule) continue

    for (const agent of daySchedule.agents) {
      for (const [interval, status] of Object.entries(agent.intervals)) {
        if (status === 'off' || status === 'vl') continue
        counts[dayIso]![interval] = (counts[dayIso]![interval] ?? 0) + 1
      }
    }
  }

  return counts
}

export function countProductiveAgentsPerInterval(
  weekDates: string[],
  agentSchedules: DayAgentSchedules[],
): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {}
  const scheduleByDay = new Map(agentSchedules.map((day) => [day.day, day]))

  for (const dayIso of weekDates) {
    counts[dayIso] = {}
    const daySchedule = scheduleByDay.get(dayIso)
    if (!daySchedule) continue

    for (const agent of daySchedule.agents) {
      for (const [interval, status] of Object.entries(agent.intervals)) {
        if (status !== 'productive') continue
        counts[dayIso]![interval] = (counts[dayIso]![interval] ?? 0) + 1
      }
    }
  }

  return counts
}

export function weeklyAgentGridHeaderRow(grid: WeeklyAgentScheduleGrid): string[] {
  const breakHeaders = (grid.breakColumns ?? resolveBreakLunchColumns(null)).map((column) => column.label)
  return ['Agent', 'Supervisor', ...grid.dayHeaders, '', ...breakHeaders]
}

export function weeklyAgentGridDataRow(grid: WeeklyAgentScheduleGrid, row: WeeklyAgentScheduleRow): string[] {
  const columns = grid.breakColumns ?? resolveBreakLunchColumns(null)
  return [
    row.agentLabel,
    row.supervisor ?? '',
    ...grid.weekDates.map((day) => row.days[day] ?? 'OFF'),
    '',
    ...breakColumnValues(row, columns),
  ]
}

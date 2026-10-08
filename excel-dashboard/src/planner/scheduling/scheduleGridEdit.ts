import type { SchedulingSettings } from './schedulingSettingsTypes'
import type { ShiftTemplate, WeeklyAgentScheduleRow } from './types'
import { intervalToMinutes, minutesToInterval } from './intervalSlots'
import { buildCompleteBreakPlan } from './breakScheduleCandidates'
import type { AgentShiftAssignment } from './scheduleGeneration'

export type ParsedDayCell =
  | { kind: 'off' }
  | { kind: 'vl' }
  | { kind: 'shift'; startMinutes: number; endMinutes: number }

const SHIFT_RANGE_RE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/

function clampMinutes(hours: number, minutes: number): number | null {
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

/** Validate OFF / VL / HH:MM-HH:MM (24h). */
export function parseScheduleDayCell(raw: string): { ok: true; value: ParsedDayCell } | { ok: false; error: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, error: 'Empty cell — use OFF, VL, or HH:MM-HH:MM' }
  const upper = trimmed.toUpperCase()
  if (upper === 'OFF') return { ok: true, value: { kind: 'off' } }
  if (upper === 'VL') return { ok: true, value: { kind: 'vl' } }

  const match = SHIFT_RANGE_RE.exec(trimmed)
  if (!match) {
    return { ok: false, error: `Invalid format "${trimmed}" — use OFF, VL, or HH:MM-HH:MM` }
  }
  const startMinutes = clampMinutes(Number(match[1]), Number(match[2]))
  const endMinutes = clampMinutes(Number(match[3]), Number(match[4]))
  if (startMinutes == null || endMinutes == null) {
    return { ok: false, error: `Invalid time in "${trimmed}"` }
  }
  if (startMinutes === endMinutes) {
    return { ok: false, error: `Shift start and end are the same in "${trimmed}"` }
  }
  return { ok: true, value: { kind: 'shift', startMinutes, endMinutes } }
}

export function makeVlAssignment(agentIndex: number): AgentShiftAssignment {
  return {
    kind: 'vl',
    agentIndex,
    templateId: 'vl',
    startMinutes: 0,
    lunchStart: 0,
    lunchEnd: 0,
    breaks: [],
  }
}

function pickTemplateForDuration(
  templates: ShiftTemplate[],
  startMinutes: number,
  durationMinutes: number,
): ShiftTemplate {
  const byDuration =
    templates.find((item) => item.durationMinutes === durationMinutes && item.startMinutes === startMinutes) ??
    templates.find((item) => item.durationMinutes === durationMinutes) ??
    templates.find((item) => item.startMinutes === startMinutes) ??
    templates.find((item) => item.durationMinutes === 8 * 60) ??
    templates[0]
  if (byDuration) return byDuration
  return {
    id: `shift-${startMinutes}-${durationMinutes}`,
    label: `${minutesToInterval(startMinutes)} · ${durationMinutes / 60}h`,
    startMinutes,
    durationMinutes,
    lunchMinutes: 30,
    breakMinutes: 30,
  }
}

export function assignmentFromShiftRange(
  agentIndex: number,
  startMinutes: number,
  endMinutes: number,
  templates: ShiftTemplate[],
  settings: SchedulingSettings,
): AgentShiftAssignment {
  let durationMinutes = endMinutes - startMinutes
  if (durationMinutes <= 0) durationMinutes += 24 * 60
  const template = pickTemplateForDuration(templates, startMinutes, durationMinutes)
  const plan = buildCompleteBreakPlan(settings, startMinutes, agentIndex)
  return {
    kind: 'shift',
    agentIndex,
    templateId: template.id,
    startMinutes,
    lunchStart: plan.lunchStart,
    lunchEnd: plan.lunchEnd,
    breaks: plan.breaks.map(([from, to]) => [from, to] as [number, number]),
  }
}

/**
 * Parse edited weekly grid cells into assignmentsByDay.
 * OFF → no assignment; VL → kind vl; HH:MM-HH:MM → shift with rebuilt lunch/breaks.
 */
export function rebuildAssignmentsFromWeeklyGrid(
  rows: WeeklyAgentScheduleRow[],
  weekDates: string[],
  templates: ShiftTemplate[],
  settings: SchedulingSettings,
): { assignmentsByDay: Record<string, AgentShiftAssignment[]>; errors: string[] } {
  const errors: string[] = []
  const assignmentsByDay: Record<string, AgentShiftAssignment[]> = {}
  for (const day of weekDates) assignmentsByDay[day] = []

  for (const row of rows) {
    for (const day of weekDates) {
      const cell = row.days[day] ?? 'OFF'
      const parsed = parseScheduleDayCell(cell)
      if (!parsed.ok) {
        errors.push(`Agent ${row.agentIndex + 1} · ${day}: ${parsed.error}`)
        continue
      }
      if (parsed.value.kind === 'off') continue
      if (parsed.value.kind === 'vl') {
        assignmentsByDay[day]!.push(makeVlAssignment(row.agentIndex))
        continue
      }
      assignmentsByDay[day]!.push(
        assignmentFromShiftRange(
          row.agentIndex,
          parsed.value.startMinutes,
          parsed.value.endMinutes,
          templates,
          settings,
        ),
      )
    }
  }

  for (const day of weekDates) {
    assignmentsByDay[day] = (assignmentsByDay[day] ?? []).sort((a, b) => a.agentIndex - b.agentIndex)
  }

  return { assignmentsByDay, errors }
}

export function formatShiftCell(startMinutes: number, endMinutes: number): string {
  return `${minutesToInterval(startMinutes)}-${minutesToInterval(endMinutes)}`
}

/** Reconstruct assignments from agent schedule detail when package lacks assignmentsByDay. */
export function assignmentsFromAgentSchedules(
  agentSchedules: Array<{
    day: string
    agents: Array<{
      agentIndex: number
      templateLabel: string
      shiftStart: string
      shiftEnd: string
      lunchStart: string
      lunchEnd: string
      break1Start: string
      break1End: string
      break2Start: string
      break2End: string
      intervals: Record<string, string>
    }>
  }>,
  templates: ShiftTemplate[],
): Record<string, AgentShiftAssignment[]> {
  const result: Record<string, AgentShiftAssignment[]> = {}
  for (const day of agentSchedules) {
    result[day.day] = day.agents.map((agent) => {
      const isVl =
        agent.templateLabel === 'VL' ||
        agent.shiftStart === 'VL' ||
        Object.values(agent.intervals).some((status) => status === 'vl')
      if (isVl) return makeVlAssignment(agent.agentIndex)

      const startMinutes = intervalToMinutes(agent.shiftStart)
      const endMinutes = intervalToMinutes(agent.shiftEnd)
      let durationMinutes = endMinutes - startMinutes
      if (durationMinutes <= 0) durationMinutes += 24 * 60
      const template =
        templates.find((item) => item.startMinutes === startMinutes && item.durationMinutes === durationMinutes) ??
        templates.find((item) => item.startMinutes === startMinutes) ??
        templates[0]
      const lunchStart = agent.lunchStart !== '—' ? intervalToMinutes(agent.lunchStart) : startMinutes
      const lunchEnd = agent.lunchEnd !== '—' ? intervalToMinutes(agent.lunchEnd) : lunchStart
      const breaks: Array<[number, number]> = []
      if (agent.break1Start !== '—' && agent.break1End !== '—') {
        breaks.push([intervalToMinutes(agent.break1Start), intervalToMinutes(agent.break1End)])
      }
      if (agent.break2Start !== '—' && agent.break2End !== '—') {
        breaks.push([intervalToMinutes(agent.break2Start), intervalToMinutes(agent.break2End)])
      }
      return {
        kind: 'shift' as const,
        agentIndex: agent.agentIndex,
        templateId: template?.id ?? `shift-${startMinutes}`,
        startMinutes,
        lunchStart,
        lunchEnd,
        breaks,
      }
    })
  }
  return result
}

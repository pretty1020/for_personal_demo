import type { AgentIntervalStatus, AgentScheduleDetail, ShiftTemplate } from './types'
import type { SchedulingSettings } from './schedulingSettingsTypes'
import { allIntervalTimes, intervalToMinutes, minutesToInterval, INTERVAL_MINUTES } from './intervalSlots'
import { buildCompleteBreakPlan, enumerateBreakSchedules } from './breakScheduleCandidates'

function intervalMidpointMinutes(interval: string): number {
  return intervalToMinutes(interval) + INTERVAL_MINUTES / 2
}

export const DEFAULT_SHIFT_TEMPLATES: ShiftTemplate[] = [
  { id: 'early-8', label: 'Early 8h (07:00)', startMinutes: 7 * 60, durationMinutes: 8 * 60, lunchMinutes: 30, breakMinutes: 30 },
  { id: 'mid-8', label: 'Mid 8h (08:00)', startMinutes: 8 * 60, durationMinutes: 8 * 60, lunchMinutes: 30, breakMinutes: 30 },
  { id: 'standard-8', label: 'Standard 8h (09:00)', startMinutes: 9 * 60, durationMinutes: 8 * 60, lunchMinutes: 30, breakMinutes: 30 },
  { id: 'late-8', label: 'Late 8h (10:00)', startMinutes: 10 * 60, durationMinutes: 8 * 60, lunchMinutes: 30, breakMinutes: 30 },
  { id: 'evening-8', label: 'Evening 8h (13:00)', startMinutes: 13 * 60, durationMinutes: 8 * 60, lunchMinutes: 30, breakMinutes: 30 },
]

export type AgentShiftAssignment = {
  agentIndex: number
  templateId: string
  startMinutes: number
  lunchStart: number
  lunchEnd: number
  breaks: Array<[number, number]>
  /** Default 'shift'. VL agents are excluded from coverage / Interval Comparison. */
  kind?: 'shift' | 'vl'
}

export const VL_TEMPLATE: ShiftTemplate = {
  id: 'vl',
  label: 'VL',
  startMinutes: 0,
  durationMinutes: 0,
  lunchMinutes: 0,
  breakMinutes: 0,
}

export function isVlAssignment(assignment: AgentShiftAssignment): boolean {
  return assignment.kind === 'vl' || assignment.templateId === 'vl'
}

export type DayIntervalCoverage = Record<string, number>

function buildNonProductiveWindowsForAssignment(assignment: AgentShiftAssignment): Array<[number, number]> {
  const windows: Array<[number, number]> = [[assignment.lunchStart, assignment.lunchEnd]]
  for (const brk of assignment.breaks) windows.push(brk)
  return windows.filter(([from, to]) => to > from)
}

function isProductiveMinuteForAssignment(minute: number, assignment: AgentShiftAssignment, template: ShiftTemplate): boolean {
  const shiftEnd = assignment.startMinutes + template.durationMinutes
  if (minute < assignment.startMinutes || minute >= shiftEnd) return false
  for (const [from, to] of buildNonProductiveWindowsForAssignment(assignment)) {
    if (minute >= from && minute < to) return false
  }
  return true
}

export function buildNonProductiveWindows(template: ShiftTemplate, startMinutes: number): Array<[number, number]> {
  const shiftEnd = startMinutes + template.durationMinutes
  const lunchStart = startMinutes + Math.floor(template.durationMinutes * 0.45)
  const lunchEnd = lunchStart + template.lunchMinutes
  const break1Start = startMinutes + Math.floor(template.durationMinutes * 0.2)
  const break1End = break1Start + Math.floor(template.breakMinutes / 2)
  const break2Start = startMinutes + Math.floor(template.durationMinutes * 0.7)
  const break2End = break2Start + Math.ceil(template.breakMinutes / 2)
  const windows: Array<[number, number]> = [
    [lunchStart, lunchEnd],
    [break1Start, break1End],
    [break2Start, break2End],
  ]
  return windows.filter(([from, to]) => to > from && from < shiftEnd)
}

function isProductiveMinute(minute: number, startMinutes: number, template: ShiftTemplate): boolean {
  const shiftEnd = startMinutes + template.durationMinutes
  if (minute < startMinutes || minute >= shiftEnd) return false
  for (const [from, to] of buildNonProductiveWindows(template, startMinutes)) {
    if (minute >= from && minute < to) return false
  }
  return true
}

export function buildIntervalCoverageForAssignment(
  assignment: AgentShiftAssignment,
  template: ShiftTemplate,
): DayIntervalCoverage {
  const coverage: DayIntervalCoverage = {}
  for (const interval of allIntervalTimes()) {
    const midpoint = intervalMidpointMinutes(interval)
    coverage[interval] = isProductiveMinuteForAssignment(midpoint, assignment, template) ? 1 : 0
  }
  return coverage
}

/** Agents on shift at interval midpoint (includes lunch/break; excludes off-shift). */
export function buildGrossShiftCoverageForAssignment(
  assignment: AgentShiftAssignment,
  template: ShiftTemplate,
): DayIntervalCoverage {
  const coverage: DayIntervalCoverage = {}
  const shiftEnd = assignment.startMinutes + template.durationMinutes
  for (const interval of allIntervalTimes()) {
    const midpoint = intervalMidpointMinutes(interval)
    coverage[interval] =
      midpoint >= assignment.startMinutes && midpoint < shiftEnd ? 1 : 0
  }
  return coverage
}

export function buildIntervalCoverageForShift(
  template: ShiftTemplate,
  startMinutes: number,
): DayIntervalCoverage {
  const coverage: DayIntervalCoverage = {}
  for (const interval of allIntervalTimes()) {
    const midpoint = intervalMidpointMinutes(interval)
    coverage[interval] = isProductiveMinute(midpoint, startMinutes, template) ? 1 : 0
  }
  return coverage
}

export function assignShiftsToAgents(
  agentCount: number,
  templates: ShiftTemplate[],
  settings: SchedulingSettings,
): AgentShiftAssignment[] {
  if (agentCount <= 0 || !templates.length) return []
  return assignShiftsToAgentIndices(
    Array.from({ length: agentCount }, (_, index) => index),
    templates,
    settings,
  )
}

/** Assign shifts to specific global agent indices (full production HC roster). */
export function assignShiftsToAgentIndices(
  agentIndices: number[],
  templates: ShiftTemplate[],
  settings: SchedulingSettings,
): AgentShiftAssignment[] {
  if (!agentIndices.length || !templates.length) return []
  const assignments: AgentShiftAssignment[] = []
  const poolSize = Math.max(agentIndices.length, 1)
  for (let position = 0; position < agentIndices.length; position += 1) {
    const agentIndex = agentIndices[position]!
    const template = templates[agentIndex % templates.length]
    const startMinutes = template.startMinutes
    const breakPlans = enumerateBreakSchedules(settings, startMinutes, agentIndex, poolSize)
    const breakSchedule = breakPlans[0] ?? buildCompleteBreakPlan(settings, startMinutes, agentIndex)
    assignments.push({
      agentIndex,
      templateId: template.id,
      startMinutes,
      lunchStart: breakSchedule.lunchStart,
      lunchEnd: breakSchedule.lunchEnd,
      breaks: breakSchedule.breaks,
    })
  }
  return assignments
}

export function aggregateGrossShiftCoverage(
  assignments: AgentShiftAssignment[],
  templates: ShiftTemplate[],
): DayIntervalCoverage {
  const totals: DayIntervalCoverage = {}
  for (const interval of allIntervalTimes()) totals[interval] = 0

  for (const assignment of assignments) {
    if (isVlAssignment(assignment)) continue
    const template =
      templates.find((item) => item.id === assignment.templateId) ??
      templates.find((item) => item.startMinutes === assignment.startMinutes)
    if (!template) continue
    const coverage = buildGrossShiftCoverageForAssignment(assignment, template)
    for (const interval of allIntervalTimes()) {
      totals[interval] = (totals[interval] ?? 0) + (coverage[interval] ?? 0)
    }
  }
  return totals
}

export function aggregateDayCoverage(
  assignments: AgentShiftAssignment[],
  templates: ShiftTemplate[],
): DayIntervalCoverage {
  const totals: DayIntervalCoverage = {}
  for (const interval of allIntervalTimes()) totals[interval] = 0

  for (const assignment of assignments) {
    if (isVlAssignment(assignment)) continue
    const template =
      templates.find((item) => item.id === assignment.templateId) ??
      templates.find((item) => item.startMinutes === assignment.startMinutes)
    if (!template) continue
    const coverage = buildIntervalCoverageForAssignment(assignment, template)
    for (const interval of allIntervalTimes()) {
      totals[interval] = (totals[interval] ?? 0) + (coverage[interval] ?? 0)
    }
  }
  return totals
}

export function cloneAssignments(assignments: AgentShiftAssignment[]): AgentShiftAssignment[] {
  return assignments.map((assignment) => ({ ...assignment }))
}

export function adjustAssignmentStart(
  assignment: AgentShiftAssignment,
  deltaMinutes: number,
  templates: ShiftTemplate[],
  settings: SchedulingSettings,
  maxAdjustMinutes: number,
  _agentCount: number,
): AgentShiftAssignment {
  const template = templates.find((item) => item.id === assignment.templateId)
  if (!template) return assignment
  const bounded = Math.max(-maxAdjustMinutes, Math.min(maxAdjustMinutes, deltaMinutes))
  const nextStart = Math.max(0, Math.min(24 * 60 - template.durationMinutes, assignment.startMinutes + bounded))
  const breakSchedule = buildCompleteBreakPlan(settings, nextStart, assignment.agentIndex)
  return {
    ...assignment,
    startMinutes: nextStart,
    lunchStart: breakSchedule.lunchStart,
    lunchEnd: breakSchedule.lunchEnd,
    breaks: breakSchedule.breaks,
  }
}

export function formatShiftStart(startMinutes: number): string {
  return minutesToInterval(startMinutes)
}

export function intervalStatusForAssignment(
  interval: string,
  assignment: AgentShiftAssignment,
  template: ShiftTemplate,
): AgentIntervalStatus {
  if (isVlAssignment(assignment)) return 'vl'
  const midpoint = intervalMidpointMinutes(interval)
  const shiftEnd = assignment.startMinutes + template.durationMinutes
  if (midpoint < assignment.startMinutes || midpoint >= shiftEnd) return 'off'
  if (midpoint >= assignment.lunchStart && midpoint < assignment.lunchEnd) return 'lunch'
  for (const [from, to] of assignment.breaks) {
    if (midpoint >= from && midpoint < to) return 'break'
  }
  return 'productive'
}

export function buildAgentScheduleDetail(
  assignment: AgentShiftAssignment,
  template: ShiftTemplate,
  settings: SchedulingSettings,
): AgentScheduleDetail {
  if (isVlAssignment(assignment)) {
    const intervals: Record<string, AgentIntervalStatus> = {}
    for (const interval of allIntervalTimes()) intervals[interval] = 'vl'
    return {
      agentIndex: assignment.agentIndex,
      agentLabel: `Agent ${assignment.agentIndex + 1}`,
      templateLabel: 'VL',
      shiftStart: 'VL',
      shiftEnd: 'VL',
      lunchStart: '—',
      lunchEnd: '—',
      break1Start: '—',
      break1End: '—',
      break2Start: '—',
      break2End: '—',
      workingHours: 0,
      intervals,
    }
  }

  const sortedBreaks = [...assignment.breaks].sort((a, b) => a[0] - b[0])
  const hasBreak1 = Boolean(sortedBreaks[0])
  const hasBreak2 = Boolean(sortedBreaks[1])
  const [break1Start, break1End] = sortedBreaks[0] ?? [0, 0]
  const [break2Start, break2End] = sortedBreaks[1] ?? [0, 0]
  const shiftEnd = assignment.startMinutes + template.durationMinutes
  const withinShift = (start: number, end: number) =>
    start >= assignment.startMinutes && end <= shiftEnd && end > start

  const lunchOk = withinShift(assignment.lunchStart, assignment.lunchEnd)
  const break1Ok = hasBreak1 && withinShift(break1Start, break1End)
  const break2Ok = hasBreak2 && withinShift(break2Start, break2End)

  const intervals: Record<string, AgentIntervalStatus> = {}
  for (const interval of allIntervalTimes()) {
    intervals[interval] = intervalStatusForAssignment(interval, assignment, template)
  }
  const productiveIntervals = Object.values(intervals).filter((status) => status === 'productive').length
  const workingHours = (productiveIntervals * settings.scheduleIntervalMinutes) / 60
  return {
    agentIndex: assignment.agentIndex,
    agentLabel: `Agent ${assignment.agentIndex + 1}`,
    templateLabel: template.label,
    shiftStart: minutesToInterval(assignment.startMinutes),
    shiftEnd: minutesToInterval(shiftEnd),
    lunchStart: lunchOk ? minutesToInterval(assignment.lunchStart) : '—',
    lunchEnd: lunchOk ? minutesToInterval(assignment.lunchEnd) : '—',
    break1Start: break1Ok ? minutesToInterval(break1Start) : '—',
    break1End: break1Ok ? minutesToInterval(break1End) : '—',
    break2Start: break2Ok ? minutesToInterval(break2Start) : '—',
    break2End: break2Ok ? minutesToInterval(break2End) : '—',
    workingHours,
    intervals,
  }
}

export function buildAgentSchedulesForDay(
  assignments: AgentShiftAssignment[],
  templates: ShiftTemplate[],
  settings: SchedulingSettings,
): AgentScheduleDetail[] {
  return assignments
    .map((assignment) => {
      if (isVlAssignment(assignment)) {
        return buildAgentScheduleDetail(assignment, VL_TEMPLATE, settings)
      }
      const template =
        templates.find((item) => item.id === assignment.templateId) ??
        templates.find((item) => item.startMinutes === assignment.startMinutes) ??
        templates[0]
      if (!template) return null
      return buildAgentScheduleDetail(assignment, template, settings)
    })
    .filter((row): row is AgentScheduleDetail => row != null)
}

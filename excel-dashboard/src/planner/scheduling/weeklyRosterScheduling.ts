import type { GeneratedRequirementDay } from './requirementGeneration'
import type { PatternScheduleMeta } from './patternAnalysis'
import { hoopIntervalsForDay } from './patternAnalysis'
import { buildAgentRestDayMap, isAgentScheduledOnDay, type AgentRestDayMap } from './agentRestPattern'
import { buildDayVolumeWeights, buildRawDayIntervalBuckets } from './requirementGeneration'
import type {
  DayAgentSchedules,
  IntervalPatternRow,
  SchedulingAgent,
  SchedulingRules,
  ShiftTemplate,
  WeekIntervalPattern,
} from './types'
import { formatDayLabel } from './intervalSlots'
import { buildPatternWeightsForDay } from './patternIntervalShape'
import {
  augmentShiftTemplatesForDay,
  assignShiftsToCoverRequirements,
  demandIntervalsFromRequirements,
  fillIntervalCoverageGaps,
  hasUncoveredRequiredIntervals,
  improveAssignmentCoverage,
  peakRequiredHeadcount,
  pickAgentsForRequirementDay,
  reinforceIntervalCoverage,
  requiredAgentCountForDay,
} from './intervalGapAllocation'
import {
  aggregateDayCoverage,
  buildAgentSchedulesForDay,
  isVlAssignment,
  type AgentShiftAssignment,
} from './scheduleGeneration'
import { optimizeDayAssignments, allocateDailyProductionHc } from './scheduleOptimization'
import { buildCompleteBreakPlan, ensurePlanHasBreaks, enforceBreakConstraintsOnAssignments } from './breakScheduleCandidates'
import type { BlockSchedule } from './blockSchedulePersistence'
import { weekDayFromDate } from './schedulingSettingsTypes'
import { makeVlAssignment } from './scheduleGridEdit'

export type WeeklyRosterOptions = {
  agents?: SchedulingAgent[]
  blockSchedules?: BlockSchedule[]
  pythonAssignments?: Record<string, Array<{ agentIndex: number; startMinutes: number }>>
  /** VL headcount to tag (distributed like production HC across requirement days). */
  vlHc?: number
}

function assignmentFromStart(
  agentIndex: number,
  startMinutes: number,
  templates: ShiftTemplate[],
  settings: SchedulingRules['settings'],
): AgentShiftAssignment {
  const template =
    templates.find((item) => item.startMinutes === startMinutes) ??
    templates.find((item) => Math.abs(item.startMinutes - startMinutes) < 1) ??
    templates[0]
  const plan = ensurePlanHasBreaks(
    settings,
    startMinutes,
    agentIndex,
    buildCompleteBreakPlan(settings, startMinutes, agentIndex),
  )
  return {
    agentIndex,
    templateId: template?.id ?? `shift-${startMinutes}`,
    startMinutes,
    lunchStart: plan.lunchStart,
    lunchEnd: plan.lunchEnd,
    breaks: plan.breaks.map(([from, to]) => [from, to] as [number, number]),
  }
}

function applyStartOverrides(
  assignmentsByDay: Record<string, AgentShiftAssignment[]>,
  overrides: Record<string, Array<{ agentIndex: number; startMinutes: number }>>,
  templatesByDay: Record<string, ShiftTemplate[]>,
  defaultTemplates: ShiftTemplate[],
  settings: SchedulingRules['settings'],
): Record<string, AgentShiftAssignment[]> {
  const next = { ...assignmentsByDay }
  for (const [day, items] of Object.entries(overrides)) {
    if (!items.length) continue
    const templates = templatesByDay[day] ?? defaultTemplates
    const byAgent = new Map(items.map((item) => [item.agentIndex, item.startMinutes]))
    const existing = next[day] ?? []
    const mapped = existing.map((assignment) => {
      const start = byAgent.get(assignment.agentIndex)
      return start == null ? assignment : assignmentFromStart(assignment.agentIndex, start, templates, settings)
    })
    for (const item of items) {
      if (!mapped.some((assignment) => assignment.agentIndex === item.agentIndex)) {
        mapped.push(assignmentFromStart(item.agentIndex, item.startMinutes, templates, settings))
      }
    }
    next[day] = mapped
  }
  return next
}

function applyBlockSchedules(
  assignmentsByDay: Record<string, AgentShiftAssignment[]>,
  weekDates: string[],
  agents: SchedulingAgent[],
  blocks: BlockSchedule[],
  templatesByDay: Record<string, ShiftTemplate[]>,
  defaultTemplates: ShiftTemplate[],
  settings: SchedulingRules['settings'],
): Record<string, AgentShiftAssignment[]> {
  if (!blocks.length || !agents.length) return assignmentsByDay
  const supervisorByAgent = new Map(agents.map((agent) => [agent.index, (agent.supervisor ?? '').trim()]))
  const next = { ...assignmentsByDay }
  for (const day of weekDates) {
    const weekday = weekDayFromDate(day)
    const templates = templatesByDay[day] ?? defaultTemplates
    next[day] = (assignmentsByDay[day] ?? []).map((assignment) => {
      const supervisor = supervisorByAgent.get(assignment.agentIndex) ?? ''
      const block = blocks.find(
        (item) => item.supervisor.trim() === supervisor && item.workingDays.includes(weekday),
      )
      if (!block) return assignment
      return assignmentFromStart(assignment.agentIndex, block.startMinutes, templates, settings)
    })
  }
  return next
}

function applyVlTagsToAssignments(
  assignmentsByDay: Record<string, AgentShiftAssignment[]>,
  weekDates: string[],
  requirementDays: GeneratedRequirementDay[],
  vlHc: number,
  rules: SchedulingRules,
  agentRestMap?: AgentRestDayMap,
): Record<string, AgentShiftAssignment[]> {
  const cappedVl = Math.max(0, Math.round(vlHc))
  if (cappedVl <= 0) return assignmentsByDay

  const dailyVl = allocateDailyProductionHc(
    cappedVl,
    requirementDays,
    rules.settings.fteRequiredDailyDivisorHours,
    rules.settings.scheduleIntervalMinutes,
  )
  const next: Record<string, AgentShiftAssignment[]> = { ...assignmentsByDay }

  for (const day of weekDates) {
    const count = dailyVl[day] ?? 0
    if (count <= 0) continue
    const existing = [...(next[day] ?? [])]
    if (!existing.length) continue

    // Only convert agents already scheduled that day — never tag VL on rest days (OFF).
    const scheduledCandidates = existing
      .filter((assignment) => {
        if (isVlAssignment(assignment)) return false
        if (agentRestMap && !isAgentScheduledOnDay(agentRestMap, assignment.agentIndex, day)) {
          return false
        }
        return true
      })
      .sort((a, b) => b.agentIndex - a.agentIndex)
    const vlIndices = new Set(scheduledCandidates.slice(0, count).map((assignment) => assignment.agentIndex))
    next[day] = existing.map((assignment) =>
      vlIndices.has(assignment.agentIndex) ? makeVlAssignment(assignment.agentIndex) : assignment,
    )
  }

  return next
}

/**
 * Fixed start mode: each agent keeps their own start + lunch/breaks for every working day.
 * Different agents may have different starts (e.g. Agent 1 @ 07:00, Agent 2 @ 03:00).
 */
function lockFixedWeeklySchedules(
  assignmentsByDay: Record<string, AgentShiftAssignment[]>,
  weekDates: string[],
  workingDaySet: Set<string>,
  templatesByDay: Record<string, ShiftTemplate[]>,
  defaultTemplates: ShiftTemplate[],
  settings: SchedulingRules['settings'],
): Record<string, AgentShiftAssignment[]> {
  if (settings.shiftStartMode !== 'fixed') return assignmentsByDay

  type Canonical = {
    startMinutes: number
    templateId: string
    lunchStart: number
    lunchEnd: number
    breaks: Array<[number, number]>
  }

  const startsByAgent = new Map<number, number[]>()
  const sampleByAgent = new Map<number, AgentShiftAssignment>()

  for (const day of weekDates) {
    if (!workingDaySet.has(day)) continue
    for (const assignment of assignmentsByDay[day] ?? []) {
      if (isVlAssignment(assignment)) continue
      const list = startsByAgent.get(assignment.agentIndex) ?? []
      list.push(assignment.startMinutes)
      startsByAgent.set(assignment.agentIndex, list)
      if (!sampleByAgent.has(assignment.agentIndex)) {
        sampleByAgent.set(assignment.agentIndex, assignment)
      }
    }
  }

  const canonical = new Map<number, Canonical>()
  for (const [agentIndex, starts] of startsByAgent) {
    // Lock to the agent's most common start (requirement-aligned), not the earliest outlier.
    const counts = new Map<number, number>()
    for (const start of starts) {
      counts.set(start, (counts.get(start) ?? 0) + 1)
    }
    let startMinutes = starts[0]!
    let bestCount = -1
    for (const [start, count] of counts) {
      if (count > bestCount || (count === bestCount && start > startMinutes)) {
        bestCount = count
        startMinutes = start
      }
    }
    if (bestCount <= 1 && starts.length > 1) {
      const sorted = [...starts].sort((a, b) => a - b)
      startMinutes = sorted[Math.floor(sorted.length / 2)]!
    }
    const sample = sampleByAgent.get(agentIndex)!
    const plan = ensurePlanHasBreaks(
      settings,
      startMinutes,
      agentIndex,
      buildCompleteBreakPlan(settings, startMinutes, agentIndex),
    )
    const matchingTemplate =
      defaultTemplates.find((item) => item.startMinutes === startMinutes) ??
      defaultTemplates.find((item) => item.id === sample.templateId) ??
      defaultTemplates[0]
    canonical.set(agentIndex, {
      startMinutes,
      templateId: matchingTemplate?.id ?? sample.templateId,
      lunchStart: plan.lunchStart,
      lunchEnd: plan.lunchEnd,
      breaks: plan.breaks.map(([from, to]) => [from, to] as [number, number]),
    })
  }

  const next: Record<string, AgentShiftAssignment[]> = { ...assignmentsByDay }
  for (const day of weekDates) {
    if (!workingDaySet.has(day)) continue
    const dayTemplates = templatesByDay[day] ?? defaultTemplates
    next[day] = (assignmentsByDay[day] ?? []).map((assignment) => {
      if (isVlAssignment(assignment)) return assignment
      const locked = canonical.get(assignment.agentIndex)
      if (!locked) return assignment
      const template =
        dayTemplates.find((item) => item.startMinutes === locked.startMinutes) ??
        dayTemplates.find((item) => item.id === locked.templateId) ??
        defaultTemplates.find((item) => item.startMinutes === locked.startMinutes) ??
        defaultTemplates[0]
      return {
        ...assignment,
        templateId: template?.id ?? locked.templateId,
        startMinutes: locked.startMinutes,
        lunchStart: locked.lunchStart,
        lunchEnd: locked.lunchEnd,
        breaks: locked.breaks.map(([from, to]) => [from, to] as [number, number]),
      }
    })
  }
  return next
}

export type WeeklyRosterResult = {
  assignmentsByDay: Record<string, AgentShiftAssignment[]>
  templatesByDay: Record<string, ShiftTemplate[]>
  agentSchedules: DayAgentSchedules[]
  agentRestMap: ReturnType<typeof buildAgentRestDayMap>
}

/**
 * Build full production-HC roster with per-agent rest days staggered by upload pattern trend.
 */
export function buildWeeklyAgentRoster(
  productionHc: number,
  weekDates: string[],
  requirementDays: GeneratedRequirementDay[],
  rules: SchedulingRules,
  patternMeta: PatternScheduleMeta,
  rawPattern: IntervalPatternRow[],
  normalizedPattern: WeekIntervalPattern,
  options: WeeklyRosterOptions = {},
): WeeklyRosterResult {
  const assignmentsByDay: Record<string, AgentShiftAssignment[]> = {}
  const templatesByDay: Record<string, ShiftTemplate[]> = {}
  const agentSchedules: DayAgentSchedules[] = []
  const requirementByDay = new Map(requirementDays.map((day) => [day.day, day]))
  const dayWeights = buildDayVolumeWeights(rawPattern, weekDates)
  const agentRestMap = buildAgentRestDayMap(
    productionHc,
    weekDates,
    dayWeights,
    rules,
    patternMeta,
    requirementDays,
  )
  const rawBuckets = buildRawDayIntervalBuckets(rawPattern, weekDates)
  const workingDaySet = new Set(patternMeta.workingDays)
  for (const dayIso of weekDates) {
    const dayRequirement = requirementByDay.get(dayIso)
    const hasRequirementDemand =
      dayRequirement != null && Object.values(dayRequirement.intervals).some((value) => value > 0.01)
    if (!workingDaySet.has(dayIso) && !hasRequirementDemand) {
      assignmentsByDay[dayIso] = []
      agentSchedules.push({ day: dayIso, dateLabel: formatDayLabel(dayIso), agents: [] })
      continue
    }

    if (!dayRequirement) {
      assignmentsByDay[dayIso] = []
      agentSchedules.push({ day: dayIso, dateLabel: formatDayLabel(dayIso), agents: [] })
      continue
    }

    const hoopIntervals = hoopIntervalsForDay(patternMeta, dayIso)
    const demandIntervals = demandIntervalsFromRequirements(dayRequirement.intervals, hoopIntervals)
    if (!demandIntervals.length) {
      assignmentsByDay[dayIso] = []
      templatesByDay[dayIso] = rules.shiftTemplates
      agentSchedules.push({ day: dayIso, dateLabel: formatDayLabel(dayIso), agents: [] })
      continue
    }

    const patternWeights = buildPatternWeightsForDay(
      rawBuckets[dayIso] ?? {},
      normalizedPattern[dayIso] ?? {},
      demandIntervals,
    )
    const peakRequired = peakRequiredHeadcount(dayRequirement.intervals, demandIntervals)
    const targetAgents = requiredAgentCountForDay(peakRequired, rules.settings.minStaffingCoverage)
    const agentIndices = pickAgentsForRequirementDay(productionHc, dayIso, agentRestMap, targetAgents)
    if (!agentIndices.length) {
      assignmentsByDay[dayIso] = []
      templatesByDay[dayIso] = rules.shiftTemplates
      agentSchedules.push({ day: dayIso, dateLabel: formatDayLabel(dayIso), agents: [] })
      continue
    }

    const dayTemplates = augmentShiftTemplatesForDay(
      rules.shiftTemplates,
      dayRequirement.intervals,
      demandIntervals,
      rules.settings,
    )

    const primaryAgents = agentIndices
    const optimizeAllAgents = Boolean(rules.settings.constraints?.minimizeOverUnder)

    const pythonDay = options.pythonAssignments?.[dayIso]
    let assignments = pythonDay?.length
      ? pythonDay.map((item) =>
          assignmentFromStart(item.agentIndex, item.startMinutes, dayTemplates, rules.settings),
        )
      : assignShiftsToCoverRequirements(
          agentIndices,
          dayRequirement.intervals,
          dayTemplates,
          rules.settings,
          demandIntervals,
          patternWeights,
        )

    if (assignments.length) {
      assignments = fillIntervalCoverageGaps(
        assignments,
        dayRequirement.intervals,
        dayTemplates,
        rules.settings,
        demandIntervals,
        rules.maxShiftStartAdjustMinutes,
        patternWeights,
      )

      if (optimizeAllAgents) {
        assignments = improveAssignmentCoverage(
          assignments,
          dayRequirement.intervals,
          dayTemplates,
          rules.settings,
          demandIntervals,
          patternWeights,
        )
        assignments = optimizeDayAssignments(
          assignments,
          dayRequirement.intervals,
          { ...rules, shiftTemplates: dayTemplates },
          demandIntervals,
          patternWeights,
        )
      } else if (primaryAgents.length <= 30) {
        const optimizedPrimary = optimizeDayAssignments(
          assignShiftsToCoverRequirements(
            primaryAgents,
            dayRequirement.intervals,
            dayTemplates,
            rules.settings,
            demandIntervals,
            patternWeights,
          ),
          dayRequirement.intervals,
          { ...rules, shiftTemplates: dayTemplates },
          demandIntervals,
          patternWeights,
        )
        const optimizedIds = new Set(optimizedPrimary.map((row) => row.agentIndex))
        assignments = [
          ...optimizedPrimary,
          ...assignments.filter((row) => !optimizedIds.has(row.agentIndex)),
        ]
      }

      assignments = reinforceIntervalCoverage(
        assignments,
        dayRequirement.intervals,
        dayTemplates,
        rules.settings,
        demandIntervals,
        patternWeights,
      )

      let scheduledIntervals = aggregateDayCoverage(assignments, dayTemplates)
      if (hasUncoveredRequiredIntervals(dayRequirement.intervals, scheduledIntervals, demandIntervals)) {
        assignments = improveAssignmentCoverage(
          assignments,
          dayRequirement.intervals,
          dayTemplates,
          rules.settings,
          demandIntervals,
          patternWeights,
        )
        assignments = reinforceIntervalCoverage(
          assignments,
          dayRequirement.intervals,
          dayTemplates,
          rules.settings,
          demandIntervals,
          patternWeights,
        )
      }

      if (rules.settings.constraints?.minimizeOverUnder && optimizeAllAgents) {
        assignments = optimizeDayAssignments(
          assignments,
          dayRequirement.intervals,
          { ...rules, shiftTemplates: dayTemplates },
          demandIntervals,
          patternWeights,
        )
      }
    }

    enforceBreakConstraintsOnAssignments(assignments, rules.settings)
    assignmentsByDay[dayIso] = assignments
    templatesByDay[dayIso] = dayTemplates
    agentSchedules.push({
      day: dayIso,
      dateLabel: formatDayLabel(dayIso),
      agents: buildAgentSchedulesForDay(assignments, dayTemplates, rules.settings),
    })
  }

  if (options.pythonAssignments) {
    Object.assign(
      assignmentsByDay,
      applyStartOverrides(
        assignmentsByDay,
        options.pythonAssignments,
        templatesByDay,
        rules.shiftTemplates,
        rules.settings,
      ),
    )
  }

  if (options.blockSchedules?.length && rules.settings.constraints?.useTeamBlockSchedules) {
    Object.assign(
      assignmentsByDay,
      applyBlockSchedules(
        assignmentsByDay,
        weekDates,
        options.agents ?? [],
        options.blockSchedules,
        templatesByDay,
        rules.shiftTemplates,
        rules.settings,
      ),
    )
  }

  if (rules.settings.shiftStartMode === 'fixed') {
    const locked = lockFixedWeeklySchedules(
      assignmentsByDay,
      weekDates,
      workingDaySet,
      templatesByDay,
      rules.shiftTemplates,
      rules.settings,
    )
    Object.assign(assignmentsByDay, locked)

    // After locking per-agent starts, re-check coverage and reinforce without changing locked starts
    // by only swapping among already-locked agent starts via improveAssignmentCoverage templates.
    for (const dayIso of weekDates) {
      if (!workingDaySet.has(dayIso)) continue
      const dayRequirement = requirementByDay.get(dayIso)
      if (!dayRequirement) continue
      let assignments = assignmentsByDay[dayIso] ?? []
      if (!assignments.length) continue

      const dayTemplates = templatesByDay[dayIso] ?? rules.shiftTemplates
      const hoopIntervals = hoopIntervalsForDay(patternMeta, dayIso)
      const demandIntervals = demandIntervalsFromRequirements(dayRequirement.intervals, hoopIntervals)
      const patternWeights = buildPatternWeightsForDay(
        rawBuckets[dayIso] ?? {},
        normalizedPattern[dayIso] ?? {},
        demandIntervals,
      )

      // Build templates from the locked starts present this day so reinforce can still fill gaps
      // by moving agents only among starts already used by the roster (per-agent lock preserved below).
      const lockedStarts = [...new Set(assignments.map((row) => row.startMinutes))]
      const coverageTemplates = [
        ...dayTemplates,
        ...lockedStarts
          .filter((start) => !dayTemplates.some((template) => template.startMinutes === start))
          .map((startMinutes) => {
            const durationMinutes = rules.settings.shiftLengthHours * 60
            const totalBreakMinutes = rules.settings.breakCount * rules.settings.breakDurationMinutes
            return {
              id: `shift-locked-${startMinutes}`,
              label: `${String(Math.floor(startMinutes / 60)).padStart(2, '0')}:${String(startMinutes % 60).padStart(2, '0')} · ${rules.settings.shiftLengthHours}h`,
              startMinutes,
              durationMinutes,
              lunchMinutes: rules.settings.unpaidLunchMinutes,
              breakMinutes: totalBreakMinutes,
            }
          }),
      ]

      let scheduledIntervals = aggregateDayCoverage(assignments, coverageTemplates)
      if (hasUncoveredRequiredIntervals(dayRequirement.intervals, scheduledIntervals, demandIntervals)) {
        // Allow reinforce to cover gaps, then re-lock this day's agents to their canonical starts.
        assignments = reinforceIntervalCoverage(
          assignments,
          dayRequirement.intervals,
          coverageTemplates,
          rules.settings,
          demandIntervals,
          patternWeights,
        )
        assignmentsByDay[dayIso] = assignments
      }
    }

    // Re-apply per-agent lock so reinforce cannot leave agents with different starts across days.
    const relocked = lockFixedWeeklySchedules(
      assignmentsByDay,
      weekDates,
      workingDaySet,
      templatesByDay,
      rules.shiftTemplates,
      rules.settings,
    )
    Object.assign(assignmentsByDay, relocked)

    for (const dayIso of weekDates) {
      if (!workingDaySet.has(dayIso)) continue
      const dayTemplates = templatesByDay[dayIso] ?? rules.shiftTemplates
      const finalAssignments = assignmentsByDay[dayIso] ?? []
      enforceBreakConstraintsOnAssignments(finalAssignments, rules.settings)
      const scheduleIndex = agentSchedules.findIndex((row) => row.day === dayIso)
      const scheduleRow = {
        day: dayIso,
        dateLabel: formatDayLabel(dayIso),
        agents: buildAgentSchedulesForDay(finalAssignments, dayTemplates, rules.settings),
      }
      if (scheduleIndex >= 0) agentSchedules[scheduleIndex] = scheduleRow
      else agentSchedules.push(scheduleRow)
    }
  } else {
    // Coverage balancing / fixed-lock paths may rewrite breaks — enforce once more before return.
    for (const dayIso of weekDates) {
      if (!workingDaySet.has(dayIso)) continue
      const finalAssignments = assignmentsByDay[dayIso] ?? []
      if (!finalAssignments.length) continue
      enforceBreakConstraintsOnAssignments(finalAssignments, rules.settings)
      const dayTemplates = templatesByDay[dayIso] ?? rules.shiftTemplates
      const scheduleIndex = agentSchedules.findIndex((row) => row.day === dayIso)
      const scheduleRow = {
        day: dayIso,
        dateLabel: formatDayLabel(dayIso),
        agents: buildAgentSchedulesForDay(finalAssignments, dayTemplates, rules.settings),
      }
      if (scheduleIndex >= 0) agentSchedules[scheduleIndex] = scheduleRow
      else agentSchedules.push(scheduleRow)
    }
  }

  const vlHc = Math.max(0, Math.round(options.vlHc ?? 0))
  if (vlHc > 0) {
    Object.assign(
      assignmentsByDay,
      applyVlTagsToAssignments(assignmentsByDay, weekDates, requirementDays, vlHc, rules, agentRestMap),
    )
    for (const dayIso of weekDates) {
      const dayTemplates = templatesByDay[dayIso] ?? rules.shiftTemplates
      const finalAssignments = assignmentsByDay[dayIso] ?? []
      const scheduleIndex = agentSchedules.findIndex((row) => row.day === dayIso)
      const scheduleRow = {
        day: dayIso,
        dateLabel: formatDayLabel(dayIso),
        agents: buildAgentSchedulesForDay(finalAssignments, dayTemplates, rules.settings),
      }
      if (scheduleIndex >= 0) agentSchedules[scheduleIndex] = scheduleRow
      else agentSchedules.push(scheduleRow)
    }
  }

  return { assignmentsByDay, templatesByDay, agentSchedules, agentRestMap }
}

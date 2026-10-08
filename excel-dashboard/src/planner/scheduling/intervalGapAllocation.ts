import type { AgentRestDayMap } from './agentRestPattern'
import { pickAgentsForWorkingDay } from './agentRestPattern'
import { scoreIntervalCoverage } from './breakOptimization'
import { enforceBreakConstraintsOnAssignments, enumerateBreakSchedules } from './breakScheduleCandidates'
import { generateShiftStartOptions, snapMinutesToGrid } from './schedulingTimeUtils'
import type { SchedulingSettings } from './schedulingSettingsTypes'
import type { ShiftTemplate } from './types'
import { allIntervalTimes, INTERVAL_MINUTES, intervalToMinutes, minutesToInterval } from './intervalSlots'
import {
  aggregateDayCoverage,
  cloneAssignments,
  type AgentShiftAssignment,
} from './scheduleGeneration'
/** Intervals with required headcount > 0 — agents must not be staffed elsewhere. */
export function demandIntervalsFromRequirements(
  requiredIntervals: Record<string, number>,
  _fallbackIntervals: string[] = [],
): string[] {
  return allIntervalTimes().filter((interval) => (requiredIntervals[interval] ?? 0) > 0.01)
}

/** Zero scheduled headcount on intervals with no requirement (for totals and display). */
export function maskScheduledToDemandIntervals(
  requiredIntervals: Record<string, number>,
  scheduledIntervals: Record<string, number>,
): Record<string, number> {
  const masked: Record<string, number> = {}
  for (const interval of allIntervalTimes()) {
    masked[interval] = (requiredIntervals[interval] ?? 0) > 0.01 ? (scheduledIntervals[interval] ?? 0) : 0
  }
  return masked
}

export function peakRequiredHeadcount(
  requiredIntervals: Record<string, number>,
  demandIntervals: string[],
): number {
  const intervals = demandIntervals.length
    ? demandIntervals
    : allIntervalTimes().filter((interval) => (requiredIntervals[interval] ?? 0) > 0.01)
  let peak = 0
  for (const interval of intervals) {
    peak = Math.max(peak, requiredIntervals[interval] ?? 0)
  }
  return peak
}

export function requiredAgentCountForDay(peakHeadcount: number, minStaffingCoverage: number): number {
  if (peakHeadcount <= 0) return 0
  const coverage = Math.max(0.01, minStaffingCoverage)
  return Math.ceil(peakHeadcount / coverage)
}

/** All agents available on an open day — full roster pool is scheduled and optimized per interval. */
export function pickAgentsForRequirementDay(
  productionHc: number,
  dayIso: string,
  restMap: AgentRestDayMap,
  _targetCount?: number,
): number[] {
  return pickAgentsForWorkingDay(productionHc, dayIso, restMap)
}

function scoreAssignmentSet(
  assignments: AgentShiftAssignment[],
  requiredIntervals: Record<string, number>,
  templates: ShiftTemplate[],
  hoopIntervals: string[],
  patternWeights?: Record<string, number>,
): number {
  return scoreIntervalCoverage(
    requiredIntervals,
    aggregateDayCoverage(assignments, templates),
    hoopIntervals,
    patternWeights,
  )
}

function buildAssignmentCandidate(
  agentIndex: number,
  template: ShiftTemplate,
  startMinutes: number,
  settings: SchedulingSettings,
  poolSize: number,
): AgentShiftAssignment {
  const breakPlans = enumerateBreakSchedules(settings, startMinutes, agentIndex, poolSize)
  const breakSchedule = breakPlans[0]!
  return {
    agentIndex,
    templateId: template.id,
    startMinutes,
    lunchStart: breakSchedule.lunchStart,
    lunchEnd: breakSchedule.lunchEnd,
    breaks: breakSchedule.breaks,
  }
}

function templateCoversInterval(template: ShiftTemplate, interval: string): boolean {
  const midpoint = intervalToMinutes(interval) + INTERVAL_MINUTES / 2
  return midpoint >= template.startMinutes && midpoint < template.startMinutes + template.durationMinutes
}

/**
 * Prefer the latest start that still covers the interval so peak/midday demand
 * creates midday starts instead of being claimed by very early shifts.
 */
function pickTemplateForInterval(templates: ShiftTemplate[], interval: string): ShiftTemplate | null {
  const candidates = templates.filter((template) => templateCoversInterval(template, interval))
  if (!candidates.length) return null
  return candidates.sort((a, b) => b.startMinutes - a.startMinutes)[0]!
}

function dayPeakRequired(requiredIntervals: Record<string, number>, hoopIntervals: string[]): number {
  let peak = 0
  for (const interval of hoopIntervals) {
    peak = Math.max(peak, requiredIntervals[interval] ?? 0)
  }
  return Math.max(peak, 0.01)
}

type ShiftWave = { template: ShiftTemplate; headcount: number }

/** Build shift waves from demand pattern and distribute the full agent pool (best-fit). */
function buildShiftWavePlan(
  requiredIntervals: Record<string, number>,
  templates: ShiftTemplate[],
  hoopIntervals: string[],
  settings: SchedulingSettings,
  totalAgents: number,
  patternWeights?: Record<string, number>,
): ShiftWave[] {
  const waveTemplates = new Map<number, ShiftTemplate>()

  for (const interval of hoopIntervals) {
    if ((requiredIntervals[interval] ?? 0) <= 0) continue
    const template = pickTemplateForInterval(templates, interval)
    if (template) waveTemplates.set(template.startMinutes, template)
  }

  if (!waveTemplates.size || totalAgents <= 0) return []

  const waves: ShiftWave[] = [...waveTemplates.values()]
    .sort((a, b) => a.startMinutes - b.startMinutes)
    .map((template) => ({ template, headcount: 0 }))

  const waveTemplateList = waves.map((wave) => wave.template)
  const demandScores = waves.map((wave) =>
    waveDemandScore(wave, requiredIntervals, hoopIntervals, waveTemplateList, patternWeights),
  )
  const totalDemand = demandScores.reduce((sum, score) => sum + score, 0)
  const maxPerTemplate = Math.max(1, Math.round(settings.maxEmployeesPerShiftTemplate || totalAgents))

  if (totalDemand <= 0) {
    const even = Math.floor(totalAgents / waves.length)
    for (const wave of waves) wave.headcount = Math.min(maxPerTemplate, even)
    let remainder = totalAgents - waves.reduce((sum, wave) => sum + wave.headcount, 0)
    for (let index = 0; remainder > 0; index += 1) {
      const wave = waves[index % waves.length]!
      if (wave.headcount >= maxPerTemplate) {
        if (index > waves.length * 3) break
        continue
      }
      wave.headcount += 1
      remainder -= 1
    }
    return waves
  }

  let assigned = 0
  for (let index = 0; index < waves.length; index += 1) {
    const share = Math.floor((totalAgents * demandScores[index]!) / totalDemand)
    waves[index]!.headcount = Math.min(maxPerTemplate, Math.max(demandScores[index]! > 0 ? 1 : 0, share))
    assigned += waves[index]!.headcount
  }

  while (assigned > totalAgents) {
    const index = demandScores.reduce(
      (best, score, slotIndex) => {
        if (waves[slotIndex]!.headcount <= (score > 0 ? 1 : 0)) return best
        const ratio = waves[slotIndex]!.headcount / Math.max(0.01, score)
        const bestRatio = waves[best]!.headcount / Math.max(0.01, demandScores[best]!)
        return ratio > bestRatio ? slotIndex : best
      },
      0,
    )
    if (waves[index]!.headcount <= (demandScores[index]! > 0 ? 1 : 0)) break
    waves[index]!.headcount -= 1
    assigned -= 1
  }

  while (assigned < totalAgents) {
    const index = demandScores.reduce(
      (best, score, slotIndex) => {
        if (waves[slotIndex]!.headcount >= maxPerTemplate) return best
        if (waves[best]!.headcount >= maxPerTemplate && waves[slotIndex]!.headcount < maxPerTemplate) {
          return slotIndex
        }
        const ratio = waves[slotIndex]!.headcount / Math.max(0.01, score)
        const bestRatio = waves[best]!.headcount / Math.max(0.01, demandScores[best]!)
        return ratio < bestRatio ? slotIndex : best
      },
      0,
    )
    if (waves[index]!.headcount >= maxPerTemplate) break
    waves[index]!.headcount += 1
    assigned += 1
  }

  return waves
}

/**
 * Score a wave by exclusive demand: only intervals where this start is the preferred
 * (latest covering) template, boosted by requirement intensity vs day peak.
 */
function waveDemandScore(
  wave: ShiftWave,
  requiredIntervals: Record<string, number>,
  hoopIntervals: string[],
  waveTemplates: ShiftTemplate[],
  patternWeights?: Record<string, number>,
): number {
  const peak = dayPeakRequired(requiredIntervals, hoopIntervals)
  let score = 0
  for (const interval of hoopIntervals) {
    const required = requiredIntervals[interval] ?? 0
    if (required <= 0) continue
    const preferred = pickTemplateForInterval(waveTemplates, interval)
    if (!preferred || preferred.startMinutes !== wave.template.startMinutes) continue
    const intensity = 0.75 + required / peak
    score += required * Math.max(0.01, patternWeights?.[interval] ?? 1) * intensity
  }
  return score
}

function assignAgentsFromWavePlan(
  agentIndices: number[],
  waves: ShiftWave[],
  settings: SchedulingSettings,
  requiredIntervals: Record<string, number>,
  hoopIntervals: string[],
  patternWeights?: Record<string, number>,
): AgentShiftAssignment[] {
  if (!agentIndices.length || !waves.length) return []

  const poolSize = Math.max(agentIndices.length, 1)
  const waveTemplateList = waves.map((wave) => wave.template)
  const maxPerTemplate = Math.max(1, Math.round(settings.maxEmployeesPerShiftTemplate || agentIndices.length))
  const totalRequested = waves.reduce((sum, wave) => sum + wave.headcount, 0)
  const prioritized = [...waves].sort(
    (a, b) =>
      waveDemandScore(b, requiredIntervals, hoopIntervals, waveTemplateList, patternWeights) -
      waveDemandScore(a, requiredIntervals, hoopIntervals, waveTemplateList, patternWeights),
  )

  const slots: Array<{ template: ShiftTemplate; count: number }> = prioritized.map((wave) => ({
    template: wave.template,
    count: 0,
  }))

  if (totalRequested <= agentIndices.length) {
    for (const [index, wave] of prioritized.entries()) {
      slots[index]!.count = Math.min(maxPerTemplate, wave.headcount)
    }
  } else {
    let allocated = 0
    for (let index = 0; index < slots.length && allocated < agentIndices.length; index += 1) {
      if (
        waveDemandScore(prioritized[index]!, requiredIntervals, hoopIntervals, waveTemplateList, patternWeights) <= 0
      ) {
        continue
      }
      slots[index]!.count = 1
      allocated += 1
    }
    while (allocated < agentIndices.length) {
      const target = slots.reduce((best, slot, slotIndex) => {
        if (slot.count >= maxPerTemplate) return best
        if (slots[best]!.count >= maxPerTemplate && slot.count < maxPerTemplate) return slotIndex
        return prioritized[slotIndex]!.headcount > prioritized[best]!.headcount ? slotIndex : best
      }, 0)
      if (slots[target]!.count >= maxPerTemplate) break
      slots[target]!.count += 1
      allocated += 1
    }
  }

  const assignments: AgentShiftAssignment[] = []
  let agentPos = 0
  for (const slot of slots) {
    for (let count = 0; count < slot.count && agentPos < agentIndices.length; count += 1, agentPos += 1) {
      assignments.push(
        buildAssignmentCandidate(agentIndices[agentPos]!, slot.template, slot.template.startMinutes, settings, poolSize),
      )
    }
  }

  while (agentPos < agentIndices.length && prioritized.length) {
    const coverage = aggregateDayCoverage(assignments, waveTemplateList)
    const understaffed = worstUnderstaffedInterval(requiredIntervals, coverage, hoopIntervals)
    let template = prioritized[0]!.template
    if (understaffed) {
      template = pickTemplateForInterval(waveTemplateList, understaffed) ?? template
    } else {
      const bestWaveIndex = prioritized.reduce((best, wave, index) => {
        const score =
          waveDemandScore(wave, requiredIntervals, hoopIntervals, waveTemplateList, patternWeights) /
          Math.max(1, slots[index]?.count ?? 1)
        const bestScore =
          waveDemandScore(prioritized[best]!, requiredIntervals, hoopIntervals, waveTemplateList, patternWeights) /
          Math.max(1, slots[best]?.count ?? 1)
        return score > bestScore ? index : best
      }, 0)
      template = prioritized[bestWaveIndex]!.template
    }
    const slotIndex = slots.findIndex((slot) => slot.template.startMinutes === template.startMinutes)
    if (slotIndex >= 0 && slots[slotIndex]!.count >= maxPerTemplate) {
      const fallback = slots.find((slot) => slot.count < maxPerTemplate)
      if (!fallback) break
      template = fallback.template
      fallback.count += 1
    } else if (slotIndex >= 0) {
      slots[slotIndex]!.count += 1
    }
    assignments.push(
      buildAssignmentCandidate(agentIndices[agentPos]!, template, template.startMinutes, settings, poolSize),
    )
    agentPos += 1
  }

  return assignments
}

function worstUnderstaffedInterval(
  requiredIntervals: Record<string, number>,
  scheduled: Record<string, number>,
  hoopIntervals: string[],
): string | null {
  let worstInterval: string | null = null
  let worstGap = 0
  for (const interval of hoopIntervals) {
    const required = requiredIntervals[interval] ?? 0
    if (required <= 0) continue
    const gap = required - (scheduled[interval] ?? 0)
    if (gap > worstGap) {
      worstGap = gap
      worstInterval = interval
    }
  }
  return worstGap > 0.01 ? worstInterval : null
}

/**
 * Assign agents across shift waves so every required HoOP block receives coverage, then refine gaps.
 */
export function assignShiftsToCoverRequirements(
  agentIndices: number[],
  requiredIntervals: Record<string, number>,
  templates: ShiftTemplate[],
  settings: SchedulingSettings,
  hoopIntervals: string[],
  patternWeights?: Record<string, number>,
): AgentShiftAssignment[] {
  if (!agentIndices.length || !templates.length) return []

  const waves = buildShiftWavePlan(
    requiredIntervals,
    templates,
    hoopIntervals,
    settings,
    agentIndices.length,
    patternWeights,
  )
  let assignments = assignAgentsFromWavePlan(
    agentIndices,
    waves,
    settings,
    requiredIntervals,
    hoopIntervals,
    patternWeights,
  )

  const poolSize = Math.max(agentIndices.length, 1)
  let scheduled = aggregateDayCoverage(assignments, templates)
  const assignedIds = new Set(assignments.map((row) => row.agentIndex))
  const remaining = agentIndices.filter((index) => !assignedIds.has(index))

  for (const agentIndex of remaining) {
    const priorityInterval = worstUnderstaffedInterval(requiredIntervals, scheduled, hoopIntervals)
    const templatePool = priorityInterval
      ? templates.filter((template) => templateCoversInterval(template, priorityInterval))
      : templates
    const candidates = templatePool.length ? templatePool : templates

    let bestAssignment: AgentShiftAssignment | null = null
    let bestScore = Number.POSITIVE_INFINITY

    for (const template of candidates) {
      const breakPlans = enumerateBreakSchedules(settings, template.startMinutes, agentIndex, poolSize)
      const plans = breakPlans.length
        ? breakPlans
        : [{ lunchStart: 0, lunchEnd: 0, breaks: [] as Array<[number, number]> }]

      for (const breakSchedule of plans) {
        const candidate: AgentShiftAssignment = {
          agentIndex,
          templateId: template.id,
          startMinutes: template.startMinutes,
          lunchStart: breakSchedule.lunchStart,
          lunchEnd: breakSchedule.lunchEnd,
          breaks: breakSchedule.breaks,
        }
        const combined = { ...scheduled }
        const added = aggregateDayCoverage([candidate], templates)
        for (const interval of Object.keys(added)) {
          combined[interval] = (combined[interval] ?? 0) + (added[interval] ?? 0)
        }
        const score = scoreIntervalCoverage(requiredIntervals, combined, hoopIntervals, patternWeights)
        if (score < bestScore) {
          bestScore = score
          bestAssignment = candidate
        }
      }
    }

    if (bestAssignment) {
      assignments.push(bestAssignment)
      const added = aggregateDayCoverage([bestAssignment], templates)
      for (const interval of Object.keys(added)) {
        scheduled[interval] = (scheduled[interval] ?? 0) + (added[interval] ?? 0)
      }
    }
  }

  return assignments
}

/** Per-agent pass: swap shift templates/starts to reduce interval gaps (pattern-weighted). */
export function improveAssignmentCoverage(
  assignments: AgentShiftAssignment[],
  requiredIntervals: Record<string, number>,
  templates: ShiftTemplate[],
  settings: SchedulingSettings,
  hoopIntervals: string[],
  patternWeights?: Record<string, number>,
): AgentShiftAssignment[] {
  if (!assignments.length || !templates.length) return assignments

  let best = cloneAssignments(assignments)
  let bestScore = scoreAssignmentSet(best, requiredIntervals, templates, hoopIntervals, patternWeights)
  const poolSize = Math.max(assignments.length, 1)

  for (let index = 0; index < best.length; index += 1) {
    const agentIndex = best[index]!.agentIndex
    for (const template of templates) {
      const breakPlans = enumerateBreakSchedules(settings, template.startMinutes, agentIndex, poolSize)
      const plans = breakPlans.length
        ? breakPlans.slice(0, 4)
        : [{ lunchStart: 0, lunchEnd: 0, breaks: [] as Array<[number, number]> }]

      for (const breakSchedule of plans) {
        const candidate = cloneAssignments(best)
        candidate[index] = {
          agentIndex,
          templateId: template.id,
          startMinutes: template.startMinutes,
          lunchStart: breakSchedule.lunchStart,
          lunchEnd: breakSchedule.lunchEnd,
          breaks: breakSchedule.breaks,
        }
        const score = scoreAssignmentSet(candidate, requiredIntervals, templates, hoopIntervals, patternWeights)
        if (score < bestScore) {
          best = candidate
          bestScore = score
        }
      }
    }
  }

  enforceBreakConstraintsOnAssignments(best, settings)
  return best
}

function countRequiredWithoutCoverage(
  requiredIntervals: Record<string, number>,
  scheduled: Record<string, number>,
  hoopIntervals: string[],
): number {
  let count = 0
  for (const interval of hoopIntervals) {
    if ((requiredIntervals[interval] ?? 0) > 0.01 && (scheduled[interval] ?? 0) < 0.01) count += 1
  }
  return count
}

function countZeroRequirementOverstaffing(
  requiredIntervals: Record<string, number>,
  scheduled: Record<string, number>,
): number {
  let total = 0
  for (const interval of allIntervalTimes()) {
    if ((requiredIntervals[interval] ?? 0) > 0.01) continue
    total += scheduled[interval] ?? 0
  }
  return total
}

function totalUnderstaffGap(
  requiredIntervals: Record<string, number>,
  scheduled: Record<string, number>,
  hoopIntervals: string[],
): number {
  let gap = 0
  for (const interval of hoopIntervals) {
    const required = requiredIntervals[interval] ?? 0
    if (required <= 0) continue
    gap += Math.max(0, required - (scheduled[interval] ?? 0))
  }
  return gap
}

function acceptsCoverageMove(
  requiredIntervals: Record<string, number>,
  before: AgentShiftAssignment[],
  after: AgentShiftAssignment[],
  templates: ShiftTemplate[],
  hoopIntervals: string[],
  nextScore: number,
  bestScore: number,
): boolean {
  const scheduledBefore = aggregateDayCoverage(before, templates)
  const scheduledAfter = aggregateDayCoverage(after, templates)
  const uncoveredBefore = countRequiredWithoutCoverage(requiredIntervals, scheduledBefore, hoopIntervals)
  const uncoveredAfter = countRequiredWithoutCoverage(requiredIntervals, scheduledAfter, hoopIntervals)
  const zeroReqBefore = countZeroRequirementOverstaffing(requiredIntervals, scheduledBefore)
  const zeroReqAfter = countZeroRequirementOverstaffing(requiredIntervals, scheduledAfter)
  const understaffBefore = totalUnderstaffGap(requiredIntervals, scheduledBefore, hoopIntervals)
  const understaffAfter = totalUnderstaffGap(requiredIntervals, scheduledAfter, hoopIntervals)

  // Allow a small uncovered trade if total understaff and score both improve (peak pull).
  if (uncoveredAfter > uncoveredBefore + 1) return false
  if (uncoveredAfter > uncoveredBefore && understaffAfter + 0.25 >= understaffBefore) return false
  if (zeroReqAfter > zeroReqBefore + 1.01 && nextScore >= bestScore) return false
  if (uncoveredAfter < uncoveredBefore) return true
  if (understaffAfter + 0.01 < understaffBefore) return true
  if (zeroReqAfter + 0.01 < zeroReqBefore) return true
  return nextScore < bestScore
}

/**
 * Fill remaining interval gaps by nudging shift starts within allowed adjustment bounds.
 */
export function fillIntervalCoverageGaps(
  assignments: AgentShiftAssignment[],
  requiredIntervals: Record<string, number>,
  templates: ShiftTemplate[],
  settings: SchedulingSettings,
  hoopIntervals: string[],
  maxAdjustMinutes: number,
  patternWeights?: Record<string, number>,
): AgentShiftAssignment[] {
  if (!assignments.length) return assignments

  let best = cloneAssignments(assignments)
  let bestScore = scoreAssignmentSet(best, requiredIntervals, templates, hoopIntervals, patternWeights)
  const step = settings.scheduleIntervalMinutes
  const poolSize = Math.max(assignments.length, 1)

  const passCount = Math.max(3, assignments.length > 40 ? 2 : assignments.length > 30 ? 3 : 4)

  for (let pass = 0; pass < passCount; pass += 1) {
    let improved = false
    for (let index = 0; index < best.length; index += 1) {
      const assignment = best[index]!
      const template =
        templates.find((item) => item.id === assignment.templateId) ??
        templates.find((item) => item.startMinutes === assignment.startMinutes)
      if (!template) continue

      for (const delta of [-step, step, -step * 2, step * 2, -step * 3, step * 3, -step * 4, step * 4]) {
        if (Math.abs(delta) > maxAdjustMinutes) continue
        const nextStart = Math.max(
          0,
          Math.min(24 * 60 - template.durationMinutes, assignment.startMinutes + delta),
        )
        const candidate = cloneAssignments(best)
        candidate[index] = buildAssignmentCandidate(assignment.agentIndex, template, nextStart, settings, poolSize)
        const score = scoreAssignmentSet(candidate, requiredIntervals, templates, hoopIntervals, patternWeights)
        if (acceptsCoverageMove(requiredIntervals, best, candidate, templates, hoopIntervals, score, bestScore)) {
          best = candidate
          bestScore = score
          improved = true
        }
      }
    }
    if (!improved) break
  }

  enforceBreakConstraintsOnAssignments(best, settings)
  return best
}

/**
 * Last-resort pass: snap agents to HoOP-required shift starts when gaps remain after gap-fill.
 */
export function reinforceIntervalCoverage(
  assignments: AgentShiftAssignment[],
  requiredIntervals: Record<string, number>,
  templates: ShiftTemplate[],
  settings: SchedulingSettings,
  hoopIntervals: string[],
  patternWeights?: Record<string, number>,
): AgentShiftAssignment[] {
  if (!assignments.length) return assignments

  let best = cloneAssignments(assignments)
  let bestScore = scoreAssignmentSet(best, requiredIntervals, templates, hoopIntervals, patternWeights)
  const candidateStarts = shiftStartCandidatesForRequirements(requiredIntervals, hoopIntervals, settings)
  const poolSize = Math.max(assignments.length, 1)

  for (let index = 0; index < best.length; index += 1) {
    const assignment = best[index]!
    const template = templates.find((item) => item.id === assignment.templateId) ?? templates[0]
    if (!template) continue

    for (const absStart of candidateStarts) {
      if (absStart + template.durationMinutes > 24 * 60) continue
      const candidate = cloneAssignments(best)
      candidate[index] = buildAssignmentCandidate(assignment.agentIndex, template, absStart, settings, poolSize)
      const score = scoreAssignmentSet(candidate, requiredIntervals, templates, hoopIntervals, patternWeights)
      if (acceptsCoverageMove(requiredIntervals, best, candidate, templates, hoopIntervals, score, bestScore)) {
        best = candidate
        bestScore = score
      }
    }
  }

  enforceBreakConstraintsOnAssignments(best, settings)
  return best
}

/**
 * Shift starts that can productively cover required HoOP intervals.
 * Keeps settings-allowed starts plus strategic early/peak-aligned starts (bounded set for performance).
 */
export function shiftStartCandidatesForRequirements(
  requiredIntervals: Record<string, number>,
  hoopIntervals: string[],
  settings: SchedulingSettings,
): number[] {
  const durationMinutes = settings.shiftLengthHours * 60
  const grid = settings.scheduleIntervalMinutes
  const candidates = new Set<number>()

  const shiftProductivelyCoversDemand = (startMinutes: number): boolean => {
    const shiftEnd = startMinutes + durationMinutes
    for (const interval of hoopIntervals) {
      if ((requiredIntervals[interval] ?? 0) <= 0) continue
      const midpoint = intervalToMinutes(interval) + INTERVAL_MINUTES / 2
      if (midpoint < startMinutes || midpoint >= shiftEnd) continue
      return true
    }
    return false
  }

  for (const start of generateShiftStartOptions(settings)) {
    if (shiftProductivelyCoversDemand(start)) candidates.add(start)
  }

  let earliestRequired = Number.POSITIVE_INFINITY
  let latestRequired = 0
  let peakRequired = 0
  let peakInterval = hoopIntervals[0] ?? '00:00'
  for (const interval of hoopIntervals) {
    const required = requiredIntervals[interval] ?? 0
    if (required <= 0) continue
    const startMin = intervalToMinutes(interval)
    earliestRequired = Math.min(earliestRequired, startMin)
    latestRequired = Math.max(latestRequired, startMin)
    if (required > peakRequired) {
      peakRequired = required
      peakInterval = interval
    }
  }

  const addCoveringStarts = (interval: string) => {
    const midpoint = intervalToMinutes(interval) + INTERVAL_MINUTES / 2
    const earliestStart = Math.max(0, midpoint - durationMinutes + INTERVAL_MINUTES)
    const latestStart = Math.min(midpoint, 24 * 60 - durationMinutes)
    for (let minute = earliestStart; minute <= latestStart && minute <= earliestStart + grid * 3; minute += grid) {
      const snapped = snapMinutesToGrid(minute, settings.scheduleIntervalMinutes, settings.allowedStartIntervals)
      if (snapped >= 0 && snapped + durationMinutes <= 24 * 60) {
        candidates.add(snapped)
      }
    }
  }

  if (Number.isFinite(earliestRequired)) {
    addCoveringStarts(minutesToInterval(earliestRequired))
  }
  if (latestRequired > 0) {
    addCoveringStarts(minutesToInterval(latestRequired))
  }
  if (peakRequired > 0) {
    addCoveringStarts(peakInterval)
  }

  return [...candidates].sort((a, b) => a - b)
}

function formatShiftStartLabel(startMinutes: number, shiftHours: number): string {
  const hours = Math.floor(startMinutes / 60)
  const mins = startMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')} · ${shiftHours}h`
}

/**
 * Add shift-start options so every required HoOP interval can be covered (including early-morning HoOP).
 */
export function augmentShiftTemplatesForDay(
  templates: ShiftTemplate[],
  requiredIntervals: Record<string, number>,
  hoopIntervals: string[],
  settings: SchedulingSettings,
): ShiftTemplate[] {
  if (!hoopIntervals.length) return templates

  const startCandidates = shiftStartCandidatesForRequirements(requiredIntervals, hoopIntervals, settings)
  if (!startCandidates.length) return templates

  const durationMinutes = settings.shiftLengthHours * 60
  const totalBreakMinutes = settings.breakCount * settings.breakDurationMinutes
  const byStart = new Map<number, ShiftTemplate>()

  for (const template of templates) {
    byStart.set(template.startMinutes, template)
  }

  for (const startMinutes of startCandidates) {
    if (byStart.has(startMinutes)) continue
    byStart.set(startMinutes, {
      id: `shift-hoop-${startMinutes}`,
      label: formatShiftStartLabel(startMinutes, settings.shiftLengthHours),
      startMinutes,
      durationMinutes,
      lunchMinutes: settings.unpaidLunchMinutes,
      breakMinutes: totalBreakMinutes,
    })
  }

  return [...byStart.values()].sort((a, b) => a.startMinutes - b.startMinutes)
}

export function hasUncoveredRequiredIntervals(
  requiredIntervals: Record<string, number>,
  scheduledIntervals: Record<string, number>,
  hoopIntervals: string[],
): boolean {
  for (const interval of hoopIntervals) {
    const required = requiredIntervals[interval] ?? 0
    if (required <= 0) continue
    if ((scheduledIntervals[interval] ?? 0) + 0.01 < required) return true
  }
  return false
}
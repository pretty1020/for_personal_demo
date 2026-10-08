import type { SchedulingSettings } from './schedulingSettingsTypes'
import type { ShiftTemplate } from './types'
import { allIntervalTimes } from './intervalSlots'
import {
  aggregateDayCoverage,
  cloneAssignments,
  type AgentShiftAssignment,
} from './scheduleGeneration'
import { applyBreakPlan, ensurePlanHasBreaks, enumerateBreakSchedules } from './breakScheduleCandidates'

export function scoreIntervalCoverage(
  required: Record<string, number>,
  scheduled: Record<string, number>,
  hoopIntervals: string[],
  patternWeights?: Record<string, number>,
): number {
  let score = 0
  const active = (
    hoopIntervals.length
      ? hoopIntervals
      : allIntervalTimes()
  ).filter((interval) => (required[interval] ?? 0) > 0.01)
  if (!active.length) return 0
  let peakRequired = 0
  let peakScheduled = 0
  let peakRequiredInterval = ''
  let peakScheduledInterval = ''

  for (const interval of active) {
    const req = required[interval] ?? 0
    if (req > peakRequired) {
      peakRequired = req
      peakRequiredInterval = interval
    }
  }

  for (const interval of active) {
    const req = required[interval] ?? 0
    const sched = scheduled[interval] ?? 0
    const patternWeight = Math.max(0.01, patternWeights?.[interval] ?? 1)
    const relativeReq = req / Math.max(peakRequired, 0.01)

    if (sched > peakScheduled) {
      peakScheduled = sched
      peakScheduledInterval = interval
    }

    if (req <= 0) continue

    const weight = req * patternWeight * (0.65 + relativeReq)
    const variance = sched - req
    score += Math.abs(variance) * weight
    if (variance < 0) {
      // Heavier penalty for understaffing peak/high-requirement intervals.
      const peakBoost = relativeReq >= 0.7 ? 1.85 : relativeReq >= 0.45 ? 1.45 : 1.2
      score += Math.abs(variance) ** 1.35 * weight * peakBoost
    }
    if (variance > 0) {
      // Extra penalty for parking agents on low-requirement intervals.
      const earlyOverstaffBoost = relativeReq <= 0.35 ? 1.75 : relativeReq <= 0.55 ? 1.15 : 0.85
      score += variance ** 1.15 * weight * earlyOverstaffBoost
    }
    if (req > 0 && sched > req * 1.05) score += (sched - req * 1.05) * weight * 0.65
  }

  if (peakRequiredInterval && peakScheduledInterval && peakRequiredInterval !== peakScheduledInterval) {
    score += peakRequired * 95
  }
  if (peakRequired > 0 && peakScheduled + 0.01 < peakRequired) {
    score += (peakRequired - peakScheduled) ** 1.5 * 140
  }

  return score
}

/**
 * Place lunch/break per agent to minimize requirement vs scheduled gaps.
 * Each agent gets a different plan (staggered + gap-aware).
 */
export function optimizeBreaksForDay(
  assignments: AgentShiftAssignment[],
  requiredIntervals: Record<string, number>,
  templates: ShiftTemplate[],
  settings: SchedulingSettings,
  hoopIntervals: string[],
  patternWeights?: Record<string, number>,
): AgentShiftAssignment[] {
  if (!assignments.length) return assignments

  let best = cloneAssignments(assignments)
  let bestScore = scoreIntervalCoverage(
    requiredIntervals,
    aggregateDayCoverage(best, templates),
    hoopIntervals,
    patternWeights,
  )

  const agentCount = assignments.length
  const ordered = [...best].sort((a, b) => a.agentIndex - b.agentIndex)

  for (let pass = 0; pass < 4; pass += 1) {
    let improved = false
    for (const source of ordered) {
      const index = best.findIndex((row) => row.agentIndex === source.agentIndex)
      if (index < 0) continue
      const template = templates.find((item) => item.id === best[index]!.templateId)
      if (!template) continue

      const candidates = enumerateBreakSchedules(settings, best[index]!.startMinutes, best[index]!.agentIndex, agentCount)
      for (const plan of candidates) {
        const candidate = cloneAssignments(best)
        applyBreakPlan(candidate[index]!, plan)
        const score = scoreIntervalCoverage(
          requiredIntervals,
          aggregateDayCoverage(candidate, templates),
          hoopIntervals,
          patternWeights,
        )
        if (score < bestScore) {
          best = candidate
          bestScore = score
          improved = true
        }
      }
    }
    if (!improved) break
  }

  for (let index = 0; index < best.length; index += 1) {
    const plan = ensurePlanHasBreaks(settings, best[index]!.startMinutes, best[index]!.agentIndex, {
      lunchStart: best[index]!.lunchStart,
      lunchEnd: best[index]!.lunchEnd,
      breaks: best[index]!.breaks,
    })
    applyBreakPlan(best[index]!, plan)
  }

  return best
}

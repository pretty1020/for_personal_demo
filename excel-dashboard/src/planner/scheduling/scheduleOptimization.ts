import type { GeneratedRequirementTable } from './requirementGeneration'
import {
  dailyFteFromAllIntervalHeadcounts,
  dailyFteFromIntervalMetricRows,
  staffingPct,
  sumIntervalMetricRows,
  weeklyScheduledFromIntervalSum,
  weeklyAvgFromDailySum,
} from './fteMetrics'
import type { PatternScheduleMeta } from './patternAnalysis'
import { isIntervalInHoOP } from './patternAnalysis'
import { scoreIntervalCoverage, optimizeBreaksForDay } from './breakOptimization'
import type { AgentShiftAssignment } from './scheduleGeneration'
import { allIntervalTimes, formatDayLabel } from './intervalSlots'
import { aggregateDayCoverage, aggregateGrossShiftCoverage, cloneAssignments, isVlAssignment } from './scheduleGeneration'
import { maskScheduledToDemandIntervals } from './intervalGapAllocation'
import { applyBreakPlan, ensurePlanHasBreaks, enumerateBreakSchedules } from './breakScheduleCandidates'
import { createDefaultSchedulingSettings, settingsToSchedulingRules } from './defaultSchedulingSettings'
import type { DayScheduleSummary, SchedulingResult, SchedulingRules, ShiftTemplate } from './types'
import {
  applyShrinkageToNetFte,
  type BuildSchedulingResultShrinkageOptions,
} from './applyShrinkage'

export function optimizeShiftStartsForDay(
  assignments: AgentShiftAssignment[],
  requiredIntervals: Record<string, number>,
  rules: SchedulingRules,
  hoopIntervals: string[],
  patternWeights?: Record<string, number>,
): AgentShiftAssignment[] {
  // Fixed mode still optimizes starts during the day build so required intervals get covered;
  // weeklyRosterScheduling then locks each agent to one start for the whole week.
  if (!rules.optimizeShiftStarts) return assignments
  let best = cloneAssignments(assignments)
  let bestScore = scoreIntervalCoverage(
    requiredIntervals,
    aggregateDayCoverage(best, rules.shiftTemplates),
    hoopIntervals,
    patternWeights,
  )

  const step = rules.settings.scheduleIntervalMinutes
  const max = rules.maxShiftStartAdjustMinutes
  const agentCount = Math.max(assignments.length, 1)
  for (let pass = 0; pass < 4; pass += 1) {
    let improved = false
    for (let index = 0; index < best.length; index += 1) {
      for (const delta of [-step, step, -step * 2, step * 2, -step * 3, step * 3]) {
        if (Math.abs(delta) > max) continue
        const candidate = cloneAssignments(best)
        const template = rules.shiftTemplates.find((item) => item.id === candidate[index]!.templateId)
        if (!template) continue
        const nextStart = Math.max(
          0,
          Math.min(24 * 60 - template.durationMinutes, candidate[index]!.startMinutes + delta),
        )
        const breakPlans = enumerateBreakSchedules(rules.settings, nextStart, candidate[index]!.agentIndex, agentCount)
        const breakPlan = breakPlans[0]
        if (!breakPlan) continue
        candidate[index] = {
          ...candidate[index]!,
          startMinutes: nextStart,
          lunchStart: breakPlan.lunchStart,
          lunchEnd: breakPlan.lunchEnd,
          breaks: breakPlan.breaks.map(([from, to]) => [from, to] as [number, number]),
        }
        const coverage = aggregateDayCoverage(candidate, rules.shiftTemplates)
        const score = scoreIntervalCoverage(requiredIntervals, coverage, hoopIntervals, patternWeights)
        if (score < bestScore) {
          best = candidate
          bestScore = score
          improved = true
        }
      }
    }
    if (!improved) break
  }
  return best
}

export function optimizeDayAssignments(
  assignments: AgentShiftAssignment[],
  requiredIntervals: Record<string, number>,
  rules: SchedulingRules,
  hoopIntervals: string[],
  patternWeights?: Record<string, number>,
): AgentShiftAssignment[] {
  let optimized = assignments
  if (rules.optimizeShiftStarts) {
    optimized = optimizeShiftStartsForDay(optimized, requiredIntervals, rules, hoopIntervals, patternWeights)
  }
  if (rules.settings.constraints?.minimizeOverUnder) {
    optimized = optimizeBreaksForDay(
      optimized,
      requiredIntervals,
      rules.shiftTemplates,
      rules.settings,
      hoopIntervals,
      patternWeights,
    )
    if (rules.optimizeShiftStarts) {
      optimized = optimizeShiftStartsForDay(optimized, requiredIntervals, rules, hoopIntervals, patternWeights)
      optimized = optimizeBreaksForDay(
        optimized,
        requiredIntervals,
        rules.shiftTemplates,
        rules.settings,
        hoopIntervals,
        patternWeights,
      )
    }
  }

  for (let index = 0; index < optimized.length; index += 1) {
    if (optimized[index]!.kind === 'vl' || optimized[index]!.templateId === 'vl') continue
    const plan = ensurePlanHasBreaks(rules.settings, optimized[index]!.startMinutes, optimized[index]!.agentIndex, {
      lunchStart: optimized[index]!.lunchStart,
      lunchEnd: optimized[index]!.lunchEnd,
      breaks: optimized[index]!.breaks,
    })
    applyBreakPlan(optimized[index]!, plan)
  }

  return optimized
}

export function buildSchedulingResult(
  requirementTable: GeneratedRequirementTable,
  _productionHc: number,
  rules: SchedulingRules,
  patternMeta: PatternScheduleMeta,
  assignmentsByDay: Record<string, AgentShiftAssignment[]>,
  templatesByDay?: Record<string, ShiftTemplate[]>,
  options?: BuildSchedulingResultShrinkageOptions,
): SchedulingResult {
  const intervalMinutes = rules.settings.scheduleIntervalMinutes
  const fteRequiredDailyHours = rules.settings.fteRequiredDailyDivisorHours
  const fteDailyHours = rules.settings.fteDailyDivisorHours
  const fteWeeklyHours = rules.settings.fteWeeklyDivisorHours
  const shiftLengthHours = rules.settings.shiftLengthHours
  const allRequirementDays = requirementTable.days
  const openDays = allRequirementDays.filter((day) => patternMeta.workingDays.includes(day.day))
  const flatPct = options?.flatApplyShrinkagePct ?? 0
  const intervalPctMap = options?.intervalApplyShrinkagePct

  const days: DayScheduleSummary[] = []
  let sumCalendarDailyRequired = 0
  let sumWeekNetFteIntervals = 0
  let sumWeekGrossIntervals = 0
  let sumAgentsOpenDays = 0
  let openDayAgentSamples = 0
  let totalOver = 0
  let totalUnder = 0

  for (const dayRequirement of allRequirementDays) {
    const hasPatternDemand = Object.values(dayRequirement.intervals).some((value) => value > 0.01)
    const isOpenDay = patternMeta.workingDays.includes(dayRequirement.day) || hasPatternDemand
    const assignments = assignmentsByDay[dayRequirement.day] ?? []
    const dayTemplates = templatesByDay?.[dayRequirement.day] ?? rules.shiftTemplates
    const productiveIntervals = aggregateDayCoverage(assignments, dayTemplates)
    const grossScheduledIntervals = aggregateGrossShiftCoverage(assignments, dayTemplates)
    const scheduledAgents = assignments.filter((assignment) => !isVlAssignment(assignment)).length

    const maskedGross = maskScheduledToDemandIntervals(dayRequirement.intervals, grossScheduledIntervals)
    const maskedProductive = maskScheduledToDemandIntervals(dayRequirement.intervals, productiveIntervals)

    const intervals = allIntervalTimes()
      .map((interval) => {
        const inHoOP = isIntervalInHoOP(patternMeta, dayRequirement.day, interval)
        const requiredFte = inHoOP || hasPatternDemand ? (dayRequirement.intervals[interval] ?? 0) : 0
        if (requiredFte <= 0.01) return null

        const grossHc = maskedGross[interval] ?? 0
        const productive = maskedProductive[interval] ?? 0
        const pct = intervalPctMap?.[dayRequirement.day]?.[interval] ?? flatPct
        // Net FTE = productive after Break/Lunch. After shrinkage = Net FTE × (1 − %); at 0% equals Net FTE.
        const netFte = productive
        const netFteAfterShrinkage = applyShrinkageToNetFte(netFte, pct)
        const variance = netFteAfterShrinkage - requiredFte
        return {
          interval,
          requiredFte,
          scheduledFte: grossHc,
          netFte,
          netFteAfterShrinkage,
          variance,
          staffingPct: staffingPct(netFteAfterShrinkage, requiredFte),
        }
      })
      .filter((row): row is NonNullable<typeof row> => row != null)

    const grossIntervalSum = sumIntervalMetricRows(intervals, (row) => row.scheduledFte)
    const productiveIntervalSum = sumIntervalMetricRows(intervals, (row) => row.netFte ?? 0)
    const afterShrinkageIntervalSum = sumIntervalMetricRows(
      intervals,
      (row) => row.netFteAfterShrinkage ?? row.netFte ?? 0,
    )

    const dailyRequiredTotal = isOpenDay
      ? dailyFteFromAllIntervalHeadcounts(dayRequirement.intervals, fteRequiredDailyHours, intervalMinutes)
      : 0
    /** Daily Scheduled FTE = SUM(interval Scheduled/on-shift HC) ÷ 8 ÷ 2 — matches Excel interval grid. */
    const dailyScheduledTotal = isOpenDay
      ? dailyFteFromIntervalMetricRows(intervals, (row) => row.scheduledFte, fteDailyHours, intervalMinutes)
      : 0
    /** Net FTE (daily, before shrinkage) = SUM(interval Net FTE) ÷ shift length ÷ 2 */
    const dailyNetFteBeforeShrinkage = isOpenDay
      ? dailyFteFromIntervalMetricRows(intervals, (row) => row.netFte ?? 0, shiftLengthHours, intervalMinutes)
      : 0
    /** Net FTE after shrinkage (daily) — drives variance / staffing % */
    const dailyNetFteTotal = isOpenDay
      ? dailyFteFromIntervalMetricRows(
          intervals,
          (row) => row.netFteAfterShrinkage ?? row.netFte ?? 0,
          shiftLengthHours,
          intervalMinutes,
        )
      : 0

    const overstaffedIntervals = isOpenDay ? intervals.filter((row) => row.variance > 0.01).length : 0
    const understaffedIntervals = isOpenDay ? intervals.filter((row) => row.variance < -0.01).length : 0

    sumCalendarDailyRequired += dailyRequiredTotal
    sumWeekNetFteIntervals += afterShrinkageIntervalSum
    sumWeekGrossIntervals += grossIntervalSum
    totalOver += overstaffedIntervals
    totalUnder += understaffedIntervals

    if (!isOpenDay) {
      days.push({
        day: dayRequirement.day,
        dateLabel: formatDayLabel(dayRequirement.day),
        dailyRequiredFte: 0,
        dailyScheduledFte: 0,
        dailyRequiredTotal: 0,
        dailyScheduledTotal: 0,
        dailyNetFteBeforeShrinkage: 0,
        dailyNetFteTotal: 0,
        dailyScheduledIntervalSum: 0,
        dailyProductiveIntervalSum: 0,
        dailyNetFteAfterShrinkageIntervalSum: 0,
        dailyScheduledHc: 0,
        dailyVariance: 0,
        dailyStaffingPct: null,
        overstaffedIntervals: 0,
        understaffedIntervals: 0,
        intervals: [],
        isClosed: true,
      })
      continue
    }

    sumAgentsOpenDays += scheduledAgents
    openDayAgentSamples += 1

    days.push({
      day: dayRequirement.day,
      dateLabel: formatDayLabel(dayRequirement.day),
      dailyRequiredFte: dailyRequiredTotal,
      dailyScheduledFte: dailyScheduledTotal,
      dailyRequiredTotal,
      dailyScheduledTotal,
      dailyNetFteBeforeShrinkage,
      dailyNetFteTotal,
      dailyScheduledIntervalSum: grossIntervalSum,
      dailyProductiveIntervalSum: productiveIntervalSum,
      dailyNetFteAfterShrinkageIntervalSum: afterShrinkageIntervalSum,
      dailyScheduledHc: scheduledAgents,
      dailyVariance: dailyNetFteTotal - dailyRequiredTotal,
      dailyStaffingPct: staffingPct(dailyNetFteTotal, dailyRequiredTotal),
      overstaffedIntervals,
      understaffedIntervals,
      intervals,
      isClosed: false,
    })
  }

  const openDayCount = Math.max(openDays.length, 1)
  const weeklySumRequired = weeklyAvgFromDailySum(sumCalendarDailyRequired, openDayCount)
  const weeklySumScheduledNetFte = weeklyScheduledFromIntervalSum(
    sumWeekNetFteIntervals,
    fteWeeklyHours,
    intervalMinutes,
  )
  const weeklyTarget = requirementTable.weeklyFteTarget

  const scheduledAgentIndices = new Set<number>()
  for (const dayRequirement of allRequirementDays) {
    for (const assignment of assignmentsByDay[dayRequirement.day] ?? []) {
      if (isVlAssignment(assignment)) continue
      scheduledAgentIndices.add(assignment.agentIndex)
    }
  }

  return {
    days,
    totals: {
      requiredFte: weeklyAvgFromDailySum(
        openDays.reduce(
          (sum, day) =>
            sum +
            dailyFteFromAllIntervalHeadcounts(day.intervals, fteRequiredDailyHours, intervalMinutes),
          0,
        ),
        openDayCount,
      ),
      scheduledFte: weeklySumScheduledNetFte,
      weeklySumRequired: weeklyTarget > 0 ? weeklyTarget : weeklySumRequired,
      weeklySumScheduled: weeklySumScheduledNetFte,
      weeklyScheduledIntervalSum: sumWeekNetFteIntervals,
      weeklyScheduledGrossIntervalSum: sumWeekGrossIntervals,
      rosterPoolHc: _productionHc,
      rosterAgentsWithShifts: scheduledAgentIndices.size,
      avgAgentsPerOpenDay:
        openDayAgentSamples > 0 ? sumAgentsOpenDays / openDayAgentSamples : 0,
      variance: weeklySumScheduledNetFte - (weeklyTarget > 0 ? weeklyTarget : weeklySumRequired),
      staffingPct: staffingPct(weeklySumScheduledNetFte, weeklyTarget > 0 ? weeklyTarget : weeklySumRequired),
      overstaffedIntervals: totalOver,
      understaffedIntervals: totalUnder,
    },
  }
}

export function defaultSchedulingRules(): SchedulingRules {
  return settingsToSchedulingRules(createDefaultSchedulingSettings())
}

export { allocateDailyProductionHc } from './dailyHcAllocation'

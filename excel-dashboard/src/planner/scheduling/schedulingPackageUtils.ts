import type { GeneratedRequirementTable } from './requirementGeneration'
import {
  dailyFteFromAllIntervalHeadcounts,
  dailyFteFromIntervalMetricRows,
  staffingPct,
  sumIntervalMetricRows,
  weeklyScheduledFromIntervalSum,
} from './fteMetrics'
import type { PatternScheduleMeta } from './patternAnalysis'
import { buildWeeklyAgentScheduleGrid } from './agentScheduleGrid'
import { buildSchedulingMetricsMatrix, enrichSchedulingResult } from './schedulingMetrics'
import { buildSchedulingResult } from './scheduleOptimization'
import type { AgentShiftAssignment } from './scheduleGeneration'
import { buildAgentSchedulesForDay } from './scheduleGeneration'
import { buildWeeklyAgentRoster } from './weeklyRosterScheduling'
import type {
  DayAgentSchedules,
  GeneratedSchedulingPackage,
  IntervalMetricRow,
  IntervalPatternRow,
  SchedulingQualityInputs,
  SchedulingResult,
  SchedulingRules,
  WeekIntervalPattern,
} from './types'
import { formatDayLabel } from './intervalSlots'
import { defaultAgentName, isGenericAgentName } from './scheduleRosterAgents'
import {
  applyShrinkageToNetFte,
  type BuildSchedulingResultShrinkageOptions,
} from './applyShrinkage'

export function agentLabelForIndex(agentIndex: number, agentNames?: Record<string, string>): string {
  const custom = agentNames?.[String(agentIndex)]?.trim()
  if (custom && !isGenericAgentName(custom)) return custom
  return defaultAgentName(agentIndex)
}

export function applyAgentNamesToPackage(
  pkg: GeneratedSchedulingPackage,
  agentNames: Record<string, string>,
): GeneratedSchedulingPackage {
  const weeklyAgentGrid = {
    ...pkg.weeklyAgentGrid,
    rows: pkg.weeklyAgentGrid.rows.map((row) => ({
      ...row,
      agentLabel: agentLabelForIndex(row.agentIndex, agentNames),
    })),
  }
  const agentSchedules = pkg.agentSchedules.map((day) => ({
    ...day,
    agents: day.agents.map((agent) => ({
      ...agent,
      agentLabel: agentLabelForIndex(agent.agentIndex, agentNames),
    })),
  }))
  return { ...pkg, weeklyAgentGrid, agentSchedules, agentNames }
}

export function rebuildPackageFromRequirements(
  requirementTable: GeneratedRequirementTable,
  productionHc: number,
  weekDates: string[],
  rules: SchedulingRules,
  patternMeta: PatternScheduleMeta,
  rawPattern: IntervalPatternRow[],
  normalizedPattern: WeekIntervalPattern,
  qualityInputs: SchedulingQualityInputs,
  agentNames: Record<string, string> = {},
  options: {
    vlHc?: number
    applyShrinkage?: BuildSchedulingResultShrinkageOptions
  } = {},
): GeneratedSchedulingPackage {
  const roster = buildWeeklyAgentRoster(
    productionHc,
    weekDates,
    requirementTable.days,
    rules,
    patternMeta,
    rawPattern,
    normalizedPattern,
    { vlHc: options.vlHc },
  )
  const schedulingResultRaw = buildSchedulingResult(
    requirementTable,
    productionHc,
    rules,
    patternMeta,
    roster.assignmentsByDay,
    roster.templatesByDay,
    options.applyShrinkage,
  )
  const weeklyAgentGrid = buildWeeklyAgentScheduleGrid(
    weekDates,
    roster.agentSchedules,
    productionHc,
    roster.agentRestMap,
    patternMeta.workingDays,
    agentNames,
    rules.settings,
  )
  const schedulingResult = enrichSchedulingResult(
    schedulingResultRaw,
    qualityInputs,
    rules.settings.scheduleIntervalMinutes,
  )
  return {
    requirementTable,
    schedulingResult,
    agentSchedules: roster.agentSchedules,
    weeklyAgentGrid,
    productionHc,
    patternMeta,
    metricsMatrix: buildSchedulingMetricsMatrix(schedulingResult, qualityInputs, rules, patternMeta),
    generatedAt: new Date().toISOString(),
    agentNames,
    assignmentsByDay: roster.assignmentsByDay,
  }
}

export function rebuildPackageFromAssignments(
  base: GeneratedSchedulingPackage,
  assignmentsByDay: Record<string, AgentShiftAssignment[]>,
  rules: SchedulingRules,
  qualityInputs: SchedulingQualityInputs,
  agentNames: Record<string, string> = {},
  applyShrinkage?: BuildSchedulingResultShrinkageOptions,
): GeneratedSchedulingPackage {
  const agentSchedules: DayAgentSchedules[] = base.requirementTable.days.map((day) => ({
    day: day.day,
    dateLabel: formatDayLabel(day.day),
    agents: buildAgentSchedulesForDay(assignmentsByDay[day.day] ?? [], rules.shiftTemplates, rules.settings).map(
      (agent) => ({
        ...agent,
        agentLabel: agentLabelForIndex(agent.agentIndex, agentNames),
      }),
    ),
  }))
  const schedulingResultRaw = buildSchedulingResult(
    base.requirementTable,
    base.productionHc,
    rules,
    base.patternMeta,
    assignmentsByDay,
    undefined,
    applyShrinkage,
  )
  const weeklyAgentGrid = buildWeeklyAgentScheduleGrid(
    base.weeklyAgentGrid.weekDates,
    agentSchedules,
    base.productionHc,
    undefined,
    base.patternMeta.workingDays,
    agentNames,
    rules.settings,
  )
  const schedulingResult = enrichSchedulingResult(
    schedulingResultRaw,
    qualityInputs,
    rules.settings.scheduleIntervalMinutes,
  )
  return {
    ...base,
    schedulingResult,
    agentSchedules,
    weeklyAgentGrid,
    metricsMatrix: buildSchedulingMetricsMatrix(schedulingResult, qualityInputs, rules, base.patternMeta),
    generatedAt: new Date().toISOString(),
    agentNames,
    assignmentsByDay,
  }
}

/**
 * Recompute only Net FTE after shrinkage (+ Variance / SL / Occupancy / Staffing %).
 * Scheduled and Net FTE stay exactly as generated — shrinkage must never alter them.
 */
export function reapplyShrinkageToPackage(
  base: GeneratedSchedulingPackage,
  rules: SchedulingRules,
  qualityInputs: SchedulingQualityInputs,
  applyShrinkage?: BuildSchedulingResultShrinkageOptions,
): GeneratedSchedulingPackage {
  const flatPct = applyShrinkage?.flatApplyShrinkagePct ?? 0
  const intervalPctMap = applyShrinkage?.intervalApplyShrinkagePct
  const intervalMinutes = rules.settings.scheduleIntervalMinutes
  const shiftLengthHours = rules.settings.shiftLengthHours
  const fteWeeklyHours = rules.settings.fteWeeklyDivisorHours

  let sumWeekAfterShrinkage = 0
  let totalOver = 0
  let totalUnder = 0

  const days = base.schedulingResult.days.map((day) => {
    if (day.isClosed) return day

    const intervals: IntervalMetricRow[] = day.intervals.map((row) => {
      const netFte = row.netFte ?? 0
      const scheduledFte = row.scheduledFte
      const pct = intervalPctMap?.[day.day]?.[row.interval] ?? flatPct
      const netFteAfterShrinkage = applyShrinkageToNetFte(netFte, pct)
      const variance = netFteAfterShrinkage - row.requiredFte
      return {
        ...row,
        scheduledFte,
        netFte,
        netFteAfterShrinkage,
        variance,
        staffingPct: staffingPct(netFteAfterShrinkage, row.requiredFte),
      }
    })

    const afterShrinkageIntervalSum = sumIntervalMetricRows(
      intervals,
      (row) => row.netFteAfterShrinkage ?? row.netFte ?? 0,
    )
    const productiveIntervalSum = sumIntervalMetricRows(intervals, (row) => row.netFte ?? 0)
    const dailyNetFteBeforeShrinkage = dailyFteFromIntervalMetricRows(
      intervals,
      (row) => row.netFte ?? 0,
      shiftLengthHours,
      intervalMinutes,
    )
    const dailyNetFteTotal = dailyFteFromIntervalMetricRows(
      intervals,
      (row) => row.netFteAfterShrinkage ?? row.netFte ?? 0,
      shiftLengthHours,
      intervalMinutes,
    )
    const overstaffedIntervals = intervals.filter((row) => row.variance > 0.01).length
    const understaffedIntervals = intervals.filter((row) => row.variance < -0.01).length

    sumWeekAfterShrinkage += afterShrinkageIntervalSum
    totalOver += overstaffedIntervals
    totalUnder += understaffedIntervals

    return {
      ...day,
      intervals,
      dailyNetFteBeforeShrinkage,
      dailyNetFteTotal,
      dailyProductiveIntervalSum: productiveIntervalSum,
      dailyNetFteAfterShrinkageIntervalSum: afterShrinkageIntervalSum,
      dailyVariance: dailyNetFteTotal - day.dailyRequiredTotal,
      dailyStaffingPct: staffingPct(dailyNetFteTotal, day.dailyRequiredTotal),
      overstaffedIntervals,
      understaffedIntervals,
    }
  })

  const weeklySumScheduledNetFte = weeklyScheduledFromIntervalSum(
    sumWeekAfterShrinkage,
    fteWeeklyHours,
    intervalMinutes,
  )
  const requiredWeek =
    base.schedulingResult.totals.weeklySumRequired ?? base.schedulingResult.totals.requiredFte

  const schedulingResultRaw: SchedulingResult = {
    ...base.schedulingResult,
    days,
    totals: {
      ...base.schedulingResult.totals,
      scheduledFte: weeklySumScheduledNetFte,
      weeklySumScheduled: weeklySumScheduledNetFte,
      weeklyScheduledIntervalSum: sumWeekAfterShrinkage,
      variance: weeklySumScheduledNetFte - requiredWeek,
      staffingPct: staffingPct(weeklySumScheduledNetFte, requiredWeek),
      overstaffedIntervals: totalOver,
      understaffedIntervals: totalUnder,
    },
  }

  const schedulingResult = enrichSchedulingResult(
    schedulingResultRaw,
    qualityInputs,
    intervalMinutes,
  )

  return {
    ...base,
    schedulingResult,
    metricsMatrix: buildSchedulingMetricsMatrix(
      schedulingResult,
      qualityInputs,
      rules,
      base.patternMeta,
    ),
    generatedAt: new Date().toISOString(),
  }
}

export function updateRequirementCell(
  requirementTable: GeneratedRequirementTable,
  dayIso: string,
  interval: string,
  value: number,
  fteDailyDivisorHours: number,
  intervalMinutes: number,
): GeneratedRequirementTable {
  const days = requirementTable.days.map((day) => {
    if (day.day !== dayIso) return day
    const intervals = { ...day.intervals, [interval]: Math.max(0, value) }
    const dailyFte = dailyFteFromAllIntervalHeadcounts(intervals, fteDailyDivisorHours, intervalMinutes)
    return { ...day, intervals, dailyFte }
  })
  const totals: Record<string, number> = { ...requirementTable.totals }
  totals[interval] = days.reduce((sum, day) => sum + (day.intervals[interval] ?? 0), 0)
  return { ...requirementTable, days, totals }
}

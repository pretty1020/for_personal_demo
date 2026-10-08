import type { DailyFteTargets } from './requirementGeneration'
import { generateIntervalRequirements } from './requirementGeneration'
import { analyzeUploadedPattern } from './patternAnalysis'
import { buildWeekIntervalPattern, reconcilePatternRowsToWeekDates } from './intervalPattern'
import type {
  GeneratedSchedulingPackage,
  IntervalPatternRow,
  SchedulingQualityInputs,
  SchedulingRules,
  WeekIntervalPattern,
} from './types'
import { buildWeeklyAgentScheduleGrid } from './agentScheduleGrid'
import {
  buildSchedulingMetricsMatrix,
  enrichSchedulingResult,
} from './schedulingMetrics'
import { buildSchedulingResult } from './scheduleOptimization'
import { buildWeeklyAgentRoster, type WeeklyRosterOptions } from './weeklyRosterScheduling'
import { buildScheduleDiagnostics } from './scheduleDiagnostics'
import type { ScheduleEngineKind } from './scheduleDiagnostics'
import type { BuildSchedulingResultShrinkageOptions } from './applyShrinkage'

export type BuildSchedulingPackageOptions = WeeklyRosterOptions & {
  teamSupervisor?: string
  engine?: ScheduleEngineKind
  applyShrinkage?: BuildSchedulingResultShrinkageOptions
}

export function buildSchedulingPackage(
  pattern: WeekIntervalPattern,
  weekDates: string[],
  dailyFteTargets: DailyFteTargets,
  weeklyFte: number,
  productionHc: number,
  rules: SchedulingRules,
  rawPattern: IntervalPatternRow[],
  qualityInputs: SchedulingQualityInputs,
  agentNames: Record<string, string> = {},
  options: BuildSchedulingPackageOptions = {},
): GeneratedSchedulingPackage {
  const reconciledRows = reconcilePatternRowsToWeekDates(rawPattern, weekDates)
  const livePattern =
    reconciledRows.length > 0 ? buildWeekIntervalPattern(reconciledRows, weekDates) : pattern
  const patternMeta = analyzeUploadedPattern(reconciledRows, weekDates)
  const hoopByDay = Object.fromEntries(
    Object.entries(patternMeta.hoopByDay).map(([day, hoop]) => [day, hoop.intervals]),
  )

  const requirementTable = generateIntervalRequirements(
    livePattern,
    weekDates,
    dailyFteTargets,
    weeklyFte,
    rules.settings.fteRequiredDailyDivisorHours,
    hoopByDay,
    reconciledRows,
    rules.settings.scheduleIntervalMinutes,
    rules.settings.constraints?.followUploadedPattern,
  )

  const roster = buildWeeklyAgentRoster(
    productionHc,
    weekDates,
    requirementTable.days,
    rules,
    patternMeta,
    reconciledRows,
    livePattern,
    options,
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
    options.agents,
  )

  const schedulingResult = enrichSchedulingResult(
    schedulingResultRaw,
    qualityInputs,
    rules.settings.scheduleIntervalMinutes,
  )
  const engine = options.engine ?? 'typescript'

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
    diagnostics: buildScheduleDiagnostics(requirementTable, schedulingResult, engine),
    teamSupervisor: options.teamSupervisor,
    status: 'draft',
    engine,
    assignmentsByDay: roster.assignmentsByDay,
  }
}

export { buildDayVolumeWeights, resolveWeeklyFte } from './requirementGeneration'
export {
  optimizeShiftStartsForDay,
  optimizeDayAssignments,
  buildSchedulingResult,
  defaultSchedulingRules,
} from './scheduleOptimization'
export { analyzeUploadedPattern } from './patternAnalysis'
export type { PatternScheduleMeta } from './patternAnalysis'

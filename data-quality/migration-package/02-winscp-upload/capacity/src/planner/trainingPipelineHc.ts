import type { PlannerAssumptions } from './types'
import type { StageAttritionOverride } from './capacityStageAttritionPersistence'

export type TrainingPipelineHc = {
  newHires: number
  actualTrainingStart: number
  inTraining: number
  nesting: number
  graduates: number
  trainingAttrition: number
  nestingAttrition: number
  nestingProductiveFte: number
  nestingPhoneTimePct: number
}

export type TrainingPipelineClassStage = 'planned' | 'training' | 'nesting' | 'graduated' | 'production'

export type TrainingPipelineClassCell = {
  periodIndex: number
  stage: TrainingPipelineClassStage
  headcount: number
  phoneTimePct: number | null
}

export type TrainingPipelineClass = {
  id: string
  label: string
  sourcePeriodIndex: number
  startPeriodIndex: number
  plannedNewHire: number
  actualTrainingStart: number
  graduationPeriodIndex: number
  cells: TrainingPipelineClassCell[]
}

export type TrainingPipelineBuildResult = {
  periods: TrainingPipelineHc[]
  classes: TrainingPipelineClass[]
}

type InternalPeriod = TrainingPipelineHc & {
  nestingPhoneWeighted: number
  nestingPhoneDen: number
}

function clampPct(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

function stageWeeklyAttrition(stageRate: number, stageWeeks: number): number {
  if (stageWeeks <= 0) return 0
  const bounded = clampPct(stageRate)
  if (bounded <= 0) return 0
  return 1 - Math.pow(1 - bounded, 1 / stageWeeks)
}

function normalizedTrainingWeeks(a: PlannerAssumptions): number {
  return Math.max(1, Math.round(a.newHire.trainingWeeks))
}

function normalizedNestingWeeks(a: PlannerAssumptions): number {
  const trainingWeeks = normalizedTrainingWeeks(a)
  const configuredNesting = Math.max(1, Math.round(a.newHire.nestingWeeks))
  const configuredGraduation = Math.max(trainingWeeks + configuredNesting, Math.round(a.newHire.graduationWeek))
  return Math.max(configuredNesting, configuredGraduation - trainingWeeks)
}

function actualGraduationWeek(a: PlannerAssumptions): number {
  return normalizedTrainingWeeks(a) + normalizedNestingWeeks(a)
}

export function nestingPhoneTimePctForWeek(a: PlannerAssumptions, nestingWeek: number): number {
  const rampSource = Array.isArray(a.newHire.nestingPhoneTimeRamp) ? a.newHire.nestingPhoneTimeRamp : []
  const ramp = rampSource.map((v) => clampPct(v)).filter((v) => Number.isFinite(v))
  if (!ramp.length) return clampPct(a.newHire.nestingPhoneTimePct)
  return ramp[nestingWeek - 1] ?? ramp[ramp.length - 1] ?? clampPct(a.newHire.nestingPhoneTimePct)
}

export function nestingPhoneTimePctFromClasses(
  classes: TrainingPipelineClass[],
  periodIndex: number,
  assumptions: PlannerAssumptions,
): number {
  let totalHc = 0
  let weighted = 0
  for (const cls of classes) {
    const cell = cls.cells.find((item) => item.periodIndex === periodIndex && item.stage === 'nesting')
    if (!cell || cell.headcount <= 0) continue
    const pct = cell.phoneTimePct ?? nestingPhoneTimePctForWeek(assumptions, 1)
    totalHc += cell.headcount
    weighted += cell.headcount * pct
  }
  if (totalHc <= 0) return clampPct(assumptions.newHire.nestingPhoneTimePct)
  return weighted / totalHc
}

export type CohortStageMaps = {
  training: Map<number, number>[]
  nesting: Map<number, number>[]
}

function trainingStageWeeklyAttrition(
  stageIndex: number,
  assumptions: PlannerAssumptions,
  overrides?: StageAttritionOverride,
): number {
  const override = overrides?.training?.[stageIndex + 1]
  if (override != null && Number.isFinite(override)) {
    return stageWeeklyAttrition(override, 1)
  }
  return stageWeeklyAttrition(assumptions.newHire.trainingAttritionRate, normalizedTrainingWeeks(assumptions))
}

function nestingStageWeeklyAttrition(
  stageIndex: number,
  assumptions: PlannerAssumptions,
  overrides?: StageAttritionOverride,
): number {
  const override = overrides?.nesting?.[stageIndex + 1]
  if (override != null && Number.isFinite(override)) {
    return stageWeeklyAttrition(override, 1)
  }
  return stageWeeklyAttrition(assumptions.newHire.nestingAttritionRate, normalizedNestingWeeks(assumptions))
}

/** Optional calendar-week attrition rates from the capacity matrix. */
export type WeekPipelineAttritionOverrides = {
  weekIsos?: string[]
  ratesByWeek?: Record<string, { trainingAttritionPct?: number | null; nestingAttritionPct?: number | null }>
}

function clampWeeklyAttritionRate(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(0.99, value)
}

function trainingAttritionForPeriod(
  periodIndex: number,
  stageIndex: number,
  assumptions: PlannerAssumptions,
  stageOverrides?: StageAttritionOverride,
  weekOpts?: WeekPipelineAttritionOverrides,
): number {
  const weekIso = weekOpts?.weekIsos?.[periodIndex]
  const weekRate = weekIso != null ? weekOpts?.ratesByWeek?.[weekIso]?.trainingAttritionPct : null
  if (weekRate != null && Number.isFinite(weekRate)) return clampWeeklyAttritionRate(weekRate)
  return trainingStageWeeklyAttrition(stageIndex, assumptions, stageOverrides)
}

function nestingAttritionForPeriod(
  periodIndex: number,
  stageIndex: number,
  assumptions: PlannerAssumptions,
  stageOverrides?: StageAttritionOverride,
  weekOpts?: WeekPipelineAttritionOverrides,
): number {
  const weekIso = weekOpts?.weekIsos?.[periodIndex]
  const weekRate = weekIso != null ? weekOpts?.ratesByWeek?.[weekIso]?.nestingAttritionPct : null
  if (weekRate != null && Number.isFinite(weekRate)) return clampWeeklyAttritionRate(weekRate)
  return nestingStageWeeklyAttrition(stageIndex, assumptions, stageOverrides)
}

export function buildCohortStageMaps(
  weeklyStarts: number[],
  assumptions: PlannerAssumptions,
  stageAttritionOverrides?: StageAttritionOverride,
  weekOpts?: WeekPipelineAttritionOverrides,
): CohortStageMaps {
  const trainingWeeks = Math.max(1, Math.round(assumptions.newHire.trainingWeeks))
  const nestingWeeks = Math.max(1, Math.round(assumptions.newHire.nestingWeeks))
  const training = Array.from({ length: trainingWeeks }, () => new Map<number, number>())
  const nesting = Array.from({ length: nestingWeeks }, () => new Map<number, number>())

  weeklyStarts.forEach((startHc, startIndex) => {
    const weeklyStartHc = Math.max(0, Math.round(startHc))
    if (weeklyStartHc <= 0) return
    let cohort = weeklyStartHc
    for (let stage = 0; stage < trainingWeeks; stage++) {
      const targetIndex = startIndex + stage
      if (targetIndex >= weeklyStarts.length) break
      training[stage]!.set(targetIndex, (training[stage]!.get(targetIndex) ?? 0) + Math.round(cohort))
      cohort *= 1 - trainingAttritionForPeriod(targetIndex, stage, assumptions, stageAttritionOverrides, weekOpts)
    }
    for (let stage = 0; stage < nestingWeeks; stage++) {
      const targetIndex = startIndex + trainingWeeks + stage
      if (targetIndex >= weeklyStarts.length) break
      nesting[stage]!.set(targetIndex, (nesting[stage]!.get(targetIndex) ?? 0) + Math.round(cohort))
      cohort *= 1 - nestingAttritionForPeriod(targetIndex, stage, assumptions, stageAttritionOverrides, weekOpts)
    }
  })
  return { training, nesting }
}

export function sumStageHcAt(stages: Map<number, number>[], periodIndex: number): number {
  return stages.reduce((sum, map) => sum + (map.get(periodIndex) ?? 0), 0)
}

export function finalNestingStageHcAt(nestingStages: Map<number, number>[], periodIndex: number): number {
  if (!nestingStages.length || periodIndex < 0) return 0
  return Math.max(0, nestingStages[nestingStages.length - 1]!.get(periodIndex) ?? 0)
}

export function nestingPhoneTimeFromStageMaps(
  nestingStages: Map<number, number>[],
  periodIndex: number,
  assumptions: PlannerAssumptions,
): number {
  let totalHc = 0
  let weighted = 0
  nestingStages.forEach((map, stageIndex) => {
    const hc = map.get(periodIndex) ?? 0
    if (hc <= 0) return
    const pct = nestingPhoneTimePctForWeek(assumptions, stageIndex + 1)
    totalHc += hc
    weighted += hc * pct
  })
  if (totalHc <= 0) return clampPct(assumptions.newHire.nestingPhoneTimePct)
  return weighted / totalHc
}

function emptyPeriod(): InternalPeriod {
  return {
    newHires: 0,
    actualTrainingStart: 0,
    inTraining: 0,
    nesting: 0,
    graduates: 0,
    trainingAttrition: 0,
    nestingAttrition: 0,
    nestingProductiveFte: 0,
    nestingPhoneTimePct: 0,
    nestingPhoneWeighted: 0,
    nestingPhoneDen: 0,
  }
}

function stageHeadcountAtAge(
  startingHeadcount: number,
  age: number,
  assumptions: PlannerAssumptions,
  stageAttritionOverrides?: StageAttritionOverride,
  startPeriodIndex = 0,
  weekOpts?: WeekPipelineAttritionOverrides,
): { headcount: number; trainingAttrition: number; nestingAttrition: number; stage: TrainingPipelineClassStage; phoneTimePct: number | null } {
  const trainingWeeks = normalizedTrainingWeeks(assumptions)
  const graduationWeek = actualGraduationWeek(assumptions)

  let headcount = startingHeadcount
  for (let week = 0; week < age; week++) {
    const periodIndex = startPeriodIndex + week
    if (week < trainingWeeks) {
      headcount *= 1 - trainingAttritionForPeriod(periodIndex, week, assumptions, stageAttritionOverrides, weekOpts)
    } else if (week < graduationWeek) {
      headcount *=
        1 -
        nestingAttritionForPeriod(
          periodIndex,
          week - trainingWeeks,
          assumptions,
          stageAttritionOverrides,
          weekOpts,
        )
    }
  }

  const currentPeriodIndex = startPeriodIndex + age
  if (age < trainingWeeks) {
    const trainingWeeklyAttr = trainingAttritionForPeriod(
      currentPeriodIndex,
      age,
      assumptions,
      stageAttritionOverrides,
      weekOpts,
    )
    return {
      headcount,
      trainingAttrition: headcount * trainingWeeklyAttr,
      nestingAttrition: 0,
      stage: 'training',
      phoneTimePct: null,
    }
  }
  if (age < graduationWeek) {
    const nestingWeek = age - trainingWeeks
    const nestingWeeklyAttr = nestingAttritionForPeriod(
      currentPeriodIndex,
      nestingWeek,
      assumptions,
      stageAttritionOverrides,
      weekOpts,
    )
    return {
      headcount,
      trainingAttrition: 0,
      nestingAttrition: headcount * nestingWeeklyAttr,
      stage: 'nesting',
      phoneTimePct: nestingPhoneTimePctForWeek(assumptions, nestingWeek + 1),
    }
  }
  if (age === graduationWeek) {
    return {
      headcount,
      trainingAttrition: 0,
      nestingAttrition: 0,
      stage: 'graduated',
      phoneTimePct: 1,
    }
  }
  return {
    headcount,
    trainingAttrition: 0,
    nestingAttrition: 0,
    stage: 'production',
    phoneTimePct: 1,
  }
}

export function buildTrainingPipeline(
  hiringPlannedByPeriod: number[],
  assumptions: PlannerAssumptions,
  stageAttritionOverrides?: StageAttritionOverride,
  weekOpts?: WeekPipelineAttritionOverrides,
): TrainingPipelineBuildResult {
  const horizon = hiringPlannedByPeriod.length
  const periods: InternalPeriod[] = Array.from({ length: horizon }, emptyPeriod)
  const classes: TrainingPipelineClass[] = []
  const delay = Math.max(0, Math.round(assumptions.newHire.hiringDelayWeeks))
  const graduationWeek = actualGraduationWeek(assumptions)

  for (let sourcePeriodIndex = 0; sourcePeriodIndex < horizon; sourcePeriodIndex++) {
    const plannedNewHire = Math.max(0, Math.round(hiringPlannedByPeriod[sourcePeriodIndex] ?? 0))
    if (!plannedNewHire) continue

    periods[sourcePeriodIndex]!.newHires += plannedNewHire
    const startPeriodIndex = sourcePeriodIndex + delay
    if (startPeriodIndex < horizon) {
      periods[startPeriodIndex]!.actualTrainingStart += plannedNewHire
    }

    const cells: TrainingPipelineClassCell[] = []
    for (let periodIndex = sourcePeriodIndex; periodIndex < horizon; periodIndex++) {
      if (periodIndex < startPeriodIndex) {
        cells.push({
          periodIndex,
          stage: 'planned',
          headcount: plannedNewHire,
          phoneTimePct: null,
        })
        continue
      }

      const age = periodIndex - startPeriodIndex
      const stageState = stageHeadcountAtAge(
        plannedNewHire,
        age,
        assumptions,
        stageAttritionOverrides,
        startPeriodIndex,
        weekOpts,
      )
      cells.push({
        periodIndex,
        stage: stageState.stage,
        headcount: stageState.headcount,
        phoneTimePct: stageState.phoneTimePct,
      })

      const bucket = periods[periodIndex]
      if (!bucket) continue
      if (stageState.stage === 'training') {
        bucket.inTraining += stageState.headcount
        bucket.trainingAttrition += stageState.trainingAttrition
      } else if (stageState.stage === 'nesting') {
        bucket.nesting += stageState.headcount
        bucket.nestingAttrition += stageState.nestingAttrition
        const phonePct = stageState.phoneTimePct ?? clampPct(assumptions.newHire.nestingPhoneTimePct)
        bucket.nestingProductiveFte += stageState.headcount * phonePct
        bucket.nestingPhoneWeighted += stageState.headcount * phonePct
        bucket.nestingPhoneDen += stageState.headcount
      } else if (stageState.stage === 'graduated') {
        bucket.graduates += stageState.headcount
      }
    }

    classes.push({
      id: `class-${sourcePeriodIndex}`,
      label: `Class ${sourcePeriodIndex + 1}`,
      sourcePeriodIndex,
      startPeriodIndex,
      plannedNewHire,
      actualTrainingStart: plannedNewHire,
      graduationPeriodIndex: startPeriodIndex + graduationWeek,
      cells,
    })
  }

  return {
    periods: periods.map((period) => ({
      newHires: period.newHires,
      actualTrainingStart: period.actualTrainingStart,
      inTraining: period.inTraining,
      nesting: period.nesting,
      graduates: period.graduates,
      trainingAttrition: period.trainingAttrition,
      nestingAttrition: period.nestingAttrition,
      nestingProductiveFte: period.nestingProductiveFte,
      nestingPhoneTimePct: period.nestingPhoneDen > 0 ? period.nestingPhoneWeighted / period.nestingPhoneDen : 0,
    })),
    classes,
  }
}

/**
 * Single-period helper used by Capacity Plan fallback aggregations.
 * Ignores hiring delay so a single weekly class can still populate training / nesting cards.
 */
export function trainingPipelineHc(hiringPlanned: number, assumptions?: PlannerAssumptions): TrainingPipelineHc {
  const assumed = assumptions
  if (!assumed) {
    return {
      newHires: Math.max(0, Math.round(hiringPlanned)),
      actualTrainingStart: Math.max(0, Math.round(hiringPlanned)),
      inTraining: 0,
      nesting: 0,
      graduates: 0,
      trainingAttrition: 0,
      nestingAttrition: 0,
      nestingProductiveFte: 0,
      nestingPhoneTimePct: 0,
    }
  }
  const inlineAssumptions: PlannerAssumptions = {
    ...assumed,
    newHire: {
      ...assumed.newHire,
      hiringDelayWeeks: 0,
    },
  }
  return buildTrainingPipeline([Math.max(0, Math.round(hiringPlanned))], inlineAssumptions).periods[0] ?? emptyPeriod()
}

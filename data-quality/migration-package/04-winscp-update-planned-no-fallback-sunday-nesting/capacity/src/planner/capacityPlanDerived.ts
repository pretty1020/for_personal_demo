import * as XLSX from 'xlsx'
import {
  buildCohortStageMaps,
  buildTrainingPipeline,
  nestingPhoneTimeFromStageMaps,
  sumStageHcAt,
  finalNestingStageHcAt,
} from './trainingPipelineHc'
import type { AhtAnalysisOverrides } from './ahtAnalysisPersistence'
import type { ScenarioForecastPackage } from './forecasting'
import { SHRINKAGE_FORECAST_METRIC_IDS } from './forecastPersistence'
import type { PlannerAssumptions, PlannerPlanMetadata, PlannerScenario } from './types'
import type { WeekCapacityPlanOverride } from './capacityPlanOverridePersistence'
import { sumSupportRoleValues } from './supportRoles'
import type { StageAttritionOverride } from './capacityStageAttritionPersistence'
import type { LedgerMetricSnapshot, WeeklyLedgerRow } from './weeklyLedger'
import {
  DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS,
  isShrinkageCategoryVisible,
  resolveActiveShrinkageCategoryIds,
} from './shrinkageCategories'
import { resolveCapacityPlanStartWeek, resolveCapacityWeekStatus, resolveCurrentCalendarWeek } from './capacityWeekUtils'
import { getTotalStartingProductionHc } from './channelPlanning'
import {
  calculateWorkloadRequiredProductionFte,
  resolveMatrixConcurrencyFactor,
  resolveRequiredProductionFteForPlan,
  shouldPreferChannelRequiredFte,
} from './requiredProductionFte'
import { isFteBillingPlan } from '../utils/staffingCapacity/billingModel'
import type { RosterEmployee } from './rosterPersistence'
import { DEMO_NESTING_AHT_MULTIPLIER, NESTING_MIX_AMPLIFIER } from './demoHistoricalSeries'

const WEEKS_PER_MONTH = 4.33

/** Structural AHT premium for nesting agents vs production-only handle time. */
export const DEFAULT_NESTING_AHT_MULTIPLIER = DEMO_NESTING_AHT_MULTIPLIER
export { NESTING_MIX_AMPLIFIER }
const MIN_RELIABLE_NESTING_MULTIPLIER = 1.12

export function nestingMixAmplifiedShare(nestingHc: number, productionHc: number): number {
  const total = Math.max(1, nestingHc + productionHc)
  return Math.min(1, (nestingHc / total) * NESTING_MIX_AMPLIFIER)
}

export function nestingMixInflationFactor(
  nestingHc: number,
  productionHc: number,
  nestingMultiplier = DEFAULT_NESTING_AHT_MULTIPLIER,
): number {
  const amplifiedShare = nestingMixAmplifiedShare(nestingHc, productionHc)
  return 1 + (nestingMultiplier - 1) * amplifiedShare
}

export type CapacityMetricSnapshot = {
  beginningProductionHc: number
  plannedNewHires: number
  actualTrainingStartHc: number
  trainingHc: number
  nestingHc: number
  graduateHc: number
  trainingAttritionHc: number
  nestingAttritionHc: number
  attritionHc: number
  attritionPct: number | null
  trainingAttritionPct: number | null
  nestingAttritionPct: number | null
  transferInHc: number
  transferOutHc: number
  offRosterLoaHc: number
  supportHc: number
  supportHcByRole?: Record<string, number>
  plannedSeats?: number
  peakRatio?: number | null
  seatsVariance?: number | null
  volume: number
  offeredVolume: number
  handledVolume: number | null
  ahtSeconds: number | null
  cappedAhtSeconds: number | null
  occupancy: number
  shrinkagePct: number
  nestingPhoneTimePct: number
  productionHc: number
  requiredFte: number | null
  coreProductionFte: number
  nestingProductiveFte: number
  productionFte: number
  staffingPct: number | null
  overUnderFte: number
  scheduledBillableHours: number | null
  actualBillableHours: number | null
  productiveHours: number | null
  payrollHours: number | null
  switchHours: number | null
}

export type DerivedCapacityRow = {
  periodIndex: number
  week: string
  timeline: 'historical_actual' | 'forward_plan'
  statusLabel: 'Actual' | 'Planned'
  isCurrentPlanningWeek: boolean
  planned: CapacityMetricSnapshot
  actual: CapacityMetricSnapshot
  /** Category-level shrinkage for leakage (Non-Billable overages only). */
  shrinkageCategories?: Array<{
    id: string
    name: string
    group: 'out_of_office' | 'in_office'
    billable: boolean
    plannedPct: number
    actualPct: number | null
  }>
  /**
   * When rows from several LOBs are combined, group totals are the AVERAGE of each
   * LOB's group sum — not the sum of every distinct category id (which inflates %).
   */
  combinedGroupShrinkage?: {
    outOfOfficePlanned: number | null
    outOfOfficeActual: number | null
    inOfficePlanned: number | null
    inOfficeActual: number | null
  }
  forecastModelVolume?: string
  forecastModelAht?: string
  forecastModelShrinkage?: string
  forecastModelAttrition?: string
}

export type CapacityForecastMode = 'forecast' | 'manual' | 'previous_week'

function defaultCapacityForecastMode(metricId: string): CapacityForecastMode {
  if (metricId === 'occupancy' || metricId === 'ahtSeconds') return 'manual'
  if (metricId.startsWith('custom_')) return 'previous_week'
  if (
    metricId === 'callVolume' ||
    metricId === 'totalShrinkagePct' ||
    metricId === 'attritionHc' ||
    SHRINKAGE_FORECAST_METRIC_IDS.includes(metricId as (typeof SHRINKAGE_FORECAST_METRIC_IDS)[number])
  ) {
    return 'forecast'
  }
  return 'manual'
}

function resolvedCapacityForecastMode(
  forecastModes: Partial<Record<string, CapacityForecastMode>>,
  metricId: string,
): CapacityForecastMode {
  return forecastModes[metricId] ?? defaultCapacityForecastMode(metricId)
}

type ClientSheet = {
  scenario: PlannerScenario
  rows: DerivedCapacityRow[]
}

type ForecastMetricPointer = {
  value: number | null
  model: string | null
}

type RowInput = {
  week: string
  timeline: DerivedCapacityRow['timeline']
  volume: number
  handledVolume: number | null
  ahtSeconds: number | null
  cappedAhtSeconds: number | null
  occupancy: number
  shrinkagePct: number
  plannedNewHires: number
  attritionHc: number
  transferInHc: number
  transferOutHc: number
  offRosterLoaHc: number
  supportHc: number
  beginningProductionHc: number | null
  graduateHc: number | null
  shrinkageCategoryValues: Record<string, number>
  forecastModelVolume?: string
  forecastModelAht?: string
  forecastModelShrinkage?: string
  forecastModelAttrition?: string
}

function metricValue(forecast: ScenarioForecastPackage | null, metricId: string, index: number): ForecastMetricPointer {
  const metric = forecast?.metrics.find((item) => item.metricId === metricId)
  if (!metric) return { value: null, model: null }
  return {
    value: metric.forecast[index]?.value ?? null,
    model: metric.selectedModel?.label ?? null,
  }
}

function clampRate(value: number): number {
  return Math.max(0, Math.min(1.25, value))
}

function clampOccupancy(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function clampPlannedOccupancy(value: number): number {
  return Math.max(0, Math.min(0.999, value))
}

function requiredFte(
  volume: number,
  ahtSeconds: number,
  occupancyTarget: number,
  standardHours: number,
  concurrency = 1,
): number | null {
  return calculateWorkloadRequiredProductionFte({
    volume,
    ahtSeconds,
    productiveSeconds: standardHours * 3600,
    occupancy: occupancyTarget,
    concurrency,
  })
}

/**
 * Resolve Required Production FTE for a matrix week.
 * - FTE billing: manual override only
 * - Channel / Chat / Transactional plans: channel formulas using that week’s Volume, AHT/processing time,
 *   Occupancy, and channel concurrency (Chat/SMS) or backlog/rework adjustments
 * - Fallback: (Volume × AHT) ÷ (Productive Seconds × Occupancy × Concurrency)
 */
function resolvePlannedRequiredFteOverride(
  plan: PlannerPlanMetadata,
  assumptions: import('./types').PlannerAssumptions,
  weeklyVolume: number,
  ledgerRequiredFte: number | null,
  weeklyDrivers?: {
    ahtSeconds?: number | null
    occupancy?: number | null
    cappedAhtSeconds?: number | null
  },
  unlockManualRequiredFte = false,
): { value: number | null; skipMatrixFallback: boolean } {
  const manual =
    ledgerRequiredFte != null && Number.isFinite(ledgerRequiredFte) && ledgerRequiredFte >= 0
      ? ledgerRequiredFte
      : null

  // FTE billing or unlocked Required: manual entry only — never invent from Volume/AHT/Occupancy.
  if (isFteBillingPlan(plan.billingType) || unlockManualRequiredFte) {
    return { value: manual, skipMatrixFallback: true }
  }

  // True zero demand → Required FTE is 0 (keep a persisted override if present).
  if (!(weeklyVolume > 0)) {
    return { value: manual ?? 0, skipMatrixFallback: true }
  }

  if (shouldPreferChannelRequiredFte(plan, assumptions)) {
    const channelRequired = resolveRequiredProductionFteForPlan(assumptions, plan, weeklyVolume, {
      volume: weeklyVolume,
      ahtSeconds: weeklyDrivers?.ahtSeconds,
      occupancy: weeklyDrivers?.occupancy,
      cappedAhtSeconds: weeklyDrivers?.cappedAhtSeconds,
    })
    // Only trust a positive channel result. Zero/null with positive volume means incomplete
    // channel setup — fall through to persisted override, then matrix Volume × AHT ÷ Occupancy.
    if (channelRequired != null && channelRequired > 0) {
      return { value: channelRequired, skipMatrixFallback: true }
    }
  }

  // Persist wins when recompute cannot produce a value (common after refresh if drivers
  // have not hydrated yet). Values come from staffing_plan.required_production_fte / overrides.
  if (manual != null) {
    return { value: manual, skipMatrixFallback: true }
  }

  return { value: null, skipMatrixFallback: false }
}

function handledVolume(
  volume: number,
  productionFte: number,
  ahtSeconds: number | null,
  occupancy: number,
  standardHours: number,
  concurrency = 1,
): number | null {
  if (ahtSeconds == null || ahtSeconds <= 0) return null
  const safeConcurrency = concurrency >= 1 ? concurrency : 1
  const capacityContacts =
    (productionFte * standardHours * 3600 * occupancy * safeConcurrency) / ahtSeconds
  return Math.max(0, Math.min(volume, capacityContacts))
}

export type HistoricalAhtAnalysis = {
  productionOnlyAht: number | null
  withNestingAht: number | null
  nestingMultiplier: number
  learningCurveWeeklyImprovementPct: number
  historicalAvgNestingHc: number
  historicalAvgProductionHc: number
  weeksProductionOnly: number
  weeksWithNesting: number
}

export type CapacityWeekHeadcount = {
  week: string
  timeline: DerivedCapacityRow['timeline']
  productionHc: number
  nestingHc: number
  trainingHc: number
  actualAhtSeconds: number | null
  plannedProductionHc: number
  plannedNestingHc: number
  plannedAhtSeconds: number | null
}

export function findCapacityRowByWeek(
  rows: DerivedCapacityRow[],
  week: string,
): DerivedCapacityRow | undefined {
  return rows.find((row) => row.week === week)
}

export function capacityWeekHeadcount(row: DerivedCapacityRow): CapacityWeekHeadcount {
  return {
    week: row.week,
    timeline: row.timeline,
    productionHc: row.actual.productionHc,
    nestingHc: row.actual.nestingHc,
    trainingHc: row.actual.trainingHc,
    actualAhtSeconds: row.actual.ahtSeconds,
    plannedProductionHc: row.planned.productionHc,
    plannedNestingHc: row.planned.nestingHc,
    plannedAhtSeconds: row.planned.ahtSeconds,
  }
}

export function capacityHeadcountByWeek(rows: DerivedCapacityRow[]): Map<string, CapacityWeekHeadcount> {
  return new Map(rows.map((row) => [row.week, capacityWeekHeadcount(row)]))
}

function ledgerHeadcount(
  row: WeeklyLedgerRow,
  field: 'productionHc' | 'nestingHc' | 'trainingHc',
): number | null {
  const actual = row.actual?.[field]
  if (actual != null && Number.isFinite(actual)) return actual
  const planned = row.planned[field]
  if (planned != null && Number.isFinite(planned)) return planned
  return null
}

export function countInactiveProductionRoster(
  roster: RosterEmployee[],
  planningWeek: string | null,
): number {
  if (!planningWeek) return 0
  return roster.filter(
    (employee) =>
      employee.status !== 'active' &&
      employee.productionDate &&
      employee.productionDate <= planningWeek,
  ).length
}

export function applyAhtAnalysisOverrides(
  analysis: HistoricalAhtAnalysis,
  overrides?: AhtAnalysisOverrides | null,
): HistoricalAhtAnalysis {
  if (!overrides) return analysis
  return {
    ...analysis,
    nestingMultiplier: overrides.nestingMultiplier ?? analysis.nestingMultiplier,
    learningCurveWeeklyImprovementPct:
      overrides.learningCurveWeeklyImprovementPct ?? analysis.learningCurveWeeklyImprovementPct,
  }
}

export function analyzeHistoricalAhtMix(
  rows: WeeklyLedgerRow[],
  capacityRows: DerivedCapacityRow[] = [],
): HistoricalAhtAnalysis {
  const capByWeek = capacityHeadcountByWeek(capacityRows)
  const structuralMultiplier = DEFAULT_NESTING_AHT_MULTIPLIER
  const productionOnlyRawAhts: number[] = []
  const productionEquivalentAhts: number[] = []
  const nestingHeavyRawAhts: number[] = []
  const lightNestingRawAhts: number[] = []
  const nestingHcs: number[] = []
  const productionHcs: number[] = []
  let weeksWithNesting = 0
  let weeksProductionOnly = 0

  rows.forEach((row) => {
    if (row.timeline !== 'historical_actual') return
    const cap = capByWeek.get(row.week)
    const aht = cap?.actualAhtSeconds ?? row.actual?.ahtSeconds
    if (aht == null || !Number.isFinite(aht)) return

    const nestingHc = cap?.nestingHc ?? ledgerHeadcount(row, 'nestingHc') ?? 0
    const trainingHc = cap?.trainingHc ?? ledgerHeadcount(row, 'trainingHc') ?? 0
    const productionHc = cap?.productionHc ?? ledgerHeadcount(row, 'productionHc') ?? 0
    const nestingShare = nestingHc / Math.max(1, nestingHc + productionHc)

    if (nestingHc > 0) {
      weeksWithNesting += 1
      nestingHcs.push(nestingHc)
      productionHcs.push(productionHc)
      const productionEquivalent = productionEquivalentAhtSeconds(aht, nestingHc, productionHc, {
        nestingMultiplier: structuralMultiplier,
        learningCurveWeeklyImprovementPct: 0,
      })
      productionEquivalentAhts.push(productionEquivalent)
      if (nestingShare >= 0.15) nestingHeavyRawAhts.push(aht)
      else lightNestingRawAhts.push(aht)
    } else if (trainingHc <= 0) {
      weeksProductionOnly += 1
      productionOnlyRawAhts.push(aht)
      productionEquivalentAhts.push(aht)
      productionHcs.push(productionHc)
    }
  })

  const average = (values: number[]): number | null =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null

  const productionOnlyAht = average(productionEquivalentAhts) ?? average(productionOnlyRawAhts)
  const heavyAvg = average(nestingHeavyRawAhts)
  const lightAvg = average(lightNestingRawAhts)
  let observedMultiplier = structuralMultiplier
  if (productionOnlyAht != null && productionOnlyAht > 0 && heavyAvg != null) {
    const heavyEquivalent = productionEquivalentAhtSeconds(
      heavyAvg,
      Math.max(1, average(nestingHcs) ?? 1),
      Math.max(1, average(productionHcs) ?? 1),
      { nestingMultiplier: structuralMultiplier, learningCurveWeeklyImprovementPct: 0 },
    )
    if (heavyEquivalent > 0) {
      observedMultiplier = heavyAvg / heavyEquivalent
    }
  }
  const nestingMultiplier =
    observedMultiplier >= MIN_RELIABLE_NESTING_MULTIPLIER ? observedMultiplier : structuralMultiplier
  const withNestingAht =
    productionOnlyAht != null ? productionOnlyAht * nestingMultiplier : average(nestingHeavyRawAhts)

  let learningCurveWeeklyImprovementPct = 0.02
  if (heavyAvg != null && lightAvg != null && heavyAvg > 0) {
    const improvement = (heavyAvg - lightAvg) / heavyAvg
    learningCurveWeeklyImprovementPct = Math.max(0, Math.min(0.08, improvement / 3))
  }

  return {
    productionOnlyAht,
    withNestingAht,
    nestingMultiplier,
    learningCurveWeeklyImprovementPct,
    historicalAvgNestingHc: average(nestingHcs) ?? 0,
    historicalAvgProductionHc: average(productionHcs) ?? 0,
    weeksProductionOnly,
    weeksWithNesting,
  }
}

export function plannedAhtFromNestingMix(
  baseForecastAht: number,
  nestingHc: number,
  productionHc: number,
  analysis?: HistoricalAhtAnalysis | null,
  tenuredBaseAht?: number,
): number {
  const base = Math.max(1, baseForecastAht)
  const multiplier = analysis?.nestingMultiplier ?? DEFAULT_NESTING_AHT_MULTIPLIER
  const prodOnlyBenchmark =
    analysis?.productionOnlyAht ?? tenuredBaseAht ?? base / multiplier
  const withNestingBenchmark =
    analysis?.withNestingAht ?? prodOnlyBenchmark * multiplier

  if (nestingHc <= 0) {
    return Math.round(base * 10) / 10
  }

  const amplifiedShare = nestingMixAmplifiedShare(nestingHc, productionHc)
  const avgNestingHc = Math.max(1, analysis?.historicalAvgNestingHc ?? 10)
  const nestingIntensity = Math.min(1.75, nestingHc / avgNestingHc)
  const effectiveShare = Math.min(1, amplifiedShare * (0.65 + 0.35 * nestingIntensity))

  const trendScale = prodOnlyBenchmark > 0 ? base / prodOnlyBenchmark : 1
  const productionTrackAht = base
  const nestingTrackAht = withNestingBenchmark * trendScale
  const blended = productionTrackAht * (1 - effectiveShare) + nestingTrackAht * effectiveShare

  const learningPct = analysis?.learningCurveWeeklyImprovementPct ?? 0.02
  const learningReduction = learningPct * effectiveShare * 0.2

  return Math.round(blended * (1 - learningReduction) * 10) / 10
}

/** Normalize measured AHT to production-equivalent (removes nesting cohort inflation). */
export function productionEquivalentAhtSeconds(
  rawAhtSeconds: number,
  nestingHc: number,
  productionHc: number,
  analysis?: HistoricalAhtAnalysis | Pick<HistoricalAhtAnalysis, 'nestingMultiplier' | 'learningCurveWeeklyImprovementPct'> | null,
): number {
  const raw = Math.max(1, rawAhtSeconds)
  if (nestingHc <= 0) return Math.round(raw * 10) / 10

  const multiplier = analysis?.nestingMultiplier ?? DEFAULT_NESTING_AHT_MULTIPLIER
  const mixInflation = nestingMixInflationFactor(nestingHc, productionHc, multiplier)
  const nestingShare = nestingHc / Math.max(1, nestingHc + productionHc)
  const learningPct = analysis?.learningCurveWeeklyImprovementPct ?? 0.02
  const learningOffset = learningPct * nestingShare * 0.15

  return Math.round((raw / mixInflation) * (1 - learningOffset) * 10) / 10
}

export function tenureAdjustedAhtSeconds(
  baseAhtSeconds: number,
  nestingHc: number,
  productionHc: number,
  analysis?: HistoricalAhtAnalysis | null,
  options?: { inferNestingWhenZero?: boolean },
): number {
  if (options?.inferNestingWhenZero === false) {
    return productionEquivalentAhtSeconds(baseAhtSeconds, nestingHc, productionHc, analysis)
  }
  const normalizedBase = Math.max(1, baseAhtSeconds)
  const nestingMultiplier = analysis?.nestingMultiplier ?? DEFAULT_NESTING_AHT_MULTIPLIER
  const effectiveNestingHc =
    nestingHc > 0 ? nestingHc : (analysis?.historicalAvgNestingHc ?? 0)
  const effectiveProductionHc = productionHc > 0 ? productionHc : (analysis?.historicalAvgProductionHc ?? 0)
  const total = Math.max(1, effectiveNestingHc + effectiveProductionHc)
  const nestingShare = effectiveNestingHc / total
  const mixFactor = (effectiveNestingHc * nestingMultiplier + effectiveProductionHc) / total
  const learningReduction = (analysis?.learningCurveWeeklyImprovementPct ?? 0.02) * nestingShare
  return normalizedBase * mixFactor * (1 - learningReduction)
}

function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null
  return numerator / denominator
}

function roundedWhole(value: number): number {
  return Math.round(value)
}

function actualDriver(
  source: number | null | undefined,
  _fallback: number,
  _seed: number,
  _token: string,
  _higherIsBetter: boolean,
): number {
  if (source != null && Number.isFinite(source)) return source
  // Never invent actuals from planned values or assumptions.
  return 0
}

function resolveHistoricalHeadcount(
  row: WeeklyLedgerRow,
  field: 'trainingHc' | 'nestingHc' | 'productionHc',
  _fallback: number,
): number {
  if (row.timeline !== 'historical_actual') return 0
  const fromLedger = row.actual?.[field]
  if (fromLedger != null && Number.isFinite(fromLedger)) return roundedWhole(fromLedger)
  return 0
}

function pipelineAssumptionsForActuals(assumptions: PlannerAssumptions): PlannerAssumptions {
  return {
    ...assumptions,
    newHire: {
      ...assumptions.newHire,
      hiringDelayWeeks: 0,
    },
  }
}

function buildSnapshot(
  beginningProductionHc: number,
  plannedNewHires: number,
  actualTrainingStartHc: number,
  trainingAttritionHc: number,
  nestingAttritionHc: number,
  attritionHc: number,
  transferInHc: number,
  transferOutHc: number,
  offRosterLoaHc: number,
  volume: number,
  offeredVolume: number,
  ahtSeconds: number | null,
  cappedAhtSeconds: number | null,
  occupancy: number,
  shrinkagePct: number,
  trainingHc: number,
  nestingHc: number,
  graduateHc: number,
  nestingPhoneTimePct: number,
  _nestingProductiveFte: number,
  standardHours: number,
  handledVolumeOverride: number | null = null,
  overrides?: {
    trainingHc?: number | null
    nestingHc?: number | null
    productionHc?: number | null
    supportHc?: number | null
  },
  requiredFteOverride?: number | null,
  /** When true, do not fall back to voice-style volume/AHT/occ Required FTE. */
  skipMatrixRequiredFteFallback = false,
  /** Chat/SMS concurrency for matrix fallback Required Production FTE. */
  concurrencyFactor = 1,
): CapacityMetricSnapshot {
  const normalizedBeginningProductionHc = roundedWhole(beginningProductionHc)
  const normalizedPlannedNewHires = roundedWhole(plannedNewHires)
  const normalizedActualTrainingStartHc = roundedWhole(actualTrainingStartHc)
  const normalizedTrainingAttritionHc = roundedWhole(trainingAttritionHc)
  const normalizedNestingAttritionHc = roundedWhole(nestingAttritionHc)
  const normalizedAttritionHc = roundedWhole(attritionHc)
  const normalizedTransferInHc = roundedWhole(transferInHc)
  const normalizedTransferOutHc = roundedWhole(transferOutHc)
  const normalizedOffRosterLoaHc = roundedWhole(offRosterLoaHc)
  const normalizedTrainingHc = roundedWhole(overrides?.trainingHc ?? trainingHc)
  const normalizedNestingHc = roundedWhole(overrides?.nestingHc ?? nestingHc)
  const normalizedGraduateHc = roundedWhole(graduateHc)
  const normalizedOccupancy = clampOccupancy(occupancy)
  const normalizedShrinkagePct = clampRate(shrinkagePct)
  const normalizedNestingPhoneTimePct = clampOccupancy(nestingPhoneTimePct)
  const resolvedAht = ahtSeconds != null && Number.isFinite(ahtSeconds) ? ahtSeconds : null
  const resolvedCap =
    cappedAhtSeconds != null && Number.isFinite(cappedAhtSeconds)
      ? cappedAhtSeconds
      : resolvedAht
  const effectiveAht =
    resolvedAht != null && resolvedCap != null
      ? Math.max(1, Math.min(resolvedAht, resolvedCap || resolvedAht))
      : resolvedAht ?? resolvedCap
  const productionHc = Math.max(
    0,
    roundedWhole(
      overrides?.productionHc ??
        (normalizedBeginningProductionHc +
          normalizedGraduateHc +
          normalizedTransferInHc -
          normalizedAttritionHc -
          normalizedTransferOutHc -
          normalizedOffRosterLoaHc),
    ),
  )
  const required =
    requiredFteOverride != null && Number.isFinite(requiredFteOverride) && requiredFteOverride >= 0
      ? requiredFteOverride
      : skipMatrixRequiredFteFallback
        ? null
        : effectiveAht != null &&
            effectiveAht > 0 &&
            volume > 0 &&
            normalizedOccupancy > 0
          ? requiredFte(volume, effectiveAht, normalizedOccupancy, standardHours, concurrencyFactor)
          : null
  const coreProductionFte = productionHc * (1 - normalizedShrinkagePct)
  const normalizedNestingProductiveFte = normalizedNestingHc * normalizedNestingPhoneTimePct
  const productionFte = coreProductionFte + normalizedNestingProductiveFte
  const computedHandled =
    effectiveAht != null
      ? handledVolume(
          offeredVolume,
          productionFte,
          effectiveAht,
          normalizedOccupancy,
          standardHours,
          concurrencyFactor,
        )
      : null
  const handled =
    handledVolumeOverride != null
      ? roundedWhole(handledVolumeOverride)
      : computedHandled != null
        ? roundedWhole(computedHandled)
        : null
  return {
    beginningProductionHc: normalizedBeginningProductionHc,
    plannedNewHires: normalizedPlannedNewHires,
    actualTrainingStartHc: normalizedActualTrainingStartHc,
    trainingHc: normalizedTrainingHc,
    nestingHc: normalizedNestingHc,
    graduateHc: normalizedGraduateHc,
    trainingAttritionHc: normalizedTrainingAttritionHc,
    nestingAttritionHc: normalizedNestingAttritionHc,
    attritionHc: normalizedAttritionHc,
    transferInHc: normalizedTransferInHc,
    transferOutHc: normalizedTransferOutHc,
    offRosterLoaHc: normalizedOffRosterLoaHc,
    attritionPct: safeRatio(normalizedAttritionHc, Math.max(normalizedBeginningProductionHc, 1)),
    trainingAttritionPct: null,
    nestingAttritionPct: null,
    volume: roundedWhole(volume),
    offeredVolume: roundedWhole(offeredVolume),
    handledVolume: handled,
    ahtSeconds: resolvedAht,
    cappedAhtSeconds: resolvedCap,
    occupancy: normalizedOccupancy,
    shrinkagePct: normalizedShrinkagePct,
    nestingPhoneTimePct: normalizedNestingPhoneTimePct,
    productionHc,
    supportHc: roundedWhole(overrides?.supportHc ?? 0),
    supportHcByRole: {},
    plannedSeats: 0,
    peakRatio: null,
    seatsVariance: null,
    requiredFte: required,
    coreProductionFte,
    nestingProductiveFte: normalizedNestingProductiveFte,
    productionFte,
    staffingPct: required != null ? safeRatio(productionFte, required) : null,
    // Keep FTE precision — do not round variance to a whole number.
    overUnderFte: required != null ? Math.round((productionFte - required) * 1000) / 1000 : 0,
    scheduledBillableHours: null,
    actualBillableHours: null,
    productiveHours: null,
    payrollHours: null,
    switchHours: null,
  }
}

function resolveStaffingDriver(
  mode: CapacityForecastMode | undefined,
  manualValue: number | null | undefined,
  forecastValue: number | null,
  previousValue: number | null,
  ledgerValue: number | null = null,
  /** When true, treat 0 as missing so a broken forecast 0 cannot wipe prior/manual volume or AHT. */
  treatZeroAsMissing = false,
): number | null {
  const usable = (value: number | null | undefined): value is number =>
    value != null && Number.isFinite(value) && (!treatZeroAsMissing || value > 0)

  // Explicit override / uploaded template value always wins over forecast or previous-week modes.
  if (usable(manualValue)) return manualValue

  if (mode === 'previous_week') {
    if (usable(previousValue)) return previousValue
  }
  if (mode === 'forecast') {
    if (usable(forecastValue)) return forecastValue
    if (usable(previousValue)) return previousValue
  }
  // Manual mode: do not invent from forecast / previous week / ledger seeds.
  if (mode === 'manual' || mode == null || mode === undefined) {
    if (!treatZeroAsMissing && manualValue != null && Number.isFinite(manualValue)) return manualValue
    return null
  }
  if (usable(forecastValue)) return forecastValue
  if (usable(previousValue)) return previousValue
  if (usable(ledgerValue)) return ledgerValue
  // Preserve an explicit stored 0 when zero is allowed (e.g. attrition HC).
  if (!treatZeroAsMissing) {
    if (manualValue != null && Number.isFinite(manualValue)) return manualValue
    if (forecastValue != null && Number.isFinite(forecastValue)) return forecastValue
    if (previousValue != null && Number.isFinite(previousValue)) return previousValue
    if (ledgerValue != null && Number.isFinite(ledgerValue)) return ledgerValue
  }
  return null
}

function planInputs(
  rows: WeeklyLedgerRow[],
  _scenario: PlannerScenario,
  forecast: ScenarioForecastPackage | null,
  plannedOverrides: Record<string, WeekCapacityPlanOverride> = {},
  forecastModes: Partial<Record<string, CapacityForecastMode>> = {},
  visibleShrinkageCategoryIds: readonly string[] = DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS,
): RowInput[] {
  const futureRows = rows.filter((row) => row.timeline === 'forward_plan')
  const resolvedRows: RowInput[] = []
  rows.forEach((row, index) => {
    const futureIndex = futureRows.findIndex((item) => item.key === row.key)
    const override = plannedOverrides[row.week] ?? {}
    const forecastVolume = metricValue(forecast, 'callVolume', futureIndex)
    const forecastAht = metricValue(forecast, 'ahtSeconds', futureIndex)
    const forecastOccupancy = metricValue(forecast, 'occupancy', futureIndex)
    const forecastShrinkage = metricValue(forecast, 'totalShrinkagePct', futureIndex)
    const forecastAttrition = metricValue(forecast, 'attritionHc', futureIndex)
    const previousRow = rows[index - 1]
    const previousResolvedRow = resolvedRows[index - 1]
    const previousMetricValue = (
      plannedKey: keyof LedgerMetricSnapshot,
      resolvedKey: keyof RowInput,
    ): number | null => {
      if (!previousRow) return null
      if (previousRow.timeline === 'forward_plan' && previousResolvedRow) {
        const value = previousResolvedRow[resolvedKey]
        return typeof value === 'number' && Number.isFinite(value) ? value : null
      }
      return previousRow.actual?.[plannedKey] ?? previousRow.planned[plannedKey] ?? null
    }
    const resolvePlannedDriver = (
      mode: CapacityForecastMode | undefined,
      manualValue: number | null | undefined,
      forecastValue: number | null,
      previousValue: number | null,
      _baselineValue: number,
    ): number => {
      if (row.timeline !== 'forward_plan') return manualValue ?? 0
      if (mode === 'previous_week') {
        if (previousValue != null && Number.isFinite(previousValue)) return previousValue
        if (manualValue != null && Number.isFinite(manualValue)) return manualValue
        return 0
      }
      if (mode === 'forecast') {
        if (forecastValue != null && Number.isFinite(forecastValue) && forecastValue > 0) return forecastValue
        if (previousValue != null && Number.isFinite(previousValue) && previousValue > 0) return previousValue
        if (manualValue != null && Number.isFinite(manualValue)) return manualValue
        return 0
      }
      // Manual: only an explicit override — never invent from previous week or assumptions.
      if (manualValue != null && Number.isFinite(manualValue)) return manualValue
      return 0
    }
    const volumeBaseline = override.callVolume ?? 0
    const occupancyBaseline = override.occupancy ?? 0
    const attritionBaseline = override.attritionHc ?? 0
    const activeShrinkageCategoryIds = resolveActiveShrinkageCategoryIds(
      visibleShrinkageCategoryIds,
      row.shrinkage.map((item) => item.id),
      Object.keys(override.shrinkageById ?? {}),
    )
    const resolvedShrinkageCategories = Object.fromEntries(
      row.shrinkage.map((item) => {
        const previousValue =
          previousRow?.timeline === 'forward_plan' && previousResolvedRow
            ? previousResolvedRow.shrinkageCategoryValues[item.id] ?? item.plannedPct
            : previousRow?.shrinkage.find((prevItem) => prevItem.id === item.id)?.actualPct ??
              previousRow?.shrinkage.find((prevItem) => prevItem.id === item.id)?.plannedPct ??
              item.plannedPct
        const explicitCategoryOverride = override.shrinkageById?.[item.id]
        const categoryMode =
          explicitCategoryOverride != null
            ? ('manual' as const)
            : resolvedCapacityForecastMode(forecastModes, item.id)
        return [
          item.id,
          resolvePlannedDriver(
            categoryMode,
            explicitCategoryOverride ?? null,
            metricValue(forecast, item.id, futureIndex).value,
            previousValue,
            item.plannedPct,
          ),
        ] as const
      }),
    )
    const visibleCategorySum = Object.entries(resolvedShrinkageCategories)
      .filter(([categoryId]) => isShrinkageCategoryVisible(categoryId, activeShrinkageCategoryIds))
      .reduce((sum, [, value]) => sum + value, 0)
    // Planned shrinkage = sum of visible custom OOO + in-office categories (0 if none visible).
    const resolvedTotalShrinkage = visibleCategorySum
    const resolvedVolume =
      resolveStaffingDriver(
        resolvedCapacityForecastMode(forecastModes, 'callVolume'),
        override.callVolume,
        forecastVolume.value,
        previousMetricValue('callVolume', 'volume'),
        null,
        true,
      ) ?? volumeBaseline
    const resolvedAht =
      resolveStaffingDriver(
        resolvedCapacityForecastMode(forecastModes, 'ahtSeconds'),
        override.ahtSeconds,
        forecastAht.value,
        previousMetricValue('ahtSeconds', 'ahtSeconds'),
        null,
        true,
      ) ?? null
    resolvedRows.push({
      week: row.week,
      timeline: row.timeline,
      volume: roundedWhole(resolvedVolume),
      handledVolume: override.handledVolume ?? null,
      ahtSeconds: resolvedAht,
      cappedAhtSeconds: override.cappedAhtSeconds ?? resolvedAht ?? null,
      occupancy: clampPlannedOccupancy(
        row.timeline !== 'forward_plan'
          ? (override.occupancy ?? 0)
          : resolveStaffingDriver(
              resolvedCapacityForecastMode(forecastModes, 'occupancy'),
              override.occupancy,
              forecastOccupancy.value,
              previousMetricValue('occupancy', 'occupancy'),
              null,
            ) ?? occupancyBaseline,
      ),
      shrinkagePct: clampRate(resolvedTotalShrinkage),
      plannedNewHires: roundedWhole(override.plannedNewHires ?? 0),
      attritionHc: roundedWhole(
        resolvePlannedDriver(
          resolvedCapacityForecastMode(forecastModes, 'attritionHc'),
          override.attritionHc,
          forecastAttrition.value,
          previousMetricValue('attritionHc', 'attritionHc'),
          attritionBaseline,
        ),
      ),
      transferInHc: roundedWhole(override.transferInHc ?? 0),
      transferOutHc: roundedWhole(override.transferOutHc ?? 0),
      offRosterLoaHc: roundedWhole(override.offRosterLoaHc ?? 0),
      supportHc: roundedWhole(override.supportHc ?? 0),
      beginningProductionHc: override.beginningProductionHc ?? null,
      graduateHc: override.graduateHc ?? null,
      shrinkageCategoryValues: resolvedShrinkageCategories,
      forecastModelVolume: forecastVolume.model ?? undefined,
      forecastModelAht: forecastAht.model ?? undefined,
      forecastModelShrinkage: forecastShrinkage.model ?? undefined,
      forecastModelAttrition: forecastAttrition.model ?? undefined,
    })
  })
  return resolvedRows
}

function actualStartSeries(rows: WeeklyLedgerRow[], plannedRows: RowInput[]): number[] {
  return rows.map((row, index) =>
    row.timeline === 'forward_plan'
      ? Math.max(0, Math.round(row.actual?.actualTrainingStartHc ?? plannedRows[index]!.plannedNewHires))
      : actualDriver(
          row.actual?.actualTrainingStartHc,
          row.planned.actualTrainingStartHc ?? plannedRows[index]!.plannedNewHires,
          index + 7,
          'actual_training_start',
          true,
        ),
  )
}

function positiveMetricOverride(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  return roundedWhole(value)
}

/** Same basis as the Capacity matrix shrinkage rows: visible/active category %. */
function shrinkagePctFromVisibleCategories(
  categories: Array<{ id: string; plannedPct: number; actualPct: number | null }>,
  activeCategoryIds: readonly string[],
  kind: 'planned' | 'actual',
): number {
  const total = categories
    .filter((item) => isShrinkageCategoryVisible(item.id, activeCategoryIds))
    .reduce((sum, item) => {
      const value = kind === 'planned' ? item.plannedPct : (item.actualPct ?? 0)
      return sum + Math.max(0, value)
    }, 0)
  return clampRate(total)
}

function computeForwardPlannedProductionHc(
  priorProductionBase: number,
  graduateHc: number,
  transferInHc: number,
  attritionHc: number,
  transferOutHc: number,
  offRosterLoaHc: number,
): number {
  return Math.max(
    0,
    roundedWhole(priorProductionBase + graduateHc + transferInHc - attritionHc - transferOutHc - offRosterLoaHc),
  )
}

function isCapacityPlanStartWeek(
  isFirstForwardPlanWeek: boolean,
  rowWeek: string,
  currentPlanningWeek: string | null,
): boolean {
  return isFirstForwardPlanWeek || (currentPlanningWeek != null && rowWeek === currentPlanningWeek)
}

/** Roll-forward base for planned production HC per capacity formula. */
function resolveRollForwardProductionBase(
  isFirstForwardPlanWeek: boolean,
  row: WeeklyLedgerRow,
  currentPlanningWeek: string | null,
  previousWeekActualProductionHc: number,
  previousWeekPlannedProductionHc: number,
  inactiveProductionCount: number,
  plannedOverrideProductionHc: number | null,
  rosterPlanStartProductionHc?: number | null,
): number {
  const savedActual =
    row.actual?.productionHc != null && Number.isFinite(row.actual.productionHc)
      ? roundedWhole(row.actual.productionHc)
      : null
  const isCapacityStartWeek = isCapacityPlanStartWeek(isFirstForwardPlanWeek, row.week, currentPlanningWeek)

  if (isCapacityStartWeek) {
    if (savedActual != null && savedActual > 0) return savedActual
    if (plannedOverrideProductionHc != null && plannedOverrideProductionHc > 0) return plannedOverrideProductionHc
    if (rosterPlanStartProductionHc != null && rosterPlanStartProductionHc > 0) {
      return roundedWhole(rosterPlanStartProductionHc)
    }
    const priorActual = Math.max(0, previousWeekActualProductionHc - inactiveProductionCount)
    if (priorActual > 0) return priorActual
    return previousWeekPlannedProductionHc > 0 ? previousWeekPlannedProductionHc : 0
  }

  return previousWeekPlannedProductionHc > 0 ? previousWeekPlannedProductionHc : 0
}

function resolveForwardPlannedProductionHc(
  isCapacityStartWeek: boolean,
  rollForwardBase: number,
  manualProductionHc: number | null,
  graduateHc: number,
  transferInHc: number,
  attritionHc: number,
  transferOutHc: number,
  offRosterLoaHc: number,
): number {
  if (isCapacityStartWeek) {
    if (manualProductionHc != null) return manualProductionHc
    return Math.max(0, roundedWhole(rollForwardBase))
  }
  return computeForwardPlannedProductionHc(
    rollForwardBase,
    graduateHc,
    transferInHc,
    attritionHc,
    transferOutHc,
    offRosterLoaHc,
  )
}

/**
 * Weekly attrition against the roll-forward base, as an exact fraction of a person.
 *
 * Returned unrounded on purpose. A week of attrition is usually well under one head
 * (100 HC at 2%/month is 0.46/week), so rounding here floored it to zero every week and
 * the plan never lost anyone. The caller pools the remainder across weeks instead.
 */
function resolveRollForwardAttritionHc(
  rollForwardBase: number,
  attritionHcDriver: number,
  driverBaseHc: number,
  attritionMode: CapacityForecastMode,
  monthlyAttritionRate: number,
  previousWeekPlannedProductionHc: number,
  previousWeekAttritionHc: number,
  previousWeekAttritionPct: number | null = null,
): number {
  if (rollForwardBase <= 0) return 0

  const weeklyAssumptionRate = monthlyAttritionRate / WEEKS_PER_MONTH

  // Manual / unset: only an explicit attrition HC driver — never invent from assumptions.
  if (attritionMode === 'manual' || attritionMode == null) {
    if (attritionHcDriver > 0) return Math.min(attritionHcDriver, rollForwardBase)
    return 0
  }

  if (attritionMode === 'previous_week') {
    const previousRate =
      previousWeekAttritionPct != null && Number.isFinite(previousWeekAttritionPct)
        ? clampRate(previousWeekAttritionPct)
        : previousWeekPlannedProductionHc > 0 && previousWeekAttritionHc > 0
          ? previousWeekAttritionHc / previousWeekPlannedProductionHc
          : null
    if (previousRate != null && previousRate > 0) {
      return Math.min(rollForwardBase, rollForwardBase * previousRate)
    }
    return 0
  }

  if (driverBaseHc > 0 && attritionHcDriver > 0) {
    const impliedRate = attritionHcDriver / driverBaseHc
    const maxReasonableWeeklyRate = Math.max(weeklyAssumptionRate * 4, 0.25)
    const appliedRate = impliedRate > maxReasonableWeeklyRate ? weeklyAssumptionRate : impliedRate
    return Math.min(rollForwardBase, rollForwardBase * appliedRate)
  }

  // Forecast mode with no driver: do not invent from tenured attrition assumptions.
  return 0
}

/**
 * Turn an exact fractional attrition into whole leavers, pooling what is left over.
 *
 * People leave one at a time, so each week must report a whole number, but the fraction
 * cannot simply be dropped: at 0.46/week it would round to zero forever. Carrying the
 * remainder releases a head roughly every other week and keeps the annual total right.
 */
export function releaseWholeAttrition(
  exactHc: number,
  carry: number,
  rollForwardBase: number,
): { wholeHc: number; carry: number } {
  const pooled = Math.max(0, exactHc) + carry
  const wholeHc = Math.max(0, Math.min(rollForwardBase, Math.floor(pooled)))
  // Capped so a base that clamps the release cannot grow the pool without bound.
  return { wholeHc, carry: Math.min(1, Math.max(0, pooled - wholeHc)) }
}

/** Only the capacity start week may carry a manual planned production HC override. */
function capacityStartProductionHcOverride(
  isCapacityStartWeek: boolean,
  productionHc: number | null | undefined,
): number | null {
  if (!isCapacityStartWeek) return null
  return positiveMetricOverride(productionHc)
}

function buildPlannedWeekActualSnapshot(planned: CapacityMetricSnapshot): CapacityMetricSnapshot {
  return {
    ...planned,
    productionHc: 0,
    coreProductionFte: 0,
    nestingProductiveFte: 0,
    productionFte: 0,
    supportHc: 0,
    trainingHc: 0,
    nestingHc: 0,
    handledVolume: null,
    requiredFte: null,
    staffingPct: null,
    overUnderFte: 0,
  }
}

function buildCurrentWeekActualSnapshot(
  planned: CapacityMetricSnapshot,
  savedProductionHc: number,
): CapacityMetricSnapshot {
  const productionHc = roundedWhole(savedProductionHc)
  const coreProductionFte = productionHc * (1 - planned.shrinkagePct)
  const productionFte = coreProductionFte + planned.nestingProductiveFte
  return {
    ...buildPlannedWeekActualSnapshot(planned),
    productionHc,
    coreProductionFte,
    productionFte,
  }
}

export function actualProductionHcForDisplay(row: DerivedCapacityRow): number | null {
  if (row.isCurrentPlanningWeek && row.actual.productionHc > 0) return row.actual.productionHc
  if (row.statusLabel === 'Actual') return row.actual.productionHc
  if (row.timeline === 'forward_plan' || row.statusLabel === 'Planned') return null
  return row.actual.productionHc
}

export function actualSupportHcForDisplay(row: DerivedCapacityRow): number | null {
  if (row.statusLabel === 'Actual') return row.actual.supportHc
  if (row.timeline === 'forward_plan' || row.statusLabel === 'Planned') return null
  return row.actual.supportHc
}

function applySupportAndSeatsMetrics(
  planned: CapacityMetricSnapshot,
  actual: CapacityMetricSnapshot,
  weekOverride: WeekCapacityPlanOverride,
  actualSupportHcByRole: Record<string, number> | undefined,
  statusLabel: 'Actual' | 'Planned',
): { planned: CapacityMetricSnapshot; actual: CapacityMetricSnapshot } {
  const plannedRoles = { ...(weekOverride.supportHcByRole ?? {}) }
  const plannedRoleSum = sumSupportRoleValues(plannedRoles)
  const plannedSupportHc =
    plannedRoleSum > 0 ? plannedRoleSum : weekOverride.supportHc ?? planned.supportHc ?? 0
  const plannedSeats = roundedWhole(weekOverride.plannedSeats ?? planned.plannedSeats ?? 0)
  const peakRatio =
    weekOverride.peakRatio != null && Number.isFinite(weekOverride.peakRatio)
      ? weekOverride.peakRatio
      : planned.peakRatio
  const seatsVariance =
    plannedSeats > 0 ? plannedSeats - (planned.productionHc + roundedWhole(plannedSupportHc)) : null

  const actualRoles = { ...(actualSupportHcByRole ?? {}) }
  const actualRoleSum = sumSupportRoleValues(actualRoles)
  const actualSupportHc =
    statusLabel === 'Actual'
      ? actualRoleSum > 0
        ? actualRoleSum
        : actual.supportHc
      : actual.supportHc

  return {
    planned: {
      ...planned,
      supportHcByRole: plannedRoles,
      supportHc: roundedWhole(plannedSupportHc),
      plannedSeats,
      peakRatio,
      seatsVariance,
    },
    actual: {
      ...actual,
      supportHcByRole: actualRoles,
      supportHc: roundedWhole(actualSupportHc),
    },
  }
}

export function deriveCapacityPlanRows(
  rows: WeeklyLedgerRow[],
  scenario: PlannerScenario,
  forecast: ScenarioForecastPackage | null,
  plannedOverrides: Record<string, WeekCapacityPlanOverride> = {},
  forecastModes: Partial<Record<string, CapacityForecastMode>> = {},
  inactiveProductionCount = 0,
  ahtOverrides?: AhtAnalysisOverrides | null,
  stageAttritionOverrides?: StageAttritionOverride | null,
  visibleShrinkageCategoryIds: readonly string[] = DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS,
  rosterPlanStartProductionHc?: number | null,
  unlockManualRequiredFte = false,
): DerivedCapacityRow[] {
  const standardHours = scenario.assumptions.tenured.standardScheduledHoursPerWeek
  const startingProductionHc = getTotalStartingProductionHc(scenario.assumptions, scenario.plan)
  const plannedRows = planInputs(
    rows,
    scenario,
    forecast,
    plannedOverrides,
    forecastModes,
    visibleShrinkageCategoryIds,
  )
  const weekPipelineAttritionOverrides = {
    weekIsos: rows.map((row) => row.week),
    ratesByWeek: Object.fromEntries(
      Object.entries(plannedOverrides).map(([week, override]) => [
        week,
        {
          trainingAttritionPct: override.trainingAttritionPct,
          nestingAttritionPct: override.nestingAttritionPct,
        },
      ]),
    ),
  }
  const plannedPipelineResult = buildTrainingPipeline(
    plannedRows.map((row) => row.plannedNewHires),
    scenario.assumptions,
    stageAttritionOverrides ?? undefined,
    weekPipelineAttritionOverrides,
  )
  const plannedPipeline = plannedPipelineResult.periods
  const actualPipelineResult = buildTrainingPipeline(
    actualStartSeries(rows, plannedRows),
    pipelineAssumptionsForActuals(scenario.assumptions),
    stageAttritionOverrides ?? undefined,
  )
  const actualPipeline = actualPipelineResult.periods
  const nestingAttritionRate = scenario.assumptions.newHire.nestingAttritionRate
  const historicalAhtAnalysis = applyAhtAnalysisOverrides(analyzeHistoricalAhtMix(rows), ahtOverrides)
  const plannedStarts = plannedRows.map((row) => row.plannedNewHires)
  const actualStarts = actualStartSeries(rows, plannedRows)
  const plannedStageMaps = buildCohortStageMaps(
    plannedStarts,
    scenario.assumptions,
    stageAttritionOverrides ?? undefined,
    weekPipelineAttritionOverrides,
  )
  const actualStageMaps = buildCohortStageMaps(actualStarts, scenario.assumptions, stageAttritionOverrides ?? undefined)
  const capacityPlanStartWeek = resolveCapacityPlanStartWeek(scenario.plan)
  const calendarCurrentWeek = resolveCurrentCalendarWeek(scenario.plan.weekStart)
  const activeShrinkageCategoryIds = resolveActiveShrinkageCategoryIds(
    visibleShrinkageCategoryIds,
    rows.flatMap((item) => item.shrinkage.map((category) => category.id)),
    Object.values(plannedOverrides).flatMap((weekOverride) => Object.keys(weekOverride.shrinkageById ?? {})),
  )
  const matrixConcurrencyFactor = resolveMatrixConcurrencyFactor(scenario.plan, scenario.assumptions)

  const lastHistoricalRow = [...rows].reverse().find((item) => item.timeline === 'historical_actual')
  let previousWeekPlannedProductionHc = plannedRows[0]?.beginningProductionHc ?? startingProductionHc
  let previousWeekAttritionHc = 0
  let previousWeekAttritionPct: number | null = null
  /** Sub-one-head attrition left over from earlier weeks, released once it reaches 1. */
  let plannedAttritionCarry = 0
  let previousWeekActualProductionHc =
    lastHistoricalRow?.actual?.productionHc ??
    lastHistoricalRow?.planned.productionHc ??
    rows[0]?.actual?.productionHc ??
    rows[0]?.planned.productionHc ??
    startingProductionHc
  let previousActualProductionHc =
    rows[0]?.actual?.beginningProductionHc ?? rows[0]?.planned.beginningProductionHc ?? startingProductionHc

  return rows.map((row, index) => {
    const plannedInput = plannedRows[index]!
    const plannedPipelinePeriod = plannedPipeline[index]!
    const isForwardPlanWeek = row.timeline === 'forward_plan'
    const isFirstForwardPlanWeek = isForwardPlanWeek && rows[index - 1]?.timeline !== 'forward_plan'
    const capacityStartWeek = isCapacityPlanStartWeek(isFirstForwardPlanWeek, row.week, capacityPlanStartWeek)
    const plannedOverrideProductionHc = capacityStartProductionHcOverride(
      capacityStartWeek,
      plannedOverrides[row.week]?.productionHc,
    )
    const rollForwardBase = resolveRollForwardProductionBase(
      isFirstForwardPlanWeek,
      row,
      capacityPlanStartWeek,
      previousWeekActualProductionHc,
      previousWeekPlannedProductionHc,
      inactiveProductionCount,
      plannedOverrideProductionHc,
      capacityStartWeek ? rosterPlanStartProductionHc : undefined,
    )
    const plannedBeginning = isForwardPlanWeek
      ? roundedWhole(rollForwardBase)
      : index === 0
        ? roundedWhole(plannedInput.beginningProductionHc ?? startingProductionHc)
        : // Actual weeks: Planned Production HC rolls from prior week Actual Production HC.
          roundedWhole(
            previousWeekActualProductionHc > 0
              ? previousWeekActualProductionHc
              : previousWeekPlannedProductionHc,
          )
    const plannedTrainingHc = roundedWhole(sumStageHcAt(plannedStageMaps.training, index))
    const plannedNestingHc = roundedWhole(sumStageHcAt(plannedStageMaps.nesting, index))
    const weekTrainingAttritionPct = plannedOverrides[row.week]?.trainingAttritionPct
    const weekNestingAttritionPct = plannedOverrides[row.week]?.nestingAttritionPct
    const effectiveTrainingAttritionPct =
      weekTrainingAttritionPct != null && Number.isFinite(weekTrainingAttritionPct)
        ? clampRate(weekTrainingAttritionPct)
        : scenario.assumptions.newHire.trainingAttritionRate
    const effectiveNestingAttritionPct =
      weekNestingAttritionPct != null && Number.isFinite(weekNestingAttritionPct)
        ? clampRate(weekNestingAttritionPct)
        : nestingAttritionRate
    const plannedTrainingAttritionHc =
      weekTrainingAttritionPct != null && Number.isFinite(weekTrainingAttritionPct)
        ? roundedWhole(plannedTrainingHc * clampRate(weekTrainingAttritionPct))
        : roundedWhole(plannedPipelinePeriod.trainingAttrition)
    const plannedNestingAttritionHc =
      weekNestingAttritionPct != null && Number.isFinite(weekNestingAttritionPct)
        ? roundedWhole(plannedNestingHc * clampRate(weekNestingAttritionPct))
        : roundedWhole(plannedPipelinePeriod.nestingAttrition)
    const prevPlannedFinalNestingHc = index > 0 ? finalNestingStageHcAt(plannedStageMaps.nesting, index - 1) : 0
    const prevWeekNestingAttritionPct =
      index > 0 && plannedOverrides[rows[index - 1]!.week]?.nestingAttritionPct != null
        ? clampRate(plannedOverrides[rows[index - 1]!.week]!.nestingAttritionPct!)
        : nestingAttritionRate
    const graduateFromPreviousNesting = roundedWhole(prevPlannedFinalNestingHc * (1 - prevWeekNestingAttritionPct))
    const plannedGraduateHc =
      row.timeline === 'forward_plan' && row.week === capacityPlanStartWeek && plannedInput.graduateHc != null
        ? roundedWhole(plannedInput.graduateHc)
        : row.timeline === 'forward_plan'
          ? graduateFromPreviousNesting
          : roundedWhole(prevPlannedFinalNestingHc * (1 - prevWeekNestingAttritionPct))
    const plannedNestingPhoneTimePct = nestingPhoneTimeFromStageMaps(
      plannedStageMaps.nesting,
      index,
      scenario.assumptions,
    )
    const plannedProductionHcForMix = isFirstForwardPlanWeek
      ? previousWeekActualProductionHc
      : rollForwardBase
    const adjustedPlannedAht =
      row.timeline === 'forward_plan' &&
      plannedInput.ahtSeconds != null &&
      resolvedCapacityForecastMode(forecastModes, 'ahtSeconds') === 'forecast'
        ? plannedAhtFromNestingMix(
            plannedInput.ahtSeconds,
            plannedNestingHc,
            plannedProductionHcForMix,
            historicalAhtAnalysis,
            scenario.assumptions.tenured.ahtSeconds,
          )
        : plannedInput.ahtSeconds
    const ledgerRequiredFte = plannedOverrides[row.week]?.requiredFte ?? null
    const plannedAhtForRequired =
      adjustedPlannedAht != null && adjustedPlannedAht > 0 ? adjustedPlannedAht : null
    const plannedOccForRequired = plannedInput.occupancy > 0 ? plannedInput.occupancy : 0
    const plannedRequiredResolution = resolvePlannedRequiredFteOverride(
      scenario.plan,
      scenario.assumptions,
      plannedInput.volume,
      ledgerRequiredFte,
      {
        ahtSeconds: plannedAhtForRequired,
        occupancy: plannedOccForRequired,
        cappedAhtSeconds: plannedInput.cappedAhtSeconds,
      },
      unlockManualRequiredFte,
    )
    const plannedRequiredFteOverride = plannedRequiredResolution.value
    const skipMatrixRequiredFteFallback = plannedRequiredResolution.skipMatrixFallback
    const attritionMode = resolvedCapacityForecastMode(forecastModes, 'attritionHc')
    const rollForwardAttritionHc = isForwardPlanWeek
      ? (() => {
          const attritionPctOverride = plannedOverrides[row.week]?.attritionPct
          const exactHc =
            attritionPctOverride != null && Number.isFinite(attritionPctOverride)
              ? Math.min(rollForwardBase, Math.max(0, rollForwardBase * clampRate(attritionPctOverride)))
              : resolveRollForwardAttritionHc(
                  rollForwardBase,
                  plannedInput.attritionHc,
                  rollForwardBase,
                  attritionMode,
                  scenario.assumptions.tenured.attritionRateMonthly,
                  previousWeekPlannedProductionHc,
                  previousWeekAttritionHc,
                  previousWeekAttritionPct,
                )
          const released = releaseWholeAttrition(exactHc, plannedAttritionCarry, rollForwardBase)
          plannedAttritionCarry = released.carry
          return released.wholeHc
        })()
      : plannedInput.attritionHc
    const carriedPreviousAttritionPct =
      isForwardPlanWeek &&
      plannedOverrides[row.week]?.attritionPct == null &&
      attritionMode === 'previous_week' &&
      previousWeekAttritionPct != null &&
      Number.isFinite(previousWeekAttritionPct)
        ? clampRate(previousWeekAttritionPct)
        : null
    // Apply the same Production HC formula for Actual weeks and forward plan weeks.
    const plannedProductionHcOverride = resolveForwardPlannedProductionHc(
      isForwardPlanWeek ? capacityStartWeek : false,
      plannedBeginning,
      isForwardPlanWeek ? plannedOverrideProductionHc : null,
      plannedGraduateHc,
      plannedInput.transferInHc,
      rollForwardAttritionHc,
      plannedInput.transferOutHc,
      plannedInput.offRosterLoaHc,
    )
    let plannedSnapshot = buildSnapshot(
      plannedBeginning,
      plannedInput.plannedNewHires,
      plannedPipelinePeriod.actualTrainingStart,
      plannedTrainingAttritionHc,
      plannedNestingAttritionHc,
      rollForwardAttritionHc,
      plannedInput.transferInHc,
      plannedInput.transferOutHc,
      plannedInput.offRosterLoaHc,
      plannedInput.volume,
      plannedInput.volume,
      adjustedPlannedAht,
      plannedInput.cappedAhtSeconds,
      plannedInput.occupancy,
      plannedInput.shrinkagePct,
      plannedTrainingHc,
      plannedNestingHc,
      plannedGraduateHc,
      plannedNestingPhoneTimePct,
      plannedPipelinePeriod.nestingProductiveFte,
      standardHours,
      plannedInput.handledVolume,
      {
        supportHc: plannedInput.supportHc,
        productionHc: plannedProductionHcOverride,
      },
      plannedRequiredFteOverride,
      skipMatrixRequiredFteFallback,
      matrixConcurrencyFactor,
    )
    plannedSnapshot = {
      ...plannedSnapshot,
      trainingAttritionPct: effectiveTrainingAttritionPct,
      nestingAttritionPct: effectiveNestingAttritionPct,
    }
    // Prefer HC-derived Production FTE when positive; otherwise restore persisted
    // staffing_plan.production_fte / override so Planned weeks survive refresh.
    const persistedProductionFte = plannedOverrides[row.week]?.productionFte
    if (
      !(plannedSnapshot.productionFte > 0) &&
      persistedProductionFte != null &&
      Number.isFinite(persistedProductionFte) &&
      persistedProductionFte >= 0
    ) {
      plannedSnapshot = {
        ...plannedSnapshot,
        productionFte: persistedProductionFte,
        staffingPct:
          plannedSnapshot.requiredFte != null
            ? safeRatio(persistedProductionFte, plannedSnapshot.requiredFte)
            : null,
        overUnderFte:
          plannedSnapshot.requiredFte != null
            ? Math.round((persistedProductionFte - plannedSnapshot.requiredFte) * 1000) / 1000
            : 0,
      }
    }
    const attritionPctOverride = plannedOverrides[row.week]?.attritionPct
    if (attritionPctOverride != null && Number.isFinite(attritionPctOverride)) {
      plannedSnapshot = {
        ...plannedSnapshot,
        attritionPct: clampRate(attritionPctOverride),
      }
    } else if (carriedPreviousAttritionPct != null) {
      plannedSnapshot = {
        ...plannedSnapshot,
        attritionPct: carriedPreviousAttritionPct,
      }
    }
    const beginningForAttritionRate = Math.max(plannedSnapshot.beginningProductionHc, 1)
    previousWeekPlannedProductionHc = plannedSnapshot.productionHc
    previousWeekAttritionHc = plannedSnapshot.attritionHc
    previousWeekAttritionPct =
      plannedSnapshot.attritionPct != null && Number.isFinite(plannedSnapshot.attritionPct)
        ? clampRate(plannedSnapshot.attritionPct)
        : plannedSnapshot.attritionHc > 0
          ? clampRate(plannedSnapshot.attritionHc / beginningForAttritionRate)
          : previousWeekAttritionPct

    const actualSource = row.actual
    const actualPipelinePeriod = actualPipeline[index]!

    let actualSnapshot: CapacityMetricSnapshot
    const isCurrentPlanningWeek = row.week === calendarCurrentWeek
    const weekStatus = resolveCapacityWeekStatus(row.week, row.timeline, scenario.plan.weekStart)
    if (isForwardPlanWeek) {
      const savedActualProductionHc =
        actualSource?.productionHc != null && Number.isFinite(actualSource.productionHc)
          ? roundedWhole(actualSource.productionHc)
          : null
      if (isCurrentPlanningWeek && savedActualProductionHc != null && weekStatus !== 'Actual') {
        actualSnapshot = buildCurrentWeekActualSnapshot(plannedSnapshot, savedActualProductionHc)
      } else if (weekStatus === 'Actual') {
        const actualBeginning = roundedWhole(
          actualSource?.beginningProductionHc != null && Number.isFinite(actualSource.beginningProductionHc)
            ? actualSource.beginningProductionHc
            : 0,
        )
        const actualAttrition =
          actualSource?.attritionHc != null && Number.isFinite(actualSource.attritionHc)
            ? roundedWhole(Math.max(0, actualSource.attritionHc))
            : 0
        const actualTransferIn = roundedWhole(
          actualSource?.transferInHc != null && Number.isFinite(actualSource.transferInHc)
            ? actualSource.transferInHc
            : 0,
        )
        const actualTransferOut = roundedWhole(
          actualSource?.transferOutHc != null && Number.isFinite(actualSource.transferOutHc)
            ? actualSource.transferOutHc
            : 0,
        )
        const actualOffRosterLoaHc = roundedWhole(
          actualSource?.offRosterLoaHc != null && Number.isFinite(actualSource.offRosterLoaHc)
            ? actualSource.offRosterLoaHc
            : 0,
        )
        const actualGraduateHc = roundedWhole(
          actualSource?.graduateHc != null && Number.isFinite(actualSource.graduateHc)
            ? actualSource.graduateHc
            : 0,
        )
        const actualTrainingHc = roundedWhole(
          actualSource?.trainingHc != null && Number.isFinite(actualSource.trainingHc)
            ? actualSource.trainingHc
            : 0,
        )
        const actualNestingHc = roundedWhole(
          actualSource?.nestingHc != null && Number.isFinite(actualSource.nestingHc)
            ? actualSource.nestingHc
            : 0,
        )
        const actualSupportHc = roundedWhole(
          actualSource?.supportHc != null && Number.isFinite(actualSource.supportHc)
            ? actualSource.supportHc
            : 0,
        )
        const actualVolume = roundedWhole(
          actualSource?.callVolume != null && Number.isFinite(actualSource.callVolume)
            ? actualSource.callVolume
            : 0,
        )
        const actualAht =
          actualSource?.ahtSeconds != null &&
          Number.isFinite(actualSource.ahtSeconds) &&
          actualSource.ahtSeconds > 0
            ? actualSource.ahtSeconds
            : null
        const actualCappedAht =
          actualSource?.cappedAhtSeconds != null && Number.isFinite(actualSource.cappedAhtSeconds)
            ? actualSource.cappedAhtSeconds
            : null
        const actualOccupancy = clampOccupancy(
          actualSource?.occupancy != null && Number.isFinite(actualSource.occupancy) && actualSource.occupancy > 0
            ? actualSource.occupancy
            : 0,
        )
        // Match matrix Actual shrinkage (visible category %). Do not use demo-seeded totalShrinkagePct.
        const actualShrinkage = shrinkagePctFromVisibleCategories(
          row.shrinkage,
          activeShrinkageCategoryIds,
          'actual',
        )
        const actualHandledVolume = actualSource?.handledVolume ?? null
        const actualRequiredResolution = resolvePlannedRequiredFteOverride(
          scenario.plan,
          scenario.assumptions,
          actualVolume,
          actualSource?.requiredFte ?? null,
          {
            ahtSeconds: actualAht,
            occupancy: actualOccupancy,
            cappedAhtSeconds: actualCappedAht,
          },
        )
        // Prefer formula so Transfer In/Out affect Production HC; honor explicit HC override when set.
        actualSnapshot = buildSnapshot(
          actualBeginning,
          plannedSnapshot.plannedNewHires,
          actualPipelinePeriod.actualTrainingStart,
          roundedWhole(actualPipelinePeriod.trainingAttrition),
          roundedWhole(actualPipelinePeriod.nestingAttrition),
          actualAttrition,
          actualTransferIn,
          actualTransferOut,
          actualOffRosterLoaHc,
          actualVolume,
          actualVolume,
          actualAht,
          actualCappedAht,
          actualOccupancy,
          actualShrinkage,
          actualTrainingHc,
          actualNestingHc,
          actualGraduateHc,
          plannedSnapshot.nestingPhoneTimePct,
          plannedSnapshot.nestingProductiveFte,
          standardHours,
          actualHandledVolume,
          {
            trainingHc: actualTrainingHc,
            nestingHc: actualNestingHc,
            productionHc: savedActualProductionHc,
            supportHc: actualSupportHc,
          },
          actualRequiredResolution.value,
          actualRequiredResolution.skipMatrixFallback,
          matrixConcurrencyFactor,
        )
      } else {
        actualSnapshot = buildPlannedWeekActualSnapshot(plannedSnapshot)
      }
    } else {
      const actualBeginning =
        index === 0
          ? actualDriver(
              actualSource?.beginningProductionHc,
              0,
              index + 3,
              'actual_beginning_hc',
              true,
            )
          : // Later Actual weeks roll from prior week Actual Production HC (ending HC).
            roundedWhole(previousActualProductionHc)
      const actualAttrition = actualDriver(
        actualSource?.attritionHc,
        0,
        index + 11,
        'actual_attrition_hc',
        false,
      )
      const actualTransferIn = actualDriver(
        actualSource?.transferInHc,
        0,
        index + 20,
        'actual_transfer_in',
        true,
      )
      const actualTransferOut = actualDriver(
        actualSource?.transferOutHc,
        0,
        index + 21,
        'actual_transfer_out',
        false,
      )
      const actualOffRosterLoaHc = roundedWhole(actualSource?.offRosterLoaHc ?? 0)
      const actualSupportHc = roundedWhole(actualSource?.supportHc ?? 0)
      const actualVolume = roundedWhole(
        actualDriver(actualSource?.callVolume, 0, index, 'actual_volume', true),
      )
      const actualAht =
        actualSource?.ahtSeconds != null &&
        Number.isFinite(actualSource.ahtSeconds) &&
        actualSource.ahtSeconds > 0
          ? actualSource.ahtSeconds
          : null
      const actualCappedAht =
        actualSource?.cappedAhtSeconds != null && Number.isFinite(actualSource.cappedAhtSeconds)
          ? actualSource.cappedAhtSeconds
          : null
      const actualOccupancy = clampOccupancy(
        actualSource?.occupancy != null && Number.isFinite(actualSource.occupancy) && actualSource.occupancy > 0
          ? actualSource.occupancy
          : 0,
      )
      // Match matrix Actual shrinkage rows (OOO + in-office visible categories).
      // Never invent actual shrinkage from planned totals.
      const actualShrinkage = shrinkagePctFromVisibleCategories(
        row.shrinkage,
        activeShrinkageCategoryIds,
        'actual',
      )
      const actualTrainingHc = resolveHistoricalHeadcount(
        row,
        'trainingHc',
        0,
      )
      const actualNestingHc = resolveHistoricalHeadcount(
        row,
        'nestingHc',
        0,
      )
      const actualTrainingAttritionHc = roundedWhole(actualPipelinePeriod.trainingAttrition)
      const actualNestingAttritionHc = roundedWhole(actualPipelinePeriod.nestingAttrition)
      const actualGraduateHc =
        actualSource?.graduateHc != null && Number.isFinite(actualSource.graduateHc)
          ? roundedWhole(actualSource.graduateHc)
          : 0
      const actualNestingPhoneTimePct = nestingPhoneTimeFromStageMaps(
        actualStageMaps.nesting,
        index,
        scenario.assumptions,
      )
      const actualHandledVolume = actualSource?.handledVolume ?? null
      const actualRequiredResolution = resolvePlannedRequiredFteOverride(
        scenario.plan,
        scenario.assumptions,
        actualVolume,
        actualSource?.requiredFte ?? null,
        {
          ahtSeconds: actualAht,
          occupancy: actualOccupancy,
          cappedAhtSeconds: actualCappedAht,
        },
      )
      actualSnapshot = buildSnapshot(
        actualBeginning,
        plannedSnapshot.plannedNewHires,
        actualPipelinePeriod.actualTrainingStart,
        actualTrainingAttritionHc,
        actualNestingAttritionHc,
        actualAttrition,
        actualTransferIn,
        actualTransferOut,
        actualOffRosterLoaHc,
        actualVolume,
        actualVolume,
        actualAht,
        actualCappedAht,
        actualOccupancy,
        actualShrinkage,
        actualTrainingHc,
        actualNestingHc,
        actualGraduateHc,
        actualNestingPhoneTimePct,
        actualPipelinePeriod.nestingProductiveFte,
        standardHours,
        actualHandledVolume,
        {
          trainingHc: actualTrainingHc,
          nestingHc: actualNestingHc,
          productionHc: actualSource?.productionHc ?? null,
          supportHc: actualSupportHc,
        },
        actualRequiredResolution.value,
        actualRequiredResolution.skipMatrixFallback,
        matrixConcurrencyFactor,
      )
      previousActualProductionHc = actualSnapshot.productionHc
    }

    if (row.timeline === 'historical_actual') {
      previousWeekActualProductionHc = actualSnapshot.productionHc
    } else if (weekStatus === 'Actual' && actualSnapshot.productionHc > 0) {
      previousWeekActualProductionHc = actualSnapshot.productionHc
    } else if (isCurrentPlanningWeek && actualSnapshot.productionHc > 0) {
      previousWeekActualProductionHc = actualSnapshot.productionHc
    }

    const weekOverride = plannedOverrides[row.week] ?? {}
    plannedSnapshot = {
      ...plannedSnapshot,
      scheduledBillableHours:
        weekOverride.scheduledBillableHours ?? row.planned.scheduledBillableHours ?? null,
      actualBillableHours: weekOverride.actualBillableHours ?? row.planned.actualBillableHours ?? null,
      productiveHours: weekOverride.productiveHours ?? row.planned.productiveHours ?? null,
      payrollHours: weekOverride.payrollHours ?? row.planned.payrollHours ?? null,
      switchHours: weekOverride.switchHours ?? row.planned.switchHours ?? null,
    }
    actualSnapshot = {
      ...actualSnapshot,
      scheduledBillableHours: actualSource?.scheduledBillableHours ?? null,
      actualBillableHours: actualSource?.actualBillableHours ?? null,
      productiveHours: actualSource?.productiveHours ?? null,
      payrollHours: actualSource?.payrollHours ?? null,
      switchHours: actualSource?.switchHours ?? null,
    }

    const supportApplied = applySupportAndSeatsMetrics(
      plannedSnapshot,
      actualSnapshot,
      weekOverride,
      row.actualSupportHcByRole,
      weekStatus,
    )
    plannedSnapshot = supportApplied.planned
    actualSnapshot = supportApplied.actual

    return {
      periodIndex: index,
      week: row.week,
      timeline: row.timeline,
      statusLabel: weekStatus,
      isCurrentPlanningWeek,
      planned: plannedSnapshot,
      actual: actualSnapshot,
      shrinkageCategories: row.shrinkage.map((item) => ({
        id: item.id,
        name: item.name,
        group: item.group,
        billable: item.billable,
        plannedPct: plannedInput.shrinkageCategoryValues[item.id] ?? item.plannedPct,
        actualPct: item.actualPct,
      })),
      forecastModelVolume: plannedInput.forecastModelVolume,
      forecastModelAht: plannedInput.forecastModelAht,
      forecastModelShrinkage: plannedInput.forecastModelShrinkage,
      forecastModelAttrition: plannedInput.forecastModelAttrition,
    }
  })
}

export function downloadFullCapacityPlanWorkbook(
  rows: DerivedCapacityRow[],
  scenario: PlannerScenario,
  forecast: ScenarioForecastPackage | null,
  clientSheets: ClientSheet[] = [],
): void {
  const workbook = XLSX.utils.book_new()
  const capacitySheet = XLSX.utils.json_to_sheet(
    rows.map((row) => ({
      Week: row.week,
      Status: row.statusLabel,
      Client: scenario.plan.client,
      LOB: scenario.plan.location,
      Billing_Type: scenario.plan.billingType,
      Week_Start: scenario.plan.weekStart,
      Planned_New_Hires: row.planned.plannedNewHires,
      Actual_Training_Start_HC: row.actual.actualTrainingStartHc,
      Planned_Training_HC: row.planned.trainingHc,
      Actual_Training_HC: row.actual.trainingHc,
      Planned_Nesting_HC: row.planned.nestingHc,
      Actual_Nesting_HC: row.actual.nestingHc,
      Planned_Training_Attrition_HC: row.planned.trainingAttritionHc,
      Actual_Training_Attrition_HC: row.actual.trainingAttritionHc,
      Planned_Nesting_Attrition_HC: row.planned.nestingAttritionHc,
      Actual_Nesting_Attrition_HC: row.actual.nestingAttritionHc,
      Planned_Graduate_HC: row.planned.graduateHc,
      Actual_Graduate_HC: row.actual.graduateHc,
      Planned_Attrition_HC: row.planned.attritionHc,
      Actual_Attrition_HC: row.actual.attritionHc,
      Planned_Transfer_In_HC: row.planned.transferInHc,
      Actual_Transfer_In_HC: row.actual.transferInHc,
      Planned_Transfer_Out_HC: row.planned.transferOutHc,
      Actual_Transfer_Out_HC: row.actual.transferOutHc,
      Planned_Offroster_LOA_HC: row.planned.offRosterLoaHc,
      Actual_Offroster_LOA_HC: row.actual.offRosterLoaHc,
      Planned_Support_HC: row.planned.supportHc,
      Actual_Support_HC: row.actual.supportHc,
      Planned_Production_HC: row.planned.productionHc,
      Actual_Production_HC: row.actual.productionHc,
      Planned_Volume: row.planned.volume,
      Actual_Volume: row.actual.offeredVolume,
      Planned_Handled_Volume: row.planned.handledVolume,
      Actual_Handled_Volume: row.actual.handledVolume,
      Planned_AHT: row.planned.ahtSeconds,
      Actual_AHT: row.actual.ahtSeconds,
      Planned_Capped_AHT: row.planned.cappedAhtSeconds,
      Actual_Capped_AHT: row.actual.cappedAhtSeconds,
      Planned_Shrinkage_Pct: row.planned.shrinkagePct,
      Actual_Shrinkage_Pct: row.actual.shrinkagePct,
      Planned_Required_FTE: row.planned.requiredFte,
      Actual_Required_FTE: row.actual.requiredFte,
      Planned_Production_FTE: row.planned.productionFte,
      Actual_Production_FTE: row.actual.productionFte,
      Planned_Staffing_Pct: row.planned.staffingPct,
      Actual_Staffing_Pct: row.actual.staffingPct,
    })),
  )
  XLSX.utils.book_append_sheet(workbook, capacitySheet, 'Capacity_Plan')

  if (forecast) {
    const forecastSheet = XLSX.utils.json_to_sheet(
      forecast.metrics.flatMap((metric) =>
        metric.forecast.map((point) => ({
          Metric: metric.label,
          Week: point.label,
          Value: point.value,
          Source: point.source,
          Selected_Model: metric.selectedModel?.label ?? '',
          RMSE: metric.selectedModel?.rmse ?? '',
          MAE: metric.selectedModel?.mae ?? '',
        })),
      ),
    )
    XLSX.utils.book_append_sheet(workbook, forecastSheet, 'Forecasts')
  }

  const scenarioSheet = XLSX.utils.json_to_sheet([
    {
      Scenario: scenario.name,
      Client: scenario.plan.client,
      LOB: scenario.plan.location,
      Billing_Type: scenario.plan.billingType,
      Week_Start: scenario.plan.weekStart,
      Training_Weeks: scenario.assumptions.newHire.trainingWeeks,
      Nesting_Weeks: scenario.assumptions.newHire.nestingWeeks,
      Training_Attrition: scenario.assumptions.newHire.trainingAttritionRate,
      Nesting_Attrition: scenario.assumptions.newHire.nestingAttritionRate,
    },
  ])
  XLSX.utils.book_append_sheet(workbook, scenarioSheet, 'Scenario')

  if (clientSheets.length > 1) {
    const combinedSheet = XLSX.utils.json_to_sheet(
      clientSheets.flatMap((sheet) =>
        sheet.rows.map((row) => ({
          Week: row.week,
          Status: row.statusLabel,
          Client: sheet.scenario.plan.client,
          LOB: sheet.scenario.plan.location,
          Planned_Required_FTE: row.planned.requiredFte,
          Actual_Required_FTE: row.actual.requiredFte,
          Planned_Production_FTE: row.planned.productionFte,
          Actual_Production_FTE: row.actual.productionFte,
          Planned_Volume: row.planned.volume,
          Actual_Volume: row.actual.offeredVolume,
        })),
      ),
    )
    XLSX.utils.book_append_sheet(workbook, combinedSheet, 'Combined')
  }

  XLSX.writeFile(workbook, `Full_Capacity_Plan_${scenario.name.replace(/[^\w-]+/g, '_')}.xlsx`)
}

function avg(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function avgNullable(values: Array<number | null>): number | null {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (!filtered.length) return null
  return avg(filtered)
}

function sumNullable(values: Array<number | null>): number | null {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (!filtered.length) return null
  return filtered.reduce((sum, value) => sum + value, 0)
}

function combineMetricSnapshot(rows: CapacityMetricSnapshot[]): CapacityMetricSnapshot {
  const beginningProductionHc = rows.reduce((sum, row) => sum + row.beginningProductionHc, 0)
  const presentRequired = rows
    .map((row) => row.requiredFte)
    .filter((value): value is number => value != null && Number.isFinite(value) && value !== 0)
  const presentProduction = rows
    .map((row) => row.productionFte)
    .filter((value): value is number => Number.isFinite(value) && value !== 0)
  const requiredFte = presentRequired.length
    ? presentRequired.reduce((sum, value) => sum + value, 0)
    : null
  const productionFte = presentProduction.length
    ? presentProduction.reduce((sum, value) => sum + value, 0)
    : 0
  const attritionHc = rows.reduce((sum, row) => sum + row.attritionHc, 0)
  return {
    beginningProductionHc,
    plannedNewHires: rows.reduce((sum, row) => sum + row.plannedNewHires, 0),
    actualTrainingStartHc: rows.reduce((sum, row) => sum + row.actualTrainingStartHc, 0),
    trainingHc: rows.reduce((sum, row) => sum + row.trainingHc, 0),
    nestingHc: rows.reduce((sum, row) => sum + row.nestingHc, 0),
    graduateHc: rows.reduce((sum, row) => sum + row.graduateHc, 0),
    trainingAttritionHc: rows.reduce((sum, row) => sum + row.trainingAttritionHc, 0),
    nestingAttritionHc: rows.reduce((sum, row) => sum + row.nestingAttritionHc, 0),
    trainingAttritionPct: avgNullable(rows.map((row) => row.trainingAttritionPct)),
    nestingAttritionPct: avgNullable(rows.map((row) => row.nestingAttritionPct)),
    attritionHc,
    attritionPct: beginningProductionHc > 0 ? attritionHc / beginningProductionHc : null,
    transferInHc: rows.reduce((sum, row) => sum + row.transferInHc, 0),
    transferOutHc: rows.reduce((sum, row) => sum + row.transferOutHc, 0),
    offRosterLoaHc: rows.reduce((sum, row) => sum + row.offRosterLoaHc, 0),
    supportHc: rows.reduce((sum, row) => sum + row.supportHc, 0),
    volume: rows.reduce((sum, row) => sum + row.volume, 0),
    offeredVolume: rows.reduce((sum, row) => sum + row.offeredVolume, 0),
    handledVolume: rows.reduce((sum, row) => sum + (row.handledVolume ?? 0), 0),
    ahtSeconds: avg(rows.map((row) => row.ahtSeconds ?? 0)),
    cappedAhtSeconds: avg(rows.map((row) => row.cappedAhtSeconds ?? 0)),
    occupancy: avg(rows.map((row) => row.occupancy)),
    shrinkagePct: avg(rows.map((row) => row.shrinkagePct)),
    nestingPhoneTimePct: avg(rows.map((row) => row.nestingPhoneTimePct)),
    productionHc: rows.reduce((sum, row) => sum + row.productionHc, 0),
    requiredFte,
    coreProductionFte: rows.reduce((sum, row) => sum + row.coreProductionFte, 0),
    nestingProductiveFte: rows.reduce((sum, row) => sum + row.nestingProductiveFte, 0),
    productionFte,
    staffingPct: requiredFte != null && requiredFte > 0 ? productionFte / requiredFte : null,
    overUnderFte: rows.reduce((sum, row) => sum + row.overUnderFte, 0),
    scheduledBillableHours: sumNullable(rows.map((row) => row.scheduledBillableHours)),
    actualBillableHours: sumNullable(rows.map((row) => row.actualBillableHours)),
    productiveHours: sumNullable(rows.map((row) => row.productiveHours)),
    payrollHours: sumNullable(rows.map((row) => row.payrollHours)),
    switchHours: sumNullable(rows.map((row) => row.switchHours)),
  }
}

export function combineCapacityRows(groups: DerivedCapacityRow[][]): DerivedCapacityRow[] {
  const buckets = new Map<string, DerivedCapacityRow[]>()
  groups.flat().forEach((row) => {
    buckets.set(row.week, [...(buckets.get(row.week) ?? []), row])
  })
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, bucket]) => {
      const first = bucket[0]!
      return {
        ...first,
        week,
        planned: combineMetricSnapshot(bucket.map((row) => row.planned)),
        actual: combineMetricSnapshot(bucket.map((row) => row.actual)),
        shrinkageCategories: first.shrinkageCategories?.map((category) => {
          const peers = bucket.flatMap((row) =>
            (row.shrinkageCategories ?? []).filter((item) => item.id === category.id),
          )
          if (!peers.length) return category
          const plannedPct = peers.reduce((sum, item) => sum + item.plannedPct, 0) / peers.length
          const actualValues = peers.map((item) => item.actualPct).filter((value): value is number => value != null)
          return {
            ...category,
            plannedPct,
            actualPct: actualValues.length ? actualValues.reduce((sum, value) => sum + value, 0) / actualValues.length : null,
          }
        }),
        combinedGroupShrinkage: {
          outOfOfficePlanned: avgNullable(
            bucket.map((row) => groupShrinkageTotal(row, 'out_of_office', 'planned')),
          ),
          outOfOfficeActual: avgNullable(
            bucket.map((row) => groupShrinkageTotal(row, 'out_of_office', 'actual')),
          ),
          inOfficePlanned: avgNullable(
            bucket.map((row) => groupShrinkageTotal(row, 'in_office', 'planned')),
          ),
          inOfficeActual: avgNullable(
            bucket.map((row) => groupShrinkageTotal(row, 'in_office', 'actual')),
          ),
        },
        forecastModelVolume: bucket.length > 1 ? 'Combined' : first.forecastModelVolume,
        forecastModelAht: bucket.length > 1 ? 'Combined' : first.forecastModelAht,
        forecastModelShrinkage: bucket.length > 1 ? 'Combined' : first.forecastModelShrinkage,
        forecastModelAttrition: bucket.length > 1 ? 'Combined' : first.forecastModelAttrition,
      }
    })
}

function groupShrinkageTotal(
  row: DerivedCapacityRow,
  group: 'out_of_office' | 'in_office',
  kind: 'planned' | 'actual',
): number | null {
  const cats = (row.shrinkageCategories ?? []).filter((item) => item.group === group)
  if (!cats.length) {
    // Fall back to the snapshot total only for the full (both groups) case via shrinkagePct.
    return null
  }
  if (kind === 'planned') {
    return cats.reduce((sum, item) => sum + item.plannedPct, 0)
  }
  const actuals = cats
    .map((item) => item.actualPct)
    .filter((value): value is number => value != null && Number.isFinite(value))
  if (!actuals.length) return null
  return actuals.reduce((sum, value) => sum + value, 0)
}

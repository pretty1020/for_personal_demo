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
import type { PlannerAssumptions, PlannerPlanMetadata, PlannerScenario, WeekStart } from './types'
import type { WeekCapacityPlanOverride } from './capacityPlanOverridePersistence'
import type { StageAttritionOverride } from './capacityStageAttritionPersistence'
import type { LedgerMetricSnapshot, WeeklyLedgerRow } from './weeklyLedger'
import {
  DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS,
  isShrinkageCategoryVisible,
  resolveActiveShrinkageCategoryIds,
} from './shrinkageCategories'

/** Planned Vacation Leave % (0–1) from category rows. */
export function plannedVacationLeavePctFromCategories(
  categories: Array<{ id: string; plannedPct: number }>,
): number {
  const item = categories.find((category) => category.id === 'vacation_leave')
  const pct = item?.plannedPct ?? 0
  return Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0))
}

/**
 * VL Allocation HC = (Planned Vacation Leave % × Production Headcount × 40) / 5.
 * Does not subtract from Production HC — derived metric only.
 */
export function computeVlAllocationHc(vacationLeavePct: number, productionHc: number): number {
  const pct = Math.max(0, Math.min(1, Number.isFinite(vacationLeavePct) ? vacationLeavePct : 0))
  const hc = Math.max(0, productionHc)
  return Math.round((pct * hc * 40) / 5)
}
import { resolveCapacityPlanStartWeek, resolveCapacityWeekStatus, resolveCurrentCalendarWeek } from './capacityWeekUtils'
import { DEFAULT_PLANNED_OCCUPANCY } from './defaults'
import { getTotalStartingProductionHc } from './channelPlanning'
import {
  calculateWorkloadRequiredProductionFte,
  resolveMatrixConcurrencyFactor,
  resolveRequiredProductionFteForPlan,
  shouldPreferChannelRequiredFte,
} from './requiredProductionFte'
import { isFteBillingPlan } from '../utils/staffingCapacity/billingModel'
import type { RosterEmployee } from './rosterPersistence'
import { statusAsOfWeek, weeklyPipelineStage } from './rosterStatus'
import { DEMO_NESTING_AHT_MULTIPLIER } from './demoHistoricalSeries'
import { evaluateFormulaOrFallback, formulaScopeFromPlan, type FormulaScope } from './formulas/formulaRegistry'

const WEEKS_PER_MONTH = 4.33

/** Structural AHT premium for nesting agents vs production-only handle time. */
export const DEFAULT_NESTING_AHT_MULTIPLIER = DEMO_NESTING_AHT_MULTIPLIER
const MIN_RELIABLE_NESTING_MULTIPLIER = 1.12

function availableFteAfterShrink(productionHc: number, shrinkage: number, scope?: FormulaScope): number {
  const fallback = productionHc * (1 - shrinkage)
  const value = evaluateFormulaOrFallback(
    'capacity.availableFte',
    { productionHc, shrinkage },
    fallback,
    scope,
  )
  return Number.isFinite(value) && value >= 0 ? value : Math.max(0, fallback)
}

/**
 * Share of the week's contacts handled by the nesting cohort.
 *
 * AHT averages over contacts, not over agents, so the two cohorts combine by the
 * contacts they each handle. Agents working the same hours at a slower handle
 * time get through proportionally fewer of them, which makes the nesting share
 * of contacts strictly smaller than its share of the floor:
 *
 *   share = (Nn / AHTn) / (Np / AHTp + Nn / AHTn)
 *
 * Twenty nesting agents beside eighty production agents at 1.3x the handle time
 * are a fifth of the headcount but only about a sixth of the contacts.
 */
export function nestingContactShare(
  nestingHc: number,
  productionHc: number,
  nestingAhtSeconds: number,
  productionAhtSeconds: number,
  /**
   * Share of the week each cohort spends on the phone.
   *
   * A nesting agent is not merely slower, they are on the phone far less — this
   * plan ramps them from a quarter of a normal week upward. Ignoring that
   * credits the cohort with contacts it never takes and overstates its pull on
   * the blended average. Defaulted to full time so callers that genuinely have
   * no phone-time figure behave as before.
   */
  nestingPhoneTimePct = 1,
  productionPhoneTimePct = 1,
): number {
  const nesting = Math.max(0, nestingHc) * Math.max(0, nestingPhoneTimePct)
  const production = Math.max(0, productionHc) * Math.max(0, productionPhoneTimePct)
  if (nesting <= 0) return 0
  if (production <= 0) return 1

  const nestingRate = nesting / Math.max(1, nestingAhtSeconds)
  const productionRate = production / Math.max(1, productionAhtSeconds)
  const total = nestingRate + productionRate
  return total > 0 ? Math.min(1, nestingRate / total) : 0
}

/**
 * Phone-time share used when blending Nesting into Mix-adj. AHT.
 *
 * Stage maps can report 0% (silent observation, or an empty ramp). Mix-adj still
 * has to move when Nesting HC is on the floor — otherwise AHT and Mix-adj read
 * identical and the Nesting column looks decorative. Fall back to the plan
 * assumption, then to full time, so Nesting HC always pulls Mix-adj above the
 * production-only base.
 */
export function effectiveNestingPhoneTimeForMix(
  nestingHc: number,
  nestingPhoneTimePct: number,
  assumptionPhoneTimePct?: number | null,
): number {
  if (nestingHc <= 0) return 0
  if (nestingPhoneTimePct > 0) return nestingPhoneTimePct
  if (assumptionPhoneTimePct != null && assumptionPhoneTimePct > 0) return assumptionPhoneTimePct
  return 1
}

/**
 * Blended AHT for a week staffed by two cohorts, weighted by contact share.
 *
 * Once the share is expressed in contacts rather than agents this is a plain
 * weighted average, which is exactly what a blended AHT is: total handle time
 * divided by total contacts.
 */
export function blendedAhtFromContactShare(
  productionAhtSeconds: number,
  nestingAhtSeconds: number,
  contactShare: number,
): number {
  const share = Math.min(1, Math.max(0, contactShare))
  return productionAhtSeconds * (1 - share) + nestingAhtSeconds * share
}

/**
 * Average handle time across a nesting cohort that is ramping.
 *
 * A nesting agent starts slow and improves in a straight line to production
 * handle time over `rampWeeks`. The plan records how many agents are in nesting
 * each week but not how long each has been there, and in a programme with steady
 * intake they are spread evenly across the ramp — week one alongside week four.
 * So the figure the blend needs is the average over that spread, not the
 * starting value:
 *
 *   average = production + gap x (1 - (N - 1) / 2N)
 *
 * At N = 1 that is the full gap, since nobody has had time to improve. As N
 * grows it converges on the halfway point, which is what a linear ramp averages
 * to. Using the starting value instead would charge every agent the first-week
 * penalty for their whole time in nesting.
 */
export function rampAveragedNestingAht(
  nestingAhtSeconds: number,
  productionAhtSeconds: number,
  rampWeeks: number,
): number {
  const weeks = Math.max(1, Math.round(rampWeeks))
  const gap = nestingAhtSeconds - productionAhtSeconds
  if (gap <= 0) return nestingAhtSeconds
  return productionAhtSeconds + gap * (1 - (weeks - 1) / (2 * weeks))
}

/**
 * Handle time for an agent this far through the nesting ramp.
 *
 * Tenure 0 is their first week and pays the whole gap; by `rampWeeks` they are
 * at production speed. Past that the ramp is over and there is nothing left to
 * pay, which matters when a ramp is shorter than the nesting period.
 */
export function ahtAtNestingTenure(
  tenureWeeks: number,
  nestingAhtSeconds: number,
  productionAhtSeconds: number,
  rampWeeks: number,
): number {
  const weeks = Math.max(1, Math.round(rampWeeks))
  const gap = nestingAhtSeconds - productionAhtSeconds
  if (gap <= 0) return nestingAhtSeconds
  const progress = Math.min(1, Math.max(0, tenureWeeks / weeks))
  return productionAhtSeconds + gap * (1 - progress)
}

/**
 * Nesting handle time for one week, weighted by who is actually on the floor.
 *
 * `stageHeadcounts[i]` is how many agents are in their (i+1)th week of nesting
 * that week, which the hiring pipeline already works out cohort by cohort. That
 * removes the assumption the ramp average has to make: a programme hiring
 * steadily has every tenure present at once and lands near the average, while
 * one big training class walks down the ramp together — expensive in the weeks
 * after it graduates, cheap later. Both come out right from the same sum.
 *
 * Returns null when no cohort is on the floor, leaving the caller to fall back
 * to the average rather than inventing a number from an empty mix.
 */
export function tenureWeightedNestingAht(
  stageHeadcounts: number[],
  nestingAhtSeconds: number,
  productionAhtSeconds: number,
  rampWeeks: number,
): number | null {
  let headcount = 0
  let weighted = 0

  stageHeadcounts.forEach((hc, tenure) => {
    const people = Math.max(0, hc)
    if (people <= 0) return
    headcount += people
    weighted += people * ahtAtNestingTenure(tenure, nestingAhtSeconds, productionAhtSeconds, rampWeeks)
  })

  return headcount > 0 ? weighted / headcount : null
}

/**
 * The nesting picture for one planned week, ready for the blend.
 *
 * Three ways to describe the same cohort, in descending order of what is known:
 * weight the ramp by the tenure mix the hiring pipeline reports; failing that
 * average the ramp, which assumes steady intake; failing that treat nesting as
 * one flat premium. The result is an analysis the blend can consume directly,
 * with the ramp cleared once it has been walked so it cannot be applied twice.
 */
export function nestingAnalysisForWeek(
  baseForecastAht: number,
  stageHeadcounts: number[],
  analysis: HistoricalAhtAnalysis,
  rampWeeks: number | null,
  tenuredBaseAht?: number,
): { analysis: HistoricalAhtAnalysis; basis: 'tenure-mix' | 'ramp-average' | 'flat' } {
  if (rampWeeks == null || rampWeeks < 1) {
    return { analysis: { ...analysis, nestingRampWeeks: undefined }, basis: 'flat' }
  }

  // The handle time a cohort starts nesting at, before any ramp is walked.
  const startingNestingAht = resolveNestingAht(
    baseForecastAht,
    { ...analysis, nestingRampWeeks: undefined },
    tenuredBaseAht,
  ).seconds

  const weighted = tenureWeightedNestingAht(
    stageHeadcounts,
    startingNestingAht,
    baseForecastAht,
    rampWeeks,
  )

  if (weighted != null) {
    return {
      analysis: {
        ...analysis,
        assumedNestingAhtSeconds: weighted,
        nestingRampWeeks: undefined,
      },
      basis: 'tenure-mix',
    }
  }

  return { analysis: { ...analysis, nestingRampWeeks: rampWeeks }, basis: 'ramp-average' }
}

export type NestingAhtResolution = {
  seconds: number
  /** Handle time in the first week of nesting, when a ramp is being modelled. */
  startSeconds?: number
  /** Weeks the ramp runs over, when one is set. */
  rampWeeks?: number
  /**
   * Which input actually decided it.
   *
   * 'stated' means a planner said so and the multiplier plays no part;
   * 'measured' means this plan's own nesting weeks produced it; 'multiplier'
   * means neither was available and a premium was applied to the production
   * baseline instead.
   */
  source: 'stated' | 'measured' | 'multiplier'
}

/**
 * What a nesting agent is taken to handle at, and which input decided it.
 *
 * Shared by the blend and by the screen that explains the blend, so a planner
 * reading "which of my settings is doing the work" is told by the same code that
 * does it — rather than by a description that can drift away from the model.
 */
export function resolveNestingAht(
  productionAhtSeconds: number,
  analysis?: HistoricalAhtAnalysis | null,
  tenuredBaseAht?: number,
): NestingAhtResolution {
  const base = Math.max(1, productionAhtSeconds)

  /**
   * Whatever a nesting agent starts at, averaged across the ramp when one is
   * set. Applied here rather than in the blend so the panel explaining the
   * numbers and the model producing them cannot disagree.
   */
  const withRamp = (seconds: number, source: NestingAhtResolution['source']) => {
    const rampWeeks = analysis?.nestingRampWeeks
    if (rampWeeks == null || rampWeeks <= 0) return { seconds, source }
    return {
      seconds: rampAveragedNestingAht(seconds, base, rampWeeks),
      source,
      startSeconds: seconds,
      rampWeeks: Math.max(1, Math.round(rampWeeks)),
    }
  }

  if (analysis?.assumedNestingAhtSeconds != null) {
    return withRamp(analysis.assumedNestingAhtSeconds, 'stated')
  }

  const multiplier = analysis?.nestingMultiplier ?? DEFAULT_NESTING_AHT_MULTIPLIER
  const prodOnlyBenchmark = analysis?.productionOnlyAht ?? tenuredBaseAht ?? base / multiplier

  if (analysis?.withNestingAht != null) {
    // Carried along with the forecast, so the nesting track follows the same
    // trend rather than sitting at a fixed historical level.
    const trendScale = prodOnlyBenchmark > 0 ? base / prodOnlyBenchmark : 1
    return withRamp(
      analysis.withNestingAht * trendScale,
      analysis.weeksWithNesting > 0 ? 'measured' : 'multiplier',
    )
  }

  return withRamp(base * multiplier, 'multiplier')
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
  volume: number
  offeredVolume: number
  handledVolume: number | null
  ahtSeconds: number | null
  cappedAhtSeconds: number | null
  occupancy: number
  shrinkagePct: number
  nestingPhoneTimePct: number
  productionHc: number
  /** Derived: (Vacation Leave % × Production HC × 40) / 5 — does not reduce Production HC. */
  vlAllocationHc: number
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
  seatCount: number | null
  peakRatioPct: number | null
  onsiteHc: number | null
  wahHc: number | null
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
): { value: number | null; skipMatrixFallback: boolean } {
  const manual =
    ledgerRequiredFte != null && Number.isFinite(ledgerRequiredFte) && ledgerRequiredFte >= 0
      ? ledgerRequiredFte
      : null
  // Uploaded / manual Required FTE always wins — never fall back to volume×AHT.
  if (manual != null) {
    return { value: manual, skipMatrixFallback: true }
  }
  if (isFteBillingPlan(plan.billingType)) {
    return { value: null, skipMatrixFallback: true }
  }

  // True zero demand → Required FTE is 0.
  if (!(weeklyVolume > 0)) {
    return { value: 0, skipMatrixFallback: true }
  }

  if (shouldPreferChannelRequiredFte(plan, assumptions)) {
    const channelRequired = resolveRequiredProductionFteForPlan(assumptions, plan, weeklyVolume, {
      volume: weeklyVolume,
      ahtSeconds: weeklyDrivers?.ahtSeconds,
      occupancy: weeklyDrivers?.occupancy,
      cappedAhtSeconds: weeklyDrivers?.cappedAhtSeconds,
    })
    // Only trust a positive channel result. Zero/null with positive volume means incomplete
    // channel setup — fall through to matrix Volume × AHT ÷ Occupancy.
    if (channelRequired != null && channelRequired > 0) {
      return { value: channelRequired, skipMatrixFallback: true }
    }
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
  /**
   * Where the multiplier came from.
   *
   * 'measured' only when this plan's own nesting weeks produced a figure that
   * cleared the reliability floor. Otherwise it is the structural default, which
   * is an industry assumption about this account rather than a fact about it —
   * a distinction that has to survive to the screen, because a planner cannot
   * defend a number to a client without knowing which one they are looking at.
   */
  nestingMultiplierSource: 'measured' | 'assumed' | 'override'
  /**
   * Nesting handle time stated by the planner, in seconds.
   *
   * For accounts with no nesting history, where nothing can be measured and the
   * alternative is a default multiplier applied to a figure it was never derived
   * from.
   */
  assumedNestingAhtSeconds?: number
  /**
   * Share of contacts the planner says nesting handles, 0 to 1.
   *
   * Overrides the share implied by headcount, for programmes that deliberately
   * throttle what reaches a nesting cohort.
   */
  assumedNestingContactShare?: number
  /**
   * Weeks a nesting agent takes to reach production handle time.
   *
   * Turns a flat nesting penalty into a ramp: the cohort improves in a straight
   * line from its starting handle time down to production over this many weeks,
   * and the blend uses the average across that ramp. Left unset, nesting is
   * treated as one fixed premium for as long as the agents are in it.
   */
  nestingRampWeeks?: number
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
  /** Share of a planned nesting agent's week spent on the phone, 0 to 1. */
  nestingPhoneTimePct: number
  /** The same for weeks that have happened. */
  actualNestingPhoneTimePct: number
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
    // How much of a nesting agent's week actually reaches the phone. The plan
    // already ramps this; the AHT blend needs it to know how many contacts the
    // cohort can take.
    nestingPhoneTimePct: row.planned.nestingPhoneTimePct,
    actualNestingPhoneTimePct: row.actual.nestingPhoneTimePct,
  }
}

export function capacityHeadcountByWeek(rows: DerivedCapacityRow[]): Map<string, CapacityWeekHeadcount> {
  return new Map(rows.map((row) => [row.week, capacityWeekHeadcount(row)]))
}

/**
 * Nesting / Production HC + phone time for historical weeks, for AHT forecast demix.
 *
 * The forecast series must de-mix recorded AHT on the same staffing basis the
 * Capacity plan uses — ledger headcount alone omits phone-time ramp and can
 * disagree with derived staffing when overrides reshape the floor.
 */
export function capacityAhtMixHeadcountByWeek(
  rows: DerivedCapacityRow[],
): Map<string, { nestingHc: number; productionHc: number; nestingPhoneTimePct: number }> {
  const map = new Map<string, { nestingHc: number; productionHc: number; nestingPhoneTimePct: number }>()
  for (const row of rows) {
    if (row.timeline !== 'historical_actual') continue
    const hc = capacityWeekHeadcount(row)
    map.set(row.week, {
      nestingHc: hc.nestingHc,
      productionHc: hc.productionHc,
      nestingPhoneTimePct: hc.actualNestingPhoneTimePct,
    })
  }
  return map
}

export function ledgerHeadcount(
  row: WeeklyLedgerRow,
  field: 'productionHc' | 'nestingHc' | 'trainingHc',
): number | null {
  const actual = row.actual?.[field]
  if (actual != null && Number.isFinite(actual)) return actual
  const planned = row.planned[field]
  if (planned != null && Number.isFinite(planned)) return planned
  return null
}

function resolveHistoricalHeadcount(
  row: WeeklyLedgerRow,
  field: 'trainingHc' | 'nestingHc' | 'productionHc',
  fallback: number,
): number {
  if (row.timeline !== 'historical_actual') return fallback
  const fromLedger = row.actual?.[field]
  if (fromLedger != null && Number.isFinite(fromLedger)) return roundedWhole(fromLedger)
  return fallback
}

export function countInactiveProductionRoster(
  roster: RosterEmployee[],
  planningWeek: string | null,
  weekStart: WeekStart = 'sunday',
): number {
  if (!planningWeek) return 0
  return roster.filter((employee) => {
    const status = statusAsOfWeek(employee, planningWeek, weekStart)
    if (status === 'active') return false
    return weeklyPipelineStage(employee, planningWeek, weekStart) === 'inactive' && Boolean(employee.productionDate) && employee.productionDate <= planningWeek
  }).length
}

export function applyAhtAnalysisOverrides(
  analysis: HistoricalAhtAnalysis,
  overrides?: AhtAnalysisOverrides | null,
): HistoricalAhtAnalysis {
  if (!overrides) return analysis

  const nestingMultiplier = overrides.nestingMultiplier ?? analysis.nestingMultiplier

  /**
   * The with-nesting benchmark has to move with the multiplier that defines it.
   *
   * It is derived as production-only times the multiplier, and was left at its
   * original value when a planner overrode that multiplier. Since the benchmark
   * outranks the multiplier downstream, overriding the multiplier changed the
   * number on screen and nothing else — the forecast carried on using the
   * premium the override was meant to replace.
   */
  const withNestingAht =
    overrides.nestingMultiplier != null && analysis.productionOnlyAht != null
      ? analysis.productionOnlyAht * nestingMultiplier
      : analysis.withNestingAht

  return {
    ...analysis,
    nestingMultiplier,
    withNestingAht,
    nestingMultiplierSource:
      overrides.nestingMultiplier != null ? 'override' : analysis.nestingMultiplierSource,
    assumedNestingAhtSeconds: overrides.nestingAhtSeconds ?? analysis.assumedNestingAhtSeconds,
    assumedNestingContactShare:
      overrides.nestingContactShare ?? analysis.assumedNestingContactShare,
    nestingRampWeeks: overrides.nestingRampWeeks ?? analysis.nestingRampWeeks,
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
  const measured =
    heavyAvg != null &&
    productionOnlyAht != null &&
    productionOnlyAht > 0 &&
    observedMultiplier >= MIN_RELIABLE_NESTING_MULTIPLIER
  const nestingMultiplier = measured ? observedMultiplier : structuralMultiplier
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
    nestingMultiplierSource: measured ? 'measured' : 'assumed',
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
  /**
   * Share of the week a nesting agent spends on the phone. Left at full time
   * only when the plan genuinely cannot say — every real week has a figure, and
   * assuming full time overstates how many contacts the cohort absorbs.
   */
  nestingPhoneTimePct = 1,
  /**
   * Plan-level nesting phone-time assumption, used when the week/stage figure
   * is zero so Mix-adj still reflects Nesting HC on the floor.
   */
  assumptionPhoneTimePct?: number | null,
): number {
  const base = Math.max(1, baseForecastAht)

  if (nestingHc <= 0) {
    return Math.round(base * 10) / 10
  }

  /**
   * What a nesting agent's handle time is taken to be.
   *
   * An explicit assumption wins, because a planner who knows the programme beats
   * anything inferred — particularly on an account that has never run nesting,
   * where the alternative is a default multiplier standing in for evidence.
   * Otherwise the measured benchmark carries forward, scaled by how far the
   * forecast has moved from the production baseline, so the nesting track
   * follows the same trend rather than sitting at a fixed historical level.
   */
  const resolved = resolveNestingAht(base, analysis, tenuredBaseAht)
  const multiplier = analysis?.nestingMultiplier ?? DEFAULT_NESTING_AHT_MULTIPLIER
  // Prefer resolved when it already sits above production; otherwise enforce a
  // clear premium so Mix-adj cannot collapse to the base AHT column.
  const nestingHandle =
    resolved.seconds > base + 0.05 ? resolved.seconds : base * Math.max(multiplier, 1.05)

  /**
   * The nesting share of contacts, which is what a blended AHT weights by.
   *
   * A planner may state it outright: many programmes throttle the queue into
   * nesting, so the cohort handles far less than its headcount implies and no
   * formula can know that. Left unstated, it follows from headcount and the two
   * handle times.
   */
  const phoneTime = effectiveNestingPhoneTimeForMix(
    nestingHc,
    nestingPhoneTimePct,
    assumptionPhoneTimePct,
  )
  let share =
    analysis?.assumedNestingContactShare != null && analysis.assumedNestingContactShare > 0
      ? analysis.assumedNestingContactShare
      : nestingContactShare(nestingHc, productionHc, nestingHandle, base, phoneTime)

  // Stated share of zero with Nesting HC on the floor would freeze Mix-adj at
  // the production base — the opposite of what the Nesting column implies.
  if (share <= 0 && nestingHc > 0) {
    share = nestingContactShare(nestingHc, productionHc, nestingHandle, base, phoneTime)
  }
  if (share <= 0 && nestingHc > 0) {
    const totalHc = nestingHc + Math.max(0, productionHc)
    share = totalHc > 0 ? nestingHc / totalHc : 1
  }

  const blended = blendedAhtFromContactShare(base, nestingHandle, share)

  /**
   * The learning curve steps aside once a ramp is modelled.
   *
   * Both describe the same thing — that a nesting agent improves — and the ramp
   * does it properly, by averaging a real trajectory rather than shaving a
   * fraction off the blend. Applying both would count the improvement twice.
   */
  if (resolved.rampWeeks != null) {
    return Math.round(Math.max(blended, base + 0.1) * 10) / 10
  }

  const learningPct = analysis?.learningCurveWeeklyImprovementPct ?? 0.02
  const learningReduction = learningPct * share * 0.2
  const adjusted = blended * (1 - learningReduction)

  // Contract: Nesting HC on the floor ⇒ Mix-adj strictly above production-only.
  return Math.round(Math.max(adjusted, base + 0.1) * 10) / 10
}

/** Normalize measured AHT to production-equivalent (removes nesting cohort inflation). */
export function productionEquivalentAhtSeconds(
  rawAhtSeconds: number,
  nestingHc: number,
  productionHc: number,
  analysis?: HistoricalAhtAnalysis | Pick<HistoricalAhtAnalysis, 'nestingMultiplier' | 'learningCurveWeeklyImprovementPct'> | null,
  nestingPhoneTimePct = 1,
): number {
  const raw = Math.max(1, rawAhtSeconds)
  if (nestingHc <= 0) return Math.round(raw * 10) / 10

  const multiplier = analysis?.nestingMultiplier ?? DEFAULT_NESTING_AHT_MULTIPLIER

  /**
   * The inverse of the forward blend, and it has to stay exactly that.
   *
   * Planned AHT is production x (1 + (m - 1) x s) for a nesting contact share s,
   * so recovering production from a measured week means dividing by the same
   * factor. Substituting a nesting handle time of m x production into the
   * contact share cancels production out of it entirely:
   *
   *   s = Nn / (m x Np + Nn)
   *
   * which is why this needs no handle time to compute. It previously divided by
   * an amplified headcount share instead — 1.12 against a true 1.05 on a twenty
   * to eighty mix — which deflated measured AHT by about seven percent too much
   * and carried that straight into the forecast baseline.
   */
  // Same substitution as before, now carrying phone time: with a nesting handle
  // time of m x production, the production AHT cancels and what is left is the
  // ratio of phone hours, each divided by the speed it is worked at.
  const nestingHours = Math.max(0, nestingHc) * Math.max(0, nestingPhoneTimePct)
  const share = nestingHours / Math.max(1e-9, multiplier * productionHc + nestingHours)
  const mixInflation = 1 + (multiplier - 1) * share

  // Mirrors the forward term rather than using a constant of its own, so the
  // round trip closes.
  const learningPct = analysis?.learningCurveWeeklyImprovementPct ?? 0.02
  const learningReduction = learningPct * share * 0.2

  const denominator = mixInflation * (1 - learningReduction)
  return Math.round((denominator > 0 ? raw / denominator : raw) * 10) / 10
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
  fallback: number,
  _seed: number,
  _token: string,
  _higherIsBetter: boolean,
): number {
  if (source != null && Number.isFinite(source)) return source
  // No demo/fallback invention — use planned baseline only when actual was never entered.
  return Math.max(0, fallback)
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
  formulaScope?: FormulaScope,
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
  const coreProductionFte = availableFteAfterShrink(productionHc, normalizedShrinkagePct, formulaScope)
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
    vlAllocationHc: 0,
    supportHc: roundedWhole(overrides?.supportHc ?? 0),
    requiredFte: required,
    coreProductionFte,
    nestingProductiveFte: normalizedNestingProductiveFte,
    productionFte,
    staffingPct: required != null ? safeRatio(productionFte, required) : null,
    overUnderFte: required != null ? productionFte - required : 0,
    scheduledBillableHours: null,
    actualBillableHours: null,
    productiveHours: null,
    payrollHours: null,
    switchHours: null,
    seatCount: null,
    peakRatioPct: null,
    onsiteHc: null,
    wahHc: null,
  }
}

function resolveStaffingDriver(
  mode: CapacityForecastMode | undefined,
  /**
   * Explicit Capacity / Upload template override for this week only.
   * When set, it always wins — forecast mode must not replace uploaded data.
   */
  overrideValue: number | null | undefined,
  forecastValue: number | null,
  previousValue: number | null,
  ledgerValue: number | null = null,
  /** When true, treat 0 as missing so a broken forecast 0 cannot wipe prior/manual volume or AHT. */
  treatZeroAsMissing = false,
): number | null {
  const usable = (value: number | null | undefined): value is number =>
    value != null && Number.isFinite(value) && (!treatZeroAsMissing || value > 0)

  // Upload / cell edit: never fall through to forecast, previous week, or ledger.
  if (usable(overrideValue)) return overrideValue

  if (mode === 'previous_week') {
    if (usable(previousValue)) return previousValue
  }
  if (mode === 'forecast') {
    if (usable(forecastValue)) return forecastValue
    if (usable(previousValue)) return previousValue
  }
  if (usable(ledgerValue)) return ledgerValue
  // Preserve an explicit stored 0 when zero is allowed (e.g. attrition HC).
  if (!treatZeroAsMissing) {
    if (overrideValue != null && Number.isFinite(overrideValue)) return overrideValue
    if (forecastValue != null && Number.isFinite(forecastValue)) return forecastValue
    if (previousValue != null && Number.isFinite(previousValue)) return previousValue
    if (ledgerValue != null && Number.isFinite(ledgerValue)) return ledgerValue
  }
  return null
}

function planInputs(
  rows: WeeklyLedgerRow[],
  scenario: PlannerScenario,
  forecast: ScenarioForecastPackage | null,
  plannedOverrides: Record<string, WeekCapacityPlanOverride> = {},
  forecastModes: Partial<Record<string, CapacityForecastMode>> = {},
  visibleShrinkageCategoryIds: readonly string[] = DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS,
): RowInput[] {
  const futureRows = rows.filter((row) => row.timeline === 'forward_plan')
  const resolvedRows: RowInput[] = []
  const tenuredAht = scenario.assumptions.tenured.ahtSeconds
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
      overrideValue: number | null | undefined,
      forecastValue: number | null,
      previousValue: number | null,
      baselineValue: number,
    ): number => {
      if (row.timeline !== 'forward_plan') return overrideValue ?? 0
      // Explicit upload / override always wins over forecast and previous-week modes.
      if (overrideValue != null && Number.isFinite(overrideValue)) return overrideValue
      if (mode === 'previous_week' && previousValue != null && Number.isFinite(previousValue)) return previousValue
      if (mode === 'forecast') {
        if (forecastValue != null && Number.isFinite(forecastValue) && forecastValue > 0) return forecastValue
        if (previousValue != null && Number.isFinite(previousValue) && previousValue > 0) return previousValue
      }
      if (previousValue != null && Number.isFinite(previousValue)) return previousValue
      return baselineValue
    }
    const volumeBaseline =
      row.planned.callVolume ?? previousMetricValue('callVolume', 'volume') ?? forecastVolume.value ?? 0
    const occupancyManualDefault = override.occupancy ?? DEFAULT_PLANNED_OCCUPANCY
    const occupancyBaseline = occupancyManualDefault
    const attritionBaseline = override.attritionHc ?? row.planned.attritionHc ?? 0
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
    // Planned shrinkage = sum of visible OOO + in-office category % (0 if none visible),
    // unless the planner uploaded/edited an explicit total shrinkage override.
    // When mode is forecast and no override, use the Forecasting totalShrinkage series.
    const shrinkageMode = resolvedCapacityForecastMode(forecastModes, 'totalShrinkagePct')
    const resolvedTotalShrinkage =
      override.totalShrinkagePct != null && Number.isFinite(override.totalShrinkagePct)
        ? override.totalShrinkagePct
        : shrinkageMode === 'forecast' &&
            forecastShrinkage.value != null &&
            Number.isFinite(forecastShrinkage.value)
          ? forecastShrinkage.value
          : visibleCategorySum
    const resolvedVolume =
      resolveStaffingDriver(
        resolvedCapacityForecastMode(forecastModes, 'callVolume'),
        override.callVolume,
        forecastVolume.value,
        previousMetricValue('callVolume', 'volume'),
        row.planned.callVolume,
        true,
      ) ?? volumeBaseline
    const resolvedAht =
      resolveStaffingDriver(
        resolvedCapacityForecastMode(forecastModes, 'ahtSeconds'),
        override.ahtSeconds,
        forecastAht.value,
        previousMetricValue('ahtSeconds', 'ahtSeconds'),
        row.planned.ahtSeconds,
        true,
      ) ?? (tenuredAht > 0 ? tenuredAht : null)
    resolvedRows.push({
      week: row.week,
      timeline: row.timeline,
      volume: roundedWhole(resolvedVolume),
      handledVolume: override.handledVolume ?? row.planned.handledVolume ?? null,
      ahtSeconds: resolvedAht,
      cappedAhtSeconds:
        override.cappedAhtSeconds ??
        row.planned.cappedAhtSeconds ??
        resolvedAht ??
        null,
      occupancy: clampPlannedOccupancy(
        row.timeline !== 'forward_plan'
          ? (override.occupancy ?? row.planned.occupancy ?? DEFAULT_PLANNED_OCCUPANCY)
          : resolveStaffingDriver(
              resolvedCapacityForecastMode(forecastModes, 'occupancy'),
              override.occupancy,
              forecastOccupancy.value,
              previousMetricValue('occupancy', 'occupancy'),
              row.planned.occupancy,
            ) ?? occupancyBaseline,
      ),
      shrinkagePct: clampRate(resolvedTotalShrinkage),
      plannedNewHires: roundedWhole(override.plannedNewHires ?? row.planned.plannedNewHires ?? 0),
      attritionHc: roundedWhole(
        resolvePlannedDriver(
          resolvedCapacityForecastMode(forecastModes, 'attritionHc'),
          override.attritionHc,
          forecastAttrition.value,
          previousMetricValue('attritionHc', 'attritionHc'),
          attritionBaseline,
        ),
      ),
      transferInHc: roundedWhole(override.transferInHc ?? row.planned.transferInHc ?? 0),
      transferOutHc: roundedWhole(override.transferOutHc ?? row.planned.transferOutHc ?? 0),
      offRosterLoaHc: roundedWhole(override.offRosterLoaHc ?? row.planned.offRosterLoaHc ?? 0),
      supportHc: roundedWhole(override.supportHc ?? row.planned.supportHc ?? 0),
      beginningProductionHc: override.beginningProductionHc ?? row.planned.beginningProductionHc ?? null,
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

/** Scale weekly attrition to the roll-forward production base (matches simulation engine). */
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

  if (attritionMode === 'manual' && attritionHcDriver > 0) {
    return roundedWhole(Math.min(attritionHcDriver, rollForwardBase))
  }

  if (attritionMode === 'previous_week') {
    const previousRate =
      previousWeekAttritionPct != null && Number.isFinite(previousWeekAttritionPct)
        ? clampRate(previousWeekAttritionPct)
        : previousWeekPlannedProductionHc > 0 && previousWeekAttritionHc > 0
          ? previousWeekAttritionHc / previousWeekPlannedProductionHc
          : null
    if (previousRate != null && previousRate > 0) {
      return roundedWhole(Math.min(rollForwardBase, rollForwardBase * previousRate))
    }
  }

  if (driverBaseHc > 0 && attritionHcDriver > 0) {
    const impliedRate = attritionHcDriver / driverBaseHc
    const maxReasonableWeeklyRate = Math.max(weeklyAssumptionRate * 4, 0.25)

    /**
     * An implausible rate is capped, not discarded.
     *
     * The same forecast becomes a steeper rate as the team it is applied to
     * shrinks, so a plan losing people crosses this ceiling partway down its own
     * horizon. Substituting the scenario's assumption rate there sent a forecast
     * of two leavers a week to zero the moment headcount fell below eight —
     * silently, and in the direction that leaves a plan short: the weeks that
     * most needed hiring were the ones reported as losing nobody.
     *
     * Capping keeps what the forecast meant, which is heavy attrition, while
     * refusing a figure that cannot be right.
     */
    const appliedRate = Math.min(impliedRate, maxReasonableWeeklyRate)
    return roundedWhole(Math.min(rollForwardBase, rollForwardBase * appliedRate))
  }

  return roundedWhole(rollForwardBase * weeklyAssumptionRate)
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
    // Do not treat forecast as offered when actual offered volume was never entered.
    offeredVolume: 0,
    productionHc: 0,
    vlAllocationHc: 0,
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
  formulaScope?: FormulaScope,
): CapacityMetricSnapshot {
  const productionHc = roundedWhole(savedProductionHc)
  const coreProductionFte = availableFteAfterShrink(productionHc, planned.shrinkagePct, formulaScope)
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
  const baseHistoricalAhtAnalysis = applyAhtAnalysisOverrides(analyzeHistoricalAhtMix(rows), ahtOverrides)
  /** Same ramp default as Forecasting: plan nesting length when no explicit ramp is set. */
  const plannedNestingWeeks = scenario.assumptions.newHire.nestingWeeks
  const nestingRampFallback =
    plannedNestingWeeks != null && plannedNestingWeeks >= 1 ? Math.round(plannedNestingWeeks) : undefined
  const historicalAhtAnalysis = {
    ...baseHistoricalAhtAnalysis,
    nestingRampWeeks: baseHistoricalAhtAnalysis.nestingRampWeeks ?? nestingRampFallback,
  }
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
  const calendarCurrentWeek = resolveCurrentCalendarWeek(scenario.plan.weekStart, scenario.plan.timezone)
  const formulaScope = formulaScopeFromPlan(scenario.plan)
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
    const prevActualFinalNestingHc = index > 0 ? finalNestingStageHcAt(actualStageMaps.nesting, index - 1) : 0
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
    /**
     * Match Forecasting Mix-adj when AHT is driven by forecast.
     * An uploaded / edited Planned AHT override is used as-is — no remix fallback.
     */
    const adjustedPlannedAht = (() => {
      const ahtOverride = plannedOverrides[row.week]?.ahtSeconds
      if (ahtOverride != null && Number.isFinite(ahtOverride)) {
        return ahtOverride
      }
      if (
        row.timeline !== 'forward_plan' ||
        plannedInput.ahtSeconds == null ||
        resolvedCapacityForecastMode(forecastModes, 'ahtSeconds') !== 'forecast'
      ) {
        return plannedInput.ahtSeconds
      }
      const stageHeadcounts = plannedStageMaps.nesting.map((stage) => stage.get(index) ?? 0)
      const { analysis: weekAnalysis } = nestingAnalysisForWeek(
        plannedInput.ahtSeconds,
        stageHeadcounts,
        historicalAhtAnalysis,
        historicalAhtAnalysis.nestingRampWeeks ?? null,
        scenario.assumptions.tenured.ahtSeconds,
      )
      return plannedAhtFromNestingMix(
        plannedInput.ahtSeconds,
        plannedNestingHc,
        plannedProductionHcForMix,
        weekAnalysis,
        scenario.assumptions.tenured.ahtSeconds,
        plannedNestingPhoneTimePct,
        scenario.assumptions.newHire.nestingPhoneTimePct,
      )
    })()
    const ledgerRequiredFte = plannedOverrides[row.week]?.requiredFte ?? null
    const plannedAhtForRequired =
      adjustedPlannedAht != null && adjustedPlannedAht > 0
        ? adjustedPlannedAht
        : scenario.assumptions.tenured.ahtSeconds > 0
          ? scenario.assumptions.tenured.ahtSeconds
          : adjustedPlannedAht
    const plannedOccForRequired =
      plannedInput.occupancy > 0
        ? plannedInput.occupancy
        : scenario.assumptions.tenured.occupancyTarget > 0
          ? scenario.assumptions.tenured.occupancyTarget
          : plannedInput.occupancy
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
    )
    const plannedRequiredFteOverride = plannedRequiredResolution.value
    const skipMatrixRequiredFteFallback = plannedRequiredResolution.skipMatrixFallback
    const attritionMode = resolvedCapacityForecastMode(forecastModes, 'attritionHc')
    const rollForwardAttritionHc = isForwardPlanWeek
      ? (() => {
          const attritionPctOverride = plannedOverrides[row.week]?.attritionPct
          if (attritionPctOverride != null && Number.isFinite(attritionPctOverride)) {
            const rate = clampRate(attritionPctOverride)
            return roundedWhole(Math.min(rollForwardBase, Math.max(0, rollForwardBase * rate)))
          }
          return resolveRollForwardAttritionHc(
            rollForwardBase,
            plannedInput.attritionHc,
            rollForwardBase,
            attritionMode,
            scenario.assumptions.tenured.attritionRateMonthly,
            previousWeekPlannedProductionHc,
            previousWeekAttritionHc,
            previousWeekAttritionPct,
          )
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
      formulaScope,
    )
    plannedSnapshot = {
      ...plannedSnapshot,
      trainingAttritionPct: effectiveTrainingAttritionPct,
      nestingAttritionPct: effectiveNestingAttritionPct,
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
    const weekStatus = resolveCapacityWeekStatus(row.week, row.timeline, scenario.plan.weekStart, scenario.plan.timezone)
    if (isForwardPlanWeek) {
      const savedActualProductionHc =
        actualSource?.productionHc != null && Number.isFinite(actualSource.productionHc)
          ? roundedWhole(actualSource.productionHc)
          : null
      if (isCurrentPlanningWeek && savedActualProductionHc != null && weekStatus !== 'Actual') {
        actualSnapshot = buildCurrentWeekActualSnapshot(plannedSnapshot, savedActualProductionHc, formulaScope)
      } else if (weekStatus === 'Actual') {
        const actualBeginning = roundedWhole(
          actualSource?.beginningProductionHc ?? plannedSnapshot.beginningProductionHc,
        )
        const actualAttrition =
          actualSource?.attritionHc != null && Number.isFinite(actualSource.attritionHc)
            ? roundedWhole(Math.max(0, actualSource.attritionHc))
            : 0
        const actualTransferIn = roundedWhole(
          actualSource?.transferInHc ?? plannedSnapshot.transferInHc,
        )
        const actualTransferOut = roundedWhole(
          actualSource?.transferOutHc ?? plannedSnapshot.transferOutHc,
        )
        const actualOffRosterLoaHc = roundedWhole(
          actualSource?.offRosterLoaHc ?? plannedSnapshot.offRosterLoaHc,
        )
        const actualGraduateHc = roundedWhole(actualSource?.graduateHc ?? plannedSnapshot.graduateHc)
        const actualTrainingHc = roundedWhole(actualSource?.trainingHc ?? plannedSnapshot.trainingHc)
        const actualNestingHc = roundedWhole(actualSource?.nestingHc ?? plannedSnapshot.nestingHc)
        const actualSupportHc = roundedWhole(actualSource?.supportHc ?? plannedSnapshot.supportHc)
        const hasEnteredOffered =
          actualSource?.callVolume != null && Number.isFinite(actualSource.callVolume)
        const actualOfferedVolume = hasEnteredOffered
          ? roundedWhole(Math.max(0, actualSource!.callVolume!))
          : 0
        // Required FTE still needs a volume driver when offered is blank — use forecast.
        const actualVolumeForRequired = hasEnteredOffered
          ? actualOfferedVolume
          : roundedWhole(plannedSnapshot.volume)
        const actualAht =
          actualSource?.ahtSeconds != null &&
          Number.isFinite(actualSource.ahtSeconds) &&
          actualSource.ahtSeconds > 0
            ? actualSource.ahtSeconds
            : plannedSnapshot.ahtSeconds != null && plannedSnapshot.ahtSeconds > 0
              ? plannedSnapshot.ahtSeconds
              : scenario.assumptions.tenured.ahtSeconds > 0
                ? scenario.assumptions.tenured.ahtSeconds
                : null
        const actualCappedAht = actualSource?.cappedAhtSeconds ?? plannedSnapshot.cappedAhtSeconds
        const actualOccupancy = clampOccupancy(
          actualSource?.occupancy != null && Number.isFinite(actualSource.occupancy) && actualSource.occupancy > 0
            ? actualSource.occupancy
            : plannedSnapshot.occupancy > 0
              ? plannedSnapshot.occupancy
              : scenario.assumptions.tenured.occupancyTarget,
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
          actualVolumeForRequired,
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
          actualVolumeForRequired,
          actualOfferedVolume,
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
          formulaScope,
        )
      } else {
        actualSnapshot = buildPlannedWeekActualSnapshot(plannedSnapshot)
      }
    } else {
      const actualBeginning =
        index === 0
          ? actualDriver(
              actualSource?.beginningProductionHc,
              plannedSnapshot.beginningProductionHc || previousActualProductionHc,
              index + 3,
              'actual_beginning_hc',
              true,
            )
          : // Later Actual weeks roll from prior week Actual Production HC (ending HC).
            roundedWhole(previousActualProductionHc)
      const actualAttrition = actualDriver(
        actualSource?.attritionHc,
        plannedSnapshot.attritionHc,
        index + 11,
        'actual_attrition_hc',
        false,
      )
      const actualTransferIn = actualDriver(
        actualSource?.transferInHc,
        plannedSnapshot.transferInHc,
        index + 20,
        'actual_transfer_in',
        true,
      )
      const actualTransferOut = actualDriver(
        actualSource?.transferOutHc,
        plannedSnapshot.transferOutHc,
        index + 21,
        'actual_transfer_out',
        false,
      )
      const actualOffRosterLoaHc = roundedWhole(actualSource?.offRosterLoaHc ?? 0)
      const actualSupportHc = roundedWhole(actualSource?.supportHc ?? 0)
      const hasEnteredOffered =
        actualSource?.callVolume != null && Number.isFinite(actualSource.callVolume)
      const actualOfferedVolume = hasEnteredOffered
        ? roundedWhole(Math.max(0, actualSource!.callVolume!))
        : 0
      const actualVolumeForRequired = hasEnteredOffered
        ? actualOfferedVolume
        : roundedWhole(plannedSnapshot.volume)
      const actualAht =
        actualSource?.ahtSeconds != null &&
        Number.isFinite(actualSource.ahtSeconds) &&
        actualSource.ahtSeconds > 0
          ? actualSource.ahtSeconds
          : plannedSnapshot.ahtSeconds != null && plannedSnapshot.ahtSeconds > 0
            ? plannedSnapshot.ahtSeconds
            : scenario.assumptions.tenured.ahtSeconds > 0
              ? scenario.assumptions.tenured.ahtSeconds
              : null
      const actualCappedAht = actualSource?.cappedAhtSeconds ?? plannedSnapshot.cappedAhtSeconds
      const actualOccupancy = clampOccupancy(
        actualSource?.occupancy != null && Number.isFinite(actualSource.occupancy) && actualSource.occupancy > 0
          ? actualSource.occupancy
          : plannedSnapshot.occupancy > 0
            ? plannedSnapshot.occupancy
            : scenario.assumptions.tenured.occupancyTarget,
      )
      // Match matrix Actual shrinkage rows (OOO + in-office visible categories).
      // Demo-seeded ledger totalShrinkagePct must not silently reduce Production FTE.
      const actualShrinkage = shrinkagePctFromVisibleCategories(
        row.shrinkage,
        activeShrinkageCategoryIds,
        'actual',
      )
      const actualTrainingHc = resolveHistoricalHeadcount(
        row,
        'trainingHc',
        roundedWhole(actualSource?.trainingHc ?? sumStageHcAt(actualStageMaps.training, index)),
      )
      const actualNestingHc = resolveHistoricalHeadcount(
        row,
        'nestingHc',
        roundedWhole(actualSource?.nestingHc ?? sumStageHcAt(actualStageMaps.nesting, index)),
      )
      const actualTrainingAttritionHc = roundedWhole(actualPipelinePeriod.trainingAttrition)
      const actualNestingAttritionHc = roundedWhole(actualPipelinePeriod.nestingAttrition)
      const actualGraduateHc =
        actualSource?.graduateHc != null && Number.isFinite(actualSource.graduateHc)
          ? roundedWhole(actualSource.graduateHc)
          : roundedWhole(prevActualFinalNestingHc * (1 - nestingAttritionRate))
      const actualNestingPhoneTimePct = nestingPhoneTimeFromStageMaps(
        actualStageMaps.nesting,
        index,
        scenario.assumptions,
      )
      const actualHandledVolume = actualSource?.handledVolume ?? null
      const actualRequiredResolution = resolvePlannedRequiredFteOverride(
        scenario.plan,
        scenario.assumptions,
        actualVolumeForRequired,
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
        actualVolumeForRequired,
        actualOfferedVolume,
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
        formulaScope,
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
      seatCount: weekOverride.seatCount ?? row.planned.seatCount ?? null,
      peakRatioPct: weekOverride.peakRatioPct ?? row.planned.peakRatioPct ?? null,
      onsiteHc: weekOverride.onsiteHc ?? row.planned.onsiteHc ?? null,
      wahHc: weekOverride.wahHc ?? row.planned.wahHc ?? null,
    }
    if (weekOverride.productionFte != null && Number.isFinite(weekOverride.productionFte)) {
      const productionFte = Math.max(0, weekOverride.productionFte)
      plannedSnapshot = {
        ...plannedSnapshot,
        productionFte,
        staffingPct:
          plannedSnapshot.requiredFte != null ? safeRatio(productionFte, plannedSnapshot.requiredFte) : null,
        overUnderFte:
          plannedSnapshot.requiredFte != null ? productionFte - plannedSnapshot.requiredFte : 0,
      }
    }
    actualSnapshot = {
      ...actualSnapshot,
      scheduledBillableHours: actualSource?.scheduledBillableHours ?? null,
      actualBillableHours: actualSource?.actualBillableHours ?? null,
      productiveHours: actualSource?.productiveHours ?? null,
      payrollHours: actualSource?.payrollHours ?? null,
      switchHours: actualSource?.switchHours ?? null,
      seatCount: actualSource?.seatCount ?? weekOverride.seatCount ?? null,
      peakRatioPct: actualSource?.peakRatioPct ?? weekOverride.peakRatioPct ?? null,
      onsiteHc: actualSource?.onsiteHc ?? weekOverride.onsiteHc ?? null,
      wahHc: actualSource?.wahHc ?? weekOverride.wahHc ?? null,
    }
    if (actualSource?.productionFte != null && Number.isFinite(actualSource.productionFte)) {
      const productionFte = Math.max(0, actualSource.productionFte)
      actualSnapshot = {
        ...actualSnapshot,
        productionFte,
        staffingPct:
          actualSnapshot.requiredFte != null || plannedSnapshot.requiredFte != null
            ? safeRatio(productionFte, (actualSnapshot.requiredFte ?? plannedSnapshot.requiredFte)!)
            : null,
        overUnderFte:
          plannedSnapshot.requiredFte != null ? productionFte - plannedSnapshot.requiredFte : 0,
      }
    }

    const shrinkageCategories = row.shrinkage.map((item) => ({
      id: item.id,
      name: item.name,
      group: item.group,
      billable: item.billable,
      plannedPct: plannedInput.shrinkageCategoryValues[item.id] ?? item.plannedPct,
      actualPct: item.actualPct,
    }))
    const plannedVlPct = plannedVacationLeavePctFromCategories(shrinkageCategories)
    const actualVlCategory = shrinkageCategories.find((item) => item.id === 'vacation_leave')
    const actualVlPct =
      actualVlCategory?.actualPct != null && Number.isFinite(actualVlCategory.actualPct)
        ? Math.max(0, Math.min(1, actualVlCategory.actualPct))
        : plannedVlPct
    plannedSnapshot = {
      ...plannedSnapshot,
      vlAllocationHc: computeVlAllocationHc(plannedVlPct, plannedSnapshot.productionHc),
    }
    actualSnapshot = {
      ...actualSnapshot,
      vlAllocationHc: computeVlAllocationHc(actualVlPct, actualSnapshot.productionHc),
    }

    return {
      periodIndex: index,
      week: row.week,
      timeline: row.timeline,
      statusLabel: weekStatus,
      isCurrentPlanningWeek,
      planned: plannedSnapshot,
      actual: actualSnapshot,
      shrinkageCategories,
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
      LOB: scenario.plan.lob?.trim() || scenario.plan.location,
      Location: scenario.plan.location,
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
      Planned_Attrition_Pct: row.planned.attritionPct,
      Actual_Attrition_Pct: row.actual.attritionPct,
      Planned_Transfer_In_HC: row.planned.transferInHc,
      Actual_Transfer_In_HC: row.actual.transferInHc,
      Planned_Transfer_Out_HC: row.planned.transferOutHc,
      Actual_Transfer_Out_HC: row.actual.transferOutHc,
      Planned_Offroster_LOA_HC: row.planned.offRosterLoaHc,
      Actual_Offroster_LOA_HC: row.actual.offRosterLoaHc,
      Planned_Support_HC: row.planned.supportHc,
      Actual_Support_HC: row.actual.supportHc,
      Planned_Beginning_Production_HC: row.planned.beginningProductionHc,
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
      Planned_Occupancy: row.planned.occupancy,
      Actual_Occupancy: row.actual.occupancy,
      Planned_Shrinkage_Pct: row.planned.shrinkagePct,
      Actual_Shrinkage_Pct: row.actual.shrinkagePct,
      Planned_Training_Attrition_Pct: row.planned.trainingAttritionPct ?? null,
      Planned_Nesting_Attrition_Pct: row.planned.nestingAttritionPct ?? null,
      Planned_Required_FTE: row.planned.requiredFte,
      Actual_Required_FTE: row.actual.requiredFte,
      Planned_Production_FTE: row.planned.productionFte,
      Actual_Production_FTE: row.actual.productionFte,
      Planned_Staffing_Pct: row.planned.staffingPct,
      Actual_Staffing_Pct: row.actual.staffingPct,
      Planned_Scheduled_Billable_Hours: row.planned.scheduledBillableHours,
      Actual_Billable_Hours: row.actual.actualBillableHours,
      Planned_Productive_Hours: row.planned.productiveHours,
      Planned_Payroll_Hours: row.planned.payrollHours,
      Planned_Switch_Hours: row.planned.switchHours,
      Planned_Seat_Count: row.planned.seatCount,
      Planned_Peak_Ratio_Pct: row.planned.peakRatioPct,
      ...Object.fromEntries(
        (row.shrinkageCategories ?? []).flatMap((category) => [
          [`Planned_Shrinkage_${category.id}`, category.plannedPct],
          [`Actual_Shrinkage_${category.id}`, category.actualPct],
        ]),
      ),
    })),
  )
  XLSX.utils.book_append_sheet(workbook, capacitySheet, 'Capacity_Plan')

  const instructions = XLSX.utils.aoa_to_sheet([
    ['Capacity plan upload template'],
    ['1. Edit Planned_* columns on Capacity_Plan. Those values are re-imported.'],
    ['2. Keep Week as YYYY-MM-DD (week-start dates).'],
    ['3. Planned_Volume maps to Forecast volume; Planned_Required_FTE maps to Required Production FTE.'],
    ['4. Planned_Occupancy and Planned_Shrinkage_Pct accept 0.85 or 85%.'],
    ['5. Planned_Shrinkage_<categoryId> columns update category %. Planned_Training/Nesting_Attrition_Pct update pipeline rates.'],
    ['6. Hours and seats columns (Scheduled_Billable, Productive, Payroll, Switch, Seat_Count, Peak_Ratio) are importable.'],
    ['7. Actual_* columns update historical actual overrides when present.'],
    ['8. Planned_Production_HC is applied on the capacity plan start week only (formula owns later weeks).'],
    ['9. Upload with Overwrite matching weeks or Append / merge. Uploaded drivers switch to Manual mode.'],
  ])
  XLSX.utils.book_append_sheet(workbook, instructions, 'Instructions')

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
      LOB: scenario.plan.lob?.trim() || scenario.plan.location,
      Location: scenario.plan.location,
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
          LOB: sheet.scenario.plan.lob?.trim() || sheet.scenario.plan.location,
          Planned_Required_FTE: row.planned.requiredFte,
          Actual_Required_FTE: row.actual.requiredFte,
          Planned_Production_FTE: row.planned.productionFte,
          Actual_Production_FTE: row.actual.productionFte,
          Planned_Volume: row.planned.volume,
          Actual_Volume: row.actual.offeredVolume,
          Planned_Occupancy: row.planned.occupancy,
          Actual_Occupancy: row.actual.occupancy,
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
  const requiredFte = rows.reduce((sum, row) => sum + (row.requiredFte ?? 0), 0)
  const productionFte = rows.reduce((sum, row) => sum + row.productionFte, 0)
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
    vlAllocationHc: rows.reduce((sum, row) => sum + row.vlAllocationHc, 0),
    requiredFte,
    coreProductionFte: rows.reduce((sum, row) => sum + row.coreProductionFte, 0),
    nestingProductiveFte: rows.reduce((sum, row) => sum + row.nestingProductiveFte, 0),
    productionFte,
    staffingPct: requiredFte > 0 ? productionFte / requiredFte : null,
    overUnderFte: rows.reduce((sum, row) => sum + row.overUnderFte, 0),
    scheduledBillableHours: sumNullable(rows.map((row) => row.scheduledBillableHours)),
    actualBillableHours: sumNullable(rows.map((row) => row.actualBillableHours)),
    productiveHours: sumNullable(rows.map((row) => row.productiveHours)),
    payrollHours: sumNullable(rows.map((row) => row.payrollHours)),
    switchHours: sumNullable(rows.map((row) => row.switchHours)),
    seatCount: avgNullable(rows.map((row) => row.seatCount)),
    peakRatioPct: avgNullable(rows.map((row) => row.peakRatioPct)),
    onsiteHc: sumNullable(rows.map((row) => row.onsiteHc)),
    wahHc: sumNullable(rows.map((row) => row.wahHc)),
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
        forecastModelVolume: bucket.length > 1 ? 'Combined' : first.forecastModelVolume,
        forecastModelAht: bucket.length > 1 ? 'Combined' : first.forecastModelAht,
        forecastModelShrinkage: bucket.length > 1 ? 'Combined' : first.forecastModelShrinkage,
        forecastModelAttrition: bucket.length > 1 ? 'Combined' : first.forecastModelAttrition,
      }
    })
}

import type { PeriodResult, PlannerAssumptions, SimulationResult } from './types'
import { buildSimulatorMatrixValues } from './simulatorMatrixValues'
import { headcountOverUnder } from './workforceMetrics'

/** Rolling cohort used for headcount KPI cards (matches engine summary). */
export const PLANNER_SNAPSHOT_COHORT = 4

export function plannerCohortPeriods(result: SimulationResult, n = PLANNER_SNAPSHOT_COHORT): PeriodResult[] {
  const periods = result.periods
  if (!periods.length) return []
  return periods.slice(-Math.min(n, periods.length))
}

export function plannerLatestPeriod(result: SimulationResult): PeriodResult | null {
  const periods = result.periods
  return periods.length ? periods[periods.length - 1]! : null
}

export function plannerHeadcountSnapshot(result: SimulationResult) {
  const recent = plannerCohortPeriods(result)
  const required = recent.reduce((s, p) => s + p.requiredFte, 0) / Math.max(recent.length, 1)
  const production = recent.reduce((s, p) => s + p.scheduledFte, 0) / Math.max(recent.length, 1)
  const productionFte = recent.reduce((s, p) => s + p.productiveFte, 0) / Math.max(recent.length, 1)
  return {
    requiredHeadcount: required,
    productionHeadcount: production,
    productionFte,
    overUnderStaffing: headcountOverUnder(productionFte, required),
  }
}

export function plannerSnapshotLabel(result: SimulationResult, granularity: string): string {
  const latest = plannerLatestPeriod(result)
  if (!latest) return granularity
  const cohort = plannerCohortPeriods(result)
  const from = cohort[0]?.periodLabel ?? latest.periodLabel
  return `${granularity} · headcount avg ${from}–${latest.periodLabel} · latest ${latest.periodLabel}`
}

type WowBetterMode = 'lower' | 'higher'

function plannedActualOU(
  planned: number | null | undefined,
  actual: number | null | undefined,
  mode: WowBetterMode,
): { ou: number | null; ouPct: number | null } {
  if (planned == null || actual == null || !Number.isFinite(planned) || !Number.isFinite(actual)) {
    return { ou: null, ouPct: null }
  }
  if (mode === 'lower') {
    const ou = planned - actual
    const ouPct = actual !== 0 ? (planned / actual) * 100 : null
    return { ou, ouPct }
  }
  const ou = actual - planned
  const ouPct = planned !== 0 ? (actual / planned) * 100 : null
  return { ou, ouPct }
}

function avgFinite(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v))
  return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null
}

function sumFinite(values: (number | null | undefined)[]): number {
  return values.reduce<number>((s, v) => s + (v != null && Number.isFinite(v) ? v : 0), 0)
}

/** Executive trio / volume KPIs derived from published simulator (same cohort as Planning Simulator Overview). */
export function buildSimulatorExecutiveDisplayKpis(
  result: SimulationResult,
  assumptions: PlannerAssumptions,
  wowBetter: { shrink: WowBetterMode; aht: WowBetterMode },
) {
  const cohort = plannerCohortPeriods(result)
  const matrix = buildSimulatorMatrixValues(cohort, assumptions)
  const hc = plannerHeadcountSnapshot(result)

  const avgPlShrinkFrac = assumptions.tenured.shrinkageRate
  const avgActShrinkFrac = avgFinite(matrix.actualShrink ?? [])
  const avgPlAht = assumptions.tenured.ahtSeconds
  const avgActAht = avgFinite(matrix.actualAht ?? [])
  const plannedAttrPctPortfolio = assumptions.tenured.attritionRateMonthly * 100
  const actualAttrPctPortfolio = avgFinite(matrix.actualAttrPct ?? [])

  const shrinkPair = plannedActualOU(avgPlShrinkFrac, avgActShrinkFrac, wowBetter.shrink)
  const ahtPair = plannedActualOU(avgPlAht, avgActAht, wowBetter.aht)
  const attrPair = plannedActualOU(plannedAttrPctPortfolio, actualAttrPctPortfolio, 'lower')

  const fc = sumFinite(matrix.forecastVol ?? [])
  const off = sumFinite(matrix.offeredVol ?? [])
  const hnd = sumFinite(matrix.handledVol ?? [])
  const volGap = fc - hnd

  const shrinkVar =
    avgPlShrinkFrac != null && avgActShrinkFrac != null ? avgActShrinkFrac - avgPlShrinkFrac : null
  const ahtVar = avgPlAht != null && avgActAht != null ? avgActAht - avgPlAht : null
  const attrRateGapPp =
    actualAttrPctPortfolio != null ? actualAttrPctPortfolio - plannedAttrPctPortfolio : null

  const totalFte = cohort.reduce((s, p) => s + p.productiveFte, 0) / Math.max(cohort.length, 1)
  const portfolioHcOuPct =
    hc.requiredHeadcount > 0 ? (totalFte / hc.requiredHeadcount) * 100 : null

  return {
    totalReq: hc.requiredHeadcount,
    totalAct: hc.productionHeadcount,
    hcOu: hc.overUnderStaffing,
    portfolioHcOuPct,
    totalFte,
    avgPlShrinkFrac,
    avgActShrinkFrac,
    shrinkVar,
    avgPlAht,
    avgActAht,
    ahtVar,
    plannedAttrPctPortfolio,
    actualAttrPctPortfolio,
    attrRateGapPp,
    portfolioShrinkOu: shrinkPair.ou,
    portfolioShrinkOuPct: shrinkPair.ouPct,
    portfolioAhtOu: ahtPair.ou,
    portfolioAhtOuPct: ahtPair.ouPct,
    portfolioAttrOu: attrPair.ou,
    portfolioAttrOuPct: attrPair.ouPct,
    htfPct: fc > 0 ? (hnd / fc) * 100 : null,
    otfPct: fc > 0 ? (off / fc) * 100 : null,
    htoPct: off > 0 ? (hnd / off) * 100 : null,
    fc,
    off,
    hnd,
    volGap,
  }
}

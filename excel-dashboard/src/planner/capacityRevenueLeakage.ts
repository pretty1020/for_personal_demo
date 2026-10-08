import type { DerivedCapacityRow } from './capacityPlanDerived'
import { isActualCapacityWeek } from './capacityFinancialCosts'
import { evaluateFormulaOrFallback, type FormulaScope } from './formulas/formulaRegistry'
import {
  canonicalBillingType,
  classifyBillingModel,
  type BillingModelKind,
} from '../utils/staffingCapacity/billingModel'
import {
  DEFAULT_IN_OFFICE_SHARE_OF_TOTAL_SHRINK,
  IN_OFFICE_NONBILLABLE_SHARE,
} from '../utils/staffingCapacity/shrinkageBreakdown'

export type CapacityLeakageDrivers = {
  /** Understaffing: planned production HC above actual. */
  headcount: number
  /** Overstaffing: actual production HC above planned. */
  overstaffing: number
  /** Non-billable shrinkage overrun vs plan. */
  shrinkage: number
  /** AHT above plan on handled contacts. */
  aht: number
  /** Actual attrition heads above planned leavers. */
  attrition: number
  /** Volume below plan. */
  volume: number
  total: number
}

export type LeakageShrinkageCategory = {
  billable: boolean
  plannedPct: number
  actualPct: number | null
}

const WEEKS_PER_MONTH = 4.33

/** Aggregate heuristic when category-level billable flags are unavailable. */
function nonBillableShrinkFraction(
  shrinkPct: number,
  inOfficeShare = DEFAULT_IN_OFFICE_SHARE_OF_TOTAL_SHRINK,
): number {
  const inOffice = shrinkPct * inOfficeShare
  const outOfOffice = shrinkPct * (1 - inOfficeShare)
  return outOfOffice + inOffice * IN_OFFICE_NONBILLABLE_SHARE
}

/** Sum planned/actual % for Non-Billable categories only. */
export function nonBillableShrinkFromCategories(
  categories: LeakageShrinkageCategory[] | undefined,
): { planned: number; actual: number } | null {
  if (!categories?.length) return null
  const nonBillable = categories.filter((item) => !item.billable)
  if (!nonBillable.length) return { planned: 0, actual: 0 }
  const planned = nonBillable.reduce((sum, item) => sum + Math.max(0, item.plannedPct), 0)
  const actual = nonBillable.reduce((sum, item) => sum + Math.max(0, item.actualPct ?? 0), 0)
  return { planned, actual }
}

function throughputPerAgent(row: DerivedCapacityRow): number {
  const handled = row.actual.handledVolume
  const hc = row.actual.productionHc
  if (handled != null && handled > 0 && hc > 0) return handled / hc
  const volume = row.actual.offeredVolume || row.planned.volume
  if (volume > 0 && hc > 0) return volume / hc
  return 1
}

function nonBillableShrinkOverrun(row: DerivedCapacityRow): number {
  const fromCategories = nonBillableShrinkFromCategories(row.shrinkageCategories)
  if (fromCategories) return Math.max(0, fromCategories.actual - fromCategories.planned)
  const plannedNb = nonBillableShrinkFraction(row.planned.shrinkagePct)
  const actualNb = nonBillableShrinkFraction(row.actual.shrinkagePct)
  return Math.max(0, actualNb - plannedNb)
}

function actualVolumeForLeakage(row: DerivedCapacityRow, model: BillingModelKind): number {
  if (model === 'transactional') return Math.max(0, row.actual.handledVolume ?? 0)
  if (row.actual.offeredVolume > 0) return row.actual.offeredVolume
  return Math.max(0, row.actual.handledVolume ?? 0)
}

/** Weekly billed revenue of one production head at the LOB’s active rate. */
export function lostHeadWeeklyRevenue(
  model: BillingModelKind,
  billingRate: number,
  standardHoursPerWeek: number,
  throughput: number,
): number {
  const rate = Math.max(0, billingRate)
  const hours = standardHoursPerWeek > 0 ? standardHoursPerWeek : 40
  if (model === 'transactional') return Math.max(0, throughput) * rate
  if (model === 'fte_monthly') return rate / WEEKS_PER_MONTH
  if (model === 'per_minute') return hours * 60 * rate
  return hours * rate
}

function shrinkBaseWeeklyRevenue(
  row: DerivedCapacityRow,
  model: BillingModelKind,
  billingRate: number,
  standardHoursPerWeek: number,
  throughput: number,
): number {
  const fte = Math.max(0, row.actual.productionFte)
  const hc = Math.max(0, row.actual.productionHc)
  const hours = standardHoursPerWeek > 0 ? standardHoursPerWeek : 40
  const rate = Math.max(0, billingRate)
  if (model === 'transactional' && hc > 0) return hc * throughput * rate
  if (model === 'fte_monthly' && fte > 0) return fte * (rate / WEEKS_PER_MONTH)
  if (model === 'per_minute' && fte > 0) return fte * hours * 60 * rate
  if (fte > 0) return fte * hours * rate
  if (hc > 0) {
    if (model === 'per_minute') return hc * hours * 60 * rate
    if (model === 'fte_monthly') return hc * (rate / WEEKS_PER_MONTH)
    return hc * hours * rate
  }
  return 0
}

function volumeUnitRevenue(
  row: DerivedCapacityRow,
  model: BillingModelKind,
  billingRate: number,
): number {
  const rate = Math.max(0, billingRate)
  const plannedVolume = Math.max(0, row.planned.volume)
  const plannedAht = Math.max(0, row.planned.ahtSeconds ?? 0)
  const plannedFte = Math.max(0, row.planned.productionFte)
  const plannedHc = Math.max(0, row.planned.productionHc)
  if (model === 'transactional') return rate
  if (model === 'per_minute') return plannedAht > 0 ? (plannedAht / 60) * rate : 0
  if (model === 'fte_monthly') {
    if (plannedVolume <= 0) return 0
    const weeklyFteRevenue = (plannedFte > 0 ? plannedFte : plannedHc) * (rate / WEEKS_PER_MONTH)
    return weeklyFteRevenue / plannedVolume
  }
  return plannedAht > 0 ? (plannedAht / 3600) * rate : 0
}

function ahtRevenueLeakage(
  row: DerivedCapacityRow,
  model: BillingModelKind,
  billingRate: number,
  standardHoursPerWeek: number,
  ahtGapSec: number,
): number {
  if (ahtGapSec <= 0) return 0
  const handled = row.actual.handledVolume
  if (handled == null || handled <= 0) return 0
  const rate = Math.max(0, billingRate)
  const hours = standardHoursPerWeek > 0 ? standardHoursPerWeek : 40
  const actualAht = row.actual.ahtSeconds ?? 0
  if (model === 'per_minute') return 0
  if (model === 'transactional') {
    if (actualAht <= 0) return 0
    return (ahtGapSec / actualAht) * handled * rate
  }
  const excessHours = (ahtGapSec / 3600) * handled
  if (model === 'fte_monthly') {
    const hourlyEquivalent = hours > 0 ? rate / WEEKS_PER_MONTH / hours : 0
    return excessHours * hourlyEquivalent
  }
  return excessHours * rate
}

function leakageModel(billingType: string): BillingModelKind {
  if (canonicalBillingType(billingType) === 'Transactional') return 'transactional'
  return classifyBillingModel(billingType)
}

export function calculateCapacityRevenueLeakages(
  rows: DerivedCapacityRow[],
  billingType: string,
  billingRate: number,
  standardHoursPerWeek: number,
  _hourlySalaryUsd: number,
  formulaScope?: FormulaScope,
): CapacityLeakageDrivers {
  const model = leakageModel(billingType)
  const hours = standardHoursPerWeek > 0 ? standardHoursPerWeek : 40
  let headcount = 0
  let overstaffing = 0
  let shrinkage = 0
  let aht = 0
  let attrition = 0
  let volume = 0

  rows
    .filter((row) => isActualCapacityWeek(row))
    .forEach((row) => {
      const throughput = throughputPerAgent(row)
      const lostHeadRevenue = lostHeadWeeklyRevenue(model, billingRate, hours, throughput)
      const hcGap = Math.max(0, row.planned.productionHc - row.actual.productionHc)
      const overstaffHcGap = Math.max(0, row.actual.productionHc - row.planned.productionHc)
      const fteGap = Math.max(0, row.planned.productionFte - row.actual.productionFte)
      const overstaffFteGap = Math.max(0, row.actual.productionFte - row.planned.productionFte)
      const nbShrinkGap = nonBillableShrinkOverrun(row)
      const shrinkBaseRevenue = shrinkBaseWeeklyRevenue(row, model, billingRate, hours, throughput)
      const plannedAttritionHc =
        row.planned.attritionHc ?? Math.round((row.planned.attritionPct ?? 0) * Math.max(row.planned.productionHc, 1))
      const attritionGap = Math.max(0, row.actual.attritionHc - plannedAttritionHc)
      const plannedVolume = Math.max(0, row.planned.volume)
      const volumeGap = Math.max(0, plannedVolume - actualVolumeForLeakage(row, model))
      const volumeUnit = volumeUnitRevenue(row, model, billingRate)
      const plannedAht = row.planned.ahtSeconds ?? 0
      const actualAht = row.actual.ahtSeconds ?? 0
      const ahtGapSec = actualAht > 0 && plannedAht > 0 ? Math.max(0, actualAht - plannedAht) : 0
      const actualHandled = row.actual.handledVolume ?? 0
      const ahtLeakage = ahtRevenueLeakage(row, model, billingRate, hours, ahtGapSec)

      const vars = {
        hcGap,
        overstaffHcGap,
        fteGap,
        overstaffFteGap,
        hours,
        billingRate: Math.max(0, billingRate),
        throughput,
        lostHeadRevenue,
        nbShrinkGap,
        shrinkBaseRevenue,
        attritionGap,
        volumeGap,
        plannedVolume,
        plannedAht,
        volumeUnitRevenue: volumeUnit,
        ahtGapSec,
        actualHandled,
        actualAht,
        ahtLeakage,
      }

      headcount += evaluateFormulaOrFallback(
        'financial.leakageHeadcount',
        vars,
        hcGap * lostHeadRevenue,
        formulaScope,
      )
      overstaffing += evaluateFormulaOrFallback(
        'financial.leakageOverstaffing',
        vars,
        overstaffHcGap * lostHeadRevenue,
        formulaScope,
      )
      shrinkage += evaluateFormulaOrFallback(
        'financial.leakageShrinkage',
        vars,
        nbShrinkGap * shrinkBaseRevenue,
        formulaScope,
      )
      aht += evaluateFormulaOrFallback('financial.leakageAht', vars, ahtLeakage, formulaScope)
      attrition += evaluateFormulaOrFallback(
        'financial.leakageAttrition',
        vars,
        attritionGap * lostHeadRevenue,
        formulaScope,
      )
      volume += evaluateFormulaOrFallback(
        'financial.leakageVolume',
        vars,
        volumeGap * volumeUnit,
        formulaScope,
      )
    })

  const total = evaluateFormulaOrFallback(
    'financial.leakageTotal',
    { headcount, overstaffing, shrinkage, aht, attrition, volume },
    headcount + overstaffing + shrinkage + aht + attrition + volume,
    formulaScope,
  )
  return { headcount, overstaffing, shrinkage, aht, attrition, volume, total }
}

export function emptyCapacityLeakages(): CapacityLeakageDrivers {
  return { headcount: 0, overstaffing: 0, shrinkage: 0, aht: 0, attrition: 0, volume: 0, total: 0 }
}

export function addCapacityLeakages(
  left: CapacityLeakageDrivers,
  right: CapacityLeakageDrivers,
): CapacityLeakageDrivers {
  const headcount = left.headcount + right.headcount
  const overstaffing = left.overstaffing + right.overstaffing
  const shrinkage = left.shrinkage + right.shrinkage
  const aht = left.aht + right.aht
  const attrition = left.attrition + right.attrition
  const volume = left.volume + right.volume
  return {
    headcount,
    overstaffing,
    shrinkage,
    aht,
    attrition,
    volume,
    total: left.total + right.total,
  }
}

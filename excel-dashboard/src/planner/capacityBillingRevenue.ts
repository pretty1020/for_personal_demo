import { BILLING_RATE_BANDS, billsStaffedHours, canonicalBillingType, type CanonicalBillingType } from '../utils/staffingCapacity/billingModel'
import type { DerivedCapacityRow } from './capacityPlanDerived'
import { isActualCapacityWeek, isPlannedCapacityWeek } from './capacityFinancialCosts'
import { evaluateFormulaExact, evaluateFormulaOrFallback, isCustomFormula, type FormulaScope } from './formulas/formulaRegistry'
import {
  NETWORK_DAYS_PER_WEEK,
  resolveWeeklyProductiveHours,
  weeksInMonthForWeek,
  WEEKS_PER_MONTH,
} from './weeklyFinancialAlign'
import {
  normalizeBillRateMethods,
  type RevProjBillRateMethod,
} from './revenueProjections/revenueProjectionPersistence'

export { NETWORK_DAYS_PER_WEEK, resolveWeeklyProductiveHours, weeksInMonthForWeek, WEEKS_PER_MONTH }

export type WeeklyRevenueDrivers = {
  productionFte: number
  productionHc: number
  volume: number
  ahtSeconds: number
  requiredFte?: number | null
}

export type WeeklyBillingSpec = {
  billingType: string
  billRateMethod: RevProjBillRateMethod
  billRateMethods?: RevProjBillRateMethod[]
  hourlyBillRate: number
  monthlyBillRate: number
  perMinuteBillRate: number
  perTransactionBillRate: number
  loginHours?: number
  absenteeismPct?: number
  shrinkagePct?: number
  extraHoursMonthly?: number
  revenueFactorPct?: number
  revenueAdjustmentUsdMonthly?: number
  discountUsdMonthly?: number
}

export function activeBillRate(
  spec: Pick<
    WeeklyBillingSpec,
    | 'billRateMethod'
    | 'hourlyBillRate'
    | 'monthlyBillRate'
    | 'perMinuteBillRate'
    | 'perTransactionBillRate'
  >,
): number {
  if (spec.billRateMethod === 'monthly') return spec.monthlyBillRate
  if (spec.billRateMethod === 'per_minute') return spec.perMinuteBillRate
  if (spec.billRateMethod === 'per_transaction') return spec.perTransactionBillRate
  return spec.hourlyBillRate
}

export function defaultBillingRateForType(billingType: string): number {
  const canon = canonicalBillingType(billingType)
  const band = BILLING_RATE_BANDS[canon]
  return (band.min + band.max) / 2
}

export function billingRateLabel(billingType: string, method?: RevProjBillRateMethod): string {
  if (method === 'monthly') return 'Rate (USD / FTE / month)'
  if (method === 'per_minute') return 'Rate (USD / minute)'
  if (method === 'per_transaction') return 'Rate (USD / chat, sale or transaction)'
  const canon = canonicalBillingType(billingType)
  if (canon === 'Transactional') return 'Rate (USD / hour of handle time)'
  if (canon === 'FTE') return 'Rate (USD / hour)'
  return 'Rate (USD / hour)'
}

export function billingUnitLabel(billingType: string, method?: RevProjBillRateMethod): string {
  if (method === 'monthly') return 'FTE-week'
  if (method === 'per_minute') return 'minute'
  if (method === 'per_transaction') return 'transaction'
  const canon = canonicalBillingType(billingType)
  if (canon === 'Transactional') return 'hour'
  if (canon === 'FTE') return 'hour'
  return 'hour'
}

function weeklyFteRevenue(productionHc: number, monthlyRatePerFte: number): number {
  return Math.max(0, productionHc * (monthlyRatePerFte / WEEKS_PER_MONTH))
}

function weeklyRevenueForMethod(
  method: RevProjBillRateMethod,
  drivers: WeeklyRevenueDrivers,
  spec: WeeklyBillingSpec,
  productiveHours: number,
  weeksPerMonth: number,
  scope?: FormulaScope,
): number {
  const staffedHours = billsStaffedHours(spec.billingType)
  const fte = Math.max(0, drivers.productionFte)
  const hc = Math.max(0, drivers.productionHc)
  const volume = Math.max(0, drivers.volume)
  const aht = Math.max(0, drivers.ahtSeconds)
  const required = Math.max(0, drivers.requiredFte ?? 0)

  if (method === 'monthly') {
    if (spec.monthlyBillRate <= 0) return 0
    const heads = staffedHours ? (hc > 0 ? hc : fte) : required > 0 ? required : fte
    if (heads <= 0) return 0
    return Math.max(
      0,
      evaluateFormulaExact(
        'financial.weeklyMonthlyRevenue',
        { productionHc: heads, monthlyBillRate: spec.monthlyBillRate, weeksPerMonth },
        scope,
      ),
    )
  }

  if (method === 'per_minute') {
    if (spec.perMinuteBillRate <= 0) return 0
    if (staffedHours) {
      if (fte <= 0 || productiveHours <= 0) return 0
      return Math.max(
        0,
        evaluateFormulaExact(
          'financial.weeklyPerMinuteFteRevenue',
          { productionFte: fte, productiveHours, perMinuteBillRate: spec.perMinuteBillRate },
          scope,
        ),
      )
    }
    if (volume <= 0 || aht <= 0) return 0
    return Math.max(
      0,
      evaluateFormulaExact(
        'financial.weeklyPerMinuteRevenue',
        {
          volume,
          ahtSeconds: aht,
          perMinuteBillRate: spec.perMinuteBillRate,
          productionFte: fte,
          hours: productiveHours,
        },
        scope,
      ),
    )
  }

  if (method === 'per_transaction') {
    if (spec.perTransactionBillRate <= 0 || volume <= 0) return 0
    return Math.max(
      0,
      evaluateFormulaExact(
        'financial.weeklyPerTransactionRevenue',
        { volume, perTransactionBillRate: spec.perTransactionBillRate },
        scope,
      ),
    )
  }

  if (spec.hourlyBillRate <= 0) return 0
  if (staffedHours) {
    if (fte <= 0 || productiveHours <= 0) return 0
    return Math.max(
      0,
      evaluateFormulaExact(
        'financial.weeklyHourlyRevenue',
        {
          productionFte: fte,
          productiveHours,
          hours: productiveHours,
          hourlyBillRate: spec.hourlyBillRate,
        },
        scope,
      ),
    )
  }
  if (volume <= 0 || aht <= 0) return 0
  return Math.max(
    0,
    evaluateFormulaExact(
      'financial.weeklyHourlyCapacityRevenue',
      { volume, ahtSeconds: aht, hourlyBillRate: spec.hourlyBillRate },
      scope,
    ),
  )
}

function weeklyExtraHoursRevenue(
  spec: WeeklyBillingSpec,
  extraHours: number,
  scope?: FormulaScope,
): number {
  if (extraHours <= 0) return 0
  const loginHours = spec.loginHours != null && spec.loginHours > 0 ? spec.loginHours : 8
  if (isCustomFormula('financial.weeklyExtraHours', scope) || isCustomFormula('revproj.extraHoursRevenue', scope)) {
    const customId = isCustomFormula('financial.weeklyExtraHours', scope)
      ? 'financial.weeklyExtraHours'
      : 'revproj.extraHoursRevenue'
    return Math.max(
      0,
      evaluateFormulaExact(
        customId,
        {
          extraHours,
          hourlyBillRate: spec.hourlyBillRate,
          perMinuteBillRate: spec.perMinuteBillRate,
          monthlyBillRate: spec.monthlyBillRate,
          networkDays: NETWORK_DAYS_PER_WEEK,
          loginHours,
        },
        scope,
      ),
    )
  }
  if (spec.billRateMethod === 'per_minute' && spec.perMinuteBillRate > 0) {
    return extraHours * 60 * spec.perMinuteBillRate
  }
  if (spec.billRateMethod === 'monthly' && spec.monthlyBillRate > 0) {
    const weekHours = NETWORK_DAYS_PER_WEEK * loginHours
    return weekHours > 0 ? (extraHours / weekHours) * spec.monthlyBillRate : 0
  }
  if (spec.hourlyBillRate <= 0) return 0
  return Math.max(
    0,
    evaluateFormulaExact(
      'financial.weeklyExtraHours',
      {
        extraHours,
        hourlyBillRate: spec.hourlyBillRate,
        perMinuteBillRate: spec.perMinuteBillRate,
        monthlyBillRate: spec.monthlyBillRate,
        loginHours,
      },
      scope,
    ),
  )
}

function applyWeeklyRevenueAdjustments(
  billedMethods: number,
  spec: WeeklyBillingSpec,
  weeksPerMonth: number,
  scope?: FormulaScope,
): number {
  const extraHours = Math.max(0, spec.extraHoursMonthly ?? 0) / weeksPerMonth
  const extra = weeklyExtraHoursRevenue(spec, extraHours, scope)
  const billedRevenue = billedMethods + extra
  const revenueFactorPct = spec.revenueFactorPct ?? 0
  const revenueAdjustmentUsd = (spec.revenueAdjustmentUsdMonthly ?? 0) / weeksPerMonth
  const discountOrLessToRevenue = (spec.discountUsdMonthly ?? 0) / weeksPerMonth
  if (
    extraHours <= 0 &&
    revenueFactorPct === 0 &&
    revenueAdjustmentUsd === 0 &&
    discountOrLessToRevenue === 0
  ) {
    return Math.max(0, billedRevenue)
  }
  const factoredFallback = billedRevenue * (1 + revenueFactorPct / 100) + revenueAdjustmentUsd
  const factoredRevenue = evaluateFormulaOrFallback(
    'revproj.revenueFactors',
    { billedRevenue, revenueFactorPct, revenueAdjustmentUsd },
    factoredFallback,
    scope,
  )
  return Math.max(
    0,
    evaluateFormulaOrFallback(
      'revproj.discountRevenue',
      { factoredRevenue, discountOrLessToRevenue, billedRevenue },
      factoredRevenue - discountOrLessToRevenue,
      scope,
    ),
  )
}

export function weeklyRevenueFromSpec(
  drivers: WeeklyRevenueDrivers,
  spec: WeeklyBillingSpec,
  standardHoursPerWeek: number,
  scope?: FormulaScope,
  weekIso?: string,
): number {
  const methods = normalizeBillRateMethods(spec.billRateMethods, spec.billRateMethod)
  const productiveHours = resolveWeeklyProductiveHours(spec, standardHoursPerWeek, scope)
  const weeksPerMonth = weeksInMonthForWeek(weekIso, scope)
  const billed = methods.reduce(
    (sum, method) =>
      sum + weeklyRevenueForMethod(method, drivers, spec, productiveHours, weeksPerMonth, scope),
    0,
  )
  return applyWeeklyRevenueAdjustments(billed, spec, weeksPerMonth, scope)
}

function driversFromRow(
  row: DerivedCapacityRow,
  actual: boolean,
): WeeklyRevenueDrivers {
  if (actual) {
    return {
      productionFte: row.actual.productionFte,
      productionHc: row.actual.productionHc,
      volume: row.actual.handledVolume ?? row.actual.volume,
      ahtSeconds: row.actual.ahtSeconds ?? row.planned.ahtSeconds ?? 0,
      requiredFte: row.actual.requiredFte ?? row.planned.requiredFte,
    }
  }
  return {
    productionFte: row.planned.productionFte,
    productionHc: row.planned.productionHc,
    volume: row.planned.volume,
    ahtSeconds: row.planned.ahtSeconds ?? 0,
    requiredFte: row.planned.requiredFte,
  }
}

export function plannedWeeklyRevenue(
  row: DerivedCapacityRow,
  billingType: string,
  billingRate: number,
  standardHoursPerWeek: number,
  spec?: WeeklyBillingSpec,
  scope?: FormulaScope,
): number {
  if (spec) {
    return weeklyRevenueFromSpec(driversFromRow(row, false), spec, standardHoursPerWeek, scope, row.week)
  }
  const canon = canonicalBillingType(billingType)
  if (canon === 'Production Hours') {
    return Math.max(0, row.planned.productionFte * standardHoursPerWeek * billingRate)
  }
  if (canon === 'FTE') {
    return weeklyFteRevenue(row.planned.productionHc, billingRate)
  }
  return Math.max(0, row.planned.volume * billingRate)
}

export function actualWeeklyRevenue(
  row: DerivedCapacityRow,
  billingType: string,
  billingRate: number,
  standardHoursPerWeek: number,
  spec?: WeeklyBillingSpec,
  scope?: FormulaScope,
): number | null {
  if (!isActualCapacityWeek(row)) return null
  if (spec) {
    return weeklyRevenueFromSpec(driversFromRow(row, true), spec, standardHoursPerWeek, scope, row.week)
  }
  const canon = canonicalBillingType(billingType)
  if (canon === 'Production Hours') {
    return Math.max(0, row.actual.productionFte * standardHoursPerWeek * billingRate)
  }
  if (canon === 'FTE') {
    return weeklyFteRevenue(row.actual.productionHc, billingRate)
  }
  const handled = row.actual.handledVolume ?? row.actual.volume
  return Math.max(0, handled * billingRate)
}

export function revenueFormulaSummary(billingType: string, method?: RevProjBillRateMethod): string {
  const staffedHours = billsStaffedHours(billingType)
  if (method === 'monthly') {
    return staffedHours
      ? 'Projected revenue = Production FTE (or HC) × (monthly bill rate ÷ working weeks in the month). 19 FTE bills more than 7 FTE. Working weeks = network days ÷ 5.'
      : 'Projected revenue = required FTE × (monthly bill rate ÷ working weeks in the month). Working weeks = network days ÷ 5.'
  }
  if (method === 'per_minute') {
    if (staffedHours) {
      return 'Projected revenue = Production FTE × weekly productive hours × 60 × per-minute rate. Weekly productive hours = 5 × login hours × (1 − absenteeism − shrinkage). 19 FTE bills more than 7 FTE.'
    }
    return 'Projected revenue = planned volume × (AHT ÷ 60) × per-minute rate. Missing volume or AHT is 0 — FTE hours are not substituted.'
  }
  if (method === 'per_transaction') {
    return 'Projected revenue = planned volume × per chat/sale/transaction rate. Actual uses handled volume. AHT and hours are not used.'
  }
  if (staffedHours) {
    return 'Projected revenue = Production FTE × weekly productive hours × hourly rate. Example $24: 19 FTE × hours × 24 is larger than 7 FTE × hours × 24. Weekly hours = 5 × login hours × (1 − absenteeism − shrinkage).'
  }
  return 'Projected revenue = weekly volume × (AHT ÷ 3600) × hourly rate (handle time converted to hours). Actual uses handled volume and actual AHT. Missing volume or AHT is 0.'
}

export type CapacityRevenueSummary = {
  projectedRevenue: number
  actualRevenue: number
  variance: number
  weeksWithActual: number
  weeksPlanned: number
}

export function summarizeCapacityRevenue(
  rows: DerivedCapacityRow[],
  billingType: string,
  billingRate: number,
  standardHoursPerWeek: number,
  spec?: WeeklyBillingSpec,
  scope?: FormulaScope,
): CapacityRevenueSummary {
  let projectedRevenue = 0
  let actualRevenue = 0
  let weeksWithActual = 0
  let weeksPlanned = 0
  rows.forEach((row) => {
    if (isPlannedCapacityWeek(row)) {
      projectedRevenue += plannedWeeklyRevenue(row, billingType, billingRate, standardHoursPerWeek, spec, scope)
      weeksPlanned += 1
      return
    }
    if (!isActualCapacityWeek(row)) return
    const actual = actualWeeklyRevenue(row, billingType, billingRate, standardHoursPerWeek, spec, scope)
    if (actual != null) {
      actualRevenue += actual
      weeksWithActual += 1
    }
  })
  return {
    projectedRevenue,
    actualRevenue,
    variance: actualRevenue - projectedRevenue,
    weeksWithActual,
    weeksPlanned,
  }
}

export type { CanonicalBillingType }

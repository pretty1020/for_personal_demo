import type { DerivedCapacityRow } from './capacityPlanDerived'
import { evaluateFormulaOrFallback, isCustomFormula, type FormulaScope } from './formulas/formulaRegistry'
import { resolveWeeklyProductiveHours, weeksInMonthForWeek } from './weeklyFinancialAlign'

export function isActualCapacityWeek(row: DerivedCapacityRow): boolean {
  return row.timeline === 'historical_actual' && row.statusLabel === 'Actual'
}

export function isPlannedCapacityWeek(row: DerivedCapacityRow): boolean {
  return row.timeline === 'forward_plan' && row.statusLabel === 'Planned'
}

export type FinancialCostInputs = {
  hourlySalaryUsd: number
  supportSalaryUsd: number
  trainingSalaryRateUsd: number
  otherCostUsd: number
  /** Extra Salary lines from Revenue Projections ($ / week). */
  extraSalaryUsd?: number
  /** Extra OPEX lines from Revenue Projections ($ / week). */
  extraOpexUsd?: number
  standardHoursPerWeek: number
  loginHours?: number
  absenteeismPct?: number
  shrinkagePct?: number
  monthlyLaborPerFteUsd?: number
}

export function productionLaborWeekly(
  productionFte: number,
  inputs: FinancialCostInputs,
  scope?: FormulaScope,
  weekIso?: string,
): number {
  const productiveHours = resolveWeeklyProductiveHours(inputs, inputs.standardHoursPerWeek, scope)
  const weeksInMonth = weeksInMonthForWeek(weekIso, scope)
  const hourlySalaryUsd = Math.max(0, inputs.hourlySalaryUsd)
  const monthlyLaborPerFteUsd = Math.max(0, inputs.monthlyLaborPerFteUsd ?? 0)
  const fte = Math.max(0, productionFte)
  const fallback =
    monthlyLaborPerFteUsd > 0 && fte > 0
      ? fte * (monthlyLaborPerFteUsd / weeksInMonth)
      : fte * productiveHours * hourlySalaryUsd
  if (monthlyLaborPerFteUsd > 0 && !isCustomFormula('financial.weeklyLaborCost', scope)) {
    return Math.max(0, fallback)
  }
  return Math.max(
    0,
    evaluateFormulaOrFallback(
      'financial.weeklyLaborCost',
      {
        productionFte: fte,
        productiveHours,
        standardHoursPerWeek: productiveHours,
        hourlySalaryUsd,
        monthlyLaborPerFteUsd,
        weeksInMonth,
      },
      fallback,
      scope,
    ),
  )
}

export function trainingPipelineWeekly(
  trainingHc: number,
  nestingHc: number,
  trainingSalaryRateUsd: number,
  scope?: FormulaScope,
): number {
  const fallback = Math.max(0, (trainingHc + nestingHc) * trainingSalaryRateUsd)
  return Math.max(
    0,
    evaluateFormulaOrFallback(
      'financial.weeklyTrainingCost',
      { trainingHc, nestingHc, trainingSalaryRateUsd },
      fallback,
      scope,
    ),
  )
}

export function plannedWeeklyTotalCost(
  row: DerivedCapacityRow,
  inputs: FinancialCostInputs,
  scope?: FormulaScope,
): number {
  const labor = productionLaborWeekly(row.planned.productionFte, inputs, scope, row.week)
  const training = trainingPipelineWeekly(
    row.planned.trainingHc,
    row.planned.nestingHc,
    inputs.trainingSalaryRateUsd,
    scope,
  )
  const extraSalary = Math.max(0, inputs.extraSalaryUsd ?? 0)
  const extraOpex = Math.max(0, inputs.extraOpexUsd ?? 0)
  const fallback = labor + training + inputs.supportSalaryUsd + inputs.otherCostUsd + extraSalary + extraOpex
  return Math.max(
    0,
    evaluateFormulaOrFallback(
      'financial.weeklyTotalCost',
      {
        labor,
        training,
        supportSalaryUsd: inputs.supportSalaryUsd,
        otherCostUsd: inputs.otherCostUsd,
        extraSalaryUsd: extraSalary,
        extraOpexUsd: extraOpex,
      },
      fallback,
      scope,
    ),
  )
}

export function actualWeeklyTotalCost(
  row: DerivedCapacityRow,
  inputs: FinancialCostInputs,
  scope?: FormulaScope,
): number | null {
  if (!isActualCapacityWeek(row)) return null
  const labor = productionLaborWeekly(row.actual.productionFte, inputs, scope, row.week)
  const training = trainingPipelineWeekly(
    row.actual.trainingHc,
    row.actual.nestingHc,
    inputs.trainingSalaryRateUsd,
    scope,
  )
  const extraSalary = Math.max(0, inputs.extraSalaryUsd ?? 0)
  const extraOpex = Math.max(0, inputs.extraOpexUsd ?? 0)
  const fallback = labor + training + inputs.supportSalaryUsd + inputs.otherCostUsd + extraSalary + extraOpex
  return Math.max(
    0,
    evaluateFormulaOrFallback(
      'financial.weeklyTotalCost',
      {
        labor,
        training,
        supportSalaryUsd: inputs.supportSalaryUsd,
        otherCostUsd: inputs.otherCostUsd,
        extraSalaryUsd: extraSalary,
        extraOpexUsd: extraOpex,
      },
      fallback,
      scope,
    ),
  )
}

export function weeklyCostBreakdown(
  productionFte: number,
  trainingHc: number,
  nestingHc: number,
  inputs: FinancialCostInputs,
  scope?: FormulaScope,
  weekIso?: string,
): { labor: number; training: number; salarySupport: number; opex: number; total: number } {
  const labor = productionLaborWeekly(productionFte, inputs, scope, weekIso)
  const training = trainingPipelineWeekly(trainingHc, nestingHc, inputs.trainingSalaryRateUsd, scope)
  const salarySupport = Math.max(0, inputs.supportSalaryUsd) + Math.max(0, inputs.extraSalaryUsd ?? 0)
  const opex = Math.max(0, inputs.otherCostUsd) + Math.max(0, inputs.extraOpexUsd ?? 0)
  return {
    labor,
    training,
    salarySupport,
    opex,
    total: labor + training + salarySupport + opex,
  }
}

export function costFormulaSummary(): string {
  return 'Production labor = Production FTE × weekly productive hours × hourly salary (same hours as Revenue Projection, using 5 network days). If monthly labor / FTE is set, week = FTE × monthly labor ÷ (network days ÷ 5). Training = (Training HC + Nesting HC) × training salary rate. Total adds weekly support, other costs, and custom cost-detail lines (any category) from Revenue Projections.'
}

export type CapacityFinancialSummary = {
  projectedRevenue: number
  actualRevenue: number
  projectedCost: number
  actualCost: number
  projectedMargin: number
  actualMargin: number
  varianceRevenue: number
  varianceCost: number
  weeksPlanned: number
  weeksWithActual: number
}

export function summarizeCapacityFinancials(
  rows: DerivedCapacityRow[],
  plannedRevenueFn: (row: DerivedCapacityRow) => number,
  actualRevenueFn: (row: DerivedCapacityRow) => number | null,
  inputs: FinancialCostInputs,
  scope?: FormulaScope,
): CapacityFinancialSummary {
  let projectedRevenue = 0
  let actualRevenueTotal = 0
  let projectedCost = 0
  let actualCost = 0
  let weeksPlanned = 0
  let weeksWithActual = 0

  rows.forEach((row) => {
    if (isPlannedCapacityWeek(row)) {
      projectedRevenue += plannedRevenueFn(row)
      projectedCost += plannedWeeklyTotalCost(row, inputs, scope)
      weeksPlanned += 1
      return
    }

    if (!isActualCapacityWeek(row)) return

    const actualRev = actualRevenueFn(row)
    const actualCostRow = actualWeeklyTotalCost(row, inputs, scope)
    if (actualRev != null && actualCostRow != null) {
      actualRevenueTotal += actualRev
      actualCost += actualCostRow
      weeksWithActual += 1
    }
  })

  return {
    projectedRevenue,
    actualRevenue: actualRevenueTotal,
    projectedCost,
    actualCost,
    projectedMargin: projectedRevenue - projectedCost,
    actualMargin: actualRevenueTotal - actualCost,
    varianceRevenue: actualRevenueTotal - projectedRevenue,
    varianceCost: actualCost - projectedCost,
    weeksPlanned,
    weeksWithActual,
  }
}

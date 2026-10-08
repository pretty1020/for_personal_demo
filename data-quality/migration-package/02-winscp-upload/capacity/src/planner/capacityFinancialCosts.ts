import type { DerivedCapacityRow } from './capacityPlanDerived'

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
  standardHoursPerWeek: number
}

export function productionLaborWeekly(
  productionFte: number,
  standardHoursPerWeek: number,
  hourlySalaryUsd: number,
): number {
  return Math.max(0, productionFte * standardHoursPerWeek * hourlySalaryUsd)
}

export function trainingPipelineWeekly(
  trainingHc: number,
  nestingHc: number,
  trainingSalaryRateUsd: number,
): number {
  return Math.max(0, (trainingHc + nestingHc) * trainingSalaryRateUsd)
}

export function plannedWeeklyTotalCost(row: DerivedCapacityRow, inputs: FinancialCostInputs): number {
  const labor = productionLaborWeekly(row.planned.productionFte, inputs.standardHoursPerWeek, inputs.hourlySalaryUsd)
  const training = trainingPipelineWeekly(
    row.planned.trainingHc,
    row.planned.nestingHc,
    inputs.trainingSalaryRateUsd,
  )
  return labor + training + inputs.supportSalaryUsd + inputs.otherCostUsd
}

export function actualWeeklyTotalCost(row: DerivedCapacityRow, inputs: FinancialCostInputs): number | null {
  if (!isActualCapacityWeek(row)) return null
  const labor = productionLaborWeekly(row.actual.productionFte, inputs.standardHoursPerWeek, inputs.hourlySalaryUsd)
  const training = trainingPipelineWeekly(
    row.actual.trainingHc,
    row.actual.nestingHc,
    inputs.trainingSalaryRateUsd,
  )
  return labor + training + inputs.supportSalaryUsd + inputs.otherCostUsd
}

export function costFormulaSummary(): string {
  return 'Production labor = Production FTE × standard hours × hourly salary. Training = (Training HC + Nesting HC) × training salary rate. Total adds weekly support and other costs.'
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
      projectedCost += plannedWeeklyTotalCost(row, inputs)
      weeksPlanned += 1
      return
    }

    if (!isActualCapacityWeek(row)) return

    const actualRev = actualRevenueFn(row)
    const actualCostRow = actualWeeklyTotalCost(row, inputs)
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

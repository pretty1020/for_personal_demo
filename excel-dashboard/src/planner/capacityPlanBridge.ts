import type { PeriodResult, PlannerAssumptions, SimulationResult } from './types'

/** Published snapshot — maps simulator outputs to Capacity Plan dashboard fields. */
export type CapacityPlanPublishSnapshot = {
  planAssumptions: {
    shrinkageRate: number
    shrinkageInOfficeShare: number
    attendanceRate: number
    ahtSeconds: number
    attritionRateMonthly: number
    revenuePerContact: number
    revenueTargetMonthly: number
    baseForecastVolume: number
  }
  /** Latest period label (e.g. W26) */
  periodLabel: string
  requiredHeadcount: number
  productionHeadcount: number
  productionFte: number
  forecastVolume: number
  productiveHours: number
  payrollHours: number
  revenue: number
  laborCost: number
  salaryCost: number
  trainingCost: number
  hiringCost: number
  overtimeCost: number
  totalCost: number
  costLeakageTotal: number
  costLeakage: {
    overstaffing: number
    understaffing: number
    overtime: number
    idleTime: number
    absenteeism: number
    shrinkage: number
    productivityLoss: number
    slaPenalties: number
  }
  /** Weekly plan rows for Capacity Plan week-on-week alignment */
  weeklyPlan: Array<{
    periodLabel: string
    requiredHeadcount: number
    productionHeadcount: number
    productionFte: number
    forecastVolume: number
    revenue: number
    attritionPlannedHc: number
    productiveHours: number
    totalCost: number
  }>
}

export function buildCapacityPlanSnapshot(
  result: SimulationResult,
  assumptions: PlannerAssumptions,
  horizon = 26,
): CapacityPlanPublishSnapshot {
  const periods = result.periods.slice(0, horizon)
  const last = periods[periods.length - 1] ?? result.periods[result.periods.length - 1]!

  const sumLeak = (pick: (p: PeriodResult) => number) =>
    periods.reduce((s, p) => s + pick(p), 0)

  const leakSum = {
    overstaffing: sumLeak((p) => p.leakages.overstaffing),
    understaffing: sumLeak((p) => p.leakages.understaffing),
    overtime: sumLeak((p) => p.leakages.overtime),
    idleTime: sumLeak((p) => p.leakages.idleTime),
    absenteeism: sumLeak((p) => p.leakages.absenteeism),
    shrinkage: sumLeak((p) => p.leakages.shrinkage),
    productivityLoss: sumLeak((p) => p.leakages.productivityLoss),
    slaPenalties: sumLeak((p) => p.leakages.slaPenalties),
  }

  const { tenured, business } = assumptions

  return {
    planAssumptions: {
      shrinkageRate: tenured.shrinkageRate,
      shrinkageInOfficeShare: tenured.shrinkageInOfficeShare,
      attendanceRate: tenured.attendanceRate,
      ahtSeconds: tenured.ahtSeconds,
      attritionRateMonthly: tenured.attritionRateMonthly,
      revenuePerContact: business.revenuePerContact,
      revenueTargetMonthly: business.revenueTargetMonthly,
      baseForecastVolume: business.baseForecastVolume,
    },
    periodLabel: last.periodLabel,
    requiredHeadcount: last.requiredFte,
    productionHeadcount: last.scheduledFte,
    productionFte: last.productiveFte,
    forecastVolume: last.forecastVolume,
    productiveHours: last.productiveHours,
    payrollHours: last.payrollHours,
    revenue: periods.reduce((s, p) => s + p.revenue, 0),
    laborCost: periods.reduce((s, p) => s + p.laborCost, 0),
    salaryCost: periods.reduce((s, p) => s + p.laborCost, 0),
    trainingCost: periods.reduce((s, p) => s + p.trainingCost, 0),
    hiringCost: periods.reduce((s, p) => s + p.hiringCost, 0),
    overtimeCost: periods.reduce((s, p) => s + p.overtimeCost, 0),
    totalCost: periods.reduce((s, p) => s + p.totalCost, 0),
    costLeakageTotal: periods.reduce((s, p) => s + p.leakages.total, 0),
    costLeakage: leakSum,
    weeklyPlan: periods.map((p) => ({
      periodLabel: p.periodLabel,
      requiredHeadcount: p.requiredFte,
      productionHeadcount: p.scheduledFte,
      productionFte: p.productiveFte,
      forecastVolume: p.forecastVolume,
      revenue: p.revenue,
      attritionPlannedHc: p.attritionPlanned,
      productiveHours: p.productiveHours,
      totalCost: p.totalCost,
    })),
  }
}

export function fmtPlanVsActualDelta(plan: number, actual: number, decimals = 1): string {
  const d = actual - plan
  const sign = d >= 0 ? '+' : ''
  return `${sign}${d.toLocaleString(undefined, { maximumFractionDigits: decimals })}`
}

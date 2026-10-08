import { DEFAULT_ASSUMPTIONS } from './defaults'
import type { PlannerAssumptions } from './types'
import { demoPlannedShrinkageRate } from './demoHistoricalSeries'

const WEEKS_PER_MONTH = 4.33

/** Shared week curve — matches Planning Simulator seasonality, growth, and assumptions. */
export function simulatorWeekFactors(weekIndex: number, assumptions: PlannerAssumptions = DEFAULT_ASSUMPTIONS) {
  const { business, tenured, newHire } = assumptions
  const season = business.seasonalityFactors[weekIndex % business.seasonalityFactors.length] ?? 1
  const growth = Math.pow(1 + business.growthRateMonthly, weekIndex / WEEKS_PER_MONTH)
  const volumeMult = season * growth
  const wpp = 1
  const productiveSecondsPerFte =
    tenured.productiveHoursPerFtePerWeek *
    wpp *
    3600 *
    (1 - tenured.shrinkageRate) *
    tenured.occupancyTarget *
    tenured.productivityFactor *
    tenured.utilizationTarget
  const forecastVolume = Math.round(business.baseForecastVolume * season * growth * (wpp / WEEKS_PER_MONTH))
  const requiredFte =
    productiveSecondsPerFte > 0 ? (forecastVolume * tenured.ahtSeconds) / productiveSecondsPerFte : 0
  const bufferedRequired = requiredFte * (1 + business.staffingBufferPct)

  return {
    volumeMult,
    forecastVolume,
    requiredFte: bufferedRequired,
    plannedShrink: demoPlannedShrinkageRate(weekIndex, tenured.shrinkageRate),
    plannedAht: tenured.ahtSeconds,
    occupancyTarget: tenured.occupancyTarget,
    attritionPerPeriod: tenured.attritionRateMonthly * (wpp / WEEKS_PER_MONTH),
    hiringPerPeriod: newHire.hiringPlanPerPeriod * wpp,
    nestingShare: newHire.nestingWeeks / Math.max(newHire.trainingWeeks, 1),
    trainingWeeks: newHire.trainingWeeks,
  }
}

/** Portfolio scale: operational HC total ÷ single-program simulator required FTE for the week. */
export function portfolioHcScale(portfolioHc: number, weekIndex: number, assumptions = DEFAULT_ASSUMPTIONS): number {
  const { requiredFte } = simulatorWeekFactors(weekIndex, assumptions)
  return requiredFte > 0 ? portfolioHc / requiredFte : 1
}

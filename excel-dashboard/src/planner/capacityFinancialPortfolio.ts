import {
  actualWeeklyRevenue,
  defaultBillingRateForType,
  plannedWeeklyRevenue,
} from './capacityBillingRevenue'
import {
  summarizeCapacityFinancials,
  type FinancialCostInputs,
} from './capacityFinancialCosts'
import { deriveCapacityPlanRows } from './capacityPlanDerived'
import type { WeekCapacityPlanOverride } from './capacityPlanOverridePersistence'
import type { ScenarioForecastPackage } from './forecasting'
import { filterCapacityRowsByWeekRange } from '../utils/capacityWeekRange'
import { canonicalBillingType } from '../utils/staffingCapacity/billingModel'
import type { PlannerScenario } from './types'
import type { WeeklyLedgerRow } from './weeklyLedger'
import { formulaScopeFromPlan } from './formulas/formulaRegistry'

const FORECAST_HORIZON = 52

export type CapacityFinancialPortfolioDeps = {
  getScenarioLedger: (scenarioId: string) => WeeklyLedgerRow[]
  getScenarioForecast: (scenarioId: string, horizonWeeks: number) => ScenarioForecastPackage | null
  getScenarioCapacityPlanOverrides: (scenarioId: string) => Record<string, WeekCapacityPlanOverride>
}

export type CapacityFinancialPortfolioTotals = {
  projectedRevenue: number
  projectedCost: number
  projectedMargin: number
  projectedGmPct: number | null
  actualRevenue: number
  actualCost: number
  actualMargin: number
  actualGmPct: number | null
  weeksPlanned: number
  weeksWithActual: number
}

function resolveStoredBillingRate(scenario: PlannerScenario, billingType: string): number {
  const canon = canonicalBillingType(billingType)
  const defaultRate = defaultBillingRateForType(billingType)
  const stored = scenario.assumptions.business.billingRate
  if (stored > 0) {
    if (canon === 'FTE' && stored >= 500) return stored
    if (canon === 'Transactional' && stored <= 50) return stored
    if (canon === 'Production Hours' && stored >= 5 && stored <= 100) return stored
    if (canonicalBillingType(scenario.plan.billingType) === canon) return stored
  }
  return defaultRate
}

const DEFAULT_HOURLY_SALARY_USD = 16
const HOURS_PER_MONTH = 173.33

/** Prefer explicit hourly rate; else derive from monthly labor cost; never treat 0 as “set”. */
function resolveHourlySalaryUsd(scenario: PlannerScenario, standardHoursPerWeek: number): number {
  const hourly = scenario.assumptions.business.hourlySalaryUsd
  if (hourly != null && Number.isFinite(hourly) && hourly > 0) return hourly

  const monthly = scenario.assumptions.tenured.laborCostPerFteMonthly
  if (monthly != null && Number.isFinite(monthly) && monthly > 0) {
    const hoursBasis = standardHoursPerWeek > 0 ? (standardHoursPerWeek * 52) / 12 : HOURS_PER_MONTH
    return monthly / hoursBasis
  }

  return DEFAULT_HOURLY_SALARY_USD
}

function costInputsFromScenario(scenario: PlannerScenario): FinancialCostInputs {
  const business = scenario.assumptions.business
  const standardHoursPerWeek =
    scenario.assumptions.tenured.standardScheduledHoursPerWeek > 0
      ? scenario.assumptions.tenured.standardScheduledHoursPerWeek
      : 40
  return {
    hourlySalaryUsd: resolveHourlySalaryUsd(scenario, standardHoursPerWeek),
    supportSalaryUsd: business.supportSalaryUsd > 0 ? business.supportSalaryUsd : 0,
    trainingSalaryRateUsd: business.trainingSalaryRateUsd > 0 ? business.trainingSalaryRateUsd : 0,
    otherCostUsd: business.otherCostUsd > 0 ? business.otherCostUsd : 0,
    standardHoursPerWeek,
  }
}

/**
 * Portfolio financial roll-up matching /Financial Summary:
 * each LOB uses its own billable type, rate, and cost assumptions; totals sum planned weeks.
 */
const EMPTY_PORTFOLIO_TOTALS: CapacityFinancialPortfolioTotals = {
  projectedRevenue: 0,
  projectedCost: 0,
  projectedMargin: 0,
  projectedGmPct: null,
  actualRevenue: 0,
  actualCost: 0,
  actualMargin: 0,
  actualGmPct: null,
  weeksPlanned: 0,
  weeksWithActual: 0,
}

export function buildCapacityFinancialPortfolioTotals(
  scenarios: PlannerScenario[],
  deps: CapacityFinancialPortfolioDeps,
  weekStart = '',
  weekEnd = '',
  options?: { forceEmpty?: boolean },
): CapacityFinancialPortfolioTotals {
  if (options?.forceEmpty) return { ...EMPTY_PORTFOLIO_TOTALS }
  const visible = scenarios.filter((scenario) => !scenario.isBaseline)
  let projectedRevenue = 0
  let projectedCost = 0
  let actualRevenue = 0
  let actualCost = 0
  let weeksPlanned = 0
  let weeksWithActual = 0

  for (const scenario of visible) {
    const rows = deriveCapacityPlanRows(
      deps.getScenarioLedger(scenario.id),
      scenario,
      deps.getScenarioForecast(scenario.id, FORECAST_HORIZON),
      deps.getScenarioCapacityPlanOverrides(scenario.id),
    )
    const capacityRows = filterCapacityRowsByWeekRange(rows, weekStart, weekEnd)
    const billingType = canonicalBillingType(scenario.plan.billingType)
    const billingRate = resolveStoredBillingRate(scenario, billingType)
    const costInputs = costInputsFromScenario(scenario)
    const standardHours = costInputs.standardHoursPerWeek
    const formulaScope = formulaScopeFromPlan(scenario.plan)
    const summary = summarizeCapacityFinancials(
      capacityRows,
      (row) => plannedWeeklyRevenue(row, billingType, billingRate, standardHours, undefined, formulaScope),
      (row) => actualWeeklyRevenue(row, billingType, billingRate, standardHours, undefined, formulaScope),
      costInputs,
      formulaScope,
    )
    projectedRevenue += summary.projectedRevenue
    projectedCost += summary.projectedCost
    actualRevenue += summary.actualRevenue
    actualCost += summary.actualCost
    weeksPlanned += summary.weeksPlanned
    weeksWithActual += summary.weeksWithActual
  }

  const projectedMargin = projectedRevenue - projectedCost
  const actualMargin = actualRevenue - actualCost

  return {
    projectedRevenue,
    projectedCost,
    projectedMargin,
    projectedGmPct: projectedRevenue > 0 ? projectedMargin / projectedRevenue : null,
    actualRevenue,
    actualCost,
    actualMargin,
    actualGmPct: actualRevenue > 0 ? actualMargin / actualRevenue : null,
    weeksPlanned,
    weeksWithActual,
  }
}

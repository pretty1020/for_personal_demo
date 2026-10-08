import {
  capacityPlannedNestingHc,
  capacityPlannedNewHires,
  capacityPlannedProductionFte,
  capacityPlannedProductionHc,
  capacityPlannedRequiredFte,
  capacityPlannedTrainingHc,
  deriveCapacityRowsForScenario,
  resolveCapacityRowForPlanningWeek,
} from './capacityLookup'
import { resolveCapacityPlanStartWeek } from './capacityWeekUtils'
import {
  buildCapacityFinancialPortfolioTotals,
  type CapacityFinancialPortfolioDeps,
} from './capacityFinancialPortfolio'
import { computeRosterCapacityMetrics } from './rosterMetrics'
import type { PlannerScenario } from './types'
import type { RosterEmployee } from './rosterPersistence'
import { filterCapacityRowsByWeekRange } from '../utils/capacityWeekRange'

export type ExecutivePortfolioDeps = CapacityFinancialPortfolioDeps & {
  getScenarioRoster: (scenarioId: string) => RosterEmployee[]
}

export type ExecutivePortfolioTotals = {
  scenarioCount: number
  clientCount: number
  requiredFte: number
  productionFte: number
  staffingPct: number | null
  staffingGapFte: number | null
  hiringWeek1: number
  /** Matches /Financial projected revenue (capacity weekly roll-up). */
  revenue: number
  /** Matches /Financial projected cost (production labor + training + OPEX). */
  laborCost: number
  grossMargin: number
  grossMarginPct: number | null
  laborCostIntensityPct: number | null
  activeHeadcount: number
  trainingHc: number
  nestingHc: number
  productionHc: number
  rosterUtilizationPct: number | null
  weeksPlanned: number
}

export type ClientPortfolioSummary = {
  clientLabel: string
  lobCount: number
  requiredFte: number
  productionFte: number
  staffingPct: number | null
  staffingGapFte: number | null
  revenue: number
  laborCost: number
  grossMargin: number
  grossMarginPct: number | null
}

function clientLabelFor(scenario: PlannerScenario): string {
  return scenario.plan.client.trim() || 'Unassigned'
}

function staffingMetrics(requiredFte: number, productionFte: number) {
  const staffingGapFte = requiredFte > 0 || productionFte > 0 ? productionFte - requiredFte : null
  return {
    staffingPct: requiredFte > 0 ? productionFte / requiredFte : null,
    staffingGapFte,
  }
}

export function buildExecutivePortfolioTotals(
  scenarios: PlannerScenario[],
  deps: ExecutivePortfolioDeps,
  weekStart = '',
  weekEnd = '',
): ExecutivePortfolioTotals {
  const visible = scenarios.filter((scenario) => !scenario.isBaseline)
  let requiredFte = 0
  let productionFte = 0
  let hiringWeek1 = 0
  let activeHeadcount = 0
  let trainingHc = 0
  let nestingHc = 0
  let productionHc = 0
  const clients = new Set<string>()

  for (const scenario of visible) {
    clients.add(clientLabelFor(scenario))
    const forecast = deps.getScenarioForecast(scenario.id, 52)
    const rows = deriveCapacityRowsForScenario(
      deps.getScenarioLedger(scenario.id),
      scenario,
      forecast,
      deps.getScenarioCapacityPlanOverrides(scenario.id),
    )
    const scopedRows = filterCapacityRowsByWeekRange(rows, weekStart, weekEnd)
    const planningWeek = resolveCapacityPlanStartWeek(scenario.plan)
    const capacityRow =
      scopedRows.find((row) => row.week === planningWeek) ??
      scopedRows[0] ??
      resolveCapacityRowForPlanningWeek(rows, scenario, planningWeek)

    // Period staffing: average weekly FTE across the selected window (falls back to planning week).
    if (scopedRows.length > 0 && (weekStart || weekEnd)) {
      const reqSum = scopedRows.reduce((sum, row) => sum + capacityPlannedRequiredFte(row), 0)
      const prodSum = scopedRows.reduce((sum, row) => sum + capacityPlannedProductionFte(row), 0)
      const trainSum = scopedRows.reduce((sum, row) => sum + capacityPlannedTrainingHc(row), 0)
      const nestSum = scopedRows.reduce((sum, row) => sum + capacityPlannedNestingHc(row), 0)
      const hcSum = scopedRows.reduce((sum, row) => sum + capacityPlannedProductionHc(row), 0)
      const n = scopedRows.length
      requiredFte += reqSum / n
      productionFte += prodSum / n
      trainingHc += trainSum / n
      nestingHc += nestSum / n
      productionHc += hcSum / n
      hiringWeek1 += capacityPlannedNewHires(capacityRow)
    } else {
      requiredFte += capacityPlannedRequiredFte(capacityRow)
      productionFte += capacityPlannedProductionFte(capacityRow)
      productionHc += capacityPlannedProductionHc(capacityRow)
      trainingHc += capacityPlannedTrainingHc(capacityRow)
      nestingHc += capacityPlannedNestingHc(capacityRow)
      hiringWeek1 += capacityPlannedNewHires(capacityRow)
    }

    const rosterMetrics = computeRosterCapacityMetrics(
      deps.getScenarioRoster(scenario.id),
      planningWeek,
      capacityRow,
      scenario.plan.client,
    )
    activeHeadcount += rosterMetrics.activeHeadcount
  }

  // Financial performance uses the same capacity weekly roll-up as /Financial Summary.
  const financial = buildCapacityFinancialPortfolioTotals(visible, deps, weekStart, weekEnd)
  const revenue = financial.projectedRevenue
  const laborCost = financial.projectedCost
  const grossMargin = financial.projectedMargin
  const { staffingPct, staffingGapFte } = staffingMetrics(requiredFte, productionFte)

  return {
    scenarioCount: visible.length,
    clientCount: clients.size,
    requiredFte,
    productionFte,
    staffingPct,
    staffingGapFte,
    hiringWeek1,
    revenue,
    laborCost,
    grossMargin,
    grossMarginPct: financial.projectedGmPct,
    laborCostIntensityPct: revenue > 0 ? laborCost / revenue : null,
    activeHeadcount,
    trainingHc,
    nestingHc,
    productionHc,
    rosterUtilizationPct: activeHeadcount > 0 ? productionHc / activeHeadcount : null,
    weeksPlanned: financial.weeksPlanned,
  }
}

/** Per-client roll-ups for hierarchy cards (same formulas as portfolio totals). */
export function buildClientPortfolioSummaries(
  scenarios: PlannerScenario[],
  deps: ExecutivePortfolioDeps,
  weekStart = '',
  weekEnd = '',
): ClientPortfolioSummary[] {
  const visible = scenarios.filter((scenario) => !scenario.isBaseline)
  const byClient = new Map<string, PlannerScenario[]>()

  for (const scenario of visible) {
    const label = clientLabelFor(scenario)
    const list = byClient.get(label) ?? []
    list.push(scenario)
    byClient.set(label, list)
  }

  return [...byClient.entries()]
    .map(([clientLabel, clientScenarios]) => {
      const totals = buildExecutivePortfolioTotals(clientScenarios, deps, weekStart, weekEnd)
      return {
        clientLabel,
        lobCount: clientScenarios.length,
        requiredFte: totals.requiredFte,
        productionFte: totals.productionFte,
        staffingPct: totals.staffingPct,
        staffingGapFte: totals.staffingGapFte,
        revenue: totals.revenue,
        laborCost: totals.laborCost,
        grossMargin: totals.grossMargin,
        grossMarginPct: totals.grossMarginPct,
      }
    })
    .sort((a, b) => a.clientLabel.localeCompare(b.clientLabel))
}

// Re-export for callers that only need the financial portfolio shape.
export type { CapacityFinancialPortfolioDeps }

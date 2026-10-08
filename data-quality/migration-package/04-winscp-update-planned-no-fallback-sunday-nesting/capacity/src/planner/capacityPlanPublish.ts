import type { ScenarioCapacityPlanOverrideStore, WeekCapacityPlanOverride } from './capacityPlanOverridePersistence'
import { DEFAULT_CAPACITY_MATRIX_LAYOUT, saveCapacityMatrixView, type CapacityMatrixViewState } from './capacityViewPersistence'
import type { PeriodResult, PlannerScenario, SimulationResult } from './types'
import type { WeeklyLedgerRow } from './weeklyLedger'

function roundWhole(value: number): number {
  return Math.round(value)
}

function isCapacityWorkspacePlan(scenario: PlannerScenario): boolean {
  return Boolean(scenario.plan.clientId) || scenario.plan.buildMethod === 'forward' || scenario.plan.buildMethod === 'import'
}

/**
 * Simulation periods must not invent Forecast volume / AHT / Occupancy for capacity plans.
 * Those drivers come only from template upload or manual matrix entry.
 * (Weekly-scaled monthly volume was seeding every week as ~23 when monthly ≈ 100.)
 */
function periodToWeekOverride(period: PeriodResult, scenario: PlannerScenario): WeekCapacityPlanOverride {
  if (isCapacityWorkspacePlan(scenario)) {
    return {
      plannedNewHires: roundWhole(period.hiringPlanned),
      attritionHc: roundWhole(period.attritionPlanned),
      trainingHc: roundWhole(period.trainingHeadcount),
      nestingHc: roundWhole(period.nestingHeadcount),
      graduateHc: roundWhole(period.graduateHc),
      supportHc: 0,
    }
  }
  const aht = scenario.assumptions.tenured.ahtSeconds
  return {
    callVolume: roundWhole(period.forecastVolume),
    ahtSeconds: aht,
    cappedAhtSeconds: aht,
    occupancy: period.occupancy,
    totalShrinkagePct: period.totalShrinkageRate,
    plannedNewHires: roundWhole(period.hiringPlanned),
    attritionHc: roundWhole(period.attritionPlanned),
    trainingHc: roundWhole(period.trainingHeadcount),
    nestingHc: roundWhole(period.nestingHeadcount),
    graduateHc: roundWhole(period.graduateHc),
    supportHc: 0,
  }
}

/** Map weekly simulation periods onto forward-plan ledger weeks for capacity matrix overrides. */
export function buildCapacityOverridesFromSimulation(
  scenario: PlannerScenario,
  ledger: WeeklyLedgerRow[],
  simulation: SimulationResult,
): Record<string, WeekCapacityPlanOverride> {
  const forwardWeeks = ledger
    .filter((row) => row.timeline === 'forward_plan')
    .sort((a, b) => a.week.localeCompare(b.week))

  const next: Record<string, WeekCapacityPlanOverride> = {}
  forwardWeeks.forEach((row, index) => {
    const period = simulation.periods[index]
    if (!period) return
    next[row.week] = periodToWeekOverride(period, scenario)
  })
  return next
}

const PRESERVE_ON_PUBLISH_KEYS = [
  'callVolume',
  'ahtSeconds',
  'cappedAhtSeconds',
  'occupancy',
  'requiredFte',
  'attritionPct',
] as const

/** Replace forward-week planned overrides while preserving uploaded/manual drivers. */
export function mergePublishedCapacityOverrides(
  store: ScenarioCapacityPlanOverrideStore,
  scenarioId: string,
  publishedWeeks: Record<string, WeekCapacityPlanOverride>,
): ScenarioCapacityPlanOverrideStore {
  const existing = store[scenarioId] ?? {}
  const forwardWeekSet = new Set(Object.keys(publishedWeeks))
  const preserved: Record<string, WeekCapacityPlanOverride> = {}
  for (const [week, override] of Object.entries(existing)) {
    if (!forwardWeekSet.has(week)) {
      preserved[week] = override
    }
  }
  const mergedPublished: Record<string, WeekCapacityPlanOverride> = {}
  for (const [week, published] of Object.entries(publishedWeeks)) {
    const prior = existing[week]
    const kept: WeekCapacityPlanOverride = {}
    if (prior) {
      for (const key of PRESERVE_ON_PUBLISH_KEYS) {
        const value = prior[key]
        if (value != null && Number.isFinite(value)) {
          ;(kept as Record<string, unknown>)[key] = value
        }
      }
      if (prior.shrinkageById && Object.keys(prior.shrinkageById).length) {
        kept.shrinkageById = { ...prior.shrinkageById }
      }
    }
    mergedPublished[week] = {
      ...published,
      ...kept,
    }
  }
  return {
    ...store,
    [scenarioId]: { ...preserved, ...mergedPublished },
  }
}

export function syncCapacityMatrixScope(scenarioId: string, existing?: CapacityMatrixViewState | null): void {
  saveCapacityMatrixView({
    scenarioId,
    scopeId: `lob:${scenarioId}`,
    view: existing?.view ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.view,
    showFutureWeeks: existing?.showFutureWeeks ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.showFutureWeeks,
    showPastWeeks: existing?.showPastWeeks ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.showPastWeeks,
    expandAllFutureWeeks: existing?.expandAllFutureWeeks ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.expandAllFutureWeeks,
    controlsOpen: existing?.controlsOpen ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.controlsOpen,
    unlockHistorical: existing?.unlockHistorical ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.unlockHistorical,
    hiddenWeeks: existing?.hiddenWeeks ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.hiddenWeeks,
    collapsed: existing?.collapsed ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.collapsed,
    visibleShrinkageCategoryIds: existing?.visibleShrinkageCategoryIds,
    sidebarPanelOpen: {
      ...DEFAULT_CAPACITY_MATRIX_LAYOUT.sidebarPanelOpen,
      ...(existing?.sidebarPanelOpen ?? {}),
    },
    forecastInfoOpen: existing?.forecastInfoOpen ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.forecastInfoOpen,
    savedAt: new Date().toISOString(),
  })
}

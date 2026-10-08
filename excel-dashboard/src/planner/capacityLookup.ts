import { DEFAULT_CAPACITY_FORECAST_MODES } from './capacityMatrixDisplay'
import {
  deriveCapacityPlanRows,
  findCapacityRowByWeek,
  type CapacityForecastMode,
  type DerivedCapacityRow,
} from './capacityPlanDerived'
import type { ScenarioForecastPackage } from './forecasting'
import type { ForecastMetricId } from './forecastPersistence'
import type { WeekCapacityPlanOverride } from './capacityPlanOverridePersistence'
import { loadScenarioForecastModes } from './capacityForecastModesPersistence'
import type { PlannerScenario } from './types'
import type { WeeklyLedgerRow } from './weeklyLedger'
import { resolveCapacityPlanStartWeek, snapToWeekStart } from './capacityWeekUtils'

type CapacityDriverModeId = ForecastMetricId | 'occupancy'

/** Match Capacity page driver modes so Scheduling reads the same planned metrics. */
export function capacityWorkspaceForecastModes(
  _scenario: PlannerScenario | null | undefined,
  modes: Partial<Record<CapacityDriverModeId, CapacityForecastMode>>,
): Partial<Record<CapacityDriverModeId, CapacityForecastMode>> {
  return modes
}

export function resolveCapacityPlanningWeek(scenario: PlannerScenario, weekIso: string): string {
  return snapToWeekStart(weekIso, scenario.plan.weekStart)
}

export function deriveCapacityRowsForScenario(
  ledger: WeeklyLedgerRow[],
  scenario: PlannerScenario,
  forecast: ScenarioForecastPackage | null,
  plannedOverrides: Record<string, WeekCapacityPlanOverride> = {},
): DerivedCapacityRow[] {
  const savedModes = {
    ...DEFAULT_CAPACITY_FORECAST_MODES,
    ...loadScenarioForecastModes(scenario.id),
  }
  return deriveCapacityPlanRows(
    ledger,
    scenario,
    forecast,
    plannedOverrides,
    capacityWorkspaceForecastModes(scenario, savedModes),
  )
}

export function resolveCapacityRowForPlanningWeek(
  rows: DerivedCapacityRow[],
  scenario: PlannerScenario,
  weekIso: string,
): DerivedCapacityRow | null {
  const snappedWeek = resolveCapacityPlanningWeek(scenario, weekIso)
  const exact = findCapacityRowByWeek(rows, snappedWeek)
  if (exact) return exact

  const planStart = resolveCapacityPlanStartWeek(scenario.plan)
  const atPlanStart = findCapacityRowByWeek(rows, planStart)
  if (atPlanStart) return atPlanStart

  const forwardRows = rows.filter((row) => row.timeline === 'forward_plan')
  if (forwardRows.length) {
    const weekDistanceMs = (week: string) =>
      Math.abs(new Date(`${week}T12:00:00`).getTime() - new Date(`${snappedWeek}T12:00:00`).getTime())
    const sorted = [...forwardRows].sort((a, b) => weekDistanceMs(a.week) - weekDistanceMs(b.week))
    return sorted[0] ?? null
  }

  return rows[rows.length - 1] ?? null
}

export function capacityPlannedRequiredFte(row: DerivedCapacityRow | null | undefined): number {
  if (!row) return 0
  const value = row.planned.requiredFte ?? row.actual.requiredFte
  return value != null && Number.isFinite(value) ? Math.max(0, value) : 0
}

export function capacityPlannedProductionFte(row: DerivedCapacityRow | null | undefined): number {
  if (!row) return 0
  const value = row.planned.productionFte ?? row.actual.productionFte
  return value != null && Number.isFinite(value) ? Math.max(0, value) : 0
}

export function capacityPlannedProductionHc(row: DerivedCapacityRow | null | undefined): number {
  if (!row) return 0
  const value = row.planned.productionHc ?? row.actual.productionHc
  return value != null && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

export function capacityPlannedTrainingHc(row: DerivedCapacityRow | null | undefined): number {
  if (!row) return 0
  const value = row.planned.trainingHc ?? row.actual.trainingHc
  return value != null && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

export function capacityPlannedNestingHc(row: DerivedCapacityRow | null | undefined): number {
  if (!row) return 0
  const value = row.planned.nestingHc ?? row.actual.nestingHc
  return value != null && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

export function capacityPlannedNewHires(row: DerivedCapacityRow | null | undefined): number {
  if (!row) return 0
  const value = row.planned.plannedNewHires ?? row.actual.plannedNewHires
  return value != null && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

export function capacityPlannedCategoryPct(
  row: DerivedCapacityRow | null | undefined,
  categoryId: string,
): number {
  if (!row) return 0
  const item = row.shrinkageCategories?.find((category) => category.id === categoryId)
  const pct = item?.plannedPct ?? 0
  return Math.max(0, Math.min(1, Number.isFinite(pct) ? pct : 0))
}

export function capacityPlannedAbsenteeismPct(row: DerivedCapacityRow | null | undefined): number {
  return capacityPlannedCategoryPct(row, 'absenteeism')
}

export function capacityPlannedInOfficeShrinkagePct(row: DerivedCapacityRow | null | undefined): number {
  if (!row?.shrinkageCategories?.length) return 0
  return row.shrinkageCategories
    .filter((category) => category.group === 'in_office')
    .reduce((sum, category) => sum + (Number.isFinite(category.plannedPct) ? category.plannedPct : 0), 0)
}

export function capacityPlannedVlAllocationHc(row: DerivedCapacityRow | null | undefined): number {
  if (!row) return 0
  const value = row.planned.vlAllocationHc
  return value != null && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

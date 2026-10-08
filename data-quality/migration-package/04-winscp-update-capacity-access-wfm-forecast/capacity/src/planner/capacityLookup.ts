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

/** Resolve the driver mode per metric, falling back to the plan's build method. */
export function capacityWorkspaceForecastModes(
  scenario: PlannerScenario | null | undefined,
  modes: Partial<Record<CapacityDriverModeId, CapacityForecastMode>>,
): Partial<Record<CapacityDriverModeId, CapacityForecastMode>> {
  if (!scenario?.plan.clientId && scenario?.plan.buildMethod !== 'forward') return modes
  return {
    ...modes,
    callVolume: 'manual',
    ahtSeconds: 'manual',
    occupancy: 'manual',
    // Keep the user's Planned Attrition % driver (forecast / previous week / manual).
  }
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

/**
 * Weekly display pairing for Required ↔ Production FTE (per week column only).
 * When applyMutualBlank is true (weekly view):
 *   - Required shows whenever it is present (persisted values must survive refresh)
 *   - Production blanks when Required is missing/zero (never show Production alone)
 * When false (monthly / quarterly / Client·LOB rollups): each side shows independently.
 */
export function applyWeeklyMutualFteBlank(
  required: number | null | undefined,
  production: number | null | undefined,
  applyMutualBlank: boolean,
): { requiredFte: number | null; productionFte: number | null } {
  const requiredFinite = required != null && Number.isFinite(required) ? required : null
  const productionFinite = production != null && Number.isFinite(production) ? production : null
  if (!applyMutualBlank) {
    return { requiredFte: requiredFinite, productionFte: productionFinite }
  }
  const requiredOk = requiredFinite != null
  const productionOk = productionFinite != null
  return {
    requiredFte: requiredOk ? requiredFinite : null,
    productionFte: requiredOk && productionOk ? productionFinite : null,
  }
}

/**
 * Required ↔ Production FTE display pair for a derived week row.
 * Pass applyMutualBlank=true only for weekly columns — never for whole Client/LOB plans.
 */
export function capacityStaffingFtePair(
  row: DerivedCapacityRow | null | undefined,
  applyMutualBlank = true,
): {
  requiredFte: number | null
  productionFte: number | null
} {
  if (!row) return { requiredFte: null, productionFte: null }
  return applyWeeklyMutualFteBlank(
    row.planned.requiredFte ?? row.actual.requiredFte,
    row.planned.productionFte ?? row.actual.productionFte,
    applyMutualBlank,
  )
}

/** Average of present (non-null, non-zero) FTE values; null when none qualify. */
export function avgPresentFte(values: Array<number | null | undefined>): number | null {
  const present = values.filter(
    (value): value is number => value != null && Number.isFinite(value) && value !== 0,
  )
  if (!present.length) return null
  return present.reduce((sum, value) => sum + value, 0) / present.length
}

/** Average of finite FTE values (zeros kept); null when none. For non-weekly rollups. */
export function avgFiniteFte(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (!present.length) return null
  return present.reduce((sum, value) => sum + value, 0) / present.length
}

/** Sum of present FTE values; null when none qualify. */
export function sumPresentFte(values: Array<number | null | undefined>): number | null {
  const present = values.filter(
    (value): value is number => value != null && Number.isFinite(value) && value !== 0,
  )
  if (!present.length) return null
  return present.reduce((sum, value) => sum + value, 0)
}

/** Sum of finite FTE values (zeros kept); null when none. For non-weekly rollups. */
export function sumFiniteFte(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (!present.length) return null
  return present.reduce((sum, value) => sum + value, 0)
}

function weekMetricsHaveSignal(
  planned: WeeklyLedgerRow['planned'] | null | undefined,
  actual: WeeklyLedgerRow['actual'] | null | undefined,
): boolean {
  if ((planned?.callVolume ?? 0) > 0) return true
  if ((planned?.productionHc ?? 0) > 0) return true
  if ((planned?.requiredFte ?? 0) > 0) return true
  if ((planned?.productionFte ?? 0) > 0) return true
  if (actual && (actual.callVolume ?? 0) > 0) return true
  if (actual && (actual.productionHc ?? 0) > 0) return true
  if (actual && (actual.requiredFte ?? 0) > 0) return true
  if (actual && (actual.productionFte ?? 0) > 0) return true
  return false
}

/**
 * True when a plan carries real capacity signal (overrides or positive volume/HC/FTE).
 * Empty setup-only LOBs are treated as inapplicable for filters and rollups.
 */
export function scenarioHasCapacitySignal(
  ledger: WeeklyLedgerRow[],
  overrides: Record<string, WeekCapacityPlanOverride>,
): boolean {
  if (Object.keys(overrides).length > 0) return true
  return ledger.some((row) => weekMetricsHaveSignal(row.planned, row.actual))
}

/**
 * Weeks that should appear in Monthly / period chips — user-entered or imported only.
 * Skips simulated forward-plan filler and the dense ledger walk (2001–2027).
 * When both inputs are empty, returns [] so callers can fall back to a visible window.
 */
export function weeksWithPlanSignal(
  ledger: WeeklyLedgerRow[],
  overrides: Record<string, WeekCapacityPlanOverride> = {},
): string[] {
  const weeks = new Set<string>()
  for (const week of Object.keys(overrides)) {
    if (week) weeks.add(week)
  }
  for (const row of ledger) {
    if (!row.week) continue
    if (row.overrideSource === 'import') weeks.add(row.week)
  }
  return [...weeks].sort()
}

/**
 * Keep a week in Summary FTE rollups when Required and/or Production FTE
 * has a real (non-blank, non-zero) value. Gap / staffing % stay null until both exist.
 */
export function weekHasRequiredAndProductionFte(
  row: DerivedCapacityRow | null | undefined,
): boolean {
  const pair = capacityStaffingFtePair(row, false)
  return (
    (pair.requiredFte != null && pair.requiredFte !== 0) ||
    (pair.productionFte != null && pair.productionFte !== 0)
  )
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

import { MAX_FUTURE_WEEKS } from './capacityMatrixTheme'
import type { ScenarioCapacityPlanOverrideStore, WeekCapacityPlanOverride } from './capacityPlanOverridePersistence'
import { addWeeks, isoDate, startOfWeek } from './capacityWeekUtils'
import { calculateConsolidatedStaffing, resolveChannelAssumptions } from './channelPlanning'
import { isDriverWeekLocked, type DriverWeekLockStore } from './capacityDriverLocks'
import type { PlannerScenario } from './types'

export type Week1DriverSnapshot = {
  callVolume: number
  ahtSeconds: number
  occupancy: number
  totalShrinkagePct: number
  plannedNewHires: number
  requiredFte?: number | null
}

export function buildWeek1DriverSnapshot(scenario: PlannerScenario, hiringPlanPerWeek = 0): Week1DriverSnapshot {
  const consolidated = calculateConsolidatedStaffing(scenario.assumptions, scenario.plan)
  const channelAssumptions = resolveChannelAssumptions(scenario.assumptions, scenario.plan)
  const supported = scenario.plan.supportedChannels ?? ['voice']
  const occupancyValues = supported
    .map((channel) => channelAssumptions[channel]?.occupancyTarget)
    .filter((value): value is number => value != null && value > 0)
  const productivityValues = supported
    .map((channel) => channelAssumptions[channel]?.productivityPct)
    .filter((value): value is number => value != null && value > 0)
  const occupancy =
    occupancyValues.length > 0
      ? occupancyValues.reduce((sum, value) => sum + value, 0) / occupancyValues.length
      : scenario.assumptions.tenured.occupancyTarget
  const productivity =
    productivityValues.length > 0
      ? productivityValues.reduce((sum, value) => sum + value, 0) / productivityValues.length
      : scenario.assumptions.tenured.productivityFactor

  return {
    callVolume: Math.round(consolidated.totalForecastVolume),
    ahtSeconds: Math.round(consolidated.weightedAhtSeconds || scenario.assumptions.tenured.ahtSeconds),
    occupancy: occupancyValues.length ? occupancy : productivity,
    totalShrinkagePct: scenario.assumptions.tenured.shrinkageRate,
    plannedNewHires: Math.round(hiringPlanPerWeek),
  }
}

export function listForwardPlanWeeks(scenario: PlannerScenario, horizon = MAX_FUTURE_WEEKS): string[] {
  const planStart = scenario.plan.capacityPlanStartWeek
  if (!planStart) return []
  const weekStart = scenario.plan.weekStart
  const weeks: string[] = []
  let cursor = new Date(`${planStart}T12:00:00`)
  for (let index = 0; index < horizon; index += 1) {
    weeks.push(isoDate(startOfWeek(cursor, weekStart)))
    cursor = addWeeks(cursor, 1)
  }
  return weeks
}

function weekOverrideFromSnapshot(snapshot: Week1DriverSnapshot): WeekCapacityPlanOverride {
  const override: WeekCapacityPlanOverride = {
    totalShrinkagePct: snapshot.totalShrinkagePct,
    plannedNewHires: snapshot.plannedNewHires,
  }
  if (snapshot.callVolume > 0) override.callVolume = snapshot.callVolume
  if (snapshot.ahtSeconds > 0) override.ahtSeconds = snapshot.ahtSeconds
  if (snapshot.occupancy > 0) override.occupancy = snapshot.occupancy
  if (snapshot.requiredFte != null && Number.isFinite(snapshot.requiredFte)) {
    override.requiredFte = snapshot.requiredFte
  }
  return override
}

/** Copy Week 1 drivers to all non-locked future weeks. */
export function propagateWeek1Drivers(
  scenario: PlannerScenario,
  overrides: ScenarioCapacityPlanOverrideStore,
  locks: DriverWeekLockStore,
  snapshot: Week1DriverSnapshot,
): ScenarioCapacityPlanOverrideStore {
  const planStart = scenario.plan.capacityPlanStartWeek
  if (!planStart) return overrides
  const horizon = scenario.plan.planningWeeks ?? MAX_FUTURE_WEEKS
  const weeks = listForwardPlanWeeks(scenario, horizon)
  const scenarioOverrides = { ...(overrides[scenario.id] ?? {}) }
  const week1Override = weekOverrideFromSnapshot(snapshot)

  for (const week of weeks) {
    if (week === planStart) {
      scenarioOverrides[week] = { ...(scenarioOverrides[week] ?? {}), ...week1Override }
      continue
    }
    if (isDriverWeekLocked(scenario.id, week, locks)) continue
    scenarioOverrides[week] = { ...(scenarioOverrides[week] ?? {}), ...week1Override }
  }

  return { ...overrides, [scenario.id]: scenarioOverrides }
}

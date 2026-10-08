import { bestDriverModel, getScenarioDrivers, patchDriverForecast } from './advancedForecastPersistence'
import {
  loadScenarioForecastModes,
  saveScenarioForecastModes,
  type ScenarioForecastModes,
} from './capacityForecastModesPersistence'

export type DriverPlanApplySnapshot = Record<
  string,
  { applyToCapacityPlan: boolean; selectedModelId?: string }
>

export function snapshotDriverPlanApply(scenarioId: string): DriverPlanApplySnapshot {
  const out: DriverPlanApplySnapshot = {}
  for (const [metricId, config] of Object.entries(getScenarioDrivers(scenarioId))) {
    if (!config) continue
    out[metricId] = {
      applyToCapacityPlan: Boolean(config.applyToCapacityPlan),
      selectedModelId: config.selectedModelId,
    }
  }
  return out
}

export function driverPlanApplyEqual(a: DriverPlanApplySnapshot, b: DriverPlanApplySnapshot): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (Boolean(a[key]?.applyToCapacityPlan) !== Boolean(b[key]?.applyToCapacityPlan)) return false
    if ((a[key]?.selectedModelId ?? '') !== (b[key]?.selectedModelId ?? '')) return false
  }
  return true
}

export function restoreDriverPlanApply(scenarioId: string, snapshot: DriverPlanApplySnapshot): void {
  const ids = new Set([...Object.keys(getScenarioDrivers(scenarioId)), ...Object.keys(snapshot)])
  for (const metricId of ids) {
    patchDriverForecast(scenarioId, metricId, {
      applyToCapacityPlan: snapshot[metricId]?.applyToCapacityPlan ?? false,
      selectedModelId: snapshot[metricId]?.selectedModelId,
    })
  }
}

/**
 * Pin applied drivers onto forecast mode so future weeks in the Capacity Plan
 * use the selected model. Drivers that are no longer applied return to the
 * modes captured when the page was last saved.
 */
export function syncForecastModeForAppliedDrivers(
  scenarioId: string,
  baselineModes: ScenarioForecastModes,
): ScenarioForecastModes {
  const next: ScenarioForecastModes = { ...loadScenarioForecastModes(scenarioId) }
  for (const [metricId, config] of Object.entries(getScenarioDrivers(scenarioId))) {
    if (!config) continue
    const ready = Boolean(config.applyToCapacityPlan && bestDriverModel(config))
    if (ready) {
      next[metricId] = 'forecast'
      continue
    }
    const baseline = baselineModes[metricId]
    if (baseline) next[metricId] = baseline
    else delete next[metricId]
  }
  saveScenarioForecastModes(scenarioId, next)
  return next
}

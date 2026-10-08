import type { CapacityForecastMode } from './capacityPlanDerived'

export type CapacityDriverModeId = string

export type ScenarioForecastModes = Partial<Record<CapacityDriverModeId, CapacityForecastMode>>

export type ScenarioForecastModesStore = Record<string, ScenarioForecastModes>

const STORAGE_KEY = 'wfp-capacity-forecast-modes-v1'

export function loadForecastModesStore(): ScenarioForecastModesStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ScenarioForecastModesStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveForecastModesStore(store: ScenarioForecastModesStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function loadScenarioForecastModes(scenarioId: string): ScenarioForecastModes {
  return loadForecastModesStore()[scenarioId] ?? {}
}

export function saveScenarioForecastModes(scenarioId: string, modes: ScenarioForecastModes): void {
  const store = loadForecastModesStore()
  store[scenarioId] = { ...modes }
  saveForecastModesStore(store)
}

export function clearScenarioForecastModes(
  store: ScenarioForecastModesStore,
  scenarioId: string,
): ScenarioForecastModesStore {
  const next = { ...store }
  delete next[scenarioId]
  return next
}

export function forecastModesEqual(a: ScenarioForecastModes, b: ScenarioForecastModes): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<CapacityDriverModeId>
  for (const key of keys) {
    if ((a[key] ?? null) !== (b[key] ?? null)) return false
  }
  return true
}

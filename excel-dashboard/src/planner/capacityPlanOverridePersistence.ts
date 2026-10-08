import type { LedgerMetricSnapshot } from './weeklyLedger'

export type WeekCapacityPlanOverride = Partial<LedgerMetricSnapshot> & {
  shrinkageById?: Record<string, number>
}

export type ScenarioCapacityPlanOverrideStore = Record<string, Record<string, WeekCapacityPlanOverride>>

const STORAGE_KEY = 'wfp-capacity-plan-overrides-v1'

export function loadCapacityPlanOverrides(): ScenarioCapacityPlanOverrideStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ScenarioCapacityPlanOverrideStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveCapacityPlanOverrides(store: ScenarioCapacityPlanOverrideStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch (error) {
    const isQuota =
      error instanceof DOMException &&
      (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || error.code === 22)
    if (!isQuota) throw error
    // Keep the in-memory store usable; drop the largest scenario payload and retry once.
    const entries = Object.entries(store).sort(
      (a, b) => JSON.stringify(b[1]).length - JSON.stringify(a[1]).length,
    )
    if (entries.length <= 1) {
      console.warn('Capacity overrides exceed browser storage quota; changes kept in memory only.')
      return
    }
    const trimmed: ScenarioCapacityPlanOverrideStore = { ...store }
    delete trimmed[entries[0]![0]]
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
      console.warn(`Capacity overrides storage was full; cleared overrides for ${entries[0]![0]} to free space.`)
    } catch {
      console.warn('Capacity overrides exceed browser storage quota; changes kept in memory only.')
    }
  }
}

export function clearScenarioCapacityPlanOverrides(
  store: ScenarioCapacityPlanOverrideStore,
  scenarioId: string,
): ScenarioCapacityPlanOverrideStore {
  const next = { ...store }
  delete next[scenarioId]
  return next
}

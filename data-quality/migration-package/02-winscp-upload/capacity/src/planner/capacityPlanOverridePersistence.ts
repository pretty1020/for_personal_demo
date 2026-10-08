import type { LedgerMetricSnapshot } from './weeklyLedger'

export type WeekCapacityPlanOverride = Partial<LedgerMetricSnapshot> & {
  shrinkageById?: Record<string, number>
  supportHcByRole?: Record<string, number>
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function clearScenarioCapacityPlanOverrides(
  store: ScenarioCapacityPlanOverrideStore,
  scenarioId: string,
): ScenarioCapacityPlanOverrideStore {
  const next = { ...store }
  delete next[scenarioId]
  return next
}

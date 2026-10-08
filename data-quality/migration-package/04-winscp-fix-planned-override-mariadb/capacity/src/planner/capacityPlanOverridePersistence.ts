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

export function saveCapacityPlanOverrides(
  store: ScenarioCapacityPlanOverrideStore,
  options?: { skipRemoteSync?: boolean },
): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  if (options?.skipRemoteSync) return
  // Mirror Required Production FTE / planned metrics / Shrinkage into MariaDB staffing_plan
  // (not workspace_state). capacity_documents still holds the full override blob.
  void import('../data/staffingPlanSync').then((mod) => {
    mod.scheduleStaffingPlanRequiredHcSync(store)
  })
}

export function clearScenarioCapacityPlanOverrides(
  store: ScenarioCapacityPlanOverrideStore,
  scenarioId: string,
): ScenarioCapacityPlanOverrideStore {
  const next = { ...store }
  delete next[scenarioId]
  return next
}

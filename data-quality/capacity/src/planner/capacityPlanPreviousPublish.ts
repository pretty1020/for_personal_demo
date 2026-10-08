import type { CapacityPlanPublishSnapshot } from './capacityPlanBridge'
import type { WeekCapacityPlanOverride } from './capacityPlanOverridePersistence'
import type { PeriodGranularity } from './types'

const STORAGE_KEY = 'wfp-capacity-plan-previous-publish-v1'

/** Snapshot of a capacity plan that can be restored via Reset. */
export type PreviousCapacityPublish = {
  scenarioId: string
  scenarioName: string
  savedAt: string
  granularity: PeriodGranularity
  overrides: Record<string, WeekCapacityPlanOverride>
  snapshot?: CapacityPlanPublishSnapshot
  originalSnapshot?: CapacityPlanPublishSnapshot
}

export type PreviousCapacityPublishStore = {
  /** Plan displaced by the most recent Open / Publish / Republish. */
  lastDisplaced: PreviousCapacityPublish | null
  /** Per-scenario undo of the last publish for that LOB. */
  byScenario: Record<string, PreviousCapacityPublish>
}

function emptyStore(): PreviousCapacityPublishStore {
  return { lastDisplaced: null, byScenario: {} }
}

export function loadPreviousCapacityPublishStore(): PreviousCapacityPublishStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyStore()
    const parsed = JSON.parse(raw) as PreviousCapacityPublishStore
    return {
      lastDisplaced: parsed.lastDisplaced ?? null,
      byScenario: parsed.byScenario && typeof parsed.byScenario === 'object' ? parsed.byScenario : {},
    }
  } catch {
    return emptyStore()
  }
}

export function savePreviousCapacityPublishStore(store: PreviousCapacityPublishStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function clearPreviousCapacityPublishForScenario(
  store: PreviousCapacityPublishStore,
  scenarioId: string,
): PreviousCapacityPublishStore {
  const byScenario = { ...store.byScenario }
  delete byScenario[scenarioId]
  const lastDisplaced =
    store.lastDisplaced?.scenarioId === scenarioId ? null : store.lastDisplaced
  return { lastDisplaced, byScenario }
}

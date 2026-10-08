import { isRemoteBackend, apiSaveDocument } from '../data/apiClient'
import { writeDocumentCache } from '../data/capacityDocuments'
import type { LedgerMetricSnapshot } from './weeklyLedger'

export type WeekCapacityPlanOverride = Partial<LedgerMetricSnapshot> & {
  shrinkageById?: Record<string, number>
  supportHcByRole?: Record<string, number>
}

export type ScenarioCapacityPlanOverrideStore = Record<string, Record<string, WeekCapacityPlanOverride>>

const STORAGE_KEY = 'wfp-capacity-plan-overrides-v1'

/** In-memory session cache. Durable SoT is MariaDB staffing_plan + capacity_documents. */
let memoryStore: ScenarioCapacityPlanOverrideStore | null = null
/** Bumps on every remote save so stale in-flight mirrors are discarded. */
let saveGeneration = 0

function mirrorOverridesToSessionCache(store: ScenarioCapacityPlanOverrideStore): void {
  try {
    // Keep document session cache aligned for flushAllCapacityDocuments (memory, not disk).
    writeDocumentCache(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // ignore
  }
}

export function loadCapacityPlanOverrides(): ScenarioCapacityPlanOverrideStore {
  if (memoryStore) return memoryStore
  // Demo only — never treat localStorage as durable SoT when remote is on.
  if (!isRemoteBackend()) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        memoryStore = {}
        return memoryStore
      }
      const parsed = JSON.parse(raw) as ScenarioCapacityPlanOverrideStore
      memoryStore = parsed && typeof parsed === 'object' ? parsed : {}
      return memoryStore
    } catch {
      memoryStore = {}
      return memoryStore
    }
  }
  memoryStore = {}
  return memoryStore
}

/** Clear session cache before hydrate / owner switch so stale weeks cannot stick. */
export function resetCapacityPlanOverridesMemory(): void {
  memoryStore = {}
}

/**
 * Seed session cache from a capacity_documents payload after hydrate.
 * Does not removeItem — that would schedule a MariaDB DELETE via the document interceptor.
 */
export function hydrateCapacityPlanOverridesFromRemote(store: ScenarioCapacityPlanOverrideStore): void {
  memoryStore = store && typeof store === 'object' ? structuredClone(store) : {}
}

export function saveCapacityPlanOverrides(
  store: ScenarioCapacityPlanOverrideStore,
  options?: { skipRemoteSync?: boolean; flushImmediate?: boolean },
): void {
  memoryStore = store

  if (!isRemoteBackend()) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    } catch {
      // ignore quota errors in demo mode
    }
    return
  }

  // Keep read-through cache aligned so flushAllCapacityDocuments cannot overwrite
  // a fresh apiSaveDocument mirror with a stale hydrate snapshot.
  mirrorOverridesToSessionCache(store)

  if (options?.skipRemoteSync) return

  const generation = ++saveGeneration
  void import('../data/staffingPlanSync').then(async (mod) => {
    if (options?.flushImmediate) {
      // Flush mirrors capacity_documents after staffing_plan — no second PUT needed.
      await mod.flushStaffingPlanRequiredHcSync()
      return
    }
    mod.scheduleStaffingPlanRequiredHcSync(loadCapacityPlanOverrides())
    if (generation !== saveGeneration) return
    // Debounced path: mirror document promptly; staffing_plan catches up after debounce.
    await apiSaveDocument(STORAGE_KEY, loadCapacityPlanOverrides()).catch(() => {
      // staffing_plan remains primary; document mirror is secondary
    })
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

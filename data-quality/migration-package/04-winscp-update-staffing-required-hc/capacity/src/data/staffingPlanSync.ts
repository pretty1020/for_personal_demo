import { apiListStaffingPlan, apiSaveStaffingPlanWeeks, isRemoteBackend } from './apiClient'
import { actAsTargetId } from './capacityActAs'
import { clearExternalSaveError, reportExternalSaveError } from './capacityDocuments'
import {
  loadCapacityPlanOverrides,
  saveCapacityPlanOverrides,
  type ScenarioCapacityPlanOverrideStore,
} from '../planner/capacityPlanOverridePersistence'

const SYNC_DEBOUNCE_MS = 600
let syncTimer: ReturnType<typeof setTimeout> | null = null
let latestStore: ScenarioCapacityPlanOverrideStore | null = null

/**
 * Queue a sync of Required Production FTE into MariaDB staffing_plan.required_hc.
 * localStorage remains a read-through cache only — MariaDB is the durable store.
 */
export function scheduleStaffingPlanRequiredHcSync(
  store: ScenarioCapacityPlanOverrideStore = loadCapacityPlanOverrides(),
): void {
  if (!isRemoteBackend()) return
  latestStore = store
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = null
    void syncStaffingPlanRequiredHc(latestStore ?? loadCapacityPlanOverrides())
  }, SYNC_DEBOUNCE_MS)
}

/** Flush any pending staffing_plan sync immediately (save / pagehide). */
export async function flushStaffingPlanRequiredHcSync(): Promise<void> {
  if (syncTimer) {
    clearTimeout(syncTimer)
    syncTimer = null
  }
  await syncStaffingPlanRequiredHc(latestStore ?? loadCapacityPlanOverrides())
}

/**
 * Sync Required Production FTE from capacity plan overrides into MariaDB
 * staffing_plan.required_hc.
 */
export async function syncStaffingPlanRequiredHc(
  store: ScenarioCapacityPlanOverrideStore = loadCapacityPlanOverrides(),
): Promise<void> {
  if (!isRemoteBackend()) return

  const weeks: {
    scenarioId: string
    weekStart: string
    requiredHc: number | null
    productionHc: number | null
  }[] = []

  for (const [scenarioId, byWeek] of Object.entries(store)) {
    for (const [weekStart, snapshot] of Object.entries(byWeek ?? {})) {
      const requiredHc =
        snapshot.requiredFte != null && Number.isFinite(snapshot.requiredFte)
          ? snapshot.requiredFte
          : null
      const productionHc =
        snapshot.productionFte != null && Number.isFinite(snapshot.productionFte)
          ? snapshot.productionFte
          : null
      if (requiredHc == null && productionHc == null) continue
      weeks.push({ scenarioId, weekStart, requiredHc, productionHc })
    }
  }

  try {
    if (weeks.length === 0) {
      clearExternalSaveError('staffing_plan')
      return
    }
    await apiSaveStaffingPlanWeeks(weeks, { ownerUserId: actAsTargetId() })
    clearExternalSaveError('staffing_plan')
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Could not save Required FTE to MariaDB.'
    reportExternalSaveError('staffing_plan', message, () => {
      void syncStaffingPlanRequiredHc(store)
    })
  }
}

/**
 * Merge staffing_plan.required_hc into local overrides so Required Production FTE
 * is restored from MariaDB after refresh. MariaDB is the source of truth for required_hc.
 */
export async function mergeStaffingPlanIntoOverrides(): Promise<boolean> {
  if (!isRemoteBackend()) return false

  try {
    const rows = await apiListStaffingPlan(actAsTargetId())
    if (!rows.length) return false

    const store = loadCapacityPlanOverrides()
    let changed = false

    for (const row of rows) {
      if (row.requiredHc == null && row.productionHc == null) continue
      const scenario = { ...(store[row.scenarioId] ?? {}) }
      const week = { ...(scenario[row.weekStart] ?? {}) }

      if (row.requiredHc != null && Number.isFinite(row.requiredHc)) {
        if (week.requiredFte !== row.requiredHc) {
          week.requiredFte = row.requiredHc
          changed = true
        }
      }
      if (
        row.productionHc != null &&
        Number.isFinite(row.productionHc) &&
        week.productionFte == null
      ) {
        week.productionFte = row.productionHc
        changed = true
      }

      scenario[row.weekStart] = week
      store[row.scenarioId] = scenario
    }

    if (changed) {
      // Persist into the document cache without re-pushing to staffing_plan mid-hydrate.
      saveCapacityPlanOverrides(store, { skipRemoteSync: true })
    }
    clearExternalSaveError('staffing_plan')
    return changed
  } catch (error) {
    console.error('Could not load staffing_plan.required_hc from MariaDB:', error)
    return false
  }
}

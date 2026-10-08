import { apiListStaffingPlan, apiSaveStaffingPlanWeeks, isRemoteBackend } from './apiClient'
import { actAsTargetId } from './capacityActAs'
import { clearExternalSaveError, reportExternalSaveError } from './capacityDocuments'
import {
  loadCapacityPlanOverrides,
  saveCapacityPlanOverrides,
  type ScenarioCapacityPlanOverrideStore,
  type WeekCapacityPlanOverride,
} from '../planner/capacityPlanOverridePersistence'
import { loadShrinkageCategoryStore } from '../planner/capacityShrinkageCategoryPersistence'
import { loadLedgerOverrides, saveLedgerOverrides } from '../planner/ledgerPersistence'
import type { ImportedActualOverride } from '../planner/weeklyLedger'
import { SHRINKAGE_CATEGORY_TEMPLATES, type ShrinkageCategoryTemplate } from '../planner/shrinkageCategories'

const SYNC_DEBOUNCE_MS = 600
let syncTimer: ReturnType<typeof setTimeout> | null = null
let latestStore: ScenarioCapacityPlanOverrideStore | null = null

function categoryMeta(categoryId: string): { name: string; group: string } {
  const fromTemplates = SHRINKAGE_CATEGORY_TEMPLATES.find((item) => item.id === categoryId)
  if (fromTemplates) return { name: fromTemplates.name, group: fromTemplates.group }
  const store = loadShrinkageCategoryStore()
  for (const list of Object.values(store)) {
    const match = (list as ShrinkageCategoryTemplate[] | undefined)?.find((item) => item.id === categoryId)
    if (match) return { name: match.name, group: match.group }
  }
  return { name: categoryId, group: 'in_office' }
}

function buildShrinkagePayload(
  planned: WeekCapacityPlanOverride | undefined,
  actualShrinkageById: Record<string, number> | undefined,
): {
  categoryId: string
  categoryName: string
  categoryGroup: string
  plannedPct: number | null
  actualPct: number | null
}[] {
  const ids = new Set([
    ...Object.keys(planned?.shrinkageById ?? {}),
    ...Object.keys(actualShrinkageById ?? {}),
  ])
  const rows = []
  for (const categoryId of ids) {
    const plannedPct =
      planned?.shrinkageById?.[categoryId] != null && Number.isFinite(planned.shrinkageById[categoryId]!)
        ? planned.shrinkageById[categoryId]!
        : null
    const actualPct =
      actualShrinkageById?.[categoryId] != null && Number.isFinite(actualShrinkageById[categoryId]!)
        ? actualShrinkageById[categoryId]!
        : null
    if (plannedPct == null && actualPct == null) continue
    const meta = categoryMeta(categoryId)
    rows.push({
      categoryId,
      categoryName: meta.name,
      categoryGroup: meta.group,
      plannedPct,
      actualPct,
    })
  }
  return rows
}

function actualShrinkageForWeek(
  overrides: ImportedActualOverride[] | undefined,
  weekStart: string,
): Record<string, number> | undefined {
  const match = (overrides ?? []).find((item) => item.week === weekStart)
  return match?.shrinkageById
}

/**
 * Queue a sync of Required Production FTE, Production FTE, and Shrinkage Breakdown
 * into MariaDB staffing_plan / staffing_plan_shrinkage.
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
 * Sync Required Production FTE, Production FTE, and Shrinkage Breakdown into MariaDB.
 * MariaDB staffing_plan* tables are the durable, queryable store for these metrics.
 */
export async function syncStaffingPlanRequiredHc(
  store: ScenarioCapacityPlanOverrideStore = loadCapacityPlanOverrides(),
): Promise<void> {
  if (!isRemoteBackend()) return

  const ledger = loadLedgerOverrides()
  const weeks: {
    scenarioId: string
    weekStart: string
    requiredProductionFte: number | null
    productionFte: number | null
    shrinkage: ReturnType<typeof buildShrinkagePayload>
  }[] = []
  const seen = new Set<string>()

  for (const [scenarioId, byWeek] of Object.entries(store)) {
    const actualList = ledger[scenarioId] ?? []
    for (const [weekStart, snapshot] of Object.entries(byWeek ?? {})) {
      const requiredProductionFte =
        snapshot.requiredFte != null && Number.isFinite(snapshot.requiredFte)
          ? snapshot.requiredFte
          : null
      const productionFte =
        snapshot.productionFte != null && Number.isFinite(snapshot.productionFte)
          ? snapshot.productionFte
          : null
      const shrinkage = buildShrinkagePayload(snapshot, actualShrinkageForWeek(actualList, weekStart))
      if (requiredProductionFte == null && productionFte == null && shrinkage.length === 0) continue
      weeks.push({
        scenarioId,
        weekStart,
        requiredProductionFte,
        productionFte,
        shrinkage,
      })
      seen.add(`${scenarioId}::${weekStart}`)
    }
  }

  for (const [scenarioId, actualList] of Object.entries(ledger)) {
    for (const actual of actualList ?? []) {
      const key = `${scenarioId}::${actual.week}`
      if (seen.has(key)) continue
      const shrinkage = buildShrinkagePayload(undefined, actual.shrinkageById)
      if (!shrinkage.length) continue
      weeks.push({
        scenarioId,
        weekStart: actual.week,
        requiredProductionFte: null,
        productionFte: null,
        shrinkage,
      })
      seen.add(key)
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
      error instanceof Error
        ? error.message
        : 'Could not save Required Production FTE / Shrinkage Breakdown to MariaDB.'
    reportExternalSaveError('staffing_plan', message, () => {
      void syncStaffingPlanRequiredHc(store)
    })
  }
}

/**
 * Merge staffing_plan (+ shrinkage) into local overrides so Required Production FTE,
 * Production FTE, and Shrinkage Breakdown restore from MariaDB after refresh.
 */
export async function mergeStaffingPlanIntoOverrides(): Promise<boolean> {
  if (!isRemoteBackend()) return false

  try {
    const rows = await apiListStaffingPlan(actAsTargetId())
    if (!rows.length) return false

    const store = loadCapacityPlanOverrides()
    const ledger = loadLedgerOverrides()
    let changed = false
    let ledgerChanged = false

    for (const row of rows) {
      const hasFte = row.requiredProductionFte != null || row.productionFte != null
      const hasShrinkage = (row.shrinkage ?? []).length > 0
      if (!hasFte && !hasShrinkage) continue

      const scenario = { ...(store[row.scenarioId] ?? {}) }
      const week = { ...(scenario[row.weekStart] ?? {}) }

      if (row.requiredProductionFte != null && Number.isFinite(row.requiredProductionFte)) {
        if (week.requiredFte !== row.requiredProductionFte) {
          week.requiredFte = row.requiredProductionFte
          changed = true
        }
      }
      if (
        row.productionFte != null &&
        Number.isFinite(row.productionFte) &&
        week.productionFte !== row.productionFte
      ) {
        week.productionFte = row.productionFte
        changed = true
      }

      if (hasShrinkage) {
        const planned: Record<string, number> = { ...(week.shrinkageById ?? {}) }
        let plannedTouched = false
        const actualList = [...(ledger[row.scenarioId] ?? [])]
        const actualIndex = actualList.findIndex((item) => item.week === row.weekStart)
        const existingActual = actualIndex >= 0 ? actualList[actualIndex]! : null
        const actualShrink: Record<string, number> = { ...(existingActual?.shrinkageById ?? {}) }
        let actualTouched = false

        for (const item of row.shrinkage ?? []) {
          if (item.plannedPct != null && Number.isFinite(item.plannedPct)) {
            if (planned[item.categoryId] !== item.plannedPct) {
              planned[item.categoryId] = item.plannedPct
              plannedTouched = true
            }
          }
          if (item.actualPct != null && Number.isFinite(item.actualPct)) {
            if (actualShrink[item.categoryId] !== item.actualPct) {
              actualShrink[item.categoryId] = item.actualPct
              actualTouched = true
            }
          }
        }

        if (plannedTouched) {
          week.shrinkageById = planned
          changed = true
        }
        if (actualTouched) {
          const nextActual: ImportedActualOverride = {
            ...(existingActual ?? { week: row.weekStart, metrics: {} }),
            week: row.weekStart,
            metrics: existingActual?.metrics ?? {},
            shrinkageById: actualShrink,
          }
          if (actualIndex >= 0) actualList[actualIndex] = nextActual
          else actualList.push(nextActual)
          ledger[row.scenarioId] = actualList
          ledgerChanged = true
        }
      }

      scenario[row.weekStart] = week
      store[row.scenarioId] = scenario
    }

    if (changed) {
      saveCapacityPlanOverrides(store, { skipRemoteSync: true })
    }
    if (ledgerChanged) {
      saveLedgerOverrides(ledger)
    }
    clearExternalSaveError('staffing_plan')
    return changed || ledgerChanged
  } catch (error) {
    console.error('Could not load staffing_plan from MariaDB:', error)
    return false
  }
}

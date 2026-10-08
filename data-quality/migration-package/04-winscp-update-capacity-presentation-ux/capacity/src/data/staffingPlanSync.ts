import { apiListStaffingPlan, apiSaveStaffingPlanWeeks, apiSaveDocument, isRemoteBackend } from './apiClient'
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
/** Single-flight so overlapping flushImmediate / pagehide / upload cannot race-wipe rows. */
let syncInFlight: Promise<void> | null = null
let syncQueuedAgain = false

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

/** Strip shrinkage into its own table; keep remaining metrics for planned_override_json. */
function buildPlannedOverridePayload(
  snapshot: WeekCapacityPlanOverride,
): Record<string, unknown> | null {
  const { shrinkageById: _shrinkage, ...rest } = snapshot
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rest)) {
    if (value == null) continue
    if (typeof value === 'number') {
      if (Number.isFinite(value)) cleaned[key] = value
      continue
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      const nested: Record<string, number> = {}
      for (const [nestedKey, nestedVal] of Object.entries(value as Record<string, unknown>)) {
        if (typeof nestedVal === 'number' && Number.isFinite(nestedVal)) nested[nestedKey] = nestedVal
      }
      if (Object.keys(nested).length) cleaned[key] = nested
    }
  }
  return Object.keys(cleaned).length ? cleaned : null
}

function buildActualOverridePayload(
  actual: ImportedActualOverride | undefined,
): Record<string, unknown> | null {
  if (!actual) return null
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(actual.metrics ?? {})) {
    if (typeof value === 'number' && Number.isFinite(value)) cleaned[key] = value
  }
  if (actual.supportHcByRole && Object.keys(actual.supportHcByRole).length) {
    cleaned.supportHcByRole = { ...actual.supportHcByRole }
  }
  if (typeof actual.notes === 'string' && actual.notes.trim()) {
    cleaned.notes = actual.notes.trim().slice(0, 2000)
  }
  return Object.keys(cleaned).length ? cleaned : null
}

/**
 * Queue a sync of planned week metrics into MariaDB staffing_plan / staffing_plan_shrinkage.
 */
export function scheduleStaffingPlanRequiredHcSync(
  store: ScenarioCapacityPlanOverrideStore = loadCapacityPlanOverrides(),
): void {
  if (!isRemoteBackend()) return
  latestStore = store
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = null
    void syncStaffingPlanRequiredHc(latestStore ?? loadCapacityPlanOverrides()).catch(() => {
      // Surfaced via reportExternalSaveError / save-status banner.
    })
  }, SYNC_DEBOUNCE_MS)
}

/** Flush any pending staffing_plan sync immediately (save / pagehide / upload). */
export async function flushStaffingPlanRequiredHcSync(): Promise<void> {
  if (syncTimer) {
    clearTimeout(syncTimer)
    syncTimer = null
  }
  // Always read memory + ledger at flush time so upload partials do not race.
  await syncStaffingPlanRequiredHc(loadCapacityPlanOverrides())
  // Mirror planned weeks into capacity_documents (overrides are not kept in localStorage).
  if (isRemoteBackend()) {
    await apiSaveDocument('wfp-capacity-plan-overrides-v1', loadCapacityPlanOverrides()).catch(() => {
      // staffing_plan remains primary
    })
  }
}

/**
 * Sync full planned week overrides + FTE + Shrinkage Breakdown into MariaDB.
 * staffing_plan is the durable, queryable store (not workspace_state / local-only).
 */
export async function syncStaffingPlanRequiredHc(
  store: ScenarioCapacityPlanOverrideStore = loadCapacityPlanOverrides(),
): Promise<void> {
  if (!isRemoteBackend()) return

  latestStore = store
  if (syncInFlight) {
    syncQueuedAgain = true
    await syncInFlight
    if (!syncQueuedAgain) return
    syncQueuedAgain = false
    return syncStaffingPlanRequiredHc(loadCapacityPlanOverrides())
  }

  const run = (async () => {
    // Prefer live memory — callers may pass a stale snapshot mid-upload.
    const effectiveStore = loadCapacityPlanOverrides()
    const ledger = loadLedgerOverrides()
    const weeks: {
      scenarioId: string
      weekStart: string
      requiredProductionFte?: number | null
      productionFte?: number | null
      plannedOverride?: Record<string, unknown> | null
      actualOverride?: Record<string, unknown> | null
      shrinkage?: ReturnType<typeof buildShrinkagePayload>
    }[] = []
    const seen = new Set<string>()

    for (const [scenarioId, byWeek] of Object.entries(effectiveStore)) {
      const actualList = ledger[scenarioId] ?? []
      for (const [weekStart, snapshot] of Object.entries(byWeek ?? {})) {
        let requiredProductionFte =
          snapshot.requiredFte != null && Number.isFinite(snapshot.requiredFte)
            ? snapshot.requiredFte
            : null
        let productionFte =
          snapshot.productionFte != null && Number.isFinite(snapshot.productionFte)
            ? snapshot.productionFte
            : null

        // Derive Required Production FTE from uploaded Volume × AHT × Occupancy when not stored yet.
        if (
          requiredProductionFte == null &&
          snapshot.callVolume != null &&
          snapshot.ahtSeconds != null &&
          snapshot.occupancy != null
        ) {
          const volume = snapshot.callVolume
          const aht = snapshot.ahtSeconds
          const occ = snapshot.occupancy
          if (volume > 0 && aht > 0 && occ > 0) {
            const capacitySeconds = 40 * 3600 * occ
            const computed = (volume * aht) / capacitySeconds
            if (Number.isFinite(computed) && computed >= 0) requiredProductionFte = computed
          }
        }

        const plannedOverride = buildPlannedOverridePayload({
          ...snapshot,
          ...(requiredProductionFte != null ? { requiredFte: requiredProductionFte } : {}),
          ...(productionFte != null ? { productionFte } : {}),
        })
        const actualRow = actualList.find((item) => item.week === weekStart)
        const actualOverride = buildActualOverridePayload(actualRow)
        const shrinkage = buildShrinkagePayload(snapshot, actualShrinkageForWeek(actualList, weekStart))
        // Always push the week — empty planned/actual objects clear MariaDB so deletions survive refresh.
        // Omit empty shrinkage arrays so we do not wipe category rows unintentionally.
        weeks.push({
          scenarioId,
          weekStart,
          ...(requiredProductionFte != null ? { requiredProductionFte } : {}),
          ...(productionFte != null ? { productionFte } : {}),
          plannedOverride: plannedOverride ?? {},
          ...(actualOverride || actualRow ? { actualOverride: actualOverride ?? {} } : {}),
          ...(shrinkage.length ? { shrinkage } : {}),
        })
        seen.add(`${scenarioId}::${weekStart}`)
      }
    }

    for (const [scenarioId, actualList] of Object.entries(ledger)) {
      for (const actual of actualList ?? []) {
        const key = `${scenarioId}::${actual.week}`
        if (seen.has(key)) continue
        const shrinkage = buildShrinkagePayload(undefined, actual.shrinkageById)
        const actualOverride = buildActualOverridePayload(actual)
        // Empty actual weeks still sync so cleared Actual cells are not resurrected.
        weeks.push({
          scenarioId,
          weekStart: actual.week,
          actualOverride: actualOverride ?? {},
          ...(shrinkage.length ? { shrinkage } : {}),
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
          : 'Could not save planned week metrics / Shrinkage Breakdown to MariaDB.'
      reportExternalSaveError('staffing_plan', message, () => {
        void syncStaffingPlanRequiredHc(loadCapacityPlanOverrides())
      })
      throw error
    }
  })()

  syncInFlight = run.finally(() => {
    syncInFlight = null
  })
  await syncInFlight
  if (syncQueuedAgain) {
    syncQueuedAgain = false
    return syncStaffingPlanRequiredHc(loadCapacityPlanOverrides())
  }
}

/**
 * Merge staffing_plan (+ shrinkage + planned_override_json) into local overrides
 * so template upload metrics restore from MariaDB after refresh.
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
      const plannedOverride =
        row.plannedOverride && typeof row.plannedOverride === 'object' ? row.plannedOverride : null
      const actualOverride =
        row.actualOverride && typeof row.actualOverride === 'object' ? row.actualOverride : null
      const hasFte = row.requiredProductionFte != null || row.productionFte != null
      const hasPlanned = Boolean(plannedOverride && Object.keys(plannedOverride).length)
      const hasActual = Boolean(actualOverride && Object.keys(actualOverride).length)
      const hasShrinkage = (row.shrinkage ?? []).length > 0
      if (!hasFte && !hasPlanned && !hasActual && !hasShrinkage) continue

      const scenario = { ...(store[row.scenarioId] ?? {}) }
      const week = { ...(scenario[row.weekStart] ?? {}) }

      if (plannedOverride) {
        for (const [key, value] of Object.entries(plannedOverride)) {
          if (key === 'shrinkageById' || key === 'supportHcByRole') continue
          const current = (week as Record<string, unknown>)[key]
          if (JSON.stringify(current) !== JSON.stringify(value)) {
            ;(week as Record<string, unknown>)[key] = value
            changed = true
          }
        }
        if (
          plannedOverride.supportHcByRole &&
          typeof plannedOverride.supportHcByRole === 'object' &&
          JSON.stringify(week.supportHcByRole) !== JSON.stringify(plannedOverride.supportHcByRole)
        ) {
          week.supportHcByRole = plannedOverride.supportHcByRole as Record<string, number>
          changed = true
        }
      }

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

      if (hasActual) {
        const actualList = [...(ledger[row.scenarioId] ?? [])]
        const actualIndex = actualList.findIndex((item) => item.week === row.weekStart)
        const existingActual = actualIndex >= 0 ? actualList[actualIndex]! : null
        const metrics: Partial<import('../planner/weeklyLedger').LedgerMetricSnapshot> = {
          ...(existingActual?.metrics ?? {}),
        }
        let metricsTouched = false
        for (const [key, value] of Object.entries(actualOverride!)) {
          if (key === 'supportHcByRole' || key === 'notes') continue
          if (typeof value !== 'number' || !Number.isFinite(value)) continue
          const metricId = key as keyof import('../planner/weeklyLedger').LedgerMetricSnapshot
          if (metrics[metricId] !== value) {
            metrics[metricId] = value
            metricsTouched = true
          }
        }
        let supportHcByRole = existingActual?.supportHcByRole
        if (
          actualOverride!.supportHcByRole &&
          typeof actualOverride!.supportHcByRole === 'object'
        ) {
          supportHcByRole = actualOverride!.supportHcByRole as Record<string, number>
          metricsTouched = true
        }
        const notesFromDb =
          typeof actualOverride!.notes === 'string' ? (actualOverride!.notes as string) : undefined
        if (notesFromDb != null && notesFromDb !== existingActual?.notes) {
          metricsTouched = true
        }
        if (metricsTouched || !existingActual) {
          const nextActual: ImportedActualOverride = {
            ...(existingActual ?? { week: row.weekStart, metrics: {} }),
            week: row.weekStart,
            metrics,
            ...(supportHcByRole ? { supportHcByRole } : {}),
            ...(existingActual?.shrinkageById ? { shrinkageById: existingActual.shrinkageById } : {}),
            ...(notesFromDb != null
              ? { notes: notesFromDb }
              : existingActual?.notes
                ? { notes: existingActual.notes }
                : {}),
          }
          if (actualIndex >= 0) actualList[actualIndex] = nextActual
          else actualList.push(nextActual)
          ledger[row.scenarioId] = actualList
          ledgerChanged = true
        }
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
      // Hydrate must not schedule a staffing sync (would race with incomplete UI state).
      saveLedgerOverrides(ledger, { skipRemoteSync: true })
    }
    clearExternalSaveError('staffing_plan')
    return changed || ledgerChanged
  } catch (error) {
    console.error('Could not load staffing_plan from MariaDB:', error)
    return false
  }
}

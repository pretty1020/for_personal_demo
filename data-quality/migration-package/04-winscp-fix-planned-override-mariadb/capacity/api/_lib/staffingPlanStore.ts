import { randomUUID } from 'node:crypto'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { execute, queryRows } from './db.js'
import { canReadAllDocuments, canWriteOthersDocuments } from './documentAccess.js'

export type StaffingPlanShrinkageInput = {
  categoryId: string
  categoryName?: string
  categoryGroup?: 'out_of_office' | 'in_office' | string
  plannedPct?: number | null
  actualPct?: number | null
}

export type StaffingPlanWeekRow = {
  id: string
  scenarioId: string
  weekStart: string
  requiredProductionFte: number | null
  productionFte: number | null
  /** Full planned week override metrics (volume, AHT, occupancy, HC, …) excluding shrinkage. */
  plannedOverride: Record<string, unknown> | null
  ownerUserId: string
  updatedAt: string
  shrinkage: StaffingPlanShrinkageRow[]
}

export type StaffingPlanShrinkageRow = {
  categoryId: string
  categoryName: string
  categoryGroup: string
  plannedPct: number | null
  actualPct: number | null
}

export type StaffingPlanUpsertInput = {
  scenarioId: string
  weekStart: string
  requiredProductionFte?: number | null
  productionFte?: number | null
  plannedOverride?: Record<string, unknown> | null
  /** When provided, replaces all shrinkage rows for that week. */
  shrinkage?: StaffingPlanShrinkageInput[]
}

export class StaffingPlanStoreError extends Error {
  status: number
  code: string

  constructor(status: number, message: string, code: string) {
    super(message)
    this.name = 'StaffingPlanStoreError'
    this.status = status
    this.code = code
  }
}

type DbPlanRow = RowDataPacket & {
  id: string
  owner_user_id: string
  scenario_id: string
  week_start: Date | string
  required_production_fte: number | string | null
  production_fte: number | string | null
  planned_override_json?: string | Record<string, unknown> | null
  updated_at: Date | string
}

type DbShrinkRow = RowDataPacket & {
  staffing_plan_id: string
  category_id: string
  category_name: string
  category_group: string
  planned_pct: number | string | null
  actual_pct: number | string | null
}

function toIsoDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const raw = String(value)
  return raw.length >= 10 ? raw.slice(0, 10) : raw
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toNullableNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

function assertWeekStart(weekStart: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new StaffingPlanStoreError(400, `Invalid week_start: ${weekStart}`, 'invalid_week')
  }
  return weekStart
}

function assertScenarioId(scenarioId: string): string {
  const trimmed = scenarioId.trim()
  if (!trimmed || trimmed.length > 96) {
    throw new StaffingPlanStoreError(400, 'Invalid scenario_id.', 'invalid_scenario')
  }
  return trimmed
}

function mapDbError(error: unknown): never {
  const err = error as { code?: string; message?: string; errno?: number }
  const message = String(err?.message ?? error)
  if (
    err?.code === 'ER_NO_SUCH_TABLE' ||
    message.includes("doesn't exist") ||
    message.includes('Unknown table')
  ) {
    throw new StaffingPlanStoreError(
      503,
      'staffing_plan table is missing. Run database/mariadb/011_staffing_plan.sql and 012_staffing_plan_normalized.sql in SQLyog.',
      'schema_missing',
    )
  }
  if (
    err?.code === 'ER_BAD_FIELD_ERROR' ||
    message.includes('Unknown column')
  ) {
    throw new StaffingPlanStoreError(
      503,
      'staffing_plan columns are outdated. Run database/mariadb/012_staffing_plan_normalized.sql and 014_staffing_plan_planned_override.sql.',
      'schema_outdated',
    )
  }
  throw error
}

function parsePlannedOverrideJson(
  value: string | Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (value == null || value === '') return null
  if (typeof value === 'object' && !Array.isArray(value)) return value
  try {
    const parsed = JSON.parse(String(value)) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // ignore
  }
  return null
}

function serializePlannedOverride(
  value: Record<string, unknown> | null | undefined,
): string | null {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const cleaned: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'shrinkageById') continue
    if (raw == null) continue
    if (typeof raw === 'number') {
      if (Number.isFinite(raw)) cleaned[key] = raw
      continue
    }
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      const nested: Record<string, number> = {}
      for (const [nestedKey, nestedVal] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof nestedVal === 'number' && Number.isFinite(nestedVal)) nested[nestedKey] = nestedVal
      }
      if (Object.keys(nested).length) cleaned[key] = nested
    }
  }
  return Object.keys(cleaned).length ? JSON.stringify(cleaned) : null
}

async function loadShrinkageForPlans(planIds: string[]): Promise<Map<string, StaffingPlanShrinkageRow[]>> {
  const byPlan = new Map<string, StaffingPlanShrinkageRow[]>()
  if (!planIds.length) return byPlan
  const placeholders = planIds.map(() => '?').join(',')
  let rows: DbShrinkRow[]
  try {
    rows = await queryRows<DbShrinkRow>(
      `SELECT staffing_plan_id, category_id, category_name, category_group, planned_pct, actual_pct
         FROM staffing_plan_shrinkage
        WHERE staffing_plan_id IN (${placeholders})
        ORDER BY category_id ASC`,
      planIds,
    )
  } catch (error) {
    mapDbError(error)
  }
  for (const row of rows) {
    const list = byPlan.get(row.staffing_plan_id) ?? []
    list.push({
      categoryId: row.category_id,
      categoryName: row.category_name ?? '',
      categoryGroup: row.category_group ?? 'in_office',
      plannedPct: toNullableNumber(row.planned_pct),
      actualPct: toNullableNumber(row.actual_pct),
    })
    byPlan.set(row.staffing_plan_id, list)
  }
  return byPlan
}

function toWeekRow(row: DbPlanRow, shrinkage: StaffingPlanShrinkageRow[]): StaffingPlanWeekRow {
  return {
    id: row.id,
    scenarioId: row.scenario_id,
    weekStart: toIsoDate(row.week_start),
    requiredProductionFte: toNullableNumber(row.required_production_fte),
    productionFte: toNullableNumber(row.production_fte),
    plannedOverride: parsePlannedOverrideJson(row.planned_override_json),
    ownerUserId: row.owner_user_id,
    updatedAt: toIso(row.updated_at),
    shrinkage,
  }
}

const PLAN_SELECT_COLUMNS =
  'id, owner_user_id, scenario_id, week_start, required_production_fte, production_fte, planned_override_json, updated_at'

export async function listStaffingPlanWeeks(ownerUserId: string): Promise<StaffingPlanWeekRow[]> {
  let rows: DbPlanRow[]
  try {
    rows = await queryRows<DbPlanRow>(
      `SELECT ${PLAN_SELECT_COLUMNS}
         FROM staffing_plan
        WHERE owner_user_id = ?
        ORDER BY scenario_id ASC, week_start ASC`,
      [ownerUserId],
    )
  } catch (error) {
    mapDbError(error)
  }
  const shrinkage = await loadShrinkageForPlans(rows.map((row) => row.id))
  return rows.map((row) => toWeekRow(row, shrinkage.get(row.id) ?? []))
}

/** Manager+ — every planner's staffing_plan weeks (for portfolio / Leakage). */
export async function listAllStaffingPlanWeeks(): Promise<StaffingPlanWeekRow[]> {
  let rows: DbPlanRow[]
  try {
    rows = await queryRows<DbPlanRow>(
      `SELECT ${PLAN_SELECT_COLUMNS}
         FROM staffing_plan
        ORDER BY owner_user_id ASC, scenario_id ASC, week_start ASC`,
    )
  } catch (error) {
    mapDbError(error)
  }
  const shrinkage = await loadShrinkageForPlans(rows.map((row) => row.id))
  return rows.map((row) => toWeekRow(row, shrinkage.get(row.id) ?? []))
}

async function replaceShrinkageForPlan(
  staffingPlanId: string,
  shrinkage: StaffingPlanShrinkageInput[] | undefined,
): Promise<void> {
  if (shrinkage === undefined) return
  try {
    await execute(`DELETE FROM staffing_plan_shrinkage WHERE staffing_plan_id = ?`, [staffingPlanId])
    for (const item of shrinkage) {
      const categoryId = String(item.categoryId ?? '').trim()
      if (!categoryId || categoryId.length > 96) continue
      const plannedPct =
        item.plannedPct == null || Number.isNaN(Number(item.plannedPct)) ? null : Number(item.plannedPct)
      const actualPct =
        item.actualPct == null || Number.isNaN(Number(item.actualPct)) ? null : Number(item.actualPct)
      if (plannedPct == null && actualPct == null) continue
      await execute(
        `INSERT INTO staffing_plan_shrinkage
           (id, staffing_plan_id, category_id, category_name, category_group, planned_pct, actual_pct)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          staffingPlanId,
          categoryId,
          String(item.categoryName ?? '').slice(0, 191),
          String(item.categoryGroup ?? 'in_office').slice(0, 32),
          plannedPct,
          actualPct,
        ],
      )
    }
  } catch (error) {
    mapDbError(error)
  }
}

/**
 * Upserts Required Production FTE, Production FTE, planned override metrics, and Shrinkage.
 * Weeks with no FTE, no planned metrics, and no shrinkage are deleted.
 */
export async function upsertStaffingPlanWeeks(
  ownerUserId: string,
  actorAccessLevel: string,
  targetOwnerUserId: string | undefined,
  weeks: StaffingPlanUpsertInput[],
): Promise<StaffingPlanWeekRow[]> {
  const ownerId = targetOwnerUserId?.trim() || ownerUserId
  if (ownerId !== ownerUserId && !canWriteOthersDocuments(actorAccessLevel)) {
    throw new StaffingPlanStoreError(
      403,
      "You cannot update another planner's staffing plan.",
      'forbidden',
    )
  }

  if (!Array.isArray(weeks) || weeks.length === 0) {
    throw new StaffingPlanStoreError(400, 'weeks array is required.', 'invalid_body')
  }
  if (weeks.length > 5000) {
    throw new StaffingPlanStoreError(400, 'Too many weeks in one request.', 'invalid_body')
  }

  const saved: StaffingPlanWeekRow[] = []

  for (const week of weeks) {
    const scenarioId = assertScenarioId(String(week.scenarioId ?? ''))
    const weekStart = assertWeekStart(String(week.weekStart ?? ''))
    const requiredProductionFte =
      week.requiredProductionFte === undefined
        ? undefined
        : week.requiredProductionFte == null || Number.isNaN(Number(week.requiredProductionFte))
          ? null
          : Number(week.requiredProductionFte)
    const productionFte =
      week.productionFte === undefined
        ? undefined
        : week.productionFte == null || Number.isNaN(Number(week.productionFte))
          ? null
          : Number(week.productionFte)
    const plannedOverrideProvided = week.plannedOverride !== undefined
    const plannedOverrideJson = plannedOverrideProvided
      ? serializePlannedOverride(week.plannedOverride)
      : undefined

    let existing: DbPlanRow[]
    try {
      existing = await queryRows<DbPlanRow>(
        `SELECT ${PLAN_SELECT_COLUMNS}
           FROM staffing_plan
          WHERE owner_user_id = ? AND scenario_id = ? AND week_start = ?
          LIMIT 1`,
        [ownerId, scenarioId, weekStart],
      )
    } catch (error) {
      mapDbError(error)
    }
    const current = existing[0]
    const nextRequired =
      requiredProductionFte === undefined
        ? toNullableNumber(current?.required_production_fte)
        : requiredProductionFte
    const nextProduction =
      productionFte === undefined ? toNullableNumber(current?.production_fte) : productionFte
    const nextPlannedJson =
      plannedOverrideJson === undefined
        ? current?.planned_override_json != null
          ? typeof current.planned_override_json === 'string'
            ? current.planned_override_json
            : JSON.stringify(current.planned_override_json)
          : null
        : plannedOverrideJson
    const hasShrinkagePayload = Array.isArray(week.shrinkage) && week.shrinkage.length > 0
    const hasPlannedMetrics =
      nextPlannedJson != null &&
      nextPlannedJson !== '' &&
      nextPlannedJson !== '{}' &&
      nextPlannedJson !== 'null'

    if (
      nextRequired == null &&
      nextProduction == null &&
      !hasPlannedMetrics &&
      !hasShrinkagePayload &&
      week.shrinkage === undefined
    ) {
      if (current) {
        try {
          await execute(
            `DELETE FROM staffing_plan
              WHERE owner_user_id = ? AND scenario_id = ? AND week_start = ?`,
            [ownerId, scenarioId, weekStart],
          )
        } catch (error) {
          mapDbError(error)
        }
      }
      continue
    }

    // Keep a row when shrinkage is being cleared explicitly while FTE/metrics are null.
    if (
      nextRequired == null &&
      nextProduction == null &&
      !hasPlannedMetrics &&
      week.shrinkage !== undefined &&
      !hasShrinkagePayload
    ) {
      if (current) {
        try {
          await execute(
            `DELETE FROM staffing_plan
              WHERE owner_user_id = ? AND scenario_id = ? AND week_start = ?`,
            [ownerId, scenarioId, weekStart],
          )
        } catch (error) {
          mapDbError(error)
        }
      }
      continue
    }

    let planId = current?.id
    try {
      if (current) {
        await execute(
          `UPDATE staffing_plan
              SET required_production_fte = ?, production_fte = ?, planned_override_json = ?
            WHERE owner_user_id = ? AND scenario_id = ? AND week_start = ?`,
          [nextRequired, nextProduction, nextPlannedJson, ownerId, scenarioId, weekStart],
        )
      } else {
        planId = randomUUID()
        await execute(
          `INSERT INTO staffing_plan
             (id, owner_user_id, scenario_id, week_start, required_production_fte, production_fte, planned_override_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [planId, ownerId, scenarioId, weekStart, nextRequired, nextProduction, nextPlannedJson],
        )
      }
    } catch (error) {
      mapDbError(error)
    }

    if (!planId) {
      const refreshedId = await queryRows<DbPlanRow>(
        `SELECT id FROM staffing_plan
          WHERE owner_user_id = ? AND scenario_id = ? AND week_start = ?
          LIMIT 1`,
        [ownerId, scenarioId, weekStart],
      )
      planId = refreshedId[0]?.id
    }
    if (planId) await replaceShrinkageForPlan(planId, week.shrinkage)

    const refreshed = await queryRows<DbPlanRow>(
      `SELECT ${PLAN_SELECT_COLUMNS}
         FROM staffing_plan
        WHERE owner_user_id = ? AND scenario_id = ? AND week_start = ?
        LIMIT 1`,
      [ownerId, scenarioId, weekStart],
    )
    if (refreshed[0]) {
      const shrink = await loadShrinkageForPlans([refreshed[0].id])
      saved.push(toWeekRow(refreshed[0], shrink.get(refreshed[0].id) ?? []))
    }
  }

  return saved
}

export async function replaceScenarioStaffingPlanWeeks(
  ownerUserId: string,
  actorAccessLevel: string,
  targetOwnerUserId: string | undefined,
  scenarioIdRaw: string,
  weeks: StaffingPlanUpsertInput[],
): Promise<StaffingPlanWeekRow[]> {
  const ownerId = targetOwnerUserId?.trim() || ownerUserId
  if (ownerId !== ownerUserId && !canWriteOthersDocuments(actorAccessLevel)) {
    throw new StaffingPlanStoreError(
      403,
      "You cannot update another planner's staffing plan.",
      'forbidden',
    )
  }
  const scenarioId = assertScenarioId(scenarioIdRaw)

  try {
    await execute(`DELETE FROM staffing_plan WHERE owner_user_id = ? AND scenario_id = ?`, [
      ownerId,
      scenarioId,
    ])
  } catch (error) {
    mapDbError(error)
  }

  if (!weeks.length) return []

  const withScenario = weeks.map((week) => ({ ...week, scenarioId }))
  return upsertStaffingPlanWeeks(ownerUserId, actorAccessLevel, ownerId, withScenario)
}

export async function deleteScenarioStaffingPlan(
  ownerUserId: string,
  actorAccessLevel: string,
  targetOwnerUserId: string | undefined,
  scenarioIdRaw: string,
): Promise<ResultSetHeader> {
  const ownerId = targetOwnerUserId?.trim() || ownerUserId
  if (ownerId !== ownerUserId && !canWriteOthersDocuments(actorAccessLevel)) {
    throw new StaffingPlanStoreError(
      403,
      "You cannot update another planner's staffing plan.",
      'forbidden',
    )
  }
  const scenarioId = assertScenarioId(scenarioIdRaw)
  try {
    return await execute(`DELETE FROM staffing_plan WHERE owner_user_id = ? AND scenario_id = ?`, [
      ownerId,
      scenarioId,
    ])
  } catch (error) {
    mapDbError(error)
  }
}

export function assertCanListAllStaffingPlans(accessLevel: string): void {
  if (!canReadAllDocuments(accessLevel)) {
    throw new StaffingPlanStoreError(
      403,
      'Only Manager and above can list every planner staffing plan.',
      'forbidden',
    )
  }
}

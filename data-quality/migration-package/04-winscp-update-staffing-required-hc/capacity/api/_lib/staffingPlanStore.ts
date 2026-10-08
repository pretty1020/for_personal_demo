import { randomUUID } from 'node:crypto'
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise'
import { execute, queryRows } from './db.js'
import { canWriteOthersDocuments } from './documentAccess.js'

export type StaffingPlanWeekRow = {
  scenarioId: string
  weekStart: string
  requiredHc: number | null
  productionHc: number | null
  ownerUserId: string
  updatedAt: string
}

export type StaffingPlanUpsertInput = {
  scenarioId: string
  weekStart: string
  requiredHc?: number | null
  productionHc?: number | null
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

type DbRow = RowDataPacket & {
  owner_user_id: string
  scenario_id: string
  week_start: Date | string
  required_hc: number | string | null
  production_hc: number | string | null
  updated_at: Date | string
}

function toIsoDate(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }
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

function toRow(row: DbRow): StaffingPlanWeekRow {
  return {
    scenarioId: row.scenario_id,
    weekStart: toIsoDate(row.week_start),
    requiredHc: toNullableNumber(row.required_hc),
    productionHc: toNullableNumber(row.production_hc),
    ownerUserId: row.owner_user_id,
    updatedAt: toIso(row.updated_at),
  }
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

export async function listStaffingPlanWeeks(ownerUserId: string): Promise<StaffingPlanWeekRow[]> {
  const rows = await queryRows<DbRow>(
    `SELECT owner_user_id, scenario_id, week_start, required_hc, production_hc, updated_at
       FROM staffing_plan
      WHERE owner_user_id = ?
      ORDER BY scenario_id ASC, week_start ASC`,
    [ownerUserId],
  )
  return rows.map(toRow)
}

/**
 * Upserts Required Production FTE (required_hc) and optional production_hc for one owner.
 * Weeks with both metrics cleared are deleted so the table stays sparse.
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
      'You cannot update another planner\'s staffing plan.',
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
    const requiredHc =
      week.requiredHc === undefined
        ? undefined
        : week.requiredHc == null || Number.isNaN(Number(week.requiredHc))
          ? null
          : Number(week.requiredHc)
    const productionHc =
      week.productionHc === undefined
        ? undefined
        : week.productionHc == null || Number.isNaN(Number(week.productionHc))
          ? null
          : Number(week.productionHc)

    const existing = await queryRows<DbRow>(
      `SELECT owner_user_id, scenario_id, week_start, required_hc, production_hc, updated_at
         FROM staffing_plan
        WHERE owner_user_id = ? AND scenario_id = ? AND week_start = ?
        LIMIT 1`,
      [ownerId, scenarioId, weekStart],
    )
    const current = existing[0]
    const nextRequired =
      requiredHc === undefined ? toNullableNumber(current?.required_hc) : requiredHc
    const nextProduction =
      productionHc === undefined ? toNullableNumber(current?.production_hc) : productionHc

    if (nextRequired == null && nextProduction == null) {
      if (current) {
        await execute(
          `DELETE FROM staffing_plan
            WHERE owner_user_id = ? AND scenario_id = ? AND week_start = ?`,
          [ownerId, scenarioId, weekStart],
        )
      }
      continue
    }

    if (current) {
      await execute(
        `UPDATE staffing_plan
            SET required_hc = ?, production_hc = ?
          WHERE owner_user_id = ? AND scenario_id = ? AND week_start = ?`,
        [nextRequired, nextProduction, ownerId, scenarioId, weekStart],
      )
    } else {
      await execute(
        `INSERT INTO staffing_plan
           (id, owner_user_id, scenario_id, week_start, required_hc, production_hc)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [randomUUID(), ownerId, scenarioId, weekStart, nextRequired, nextProduction],
      )
    }

    const refreshed = await queryRows<DbRow>(
      `SELECT owner_user_id, scenario_id, week_start, required_hc, production_hc, updated_at
         FROM staffing_plan
        WHERE owner_user_id = ? AND scenario_id = ? AND week_start = ?
        LIMIT 1`,
      [ownerId, scenarioId, weekStart],
    )
    if (refreshed[0]) saved.push(toRow(refreshed[0]))
  }

  return saved
}

/** Replace all weeks for one scenario (used when materializing a full plan snapshot). */
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
      'You cannot update another planner\'s staffing plan.',
      'forbidden',
    )
  }
  const scenarioId = assertScenarioId(scenarioIdRaw)

  await execute(`DELETE FROM staffing_plan WHERE owner_user_id = ? AND scenario_id = ?`, [
    ownerId,
    scenarioId,
  ])

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
      'You cannot update another planner\'s staffing plan.',
      'forbidden',
    )
  }
  const scenarioId = assertScenarioId(scenarioIdRaw)
  return execute(`DELETE FROM staffing_plan WHERE owner_user_id = ? AND scenario_id = ?`, [
    ownerId,
    scenarioId,
  ])
}

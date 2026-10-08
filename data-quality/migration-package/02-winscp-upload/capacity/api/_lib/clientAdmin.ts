import { randomUUID } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { execute, queryRows } from './db.js'

export type ManagedClient = {
  id: string
  name: string
  weekStart: string
  capacityPlanStartWeek: string
  planningWeeks: number
  buildMethod: string
  defaultPaidHours: number
  defaultShrinkagePct: number
  createdAt: string
  updatedAt: string
}

export type ClientWriteInput = {
  id?: string
  name: string
  weekStart?: string
  capacityPlanStartWeek?: string
  planningWeeks?: number
  buildMethod?: string
  defaultPaidHours?: number
  defaultShrinkagePct?: number
}

type ClientDbRow = RowDataPacket & {
  id: string
  name: string
  week_start: string
  capacity_plan_start_week: string
  planning_weeks: number
  build_method: string
  default_paid_hours: string | number
  default_shrinkage_pct: string | number
  created_at: Date | string
  updated_at: Date | string
}

const WEEK_STARTS = new Set(['sunday', 'monday'])
const BUILD_METHODS = new Set(['forward', 'import'])

/** Clients are shared master data: readable by any signed-in user, writable by planners and above. */
const WRITE_ACCESS_LEVELS = new Set(['admin', 'cap_planner', 'director'])

export class ClientAdminError extends Error {
  status: number
  code: string

  constructor(status: number, message: string, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

export function canWriteClients(accessLevel: string | null | undefined): boolean {
  const value = (accessLevel ?? '').trim().toLowerCase()
  if (value === 'scheduler') return true
  return WRITE_ACCESS_LEVELS.has(value)
}

function toIso(value: Date | string): string {
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  return new Date().toISOString()
}

function toManagedClient(row: ClientDbRow): ManagedClient {
  return {
    id: row.id,
    name: row.name,
    weekStart: row.week_start,
    capacityPlanStartWeek: row.capacity_plan_start_week,
    planningWeeks: Number(row.planning_weeks),
    buildMethod: row.build_method,
    defaultPaidHours: Number(row.default_paid_hours),
    defaultShrinkagePct: Number(row.default_shrinkage_pct),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

function normalizeName(raw: string | null | undefined): string {
  const value = (raw ?? '').trim()
  if (!value) throw new ClientAdminError(400, 'Client name is required.', 'missing_name')
  if (value.length > 255) {
    throw new ClientAdminError(400, 'Client name is too long.', 'name_too_long')
  }
  return value
}

function normalizeWeekStart(raw: string | null | undefined): string {
  const value = (raw ?? 'monday').trim().toLowerCase()
  if (!WEEK_STARTS.has(value)) {
    throw new ClientAdminError(400, 'Week start must be sunday or monday.', 'invalid_week_start')
  }
  return value
}

function normalizeBuildMethod(raw: string | null | undefined): string {
  const value = (raw ?? 'forward').trim().toLowerCase()
  if (!BUILD_METHODS.has(value)) {
    throw new ClientAdminError(400, 'Build method must be forward or import.', 'invalid_build_method')
  }
  return value
}

function normalizeNumber(
  raw: number | undefined,
  fallback: number,
  min: number,
  max: number,
  code: string,
): number {
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback
  if (value < min || value > max) {
    throw new ClientAdminError(400, `Value out of range for ${code}.`, code)
  }
  return value
}

function isDuplicateNameError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Duplicate') || message.includes('uq_capacity_clients_name')
}

export async function listManagedClients(): Promise<ManagedClient[]> {
  const rows = await queryRows<ClientDbRow>(
    `SELECT id, name, week_start, capacity_plan_start_week, planning_weeks, build_method,
            default_paid_hours, default_shrinkage_pct, created_at, updated_at
     FROM capacity_clients
     ORDER BY name ASC`,
  )
  return rows.map(toManagedClient)
}

async function getClientRow(id: string): Promise<ClientDbRow | null> {
  const rows = await queryRows<ClientDbRow>(
    `SELECT id, name, week_start, capacity_plan_start_week, planning_weeks, build_method,
            default_paid_hours, default_shrinkage_pct, created_at, updated_at
     FROM capacity_clients
     WHERE id = ?
     LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

export async function createManagedClient(
  input: ClientWriteInput,
  createdBy?: string | null,
): Promise<ManagedClient> {
  const id = input.id?.trim() || randomUUID()
  const name = normalizeName(input.name)
  const weekStart = normalizeWeekStart(input.weekStart)
  const buildMethod = normalizeBuildMethod(input.buildMethod)
  const planningWeeks = normalizeNumber(input.planningWeeks, 52, 1, 520, 'invalid_planning_weeks')
  const paidHours = normalizeNumber(input.defaultPaidHours, 40, 0, 168, 'invalid_paid_hours')
  const shrinkage = normalizeNumber(input.defaultShrinkagePct, 0.25, 0, 1, 'invalid_shrinkage')

  try {
    await execute(
      `INSERT INTO capacity_clients
         (id, name, week_start, capacity_plan_start_week, planning_weeks, build_method,
          default_paid_hours, default_shrinkage_pct, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        name,
        weekStart,
        input.capacityPlanStartWeek?.trim() ?? '',
        planningWeeks,
        buildMethod,
        paidHours,
        shrinkage,
        createdBy ?? null,
      ],
    )
  } catch (error) {
    if (isDuplicateNameError(error)) {
      throw new ClientAdminError(409, 'A client with that name already exists.', 'name_taken')
    }
    throw error
  }

  const row = await getClientRow(id)
  if (!row) throw new ClientAdminError(404, 'Client not found after create.', 'not_found')
  return toManagedClient(row)
}

export async function updateManagedClient(
  id: string,
  input: ClientWriteInput,
): Promise<ManagedClient> {
  const existing = await getClientRow(id)
  if (!existing) throw new ClientAdminError(404, 'Client not found.', 'not_found')

  const name = normalizeName(input.name)
  const weekStart = normalizeWeekStart(input.weekStart ?? existing.week_start)
  const buildMethod = normalizeBuildMethod(input.buildMethod ?? existing.build_method)
  const planningWeeks = normalizeNumber(
    input.planningWeeks,
    Number(existing.planning_weeks),
    1,
    520,
    'invalid_planning_weeks',
  )
  const paidHours = normalizeNumber(
    input.defaultPaidHours,
    Number(existing.default_paid_hours),
    0,
    168,
    'invalid_paid_hours',
  )
  const shrinkage = normalizeNumber(
    input.defaultShrinkagePct,
    Number(existing.default_shrinkage_pct),
    0,
    1,
    'invalid_shrinkage',
  )

  try {
    await execute(
      `UPDATE capacity_clients
       SET name = ?, week_start = ?, capacity_plan_start_week = ?, planning_weeks = ?,
           build_method = ?, default_paid_hours = ?, default_shrinkage_pct = ?
       WHERE id = ?`,
      [
        name,
        weekStart,
        input.capacityPlanStartWeek?.trim() ?? existing.capacity_plan_start_week,
        planningWeeks,
        buildMethod,
        paidHours,
        shrinkage,
        id,
      ],
    )
  } catch (error) {
    if (isDuplicateNameError(error)) {
      throw new ClientAdminError(409, 'A client with that name already exists.', 'name_taken')
    }
    throw error
  }

  const row = await getClientRow(id)
  if (!row) throw new ClientAdminError(404, 'Client not found.', 'not_found')
  return toManagedClient(row)
}

export async function deleteManagedClientById(id: string): Promise<void> {
  const existing = await getClientRow(id)
  if (!existing) throw new ClientAdminError(404, 'Client not found.', 'not_found')
  await execute(`DELETE FROM capacity_clients WHERE id = ?`, [id])
}

/**
 * One-time seed used when the shared table is still empty but a browser has
 * clients left over from the old localStorage/workspace-blob storage.
 */
export async function seedManagedClients(
  inputs: ClientWriteInput[],
  createdBy?: string | null,
): Promise<ManagedClient[]> {
  const existing = await listManagedClients()
  if (existing.length > 0) return existing

  for (const input of inputs) {
    try {
      await createManagedClient(input, createdBy)
    } catch (error) {
      if (error instanceof ClientAdminError && error.code === 'name_taken') continue
      throw error
    }
  }
  return listManagedClients()
}

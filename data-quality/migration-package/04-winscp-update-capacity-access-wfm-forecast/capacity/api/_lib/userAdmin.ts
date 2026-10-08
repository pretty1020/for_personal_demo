import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { RowDataPacket } from 'mysql2/promise'
import { execute, queryRows, usersHasAllowedClientsColumn } from './db.js'

export type ManagedApiUser = {
  id: string
  email: string
  name: string
  accessLevel: string
  active: boolean
  createdAt: string
  /** Clients this Manager may view/edit. Empty = none (no fallback to all). */
  allowedClients: string[]
}

export type UserWriteInput = {
  email: string
  name: string
  password?: string
  accessLevel: string
  active?: boolean
  allowedClients?: string[]
}

type UserDbRow = RowDataPacket & {
  id: string
  email: string
  name: string
  access_level: string
  is_active: number | boolean | null
  created_at: Date | string
  allowed_clients?: unknown
}

export function parseAllowedClients(raw: unknown): string[] {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const name = item.trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

const ALLOWED_ACCESS_LEVELS = new Set(['admin', 'cap_planner', 'analyst', 'manager', 'director', 'vp'])

export class UserAdminError extends Error {
  status: number
  code: string

  constructor(status: number, message: string, code: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export function normalizeManagedAccessLevel(raw: string | null | undefined): string {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === 'scheduler') return 'cap_planner'
  if (value === 'executive') return 'vp'
  if (ALLOWED_ACCESS_LEVELS.has(value)) return value
  throw new UserAdminError(400, 'Invalid access level.', 'invalid_access_level')
}

function toManagedUser(row: UserDbRow): ManagedApiUser {
  const accessLevel = row.access_level === 'executive' ? 'vp' : row.access_level
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    accessLevel,
    active: row.is_active !== 0 && row.is_active !== false,
    createdAt:
      typeof row.created_at === 'string'
        ? row.created_at
        : row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date().toISOString(),
    // Only Managers carry grants; other roles ignore the column.
    allowedClients: accessLevel === 'manager' ? parseAllowedClients(row.allowed_clients) : [],
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function validatePassword(password: string | undefined, required: boolean): string | null {
  const value = password?.trim() ?? ''
  if (!value) {
    if (required) throw new UserAdminError(400, 'Password is required.', 'missing_password')
    return null
  }
  if (value.length < 6) {
    throw new UserAdminError(400, 'Password must be at least 6 characters.', 'weak_password')
  }
  return value
}

async function countActiveAdmins(excludeUserId?: string): Promise<number> {
  const rows = await queryRows<RowDataPacket & { count: number }>(
    `SELECT COUNT(*) AS count
     FROM users
     WHERE access_level = 'admin'
       AND COALESCE(is_active, 1) = 1
       ${excludeUserId ? 'AND id <> ?' : ''}`,
    excludeUserId ? [excludeUserId] : [],
  )
  return Number(rows[0]?.count ?? 0)
}

async function getUserRow(id: string): Promise<UserDbRow | null> {
  const includeClients = await usersHasAllowedClientsColumn()
  const rows = await queryRows<UserDbRow>(
    includeClients
      ? `SELECT id, email, name, access_level, COALESCE(is_active, 1) AS is_active, created_at, allowed_clients
         FROM users
         WHERE id = ?
         LIMIT 1`
      : `SELECT id, email, name, access_level, COALESCE(is_active, 1) AS is_active, created_at
         FROM users
         WHERE id = ?
         LIMIT 1`,
    [id],
  )
  return rows[0] ?? null
}

export async function listManagedUsers(): Promise<ManagedApiUser[]> {
  const includeClients = await usersHasAllowedClientsColumn()
  const rows = await queryRows<UserDbRow>(
    includeClients
      ? `SELECT id, email, name, access_level, COALESCE(is_active, 1) AS is_active, created_at, allowed_clients
         FROM users
         ORDER BY name ASC, email ASC`
      : `SELECT id, email, name, access_level, COALESCE(is_active, 1) AS is_active, created_at
         FROM users
         ORDER BY name ASC, email ASC`,
  )
  return rows.map(toManagedUser)
}

export async function createManagedUser(input: UserWriteInput): Promise<ManagedApiUser> {
  const email = normalizeEmail(input.email)
  const name = input.name.trim()
  if (!email || !name) {
    throw new UserAdminError(400, 'Name and email are required.', 'missing_fields')
  }
  const accessLevel = normalizeManagedAccessLevel(input.accessLevel)
  const password = validatePassword(input.password, true)!
  const active = input.active !== false
  const passwordHash = await hashPassword(password)
  const id = randomUUID()

  const includeClients = await usersHasAllowedClientsColumn()
  const allowedClients =
    accessLevel === 'manager' ? parseAllowedClients(input.allowedClients ?? []) : []
  if (!includeClients && accessLevel === 'manager' && allowedClients.length) {
    throw new UserAdminError(
      503,
      'Run SQLyog script 026_user_client_access.sql before assigning Manager clients.',
      'schema_missing_allowed_clients',
    )
  }

  try {
    if (includeClients) {
      await execute(
        `INSERT INTO users (id, email, password_hash, name, access_level, is_active, allowed_clients)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, email, passwordHash, name, accessLevel, active ? 1 : 0, JSON.stringify(allowedClients)],
      )
    } else {
      await execute(
        `INSERT INTO users (id, email, password_hash, name, access_level, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, email, passwordHash, name, accessLevel, active ? 1 : 0],
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('Duplicate') || message.includes('uq_users_email')) {
      throw new UserAdminError(409, 'A user with that email already exists.', 'email_taken')
    }
    throw error
  }

  const created = await getUserRow(id)
  if (!created) throw new UserAdminError(500, 'User was created but could not be loaded.', 'create_failed')
  return toManagedUser(created)
}

export async function updateManagedUser(id: string, input: UserWriteInput): Promise<ManagedApiUser> {
  const existing = await getUserRow(id)
  if (!existing) throw new UserAdminError(404, 'User not found.', 'not_found')

  const email = normalizeEmail(input.email)
  const name = input.name.trim()
  if (!email || !name) {
    throw new UserAdminError(400, 'Name and email are required.', 'missing_fields')
  }
  const accessLevel = normalizeManagedAccessLevel(input.accessLevel)
  const nextActive = input.active ?? toManagedUser(existing).active
  const password = validatePassword(input.password, false)

  if (
    toManagedUser(existing).active &&
    existing.access_level === 'admin' &&
    (accessLevel !== 'admin' || !nextActive)
  ) {
    const remaining = await countActiveAdmins(id)
    if (remaining < 1) {
      throw new UserAdminError(400, 'Keep at least one active admin account.', 'last_admin')
    }
  }

  const includeClients = await usersHasAllowedClientsColumn()
  const allowedClients =
    accessLevel === 'manager'
      ? parseAllowedClients(
          input.allowedClients !== undefined
            ? input.allowedClients
            : existing.allowed_clients,
        )
      : []
  if (!includeClients && accessLevel === 'manager' && allowedClients.length) {
    throw new UserAdminError(
      503,
      'Run SQLyog script 026_user_client_access.sql before assigning Manager clients.',
      'schema_missing_allowed_clients',
    )
  }

  try {
    if (password) {
      const passwordHash = await hashPassword(password)
      if (includeClients) {
        await execute(
          `UPDATE users
           SET email = ?, name = ?, access_level = ?, is_active = ?, password_hash = ?, allowed_clients = ?
           WHERE id = ?`,
          [email, name, accessLevel, nextActive ? 1 : 0, passwordHash, JSON.stringify(allowedClients), id],
        )
      } else {
        await execute(
          `UPDATE users
           SET email = ?, name = ?, access_level = ?, is_active = ?, password_hash = ?
           WHERE id = ?`,
          [email, name, accessLevel, nextActive ? 1 : 0, passwordHash, id],
        )
      }
    } else if (includeClients) {
      await execute(
        `UPDATE users
         SET email = ?, name = ?, access_level = ?, is_active = ?, allowed_clients = ?
         WHERE id = ?`,
        [email, name, accessLevel, nextActive ? 1 : 0, JSON.stringify(allowedClients), id],
      )
    } else {
      await execute(
        `UPDATE users
         SET email = ?, name = ?, access_level = ?, is_active = ?
         WHERE id = ?`,
        [email, name, accessLevel, nextActive ? 1 : 0, id],
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('Duplicate') || message.includes('uq_users_email')) {
      throw new UserAdminError(409, 'A user with that email already exists.', 'email_taken')
    }
    throw error
  }

  if (!nextActive) {
    await execute(`DELETE FROM sessions WHERE user_id = ?`, [id])
  }

  const updated = await getUserRow(id)
  if (!updated) throw new UserAdminError(404, 'User not found.', 'not_found')
  return toManagedUser(updated)
}

export async function setManagedUserActiveState(id: string, active: boolean): Promise<ManagedApiUser> {
  const existing = await getUserRow(id)
  if (!existing) throw new UserAdminError(404, 'User not found.', 'not_found')

  if (!active && existing.access_level === 'admin' && toManagedUser(existing).active) {
    const remaining = await countActiveAdmins(id)
    if (remaining < 1) {
      throw new UserAdminError(400, 'Keep at least one active admin account.', 'last_admin')
    }
  }

  await execute(`UPDATE users SET is_active = ? WHERE id = ?`, [active ? 1 : 0, id])
  if (!active) {
    await execute(`DELETE FROM sessions WHERE user_id = ?`, [id])
  }

  const updated = await getUserRow(id)
  if (!updated) throw new UserAdminError(404, 'User not found.', 'not_found')
  return toManagedUser(updated)
}

export async function deleteManagedUserById(id: string): Promise<void> {
  const existing = await getUserRow(id)
  if (!existing) throw new UserAdminError(404, 'User not found.', 'not_found')

  if (existing.access_level === 'admin' && toManagedUser(existing).active) {
    const remaining = await countActiveAdmins(id)
    if (remaining < 1) {
      throw new UserAdminError(400, 'Keep at least one active admin account.', 'last_admin')
    }
  }

  await execute(`DELETE FROM users WHERE id = ?`, [id])
}

export function isAdminAccessLevel(accessLevel: string | null | undefined): boolean {
  return (accessLevel ?? '').trim().toLowerCase() === 'admin'
}

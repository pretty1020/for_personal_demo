import bcrypt from 'bcryptjs'
import { queryRows, usersHasAllowedClientsColumn, type DbUserRow } from './db.js'

export {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  createSessionToken,
  deleteSession,
  getUserFromSession,
  readSessionToken,
  requireSessionUser,
  sessionCookieValue,
  sessionExpiryDate,
  toSessionUser,
  type SessionUser,
} from './session.js'

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash)
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function findUserByEmail(email: string): Promise<DbUserRow | null> {
  const includeClients = await usersHasAllowedClientsColumn()
  const rows = await queryRows<DbUserRow>(
    includeClients
      ? `SELECT id, email, password_hash, name, access_level, COALESCE(is_active, 1) AS is_active, allowed_clients
         FROM users
         WHERE LOWER(email) = LOWER(?)
         LIMIT 1`
      : `SELECT id, email, password_hash, name, access_level, COALESCE(is_active, 1) AS is_active
         FROM users
         WHERE LOWER(email) = LOWER(?)
         LIMIT 1`,
    [email],
  )
  return rows[0] ?? null
}

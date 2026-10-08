import bcrypt from 'bcryptjs'
import { getDb, queryRows, type DbUserRow } from './db.js'

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
  const sql = getDb()
  const rows = await queryRows<DbUserRow>(sql`
    SELECT id, email, password_hash, name, access_level, ai_assistant_approved
    FROM users
    WHERE lower(email) = lower(${email})
    LIMIT 1
  `)
  return rows[0] ?? null
}

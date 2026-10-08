import { createHash, randomBytes } from 'node:crypto'
import { execute, queryRows, usersHasAllowedClientsColumn, type DbUser } from './db.js'

/**
 * Only the parts of the request and response these helpers actually touch.
 *
 * Typed structurally rather than importing VercelRequest/VercelResponse, because this
 * module is shared with the Next.js routes. @vercel/node is a devDependency, and a
 * production server installs without devDependencies — importing it here, even as a
 * type, failed `npm run build` on deployment with "Cannot find module '@vercel/node'".
 *
 * The real Vercel types satisfy these shapes, so the Vercel handlers are unaffected.
 */
type SessionRequest = {
  headers: { authorization?: string; cookie?: string }
}

type SessionResponse = {
  status: (code: number) => { json: (body: unknown) => unknown }
}

export const SESSION_COOKIE = 'wfp_session'
const SESSION_DAYS = 30

export type SessionUser = {
  id: string
  email: string
  name: string
  accessLevel: string
  /** Manager client grants from MariaDB. Empty = no clients (no fallback). */
  allowedClients: string[]
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function parseSessionClients(raw: unknown): string[] {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function toSessionUser(user: DbUser): SessionUser {
  const accessLevel = user.access_level
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    accessLevel,
    allowedClients:
      accessLevel === 'manager' || accessLevel === 'Manager'
        ? parseSessionClients(user.allowed_clients)
        : [],
  }
}

export function createSessionToken(): string {
  return randomBytes(32).toString('hex')
}

export function sessionExpiryDate(): Date {
  const expires = new Date()
  expires.setDate(expires.getDate() + SESSION_DAYS)
  return expires
}

/**
 * Secure cookies need HTTPS. Internal WinSCP/PuTTY deploys are often HTTP —
 * forcing Secure there breaks Capacity login. Set COOKIE_SECURE=true behind TLS.
 */
function cookieSecureSuffix(): string {
  const flag = process.env.COOKIE_SECURE?.trim().toLowerCase()
  if (flag === 'true' || flag === '1' || flag === 'yes') return '; Secure'
  if (flag === 'false' || flag === '0' || flag === 'no') return ''
  if (process.env.VERCEL === '1') return '; Secure'
  return ''
}

export function sessionCookieValue(token: string, expires: Date): string {
  const maxAge = Math.floor((expires.getTime() - Date.now()) / 1000)
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cookieSecureSuffix()}`
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecureSuffix()}`
}

export function readSessionToken(req: SessionRequest): string | null {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim() || null
  }
  const cookieHeader = req.headers.cookie
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === SESSION_COOKIE) {
      return rest.join('=') || null
    }
  }
  return null
}

export async function createSession(userId: string): Promise<{ token: string; expires: Date }> {
  const token = createSessionToken()
  const expires = sessionExpiryDate()
  await execute(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)`,
    [hashToken(token), userId, expires],
  )
  return { token, expires }
}

export async function deleteSession(token: string): Promise<void> {
  await execute(`DELETE FROM sessions WHERE token = ?`, [hashToken(token)])
}

export async function getUserFromSession(token: string): Promise<SessionUser | null> {
  const includeClients = await usersHasAllowedClientsColumn()
  const rows = await queryRows<DbUser>(
    includeClients
      ? `SELECT u.id, u.email, u.name, u.access_level, u.allowed_clients
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ?
           AND s.expires_at > NOW(3)
           AND COALESCE(u.is_active, 1) = 1
         LIMIT 1`
      : `SELECT u.id, u.email, u.name, u.access_level
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token = ?
           AND s.expires_at > NOW(3)
           AND COALESCE(u.is_active, 1) = 1
         LIMIT 1`,
    [hashToken(token)],
  )
  const user = rows[0]
  return user ? toSessionUser(user) : null
}

export async function requireSessionUser(
  req: SessionRequest,
  res: SessionResponse,
): Promise<SessionUser | null> {
  const token = readSessionToken(req)
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' })
    return null
  }
  try {
    const user = await getUserFromSession(token)
    if (!user) {
      res.status(401).json({ error: 'Session expired or invalid.' })
      return null
    }
    return user
  } catch (error) {
    console.error('Session lookup failed:', error)
    res.status(500).json({ error: 'Authentication service unavailable.' })
    return null
  }
}

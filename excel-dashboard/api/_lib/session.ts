import { createHash, randomBytes } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getDb, queryRows, type DbUser } from './db.js'

export const SESSION_COOKIE = 'wfp_session'
const SESSION_DAYS = 30

export type SessionUser = {
  id: string
  email: string
  name: string
  accessLevel: 'executive' | 'manager'
  aiAssistantApproved: boolean
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function toSessionUser(user: DbUser): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    accessLevel: user.access_level,
    aiAssistantApproved: user.ai_assistant_approved,
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

export function sessionCookieValue(token: string, expires: Date): string {
  const maxAge = Math.floor((expires.getTime() - Date.now()) / 1000)
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
}

export function readSessionToken(req: VercelRequest): string | null {
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
  const sql = getDb()
  const token = createSessionToken()
  const expires = sessionExpiryDate()
  await sql`
    INSERT INTO sessions (token, user_id, expires_at)
    VALUES (${hashToken(token)}, ${userId}, ${expires.toISOString()})
  `
  return { token, expires }
}

export async function deleteSession(token: string): Promise<void> {
  const sql = getDb()
  await sql`DELETE FROM sessions WHERE token = ${hashToken(token)}`
}

export async function getUserFromSession(token: string): Promise<SessionUser | null> {
  const sql = getDb()
  const rows = await queryRows<DbUser>(sql`
    SELECT u.id, u.email, u.name, u.access_level, u.ai_assistant_approved
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ${hashToken(token)}
      AND s.expires_at > NOW()
    LIMIT 1
  `)
  const user = rows[0]
  return user ? toSessionUser(user) : null
}

export async function requireSessionUser(req: VercelRequest, res: VercelResponse): Promise<SessionUser | null> {
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

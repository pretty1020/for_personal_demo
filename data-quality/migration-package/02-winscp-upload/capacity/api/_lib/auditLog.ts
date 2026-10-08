import { randomUUID } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { execute, queryRows } from './db.js'

/**
 * Capacity's activity trail.
 *
 * Written server-side only. The browser never posts audit rows, so an entry here is
 * evidence that the server actually performed the action rather than a claim the client
 * made about itself.
 *
 * Both API trees — the Next.js routes and the Vercel handlers — call through the shared
 * `_lib` mutators, so hooking those covers every entry point once.
 */

export type AuditAction =
  | 'document.save'
  | 'document.delete'
  | 'document.backfill'
  | 'settings.save'
  | 'user.create'
  | 'user.update'
  | 'user.activate'
  | 'user.deactivate'
  | 'user.delete'
  | 'client.create'
  | 'client.update'
  | 'client.delete'
  | 'auth.login'
  | 'auth.login_failed'
  | 'auth.logout'

export type AuditActor = {
  id: string | null
  email: string
  name: string
  accessLevel: string
}

export type AuditEntry = {
  actor: AuditActor
  action: AuditAction
  /** Document key, client id or account the action applied to. */
  subject?: string
  /** Set when acting on someone else's data, so "on behalf of" is queryable. */
  targetUserId?: string | null
  targetEmail?: string
  details?: Record<string, unknown>
  ipAddress?: string
}

export type AuditLogRow = {
  id: string
  actorUserId: string | null
  actorEmail: string
  actorName: string
  actorAccessLevel: string
  targetUserId: string | null
  targetEmail: string
  action: string
  subject: string
  details: Record<string, unknown> | null
  ipAddress: string
  createdAt: string
}

type AuditDbRow = RowDataPacket & {
  id: string
  actor_user_id: string | null
  actor_email: string
  actor_name: string
  actor_access_level: string
  target_user_id: string | null
  target_email: string
  action: string
  subject: string
  details: string | null
  ip_address: string
  created_at: Date | string
}

/** Long free-text (a plan name, an error) must not abort the insert on overflow. */
function clip(value: string | null | undefined, max: number): string {
  const text = (value ?? '').trim()
  return text.length > max ? text.slice(0, max) : text
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function parseDetails(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Record one action. Never throws.
 *
 * A failure to log must not fail the user's save — losing an audit row is bad, losing
 * someone's afternoon of planning because the audit table was locked is worse. Failures
 * go to the server log so they are still visible to an operator.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await execute(
      `INSERT INTO capacity_audit_log
         (id, actor_user_id, actor_email, actor_name, actor_access_level,
          target_user_id, target_email, action, subject, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        entry.actor.id,
        clip(entry.actor.email, 255),
        clip(entry.actor.name, 255),
        clip(entry.actor.accessLevel, 32),
        entry.targetUserId ?? null,
        clip(entry.targetEmail, 255),
        entry.action,
        clip(entry.subject, 160),
        entry.details ? JSON.stringify(entry.details) : null,
        clip(entry.ipAddress, 64),
      ],
    )
  } catch (error) {
    console.error(`Audit entry "${entry.action}" could not be recorded:`, error)
  }
}

export type AuditQuery = {
  limit?: number
  /** Filter to one actor, one target, or one action. */
  actorUserId?: string
  targetUserId?: string
  action?: string
  /** ISO timestamps. */
  since?: string
  until?: string
}

const MAX_AUDIT_ROWS = 500

/** Newest first. Admin-only — the route checks before calling. */
export async function listAuditLog(query: AuditQuery = {}): Promise<AuditLogRow[]> {
  const where: string[] = []
  const params: (string | number)[] = []

  if (query.actorUserId) {
    where.push('actor_user_id = ?')
    params.push(query.actorUserId)
  }
  if (query.targetUserId) {
    where.push('target_user_id = ?')
    params.push(query.targetUserId)
  }
  if (query.action) {
    where.push('action = ?')
    params.push(query.action)
  }
  if (query.since) {
    where.push('created_at >= ?')
    params.push(query.since)
  }
  if (query.until) {
    where.push('created_at <= ?')
    params.push(query.until)
  }

  // Interpolated below rather than bound, because MariaDB rejects a placeholder in LIMIT
  // on a prepared statement. Forced to a whole number in range so it cannot carry SQL.
  const requested = Math.floor(Number(query.limit ?? 100))
  const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 100, 1), MAX_AUDIT_ROWS)

  const rows = await queryRows<AuditDbRow>(
    `SELECT * FROM capacity_audit_log
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC
     LIMIT ${limit}`,
    params,
  )

  return rows.map((row) => ({
    id: row.id,
    actorUserId: row.actor_user_id,
    actorEmail: row.actor_email,
    actorName: row.actor_name,
    actorAccessLevel: row.actor_access_level,
    targetUserId: row.target_user_id,
    targetEmail: row.target_email,
    action: row.action,
    subject: row.subject,
    details: parseDetails(row.details),
    ipAddress: row.ip_address,
    createdAt: toIso(row.created_at),
  }))
}

/** Best-effort client IP from the usual proxy headers. */
export function clientIpFromHeaders(get: (name: string) => string | null | undefined): string {
  const forwarded = get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return (get('x-real-ip') ?? '').trim()
}

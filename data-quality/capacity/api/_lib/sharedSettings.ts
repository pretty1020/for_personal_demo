import type { RowDataPacket } from 'mysql2/promise'
import { execute, queryRows } from './db.js'
import { canWriteSharedSettings } from './documentAccess.js'
import { writeAudit, type AuditActor } from './auditLog.js'

/**
 * Settings owned by the organisation rather than by a person.
 *
 * Unlike capacity_documents there is exactly one row per key for the whole install:
 * an admin edits it once and every planner reads the same value. That is the point —
 * formulas that differ per user would make two people's plans incomparable.
 */

/** Admin-editable formula definitions used by the Staffing Plan and DBE calculations. */
export const SHARED_SETTING_KEYS = new Set(['capacity-formulas-v1'])

const MAX_PAYLOAD_BYTES = 1024 * 1024

export class SharedSettingsError extends Error {
  status: number
  code: string

  constructor(status: number, message: string, code: string) {
    super(message)
    this.name = 'SharedSettingsError'
    this.status = status
    this.code = code
  }
}

export type SharedSetting = {
  key: string
  payload: unknown
  revision: number
  updatedByEmail: string
  updatedAt: string | null
}

type SharedSettingRow = RowDataPacket & {
  setting_key: string
  payload: string
  revision: number | string
  updated_by_email: string
  updated_at: Date | string | null
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function parsePayload(raw: string, key: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    console.error(`Shared setting ${key} holds invalid JSON:`, error)
    return null
  }
}

function toSetting(row: SharedSettingRow): SharedSetting {
  return {
    key: row.setting_key,
    payload: parsePayload(row.payload, row.setting_key),
    revision: Number(row.revision),
    updatedByEmail: row.updated_by_email,
    updatedAt: toIso(row.updated_at),
  }
}

function assertSettingKey(key: string): void {
  if (!SHARED_SETTING_KEYS.has(key)) {
    throw new SharedSettingsError(400, `Unknown setting: ${key}`, 'invalid_setting_key')
  }
}

/** Readable by anyone signed in — every planner needs the formulas to render their plan. */
export async function listSharedSettings(): Promise<SharedSetting[]> {
  const rows = await queryRows<SharedSettingRow>(
    `SELECT setting_key, payload, revision, updated_by_email, updated_at
       FROM capacity_shared_settings`,
  )
  return rows.map(toSetting)
}

export async function getSharedSetting(key: string): Promise<SharedSetting | null> {
  assertSettingKey(key)
  const rows = await queryRows<SharedSettingRow>(
    `SELECT setting_key, payload, revision, updated_by_email, updated_at
       FROM capacity_shared_settings WHERE setting_key = ? LIMIT 1`,
    [key],
  )
  return rows[0] ? toSetting(rows[0]) : null
}

/**
 * Write a shared setting. Admin only, and the revision is checked inside the UPDATE so
 * two admins editing at once cannot silently overwrite each other.
 */
export async function saveSharedSetting(
  actor: AuditActor & { id: string },
  key: string,
  payload: unknown,
  expectedRevision: number | undefined,
  ipAddress: string,
): Promise<SharedSetting> {
  assertSettingKey(key)

  if (!canWriteSharedSettings(actor.accessLevel)) {
    throw new SharedSettingsError(403, 'Only an admin can change formulas.', 'forbidden')
  }

  const serialized = JSON.stringify(payload ?? null)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new SharedSettingsError(413, 'That definition is too large to save.', 'payload_too_large')
  }

  const existing = await queryRows<SharedSettingRow>(
    `SELECT setting_key, payload, revision, updated_by_email, updated_at
       FROM capacity_shared_settings WHERE setting_key = ? LIMIT 1`,
    [key],
  )

  if (existing[0]) {
    if (expectedRevision !== undefined) {
      const result = await execute(
        `UPDATE capacity_shared_settings
            SET payload = ?, revision = revision + 1, updated_by = ?, updated_by_email = ?
          WHERE setting_key = ? AND revision = ?`,
        [serialized, actor.id, actor.email, key, expectedRevision],
      )
      if (result.affectedRows === 0) {
        throw new SharedSettingsError(
          409,
          'Another admin changed this first. Reload to see their version.',
          'revision_conflict',
        )
      }
    } else {
      await execute(
        `UPDATE capacity_shared_settings
            SET payload = ?, revision = revision + 1, updated_by = ?, updated_by_email = ?
          WHERE setting_key = ?`,
        [serialized, actor.id, actor.email, key],
      )
    }
  } else {
    await execute(
      `INSERT INTO capacity_shared_settings (setting_key, payload, revision, updated_by, updated_by_email)
       VALUES (?, ?, 1, ?, ?)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), revision = revision + 1,
                               updated_by = VALUES(updated_by), updated_by_email = VALUES(updated_by_email)`,
      [key, serialized, actor.id, actor.email],
    )
  }

  const saved = await getSharedSetting(key)
  if (!saved) {
    throw new SharedSettingsError(500, 'Save could not be confirmed.', 'save_unconfirmed')
  }

  // Logged at this level because a formula edit changes every planner's numbers at once;
  // it is the single most consequential write in the app.
  await writeAudit({
    actor,
    action: 'settings.save',
    subject: key,
    ipAddress,
    details: { revision: saved.revision },
  })

  return saved
}

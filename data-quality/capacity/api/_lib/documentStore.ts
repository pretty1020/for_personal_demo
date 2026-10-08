import { randomUUID } from 'node:crypto'
import type { RowDataPacket } from 'mysql2/promise'
import { execute, queryRows } from './db.js'
import {
  DOCUMENT_KEYS,
  canWriteDbeDocuments,
  canWriteOthersDocuments,
  isDbeDocumentKey,
} from './documentAccess.js'
import { writeAudit, type AuditActor } from './auditLog.js'

export type CapacityDocument = {
  key: string
  payload: unknown
  revision: number
  ownerUserId: string
  ownerName: string
  ownerEmail: string
  updatedAt: string
}

type DocumentDbRow = RowDataPacket & {
  id: string
  owner_user_id: string
  doc_key: string
  payload: string
  revision: number | string
  updated_at: Date | string
  owner_name: string | null
  owner_email: string | null
}

export { DOCUMENT_KEYS, canReadAllDocuments } from './documentAccess.js'
export { canWriteOthersDocuments, canWriteDbeDocuments } from './documentAccess.js'


/** Rejected before it reaches the column, so a runaway payload fails loudly rather than truncating. */
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024

export class DocumentStoreError extends Error {
  status: number
  code: string

  constructor(status: number, message: string, code: string) {
    super(message)
    this.name = 'DocumentStoreError'
    this.status = status
    this.code = code
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function parsePayload(raw: string, key: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    // A row that will not parse must not take the whole page down with it.
    console.error(`Capacity document ${key} holds invalid JSON; treating as empty.`)
    return null
  }
}

function toDocument(row: DocumentDbRow): CapacityDocument {
  return {
    key: row.doc_key,
    payload: parsePayload(row.payload, row.doc_key),
    revision: Number(row.revision),
    ownerUserId: row.owner_user_id,
    ownerName: row.owner_name ?? '',
    ownerEmail: row.owner_email ?? '',
    updatedAt: toIso(row.updated_at),
  }
}

export function assertDocumentKey(key: string): void {
  if (!DOCUMENT_KEYS.has(key)) {
    throw new DocumentStoreError(400, `Unknown document key: ${key}`, 'invalid_document_key')
  }
}

/**
 * The caller's own documents — what the planner screens hydrate from on sign-in.
 */
export async function listOwnDocuments(userId: string): Promise<CapacityDocument[]> {
  const rows = await queryRows<DocumentDbRow>(
    `SELECT d.*, u.name AS owner_name, u.email AS owner_email
       FROM capacity_documents d
       LEFT JOIN users u ON u.id = d.owner_user_id
      WHERE d.owner_user_id = ?`,
    [userId],
  )
  return rows.map(toDocument)
}

/**
 * One planner's whole set, for a manager opening that person's plans. Manager and above
 * only — the route checks before calling.
 *
 * Separate from listAllDocuments because fetching every key of every planner just to
 * read one person's work moves far more data than the caller needs.
 */
export async function listUserDocuments(userId: string): Promise<CapacityDocument[]> {
  const rows = await queryRows<DocumentDbRow>(
    `SELECT d.*, u.name AS owner_name, u.email AS owner_email
       FROM capacity_documents d
       LEFT JOIN users u ON u.id = d.owner_user_id
      WHERE d.owner_user_id = ?`,
    [userId],
  )
  return rows.map(toDocument)
}

/**
 * Every planner's copy of the given keys, for the combined Summary. Manager and above
 * only — the route checks before calling.
 */
export async function listAllDocuments(keys: string[]): Promise<CapacityDocument[]> {
  const wanted = keys.filter((key) => DOCUMENT_KEYS.has(key))
  if (wanted.length === 0) return []

  const placeholders = wanted.map(() => '?').join(', ')
  const rows = await queryRows<DocumentDbRow>(
    `SELECT d.*, u.name AS owner_name, u.email AS owner_email
       FROM capacity_documents d
       LEFT JOIN users u ON u.id = d.owner_user_id
      WHERE d.doc_key IN (${placeholders})
      ORDER BY d.updated_at DESC`,
    wanted,
  )
  return rows.map(toDocument)
}

/**
 * Write one document. When `expectedRevision` is supplied and no longer matches, the save
 * is refused instead of overwriting: a tab that has been open since before someone else's
 * edit gets told to reload rather than quietly winning.
 */
export async function saveDocument(
  userId: string,
  key: string,
  payload: unknown,
  expectedRevision?: number,
): Promise<CapacityDocument> {
  assertDocumentKey(key)

  const serialized = JSON.stringify(payload ?? null)
  if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new DocumentStoreError(413, 'This plan is too large to save.', 'payload_too_large')
  }

  const existing = await queryRows<DocumentDbRow>(
    `SELECT * FROM capacity_documents WHERE owner_user_id = ? AND doc_key = ?`,
    [userId, key],
  )
  const current = existing[0]

  if (current) {
    if (expectedRevision !== undefined) {
      // Checked inside the UPDATE rather than before it: a separate SELECT then UPDATE
      // lets two concurrent saves both pass the check and the second silently win.
      const result = await execute(
        `UPDATE capacity_documents
            SET payload = ?, revision = revision + 1
          WHERE owner_user_id = ? AND doc_key = ? AND revision = ?`,
        [serialized, userId, key, expectedRevision],
      )
      if (result.affectedRows === 0) {
        throw new DocumentStoreError(
          409,
          'This plan changed in another session. Reload to get the latest version.',
          'revision_conflict',
        )
      }
    } else {
      await execute(
        `UPDATE capacity_documents
            SET payload = ?, revision = revision + 1
          WHERE owner_user_id = ? AND doc_key = ?`,
        [serialized, userId, key],
      )
    }
  } else {
    await execute(
      `INSERT INTO capacity_documents (id, owner_user_id, doc_key, payload, revision)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), revision = revision + 1`,
      [randomUUID(), userId, key, serialized],
    )
  }

  const saved = await queryRows<DocumentDbRow>(
    `SELECT d.*, u.name AS owner_name, u.email AS owner_email
       FROM capacity_documents d
       LEFT JOIN users u ON u.id = d.owner_user_id
      WHERE d.owner_user_id = ? AND d.doc_key = ?`,
    [userId, key],
  )
  if (!saved[0]) {
    throw new DocumentStoreError(500, 'Save could not be confirmed.', 'save_unconfirmed')
  }
  return toDocument(saved[0])
}

/** Removes a document the user owns. Deleting is the only way data leaves the table. */
export async function deleteDocument(userId: string, key: string): Promise<void> {
  assertDocumentKey(key)
  await execute(`DELETE FROM capacity_documents WHERE owner_user_id = ? AND doc_key = ?`, [
    userId,
    key,
  ])
}

/**
 * Resolve whose row a write applies to.
 *
 * Without `targetUserId` this is the actor's own row and nothing special happens. With
 * one, the actor is editing on behalf of a planner: the ownership never moves, so the
 * planner keeps their data and the audit log carries who actually made the change.
 */
async function resolveWriteTarget(
  actor: AuditActor & { id: string },
  targetUserId?: string | null,
): Promise<{ ownerUserId: string; ownerEmail: string; onBehalf: boolean }> {
  if (!targetUserId || targetUserId === actor.id) {
    return { ownerUserId: actor.id, ownerEmail: actor.email, onBehalf: false }
  }

  if (!canWriteOthersDocuments(actor.accessLevel)) {
    throw new DocumentStoreError(
      403,
      'Only a manager or above can edit another planner\u2019s plan.',
      'forbidden',
    )
  }

  const rows = await queryRows<RowDataPacket & { id: string; email: string }>(
    `SELECT id, email FROM users WHERE id = ? LIMIT 1`,
    [targetUserId],
  )
  const target = rows[0]
  if (!target) {
    throw new DocumentStoreError(404, 'That planner no longer exists.', 'unknown_target')
  }

  return { ownerUserId: target.id, ownerEmail: target.email, onBehalf: true }
}

/**
 * Some keys need a role, not just ownership. DBE carries client billing and margin, so
 * only Manager and above may write it — including to a row they own themselves.
 */
function assertMayWriteKey(actor: AuditActor, key: string): void {
  if (isDbeDocumentKey(key) && !canWriteDbeDocuments(actor.accessLevel)) {
    throw new DocumentStoreError(
      403,
      'Only a manager or above can add or change DBE clients and LOBs.',
      'forbidden',
    )
  }
}

/**
 * Save, enforcing who may write where and recording the result. Both API trees call this
 * rather than saveDocument directly, so the permission check and the audit entry cannot
 * be forgotten on one of them.
 */
export async function saveDocumentAsActor(
  actor: AuditActor & { id: string },
  key: string,
  payload: unknown,
  expectedRevision: number | undefined,
  targetUserId: string | null | undefined,
  ipAddress: string,
): Promise<CapacityDocument> {
  assertMayWriteKey(actor, key)
  const target = await resolveWriteTarget(actor, targetUserId)
  const saved = await saveDocument(target.ownerUserId, key, payload, expectedRevision)

  await writeAudit({
    actor,
    action: 'document.save',
    subject: key,
    targetUserId: target.ownerUserId,
    targetEmail: target.ownerEmail,
    ipAddress,
    details: { revision: saved.revision, onBehalf: target.onBehalf },
  })

  return saved
}

export async function deleteDocumentAsActor(
  actor: AuditActor & { id: string },
  key: string,
  targetUserId: string | null | undefined,
  ipAddress: string,
): Promise<void> {
  assertMayWriteKey(actor, key)
  const target = await resolveWriteTarget(actor, targetUserId)
  await deleteDocument(target.ownerUserId, key)

  await writeAudit({
    actor,
    action: 'document.delete',
    subject: key,
    targetUserId: target.ownerUserId,
    targetEmail: target.ownerEmail,
    ipAddress,
    details: { onBehalf: target.onBehalf },
  })
}

/**
 * One-time handover from the old workspace_state blob. Only writes keys that have no row
 * yet, so a replayed backfill from a stale browser cannot overwrite newer database work.
 *
 * Takes the access level because the request body is caller-supplied: without this, a
 * planner could create DBE lines by listing them as legacy data to hand over.
 */
export async function backfillDocuments(
  userId: string,
  entries: { key: string; payload: unknown }[],
  accessLevel: string | null | undefined,
): Promise<CapacityDocument[]> {
  const mayWriteDbe = canWriteDbeDocuments(accessLevel)

  for (const entry of entries) {
    if (!DOCUMENT_KEYS.has(entry.key)) continue
    if (isDbeDocumentKey(entry.key) && !mayWriteDbe) continue
    const serialized = JSON.stringify(entry.payload ?? null)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PAYLOAD_BYTES) continue
    await execute(
      `INSERT INTO capacity_documents (id, owner_user_id, doc_key, payload, revision)
       VALUES (?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE id = id`,
      [randomUUID(), userId, entry.key, serialized],
    )
  }
  return listOwnDocuments(userId)
}

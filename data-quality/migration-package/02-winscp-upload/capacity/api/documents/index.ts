import type { VercelRequest, VercelResponse } from '@vercel/node'
import { mariadbReady } from '../_lib/db.js'
import { applyCors, handleOptions, json } from '../_lib/http.js'
import { requireSessionUser } from '../_lib/session.js'
import {
  DocumentStoreError,
  backfillDocuments,
  canReadAllDocuments,
  deleteDocumentAsActor,
  listAllDocuments,
  listOwnDocuments,
  listUserDocuments,
  saveDocumentAsActor,
} from '../_lib/documentStore.js'
import { clientIpFromHeaders } from '../_lib/auditLog.js'

function parseBody(req: VercelRequest): Record<string, unknown> | null {
  const raw = req.body
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return null
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res)
  if (handleOptions(req, res)) return

  if (!mariadbReady()) {
    json(res, 503, { error: 'Database is not configured.', code: 'db_not_configured' })
    return
  }

  const actor = await requireSessionUser(req, res)
  if (!actor) return

  try {
    if (req.method === 'GET') {
      if (firstParam(req.query.scope) === 'all') {
        if (!canReadAllDocuments(actor.accessLevel)) {
          json(res, 403, { error: 'Manager access required.', code: 'forbidden' })
          return
        }
        const keys = firstParam(req.query.keys)
          .split(',')
          .map((key) => key.trim())
          .filter(Boolean)
        json(res, 200, { documents: await listAllDocuments(keys) })
        return
      }
      if (firstParam(req.query.scope) === 'user') {
        if (!canReadAllDocuments(actor.accessLevel)) {
          json(res, 403, { error: 'Manager access required.', code: 'forbidden' })
          return
        }
        const userId = firstParam(req.query.userId)
        if (!userId) {
          json(res, 400, { error: 'A userId is required.', code: 'missing_user' })
          return
        }
        json(res, 200, { documents: await listUserDocuments(userId) })
        return
      }
      json(res, 200, { documents: await listOwnDocuments(actor.id) })
      return
    }

    if (req.method === 'PUT') {
      const body = parseBody(req)
      if (!body) {
        json(res, 400, { error: 'Request body must be valid JSON.', code: 'invalid_json' })
        return
      }

      if (Array.isArray(body.backfill)) {
        const entries = (body.backfill as Record<string, unknown>[])
          .filter((entry) => typeof entry?.key === 'string')
          .map((entry) => ({ key: entry.key as string, payload: entry.payload }))
        json(res, 200, {
          documents: await backfillDocuments(actor.id, entries, actor.accessLevel),
        })
        return
      }

      if (typeof body.key !== 'string') {
        json(res, 400, { error: 'A document key is required.', code: 'missing_key' })
        return
      }

      const revision = typeof body.revision === 'number' ? body.revision : undefined
      const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId : null
      const document = await saveDocumentAsActor(
        actor,
        body.key,
        body.payload,
        revision,
        targetUserId,
        clientIpFromHeaders((name) => firstParam(req.headers[name])),
      )
      json(res, 200, { document })
      return
    }

    if (req.method === 'DELETE') {
      const key = firstParam(req.query.key)
      if (!key) {
        json(res, 400, { error: 'A document key is required.', code: 'missing_key' })
        return
      }
      await deleteDocumentAsActor(
        actor,
        key,
        firstParam(req.query.targetUserId) || null,
        clientIpFromHeaders((name) => firstParam(req.headers[name])),
      )
      json(res, 200, { ok: true })
      return
    }

    json(res, 405, { error: 'Method not allowed.', code: 'method_not_allowed' })
  } catch (error) {
    if (error instanceof DocumentStoreError) {
      json(res, error.status, { error: error.message, code: error.code })
      return
    }
    console.error('Document request failed:', error)
    json(res, 500, { error: 'Document save failed.', code: 'documents_error' })
  }
}

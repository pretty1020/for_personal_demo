import type { VercelRequest, VercelResponse } from '@vercel/node'
import { mariadbReady } from '../_lib/db.js'
import { applyCors, handleOptions, json } from '../_lib/http.js'
import { requireSessionUser } from '../_lib/session.js'
import {
  deleteManagedUserById,
  isAdminAccessLevel,
  setManagedUserActiveState,
  updateManagedUser,
  UserAdminError,
} from '../_lib/userAdmin.js'

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

function userIdFromReq(req: VercelRequest): string {
  const raw = req.query.id
  return typeof raw === 'string' ? raw : Array.isArray(raw) ? String(raw[0] ?? '') : ''
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
  if (!isAdminAccessLevel(actor.accessLevel)) {
    json(res, 403, { error: 'Admin access required.', code: 'forbidden' })
    return
  }

  const id = userIdFromReq(req)
  if (!id) {
    json(res, 400, { error: 'User id is required.', code: 'missing_id' })
    return
  }

  try {
    if (req.method === 'PUT' || req.method === 'PATCH') {
      const body = parseBody(req)
      if (!body) {
        json(res, 400, { error: 'Request body must be valid JSON.', code: 'invalid_json' })
        return
      }

      if (typeof body.active === 'boolean' && body.email == null && body.name == null) {
        if (body.active === false && actor.id === id) {
          json(res, 400, { error: 'You cannot deactivate your own account.', code: 'self_deactivate' })
          return
        }
        const user = await setManagedUserActiveState(id, body.active)
        json(res, 200, { user })
        return
      }

      const user = await updateManagedUser(id, {
        email: String(body.email ?? ''),
        name: String(body.name ?? ''),
        password: typeof body.password === 'string' ? body.password : undefined,
        accessLevel: String(body.accessLevel ?? ''),
        active: typeof body.active === 'boolean' ? body.active : undefined,
      })
      json(res, 200, { user })
      return
    }

    if (req.method === 'DELETE') {
      if (actor.id === id) {
        json(res, 400, { error: 'You cannot delete your own account.', code: 'self_delete' })
        return
      }
      await deleteManagedUserById(id)
      json(res, 200, { ok: true })
      return
    }

    json(res, 405, { error: 'Method not allowed.', code: 'method_not_allowed' })
  } catch (error) {
    if (error instanceof UserAdminError) {
      json(res, error.status, { error: error.message, code: error.code })
      return
    }
    console.error('User update/delete failed:', error)
    json(res, 500, { error: 'User management failed.', code: 'users_error' })
  }
}

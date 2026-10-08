import type { VercelRequest, VercelResponse } from '@vercel/node'
import { mariadbReady } from '../_lib/db.js'
import { applyCors, handleOptions, json } from '../_lib/http.js'
import { requireSessionUser } from '../_lib/session.js'
import {
  createManagedUser,
  isAdminAccessLevel,
  listManagedUsers,
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

  try {
    if (req.method === 'GET') {
      const users = await listManagedUsers()
      json(res, 200, { users })
      return
    }

    if (req.method === 'POST') {
      const body = parseBody(req)
      if (!body) {
        json(res, 400, { error: 'Request body must be valid JSON.', code: 'invalid_json' })
        return
      }
      const user = await createManagedUser({
        email: String(body.email ?? ''),
        name: String(body.name ?? ''),
        password: typeof body.password === 'string' ? body.password : undefined,
        accessLevel: String(body.accessLevel ?? ''),
        active: body.active !== false,
        allowedClients: Array.isArray(body.allowedClients)
          ? body.allowedClients.filter((item): item is string => typeof item === 'string')
          : undefined,
      })
      json(res, 201, { user })
      return
    }

    json(res, 405, { error: 'Method not allowed.', code: 'method_not_allowed' })
  } catch (error) {
    if (error instanceof UserAdminError) {
      json(res, error.status, { error: error.message, code: error.code })
      return
    }
    console.error('Users list/create failed:', error)
    json(res, 500, { error: 'User management failed.', code: 'users_error' })
  }
}

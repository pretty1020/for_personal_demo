import type { VercelRequest, VercelResponse } from '@vercel/node'
import { mariadbReady } from '../_lib/db.js'
import { applyCors, handleOptions, json } from '../_lib/http.js'
import { requireSessionUser } from '../_lib/session.js'
import {
  ClientAdminError,
  canWriteClients,
  deleteManagedClientById,
  updateManagedClient,
} from '../_lib/clientAdmin.js'

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
  if (!canWriteClients(actor.accessLevel)) {
    json(res, 403, { error: 'Planner access required.', code: 'forbidden' })
    return
  }

  const rawId = req.query.id
  const id = Array.isArray(rawId) ? rawId[0] : rawId
  if (!id) {
    json(res, 400, { error: 'Client id is required.', code: 'missing_id' })
    return
  }

  try {
    if (req.method === 'PUT' || req.method === 'PATCH') {
      const body = parseBody(req)
      if (!body) {
        json(res, 400, { error: 'Request body must be valid JSON.', code: 'invalid_json' })
        return
      }
      const client = await updateManagedClient(id, {
        name: String(body.name ?? ''),
        weekStart: typeof body.weekStart === 'string' ? body.weekStart : undefined,
        capacityPlanStartWeek:
          typeof body.capacityPlanStartWeek === 'string' ? body.capacityPlanStartWeek : undefined,
        planningWeeks: typeof body.planningWeeks === 'number' ? body.planningWeeks : undefined,
        buildMethod: typeof body.buildMethod === 'string' ? body.buildMethod : undefined,
        defaultPaidHours:
          typeof body.defaultPaidHours === 'number' ? body.defaultPaidHours : undefined,
        defaultShrinkagePct:
          typeof body.defaultShrinkagePct === 'number' ? body.defaultShrinkagePct : undefined,
      })
      json(res, 200, { client })
      return
    }

    if (req.method === 'DELETE') {
      await deleteManagedClientById(id)
      json(res, 200, { ok: true })
      return
    }

    json(res, 405, { error: 'Method not allowed.', code: 'method_not_allowed' })
  } catch (error) {
    if (error instanceof ClientAdminError) {
      json(res, error.status, { error: error.message, code: error.code })
      return
    }
    console.error('Client update/delete failed:', error)
    json(res, 500, { error: 'Client save failed.', code: 'clients_error' })
  }
}

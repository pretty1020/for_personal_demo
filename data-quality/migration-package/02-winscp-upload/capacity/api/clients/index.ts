import type { VercelRequest, VercelResponse } from '@vercel/node'
import { mariadbReady } from '../_lib/db.js'
import { applyCors, handleOptions, json } from '../_lib/http.js'
import { requireSessionUser } from '../_lib/session.js'
import {
  ClientAdminError,
  canWriteClients,
  createManagedClient,
  listManagedClients,
  seedManagedClients,
  type ClientWriteInput,
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

function toWriteInput(raw: Record<string, unknown>): ClientWriteInput {
  return {
    id: typeof raw.id === 'string' ? raw.id : undefined,
    name: String(raw.name ?? ''),
    weekStart: typeof raw.weekStart === 'string' ? raw.weekStart : undefined,
    capacityPlanStartWeek:
      typeof raw.capacityPlanStartWeek === 'string' ? raw.capacityPlanStartWeek : undefined,
    planningWeeks: typeof raw.planningWeeks === 'number' ? raw.planningWeeks : undefined,
    buildMethod: typeof raw.buildMethod === 'string' ? raw.buildMethod : undefined,
    defaultPaidHours: typeof raw.defaultPaidHours === 'number' ? raw.defaultPaidHours : undefined,
    defaultShrinkagePct:
      typeof raw.defaultShrinkagePct === 'number' ? raw.defaultShrinkagePct : undefined,
  }
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
      const clients = await listManagedClients()
      json(res, 200, { clients })
      return
    }

    if (req.method === 'POST') {
      if (!canWriteClients(actor.accessLevel)) {
        json(res, 403, { error: 'Planner access required.', code: 'forbidden' })
        return
      }
      const body = parseBody(req)
      if (!body) {
        json(res, 400, { error: 'Request body must be valid JSON.', code: 'invalid_json' })
        return
      }
      if (Array.isArray(body.seed)) {
        const clients = await seedManagedClients(
          (body.seed as Record<string, unknown>[]).map(toWriteInput),
          actor.id,
        )
        json(res, 200, { clients })
        return
      }
      const client = await createManagedClient(toWriteInput(body), actor.id)
      json(res, 201, { client })
      return
    }

    json(res, 405, { error: 'Method not allowed.', code: 'method_not_allowed' })
  } catch (error) {
    if (error instanceof ClientAdminError) {
      json(res, error.status, { error: error.message, code: error.code })
      return
    }
    console.error('Clients list/create failed:', error)
    json(res, 500, { error: 'Client save failed.', code: 'clients_error' })
  }
}

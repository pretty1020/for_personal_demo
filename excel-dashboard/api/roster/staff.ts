import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, handleOptions, json } from '../_lib/http.js'
import { listRosterStaff, RosterApiError } from '../_lib/externalRosterApi.js'
import { requireRosterApiUser } from '../_lib/rosterAuth.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res)
  if (handleOptions(req, res)) return

  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed.', code: 'method_not_allowed' })
    return
  }

  const user = await requireRosterApiUser(req, res)
  if (!user) return

  try {
    const accountId = typeof req.query.account_id === 'string' ? req.query.account_id : undefined
    const employmentStatus =
      typeof req.query.employment_status === 'string' ? req.query.employment_status : undefined
    const staff = await listRosterStaff({ accountId, employmentStatus })
    json(res, 200, { staff, count: staff.length })
  } catch (error) {
    if (error instanceof RosterApiError) {
      json(res, error.status, { error: error.message, code: error.code })
      return
    }
    console.error('Roster staff failed:', error)
    json(res, 500, { error: 'Failed to load roster staff.', code: 'sync_failed' })
  }
}

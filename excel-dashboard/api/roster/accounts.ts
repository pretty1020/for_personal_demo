import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, handleOptions, json } from '../_lib/http.js'
import { getRosterAccount, listRosterAccounts, RosterApiError } from '../_lib/externalRosterApi.js'
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
    const accountId = typeof req.query.id === 'string' ? req.query.id : undefined
    if (accountId) {
      const account = await getRosterAccount(accountId)
      json(res, 200, { account })
      return
    }
    const accounts = await listRosterAccounts()
    json(res, 200, { accounts })
  } catch (error) {
    if (error instanceof RosterApiError) {
      json(res, error.status, { error: error.message, code: error.code })
      return
    }
    console.error('Roster accounts failed:', error)
    json(res, 500, { error: 'Failed to load roster accounts.', code: 'sync_failed' })
  }
}

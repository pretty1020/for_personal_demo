import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserFromSession, readSessionToken } from '../_lib/session.js'
import { applyCors, handleOptions, json } from '../_lib/http.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res)
  if (handleOptions(req, res)) return

  if (req.method !== 'GET') {
    json(res, 405, { error: 'Method not allowed.' })
    return
  }

  if (!process.env.DATABASE_URL) {
    json(res, 503, { error: 'Database is not configured.' })
    return
  }

  const token = readSessionToken(req)
  if (!token) {
    json(res, 401, { error: 'Not authenticated.' })
    return
  }

  try {
    const user = await getUserFromSession(token)
    if (!user) {
      json(res, 401, { error: 'Session expired or invalid.' })
      return
    }
    json(res, 200, { user })
  } catch (error) {
    console.error('Auth me failed:', error)
    json(res, 500, { error: 'Authentication service unavailable.' })
  }
}

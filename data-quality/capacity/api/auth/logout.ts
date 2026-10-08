import type { VercelRequest, VercelResponse } from '@vercel/node'
import { clearSessionCookie, deleteSession, readSessionToken } from '../_lib/session.js'
import { applyCors, handleOptions, json } from '../_lib/http.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res)
  if (handleOptions(req, res)) return

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed.' })
    return
  }

  const token = readSessionToken(req)
  if (token) {
    try {
      await deleteSession(token)
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }

  res.setHeader('Set-Cookie', clearSessionCookie())
  json(res, 200, { ok: true })
}

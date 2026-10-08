import type { VercelRequest, VercelResponse } from '@vercel/node'
import { mariadbReady } from '../_lib/db.js'
import { demoUserResponse, matchDemoAccount } from '../_lib/demoAccounts.js'
import { applyCors, handleOptions, json } from '../_lib/http.js'

type LoginBody = {
  email?: string
  password?: string
}

function parseJsonBody(req: VercelRequest): LoginBody | null {
  const raw = req.body
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as LoginBody
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw) as LoginBody
    } catch {
      return null
    }
  }
  return null
}

function respondWithDemoLogin(res: VercelResponse, email: string, password: string): boolean {
  const demo = matchDemoAccount(email, password)
  if (!demo) return false
  json(res, 200, {
    user: demoUserResponse(demo),
    token: `demo-${demo.email}`,
    mode: 'demo',
  })
  return true
}

async function tryDatabaseLogin(
  res: VercelResponse,
  email: string,
  password: string,
): Promise<boolean> {
  if (!mariadbReady()) return false

  try {
    const { createSession, findUserByEmail, sessionCookieValue, toSessionUser, verifyPassword } = await import(
      '../_lib/auth.js'
    )
    const user = await findUserByEmail(email)
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return false
    }
    if (user.is_active === 0 || user.is_active === false) {
      return false
    }

    const { token, expires } = await createSession(user.id)
    res.setHeader('Set-Cookie', sessionCookieValue(token, expires))
    json(res, 200, {
      user: toSessionUser(user),
      token,
      mode: 'database',
    })
    return true
  } catch (error) {
    console.error('Database login failed:', error)
    return false
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    applyCors(req, res)
    if (handleOptions(req, res)) return

    if (req.method !== 'POST') {
      json(res, 405, { error: 'Method not allowed.', code: 'method_not_allowed' })
      return
    }

    const body = parseJsonBody(req)
    if (!body) {
      json(res, 400, { error: 'Request body must be valid JSON.', code: 'invalid_json' })
      return
    }

    const email = body.email?.trim().toLowerCase() ?? ''
    const password = body.password?.trim() ?? ''
    if (!email || !password) {
      json(res, 400, { error: 'Email and password are required.', code: 'missing_credentials' })
      return
    }

    if (respondWithDemoLogin(res, email, password)) return

    if (await tryDatabaseLogin(res, email, password)) return

    json(res, 401, { error: 'Invalid email or password.', code: 'invalid_credentials' })
  } catch (error) {
    console.error('Login handler failed:', error)
    json(res, 500, { error: 'Login handler failed.', code: 'handler_error' })
  }
}

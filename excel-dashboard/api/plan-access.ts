import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, handleOptions, json } from './_lib/http.js'
import {
  assertAdminPlanAccess,
  normalizeAccessLevel,
  type AccessLevel,
  type PlanAccessGrant,
} from './_lib/rbac.js'
import { DEMO_ACCOUNTS } from './_lib/demoAccounts.js'
import { readSessionToken, requireSessionUser } from './_lib/session.js'

type Body = {
  scenarioId?: string
  granteeEmail?: string
}

const memoryGrants: PlanAccessGrant[] = []

function parseBody(req: VercelRequest): Body {
  const raw = req.body
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Body
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return JSON.parse(raw) as Body
    } catch {
      return {}
    }
  }
  return {}
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

async function resolveSubject(
  req: VercelRequest,
  res: VercelResponse,
): Promise<{ email: string; accessLevel: AccessLevel } | null> {
  const token = readSessionToken(req)

  if (token?.startsWith('demo-')) {
    const email = token.slice('demo-'.length).trim().toLowerCase()
    const demo = DEMO_ACCOUNTS.find((item) => item.email === email)
    if (!demo) {
      json(res, 401, { error: 'Invalid demo session.' })
      return null
    }
    return {
      email: demo.email,
      accessLevel: normalizeAccessLevel(demo.appRole),
    }
  }

  if (process.env.DATABASE_URL) {
    const user = await requireSessionUser(req, res)
    if (!user) return null
    return {
      email: user.email,
      accessLevel: normalizeAccessLevel(user.accessLevel),
    }
  }

  json(res, 401, { error: 'Authentication required.' })
  return null
}

async function ensurePlanAccessTable(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false
  try {
    const { getDb } = await import('./_lib/db.js')
    const sql = getDb()
    await sql`
      CREATE TABLE IF NOT EXISTS plan_access (
        scenario_id text NOT NULL,
        grantee_email text NOT NULL,
        granted_by_email text NOT NULL,
        granted_at timestamptz NOT NULL DEFAULT NOW(),
        PRIMARY KEY (scenario_id, grantee_email)
      )
    `
    return true
  } catch (error) {
    console.warn('plan_access table unavailable:', error)
    return false
  }
}

async function loadAllGrants(): Promise<PlanAccessGrant[]> {
  if (await ensurePlanAccessTable()) {
    const { getDb, queryRows } = await import('./_lib/db.js')
    const sql = getDb()
    const rows = await queryRows<{
      scenario_id: string
      grantee_email: string
      granted_by_email: string
      granted_at: string
    }>(sql`SELECT scenario_id, grantee_email, granted_by_email, granted_at FROM plan_access`)
    return rows.map((row) => ({
      scenarioId: row.scenario_id,
      granteeEmail: row.grantee_email,
      grantedByEmail: row.granted_by_email,
      grantedAt: row.granted_at,
    }))
  }
  return [...memoryGrants]
}

async function saveGrant(grant: PlanAccessGrant): Promise<void> {
  if (await ensurePlanAccessTable()) {
    const { getDb } = await import('./_lib/db.js')
    const sql = getDb()
    await sql`
      INSERT INTO plan_access (scenario_id, grantee_email, granted_by_email, granted_at)
      VALUES (${grant.scenarioId}, ${grant.granteeEmail}, ${grant.grantedByEmail}, ${grant.grantedAt})
      ON CONFLICT (scenario_id, grantee_email) DO UPDATE
      SET granted_by_email = EXCLUDED.granted_by_email,
          granted_at = EXCLUDED.granted_at
    `
    return
  }
  const index = memoryGrants.findIndex(
    (item) => item.scenarioId === grant.scenarioId && item.granteeEmail === grant.granteeEmail,
  )
  if (index >= 0) memoryGrants[index] = grant
  else memoryGrants.push(grant)
}

async function deleteGrant(scenarioId: string, granteeEmail: string): Promise<boolean> {
  if (await ensurePlanAccessTable()) {
    const { getDb, queryRows } = await import('./_lib/db.js')
    const sql = getDb()
    const rows = await queryRows<{ scenario_id: string }>(sql`
      DELETE FROM plan_access
      WHERE scenario_id = ${scenarioId} AND grantee_email = ${granteeEmail}
      RETURNING scenario_id
    `)
    return rows.length > 0
  }
  const before = memoryGrants.length
  for (let i = memoryGrants.length - 1; i >= 0; i -= 1) {
    const item = memoryGrants[i]!
    if (item.scenarioId === scenarioId && item.granteeEmail === granteeEmail) {
      memoryGrants.splice(i, 1)
    }
  }
  return memoryGrants.length !== before
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res)
  if (handleOptions(req, res)) return

  const subject = await resolveSubject(req, res)
  if (!subject) return

  try {
    if (req.method === 'GET') {
      const scenarioId =
        typeof req.query.scenarioId === 'string' ? req.query.scenarioId : undefined
      let grants = await loadAllGrants()
      if (scenarioId) grants = grants.filter((item) => item.scenarioId === scenarioId)
      if (subject.accessLevel !== 'admin') {
        grants = grants.filter((item) => item.granteeEmail === subject.email)
      }
      json(res, 200, { grants })
      return
    }

    if (req.method === 'POST') {
      assertAdminPlanAccess(subject)
      const body = parseBody(req)
      const scenarioId = body.scenarioId?.trim()
      const granteeEmail = body.granteeEmail ? normalizeEmail(body.granteeEmail) : ''
      if (!scenarioId || !granteeEmail) {
        json(res, 400, { error: 'scenarioId and granteeEmail are required.' })
        return
      }
      const grant: PlanAccessGrant = {
        scenarioId,
        granteeEmail,
        grantedByEmail: subject.email,
        grantedAt: new Date().toISOString(),
      }
      await saveGrant(grant)
      json(res, 200, { ok: true, grant })
      return
    }

    if (req.method === 'DELETE') {
      assertAdminPlanAccess(subject)
      const body = parseBody(req)
      const scenarioId = body.scenarioId?.trim()
      const granteeEmail = body.granteeEmail ? normalizeEmail(body.granteeEmail) : ''
      if (!scenarioId || !granteeEmail) {
        json(res, 400, { error: 'scenarioId and granteeEmail are required.' })
        return
      }
      const removed = await deleteGrant(scenarioId, granteeEmail)
      json(res, 200, { ok: true, removed })
      return
    }

    json(res, 405, { error: 'Method not allowed.' })
  } catch (error) {
    const status = (error as { status?: number }).status ?? 500
    const message = error instanceof Error ? error.message : 'Plan access request failed.'
    json(res, status, { error: message })
  }
}

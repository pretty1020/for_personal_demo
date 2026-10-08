import type { VercelRequest, VercelResponse } from '@vercel/node'
import { DEMO_ACCOUNTS } from './_lib/demoAccounts.js'
import {
  applyWorkspaceRbac,
  assertWorkspaceWriteAllowed,
  isEmptyWorkspace,
  normalizeWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from './_lib/workspace.js'
import { normalizeAccessLevel, type PlanAccessSubject } from './_lib/rbac.js'
import { readSessionToken, requireSessionUser } from './_lib/session.js'
import { getDb, queryRows } from './_lib/db.js'
import { applyCors, handleOptions, json } from './_lib/http.js'

async function resolveSubject(req: VercelRequest, res: VercelResponse): Promise<PlanAccessSubject | null> {
  const token = readSessionToken(req)
  if (token?.startsWith('demo-')) {
    const email = token.slice('demo-'.length).trim().toLowerCase()
    const demo = DEMO_ACCOUNTS.find((item) => item.email === email)
    if (!demo) {
      json(res, 401, { error: 'Invalid demo session.' })
      return null
    }
    return { email: demo.email, accessLevel: normalizeAccessLevel(demo.appRole) }
  }

  if (!process.env.DATABASE_URL) {
    json(res, 503, { error: 'Database is not configured.' })
    return null
  }

  const user = await requireSessionUser(req, res)
  if (!user) return null
  return { email: user.email, accessLevel: normalizeAccessLevel(user.accessLevel) }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res)
  if (handleOptions(req, res)) return

  const subject = await resolveSubject(req, res)
  if (!subject) return

  if (!process.env.DATABASE_URL) {
    json(res, 503, { error: 'Database is not configured.' })
    return
  }

  const sql = getDb()
  const sessionUser = await requireSessionUser(req, res)
  if (!sessionUser) return

  if (req.method === 'GET') {
    try {
      const rows = await queryRows<{ state: WorkspaceSnapshot; updated_at: string }>(sql`
        SELECT state, updated_at
        FROM workspace_state
        WHERE user_id = ${sessionUser.id}
        LIMIT 1
      `)
      const row = rows[0]
      const snapshot = applyWorkspaceRbac(normalizeWorkspaceSnapshot(row?.state ?? {}), subject)
      json(res, 200, {
        snapshot,
        updatedAt: row?.updated_at ?? null,
        empty: isEmptyWorkspace(snapshot),
      })
    } catch (error) {
      console.error('Workspace load failed:', error)
      json(res, 500, { error: 'Failed to load workspace.' })
    }
    return
  }

  if (req.method === 'PUT') {
    try {
      const raw = req.body
      let body: { snapshot?: unknown } | undefined
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        body = raw as { snapshot?: unknown }
      } else if (typeof raw === 'string' && raw.trim()) {
        body = JSON.parse(raw) as { snapshot?: unknown }
      }
      const snapshot = normalizeWorkspaceSnapshot(body?.snapshot ?? {})

      const existingRows = await queryRows<{ state: WorkspaceSnapshot }>(sql`
        SELECT state FROM workspace_state WHERE user_id = ${sessionUser.id} LIMIT 1
      `)
      const existing = normalizeWorkspaceSnapshot(existingRows[0]?.state ?? {})
      assertWorkspaceWriteAllowed(snapshot, existing, subject)

      const rows = await queryRows<{ updated_at: string }>(sql`
        INSERT INTO workspace_state (user_id, state, updated_at)
        VALUES (${sessionUser.id}, ${snapshot}, NOW())
        ON CONFLICT (user_id) DO UPDATE
        SET state = EXCLUDED.state,
            updated_at = NOW()
        RETURNING updated_at
      `)
      json(res, 200, {
        ok: true,
        updatedAt: rows[0]?.updated_at ?? new Date().toISOString(),
      })
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500
      console.error('Workspace save failed:', error)
      json(res, status, {
        error: error instanceof Error ? error.message : 'Failed to save workspace.',
      })
    }
    return
  }

  json(res, 405, { error: 'Method not allowed.' })
}

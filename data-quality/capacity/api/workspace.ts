import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireSessionUser } from './_lib/session.js'
import { mariadbReady, queryRows } from './_lib/db.js'
import { applyCors, handleOptions, json } from './_lib/http.js'
import { isEmptyWorkspace, normalizeWorkspaceSnapshot, type WorkspaceSnapshot } from './_lib/workspace.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res)
  if (handleOptions(req, res)) return

  if (!mariadbReady()) {
    json(res, 503, { error: 'Database is not configured.' })
    return
  }

  const user = await requireSessionUser(req, res)
  if (!user) return

  if (req.method === 'GET') {
    try {
      const rows = await queryRows<{ state: WorkspaceSnapshot | string; updated_at: string }>(
        `SELECT state, updated_at FROM workspace_state WHERE user_id = ? LIMIT 1`,
        [user.id],
      )
      const row = rows[0]
      const rawState = row?.state
      const parsedState =
        typeof rawState === 'string'
          ? (JSON.parse(rawState) as WorkspaceSnapshot)
          : (rawState ?? {})
      const snapshot = normalizeWorkspaceSnapshot(parsedState)
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

  // Retired: planning data is written to capacity_documents, one row per document.
  // The table stays readable so an account that last saved before the move can still be
  // migrated by the GET above, but nothing may write to it again — including a browser
  // still running a cached copy of the old bundle.
  if (req.method === 'PUT') {
    json(res, 410, {
      error:
        'The workspace snapshot is read-only. Reload the page to pick up the current version, which saves to the database.',
      code: 'workspace_readonly',
    })
    return
  }

  json(res, 405, { error: 'Method not allowed.' })
}

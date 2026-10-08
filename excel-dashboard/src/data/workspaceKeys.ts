import workspaceKeys from '../../workspace-keys.json'
import { reconcileRemovedScenarioIds } from '../planner/removedScenarios'

export const WORKSPACE_SNAPSHOT_APPLIED_EVENT = 'workspace-snapshot-applied'

export const WORKSPACE_KEYS = workspaceKeys as readonly string[]

export type WorkspaceSnapshot = Record<string, string | null>

export function captureWorkspaceSnapshot(): WorkspaceSnapshot {
  const snapshot: WorkspaceSnapshot = {}
  if (typeof localStorage === 'undefined') return snapshot
  for (const key of WORKSPACE_KEYS) {
    snapshot[key] = localStorage.getItem(key)
  }
  return snapshot
}

function parseIdList(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
  } catch {
    return []
  }
}

export function applyWorkspaceSnapshot(snapshot: WorkspaceSnapshot): void {
  if (typeof localStorage === 'undefined') return

  // Read before remote keys overwrite local tombstones.
  const preexistingLocalTombs = parseIdList(localStorage.getItem('wfp-removed-scenario-ids-v1'))
  const preexistingRemovedEmails = parseIdList(localStorage.getItem('wfp-removed-user-emails-v1')).map((email) =>
    email.trim().toLowerCase(),
  )

  for (const key of WORKSPACE_KEYS) {
    const value = snapshot[key]
    if (value == null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  }

  try {
    const remoteTombs = parseIdList(snapshot['wfp-removed-scenario-ids-v1'])
    const remoteLiveScenarioIds = (() => {
      try {
        const scenarios = JSON.parse(snapshot['wfp-planner-scenarios-v1'] ?? '[]') as Array<{ id?: string }>
        if (!Array.isArray(scenarios)) return [] as string[]
        return scenarios.map((item) => String(item?.id ?? '').trim()).filter(Boolean)
      } catch {
        return [] as string[]
      }
    })()
    // Session deletes still win over a stale remote copy; stale local tombs for
    // live remote plans are dropped so Supervisor+/Admin keep company-wide visibility.
    const removed = new Set(
      reconcileRemovedScenarioIds({
        remoteTombs,
        remoteLiveScenarioIds,
        localTombs: preexistingLocalTombs,
      }),
    )
    if (removed.size) {
      const scenariosRaw = localStorage.getItem('wfp-planner-scenarios-v1')
      if (scenariosRaw) {
        const scenarios = JSON.parse(scenariosRaw) as Array<{ id?: string }>
        if (Array.isArray(scenarios)) {
          const cleaned = scenarios.filter((item) => !item?.id || !removed.has(item.id))
          if (cleaned.length !== scenarios.length) {
            localStorage.setItem('wfp-planner-scenarios-v1', JSON.stringify(cleaned))
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  // Reconcile user-delete tombs: keep org removals, drop stale local tombs for users
  // that are still present in the remote directory (so Admin can see Merven again).
  try {
    const remoteRemoved = new Set(
      parseIdList(snapshot['wfp-removed-user-emails-v1']).map((email) => email.trim().toLowerCase()),
    )
    const remoteDirectoryEmails = new Set<string>()
    for (const key of ['wfp-demo-users-v4', 'wfp-demo-users-v3'] as const) {
      const raw = snapshot[key]
      if (!raw) continue
      try {
        const parsed = JSON.parse(raw) as unknown
        if (!Array.isArray(parsed)) continue
        for (const item of parsed) {
          if (!item || typeof item !== 'object') continue
          const email = String((item as { email?: unknown }).email ?? '')
            .trim()
            .toLowerCase()
          if (email) remoteDirectoryEmails.add(email)
        }
      } catch {
        /* ignore */
      }
    }
    const nextRemoved = new Set<string>()
    for (const email of remoteRemoved) nextRemoved.add(email)
    for (const email of preexistingRemovedEmails) {
      if (remoteDirectoryEmails.has(email) && !remoteRemoved.has(email)) continue
      nextRemoved.add(email)
    }
    if (nextRemoved.size) {
      localStorage.setItem('wfp-removed-user-emails-v1', JSON.stringify([...nextRemoved].sort()))
    } else {
      localStorage.removeItem('wfp-removed-user-emails-v1')
    }
    for (const key of ['wfp-demo-users-v4', 'wfp-demo-users-v3'] as const) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) continue
      const cleaned = parsed.filter((item) => {
        if (!item || typeof item !== 'object') return false
        const email = String((item as { email?: unknown }).email ?? '')
          .trim()
          .toLowerCase()
        return Boolean(email) && !nextRemoved.has(email)
      })
      localStorage.setItem(key, JSON.stringify(cleaned))
    }
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new Event(WORKSPACE_SNAPSHOT_APPLIED_EVENT))
    window.dispatchEvent(new Event('revenue-projection-changed'))
    window.dispatchEvent(new Event('formula-registry-changed'))
  } catch {
    /* ignore */
  }
}

export function hasLocalWorkspaceData(): boolean {
  if (typeof localStorage === 'undefined') return false
  return WORKSPACE_KEYS.some((key) => localStorage.getItem(key) != null)
}

export function isEmptyWorkspaceSnapshot(snapshot: WorkspaceSnapshot): boolean {
  return WORKSPACE_KEYS.every((key) => !snapshot[key])
}

/** Drop planner/workspace keys so a different signed-in email cannot push another profile's cache. */
export function clearLocalWorkspaceCache(): void {
  if (typeof localStorage === 'undefined') return
  for (const key of WORKSPACE_KEYS) {
    localStorage.removeItem(key)
  }
}

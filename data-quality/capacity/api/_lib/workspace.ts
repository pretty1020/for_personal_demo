import workspaceKeys from '../../workspace-keys.json'

export const WORKSPACE_KEYS = workspaceKeys as readonly string[]

export type WorkspaceSnapshot = Record<string, string | null>

export function normalizeWorkspaceSnapshot(input: unknown): WorkspaceSnapshot {
  if (!input || typeof input !== 'object') return {}
  const snapshot: WorkspaceSnapshot = {}
  for (const key of WORKSPACE_KEYS) {
    const value = (input as Record<string, unknown>)[key]
    snapshot[key] = typeof value === 'string' ? value : null
  }
  return snapshot
}

export function isEmptyWorkspace(snapshot: WorkspaceSnapshot): boolean {
  return WORKSPACE_KEYS.every((key) => !snapshot[key])
}

import {
  apiGetWorkspace,
  apiSaveWorkspace,
  isRemoteBackend,
} from './apiClient'
import {
  applyWorkspaceSnapshot,
  captureWorkspaceSnapshot,
  hasLocalWorkspaceData,
  isEmptyWorkspaceSnapshot,
  type WorkspaceSnapshot,
} from './workspaceKeys'
import { ensureSampleWorkspace } from '../planner/sampleWorkspace'

let syncTimer: ReturnType<typeof setTimeout> | null = null
let syncInstalled = false
let syncInFlight = false

export async function syncWorkspaceAfterLogin(): Promise<void> {
  if (!isRemoteBackend()) return

  const remote = await apiGetWorkspace()
  if (!remote) return

  const localSnapshot = captureWorkspaceSnapshot()
  const remoteEmpty = remote.empty || isEmptyWorkspaceSnapshot(remote.snapshot)
  const localHasData = hasLocalWorkspaceData()

  if (remoteEmpty && localHasData) {
    await apiSaveWorkspace(localSnapshot)
    return
  }

  if (!remoteEmpty) {
    applyWorkspaceSnapshot(remote.snapshot)
  }

  // Upgrade sample-only workspaces (e.g. Apex → Apex + Telco Client) and push.
  if (ensureSampleWorkspace()) {
    await apiSaveWorkspace(captureWorkspaceSnapshot())
  }
}

async function pushWorkspaceNow(): Promise<void> {
  if (!isRemoteBackend() || syncInFlight) return
  syncInFlight = true
  try {
    const snapshot = captureWorkspaceSnapshot()
    await apiSaveWorkspace(snapshot)
  } catch (error) {
    console.error('Workspace sync failed:', error)
  } finally {
    syncInFlight = false
  }
}

function scheduleWorkspacePush(): void {
  if (!isRemoteBackend()) return
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    void pushWorkspaceNow()
  }, 1500)
}

function shouldSyncKey(key: string): boolean {
  return key.startsWith('wfp-') && key !== 'wfp-demo-session-v1'
}

export function installWorkspaceSync(): void {
  if (!isRemoteBackend() || syncInstalled) return
  syncInstalled = true

  const originalSetItem = localStorage.setItem.bind(localStorage)
  const originalRemoveItem = localStorage.removeItem.bind(localStorage)

  localStorage.setItem = (key: string, value: string) => {
    originalSetItem(key, value)
    if (shouldSyncKey(key)) scheduleWorkspacePush()
  }

  localStorage.removeItem = (key: string) => {
    originalRemoveItem(key)
    if (shouldSyncKey(key)) scheduleWorkspacePush()
  }
}

export function flushWorkspaceSync(): Promise<void> {
  if (syncTimer) {
    clearTimeout(syncTimer)
    syncTimer = null
  }
  return pushWorkspaceNow()
}

/** Persist a newly created client/plan to remote workspace when available. */
export async function persistNewClientToDatabase(input: {
  clientId: string
  scenarioId: string
  ownerEmail?: string
}): Promise<{ ok: boolean; error?: string }> {
  if (!isRemoteBackend()) return { ok: true }

  const owner = (input.ownerEmail ?? '').trim().toLowerCase()
  if (owner) {
    try {
      const raw = localStorage.getItem('wfp-planner-scenarios-v1')
      if (raw) {
        const parsed = JSON.parse(raw) as Array<{ id?: string; ownerEmail?: string; isBaseline?: boolean }>
        if (Array.isArray(parsed)) {
          let changed = false
          const next = parsed.map((scenario) => {
            if (scenario?.id !== input.scenarioId || scenario.isBaseline) return scenario
            const current = String(scenario.ownerEmail ?? '')
              .trim()
              .toLowerCase()
            if (current === owner) return scenario
            changed = true
            return { ...scenario, ownerEmail: owner }
          })
          if (changed) localStorage.setItem('wfp-planner-scenarios-v1', JSON.stringify(next))
        }
      }
    } catch {
      /* continue */
    }
  }

  try {
    await flushWorkspaceSync()
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save workspace.'
    console.warn('Create sync deferred:', message)
    return { ok: true, error: message }
  }
}

/** Mark deleted scenarios and push workspace so remote copies stay in sync. */
export async function persistScenarioDeletion(scenarioIds: string[]): Promise<{ ok: boolean; error?: string }> {
  const ids = [...new Set(scenarioIds.map((id) => id.trim()).filter(Boolean))]
  if (ids.length) {
    try {
      const key = 'wfp-removed-scenario-ids-v1'
      const raw = localStorage.getItem(key)
      const existing = raw ? (JSON.parse(raw) as unknown) : []
      const next = new Set<string>(
        Array.isArray(existing)
          ? existing.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
          : [],
      )
      for (const id of ids) next.add(id)
      localStorage.setItem(key, JSON.stringify([...next].sort()))
    } catch {
      /* ignore local tombstone write */
    }
  }

  if (!isRemoteBackend()) return { ok: true }

  try {
    await flushWorkspaceSync()
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save workspace.'
    console.warn('Delete sync deferred:', message)
    return { ok: true, error: message }
  }
}

export function exportWorkspaceForDebug(): WorkspaceSnapshot {
  return captureWorkspaceSnapshot()
}

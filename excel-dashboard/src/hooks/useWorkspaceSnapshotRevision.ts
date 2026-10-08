import { useEffect, useState } from 'react'
import { WORKSPACE_KEYS, WORKSPACE_SNAPSHOT_APPLIED_EVENT } from '../data/workspaceKeys'

const KEY_SET = new Set<string>(WORKSPACE_KEYS)

/** Bumps when a remote workspace snapshot is applied or another tab writes a workspace key. */
export function useWorkspaceSnapshotRevision(): number {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const bump = () => setRevision((value) => value + 1)
    const onStorage = (event: StorageEvent) => {
      if (event.key && !KEY_SET.has(event.key)) return
      bump()
    }
    window.addEventListener(WORKSPACE_SNAPSHOT_APPLIED_EVENT, bump)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(WORKSPACE_SNAPSHOT_APPLIED_EVENT, bump)
      window.removeEventListener('storage', onStorage)
    }
  }, [])
  return revision
}

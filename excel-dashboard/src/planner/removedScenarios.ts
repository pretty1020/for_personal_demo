const REMOVED_SCENARIO_IDS_KEY = 'wfp-removed-scenario-ids-v1'

/** In-session deletes that must win over a stale remote snapshot until flush succeeds. */
const pendingRemovedScenarioIds = new Set<string>()

export function loadRemovedScenarioIds(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(REMOVED_SCENARIO_IDS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return [...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))]
  } catch {
    return []
  }
}

export function rememberRemovedScenarioIds(ids: string[]): string[] {
  const next = [...new Set([...loadRemovedScenarioIds(), ...ids.map((id) => id.trim()).filter(Boolean)])].sort()
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(REMOVED_SCENARIO_IDS_KEY, JSON.stringify(next))
  }
  return next
}

export function isScenarioTombstoned(id: string): boolean {
  return loadRemovedScenarioIds().includes(id)
}

export function markScenarioRemovedPending(id: string): void {
  const trimmed = id.trim()
  if (!trimmed) return
  pendingRemovedScenarioIds.add(trimmed)
}

export function clearPendingRemovedScenarioIds(): void {
  pendingRemovedScenarioIds.clear()
}

export function listPendingRemovedScenarioIds(): string[] {
  return [...pendingRemovedScenarioIds]
}

export function hasPendingScenarioRemoval(id: string): boolean {
  return pendingRemovedScenarioIds.has(id.trim())
}

/** Drain only this-session deletes — never the full historical tombstone list. */
export function consumePendingRemovedScenarioIds(): string[] {
  const ids = [...pendingRemovedScenarioIds]
  pendingRemovedScenarioIds.clear()
  return ids
}

/**
 * After a remote snapshot apply: keep org tombs + this-session deletes,
 * but drop stale local tombs for plans the server still treats as live.
 */
export function reconcileRemovedScenarioIds(input: {
  remoteTombs: string[]
  remoteLiveScenarioIds: string[]
  /** Capture before writing the remote snapshot over localStorage. */
  localTombs?: string[]
}): string[] {
  const remoteTombs = new Set(input.remoteTombs.map((id) => id.trim()).filter(Boolean))
  const remoteLive = new Set(input.remoteLiveScenarioIds.map((id) => id.trim()).filter(Boolean))
  const local = (input.localTombs ?? loadRemovedScenarioIds()).map((id) => id.trim()).filter(Boolean)
  const next = new Set<string>()

  for (const id of remoteTombs) next.add(id)

  for (const id of local) {
    if (pendingRemovedScenarioIds.has(id)) {
      next.add(id)
      continue
    }
    // Stale local tomb for a live remote plan must not hide company-wide visibility.
    if (remoteLive.has(id) && !remoteTombs.has(id)) continue
    next.add(id)
  }

  for (const id of pendingRemovedScenarioIds) next.add(id)

  const sorted = [...next].sort()
  if (typeof localStorage !== 'undefined') {
    if (sorted.length) localStorage.setItem(REMOVED_SCENARIO_IDS_KEY, JSON.stringify(sorted))
    else localStorage.removeItem(REMOVED_SCENARIO_IDS_KEY)
  }
  return sorted
}

export { REMOVED_SCENARIO_IDS_KEY }

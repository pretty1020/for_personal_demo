/**
 * "Editing <name>'s plans" mode for managers and above.
 *
 * The planner screens read their stores synchronously from localStorage, so opening
 * someone else's plans means swapping that cache to their data. Everything written
 * while the swap is in place must go to *their* capacity_documents rows, never the
 * manager's own — which is the whole risk this module exists to contain.
 *
 * Three decisions make that safe:
 *
 *  1. The target lives in localStorage, not sessionStorage, so every tab of this
 *     browser agrees on whose data is in the shared cache. A per-tab flag would let
 *     one tab hold Ana's plans while another believed they were the manager's own,
 *     and the next save would file one person's work under the other's name.
 *
 *  2. It is stored under a LOCAL_PREFERENCE key, so the document sync never uploads
 *     it and sign-out clears it.
 *
 *  3. It is read at push time rather than captured when a save is queued, so a change
 *     of target can never be outrun by an in-flight write.
 */

export const ACT_AS_STORAGE_KEY = 'wfp-act-as-v1'

export type ActAsTarget = {
  userId: string
  name: string
  email: string
}

const listeners = new Set<(target: ActAsTarget | null) => void>()

function readTarget(): ActAsTarget | null {
  try {
    const raw = localStorage.getItem(ACT_AS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<ActAsTarget> | null
    if (!parsed || typeof parsed.userId !== 'string' || !parsed.userId) return null
    return {
      userId: parsed.userId,
      name: typeof parsed.name === 'string' && parsed.name ? parsed.name : 'another planner',
      email: typeof parsed.email === 'string' ? parsed.email : '',
    }
  } catch {
    return null
  }
}

/**
 * Whose plans the app is currently editing, or null for the signed-in user's own.
 *
 * Deliberately re-read from storage on every call instead of cached in a module
 * variable: another tab may have entered or left the mode since the last read, and a
 * stale answer here is exactly how a write reaches the wrong owner.
 */
export function actAsTarget(): ActAsTarget | null {
  if (typeof localStorage === 'undefined') return null
  return readTarget()
}

/** The id writes should be addressed to, or null to write to the caller's own rows. */
export function actAsTargetId(): string | null {
  return actAsTarget()?.userId ?? null
}

export function isActingAsOther(): boolean {
  return actAsTargetId() !== null
}

/**
 * Records the target. Callers must not use this directly to switch modes — go through
 * enterActAsPlanner / exitActAsPlanner in capacityDocuments, which flush pending saves
 * and reload the cache around the change.
 */
export function setActAsTarget(target: ActAsTarget | null): void {
  if (typeof localStorage === 'undefined') return
  if (target) localStorage.setItem(ACT_AS_STORAGE_KEY, JSON.stringify(target))
  else localStorage.removeItem(ACT_AS_STORAGE_KEY)
  for (const listener of listeners) listener(target)
}

export function subscribeActAs(listener: (target: ActAsTarget | null) => void): () => void {
  listeners.add(listener)
  listener(actAsTarget())
  return () => listeners.delete(listener)
}

/** Lets the sync layer tell React about a change another tab made. */
export function notifyActAsChanged(): void {
  const target = actAsTarget()
  for (const listener of listeners) listener(target)
}

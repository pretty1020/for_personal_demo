import {
  ApiError,
  apiBackfillDocuments,
  apiDeleteDocument,
  apiGetWorkspace,
  apiListDocuments,
  apiListUserDocuments,
  apiSaveDocument,
  isRemoteBackend,
  type ApiDocument,
} from './apiClient'
import {
  DOCUMENT_KEYS,
  LEGACY_DOCUMENT_KEYS,
  LOCAL_PREFERENCE_KEYS,
  fromDocumentPayload as fromPayload,
  isDocumentKey,
  toDocumentPayload as toPayload,
} from './capacityDocumentKeys'
import {
  ACT_AS_STORAGE_KEY,
  actAsTargetId,
  notifyActAsChanged,
  setActAsTarget,
  type ActAsTarget,
} from './capacityActAs'

/**
 * The capacity_documents table is the source of truth for planning data. localStorage
 * is kept as a read-through cache only, because the planner screens read their stores
 * synchronously during render and cannot await a fetch mid-frame. Every local write is
 * mirrored to the database, and every sign-in reloads from it, so clearing the browser
 * costs nothing but a round trip.
 */

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export type SaveStatus = {
  state: SaveState
  /** Set while state is 'error' — shown to the user rather than only logged. */
  message: string
  pendingKeys: string[]
  lastSavedAt: string | null
}

const PUSH_DEBOUNCE_MS = 800
/** How long "All changes saved" stays up before the badge hides itself. */
const SAVED_VISIBLE_MS = 2500

const revisions = new Map<string, number>()
const pending = new Map<string, ReturnType<typeof setTimeout>>()
const failed = new Set<string>()

let status: SaveStatus = { state: 'idle', message: '', pendingKeys: [], lastSavedAt: null }
const listeners = new Set<(next: SaveStatus) => void>()
let installed = false
let paused = false
let inFlight = 0

const cacheListeners = new Set<() => void>()

/**
 * Fires whenever the local cache has been refilled from the database — after sign-in and
 * after switching to or from another planner's plans.
 *
 * Components that copy a store into React state at mount need this: after a swap their
 * copy belongs to the previous owner, and without a re-read they would keep showing, and
 * saving, the wrong person's numbers.
 */
export function subscribeCacheReloaded(listener: () => void): () => void {
  cacheListeners.add(listener)
  return () => cacheListeners.delete(listener)
}

function announceCacheReloaded(): void {
  for (const listener of cacheListeners) listener()
}

export function subscribeSaveStatus(listener: (next: SaveStatus) => void): () => void {
  listeners.add(listener)
  listener(status)
  return () => listeners.delete(listener)
}

export function getSaveStatus(): SaveStatus {
  return status
}

function publish(patch: Partial<SaveStatus>): void {
  status = {
    ...status,
    ...patch,
    pendingKeys: [...new Set([...pending.keys(), ...failed])],
  }
  for (const listener of listeners) listener(status)
}

let idleTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Failures from stores that save through their own endpoint instead of this pipeline —
 * currently the client list, which lives in a relational table rather than a document.
 *
 * They report in here so there is one place the user looks to know whether their work
 * reached the database. A save that fails quietly is indistinguishable from one that
 * worked, which is the whole problem this exists to prevent.
 */
const externalErrors = new Map<string, string>()
const externalRetries = new Map<string, () => void>()

export function reportExternalSaveError(source: string, message: string, retry?: () => void): void {
  externalErrors.set(source, message)
  if (retry) externalRetries.set(source, retry)
  publish({ state: 'error', message })
}

export function clearExternalSaveError(source: string): void {
  if (!externalErrors.delete(source)) return
  externalRetries.delete(source)

  const remaining = externalErrors.values().next().value
  if (remaining) publish({ state: 'error', message: remaining })
  else if (failed.size === 0) publish({ state: 'saved', lastSavedAt: new Date().toISOString() })
  scheduleIdle()
}

/** True while anything, document or otherwise, is still unsaved. */
function hasUnsavedWork(): boolean {
  return failed.size > 0 || externalErrors.size > 0
}

/**
 * Drop back to idle a moment after the last save so the confirmation does not sit on
 * screen for the rest of the session. Errors are left alone — those must stay visible.
 */
function scheduleIdle(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (pending.size === 0 && !hasUnsavedWork() && inFlight === 0) {
      publish({ state: 'idle', message: '' })
    }
  }, SAVED_VISIBLE_MS)
}

/** Writes straight to storage without re-triggering the mirror. */
let rawSetItem: (key: string, value: string) => void = (key, value) =>
  localStorage.setItem(key, value)
let rawRemoveItem: (key: string) => void = (key) => localStorage.removeItem(key)

function applyDocument(document: ApiDocument): void {
  revisions.set(document.key, document.revision)
  const value = fromPayload(document.payload)
  if (value === null) rawRemoveItem(document.key)
  else rawSetItem(document.key, value)
}

async function pushKey(key: string): Promise<void> {
  const raw = localStorage.getItem(key)
  // Read now, not when the save was queued: if the target changed while this write was
  // waiting out the debounce, the newer answer is the correct one.
  const target = actAsTargetId()
  inFlight += 1
  publish({ state: 'saving' })

  try {
    if (raw === null) {
      await apiDeleteDocument(key, target)
      revisions.delete(key)
    } else {
      const saved = await apiSaveDocument(key, toPayload(raw), revisions.get(key), target)
      revisions.set(saved.key, saved.revision)
    }
    failed.delete(key)
    publish({
      state: hasUnsavedWork() ? 'error' : 'saved',
      message: hasUnsavedWork() ? status.message : '',
      lastSavedAt: new Date().toISOString(),
    })
    scheduleIdle()
  } catch (error) {
    failed.add(key)
    let message = error instanceof Error ? error.message : 'Save failed.'

    if (error instanceof ApiError && error.code === 'revision_conflict') {
      // Forget the revision we were holding. Without this the retry would resend the
      // same stale number and be refused again, leaving the user unable to save at all.
      // Dropping it makes Retry an explicit "keep my version" instead of a dead button.
      revisions.delete(key)
      message = 'This plan was changed in another tab. Retry to save your version.'
    }

    // Surfaced through subscribeSaveStatus so the user sees it, not just the console.
    console.error(`Capacity document ${key} did not reach the database:`, error)
    publish({ state: 'error', message })
  } finally {
    inFlight -= 1
  }
}

function scheduleKey(key: string): void {
  if (!isRemoteBackend() || paused) return
  const existing = pending.get(key)
  if (existing) clearTimeout(existing)
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key)
      void pushKey(key)
    }, PUSH_DEBOUNCE_MS),
  )
  publish({ state: 'saving' })
}

/**
 * Sends every queued change now — used before sign-out and when the tab goes away.
 * Does nothing while paused: during the login and logout window the cache belongs to
 * no one in particular, and pushing it could file one person's plans under another's.
 */
export async function flushCapacityDocuments(): Promise<void> {
  if (!isRemoteBackend() || paused) return
  const keys = [...pending.keys(), ...failed]
  for (const timer of pending.values()) clearTimeout(timer)
  pending.clear()
  await Promise.all(keys.map((key) => pushKey(key)))
}

export function retryFailedDocuments(): void {
  for (const retry of [...externalRetries.values()]) retry()
  for (const key of [...failed]) scheduleKey(key)
}

export function pauseCapacityDocuments(): void {
  paused = true
  for (const timer of pending.values()) clearTimeout(timer)
  pending.clear()
}

export function resumeCapacityDocuments(): void {
  paused = false
}

/**
 * Mirrors local writes to the database. Only planning keys are sent; view preferences
 * pass straight through to localStorage and stay on this machine.
 */
export function installCapacityDocumentSync(): void {
  if (installed) return
  installed = true

  const originalSetItem = localStorage.setItem.bind(localStorage)
  const originalRemoveItem = localStorage.removeItem.bind(localStorage)
  rawSetItem = originalSetItem
  rawRemoveItem = originalRemoveItem

  localStorage.setItem = (key: string, value: string) => {
    originalSetItem(key, value)
    if (isDocumentKey(key)) scheduleKey(key)
  }

  localStorage.removeItem = (key: string) => {
    originalRemoveItem(key)
    if (isDocumentKey(key)) scheduleKey(key)
  }

  // A tab that goes away must not take unsaved edits with it. 'hidden' is the reliable
  // one: it fires on tab switch, minimise and app switch, while the page is still alive
  // and a normal request can finish. 'pagehide' is the last-resort backstop for an actual
  // close, where the browser may cancel the request before it lands.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushCapacityDocuments()
      void import('./staffingPlanSync').then((mod) => mod.flushStaffingPlanRequiredHcSync())
    }
  })
  window.addEventListener('pagehide', () => {
    void flushCapacityDocuments()
    void import('./staffingPlanSync').then((mod) => mod.flushStaffingPlanRequiredHcSync())
  })

  // Another tab entered or left "editing <name>'s plans". That tab has already replaced
  // the shared cache with a different owner's data, so this tab's screens are now showing
  // — and would save — someone else's work. Reload from the database for whoever the
  // target now is, and let the banner update.
  //
  // Fires only in other tabs: the browser does not deliver storage events to the tab
  // that made the change, so this cannot loop with switchDocumentOwner.
  window.addEventListener('storage', (event) => {
    if (event.key !== ACT_AS_STORAGE_KEY) return
    pauseCapacityDocuments()
    clearDocumentCache()
    resumeCapacityDocuments()
    notifyActAsChanged()
    void hydrateCapacityDocuments()
  })
}

/**
 * Clears the local cache so the next person to sign in does not inherit these plans.
 * Safe because the database still holds every document; the next hydrate refills it.
 * View preferences go too — a leftover "active scenario" would point at a plan the
 * new user cannot see.
 *
 * This also drops the act-as target, which is what makes a page reload safe: sign-in and
 * session restore both call this before hydrating, so a refresh always lands back on the
 * signed-in user's own plans rather than resuming with someone else's data in the cache.
 * Nothing is lost — edits are flushed on pagehide while the old target still applies.
 */
export function clearLocalCapacityData(): void {
  revisions.clear()
  failed.clear()
  for (const key of [...DOCUMENT_KEYS, ...LEGACY_DOCUMENT_KEYS, ...LOCAL_PREFERENCE_KEYS]) {
    rawRemoveItem(key)
  }
  publish({ state: 'idle', message: '', lastSavedAt: null })
}

function readLocalDocuments(): { key: string; payload: unknown }[] {
  const entries: { key: string; payload: unknown }[] = []
  for (const key of [...DOCUMENT_KEYS, ...LEGACY_DOCUMENT_KEYS]) {
    const raw = localStorage.getItem(key)
    if (raw !== null) entries.push({ key, payload: toPayload(raw) })
  }
  return entries
}

/**
 * Pulls the old workspace_state blob forward. Runs only when the user has no document
 * rows yet, and the server skips any key that already exists, so it cannot overwrite
 * work done in the database.
 */
async function backfillFromLegacyStorage(): Promise<ApiDocument[]> {
  const local = readLocalDocuments()
  if (local.length > 0) return apiBackfillDocuments(local)

  try {
    const workspace = await apiGetWorkspace()
    if (!workspace || workspace.empty) return []
    const entries = Object.entries(workspace.snapshot)
      .filter(([key, value]) => isDocumentKey(key) && value != null)
      .map(([key, value]) => ({ key, payload: toPayload(value as string) }))
    if (entries.length === 0) return []
    return await apiBackfillDocuments(entries)
  } catch (error) {
    console.error('Could not read the previous workspace snapshot:', error)
    return []
  }
}

/**
 * Loads the signed-in user's planning data from the database into the local cache.
 * Call after login and before the planner screens render.
 */
export async function hydrateCapacityDocuments(): Promise<void> {
  if (!isRemoteBackend()) return

  pauseCapacityDocuments()
  try {
    const target = actAsTargetId()
    let documents: ApiDocument[]

    if (target) {
      // Someone else's plans. No backfill: the legacy workspace blob belongs to whoever
      // is signed in, and pulling it forward here would file it under the target.
      documents = await apiListUserDocuments(target)
    } else {
      documents = await apiListDocuments()
      if (documents.length === 0) {
        documents = await backfillFromLegacyStorage()
      }
    }

    const seen = new Set(documents.map((document) => document.key))
    // Anything the database does not have is stale local cache, not new work.
    for (const key of [...DOCUMENT_KEYS, ...LEGACY_DOCUMENT_KEYS]) {
      if (!seen.has(key)) rawRemoveItem(key)
    }
    for (const document of documents) applyDocument(document)

    // Required Production FTE + Shrinkage Breakdown live in staffing_plan /
    // staffing_plan_shrinkage — merge into overrides after documents hydrate.
    const { mergeStaffingPlanIntoOverrides } = await import('./staffingPlanSync')
    await mergeStaffingPlanIntoOverrides()

    publish({ state: 'idle', message: '', lastSavedAt: null })
  } catch (error) {
    console.error('Could not load your plans from the database:', error)
    publish({
      state: 'error',
      message: 'Could not load your saved plans. Check your connection and reload.',
    })
  } finally {
    resumeCapacityDocuments()
    // Announced even when the load failed: the cache was cleared either way, and a screen
    // still displaying the previous owner's plans is the outcome to avoid.
    announceCacheReloaded()
  }
}

export function hasInFlightSaves(): boolean {
  return inFlight > 0 || pending.size > 0
}

/** Empties the planning cache without touching view preferences or the act-as target. */
function clearDocumentCache(): void {
  revisions.clear()
  failed.clear()
  for (const key of [...DOCUMENT_KEYS, ...LEGACY_DOCUMENT_KEYS]) rawRemoveItem(key)
}

/**
 * Swaps the local cache from one owner to another.
 *
 * Order matters and is the whole safety argument:
 *
 *   1. Flush queued writes while the *old* target is still set, so pending edits land
 *      on the owner they were made for.
 *   2. Pause, so nothing can be queued against the wrong owner mid-swap.
 *   3. Drop the cache and the revision numbers, which belong to the old owner.
 *   4. Point at the new target, then reload from the database.
 *
 * If the reload fails the cache is left empty rather than stale. That shows an error
 * instead of presenting one planner's numbers as another's, which is the failure worth
 * having.
 */
async function switchDocumentOwner(next: ActAsTarget | null): Promise<void> {
  await flushCapacityDocuments()
  pauseCapacityDocuments()
  clearDocumentCache()
  setActAsTarget(next)
  resumeCapacityDocuments()
  await hydrateCapacityDocuments()
}

/**
 * Opens another planner's plans for editing. Manager and above; the server refuses the
 * writes otherwise. Saves go to that planner's rows and the audit log records the
 * manager as the actor.
 */
export async function enterActAsPlanner(target: ActAsTarget): Promise<void> {
  if (!isRemoteBackend()) return
  await switchDocumentOwner(target)
}

/** Returns to the signed-in user's own plans. */
export async function exitActAsPlanner(): Promise<void> {
  if (!isRemoteBackend()) return
  await switchDocumentOwner(null)
}

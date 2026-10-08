import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiDocument } from './apiClient'

/**
 * The one behaviour worth pinning down: while standing in for a planner, every write
 * must carry their user id. A save that quietly omits it lands on the manager's own row
 * and overwrites their plans with someone else's work.
 */

const apiSaveDocument = vi.fn()
const apiDeleteDocument = vi.fn()
const apiListDocuments = vi.fn<() => Promise<ApiDocument[]>>()
const apiListUserDocuments = vi.fn<(userId: string) => Promise<ApiDocument[]>>()

vi.mock('./apiClient', () => ({
  ApiError: class ApiError extends Error {
    code?: string
    status = 500
  },
  apiBackfillDocuments: vi.fn(async () => []),
  apiDeleteDocument: (key: string, target?: string | null) => apiDeleteDocument(key, target),
  apiGetWorkspace: vi.fn(async () => null),
  apiListDocuments: () => apiListDocuments(),
  apiListUserDocuments: (userId: string) => apiListUserDocuments(userId),
  apiSaveDocument: (key: string, payload: unknown, revision?: number, target?: string | null) =>
    apiSaveDocument(key, payload, revision, target),
  isRemoteBackend: () => true,
}))

const PLAN_KEY = 'wfp-planner-scenarios-v2'

function installBrowserGlobals(): Map<string, string> {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
    },
  })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { addEventListener: () => {}, visibilityState: 'visible' },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { addEventListener: () => {} },
  })
  return store
}

async function loadModules() {
  vi.resetModules()
  const documents = await import('./capacityDocuments')
  const actAs = await import('./capacityActAs')
  documents.installCapacityDocumentSync()
  return { documents, actAs }
}

describe('saving while standing in for another planner', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = installBrowserGlobals()
    vi.useFakeTimers()
    apiSaveDocument.mockReset()
    apiSaveDocument.mockImplementation(async (key: string) => ({
      key,
      payload: null,
      revision: 1,
      ownerUserId: 'whoever',
      ownerName: '',
      ownerEmail: '',
      updatedAt: '',
    }))
    apiDeleteDocument.mockReset()
    apiDeleteDocument.mockResolvedValue(undefined)
    apiListDocuments.mockReset()
    apiListDocuments.mockResolvedValue([])
    apiListUserDocuments.mockReset()
    apiListUserDocuments.mockResolvedValue([])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends no target when editing your own plans', async () => {
    const { documents } = await loadModules()

    localStorage.setItem(PLAN_KEY, '[]')
    await documents.flushCapacityDocuments()

    expect(apiSaveDocument).toHaveBeenCalledTimes(1)
    expect(apiSaveDocument.mock.calls[0]![3]).toBeNull()
  })

  it('addresses the save to the planner being stood in for', async () => {
    const { documents, actAs } = await loadModules()
    actAs.setActAsTarget({ userId: 'user-ana', name: 'Ana', email: 'ana@movate.com' })

    localStorage.setItem(PLAN_KEY, '[{"id":"s1"}]')
    await documents.flushCapacityDocuments()

    expect(apiSaveDocument.mock.calls[0]![3]).toBe('user-ana')
  })

  it('addresses deletes the same way, so a removal cannot hit the wrong account', async () => {
    const { documents, actAs } = await loadModules()
    actAs.setActAsTarget({ userId: 'user-ana', name: 'Ana', email: 'ana@movate.com' })

    localStorage.setItem(PLAN_KEY, '[]')
    localStorage.removeItem(PLAN_KEY)
    await documents.flushCapacityDocuments()

    expect(apiDeleteDocument).toHaveBeenCalledWith(PLAN_KEY, 'user-ana')
  })

  /**
   * A save is queued behind an 800ms debounce. If the target is read when the write is
   * queued rather than when it is sent, a switch during that window sends the new
   * owner's data to the old owner.
   */
  it('uses the target as it stands when the write is sent, not when it was queued', async () => {
    const { documents, actAs } = await loadModules()

    localStorage.setItem(PLAN_KEY, '[]')
    actAs.setActAsTarget({ userId: 'user-bo', name: 'Bo', email: 'bo@movate.com' })
    await documents.flushCapacityDocuments()

    expect(apiSaveDocument.mock.calls[0]![3]).toBe('user-bo')
  })

  it('loads the target\u2019s documents rather than the manager\u2019s own', async () => {
    const { documents, actAs } = await loadModules()
    actAs.setActAsTarget({ userId: 'user-ana', name: 'Ana', email: 'ana@movate.com' })

    await documents.hydrateCapacityDocuments()

    expect(apiListUserDocuments).toHaveBeenCalledWith('user-ana')
    expect(apiListDocuments).not.toHaveBeenCalled()
  })

  it('goes back to the manager\u2019s own documents once the target is cleared', async () => {
    const { documents, actAs } = await loadModules()
    actAs.setActAsTarget({ userId: 'user-ana', name: 'Ana', email: 'ana@movate.com' })
    actAs.setActAsTarget(null)

    await documents.hydrateCapacityDocuments()

    expect(apiListDocuments).toHaveBeenCalled()
    expect(apiListUserDocuments).not.toHaveBeenCalled()
  })

  /** The swap must not leave one owner's rows holding another owner's revision numbers. */
  it('drops cached revisions when the owner changes', async () => {
    const { documents } = await loadModules()

    localStorage.setItem(PLAN_KEY, '[]')
    await documents.flushCapacityDocuments()
    expect(apiSaveDocument.mock.calls[0]![2]).toBeUndefined()

    apiSaveDocument.mockClear()
    await documents.enterActAsPlanner({ userId: 'user-ana', name: 'Ana', email: 'ana@movate.com' })

    localStorage.setItem(PLAN_KEY, '[{"id":"s2"}]')
    await documents.flushCapacityDocuments()

    // Revision undefined, not the 1 returned for the manager's own row a moment ago.
    expect(apiSaveDocument.mock.calls[0]![2]).toBeUndefined()
    expect(apiSaveDocument.mock.calls[0]![3]).toBe('user-ana')
  })

  it('empties the cache when handing over, so the next owner starts clean', async () => {
    const { documents } = await loadModules()

    localStorage.setItem(PLAN_KEY, '[{"id":"mine"}]')
    await documents.enterActAsPlanner({ userId: 'user-ana', name: 'Ana', email: 'ana@movate.com' })

    // apiListUserDocuments returned nothing, so nothing should remain from the manager.
    expect(store.get(PLAN_KEY)).toBeUndefined()
  })
})

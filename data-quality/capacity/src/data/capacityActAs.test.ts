import { beforeEach, describe, expect, it } from 'vitest'
import {
  ACT_AS_STORAGE_KEY,
  actAsTarget,
  actAsTargetId,
  isActingAsOther,
  setActAsTarget,
  subscribeActAs,
} from './capacityActAs'

/** The module reads localStorage directly; jsdom is not configured for these tests. */
function installMemoryStorage(): Map<string, string> {
  const store = new Map<string, string>()
  const api = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
  }
  Object.defineProperty(globalThis, 'localStorage', { value: api, configurable: true })
  return store
}

describe('act-as target', () => {
  let store: Map<string, string>

  beforeEach(() => {
    store = installMemoryStorage()
  })

  const ana = { userId: 'user-ana', name: 'Ana Planner', email: 'ana@movate.com' }

  it('reports nobody until a target is set', () => {
    expect(actAsTarget()).toBeNull()
    expect(actAsTargetId()).toBeNull()
    expect(isActingAsOther()).toBe(false)
  })

  it('round trips the target through storage', () => {
    setActAsTarget(ana)
    expect(actAsTarget()).toEqual(ana)
    expect(actAsTargetId()).toBe('user-ana')
    expect(isActingAsOther()).toBe(true)
  })

  it('clears back to the signed-in user', () => {
    setActAsTarget(ana)
    setActAsTarget(null)
    expect(actAsTargetId()).toBeNull()
    expect(store.has(ACT_AS_STORAGE_KEY)).toBe(false)
  })

  /**
   * The value is shared with other tabs, so it can be anything by the time it is read.
   * Every malformed case must read as "not acting as anyone", because the alternative is
   * addressing a save to a target that does not exist.
   */
  it('treats unusable stored values as nobody', () => {
    for (const raw of ['', 'not json', '{}', '[]', 'null', '{"userId":""}', '{"name":"Ana"}']) {
      store.set(ACT_AS_STORAGE_KEY, raw)
      expect(actAsTargetId(), `${raw} should not select a target`).toBeNull()
    }
  })

  it('fills in a readable name when the stored one is missing', () => {
    store.set(ACT_AS_STORAGE_KEY, JSON.stringify({ userId: 'user-x' }))
    expect(actAsTarget()).toEqual({ userId: 'user-x', name: 'another planner', email: '' })
  })

  /**
   * Reading from storage every time is what makes a write safe: another tab may have
   * changed or cleared the target since this tab last looked.
   */
  it('picks up a change another tab made, without being told', () => {
    setActAsTarget(ana)
    store.set(ACT_AS_STORAGE_KEY, JSON.stringify({ ...ana, userId: 'user-bo', name: 'Bo' }))
    expect(actAsTargetId()).toBe('user-bo')

    store.delete(ACT_AS_STORAGE_KEY)
    expect(actAsTargetId()).toBeNull()
  })

  it('tells subscribers the current target immediately and on change', () => {
    const seen: (string | null)[] = []
    const stop = subscribeActAs((target) => seen.push(target?.userId ?? null))

    setActAsTarget(ana)
    setActAsTarget(null)
    stop()
    setActAsTarget(ana)

    expect(seen).toEqual([null, 'user-ana', null])
  })
})

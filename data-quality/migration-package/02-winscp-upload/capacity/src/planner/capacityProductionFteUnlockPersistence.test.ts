import { describe, expect, it, beforeEach } from 'vitest'
import {
  isProductionFteUnlocked,
  loadProductionFteUnlockStore,
  PRODUCTION_FTE_UNLOCK_STORAGE_KEY,
  setProductionFteUnlocked,
} from './capacityProductionFteUnlockPersistence'

function installMemoryLocalStorage() {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, String(value))
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
      clear: () => store.clear(),
    },
  })
}

describe('Production FTE unlock per Client/LOB scope', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
  })

  it('stores unlock independently per scope so mixed state is allowed', () => {
    setProductionFteUnlocked('lob:alpha', true)
    setProductionFteUnlocked('lob:beta', false)
    setProductionFteUnlocked('combined:Acme', true)

    expect(isProductionFteUnlocked('lob:alpha')).toBe(true)
    expect(isProductionFteUnlocked('lob:beta')).toBe(false)
    expect(isProductionFteUnlocked('combined:Acme')).toBe(true)
    expect(isProductionFteUnlocked('lob:gamma')).toBe(false)
  })

  it('removes a scope when locked again', () => {
    setProductionFteUnlocked('lob:alpha', true)
    setProductionFteUnlocked('lob:alpha', false)
    expect(isProductionFteUnlocked('lob:alpha')).toBe(false)
    expect(loadProductionFteUnlockStore()).toEqual({})
  })

  it('persists under the MariaDB document key', () => {
    setProductionFteUnlocked('lob:alpha', true)
    const raw = localStorage.getItem(PRODUCTION_FTE_UNLOCK_STORAGE_KEY)
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!)).toEqual({ 'lob:alpha': true })
  })
})

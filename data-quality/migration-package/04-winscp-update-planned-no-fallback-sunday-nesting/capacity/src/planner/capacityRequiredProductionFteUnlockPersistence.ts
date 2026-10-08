/**
 * Per Client/LOB unlock for Required Production FTE.
 * When unlocked, Required FTE is manual input and is not recomputed from Volume × AHT × Occupancy.
 */

export const REQUIRED_PRODUCTION_FTE_UNLOCK_STORAGE_KEY = 'wfp-capacity-required-production-fte-unlock-v1'

export type RequiredProductionFteUnlockStore = Record<string, boolean>

export function loadRequiredProductionFteUnlockStore(): RequiredProductionFteUnlockStore {
  try {
    const raw = localStorage.getItem(REQUIRED_PRODUCTION_FTE_UNLOCK_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as RequiredProductionFteUnlockStore
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const next: RequiredProductionFteUnlockStore = {}
    for (const [scopeId, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') next[scopeId] = value
    }
    return next
  } catch {
    return {}
  }
}

export function saveRequiredProductionFteUnlockStore(store: RequiredProductionFteUnlockStore): void {
  localStorage.setItem(REQUIRED_PRODUCTION_FTE_UNLOCK_STORAGE_KEY, JSON.stringify(store))
}

export function isRequiredProductionFteUnlocked(scopeId: string): boolean {
  if (!scopeId) return false
  return loadRequiredProductionFteUnlockStore()[scopeId] === true
}

export function setRequiredProductionFteUnlocked(scopeId: string, unlocked: boolean): void {
  if (!scopeId) return
  const store = loadRequiredProductionFteUnlockStore()
  if (unlocked) store[scopeId] = true
  else delete store[scopeId]
  saveRequiredProductionFteUnlockStore(store)
}

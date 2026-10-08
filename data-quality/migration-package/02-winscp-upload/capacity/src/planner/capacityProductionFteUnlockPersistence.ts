/**
 * Per Client/LOB (scope) Production FTE unlock preference.
 *
 * Stored in capacity_documents so each planner's Lock/Unlock choice for a given
 * scope survives refresh and is not a browser-local layout flag. Mixed state is
 * allowed: one LOB unlocked while another stays locked.
 */

export const PRODUCTION_FTE_UNLOCK_STORAGE_KEY = 'wfp-capacity-production-fte-unlock-v1'

/** Map of Staffing Plan scopeId → unlocked. */
export type ProductionFteUnlockStore = Record<string, boolean>

export function loadProductionFteUnlockStore(): ProductionFteUnlockStore {
  try {
    const raw = localStorage.getItem(PRODUCTION_FTE_UNLOCK_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ProductionFteUnlockStore
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const next: ProductionFteUnlockStore = {}
    for (const [scopeId, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') next[scopeId] = value
    }
    return next
  } catch {
    return {}
  }
}

export function saveProductionFteUnlockStore(store: ProductionFteUnlockStore): void {
  localStorage.setItem(PRODUCTION_FTE_UNLOCK_STORAGE_KEY, JSON.stringify(store))
}

export function isProductionFteUnlocked(scopeId: string): boolean {
  if (!scopeId) return false
  return loadProductionFteUnlockStore()[scopeId] === true
}

export function setProductionFteUnlocked(scopeId: string, unlocked: boolean): void {
  if (!scopeId) return
  const store = loadProductionFteUnlockStore()
  if (unlocked) store[scopeId] = true
  else delete store[scopeId]
  saveProductionFteUnlockStore(store)
}

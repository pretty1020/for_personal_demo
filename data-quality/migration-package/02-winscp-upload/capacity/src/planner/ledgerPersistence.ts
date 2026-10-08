import type { ImportedActualOverride } from './weeklyLedger'

const STORAGE_KEY = 'wfp-ledger-actual-overrides-v1'

export type LedgerOverrideStore = Record<string, ImportedActualOverride[]>

export function loadLedgerOverrides(): LedgerOverrideStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as LedgerOverrideStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveLedgerOverrides(store: LedgerOverrideStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

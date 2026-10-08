import type { SupportRoleTemplate } from './supportRoles'

export type ScenarioSupportRoleStore = Record<string, SupportRoleTemplate[]>

const STORAGE_KEY = 'wfp-capacity-support-roles-v1'

export function loadSupportRoleStore(): ScenarioSupportRoleStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ScenarioSupportRoleStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveSupportRoleStore(store: ScenarioSupportRoleStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function clearScenarioSupportRoles(
  store: ScenarioSupportRoleStore,
  scenarioId: string,
): ScenarioSupportRoleStore {
  const next = { ...store }
  delete next[scenarioId]
  return next
}

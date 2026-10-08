import type { ShrinkageCategoryTemplate } from './shrinkageCategories'

export type ScenarioShrinkageCategoryStore = Record<string, ShrinkageCategoryTemplate[]>

const STORAGE_KEY = 'wfp-capacity-shrinkage-categories-v1'

export function loadShrinkageCategoryStore(): ScenarioShrinkageCategoryStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ScenarioShrinkageCategoryStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveShrinkageCategoryStore(store: ScenarioShrinkageCategoryStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function clearScenarioShrinkageCategories(
  store: ScenarioShrinkageCategoryStore,
  scenarioId: string,
): ScenarioShrinkageCategoryStore {
  const next = { ...store }
  delete next[scenarioId]
  return next
}

/** Per-stage weekly attrition rates (0–1) for training and nesting cohort stages. */
export type StageAttritionOverride = {
  training?: Record<number, number>
  nesting?: Record<number, number>
}

export type ScenarioStageAttritionStore = Record<string, StageAttritionOverride>

const STORAGE_KEY = 'wfp-capacity-stage-attrition-v1'

export function loadStageAttritionOverrides(): ScenarioStageAttritionStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ScenarioStageAttritionStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveStageAttritionOverrides(store: ScenarioStageAttritionStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function clearScenarioStageAttritionOverrides(
  store: ScenarioStageAttritionStore,
  scenarioId: string,
): ScenarioStageAttritionStore {
  const next = { ...store }
  delete next[scenarioId]
  return next
}

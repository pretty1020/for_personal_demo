const STORAGE_KEY = 'wfp-aht-analysis-overrides-v1'

export type AhtAnalysisOverrides = {
  nestingMultiplier?: number
  learningCurveWeeklyImprovementPct?: number
  /** Nesting handle time in seconds, for plans with no nesting history to measure. */
  nestingAhtSeconds?: number
  /** Share of contacts nesting handles, 0 to 1, when headcount does not imply it. */
  nestingContactShare?: number
  /** Weeks a nesting agent takes to reach production handle time. */
  nestingRampWeeks?: number
}

export type AhtAnalysisOverrideStore = Record<string, AhtAnalysisOverrides>

export function loadAhtAnalysisOverrides(): AhtAnalysisOverrideStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as AhtAnalysisOverrideStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveAhtAnalysisOverrides(store: AhtAnalysisOverrideStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function getScenarioAhtOverrides(scenarioId: string): AhtAnalysisOverrides {
  return loadAhtAnalysisOverrides()[scenarioId] ?? {}
}

export function clearScenarioAhtOverrides(
  store: AhtAnalysisOverrideStore,
  scenarioId: string,
): AhtAnalysisOverrideStore {
  const next = { ...store }
  delete next[scenarioId]
  return next
}

export function setScenarioAhtOverrides(scenarioId: string, overrides: AhtAnalysisOverrides): void {
  const store = loadAhtAnalysisOverrides()
  store[scenarioId] = overrides
  saveAhtAnalysisOverrides(store)
}

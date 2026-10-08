export const SHRINKAGE_FORECAST_METRIC_IDS = [
  'absenteeism',
  'aux_default',
  'meeting',
  'coaching',
  'training',
  'nesting',
  'calibration',
  'offline',
  'aux_other',
] as const

export type ForecastMetricId =
  | 'callVolume'
  | 'ahtSeconds'
  | 'occupancy'
  | 'totalShrinkagePct'
  | 'attritionHc'
  | (typeof SHRINKAGE_FORECAST_METRIC_IDS)[number]

export type ScenarioForecastOverrides = Partial<Record<ForecastMetricId, Record<number, number>>>
export type ForecastOverrideStore = Record<string, ScenarioForecastOverrides>

const STORAGE_KEY = 'wfp-forecast-overrides-v1'

export function loadForecastOverrides(): ForecastOverrideStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ForecastOverrideStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveForecastOverrides(store: ForecastOverrideStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  defaultDriverConfig,
  saveAdvancedForecasts,
  setDriverForecast,
} from './advancedForecastPersistence'
import { saveForecastModesStore } from './capacityForecastModesPersistence'
import {
  driverPlanApplyEqual,
  restoreDriverPlanApply,
  snapshotDriverPlanApply,
  syncForecastModeForAppliedDrivers,
} from './forecastPlanApply'

const SCENARIO = 'scenario-test-apply'

function installMemoryStorage() {
  const store = new Map<string, string>()
  const memory: Storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, String(value))
    },
    removeItem: (key) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memory })
}

beforeEach(() => {
  installMemoryStorage()
})

afterEach(() => {
  saveAdvancedForecasts({})
  saveForecastModesStore({})
})

describe('forecast plan apply snapshot', () => {
  it('treats missing drivers as not applied', () => {
    expect(driverPlanApplyEqual({}, { callVolume: { applyToCapacityPlan: false } })).toBe(true)
    expect(driverPlanApplyEqual({}, { callVolume: { applyToCapacityPlan: true } })).toBe(false)
  })

  it('restores apply flags and the pinned model', () => {
    setDriverForecast(SCENARIO, 'callVolume', {
      ...defaultDriverConfig('callVolume'),
      applyToCapacityPlan: true,
      selectedModelId: 'linear-trend',
      results: [
        {
          id: 'linear-trend',
          label: 'Linear trend',
          success: true,
          forecast: [],
          historicalPredictions: [],
          accuracy: {},
          parameters: {},
          weekly: [{ week: '2026-08-16', value: 100, days: 7 }],
        },
      ],
    })
    restoreDriverPlanApply(SCENARIO, {
      callVolume: { applyToCapacityPlan: false, selectedModelId: 'seasonal-naive' },
    })
    const snap = snapshotDriverPlanApply(SCENARIO)
    expect(snap.callVolume).toEqual({
      applyToCapacityPlan: false,
      selectedModelId: 'seasonal-naive',
    })
  })

  it('pins applied drivers onto forecast mode', () => {
    setDriverForecast(SCENARIO, 'callVolume', {
      ...defaultDriverConfig('callVolume'),
      applyToCapacityPlan: true,
      selectedModelId: 'linear-trend',
      results: [
        {
          id: 'linear-trend',
          label: 'Linear trend',
          success: true,
          forecast: [],
          historicalPredictions: [],
          accuracy: {},
          parameters: {},
          weekly: [{ week: '2026-08-16', value: 100, days: 7 }],
        },
      ],
    })
    const modes = syncForecastModeForAppliedDrivers(SCENARIO, { callVolume: 'manual' })
    expect(modes.callVolume).toBe('forecast')
  })
})

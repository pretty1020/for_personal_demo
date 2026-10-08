import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearSnapshots,
  getSnapshots,
  recordSnapshot,
  scoreSnapshot,
  type ForecastSnapshot,
} from './forecastLog'

/**
 * The forecast track record.
 *
 * This is the only measure that reflects the forecast a plan was actually built
 * on — the model that was chosen and the judgment applied — rather than a model
 * refitted against history it already knows.
 */

const SCENARIO = 's1'
const METRIC = 'callVolume'

function snapshot(overrides: Partial<Omit<ForecastSnapshot, 'id'>> = {}) {
  return {
    takenAt: '2026-01-05T09:00:00.000Z',
    scenarioId: SCENARIO,
    metricId: METRIC,
    modelId: 'holt-winters',
    modelLabel: 'Holt-Winters',
    adjusted: false,
    values: { '2026-01-11': 1000, '2026-01-18': 1100 },
    ...overrides,
  }
}

// The suite runs in Node, which has no localStorage. A minimal in-memory stand
// -in keeps the module under test unchanged rather than bending it for the test.
class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string) {
    return this.store.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.store.set(key, value)
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
  clear() {
    this.store.clear()
  }
}

beforeEach(() => {
  ;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()
})

describe('recordSnapshot', () => {
  it('keeps what was forecast, by scenario and driver', () => {
    recordSnapshot(snapshot())
    const stored = getSnapshots(SCENARIO, METRIC)
    expect(stored).toHaveLength(1)
    expect(stored[0]!.values['2026-01-11']).toBe(1000)
    // Another driver has its own history.
    expect(getSnapshots(SCENARIO, 'ahtSeconds')).toEqual([])
  })

  it('replaces same-day applications rather than stacking them', () => {
    // Adjusting an event three times in an afternoon produced one forecast that
    // day, not three; keeping all of them buries the history that matters.
    recordSnapshot(snapshot({ values: { '2026-01-11': 1000 } }))
    recordSnapshot(snapshot({ takenAt: '2026-01-05T15:00:00.000Z', values: { '2026-01-11': 1200 } }))
    const stored = getSnapshots(SCENARIO, METRIC)
    expect(stored).toHaveLength(1)
    expect(stored[0]!.values['2026-01-11']).toBe(1200)
  })

  it('keeps separate days apart, oldest first', () => {
    recordSnapshot(snapshot({ takenAt: '2026-01-05T09:00:00.000Z' }))
    recordSnapshot(snapshot({ takenAt: '2026-01-12T09:00:00.000Z' }))
    const stored = getSnapshots(SCENARIO, METRIC)
    expect(stored).toHaveLength(2)
    expect(stored[0]!.takenAt < stored[1]!.takenAt).toBe(true)
  })

  it('bounds the log so it cannot exhaust storage', () => {
    for (let i = 1; i <= 20; i++) {
      recordSnapshot(snapshot({ takenAt: `2026-02-${String(i).padStart(2, '0')}T09:00:00.000Z` }))
    }
    expect(getSnapshots(SCENARIO, METRIC).length).toBeLessThanOrEqual(12)
  })

  it('clears a driver without touching the others', () => {
    recordSnapshot(snapshot())
    recordSnapshot(snapshot({ metricId: 'ahtSeconds' }))
    clearSnapshots(SCENARIO, METRIC)
    expect(getSnapshots(SCENARIO, METRIC)).toEqual([])
    expect(getSnapshots(SCENARIO, 'ahtSeconds')).toHaveLength(1)
  })
})

describe('scoreSnapshot', () => {
  it('scores only the weeks that have actually happened', () => {
    const actuals = new Map([['2026-01-11', 1100]])
    const result = scoreSnapshot({ ...snapshot(), id: 'x' }, actuals)
    expect(result.matured).toBe(1)
    // The second week has no actual yet — pending, not counted as an error.
    expect(result.pending).toBe(1)
    expect(result.score.wape).toBeCloseTo(9.09, 1)
  })

  it('reports the forecast as running low when it was', () => {
    const actuals = new Map([['2026-01-11', 1200], ['2026-01-18', 1300]])
    const result = scoreSnapshot({ ...snapshot(), id: 'x' }, actuals)
    expect(result.score.bias).toBeLessThan(0)
    expect(result.matured).toBe(2)
    expect(result.pending).toBe(0)
  })

  it('returns no score when nothing has matured', () => {
    const result = scoreSnapshot({ ...snapshot(), id: 'x' }, new Map())
    expect(result.matured).toBe(0)
    expect(result.score).toEqual({})
  })

  it('ignores a week whose actual is not a usable number', () => {
    const actuals = new Map([['2026-01-11', Number.NaN], ['2026-01-18', 1100]])
    const result = scoreSnapshot({ ...snapshot(), id: 'x' }, actuals)
    expect(result.matured).toBe(1)
  })
})

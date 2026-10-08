import { describe, expect, it } from 'vitest'
import {
  aggregationForUnit,
  buildAccuracySplit,
  buildForecastRows,
  readValue,
} from './forecastChartData'
import type { StoredWfmModel } from './advancedForecastPersistence'

/** Daily points across `count` days from `start`. */
function daily(start: string, count: number, value: number) {
  const first = new Date(`${start}T12:00:00`)
  return Array.from({ length: count }, (_, i) => {
    const day = new Date(first)
    day.setDate(day.getDate() + i)
    return { date: day.toISOString().slice(0, 10), value }
  })
}

function model(overrides: Partial<StoredWfmModel> = {}): StoredWfmModel {
  return {
    id: 'xgboost',
    label: 'XGBoost',
    success: true,
    forecast: [],
    historicalPredictions: [],
    accuracy: {},
    parameters: {},
    weekly: [],
    ...overrides,
  }
}

describe('readValue', () => {
  it('reads whichever key a model used', () => {
    // The scripts disagree: moving average emits `predicted`, Prophet `yhat`.
    expect(readValue({ value: 5 })).toBe(5)
    expect(readValue({ predicted: 7 })).toBe(7)
    expect(readValue({ yhat: 9 })).toBe(9)
    expect(readValue({ other: 1 })).toBeNull()
    expect(readValue(null)).toBeNull()
  })
})

describe('buildForecastRows', () => {
  const base = {
    model: null,
    weekStart: 'sunday' as const,
    aggregation: 'sum' as const,
  }

  it('keeps daily data one row per day', () => {
    const rows = buildForecastRows({ ...base, history: daily('2026-03-01', 5, 10), grain: 'daily' })
    expect(rows).toHaveLength(5)
    expect(rows[0]!.historical).toBe(10)
    expect(rows[0]!.weekday).toBeTruthy()
  })

  it('sums counts into weekly buckets', () => {
    // 2026-03-01 is a Sunday, so this is exactly two whole weeks.
    const rows = buildForecastRows({ ...base, history: daily('2026-03-01', 14, 10), grain: 'weekly' })
    expect(rows.map((row) => row.historical)).toEqual([70, 70])
  })

  it('averages rates instead of summing them', () => {
    const rows = buildForecastRows({
      ...base,
      history: daily('2026-03-01', 7, 300),
      grain: 'weekly',
      aggregation: 'mean',
    })
    // Five 300-second days make a 300-second week, not a 1500-second one.
    expect(rows[0]!.historical).toBe(300)
  })

  it('blanks a partial bucket at the edge so it does not draw as a cliff', () => {
    // Starts on a Wednesday: the first week holds only 4 days.
    const rows = buildForecastRows({ ...base, history: daily('2026-03-04', 11, 10), grain: 'weekly' })
    expect(rows[0]!.historicalDays).toBe(4)
    expect(rows[0]!.historical).toBeNull()
    expect(rows[1]!.historical).toBe(70)
  })

  it('tolerates a bucket missing a single day', () => {
    // A 30-of-31-day month is complete enough to plot.
    const points = daily('2026-03-01', 30, 10)
    const rows = buildForecastRows({ ...base, history: points, grain: 'monthly' })
    expect(rows[0]!.historical).toBe(300)
  })

  it('does not blank partial edges for averaged rates', () => {
    const rows = buildForecastRows({
      ...base,
      history: daily('2026-03-04', 11, 300),
      grain: 'weekly',
      aggregation: 'mean',
    })
    expect(rows[0]!.historical).toBe(300)
  })

  it('leaves interior gaps visible', () => {
    // A missing middle week is real absent data, not an edge artefact.
    const points = [...daily('2026-03-01', 7, 10), ...daily('2026-03-15', 7, 10)]
    const rows = buildForecastRows({ ...base, history: points, grain: 'weekly' })
    expect(rows.map((row) => row.historical)).toEqual([70, null, 70])
  })

  it('separates forecast from history and marks future buckets', () => {
    const rows = buildForecastRows({
      ...base,
      history: daily('2026-03-01', 7, 10),
      model: model({ forecast: daily('2026-03-08', 7, 20).map((p) => ({ date: p.date, predicted: 20 })) }),
      grain: 'weekly',
    })
    expect(rows[0]!.historical).toBe(70)
    expect(rows[0]!.isFuture).toBe(false)
    expect(rows[1]!.forecast).toBe(140)
    expect(rows[1]!.isFuture).toBe(true)
  })

  it('attaches holidays and anomalies to their bucket', () => {
    const rows = buildForecastRows({
      ...base,
      history: daily('2026-03-01', 7, 10),
      grain: 'daily',
      holidays: [{ date: '2026-03-03', name: 'Test Day', week: '2026-03-01', weekday: 'Tuesday' }],
      anomalies: [{ date: '2026-03-05', original: 999, value: 10, reason: 'spike' }],
    })
    expect(rows.find((row) => row.key === '2026-03-03')!.holiday).toBe('Test Day')
    expect(rows.find((row) => row.key === '2026-03-05')!.anomaly?.reason).toBe('spike')
  })

  it('honours a Monday week anchor', () => {
    const rows = buildForecastRows({
      ...base,
      history: daily('2026-03-02', 7, 10),
      grain: 'weekly',
      weekStart: 'monday',
    })
    expect(rows[0]!.key).toBe('2026-03-02')
    expect(rows[0]!.historical).toBe(70)
  })
})

describe('buildAccuracySplit', () => {
  it('puts the test window at the tail of the historical rows', () => {
    const rows = buildForecastRows({
      history: daily('2026-01-01', 100, 10),
      model: model({ forecast: daily('2026-04-11', 10, 12).map((p) => ({ date: p.date, predicted: 12 })) }),
      grain: 'daily',
      weekStart: 'sunday',
      aggregation: 'sum',
    })
    const split = buildAccuracySplit(rows, '90/10')
    expect(split.forecastStartIndex).toBe(100)
    expect(split.testStartIndex).toBe(90)
  })

  it('follows the chosen split', () => {
    const rows = buildForecastRows({
      history: daily('2026-01-01', 100, 10),
      model: null,
      grain: 'daily',
      weekStart: 'sunday',
      aggregation: 'sum',
    })
    expect(buildAccuracySplit(rows, '70/30').testStartIndex).toBe(70)
  })
})

describe('aggregationForUnit', () => {
  it('adds counts and averages rates', () => {
    expect(aggregationForUnit('callVolume', 'number')).toBe('sum')
    expect(aggregationForUnit('attritionHc', 'number')).toBe('sum')
    expect(aggregationForUnit('ahtSeconds', 'seconds')).toBe('mean')
    expect(aggregationForUnit('totalShrinkagePct', 'percent')).toBe('mean')
  })
})


describe('empty-history guard', () => {
  it('slice(-0) returns the whole array — the trap this guards against', () => {
    // Documents why callers must short-circuit on a zero-length actual series:
    // a driver with no actuals would otherwise be handed every history week.
    const weeks = ['2026-01-04', '2026-01-11', '2026-01-18']
    expect(weeks.slice(-0)).toEqual(weeks)
    expect(weeks.slice(-2)).toEqual(['2026-01-11', '2026-01-18'])
  })

  it('builds no rows from an empty history', () => {
    const rows = buildForecastRows({
      history: [],
      model: null,
      grain: 'weekly',
      weekStart: 'sunday',
      aggregation: 'sum',
    })
    expect(rows).toEqual([])
  })
})

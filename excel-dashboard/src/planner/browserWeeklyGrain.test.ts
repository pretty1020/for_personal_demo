import { describe, expect, it } from 'vitest'
import { runBrowserWfmForecast } from './browserWfmForecast'
import type { WfmForecastRequest } from '../data/forecastApiClient'

/**
 * Forecasting is weekly throughout, because the Capacity Plan is.
 *
 * Anything finer is aggregated before a model sees it, which removes the whole
 * class of grain-mismatch problems: no partial-week arithmetic, no horizon
 * counted in the wrong unit, and no rollup after the fact.
 */

const DAY_MS = 86_400_000

/** `count` daily points from a Sunday, so whole weeks line up. */
function daily(count: number, value = 100, from = '2026-01-04'): Array<{ date: string; value: number }> {
  const start = new Date(`${from}T12:00:00`).getTime()
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(start + i * DAY_MS).toISOString().slice(0, 10),
    value,
  }))
}

function weeksFrom(iso: string, count: number): string[] {
  const start = new Date(`${iso}T12:00:00`).getTime()
  return Array.from({ length: count }, (_, i) => new Date(start + i * 7 * DAY_MS).toISOString().slice(0, 10))
}

function request(overrides: Partial<WfmForecastRequest>): WfmForecastRequest {
  return {
    data: daily(140),
    horizon: 4,
    models: ['simple-moving-average'],
    testSplit: '90/10',
    weekStart: 'sunday',
    targetWeeks: weeksFrom('2026-05-24', 4),
    metricId: 'callVolume',
    metricUnit: 'number',
    ...overrides,
  } as WfmForecastRequest
}

describe('weekly grain', () => {
  it('reports weekly regardless of the input grain', () => {
    expect(runBrowserWfmForecast(request({})).interval).toBe('weekly')
  })

  it('sums a daily count into weekly totals', () => {
    // 20 whole weeks of 100/day should become 20 weeks of 700.
    const result = runBrowserWfmForecast(request({ data: daily(140, 100) }))
    const model = result.models.find((m) => m.success)!
    expect(model.weekly.every((row) => Math.abs(row.value - 700) < 1e-6)).toBe(true)
  })

  it('averages a rate rather than summing it', () => {
    // Seven days at 6% is a 6% week, not a 42% one.
    const result = runBrowserWfmForecast(
      request({ data: daily(140, 0.06), metricId: 'absenteeism', metricUnit: 'percent' }),
    )
    const model = result.models.find((m) => m.success)!
    expect(model.weekly.every((row) => row.value < 0.1)).toBe(true)
  })

  it('drops a partial week at the edges so it does not read as a collapse', () => {
    // Start mid-week: the first bucket holds 3 days and would sum to 300
    // against 700 for every full week.
    const result = runBrowserWfmForecast(request({ data: daily(140, 100, '2026-01-07') }))
    const model = result.models.find((m) => m.success)!
    expect(model.success).toBe(true)
    expect(model.weekly.every((row) => Math.abs(row.value - 700) < 1e-6)).toBe(true)
  })

  it('covers every requested plan week from a daily source', () => {
    const targetWeeks = weeksFrom('2026-05-24', 8)
    const result = runBrowserWfmForecast(request({ horizon: 8, targetWeeks }))
    const model = result.models.find((m) => m.success)!
    expect(model.weekly.map((row) => row.week)).toEqual(targetWeeks)
  })

  it('treats an already-weekly series unchanged', () => {
    const weekly = weeksFrom('2026-01-04', 20).map((date) => ({ date, value: 700 }))
    const result = runBrowserWfmForecast(request({ data: weekly }))
    const model = result.models.find((m) => m.success)!
    expect(model.weekly.every((row) => Math.abs(row.value - 700) < 1e-6)).toBe(true)
  })
})

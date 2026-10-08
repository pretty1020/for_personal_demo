import { describe, expect, it } from 'vitest'
import { runBrowserWfmForecast } from './browserWfmForecast'

function weeklySeries(values: number[], start = '2026-01-04'): { date: string; value: number }[] {
  return values.map((value, index) => {
    const date = new Date(`${start}T12:00:00`)
    date.setDate(date.getDate() + index * 7)
    return { date: date.toISOString().slice(0, 10), value }
  })
}

describe('runBrowserWfmForecast', () => {
  it('fits moving average and exponential smoothing without the Python service', () => {
    const history = weeklySeries(Array.from({ length: 24 }, (_, i) => 1000 + i * 12))
    const targetWeeks = weeklySeries([0, 0, 0, 0], '2026-06-21').map((point) => point.date)
    const result = runBrowserWfmForecast({
      data: history,
      horizon: 8,
      models: ['seasonal-naive', 'linear-trend', 'exponential-smoothing', 'simple-moving-average'],
      testSplit: '80/20',
      weekStart: 'sunday',
      targetWeeks,
      metricId: 'callVolume',
      metricUnit: 'number',
    })

    expect(result.models.some((model) => model.id === 'simple-moving-average' && model.success)).toBe(true)
    expect(result.models.some((model) => model.id === 'exponential-smoothing' && model.success)).toBe(true)
    expect(result.models.some((model) => model.id === 'linear-trend' && model.success)).toBe(true)
    // Seasonal naive repeats last year's weeks, so 24 weeks cannot support it.
    // It is reported as needing more history rather than quietly falling back to
    // a non-seasonal forecast under a seasonal label.
    const seasonal = result.models.find((model) => model.id === 'seasonal-naive')!
    expect(seasonal.success).toBe(false)
    expect(seasonal.error).toMatch(/more history/i)

    const best = result.models.find((model) => model.success)
    expect(best?.weekly.length).toBeGreaterThan(0)
    expect(best?.forecast.length).toBeGreaterThan(0)
  })

  it('fits seasonal naive once there is more than a year of weeks', () => {
    // A 52-week cycle needs the *training* slice to clear 52 weeks, and the
    // holdout is carved out of the series first — so about 70 weeks is the
    // real floor, not 56.
    const history = weeklySeries(
      Array.from({ length: 70 }, (_, i) => 1000 + 200 * Math.sin((2 * Math.PI * i) / 52)),
    )
    const targetWeeks = weeklySeries([0, 0, 0, 0], '2027-03-07').map((point) => point.date)
    const result = runBrowserWfmForecast({
      data: history,
      horizon: 4,
      models: ['seasonal-naive'],
      testSplit: '90/10',
      weekStart: 'sunday',
      targetWeeks,
      metricId: 'callVolume',
      metricUnit: 'number',
    })
    const seasonal = result.models.find((model) => model.id === 'seasonal-naive')!
    expect(seasonal.success).toBe(true)
    // The cycle is the year, not seven steps.
    expect(String(seasonal.parameters.method)).toContain('52')
  })
})

describe('model ranking', () => {
  /**
   * The top row drives the plan unless a planner intervenes, so it must agree
   * with the column the table leads on. Ranking once ran on MAPE while the UI
   * presented WAPE, which could recommend a model the scoreboard argued against.
   */
  it('ranks by WAPE, the measure the scoreboard leads with', () => {
    const history = weeklySeries(
      Array.from({ length: 60 }, (_, i) => 1000 + i * 8 + Math.sin((2 * Math.PI * i) / 13) * 120),
    )
    const targetWeeks = weeklySeries(new Array(8).fill(0), '2027-03-07').map((point) => point.date)

    const result = runBrowserWfmForecast({
      data: history,
      horizon: 8,
      models: ['holt-winters', 'theta', 'linear-trend', 'simple-moving-average'],
      testSplit: '80/20',
      weekStart: 'sunday',
      targetWeeks,
      metricId: 'callVolume',
      metricUnit: 'number',
    })

    const scored = result.models.filter((model) => model.success && model.accuracy.wape != null)
    expect(scored.length).toBeGreaterThan(1)

    const wapes = scored.map((model) => model.accuracy.wape!)
    expect(wapes).toEqual([...wapes].sort((a, b) => a - b))
  })

  it('puts models that failed to fit below every model that scored', () => {
    const history = weeklySeries(Array.from({ length: 20 }, (_, i) => 900 + i * 5))
    const targetWeeks = weeklySeries(new Array(4).fill(0), '2026-06-21').map((point) => point.date)

    const result = runBrowserWfmForecast({
      data: history,
      horizon: 4,
      // Seasonal naive needs a year of weeks and cannot fit on 20.
      models: ['theta', 'seasonal-naive', 'simple-moving-average'],
      testSplit: '80/20',
      weekStart: 'sunday',
      targetWeeks,
      metricId: 'callVolume',
      metricUnit: 'number',
    })

    const firstFailure = result.models.findIndex((model) => !model.success)
    if (firstFailure >= 0) {
      expect(result.models.slice(firstFailure).every((model) => !model.success)).toBe(true)
    }
  })

  it('reports pattern metrics once enough weeks have been scored', () => {
    const history = weeklySeries(
      Array.from({ length: 90 }, (_, i) => 1000 + Math.sin((2 * Math.PI * i) / 13) * 200),
    )
    const targetWeeks = weeklySeries(new Array(8).fill(0), '2027-10-03').map((point) => point.date)

    const result = runBrowserWfmForecast({
      data: history,
      horizon: 8,
      models: ['holt-winters', 'theta'],
      testSplit: '80/20',
      weekStart: 'sunday',
      targetWeeks,
      metricId: 'callVolume',
      metricUnit: 'number',
    })

    const scored = result.models.filter((model) => model.success)
    expect(scored.length).toBeGreaterThan(0)
    for (const model of scored) {
      if ((model.accuracy.test_samples ?? 0) >= 8) {
        expect(model.accuracy.pattern_r).toBeDefined()
        expect(model.accuracy.amplitude_ratio).toBeDefined()
      }
    }
  })
})

/**
 * Forecasting at daily grain.
 *
 * Weekly is the plan's grain and the only one it can consume. Daily exists to
 * read what a week averages away — the day-of-week shape — and must be
 * structurally unable to reach the Capacity Plan rather than merely discouraged
 * from it, because a ledger of weeks has no row to put a Tuesday in.
 */
describe('daily grain', () => {
  const dailySeries = (count: number, start = '2026-01-05') =>
    Array.from({ length: count }, (_, i) => {
      const date = new Date(`${start}T12:00:00Z`)
      date.setUTCDate(date.getUTCDate() + i)
      // A clear weekday shape: quiet at the weekend.
      const weekday = date.getUTCDay()
      const weekendDip = weekday === 0 || weekday === 6 ? 0.45 : 1
      return { date: date.toISOString().slice(0, 10), value: Math.round(900 * weekendDip) }
    })

  const run = (grain: 'weekly' | 'daily', days = 140) =>
    runBrowserWfmForecast({
      data: dailySeries(days),
      horizon: grain === 'daily' ? 28 : 4,
      models: ['holt-winters', 'theta', 'simple-moving-average'],
      testSplit: '80/20',
      weekStart: 'sunday',
      targetWeeks: weeklySeries(new Array(4).fill(0), '2026-05-31').map((point) => point.date),
      metricId: 'callVolume',
      metricUnit: 'number',
      grain,
    })

  it('reports the grain it fitted at', () => {
    expect(run('daily').interval).toBe('daily')
    expect(run('weekly').interval).toBe('weekly')
  })

  it('returns daily points rather than plan weeks', () => {
    const model = run('daily').models.find((m) => m.success)!
    expect(model.forecast.length).toBeGreaterThan(7)
    const dates = model.forecast.map((point) => point.date as string)
    const gap =
      new Date(`${dates[1]}T00:00:00Z`).getTime() - new Date(`${dates[0]}T00:00:00Z`).getTime()
    expect(gap).toBe(24 * 3600 * 1000)
  })

  it('leaves nothing the Capacity Plan could consume', () => {
    for (const model of run('daily').models.filter((m) => m.success)) {
      // The plan reads `weekly` and only `weekly`.
      expect(model.weekly, model.label).toEqual([])
    }
  })

  it('still fills plan weeks when fitting weekly', () => {
    const model = run('weekly').models.find((m) => m.success)!
    expect(model.weekly.length).toBeGreaterThan(0)
  })

  it('finds the weekday shape a weekly fit averages away', () => {
    const model = run('daily').models.find((m) => m.id === 'holt-winters' && m.success)
    if (!model) return
    const values = model.forecast.slice(0, 14).map((point) => Number(point.value))
    // A weekend dip means the fortnight cannot be flat.
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(50)
  })

  it('keeps daily values inside the range the driver can take', () => {
    for (const model of run('daily').models.filter((m) => m.success)) {
      for (const point of model.forecast) {
        expect(Number.isFinite(Number(point.value))).toBe(true)
      }
    }
  })
})

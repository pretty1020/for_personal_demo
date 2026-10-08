import { describe, expect, it } from 'vitest'
import { holtWinters, seasonalPeriodFor, theta } from './browserSeasonalModels'

/**
 * Holt-Winters and Theta.
 *
 * These exist to model seasonality that seasonal-naive and linear-trend cannot,
 * so the tests check they actually recover a known cycle and trend rather than
 * merely returning numbers.
 */

/** A seasonal series with a known cycle, trend and multiplicative shape. */
function seasonalSeries(cycles: number, period: number, base = 1000, growth = 0.004): number[] {
  const shape = Array.from({ length: period }, (_, i) => 1 + 0.35 * Math.sin((2 * Math.PI * i) / period))
  return Array.from({ length: cycles * period }, (_, i) => base * (1 + growth * i) * shape[i % period]!)
}

describe('seasonalPeriodFor', () => {
  it('uses the natural cycle of each grain', () => {
    expect(seasonalPeriodFor('daily', 400)).toBe(7)
    expect(seasonalPeriodFor('weekly', 200)).toBe(52)
    expect(seasonalPeriodFor('monthly', 60)).toBe(12)
  })

  it('returns 0 when the series cannot show the cycle twice', () => {
    // One year of weekly data cannot evidence an annual cycle.
    expect(seasonalPeriodFor('weekly', 52)).toBe(0)
    expect(seasonalPeriodFor('daily', 13)).toBe(0)
    expect(seasonalPeriodFor('monthly', 23)).toBe(0)
  })
})

describe('holtWinters', () => {
  it('recovers a seasonal cycle it has seen', () => {
    const y = seasonalSeries(6, 7)
    const fit = holtWinters(y, 7, 14)!
    expect(fit).not.toBeNull()
    expect(fit.horizon).toHaveLength(14)

    // The next fortnight should repeat the known shape, so the peak of each
    // forecast week lands on the same slot as the peak of the history.
    const peakSlot = (values: number[]) =>
      values.indexOf(Math.max(...values)) % 7
    expect(peakSlot(fit.horizon.slice(0, 7))).toBe(peakSlot(y.slice(-7)))
  })

  it('follows the trend rather than flattening it', () => {
    const y = seasonalSeries(6, 7)
    const fit = holtWinters(y, 7, 7)!
    const meanOf = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length
    // Rising history, so the next cycle should sit above the last one.
    expect(meanOf(fit.horizon)).toBeGreaterThan(meanOf(y.slice(-7)))
  })

  it('falls back to a trend-only fit when there is no cycle to model', () => {
    const y = Array.from({ length: 30 }, (_, i) => 500 + i * 3)
    const fit = holtWinters(y, 0, 5)!
    expect(fit.label).toContain('trend only')
    expect(fit.horizon[4]!).toBeGreaterThan(fit.horizon[0]!)
  })

  it('picks additive seasonality when values are not all positive', () => {
    // Multiplicative is undefined through zero, so it must not be chosen.
    const y = Array.from({ length: 28 }, (_, i) => (i % 7) - 3)
    const fit = holtWinters(y, 7, 7)
    expect(fit).not.toBeNull()
    expect(fit!.label).not.toContain('multiplicative')
    expect(fit!.horizon.every((v) => Number.isFinite(v))).toBe(true)
  })

  it('returns null rather than a diverged fit on too little data', () => {
    expect(holtWinters([1, 2, 3], 7, 5)).toBeNull()
    expect(holtWinters([1, 2, Number.NaN, 4, 5, 6, 7], 0, 3)).toBeNull()
  })

  it('produces one fitted value per input point', () => {
    const y = seasonalSeries(4, 7)
    const fit = holtWinters(y, 7, 3)!
    expect(fit.fitted).toHaveLength(y.length)
  })
})

describe('theta', () => {
  it('extends half the linear drift, not all of it and not none', () => {
    // A clean upward line: Theta should keep rising, but more conservatively
    // than a straight extrapolation of the full slope.
    const y = Array.from({ length: 40 }, (_, i) => 100 + i * 10)
    const fit = theta(y, 0, 10)!
    const last = y[y.length - 1]!
    expect(fit.horizon[0]!).toBeGreaterThan(last)
    // Full-slope extrapolation ten steps out would be last + 100.
    expect(fit.horizon[9]!).toBeLessThan(last + 100)
    expect(fit.horizon[9]!).toBeGreaterThan(last)
  })

  it('reseasonalises its forecast', () => {
    const y = seasonalSeries(6, 7)
    const fit = theta(y, 7, 7)!
    // A seasonal forecast must vary within the cycle, not sit flat.
    const spread = Math.max(...fit.horizon) - Math.min(...fit.horizon)
    expect(spread).toBeGreaterThan(0.1 * Math.max(...fit.horizon))
  })

  it('handles a flat series without dividing by zero', () => {
    const y = new Array(30).fill(0)
    const fit = theta(y, 7, 5)
    expect(fit).not.toBeNull()
    expect(fit!.horizon.every((v) => Number.isFinite(v))).toBe(true)
  })

  it('returns null on unusable input', () => {
    expect(theta([1, 2], 0, 5)).toBeNull()
    expect(theta([1, 2, 3, Number.POSITIVE_INFINITY, 5, 6], 0, 3)).toBeNull()
  })

  it('produces one fitted value per input point', () => {
    const y = seasonalSeries(4, 7)
    const fit = theta(y, 7, 3)!
    expect(fit.fitted).toHaveLength(y.length)
  })
})

describe('accuracy against the simpler models', () => {
  /** Mean absolute percentage error of a forecast against known future values. */
  function mape(actual: number[], predicted: number[]): number {
    const pairs = actual.map((a, i) => ({ a, p: predicted[i]! })).filter((x) => Math.abs(x.a) > 1e-9)
    return (pairs.reduce((s, x) => s + Math.abs((x.a - x.p) / x.a), 0) / pairs.length) * 100
  }

  it('beats a flat carry-forward on a seasonal trending series', () => {
    // Hold back the final cycle and forecast it.
    const full = seasonalSeries(8, 7)
    const train = full.slice(0, -7)
    const future = full.slice(-7)

    const hw = holtWinters(train, 7, 7)!
    const th = theta(train, 7, 7)!
    const flat = new Array(7).fill(train[train.length - 1]!)

    const flatError = mape(future, flat)
    expect(mape(future, hw.horizon)).toBeLessThan(flatError)
    expect(mape(future, th.horizon)).toBeLessThan(flatError)
  })

  it('gets a seasonal series close, not merely closer', () => {
    const full = seasonalSeries(8, 7)
    const hw = holtWinters(full.slice(0, -7), 7, 7)!
    // A clean synthetic cycle should be recovered to within a few percent.
    expect(mape(full.slice(-7), hw.horizon)).toBeLessThan(5)
  })
})

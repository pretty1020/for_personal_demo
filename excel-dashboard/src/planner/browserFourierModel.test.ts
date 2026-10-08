import { describe, expect, it } from 'vitest'
import { fourierHolidayModel } from './browserFourierModel'

/**
 * Trend + Fourier seasonality + holiday effects.
 *
 * The tests focus on the two things that make this model worth having — that it
 * learns a named holiday's effect, and that it does not run away on a long
 * horizon — plus the threshold bug that once cost it a factor of four in error.
 */

const DAY_MS = 86_400_000

function dates(from: string, count: number): string[] {
  const start = new Date(`${from}T12:00:00`).getTime()
  return Array.from({ length: count }, (_, i) => new Date(start + i * DAY_MS).toISOString().slice(0, 10))
}

/** Daily demand with weekday shape, a yearly swing and mild growth. */
function dailySeries(count: number, from = '2024-01-01'): { dates: string[]; y: number[] } {
  const d = dates(from, count)
  const weekday = [0.45, 1.18, 1.09, 1.02, 0.98, 0.94, 0.52]
  const y = d.map((iso, i) => {
    const day = new Date(`${iso}T12:00:00`).getDay()
    const yearly = 1 + 0.15 * Math.sin((2 * Math.PI * i) / 365.25)
    return 1000 * weekday[day]! * yearly * (1 + 0.0002 * i)
  })
  return { dates: d, y }
}

function mape(actual: number[], predicted: number[]): number {
  return (
    (actual.reduce((s, a, i) => s + Math.abs((a - predicted[i]!) / a), 0) / actual.length) * 100
  )
}

describe('fourierHolidayModel', () => {
  it('recovers a weekday and yearly shape', () => {
    const { dates: d, y } = dailySeries(700)
    const future = dates('2025-12-01', 28)
    const fit = fourierHolidayModel(y, 28, { dates: d, futureDates: future, grain: 'daily' })!
    expect(fit).not.toBeNull()
    expect(fit.horizon).toHaveLength(28)
    expect(fit.label).toContain('harmonics')
    // Sunday is the quiet day in this shape; the forecast must reproduce that.
    const sundays = fit.horizon.filter((_, i) => new Date(`${future[i]}T12:00:00`).getDay() === 0)
    const mondays = fit.horizon.filter((_, i) => new Date(`${future[i]}T12:00:00`).getDay() === 1)
    expect(Math.min(...mondays)).toBeGreaterThan(Math.max(...sundays))
  })

  it('fits the annual cycle once there is a year and a half of data', () => {
    // Requiring two full years excluded the yearly term from a 700-day series,
    // and the model absorbed a real annual swing into its trend instead — 22%
    // error against 5% once the cycle was allowed.
    const { dates: d, y } = dailySeries(700)
    const future = dates('2025-12-01', 28)
    const fit = fourierHolidayModel(y, 28, { dates: d, futureDates: future, grain: 'daily' })!
    // 3 weekly harmonics + 6 yearly = 9.
    expect(fit.label).toContain('9 harmonics')
  })

  it('omits the annual cycle when the series is too short to show it', () => {
    const { dates: d, y } = dailySeries(200)
    const future = dates('2024-07-19', 14)
    const fit = fourierHolidayModel(y, 14, { dates: d, futureDates: future, grain: 'daily' })!
    expect(fit.label).toContain('3 harmonics')
  })

  it('learns what a holiday does', () => {
    const { dates: d, y } = dailySeries(700)
    // Halve demand on one recurring date, and tell the model when it falls.
    const holidayDates = d.filter((iso) => iso.endsWith('-12-25'))
    const holidays = new Map(holidayDates.map((iso) => [iso, ['Christmas Day']]))
    const withHoliday = y.map((value, i) => (holidayDates.includes(d[i]!) ? value * 0.5 : value))

    const future = dates('2025-12-15', 20)
    const holidaysAll = new Map(holidays)
    holidaysAll.set('2025-12-25', ['Christmas Day'])

    const fit = fourierHolidayModel(withHoliday, 20, {
      dates: d,
      futureDates: future,
      grain: 'daily',
      holidays: holidaysAll,
    })!
    expect(fit.label).toContain('holiday terms')

    // The forecast for 25 December must sit well below its neighbours.
    const index = future.indexOf('2025-12-25')
    expect(index).toBeGreaterThan(0)
    const neighbours = [fit.horizon[index - 1]!, fit.horizon[index + 1]!]
    expect(fit.horizon[index]!).toBeLessThan(Math.min(...neighbours) * 0.8)
  })

  it('does not run away over a long horizon', () => {
    // A piecewise trend extrapolating its final slope compounds error with
    // distance; damping keeps a year-ahead forecast in the same world as the data.
    const { dates: d, y } = dailySeries(700)
    const future = dates('2025-12-01', 365)
    const fit = fourierHolidayModel(y, 365, { dates: d, futureDates: future, grain: 'daily' })!
    const historyMax = Math.max(...y)
    expect(Math.max(...fit.horizon)).toBeLessThan(historyMax * 2)
    expect(Math.min(...fit.horizon)).toBeGreaterThan(0)
  })

  it('forecasts a seasonal series accurately', () => {
    const { dates: d, y } = dailySeries(728)
    const train = y.slice(0, -28)
    const trainDates = d.slice(0, -28)
    const futureDates = d.slice(-28)
    const fit = fourierHolidayModel(train, 28, { dates: trainDates, futureDates, grain: 'daily' })!
    expect(mape(y.slice(-28), fit.horizon)).toBeLessThan(8)
  })

  it('returns null rather than guessing on unusable input', () => {
    expect(fourierHolidayModel([1, 2, 3], 5, { dates: dates('2026-01-01', 3), futureDates: dates('2026-01-04', 5), grain: 'daily' })).toBeNull()
    // Mismatched dates and values would silently misalign the whole design matrix.
    expect(
      fourierHolidayModel(dailySeries(60).y, 5, {
        dates: dates('2026-01-01', 10),
        futureDates: dates('2026-03-02', 5),
        grain: 'daily',
      }),
    ).toBeNull()
  })

  it('handles a series containing zeros without taking a log of one', () => {
    const { dates: d, y } = dailySeries(200)
    const withZeros = y.map((value, i) => (i % 7 === 0 ? 0 : value))
    const fit = fourierHolidayModel(withZeros, 14, {
      dates: d,
      futureDates: dates('2024-07-19', 14),
      grain: 'daily',
    })!
    expect(fit).not.toBeNull()
    expect(fit.label).toContain('additive')
    expect(fit.horizon.every(Number.isFinite)).toBe(true)
  })

  it('produces one fitted value per input point', () => {
    const { dates: d, y } = dailySeries(300)
    const fit = fourierHolidayModel(y, 10, { dates: d, futureDates: dates('2024-10-27', 10), grain: 'daily' })!
    expect(fit.fitted).toHaveLength(y.length)
  })
})

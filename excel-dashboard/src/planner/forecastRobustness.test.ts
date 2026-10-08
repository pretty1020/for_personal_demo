import { describe, expect, it } from 'vitest'
import { runBrowserWfmForecast } from './browserWfmForecast'
import { diagnose } from './forecastDiagnostics'
import type { WfmModelId } from './advancedForecastPersistence'

/**
 * What the engine does with input it should never have been given.
 *
 * Real capacity plans carry keying errors, part-imported history, corrections
 * entered as negatives, and weeks that arrive out of order or twice. None of
 * that should reach a forecast, and all of it does. The rule here is narrow: the
 * engine may refuse, but it may not throw, hang, or return a number that a
 * staffing calculation would silently consume.
 */

const MODELS: WfmModelId[] = [
  'holt-winters',
  'theta',
  'fourier-holidays',
  'simple-moving-average',
  'linear-trend',
  'seasonal-naive',
]

function weeks(count: number, start = '2026-01-04') {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(`${start}T12:00:00`)
    d.setDate(d.getDate() + i * 7)
    return d.toISOString().slice(0, 10)
  })
}

function forecast(
  data: Array<{ date: string; value: number }>,
  options: { horizon?: number; targets?: string[]; unit?: 'number' | 'percent' | 'seconds' } = {},
) {
  return runBrowserWfmForecast({
    data,
    horizon: options.horizon ?? 12,
    models: MODELS,
    testSplit: '80/20',
    weekStart: 'sunday',
    targetWeeks: options.targets ?? weeks(12, '2027-01-03'),
    metricId: 'callVolume' as never,
    metricUnit: options.unit ?? 'number',
  })
}

/** Every number that leaves the engine must be usable by a staffing sum. */
function expectSane(result: ReturnType<typeof forecast>, unit: 'number' | 'percent' = 'number') {
  for (const model of result.models) {
    if (!model.success) {
      // A refusal has to explain itself, or it reads as a missing feature.
      expect(model.error, model.label).toBeTruthy()
      continue
    }
    for (const point of model.weekly ?? []) {
      expect(Number.isFinite(point.value), `${model.label} ${point.week}`).toBe(true)
      expect(point.value).toBeGreaterThanOrEqual(0)
      if (unit === 'percent') expect(point.value).toBeLessThanOrEqual(1)
    }
    for (const value of Object.values(model.accuracy)) {
      if (typeof value === 'number') expect(Number.isFinite(value), model.label).toBe(true)
    }
  }
}

describe('history that should never have been keyed', () => {
  it('survives no history at all', () => {
    const result = forecast([])
    expect(() => expectSane(result)).not.toThrow()
    expect(result.models.every((m) => !m.success)).toBe(true)
  })

  it('survives a single week', () => {
    expectSane(forecast([{ date: '2026-01-04', value: 5000 }]))
  })

  it('survives two weeks', () => {
    expectSane(forecast(weeks(2).map((date, i) => ({ date, value: 5000 + i }))))
  })

  it('survives a flat line', () => {
    expectSane(forecast(weeks(60).map((date) => ({ date, value: 4200 }))))
  })

  it('survives every week being zero', () => {
    expectSane(forecast(weeks(60).map((date) => ({ date, value: 0 }))))
  })

  it('drops NaN and Infinity rather than propagating them', () => {
    const data = weeks(60).map((date, i) => ({
      date,
      value: i === 10 ? Number.NaN : i === 20 ? Number.POSITIVE_INFINITY : 5000 + i * 10,
    }))
    expectSane(forecast(data))
  })

  it('survives a negative correction keyed into history', () => {
    // A credit or a correction can legitimately land as a negative week.
    const data = weeks(60).map((date, i) => ({ date, value: i === 30 ? -800 : 5000 + i * 10 }))
    expectSane(forecast(data))
  })

  it('survives the same week appearing twice', () => {
    const list = weeks(60)
    const data = list.map((date, i) => ({ date, value: 5000 + i * 10 }))
    data.splice(20, 0, { date: list[20]!, value: 9999 })
    expectSane(forecast(data))
  })

  it('survives weeks arriving out of order', () => {
    const data = weeks(60).map((date, i) => ({ date, value: 5000 + i * 10 }))
    expectSane(forecast([...data].reverse()))
  })

  it('survives long gaps in the middle of history', () => {
    const data = weeks(80)
      .map((date, i) => ({ date, value: 5000 + i * 10 }))
      .filter((_, i) => i < 20 || i > 50)
    expectSane(forecast(data))
  })

  it('survives values far larger than any real account', () => {
    expectSane(forecast(weeks(60).map((date, i) => ({ date, value: 1e9 + i * 1e6 }))))
  })

  it('survives values far smaller than one call', () => {
    expectSane(forecast(weeks(60).map((date, i) => ({ date, value: 1e-9 * (i + 1) }))))
  })

  it('survives a single enormous spike', () => {
    const data = weeks(60).map((date, i) => ({ date, value: i === 40 ? 5e8 : 5000 }))
    expectSane(forecast(data))
  })

  it('survives an unparseable date', () => {
    const data = weeks(60).map((date, i) => ({ date, value: 5000 + i }))
    data[15] = { date: 'not-a-date', value: 5200 }
    expect(() => expectSane(forecast(data))).not.toThrow()
  })
})

describe('horizons the plan may ask for', () => {
  it('refuses nothing when asked for zero weeks', () => {
    const result = forecast(
      weeks(60).map((date, i) => ({ date, value: 5000 + i * 10 })),
      { horizon: 0, targets: [] },
    )
    expect(() => expectSane(result)).not.toThrow()
  })

  it('handles a horizon far longer than the history behind it', () => {
    const result = forecast(
      weeks(6).map((date, i) => ({ date, value: 5000 + i * 10 })),
      { horizon: 52, targets: weeks(52, '2026-03-01') },
    )
    expectSane(result)
    for (const model of result.models.filter((m) => m.success)) {
      expect(model.weekly?.length ?? 0).toBeLessThanOrEqual(52)
    }
  })

  it('handles plan weeks that do not follow on from history', () => {
    // A plan whose forward weeks start years after the last actual.
    const result = forecast(
      weeks(60).map((date, i) => ({ date, value: 5000 + i * 10 })),
      { targets: weeks(12, '2031-01-05') },
    )
    expect(() => expectSane(result)).not.toThrow()
  })

  it('handles plan weeks that overlap the history', () => {
    const result = forecast(
      weeks(60).map((date, i) => ({ date, value: 5000 + i * 10 })),
      { targets: weeks(12, '2026-06-07') },
    )
    expect(() => expectSane(result)).not.toThrow()
  })
})

describe('rates keyed outside their range', () => {
  it('never writes a rate above one, whatever the history said', () => {
    // Shrinkage keyed as 45 rather than 0.45 is a common import error.
    const data = weeks(60).map((date, i) => ({ date, value: i % 7 === 0 ? 45 : 0.4 }))
    expectSane(forecast(data, { unit: 'percent' }), 'percent')
  })

  it('never writes a negative rate', () => {
    const data = weeks(60).map((date, i) => ({ date, value: i % 9 === 0 ? -0.2 : 0.3 }))
    expectSane(forecast(data, { unit: 'percent' }), 'percent')
  })
})

describe('diagnostics on the same inputs', () => {
  const cases: Array<[string, number[]]> = [
    ['empty', []],
    ['one point', [5000]],
    ['all zero', new Array(60).fill(0)],
    ['flat', new Array(60).fill(1234)],
    ['with NaN', [1, 2, Number.NaN, 4, 5, 6, 7, 8, 9, 10]],
    ['with Infinity', [1, 2, Number.POSITIVE_INFINITY, 4, 5, 6, 7, 8]],
    ['negatives', [100, -50, 200, -20, 150, 90, 110, 130]],
    ['huge', [1e12, 2e12, 1.5e12, 1.8e12, 1.2e12, 1.9e12, 1.1e12, 1.6e12]],
  ]

  for (const [name, values] of cases) {
    it(`${name}: reports finite numbers and a readable summary`, () => {
      const { diagnostics, summary, suggested, cautions } = diagnose(values)
      for (const [key, value] of Object.entries(diagnostics)) {
        if (typeof value === 'number') {
          expect(Number.isFinite(value), `${name}/${key}`).toBe(true)
        }
      }
      expect(typeof summary).toBe('string')
      expect(summary.length).toBeGreaterThan(0)
      expect(Array.isArray(suggested)).toBe(true)
      expect(Array.isArray(cautions)).toBe(true)
    })
  }
})

describe('cost of a long history', () => {
  it('fits ten years of weeks without stalling', () => {
    const data = weeks(520).map((date, i) => ({
      date,
      value: 5000 * (1 + 0.3 * Math.sin((2 * Math.PI * i) / 52)) + i,
    }))
    const started = Date.now()
    const result = forecast(data, { horizon: 52, targets: weeks(52, '2036-01-06') })
    // Comfortably inside what a browser interaction can absorb.
    expect(Date.now() - started).toBeLessThan(10_000)
    expectSane(result)
    expect(result.models.some((m) => m.success)).toBe(true)
  })
})

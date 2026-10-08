import { describe, expect, it } from 'vitest'
import { diagnose, diagnoseSeries, suggestModels } from './forecastDiagnostics'

/**
 * Series characterisation.
 *
 * These numbers tell a planner whether a model result is likely to hold, so the
 * tests check the measures actually respond to the thing they claim to measure
 * — and that a series too short to show a cycle says so rather than reporting a
 * confident zero.
 */

const seasonal = (weeks: number, amplitude = 0.3, slope = 0) =>
  Array.from({ length: weeks }, (_, i) => 1000 * (1 + slope * i) * (1 + amplitude * Math.sin((2 * Math.PI * i) / 52)))

const noisy = (weeks: number, spread: number) => {
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648)
  return Array.from({ length: weeks }, () => 1000 * (1 + (rnd() - 0.5) * 2 * spread))
}

describe('diagnoseSeries', () => {
  it('finds a strong annual cycle when the history can show one', () => {
    const d = diagnoseSeries(seasonal(156))
    expect(d.hasSeasonalEvidence).toBe(true)
    expect(d.seasonalStrength).toBeGreaterThan(0.6)
    // A 30% sine swings roughly 60% peak to trough.
    expect(d.amplitudePct).toBeGreaterThan(40)
  })

  it('reports no seasonal evidence on a short series instead of a confident zero', () => {
    const d = diagnoseSeries(seasonal(20))
    expect(d.hasSeasonalEvidence).toBe(false)
    expect(d.seasonalStrength).toBe(0)
  })

  it('measures a trend and states it per year', () => {
    const d = diagnoseSeries(Array.from({ length: 60 }, (_, i) => 1000 + i * 10))
    expect(d.trendStrength).toBeGreaterThan(0.9)
    // +10 a week on a mean around 1300 is roughly 40% a year.
    expect(d.trendPerWeekPct * 52).toBeGreaterThan(20)
  })

  it('separates a noisy series from a steady one', () => {
    expect(diagnoseSeries(noisy(60, 0.3)).volatilityPct).toBeGreaterThan(
      diagnoseSeries(noisy(60, 0.02)).volatilityPct,
    )
  })

  it('reports a flat series as trendless rather than dividing by zero', () => {
    const d = diagnoseSeries(new Array(60).fill(500))
    expect(d.trendPerWeekPct).toBeCloseTo(0, 6)
    expect(Number.isFinite(d.volatilityPct)).toBe(true)
  })

  it('survives a series of zeros', () => {
    const d = diagnoseSeries(new Array(30).fill(0))
    expect(Number.isFinite(d.amplitudePct)).toBe(true)
    expect(Number.isFinite(d.volatilityPct)).toBe(true)
  })

  it('says nothing confident about a series too short to describe', () => {
    const d = diagnoseSeries([1, 2])
    expect(d.weeks).toBe(2)
    expect(d.trendStrength).toBe(0)
  })
})

describe('suggestModels', () => {
  it('recommends the seasonal models for a seasonal series', () => {
    const ids = suggestModels(diagnoseSeries(seasonal(156))).map((s) => s.modelId)
    expect(ids).toContain('holt-winters')
    expect(ids).toContain('fourier-holidays')
  })

  it('recommends Theta when there is a trend but no visible cycle', () => {
    const ids = suggestModels(diagnoseSeries(Array.from({ length: 30 }, (_, i) => 1000 + i * 15)))
      .map((s) => s.modelId)
    expect(ids).toContain('theta')
    // Nothing here can evidence an annual cycle, so it must not claim one.
    expect(ids).not.toContain('fourier-holidays')
  })

  it('adds a moving-average floor when the series is very noisy', () => {
    const ids = suggestModels(diagnoseSeries(noisy(60, 0.4))).map((s) => s.modelId)
    expect(ids).toContain('simple-moving-average')
  })

  it('never suggests the same model twice', () => {
    const ids = suggestModels(diagnoseSeries(seasonal(156, 0.3, 0.004))).map((s) => s.modelId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('diagnose', () => {
  it('warns that a short history cannot support a long horizon', () => {
    const { cautions } = diagnose(seasonal(12))
    expect(cautions.join(' ')).toMatch(/only 12 weeks/i)
  })

  it('warns when noise makes small accuracy differences meaningless', () => {
    const { cautions } = diagnose(noisy(60, 0.4))
    expect(cautions.join(' ')).toMatch(/noise/i)
  })

  it('describes the shape in a sentence a planner can read', () => {
    const { summary } = diagnose(seasonal(156, 0.3, 0.003))
    expect(summary).toMatch(/seasonal/i)
    expect(summary).toMatch(/trending up/i)
  })

  it('says nothing alarming about a clean, long, steady series', () => {
    const { cautions } = diagnose(seasonal(156, 0.2))
    expect(cautions).toEqual([])
  })
})

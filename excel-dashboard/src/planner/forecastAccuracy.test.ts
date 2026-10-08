import { describe, expect, it } from 'vitest'
import {
  collectPairs,
  describeBias,
  describePattern,
  predictionBand,
  rollingFolds,
  scorePairs,
} from './forecastAccuracy'

/**
 * Accuracy measurement.
 *
 * These metrics decide which model drives a staffing plan, so the tests pin the
 * properties a planner relies on: that bias is signed, that WAPE weights by
 * volume, and that a short series produces an honest number of folds rather
 * than a confident-looking score built on two points.
 */

describe('rollingFolds', () => {
  it('walks the origin forward across several folds', () => {
    const folds = rollingFolds(52, 0.1)
    expect(folds.length).toBeGreaterThan(1)
    // Training windows grow as the origin moves forward.
    for (let i = 1; i < folds.length; i++) {
      expect(folds[i]!.trainSize).toBeGreaterThan(folds[i - 1]!.trainSize)
    }
    // The last fold ends exactly at the end of the series.
    const last = folds[folds.length - 1]!
    expect(last.trainSize + last.testSize).toBe(52)
  })

  it('still finds several folds on a short series', () => {
    // Twelve weeks used to yield a single two-week split. Walking the origin
    // forward scores four separate weeks instead, from the same history.
    const folds = rollingFolds(12, 0.1)
    expect(folds.length).toBeGreaterThan(1)
    const scored = folds.reduce((sum, fold) => sum + fold.testSize, 0)
    expect(scored).toBeGreaterThan(2)
    expect(folds.every((fold) => fold.trainSize >= 8)).toBe(true)
  })

  it('returns nothing when there is not enough history to train and score', () => {
    expect(rollingFolds(8, 0.1)).toEqual([])
  })

  it('never leaves a training window below the minimum', () => {
    for (const n of [10, 14, 20, 40, 80]) {
      for (const fold of rollingFolds(n, 0.2)) {
        expect(fold.trainSize).toBeGreaterThanOrEqual(8)
        expect(fold.trainSize + fold.testSize).toBeLessThanOrEqual(n)
      }
    }
  })
})

describe('scorePairs', () => {
  it('reports bias with a sign, so over- and under-forecasting differ', () => {
    const high = scorePairs(collectPairs([100, 100, 100], [110, 110, 110]), 1)
    const low = scorePairs(collectPairs([100, 100, 100], [90, 90, 90]), 1)
    expect(high.bias).toBeCloseTo(10, 5)
    expect(low.bias).toBeCloseTo(-10, 5)
    // Absolute error cannot tell them apart, which is the point of tracking bias.
    expect(high.wape).toBeCloseTo(low.wape!, 5)
  })

  it('nets out random error, so noise does not read as bias', () => {
    const score = scorePairs(collectPairs([100, 100, 100, 100], [110, 90, 110, 90]), 1)
    expect(Math.abs(score.bias!)).toBeLessThan(1e-6)
    expect(score.wape).toBeCloseTo(10, 5)
  })

  it('weights WAPE by volume where MAPE does not', () => {
    // A big week 10% out and a tiny week 100% out.
    const pairs = collectPairs([1000, 10], [1100, 20])
    const score = scorePairs(pairs, 1)
    // MAPE averages the percentages and is dominated by the tiny week.
    expect(score.mape).toBeCloseTo(55, 0)
    // WAPE weighs the total error against the total volume.
    expect(score.wape).toBeCloseTo(10.9, 0)
  })

  it('carries the sample and fold counts so a score can be judged', () => {
    const score = scorePairs(collectPairs([1, 2, 3], [1, 2, 3]), 3)
    expect(score.samples).toBe(3)
    expect(score.folds).toBe(3)
  })

  it('returns nothing rather than a misleading zero on no data', () => {
    expect(scorePairs([], 0)).toEqual({})
  })

  it('survives a zero actual without dividing by it', () => {
    const score = scorePairs(collectPairs([0, 100], [10, 110]), 1)
    expect(Number.isFinite(score.wape!)).toBe(true)
    expect(Number.isFinite(score.mape!)).toBe(true)
  })
})

describe('predictionBand', () => {
  it('widens with the horizon, because errors compound', () => {
    const band = predictionBand([10, -10, 5, -5, 8, -8], 12)!
    expect(band).toHaveLength(12)
    expect(band[11]!).toBeGreaterThan(band[0]!)
    // Random-walk growth: roughly sqrt(12) ≈ 3.5x by week 12.
    expect(band[11]! / band[0]!).toBeCloseTo(Math.sqrt(12), 1)
  })

  it('is wider for a less reliable model', () => {
    const tight = predictionBand([1, -1, 1, -1], 4)!
    const loose = predictionBand([50, -50, 50, -50], 4)!
    expect(loose[0]!).toBeGreaterThan(tight[0]!)
  })

  it('returns nothing when there is too little to measure spread', () => {
    expect(predictionBand([5], 4)).toBeUndefined()
    expect(predictionBand([], 4)).toBeUndefined()
    // A model that was exactly right every time has no spread to report.
    expect(predictionBand([0, 0, 0], 4)).toBeUndefined()
  })
})

describe('describeBias', () => {
  it('names the direction a planner would act on', () => {
    expect(describeBias(0.5).tone).toBe('ok')
    expect(describeBias(3).text).toContain('over')
    expect(describeBias(-3).text).toContain('under')
    expect(describeBias(9).tone).toBe('bad')
    expect(describeBias(undefined).text).toBe('—')
  })
})

/**
 * Pattern agreement.
 *
 * These exist to catch the failure that error measures cannot see: a model that
 * scores well by predicting the average and never moving.
 */
describe('pattern R and amplitude', () => {
  const actual = [100, 140, 90, 150, 95, 145, 105, 135]

  it('scores a model that tracks the shape at the right size near 1 on both', () => {
    const predicted = actual.map((v) => v * 1.02)
    const score = scorePairs(collectPairs(actual, predicted), 1)
    expect(score.patternR!).toBeGreaterThan(0.99)
    expect(score.amplitudeRatio!).toBeCloseTo(1.02, 2)
  })

  it('exposes a flat forecast that the error score flatters', () => {
    const mean = actual.reduce((s, v) => s + v, 0) / actual.length
    const flat = actual.map(() => mean)
    const score = scorePairs(collectPairs(actual, flat), 1)

    // The error looks tolerable — this is exactly why it gets picked.
    expect(score.wape!).toBeLessThan(25)
    // But it has no shape at all, and that is now visible.
    expect(score.amplitudeRatio!).toBeCloseTo(0, 6)
    expect(describePattern(score.patternR, score.amplitudeRatio).tone).toBe('bad')
  })

  it('detects a forecast that moves the right way but too weakly', () => {
    const mean = actual.reduce((s, v) => s + v, 0) / actual.length
    const damped = actual.map((v) => mean + (v - mean) * 0.4)
    const score = scorePairs(collectPairs(actual, damped), 1)
    expect(score.patternR!).toBeGreaterThan(0.99)
    expect(score.amplitudeRatio!).toBeCloseTo(0.4, 2)
    expect(describePattern(score.patternR, score.amplitudeRatio).text).toMatch(/understated/)
  })

  it('detects a forecast that overshoots the swings', () => {
    const mean = actual.reduce((s, v) => s + v, 0) / actual.length
    const loud = actual.map((v) => mean + (v - mean) * 2)
    const score = scorePairs(collectPairs(actual, loud), 1)
    expect(score.amplitudeRatio!).toBeCloseTo(2, 2)
    expect(describePattern(score.patternR, score.amplitudeRatio).text).toMatch(/overstated/)
  })

  it('scores a forecast that moves opposite to reality as negative', () => {
    const mean = actual.reduce((s, v) => s + v, 0) / actual.length
    const inverted = actual.map((v) => mean - (v - mean))
    const score = scorePairs(collectPairs(actual, inverted), 1)
    expect(score.patternR!).toBeLessThan(-0.99)
    expect(describePattern(score.patternR, score.amplitudeRatio).tone).toBe('bad')
  })

  it('reports nothing rather than zero when the actuals never move', () => {
    const flatActual = new Array(10).fill(50)
    const wobble = [48, 51, 49, 52, 47, 53, 50, 49, 51, 48]
    const score = scorePairs(collectPairs(flatActual, wobble), 1)
    // There is no pattern to agree with; claiming R=0 would read as a failure.
    expect(score.patternR).toBeUndefined()
    expect(score.amplitudeRatio).toBeUndefined()
  })

  it('withholds pattern metrics when too few weeks were scored to mean anything', () => {
    // Four weeks can produce any correlation at all; the error measures are
    // still worth reporting, so they must survive.
    const score = scorePairs(collectPairs([100, 140, 90, 150], [98, 142, 88, 155]), 1)
    expect(score.patternR).toBeUndefined()
    expect(score.amplitudeRatio).toBeUndefined()
    expect(score.wape).toBeDefined()
    expect(score.bias).toBeDefined()
  })

  it('stays within -1 and 1', () => {
    const score = scorePairs(collectPairs(actual, actual), 1)
    expect(score.patternR!).toBeLessThanOrEqual(1)
    expect(score.patternR!).toBeGreaterThanOrEqual(-1)
  })
})

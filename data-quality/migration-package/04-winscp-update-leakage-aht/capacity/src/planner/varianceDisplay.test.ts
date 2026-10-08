import { describe, expect, it } from 'vitest'
import { varianceToneHigherBetter, varianceToneLowerBetter } from './varianceDisplay'

/**
 * AHT, shrinkage and attrition all read the same way: over plan is the leak. These pin
 * the rule the Staffing Plan colours by, so a future change to the tone vocabulary
 * cannot quietly turn a leak green.
 */
describe('AHT variance tone — positive is red', () => {
  it('flags handling above plan as a leak', () => {
    // Actual 300s against a planned 240s.
    expect(varianceToneLowerBetter(60)).toBe('variance-neg')
  })

  it('treats beating the planned AHT as favourable', () => {
    expect(varianceToneLowerBetter(-60)).toBe('variance-pos')
  })

  it('leaves an on-plan week uncoloured', () => {
    expect(varianceToneLowerBetter(0)).toBe('neutral')
  })

  it('leaves a week with no actual uncoloured', () => {
    expect(varianceToneLowerBetter(null)).toBe('neutral')
    expect(varianceToneLowerBetter(undefined)).toBe('neutral')
    expect(varianceToneLowerBetter(Number.NaN)).toBe('neutral')
  })

  it('does not flip a rounding artefact into a red cell', () => {
    expect(varianceToneLowerBetter(1e-12)).toBe('neutral')
  })
})

describe('varianceToneHigherBetter is the opposite reading', () => {
  it('treats a surplus as favourable', () => {
    expect(varianceToneHigherBetter(60)).toBe('variance-pos')
  })

  it('treats a shortfall as a leak', () => {
    expect(varianceToneHigherBetter(-60)).toBe('variance-neg')
  })
})

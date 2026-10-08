import { describe, expect, it } from 'vitest'
import { releaseWholeAttrition } from './capacityPlanDerived'

const WEEKS_PER_MONTH = 4.33

describe('releaseWholeAttrition', () => {
  it('releases a whole head only once the pooled fraction reaches one', () => {
    // 100 HC at 2%/month is 0.4619 per week. Rounding each week on its own gave 0
    // forever; pooling releases a leaver roughly every other week.
    const weekly = (100 * 0.02) / WEEKS_PER_MONTH
    let carry = 0
    const released: number[] = []

    for (let week = 0; week < 5; week += 1) {
      const result = releaseWholeAttrition(weekly, carry, 100)
      carry = result.carry
      released.push(result.wholeHc)
    }

    expect(released).toEqual([0, 0, 1, 0, 1])
    expect(released.reduce((sum, value) => sum + value, 0)).toBe(2)
  })

  it('conserves the annual total instead of discarding it', () => {
    const weekly = (100 * 0.02) / WEEKS_PER_MONTH
    let carry = 0
    let total = 0

    for (let week = 0; week < 52; week += 1) {
      const result = releaseWholeAttrition(weekly, carry, 100)
      carry = result.carry
      total += result.wholeHc
    }

    // 100 HC x 2% x 12 months = 24 expected leavers across the year.
    expect(total).toBe(24)
  })

  it('never releases more than the roll-forward base', () => {
    const result = releaseWholeAttrition(50, 0.9, 3)
    expect(result.wholeHc).toBe(3)
    expect(result.carry).toBeLessThanOrEqual(1)
  })

  it('passes whole numbers straight through', () => {
    expect(releaseWholeAttrition(2, 0, 100)).toEqual({ wholeHc: 2, carry: 0 })
  })

  it('treats a zero or negative rate as no attrition', () => {
    expect(releaseWholeAttrition(0, 0, 100)).toEqual({ wholeHc: 0, carry: 0 })
    expect(releaseWholeAttrition(-5, 0, 100).wholeHc).toBe(0)
  })
})

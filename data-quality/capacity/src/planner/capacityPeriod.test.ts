import { describe, expect, it } from 'vitest'
import { weeksMatchingCapacityPeriod, type CapacityPeriodState } from './capacityPeriod'

const weeks = ['2023-07-02', '2023-07-09', '2023-08-06', '2024-01-07']

describe('weeksMatchingCapacityPeriod', () => {
  it('returns only months the user selected', () => {
    const state: CapacityPeriodState = {
      mode: 'month',
      years: ['2023'],
      months: ['2023-07'],
      quarters: ['Q3'],
    }
    expect(weeksMatchingCapacityPeriod(weeks, state)).toEqual(['2023-07-02', '2023-07-09'])
  })

  it('returns no weeks when Monthly is on but nothing is chosen', () => {
    const state: CapacityPeriodState = {
      mode: 'month',
      years: [],
      months: [],
      quarters: [],
    }
    expect(weeksMatchingCapacityPeriod(weeks, state)).toEqual([])
  })

  it('leaves Weekly unfiltered', () => {
    const state: CapacityPeriodState = {
      mode: 'weekly',
      years: [],
      months: [],
      quarters: [],
    }
    expect(weeksMatchingCapacityPeriod(weeks, state)).toEqual(weeks)
  })
})

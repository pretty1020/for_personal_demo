import { describe, expect, it } from 'vitest'
import { CALCULATOR_DEFAULTS, SOP_FINDING, SOP_PROCESSES, monthlyCost, requiredFte, seatDemand, localShare } from './globalWfm'

describe('global WFM', () => {
  it('keeps twenty percent of the SOP local', () => {
    expect(localShare()).toBe(0.2)
  })

  it('states the five-process gap and shows variance by region and business model', () => {
    expect(SOP_FINDING).toBe(
      'Forecasting, capacity planning, scheduling, intraday, and reporting exhibit significant gaps and variance across regional delivery sites and business models.',
    )
    expect(SOP_PROCESSES.map((item) => item.title)).toEqual([
      'Forecasting',
      'Capacity planning',
      'Scheduling',
      'Intraday',
      'Reporting',
    ])
    for (const process of SOP_PROCESSES) {
      expect(new Set(process.rows.map((row) => row.model)).size).toBeGreaterThan(1)
      expect(new Set(process.rows.map((row) => row.region)).size).toBeGreaterThan(1)
    }
  })

  it('turns contacts into FTE, seats, and cost with one formula', () => {
    const fte = requiredFte(CALCULATOR_DEFAULTS.weeklyContacts, CALCULATOR_DEFAULTS.ahtSeconds, CALCULATOR_DEFAULTS.shrinkage)
    expect(fte).toBeCloseTo(166.09, 1)
    expect(seatDemand(fte, 0.86, 0.6)).toBeCloseTo(97.6, 1)
    expect(monthlyCost(fte, 1850)).toBe(307263)
  })
})

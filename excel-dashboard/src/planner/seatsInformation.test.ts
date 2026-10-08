import { describe, expect, it } from 'vitest'
import { scenarioOnsiteWah, scenarioSeatDemand, scenarioSeatUtilization } from './seatScenario'
import {
  SLIDE_DEFAULTS,
  buildOutlook,
  computeSeatChain,
  deskStatus,
  requiredFte,
  utilizationStatus,
} from './seatsInformation'

describe('seat chain worked example', () => {
  const chain = computeSeatChain(SLIDE_DEFAULTS)

  it('follows the slide from 1,200 headcount at 60% onsite to 289 seats', () => {
    expect(chain.onsiteHc).toBe(720)
    expect(chain.scheduledPerDay).toBe(514)
    expect(chain.peakShift).toBe(231)
    expect(chain.afterOverlap).toBe(254)
    expect(chain.afterSupport).toBe(275)
    expect(chain.seats).toBe(289)
    expect(chain.deskRatio).toBeCloseTo(2.49, 2)
    expect(chain.shifts.map((shift) => shift.agents)).toEqual([231, 180, 103])
  })

  it('divides workload hours by a 40-hour week after occupancy and shrinkage', () => {
    const handleHours = 40 * 0.85 * 0.85
    expect(requiredFte(8640, 300, 0.85, 0.15)).toBeCloseTo(720 / handleHours, 5)
    expect(requiredFte(8640, 300, 0.85, 0.3)).toBeGreaterThan(requiredFte(8640, 300, 0.85, 0.15))
  })

  it('spreads a 40-hour FTE across the days the site is open', () => {
    expect(chain.occupiedSeatHours).toBeCloseTo(720 * 40 * 0.85, 5)
    expect(chain.operatingHours).toBe(289 * 24 * 7)
    const weekday = computeSeatChain({ ...SLIDE_DEFAULTS, shiftModel: 'single-shift' })
    expect(weekday.scheduledPerDay).toBe(720)
    expect(weekday.daysOpen).toBe(5)
    expect(weekday.shifts).toEqual([{ name: 'Shift A', agents: 720 }])
    const two = computeSeatChain({ ...SLIDE_DEFAULTS, shiftModel: 'two-shift' })
    expect(two.shifts.map((shift) => shift.name)).toEqual(['Shift A', 'Shift B'])
    expect(two.shifts[0]!.agents + two.shifts[1]!.agents).toBe(two.scheduledPerDay)
  })

  it('marks the slide desk ratio green for a 24×7 target and utilization by band', () => {
    expect(deskStatus(chain.deskRatio, '24x7')).toBe('green')
    expect(utilizationStatus(0.85)).toBe('green')
    expect(utilizationStatus(0.6)).toBe('red')
    expect(utilizationStatus(0.75)).toBe('amber')
  })

  it('flags outlook weeks where demand exceeds available seats', () => {
    const outlook = buildOutlook(SLIDE_DEFAULTS, [
      { week: '2026-01-04', label: 'Jan 4', totalHc: 1200, availableSeats: 280 },
      { week: '2026-01-11', label: 'Jan 11', totalHc: 1400, availableSeats: 280 },
    ])
    expect(outlook[0]?.gap).toBeGreaterThan(0)
    expect(outlook[0]?.variance).not.toBeNull()
    expect(outlook[0]!.variance!).toBeLessThan(0)
    expect(outlook[0]!.variance).toBe(-outlook[0]!.gap)
    expect(outlook[1]!.demandSeats!).toBeGreaterThan(outlook[0]!.demandSeats!)
    expect(outlook[0]?.totalHc).toBe(1200)
    expect(outlook[1]?.totalHc).toBe(1400)
  })

  it('uses the capacity seat-demand formula when the scenario has a peak ratio', () => {
    expect(scenarioSeatDemand(65, 0.2, 4, 65)).toBeCloseTo(17, 5)
    expect(scenarioSeatDemand(65, 0.2, 4)).toBeNull()
    expect(scenarioSeatDemand(65, null, 4, 65)).toBeNull()
    const split = scenarioOnsiteWah(65, 40, null)
    expect(split.onsiteHc).toBe(40)
    expect(split.wahHc).toBeNull()
    expect(split.onsitePct).toBeCloseTo(40 / 65, 5)
    expect(scenarioOnsiteWah(65, null, null)).toEqual({ onsiteHc: null, wahHc: null, onsitePct: null, wahPct: null })
    expect(scenarioSeatUtilization(40, 0.15, 15, '24x7')).toBeCloseTo((40 * 40 * 0.85) / (15 * 24 * 7), 5)
    const outlook = buildOutlook(SLIDE_DEFAULTS, [
      {
        week: '2026-03-28',
        label: 'Mar 28',
        totalHc: 65,
        availableSeats: 15,
        peakRatioPct: 0.2,
        supportHc: 4,
        onsiteHc: 40,
        wahHc: null,
        shrinkage: 0.15,
        demandSeats: scenarioSeatDemand(65, 0.2, 4, 40),
      },
      {
        week: '2026-04-04',
        label: 'Apr 4',
        totalHc: 80,
        availableSeats: 15,
        peakRatioPct: 0.25,
        supportHc: 4,
        onsiteHc: null,
        wahHc: 20,
        shrinkage: 0.15,
        demandSeats: scenarioSeatDemand(80, 0.25, 4, null),
      },
    ])
    expect(outlook[0]?.demandSeats).toBeCloseTo(12, 5)
    expect(outlook[0]?.onsiteHc).toBe(40)
    expect(outlook[0]?.wahHc).toBeNull()
    expect(outlook[0]?.variance).toBeCloseTo(15 - 12, 5)
    expect(outlook[1]?.demandSeats).toBeNull()
    expect(outlook[1]?.onsiteHc).toBeNull()
    expect(outlook[1]?.wahHc).toBe(20)
    expect(outlook[1]?.demandSeats).not.toBe(outlook[0]?.demandSeats)
  })

  it('matches the capacity seats block: 60% peak on 47 onsite HC is 28.2 seats', () => {
    expect(scenarioSeatDemand(50, 0.144, 0)).toBeNull()
    expect(scenarioSeatDemand(50, 0.144, 0, 43)).toBeCloseTo(0.144 * 43, 5)
    const outlook = buildOutlook(SLIDE_DEFAULTS, [
      {
        week: '2026-08-16',
        label: 'Aug 16',
        totalHc: 50,
        availableSeats: 30,
        peakRatioPct: 0.6,
        supportHc: 0,
        onsiteHc: 47,
        wahHc: 3,
        shrinkage: 0.15,
        demandSeats: scenarioSeatDemand(50, 0.6, 0, 47),
      },
    ])
    const week = outlook[0]!
    expect(week.demandSeats).toBeCloseTo(28.2, 5)
    expect(week.onsiteHc).toBe(47)
    expect(week.wahHc).toBe(3)
    expect(week.onsitePct).toBeCloseTo(0.94, 5)
    expect(week.wahPct).toBeCloseTo(0.06, 5)
    expect(week.availableSeats).toBe(30)
    expect(week.variance).toBeCloseTo(30 - 28.2, 5)
    expect(week.utilization).toBeCloseTo((47 * 40 * 0.85) / (30 * 24 * 7), 5)
  })
})

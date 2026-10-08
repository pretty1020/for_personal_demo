import { describe, expect, it } from 'vitest'
import type { CapacityMetricSnapshot, DerivedCapacityRow } from '../capacityPlanDerived'
import {
  accumulateWeekGaps,
  dbeRevenuePerHour,
  monetizeMonth,
  type WeekGapAccum,
} from './staffingDbeLeakage'
import type { DbeMonthComputed } from './dbePersistence'

type SnapshotParts = {
  productionFte?: number
  productionHc?: number
  beginningProductionHc?: number
  requiredFte?: number
  attritionHc?: number
  shrinkagePct?: number
  volume?: number
  handledVolume?: number | null
  ahtSeconds?: number | null
}

/** Only the members the leakage accumulator reads; the rest never influence a driver. */
function snapshot(parts: SnapshotParts): CapacityMetricSnapshot {
  return {
    productionFte: parts.productionFte ?? 0,
    productionHc: parts.productionHc ?? parts.productionFte ?? 0,
    beginningProductionHc: parts.beginningProductionHc ?? 0,
    requiredFte: parts.requiredFte ?? 0,
    attritionHc: parts.attritionHc ?? 0,
    shrinkagePct: parts.shrinkagePct ?? 0,
    volume: parts.volume ?? 0,
    offeredVolume: parts.volume ?? 0,
    handledVolume: parts.handledVolume ?? null,
    ahtSeconds: parts.ahtSeconds ?? null,
  } as unknown as CapacityMetricSnapshot
}

function actualWeek(
  week: string,
  planned: SnapshotParts,
  actual: SnapshotParts,
  shrinkageCategories?: DerivedCapacityRow['shrinkageCategories'],
): DerivedCapacityRow {
  return {
    periodIndex: 0,
    week,
    timeline: 'historical_actual',
    statusLabel: 'Actual',
    isCurrentPlanningWeek: false,
    planned: snapshot(planned),
    actual: snapshot(actual),
    shrinkageCategories,
  } as unknown as DerivedCapacityRow
}

function forwardWeek(week: string, planned: SnapshotParts): DerivedCapacityRow {
  return {
    periodIndex: 0,
    week,
    timeline: 'forward_plan',
    statusLabel: 'Planned',
    isCurrentPlanningWeek: false,
    planned: snapshot(planned),
    actual: snapshot(planned),
  } as unknown as DerivedCapacityRow
}

/**
 * The ordinary shape of a real plan: built for the fiscal year, so every week sits in the
 * forward_plan timeline, and the weeks that have since passed are relabelled 'Actual'.
 */
function elapsedPlanWeek(
  week: string,
  planned: SnapshotParts,
  actual: SnapshotParts,
): DerivedCapacityRow {
  return {
    periodIndex: 0,
    week,
    timeline: 'forward_plan',
    statusLabel: 'Actual',
    isCurrentPlanningWeek: false,
    planned: snapshot(planned),
    actual: snapshot(actual),
  } as unknown as DerivedCapacityRow
}

/** An hourly-billed month, so $/hour is the stated rate and $/FTE is rate × hours. */
function hourlyMonth(parts: Partial<DbeMonthComputed> = {}): DbeMonthComputed {
  return {
    month: '2026-04',
    networkDays: 22,
    loginHours: 8,
    productiveHours: 100,
    hourlyBillRate: 20,
    monthlyBillRate: 0,
    perMinuteBillRate: 0,
    capacity: 0,
    totalRevenue: 0,
    aht: 0,
    fte: 0,
    requiredFte: 0,
    ...parts,
  } as unknown as DbeMonthComputed
}

function driversFor(accum: WeekGapAccum) {
  return monetizeMonth(accum, hourlyMonth(), 'hourly').drivers
}

describe('AHT leakage', () => {
  it('converts the AHT overrun into hours with (actual − planned) × volume ÷ 3600', () => {
    // 60 extra seconds on 1,200 handled contacts = 72,000 seconds = 20 hours.
    const rows = [
      actualWeek('2026-04-06', { ahtSeconds: 240, volume: 1200 }, { ahtSeconds: 300, handledVolume: 1200 }),
    ]

    const accum = accumulateWeekGaps(rows, 0.5)

    expect(accum.ahtLeakHours).toBeCloseTo(20, 6)
  })

  it('values the lost hours at the DBE hourly rate', () => {
    const rows = [
      actualWeek('2026-04-06', { ahtSeconds: 240, volume: 1200 }, { ahtSeconds: 300, handledVolume: 1200 }),
    ]

    // 20 hours × $20/hr
    expect(driversFor(accumulateWeekGaps(rows, 0.5)).aht).toBe(400)
  })

  it('charges the overrun against handled volume, not the forecast', () => {
    // Half the forecast arrived, so only half the traffic carried the longer handle time.
    const rows = [
      actualWeek('2026-04-06', { ahtSeconds: 240, volume: 1200 }, { ahtSeconds: 300, handledVolume: 600 }),
    ]

    expect(accumulateWeekGaps(rows, 0.5).ahtLeakHours).toBeCloseTo(10, 6)
  })

  it('does not credit beating the planned AHT', () => {
    const rows = [
      actualWeek('2026-04-06', { ahtSeconds: 300, volume: 1200 }, { ahtSeconds: 240, handledVolume: 1200 }),
    ]

    expect(accumulateWeekGaps(rows, 0.5).ahtLeakHours).toBe(0)
    expect(driversFor(accumulateWeekGaps(rows, 0.5)).aht).toBe(0)
  })

  it('leaks nothing on a forward week, which has no actual to compare', () => {
    const rows = [forwardWeek('2026-04-13', { ahtSeconds: 240, volume: 1200 })]

    expect(accumulateWeekGaps(rows, 0.5).ahtLeakHours).toBe(0)
  })

  // Both of these reported $0 against real plans while the suite above stayed green.
  it('counts an elapsed week of a forward plan, not just a historical_actual week', () => {
    const rows = [
      elapsedPlanWeek(
        '2026-04-06',
        { ahtSeconds: 240, volume: 1200 },
        { ahtSeconds: 300, handledVolume: 1200 },
      ),
    ]

    expect(accumulateWeekGaps(rows, 0.5).ahtLeakHours).toBeCloseTo(20, 6)
    expect(driversFor(accumulateWeekGaps(rows, 0.5)).aht).toBe(400)
  })

  it('falls back to planned volume when the week records an AHT but no volume', () => {
    // handledVolume and volume both sit at 0 rather than null, so a `??` chain would
    // read the missing figure as "zero contacts" and report no leakage.
    const rows = [
      actualWeek(
        '2026-04-06',
        { ahtSeconds: 240, volume: 1200 },
        { ahtSeconds: 300, handledVolume: null, volume: 0 },
      ),
    ]

    expect(accumulateWeekGaps(rows, 0.5).ahtLeakHours).toBeCloseTo(20, 6)
  })

  it('sums hours across the weeks of a month, since lost hours are a flow', () => {
    const week = (iso: string) =>
      actualWeek(iso, { ahtSeconds: 240, volume: 1200 }, { ahtSeconds: 300, handledVolume: 1200 })

    const accum = accumulateWeekGaps([week('2026-04-06'), week('2026-04-13')], 0.5)

    expect(accum.ahtLeakHours).toBeCloseTo(40, 6)
  })
})

describe('dbeRevenuePerHour', () => {
  it('uses the stated rate for an hourly line', () => {
    expect(dbeRevenuePerHour(hourlyMonth({ hourlyBillRate: 32 }), 'hourly')).toBe(32)
  })

  it('scales a per-minute rate up to the hour', () => {
    expect(dbeRevenuePerHour(hourlyMonth({ perMinuteBillRate: 0.5 }), 'per_minute')).toBe(30)
  })

  it('spreads a monthly rate over the hours the month bills', () => {
    // $10,000 a month over 100 productive hours.
    const computed = hourlyMonth({ monthlyBillRate: 10_000, hourlyBillRate: 0, productiveHours: 100 })
    expect(dbeRevenuePerHour(computed, 'monthly')).toBe(100)
  })

  it('returns zero when the line has no usable rate', () => {
    expect(dbeRevenuePerHour(hourlyMonth({ hourlyBillRate: 0 }), 'hourly')).toBe(0)
  })
})

describe('Absenteeism and In-Office Shrinkage leakage', () => {
  const categories = (absActual: number, inOfficeActual: number, breakActual: number) => [
    { id: 'absenteeism', name: 'Absenteeism', group: 'out_of_office' as const, billable: false, plannedPct: 0.05, actualPct: absActual },
    { id: 'meeting', name: 'Meetings', group: 'in_office' as const, billable: false, plannedPct: 0.1, actualPct: inOfficeActual },
    { id: 'break', name: 'Break', group: 'in_office' as const, billable: true, plannedPct: 0.08, actualPct: breakActual },
  ]

  it('reports the two overruns separately rather than as one shrinkage number', () => {
    // Absenteeism runs 2pts over, in-office meetings 3pts over, on 100 production FTE.
    const rows = [
      actualWeek(
        '2026-04-06',
        { productionFte: 100, shrinkagePct: 0.15 },
        { productionFte: 100, shrinkagePct: 0.2 },
        categories(0.07, 0.13, 0.08),
      ),
    ]

    const accum = accumulateWeekGaps(rows, 0.5)

    expect(accum.absenteeismFteImpact[0]).toBeCloseTo(2, 6)
    expect(accum.inOfficeShrinkFteImpact[0]).toBeCloseTo(3, 6)
  })

  it('excludes billable Break from in-office shrinkage', () => {
    // Billable Break runs 5pts over, everything else on plan — paid/contractual, not a leak.
    const rows = [
      actualWeek(
        '2026-04-06',
        { productionFte: 100, shrinkagePct: 0.15 },
        { productionFte: 100, shrinkagePct: 0.2 },
        categories(0.05, 0.1, 0.13),
      ),
    ]

    const accum = accumulateWeekGaps(rows, 0.5)

    expect(accum.inOfficeShrinkFteImpact[0]).toBe(0)
    expect(accum.absenteeismFteImpact[0]).toBe(0)
  })

  it('includes Break in in-office leakage when tagged Not Billable', () => {
    const rows = [
      actualWeek(
        '2026-04-06',
        { productionFte: 100, shrinkagePct: 0.15 },
        { productionFte: 100, shrinkagePct: 0.2 },
        [
          {
            id: 'absenteeism',
            name: 'Absenteeism',
            group: 'out_of_office',
            billable: false,
            plannedPct: 0.05,
            actualPct: 0.05,
          },
          {
            id: 'break',
            name: 'Break',
            group: 'in_office',
            billable: false,
            plannedPct: 0.08,
            actualPct: 0.13,
          },
        ],
      ),
    ]

    const accum = accumulateWeekGaps(rows, 0.5)
    // Not Billable Break +5pts × 100 FTE
    expect(accum.inOfficeShrinkFteImpact[0]).toBeCloseTo(5, 6)
  })

  it('excludes billable in-office categories from leakage', () => {
    const rows = [
      actualWeek(
        '2026-04-06',
        { productionFte: 100, shrinkagePct: 0.15 },
        { productionFte: 100, shrinkagePct: 0.2 },
        [
          {
            id: 'aux_default',
            name: 'Default',
            group: 'in_office',
            billable: true,
            plannedPct: 0.05,
            actualPct: 0.12,
          },
          {
            id: 'meeting',
            name: 'Meetings',
            group: 'in_office',
            billable: false,
            plannedPct: 0.1,
            actualPct: 0.14,
          },
        ],
      ),
    ]

    const accum = accumulateWeekGaps(rows, 0.5)
    // Only Meetings (+4pts × 100 FTE) — billable Default is ignored.
    expect(accum.inOfficeShrinkFteImpact[0]).toBeCloseTo(4, 6)
  })

  it('scores in-office even when only Absenteeism has category actuals on another week pattern', () => {
    // Absenteeism measured on plan; in-office Meetings overrun alone must still register.
    const rows = [
      actualWeek(
        '2026-04-06',
        { productionFte: 100, shrinkagePct: 0.15 },
        { productionFte: 100, shrinkagePct: 0.2 },
        [
          {
            id: 'absenteeism',
            name: 'Absenteeism',
            group: 'out_of_office',
            billable: false,
            plannedPct: 0.05,
            actualPct: 0.05,
          },
          {
            id: 'meeting',
            name: 'Meetings',
            group: 'in_office',
            billable: false,
            plannedPct: 0.1,
            actualPct: 0.15,
          },
        ],
      ),
    ]

    const accum = accumulateWeekGaps(rows, 0.5)
    expect(accum.absenteeismFteImpact[0]).toBe(0)
    expect(accum.inOfficeShrinkFteImpact[0]).toBeCloseTo(5, 6)
  })

  it('keeps in-office when Absenteeism has actuals but in-office categories are the only overrun', () => {
    // Regression: old path required every measured category in one loop; Vacation Leave
    // (OOO, non-Absenteeism) with actuals used to lock the measured path and drop in-office.
    const rows = [
      actualWeek(
        '2026-04-06',
        { productionFte: 100, shrinkagePct: 0.2 },
        { productionFte: 100, shrinkagePct: 0.28 },
        [
          {
            id: 'vacation_leave',
            name: 'Vacation Leave',
            group: 'out_of_office',
            billable: false,
            plannedPct: 0.05,
            actualPct: 0.05,
          },
          {
            id: 'meeting',
            name: 'Meetings',
            group: 'in_office',
            billable: false,
            plannedPct: 0.1,
            actualPct: 0.18,
          },
        ],
      ),
    ]

    const accum = accumulateWeekGaps(rows, 0.5)
    expect(accum.absenteeismFteImpact[0]).toBe(0)
    expect(accum.inOfficeShrinkFteImpact[0]).toBeCloseTo(8, 6)
  })

  it('values each overrun at the DBE $/FTE', () => {
    const rows = [
      actualWeek(
        '2026-04-06',
        { productionFte: 100, shrinkagePct: 0.15 },
        { productionFte: 100, shrinkagePct: 0.2 },
        categories(0.07, 0.13, 0.08),
      ),
    ]

    // $/FTE for the hourly month is 20 × 100 productive hours = $2,000.
    const drivers = driversFor(accumulateWeekGaps(rows, 0.5))

    expect(drivers.absenteeism).toBe(4000)
    expect(drivers.inOfficeShrinkage).toBe(6000)
  })

  it('splits the total overrun by the plan in-office share when no category actuals exist', () => {
    // 4pts of total overrun on 100 FTE, and the plan says 75% of shrinkage is in-office.
    const rows = [
      actualWeek('2026-04-06', { productionFte: 100, shrinkagePct: 0.16 }, { productionFte: 100, shrinkagePct: 0.2 }),
    ]

    const accum = accumulateWeekGaps(rows, 0.75)

    expect(accum.inOfficeShrinkFteImpact[0]).toBeCloseTo(3, 6)
    expect(accum.absenteeismFteImpact[0]).toBeCloseTo(1, 6)
  })

  it('keeps the split adding up to the old combined shrinkage driver', () => {
    // The two drivers replace one; together they must still be worth the same money.
    const rows = [
      actualWeek('2026-04-06', { productionFte: 100, shrinkagePct: 0.16 }, { productionFte: 100, shrinkagePct: 0.2 }),
    ]

    const accum = accumulateWeekGaps(rows, 0.75)
    const drivers = driversFor(accum)
    const combined = Math.round(0.04 * 100 * 2000)

    expect(drivers.absenteeism + drivers.inOfficeShrinkage).toBe(combined)
  })

  it('averages the FTE impact across weeks, since shrinkage is a level not a flow', () => {
    const week = (iso: string) =>
      actualWeek(iso, { productionFte: 100, shrinkagePct: 0.16 }, { productionFte: 100, shrinkagePct: 0.2 })

    const accum = accumulateWeekGaps([week('2026-04-06'), week('2026-04-13')], 0.75)
    const drivers = driversFor(accum)

    // Two identical weeks must not read as twice the shrinkage.
    expect(drivers.inOfficeShrinkage).toBe(6000)
  })
})

describe('Attrition leakage', () => {
  it('values Actual attrition HC above Planned at the DBE $/FTE', () => {
    const rows = [
      actualWeek(
        '2026-04-06',
        { productionFte: 100, attritionHc: 2 },
        { productionFte: 100, attritionHc: 5, beginningProductionHc: 100 },
      ),
    ]

    // Need beginningProductionHc on snapshot — extend snapshot helper
    const accum = accumulateWeekGaps(rows, 0.5)
    expect(accum.attritionGapHc).toBe(3)
    // 3 HC × $2,000 / FTE
    expect(driversFor(accum).attrition).toBe(6000)
  })

  it('does not treat an unmeasured Actual week as zero attrition beating the plan', () => {
    const rows = [
      actualWeek(
        '2026-04-06',
        { productionFte: 100, attritionHc: 4 },
        { productionFte: 0, attritionHc: 0 },
      ),
    ]

    expect(accumulateWeekGaps(rows, 0.5).attritionGapHc).toBe(0)
  })

  it('counts attrition on an elapsed forward-plan week', () => {
    const rows = [
      elapsedPlanWeek(
        '2026-04-06',
        { productionFte: 100, attritionHc: 1 },
        { productionFte: 100, attritionHc: 4, beginningProductionHc: 100 },
      ),
    ]

    expect(accumulateWeekGaps(rows, 0.5).attritionGapHc).toBe(3)
  })
})

describe('leakage total', () => {
  it('adds the three new drivers into the month total', () => {
    const rows = [
      actualWeek(
        '2026-04-06',
        { productionFte: 100, shrinkagePct: 0.16, ahtSeconds: 240, volume: 1200 },
        { productionFte: 100, shrinkagePct: 0.2, ahtSeconds: 300, handledVolume: 1200 },
      ),
    ]

    const drivers = driversFor(accumulateWeekGaps(rows, 0.75))

    expect(drivers.total).toBe(
      drivers.understaff +
        drivers.overstaff +
        drivers.attrition +
        drivers.absenteeism +
        drivers.inOfficeShrinkage +
        drivers.aht +
        drivers.volume,
    )
    expect(drivers.aht).toBeGreaterThan(0)
    expect(drivers.absenteeism).toBeGreaterThan(0)
    expect(drivers.inOfficeShrinkage).toBeGreaterThan(0)
  })

  it('reports every driver on an elapsed week of a forward plan', () => {
    const rows = [
      elapsedPlanWeek(
        '2026-04-06',
        { productionFte: 100, requiredFte: 110, attritionHc: 1, shrinkagePct: 0.16, ahtSeconds: 240, volume: 1200 },
        { productionFte: 100, requiredFte: 110, attritionHc: 3, shrinkagePct: 0.2, ahtSeconds: 300, handledVolume: 1000 },
      ),
    ]

    const accum = accumulateWeekGaps(rows, 0.75)
    const drivers = driversFor(accum)

    expect(drivers.aht).toBeGreaterThan(0)
    expect(drivers.attrition).toBeGreaterThan(0)
    expect(drivers.absenteeism).toBeGreaterThan(0)
    expect(drivers.inOfficeShrinkage).toBeGreaterThan(0)
    // The hourly fixture states no per-contact rate, so the gap is checked in contacts.
    expect(accum.volumeGap).toBe(200)
  })
})

describe('volume leakage guard', () => {
  it('does not book the whole forecast as missed when no actual volume was recorded', () => {
    const rows = [
      actualWeek(
        '2026-04-06',
        { ahtSeconds: 240, volume: 1200 },
        { ahtSeconds: 240, handledVolume: null, volume: 0 },
      ),
    ]

    expect(accumulateWeekGaps(rows, 0.5).volumeGap).toBe(0)
  })

  it('still measures a genuine shortfall', () => {
    const rows = [
      actualWeek(
        '2026-04-06',
        { ahtSeconds: 240, volume: 1200 },
        { ahtSeconds: 240, handledVolume: 900 },
      ),
    ]

    expect(accumulateWeekGaps(rows, 0.5).volumeGap).toBe(300)
  })
})

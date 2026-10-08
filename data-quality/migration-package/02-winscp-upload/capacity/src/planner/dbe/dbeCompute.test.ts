import { describe, expect, it } from 'vitest'
import { computeDbeMonth, createDbeLine, emptyMonthInput, type DbeLobLine } from './dbePersistence'

const MONTH = '2026-04'

function line(overrides: Partial<Omit<DbeLobLine, 'id' | 'createdAt' | 'updatedAt'>> = {}): DbeLobLine {
  return createDbeLine({
    clientName: 'Contoso',
    lobProjectName: 'Voice',
    location: 'Manila',
    projectCode: '',
    billingType: 'Prod hours',
    agentGroup: '',
    billRateMethod: 'hourly',
    defaults: {
      aht: 535,
      loginHours: 7.5,
      absenteeismPct: 12,
      shrinkagePct: 10,
      occupancyPct: 85,
      hourlyBillRate: 20,
      monthlyBillRate: 0,
      perMinuteBillRate: 0,
    },
    useStaffingAbsenteeismShrinkage: false,
    months: { [MONTH]: { ...emptyMonthInput(), capacity: 100_000 } },
    revenueAdjustments: [],
    costItems: [],
    rowRemarks: {},
    ...overrides,
  })
}

describe('computeDbeMonth — hourly revenue', () => {
  it('bills capacity-billed hours as Required FTE x rate x productive hours', () => {
    const computed = computeDbeMonth(line(), MONTH)

    expect(computed.fteBilling).toBe(false)
    expect(computed.requiredFte).toBeGreaterThan(0)
    expect(computed.totalRevenue).toBe(
      Math.round(computed.requiredFte * 20 * computed.productiveHours),
    )
  })

  it('gives a capacity-billed line the same revenue as the FTE-billed equivalent', () => {
    // The two branches describe the same work, so substituting Required FTE for entered
    // FTE must reconcile. The old formula divided by loginHours squared and returned
    // roughly 60x this figure.
    const capacityBilled = computeDbeMonth(line(), MONTH)

    const fteEquivalent = computeDbeMonth(
      line({
        billingType: 'FTE',
        months: {
          [MONTH]: { ...emptyMonthInput(), capacity: 100_000, fte: capacityBilled.requiredFte },
        },
      }),
      MONTH,
    )

    expect(fteEquivalent.fteBilling).toBe(true)
    expect(capacityBilled.totalRevenue).toBe(fteEquivalent.totalRevenue)
  })

  it('keeps hourly revenue proportional to volume', () => {
    const single = computeDbeMonth(line(), MONTH)
    const double = computeDbeMonth(
      line({ months: { [MONTH]: { ...emptyMonthInput(), capacity: 200_000 } } }),
      MONTH,
    )
    expect(double.totalRevenue).toBeCloseTo(single.totalRevenue * 2, -1)
  })
})

describe('computeDbeMonth — cost modes', () => {
  it('scales $ per productive hour by headcount, not by one FTE', () => {
    const costItems = [
      {
        id: 'cost-people',
        label: 'People Cost',
        mode: 'per_productive_hour' as const,
        defaultValue: 5,
        months: {},
        breakdown: [],
      },
    ]

    const computed = computeDbeMonth(line({ costItems }), MONTH)
    const expected = Math.round(computed.requiredFte * computed.productiveHours * 5)

    expect(computed.costByItem['cost-people']).toBe(expected)
    // Guards the regression: the old form ignored headcount entirely.
    expect(computed.costByItem['cost-people']).not.toBe(
      Math.round(computed.productiveHours * 5),
    )
  })

  it('scales $ per FTE by the required headcount for capacity-billed lines', () => {
    const computed = computeDbeMonth(
      line({
        costItems: [
          {
            id: 'cost-people',
            label: 'People Cost',
            mode: 'per_fte' as const,
            defaultValue: 1000,
            months: {},
            breakdown: [],
          },
        ],
      }),
      MONTH,
    )
    expect(computed.costByItem['cost-people']).toBe(Math.round(computed.requiredFte * 1000))
  })
})

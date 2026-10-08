import { describe, expect, it } from 'vitest'
import {
  computeRevenueProjectionMonth,
  DEFAULT_REV_PROJ_DEFAULTS,
  emptyMonthInput,
  enabledBillRateMethods,
  normalizeLine,
  zeroInactiveBillRates,
  type RevenueProjectionLobLine,
} from './revenueProjectionPersistence'

function baseLine(partial: Partial<RevenueProjectionLobLine> = {}): RevenueProjectionLobLine {
  return normalizeLine({
    id: 'line-1',
    clientName: 'Apex Retail',
    lobProjectName: 'ABC Voice',
    location: 'Manila',
    projectCode: '1234',
    billingType: 'Production Hours',
    agentGroup: '',
    billRateMethod: 'hourly',
    defaults: { ...DEFAULT_REV_PROJ_DEFAULTS },
    useStaffingAbsenteeismShrinkage: false,
    months: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  })
}

describe('bill rate defaults and methods', () => {
  it('defaults unused rates to 0 when hourly is the primary method', () => {
    expect(DEFAULT_REV_PROJ_DEFAULTS.hourlyBillRate).toBe(22)
    expect(DEFAULT_REV_PROJ_DEFAULTS.monthlyBillRate).toBe(0)
    expect(DEFAULT_REV_PROJ_DEFAULTS.perMinuteBillRate).toBe(0)
    expect(DEFAULT_REV_PROJ_DEFAULTS.perTransactionBillRate).toBe(0)
    expect(
      zeroInactiveBillRates('hourly', {
        hourlyBillRate: 22,
        monthlyBillRate: 2500,
        perMinuteBillRate: 0.4,
        perTransactionBillRate: 1.25,
      }),
    ).toEqual({
      hourlyBillRate: 22,
      monthlyBillRate: 0,
      perMinuteBillRate: 0,
      perTransactionBillRate: 0,
    })
  })

  it('keeps the primary method when additional methods are omitted from storage', () => {
    const line = normalizeLine({
      id: 'legacy',
      billRateMethod: 'hourly',
    } as RevenueProjectionLobLine)
    expect(enabledBillRateMethods(line)).toEqual(['hourly'])
  })

  it('includes additional bill methods without dropping the primary', () => {
    const line = baseLine({
      billRateMethod: 'hourly',
      billRateMethods: ['per_transaction'],
    })
    expect(enabledBillRateMethods(line)).toEqual(['hourly', 'per_transaction'])
  })
})

describe('computeRevenueProjectionMonth bill rates', () => {
  it('bills per chat / sale / transaction as capacity × unit rate only', () => {
    const line = baseLine({
      billingType: 'Transactional',
      billRateMethod: 'per_transaction',
      billRateMethods: ['per_transaction'],
      defaults: {
        ...DEFAULT_REV_PROJ_DEFAULTS,
        hourlyBillRate: 22,
        monthlyBillRate: 2500,
        perMinuteBillRate: 0.4,
        perTransactionBillRate: 1.25,
      },
      months: {
        '2026-01': { ...emptyMonthInput(), capacity: 1000, aht: 300 },
      },
    })
    const computed = computeRevenueProjectionMonth(line, '2026-01')
    expect(computed.totalRevenue).toBe(1250)
  })

  it('does not substitute monthly or per-minute when hourly is enabled and those rates are leftover', () => {
    const line = baseLine({
      billRateMethod: 'hourly',
      billRateMethods: ['hourly'],
      defaults: {
        ...DEFAULT_REV_PROJ_DEFAULTS,
        hourlyBillRate: 22,
        monthlyBillRate: 2500,
        perMinuteBillRate: 0.4,
        perTransactionBillRate: 3,
        loginHours: 8,
        shrinkagePct: 15,
      },
      months: {
        '2026-01': { ...emptyMonthInput(), capacity: 1000, aht: 300 },
      },
    })
    const hourlyOnly = computeRevenueProjectionMonth(line, '2026-01').totalRevenue
    expect(hourlyOnly).toBe(Math.round(1000 * (300 / 3600) * 22))
    expect(hourlyOnly).toBeGreaterThan(0)
  })

  it('sums hourly and per-transaction when both methods are enabled', () => {
    const line = baseLine({
      billRateMethod: 'hourly',
      billRateMethods: ['hourly', 'per_transaction'],
      defaults: {
        ...DEFAULT_REV_PROJ_DEFAULTS,
        hourlyBillRate: 22,
        monthlyBillRate: 0,
        perMinuteBillRate: 0,
        perTransactionBillRate: 2,
        loginHours: 8,
        shrinkagePct: 15,
      },
      months: {
        '2026-01': { ...emptyMonthInput(), capacity: 1000, aht: 300 },
      },
    })
    const hourly = Math.round(1000 * (300 / 3600) * 22)
    expect(computeRevenueProjectionMonth(line, '2026-01').totalRevenue).toBe(hourly + 2000)
  })

  it('reports GM % from revenue and cost', () => {
    const line = baseLine({
      billRateMethod: 'per_transaction',
      billRateMethods: ['per_transaction'],
      defaults: {
        ...DEFAULT_REV_PROJ_DEFAULTS,
        perTransactionBillRate: 10,
        hourlySalaryUsd: 0,
        monthlyLaborPerFteUsd: 0,
      },
      months: {
        '2026-01': { ...emptyMonthInput(), capacity: 100 },
      },
    })
    const computed = computeRevenueProjectionMonth(line, '2026-01')
    expect(computed.totalRevenue).toBe(1000)
    expect(computed.gmPct).toBeCloseTo((computed.grossMargin / 1000) * 100)
  })

  it('does not invent productive hours when FTE hourly availability is zero', () => {
    const line = baseLine({
      billingType: 'FTE',
      billRateMethod: 'hourly',
      defaults: {
        ...DEFAULT_REV_PROJ_DEFAULTS,
        hourlyBillRate: 22,
        absenteeismPct: 50,
        shrinkagePct: 50,
      },
      months: {
        '2026-01': { ...emptyMonthInput(), fte: 10 },
      },
    })
    expect(computeRevenueProjectionMonth(line, '2026-01').productiveHours).toBe(0)
    expect(computeRevenueProjectionMonth(line, '2026-01').totalRevenue).toBe(0)
  })

  it('uses FTE × hourly × productive hours when FTE billing has hours', () => {
    const line = baseLine({
      billingType: 'FTE',
      billRateMethod: 'hourly',
      defaults: {
        ...DEFAULT_REV_PROJ_DEFAULTS,
        hourlyBillRate: 20,
        loginHours: 8,
        absenteeismPct: 0,
        shrinkagePct: 0,
      },
      months: {
        '2026-01': { ...emptyMonthInput(), fte: 2 },
      },
    })
    const computed = computeRevenueProjectionMonth(line, '2026-01')
    expect(computed.totalRevenue).toBe(Math.round(2 * 20 * computed.productiveHours))
  })

  it('applies signed revenue factors after billed methods', () => {
    const line = baseLine({
      billRateMethod: 'per_transaction',
      billRateMethods: ['per_transaction'],
      defaults: {
        ...DEFAULT_REV_PROJ_DEFAULTS,
        perTransactionBillRate: 10,
        hourlySalaryUsd: 0,
        monthlyLaborPerFteUsd: 0,
        revenueFactorPct: 10,
        revenueAdjustmentUsd: -50,
      },
      months: {
        '2026-01': { ...emptyMonthInput(), capacity: 100 },
      },
    })
    expect(computeRevenueProjectionMonth(line, '2026-01').totalRevenue).toBe(Math.round(1000 * 1.1 - 50))
  })

  it('lets a month-level negative factor cut revenue and still floors at 0 after discount', () => {
    const line = baseLine({
      billRateMethod: 'per_transaction',
      billRateMethods: ['per_transaction'],
      defaults: {
        ...DEFAULT_REV_PROJ_DEFAULTS,
        perTransactionBillRate: 10,
        hourlySalaryUsd: 0,
      },
      months: {
        '2026-01': {
          ...emptyMonthInput(),
          capacity: 100,
          revenueFactorPct: -25,
          discountOrLessToRevenue: 900,
        },
      },
    })
    expect(computeRevenueProjectionMonth(line, '2026-01').totalRevenue).toBe(0)
  })

  it('uses optional GM costs only when they are filled', () => {
    const line = baseLine({
      billRateMethod: 'per_transaction',
      billRateMethods: ['per_transaction'],
      defaults: {
        ...DEFAULT_REV_PROJ_DEFAULTS,
        perTransactionBillRate: 10,
        hourlySalaryUsd: 0,
        monthlyLaborPerFteUsd: 0,
        supportSalaryUsd: 0,
        trainingSalaryRateUsd: 0,
        otherCostUsd: 0,
      },
      months: {
        '2026-01': { ...emptyMonthInput(), capacity: 100 },
      },
    })
    const computed = computeRevenueProjectionMonth(line, '2026-01')
    expect(computed.totalRevenue).toBe(1000)
    expect(computed.totalCost).toBe(0)
    expect(computed.grossMargin).toBe(1000)
  })

  it('applies custom-named percent and dollar factors and keeps the names', () => {
    const line = baseLine({
      billRateMethod: 'per_transaction',
      billRateMethods: ['per_transaction'],
      defaults: {
        ...DEFAULT_REV_PROJ_DEFAULTS,
        perTransactionBillRate: 10,
        hourlySalaryUsd: 0,
      },
      revenueFactors: [
        { id: 'peak', name: 'Peak season uplift', kind: 'percent', defaultValue: 10 },
        { id: 'sla', name: 'SLA bonus', kind: 'amount', defaultValue: 200 },
      ],
      months: {
        '2026-01': {
          ...emptyMonthInput(),
          capacity: 100,
          factorValues: { peak: 5 },
        },
      },
    })
    expect(line.revenueFactors.map((factor) => factor.name)).toEqual(['Peak season uplift', 'SLA bonus'])
    expect(computeRevenueProjectionMonth(line, '2026-01').totalRevenue).toBe(Math.round(1000 * 1.05 + 200))
  })

  it('drops unnamed empty factors and migrates legacy percent defaults', () => {
    const line = baseLine({
      defaults: {
        ...DEFAULT_REV_PROJ_DEFAULTS,
        revenueFactorPct: 8,
      },
      revenueFactors: [{ id: 'blank', name: '  ', kind: 'percent', defaultValue: 0 }],
    })
    expect(line.revenueFactors).toHaveLength(1)
    expect(line.revenueFactors[0]?.id).toBe('legacy-percent')
    expect(line.revenueFactors[0]?.defaultValue).toBe(8)
  })

  it('uses Capacity Plan FTE and capacity unless the month is a typed override', () => {
    const line = baseLine({
      billingType: 'FTE',
      billRateMethod: 'hourly',
      defaults: { ...DEFAULT_REV_PROJ_DEFAULTS, hourlyBillRate: 24, absenteeismPct: 0, shrinkagePct: 0 },
      months: { '2026-01': emptyMonthInput() },
    })
    const fromPlan = computeRevenueProjectionMonth(line, '2026-01', { fte: 10, capacity: 400 })
    expect(fromPlan.fte).toBe(10)
    expect(fromPlan.capacity).toBe(400)

    const savedStartingHc = computeRevenueProjectionMonth(
      baseLine({
        billingType: 'FTE',
        billRateMethod: 'hourly',
        defaults: { ...DEFAULT_REV_PROJ_DEFAULTS, hourlyBillRate: 24, absenteeismPct: 0, shrinkagePct: 0 },
        months: { '2026-01': { ...emptyMonthInput(), fte: 20, capacity: 26500 } },
      }),
      '2026-01',
      { fte: 18.5, capacity: 400 },
    )
    expect(savedStartingHc.fte).toBe(18.5)
    expect(savedStartingHc.capacity).toBe(400)

    const manual = computeRevenueProjectionMonth(
      baseLine({
        billingType: 'FTE',
        billRateMethod: 'hourly',
        defaults: { ...DEFAULT_REV_PROJ_DEFAULTS, hourlyBillRate: 24, absenteeismPct: 0, shrinkagePct: 0 },
        months: {
          '2026-01': { ...emptyMonthInput(), fte: 6, capacity: 50, fteManual: true, capacityManual: true },
        },
      }),
      '2026-01',
      { fte: 10, capacity: 400 },
    )
    expect(manual.fte).toBe(6)
    expect(manual.capacity).toBe(50)
  })

  it('folds Salary and OPEX cost lines into total cost and gross margin', () => {
    const withoutExtras = computeRevenueProjectionMonth(
      baseLine({
        billingType: 'FTE',
        billRateMethod: 'hourly',
        defaults: {
          ...DEFAULT_REV_PROJ_DEFAULTS,
          hourlyBillRate: 20,
          hourlySalaryUsd: 10,
          supportSalaryUsd: 0,
          trainingSalaryRateUsd: 0,
          otherCostUsd: 0,
          absenteeismPct: 0,
          shrinkagePct: 0,
          occupancyPct: 100,
        },
        months: { '2026-01': { ...emptyMonthInput(), fte: 5, fteManual: true } },
      }),
      '2026-01',
    )
    const withExtras = computeRevenueProjectionMonth(
      baseLine({
        billingType: 'FTE',
        billRateMethod: 'hourly',
        defaults: {
          ...DEFAULT_REV_PROJ_DEFAULTS,
          hourlyBillRate: 20,
          hourlySalaryUsd: 10,
          supportSalaryUsd: 0,
          trainingSalaryRateUsd: 0,
          otherCostUsd: 0,
          absenteeismPct: 0,
          shrinkagePct: 0,
          occupancyPct: 100,
        },
        costLines: [
          { id: 'sal-1', name: 'Leads', category: 'Salary', amountUsdPerWeek: 100 },
          { id: 'opx-1', name: 'Licenses', category: 'OPEX', amountUsdPerWeek: 50 },
        ],
        months: { '2026-01': { ...emptyMonthInput(), fte: 5, fteManual: true } },
      }),
      '2026-01',
    )
    const weeksInMonth = withoutExtras.networkDays / 5
    expect(withExtras.totalCost).toBe(withoutExtras.totalCost + Math.round(150 * weeksInMonth))
    expect(withExtras.grossMargin).toBe(withExtras.totalRevenue - withExtras.totalCost)
    expect(withExtras.totalRevenue).toBe(withoutExtras.totalRevenue)
  })

  it('accepts custom cost categories and still folds them into total cost', () => {
    const line = normalizeLine({
      ...baseLine({
        billingType: 'FTE',
        billRateMethod: 'hourly',
        defaults: {
          ...DEFAULT_REV_PROJ_DEFAULTS,
          hourlyBillRate: 20,
          hourlySalaryUsd: 10,
          supportSalaryUsd: 0,
          trainingSalaryRateUsd: 0,
          otherCostUsd: 0,
          absenteeismPct: 0,
          shrinkagePct: 0,
          occupancyPct: 100,
        },
        costLines: [
          { id: 'c1', name: 'HMO', category: 'Benefits', amountUsdPerWeek: 40 },
          { id: 'c2', name: 'Rent', category: 'Facilities', amountUsdPerWeek: 60 },
          { id: 'c3', name: 'Legacy', category: 'salary', amountUsdPerWeek: 20 },
        ],
        months: { '2026-01': { ...emptyMonthInput(), fte: 5, fteManual: true } },
      }),
    })
    expect(line.costLines.map((row) => row.category)).toEqual(['Benefits', 'Facilities', 'Salary'])
    const without = computeRevenueProjectionMonth(
      baseLine({
        billingType: 'FTE',
        billRateMethod: 'hourly',
        defaults: {
          ...DEFAULT_REV_PROJ_DEFAULTS,
          hourlyBillRate: 20,
          hourlySalaryUsd: 10,
          supportSalaryUsd: 0,
          trainingSalaryRateUsd: 0,
          otherCostUsd: 0,
          absenteeismPct: 0,
          shrinkagePct: 0,
          occupancyPct: 100,
        },
        months: { '2026-01': { ...emptyMonthInput(), fte: 5, fteManual: true } },
      }),
      '2026-01',
    )
    const withCustom = computeRevenueProjectionMonth(line, '2026-01')
    const weeksInMonth = without.networkDays / 5
    expect(withCustom.totalCost).toBe(without.totalCost + Math.round(120 * weeksInMonth))
  })
})

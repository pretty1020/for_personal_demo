import { describe, expect, it } from 'vitest'
import type { WeekCapacityPlanOverride } from '../capacityPlanOverridePersistence'
import type { ShrinkageCategoryTemplate } from '../shrinkageCategories'
import type { PlannerScenario } from '../types'
import type { WeeklyLedgerRow } from '../weeklyLedger'
import {
  plannedValueToRate,
  rateToPctPoints,
  resolveStaffingMonthDrivers,
  type StaffingDriverLookup,
} from './staffingMonthDrivers'
import {
  computeRevenueProjectionMonth,
  DEFAULT_REV_PROJ_DEFAULTS,
  emptyMonthInput,
  listFiscalMonthKeys,
  type RevenueProjectionLobLine,
} from './revenueProjectionPersistence'

function line(partial: Partial<RevenueProjectionLobLine> = {}): RevenueProjectionLobLine {
  return {
    id: 'line-1',
    clientName: 'Apex Retail',
    lobProjectName: 'ABC',
    location: 'Manila',
    projectCode: '1234',
    billingType: 'Production Hours',
    agentGroup: '',
    billRateMethod: 'hourly',
    billRateMethods: ['hourly'],
    channel: 'voice',
    defaults: { ...DEFAULT_REV_PROJ_DEFAULTS },
    useStaffingAbsenteeismShrinkage: true,
    months: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
    revenueFactors: partial.revenueFactors ?? [],
    costLines: partial.costLines ?? [],
  }
}

function scenario(): PlannerScenario {
  return {
    id: 'sc-1',
    name: 'Apex Retail — ABC',
    isBaseline: false,
    plan: {
      client: 'Apex Retail',
      location: 'Manila',
      lob: 'ABC',
      projectCode: '1234',
    },
  } as PlannerScenario
}

const categories: ShrinkageCategoryTemplate[] = [
  { id: 'absenteeism', name: 'Absenteeism', group: 'out_of_office', billable: false, share: 1 },
  { id: 'break', name: 'Break', group: 'in_office', billable: false, share: 0 },
  { id: 'aux', name: 'Aux', group: 'in_office', billable: false, share: 0 },
]

function lookup(
  overrides: Record<string, WeekCapacityPlanOverride>,
  ledger: WeeklyLedgerRow[] = [],
  capacityRows: { week: string; productionFte: number; volume: number }[] = [],
): StaffingDriverLookup {
  const sc = scenario()
  return {
    scenarios: [sc],
    getLedger: () => ledger,
    getOverrides: () => overrides,
    getShrinkageCategories: () => categories,
    getCapacityRows: () => capacityRows,
  }
}

describe('plannedValueToRate', () => {
  it('keeps 0–1 rates and converts percent-point values', () => {
    expect(plannedValueToRate(0.15)).toBeCloseTo(0.15)
    expect(plannedValueToRate(15)).toBeCloseTo(0.15)
    expect(plannedValueToRate(-4)).toBe(0)
    expect(plannedValueToRate(Number.NaN)).toBe(0)
  })

  it('clamps rates above 100%', () => {
    expect(plannedValueToRate(150)).toBe(1)
    expect(rateToPctPoints(1.4)).toBe(100)
  })
})

describe('resolveStaffingMonthDrivers', () => {
  it('includes Break in Total in office shrinkage', () => {
    const drivers = resolveStaffingMonthDrivers(
      line(),
      '2026-01',
      lookup({
        '2026-01-05': {
          shrinkageById: {
            absenteeism: 0.08,
            break: 0.05,
            aux: 0.1,
          },
        },
      }),
    )
    expect(drivers.hasData).toBe(true)
    expect(drivers.absenteeismPct).toBe(8)
    expect(drivers.shrinkagePct).toBe(15)
  })

  it('accepts legacy percent-point staffing values', () => {
    const drivers = resolveStaffingMonthDrivers(
      line(),
      '2026-02',
      lookup({
        '2026-02-02': {
          shrinkageById: {
            break: 5,
            aux: 10,
          },
        },
      }),
    )
    expect(drivers.hasData).toBe(true)
    expect(drivers.shrinkagePct).toBe(15)
  })

  it('returns hasData false and zeros when the month has no planned values', () => {
    const drivers = resolveStaffingMonthDrivers(line(), '2026-03', lookup({}))
    expect(drivers.hasData).toBe(false)
    expect(drivers.absenteeismPct).toBe(0)
    expect(drivers.shrinkagePct).toBe(0)
    expect(drivers.hasVolumeData).toBe(false)
    expect(drivers.matchedScenarioId).toBe('sc-1')
  })

  it('averages FTE and sums capacity for weeks owned by the month', () => {
    const drivers = resolveStaffingMonthDrivers(
      line(),
      '2026-08',
      lookup(
        {},
        [],
        [
          { week: '2026-08-16', productionFte: 19, volume: 100 },
          { week: '2026-08-23', productionFte: 17, volume: 80 },
          { week: '2026-08-30', productionFte: 7, volume: 50 },
        ],
      ),
    )
    expect(drivers.hasVolumeData).toBe(true)
    expect(drivers.weekCount).toBe(2)
    expect(drivers.fte).toBe(18)
    expect(drivers.capacity).toBe(180)
  })

  it('counts the week of 30 Aug in September', () => {
    const drivers = resolveStaffingMonthDrivers(
      line(),
      '2026-09',
      lookup({}, [], [{ week: '2026-08-30', productionFte: 7, volume: 50 }]),
    )
    expect(drivers.fte).toBe(7)
    expect(drivers.capacity).toBe(50)
    expect(drivers.weekCount).toBe(1)
  })
})

describe('computeRevenueProjectionMonth fallbacks', () => {
  it('uses LOB defaults when month cells and staffing options are empty', () => {
    const computed = computeRevenueProjectionMonth(line({ months: {} }), '2026-01')
    expect(computed.absenteeismPct).toBe(DEFAULT_REV_PROJ_DEFAULTS.absenteeismPct)
    expect(computed.shrinkagePct).toBe(DEFAULT_REV_PROJ_DEFAULTS.shrinkagePct)
    expect(computed.loginHours).toBe(DEFAULT_REV_PROJ_DEFAULTS.loginHours)
  })

  it('uses month input over defaults, and staffing options over both', () => {
    const withMonth = computeRevenueProjectionMonth(
      line({
        months: {
          '2026-01': { ...emptyMonthInput(), shrinkagePct: 12, absenteeismPct: 6 },
        },
      }),
      '2026-01',
    )
    expect(withMonth.shrinkagePct).toBe(12)
    expect(withMonth.absenteeismPct).toBe(6)

    const withStaffing = computeRevenueProjectionMonth(
      line({
        months: {
          '2026-01': { ...emptyMonthInput(), shrinkagePct: 12, absenteeismPct: 6 },
        },
      }),
      '2026-01',
      { absenteeismPct: 8, shrinkagePct: 15 },
    )
    expect(withStaffing.absenteeismPct).toBe(8)
    expect(withStaffing.shrinkagePct).toBe(15)
  })

  it('ignores non-finite staffing overrides', () => {
    const computed = computeRevenueProjectionMonth(line(), '2026-01', {
      absenteeismPct: Number.NaN,
      shrinkagePct: Number.POSITIVE_INFINITY,
    })
    expect(computed.absenteeismPct).toBe(DEFAULT_REV_PROJ_DEFAULTS.absenteeismPct)
    expect(computed.shrinkagePct).toBe(DEFAULT_REV_PROJ_DEFAULTS.shrinkagePct)
  })

  it('lists twelve valid month keys even for a bad year', () => {
    expect(listFiscalMonthKeys(Number.NaN)).toHaveLength(12)
    expect(listFiscalMonthKeys(2027)[0]).toBe('2027-01')
    expect(listFiscalMonthKeys(2027)[11]).toBe('2027-12')
  })
})

import { describe, expect, it } from 'vitest'
import { weeklyRevenueFromSpec, type WeeklyBillingSpec } from './capacityBillingRevenue'
import { productionLaborWeekly, type FinancialCostInputs } from './capacityFinancialCosts'
import { networkDaysInMonth } from './revenueProjections/networkDays'
import { NETWORK_DAYS_PER_WEEK } from './weeklyFinancialAlign'
import {
  computeRevenueProjectionMonth,
  DEFAULT_REV_PROJ_DEFAULTS,
  emptyMonthInput,
  normalizeLine,
  type RevenueProjectionLobLine,
} from './revenueProjections/revenueProjectionPersistence'

const hourlySpec: WeeklyBillingSpec = {
  billingType: 'Production Hours',
  billRateMethod: 'hourly',
  hourlyBillRate: 22,
  monthlyBillRate: 2500,
  perMinuteBillRate: 0.4,
  perTransactionBillRate: 1.5,
}

function rpLine(partial: Partial<RevenueProjectionLobLine> = {}): RevenueProjectionLobLine {
  return normalizeLine({
    id: 'line-1',
    clientName: 'Apex Retail',
    lobProjectName: 'ABC Voice',
    location: 'Manila',
    projectCode: '1234',
    billingType: 'FTE',
    agentGroup: '',
    billRateMethod: 'hourly',
    defaults: { ...DEFAULT_REV_PROJ_DEFAULTS, hourlyBillRate: 24, loginHours: 8, absenteeismPct: 5, shrinkagePct: 10 },
    useStaffingAbsenteeismShrinkage: false,
    months: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  })
}

describe('weeklyRevenueFromSpec', () => {
  it('bills Production Hours hourly from Production FTE hours, not volume', () => {
    const at19 = weeklyRevenueFromSpec(
      { productionFte: 19, productionHc: 19, volume: 500, ahtSeconds: 300 },
      { ...hourlySpec, hourlyBillRate: 24, loginHours: 8, absenteeismPct: 5, shrinkagePct: 10 },
      40,
    )
    const at7 = weeklyRevenueFromSpec(
      { productionFte: 7, productionHc: 7, volume: 500, ahtSeconds: 300 },
      { ...hourlySpec, hourlyBillRate: 24, loginHours: 8, absenteeismPct: 5, shrinkagePct: 10 },
      40,
    )
    const weeklyHours = 5 * 8 * (1 - 0.05 - 0.1)
    expect(at19).toBeCloseTo(19 * weeklyHours * 24, 6)
    expect(at7).toBeCloseTo(7 * weeklyHours * 24, 6)
    expect(at19).toBeGreaterThan(at7)
  })

  it('converts Transactional volume to hours then × hourly rate (not FTE × 40)', () => {
    const revenue = weeklyRevenueFromSpec(
      { productionFte: 10, productionHc: 10, volume: 500, ahtSeconds: 300 },
      { ...hourlySpec, billingType: 'Transactional' },
      40,
    )
    expect(revenue).toBe(500 * (300 / 3600) * 22)
  })

  it('converts Production FTE to hours then × hourly rate when billing type is FTE', () => {
    const revenue = weeklyRevenueFromSpec(
      { productionFte: 10, productionHc: 10, volume: 500, ahtSeconds: 300 },
      {
        ...hourlySpec,
        billingType: 'FTE',
        loginHours: 8,
        absenteeismPct: 5,
        shrinkagePct: 10,
        hourlyBillRate: 24,
      },
      40,
    )
    const weeklyHours = 5 * 8 * (1 - 0.05 - 0.1)
    expect(revenue).toBeCloseTo(10 * weeklyHours * 24, 6)
  })

  it('does not substitute FTE hours when transactional hourly volume or AHT is missing', () => {
    const spec = { ...hourlySpec, billingType: 'Transactional' as const }
    const noVolume = weeklyRevenueFromSpec(
      { productionFte: 10, productionHc: 10, volume: 0, ahtSeconds: 300 },
      spec,
      40,
    )
    const noAht = weeklyRevenueFromSpec(
      { productionFte: 10, productionHc: 10, volume: 500, ahtSeconds: 0 },
      spec,
      40,
    )
    expect(noVolume).toBe(0)
    expect(noAht).toBe(0)
  })

  it('bills per chat / sale / transaction as volume × unit rate', () => {
    const revenue = weeklyRevenueFromSpec(
      { productionFte: 10, productionHc: 10, volume: 400, ahtSeconds: 180 },
      {
        ...hourlySpec,
        billingType: 'Transactional',
        billRateMethod: 'per_transaction',
        billRateMethods: ['per_transaction'],
      },
      40,
    )
    expect(revenue).toBe(400 * 1.5)
  })

  it('does not substitute FTE hours when transactional per-minute volume or AHT is missing', () => {
    const spec = {
      ...hourlySpec,
      billingType: 'Transactional' as const,
      billRateMethod: 'per_minute' as const,
      billRateMethods: ['per_minute' as const],
    }
    const noVolume = weeklyRevenueFromSpec(
      { productionFte: 10, productionHc: 10, volume: 0, ahtSeconds: 300 },
      spec,
      40,
    )
    const noAht = weeklyRevenueFromSpec(
      { productionFte: 10, productionHc: 10, volume: 500, ahtSeconds: 0 },
      spec,
      40,
    )
    expect(noVolume).toBe(0)
    expect(noAht).toBe(0)
  })

  it('sums enabled methods and ignores disabled leftover rates', () => {
    const combined = weeklyRevenueFromSpec(
      { productionFte: 10, productionHc: 10, volume: 400, ahtSeconds: 180 },
      {
        billingType: 'Transactional',
        billRateMethod: 'hourly',
        billRateMethods: ['hourly', 'per_transaction'],
        hourlyBillRate: 22,
        monthlyBillRate: 2500,
        perMinuteBillRate: 0.4,
        perTransactionBillRate: 1.5,
      },
      40,
    )
    expect(combined).toBe(400 * (180 / 3600) * 22 + 400 * 1.5)
  })
})

describe('weekly Overview aligns to monthly Revenue Projection', () => {
  it('FTE hourly $24: week × (network days ÷ 5) matches the month', () => {
    const month = '2026-01'
    const line = rpLine({
      months: { [month]: { ...emptyMonthInput(), fte: 10 } },
    })
    const monthly = computeRevenueProjectionMonth(line, month)
    const weekly = weeklyRevenueFromSpec(
      { productionFte: 10, productionHc: 10, volume: 0, ahtSeconds: 0 },
      {
        billingType: 'FTE',
        billRateMethod: 'hourly',
        hourlyBillRate: 24,
        monthlyBillRate: 0,
        perMinuteBillRate: 0,
        perTransactionBillRate: 0,
        loginHours: 8,
        absenteeismPct: 5,
        shrinkagePct: 10,
      },
      40,
      undefined,
      `${month}-05`,
    )
    const weeksInMonth = networkDaysInMonth(month) / NETWORK_DAYS_PER_WEEK
    expect(weekly * weeksInMonth).toBeCloseTo(monthly.totalRevenue, 0)
  })

  it('Production Hours hourly $24: week × (network days ÷ 5) matches the month when FTE is entered', () => {
    const month = '2026-01'
    const line = rpLine({
      billingType: 'Production Hours',
      defaults: {
        ...DEFAULT_REV_PROJ_DEFAULTS,
        hourlyBillRate: 24,
        loginHours: 8,
        absenteeismPct: 5,
        shrinkagePct: 10,
      },
      months: { [month]: { ...emptyMonthInput(), fte: 10, capacity: 2200, aht: 300 } },
    })
    const monthly = computeRevenueProjectionMonth(line, month)
    const weekly = weeklyRevenueFromSpec(
      { productionFte: 10, productionHc: 10, volume: 2200, ahtSeconds: 300 },
      {
        billingType: 'Production Hours',
        billRateMethod: 'hourly',
        hourlyBillRate: 24,
        monthlyBillRate: 0,
        perMinuteBillRate: 0,
        perTransactionBillRate: 0,
        loginHours: 8,
        absenteeismPct: 5,
        shrinkagePct: 10,
      },
      40,
      undefined,
      `${month}-05`,
    )
    const weeksInMonth = networkDaysInMonth(month) / NETWORK_DAYS_PER_WEEK
    expect(weekly * weeksInMonth).toBeCloseTo(monthly.totalRevenue, 0)
  })

  it('Transactional hourly $24: weekly volume hours × weeks match monthly capacity hours', () => {
    const month = '2026-01'
    const capacity = 2200
    const aht = 300
    const line = rpLine({
      billingType: 'Transactional',
      defaults: { ...DEFAULT_REV_PROJ_DEFAULTS, hourlyBillRate: 24 },
      months: { [month]: { ...emptyMonthInput(), capacity, aht } },
    })
    const monthly = computeRevenueProjectionMonth(line, month)
    const weeksInMonth = networkDaysInMonth(month) / NETWORK_DAYS_PER_WEEK
    const weeklyVolume = capacity / weeksInMonth
    const weekly = weeklyRevenueFromSpec(
      { productionFte: 10, productionHc: 10, volume: weeklyVolume, ahtSeconds: aht },
      {
        billingType: 'Transactional',
        billRateMethod: 'hourly',
        hourlyBillRate: 24,
        monthlyBillRate: 0,
        perMinuteBillRate: 0,
        perTransactionBillRate: 0,
      },
      40,
      undefined,
      `${month}-05`,
    )
    expect(weekly * weeksInMonth).toBeCloseTo(monthly.totalRevenue, 0)
    expect(weekly).toBeCloseTo(weeklyVolume * (aht / 3600) * 24, 6)
  })

  it('weekly labor uses the same productive hours so FTE cost scales to the month', () => {
    const month = '2026-01'
    const line = rpLine({
      defaults: {
        ...DEFAULT_REV_PROJ_DEFAULTS,
        hourlyBillRate: 24,
        hourlySalaryUsd: 12,
        monthlyLaborPerFteUsd: 0,
        loginHours: 8,
        absenteeismPct: 5,
        shrinkagePct: 10,
        supportSalaryUsd: 0,
        trainingSalaryRateUsd: 0,
        otherCostUsd: 0,
      },
      months: { [month]: { ...emptyMonthInput(), fte: 10 } },
    })
    const monthly = computeRevenueProjectionMonth(line, month)
    const inputs: FinancialCostInputs = {
      hourlySalaryUsd: 12,
      supportSalaryUsd: 0,
      trainingSalaryRateUsd: 0,
      otherCostUsd: 0,
      standardHoursPerWeek: 40,
      loginHours: 8,
      absenteeismPct: 5,
      shrinkagePct: 10,
      monthlyLaborPerFteUsd: 0,
    }
    const weeklyLabor = productionLaborWeekly(10, inputs, undefined, `${month}-05`)
    const weeksInMonth = networkDaysInMonth(month) / NETWORK_DAYS_PER_WEEK
    expect(weeklyLabor * weeksInMonth).toBeCloseTo(monthly.totalCost, 0)
  })
})

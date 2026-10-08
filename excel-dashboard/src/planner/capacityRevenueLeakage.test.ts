import { afterEach, describe, expect, it } from 'vitest'
import {
  calculateCapacityRevenueLeakages,
  lostHeadWeeklyRevenue,
} from './capacityRevenueLeakage'
import type { CapacityMetricSnapshot, DerivedCapacityRow } from './capacityPlanDerived'
import { saveFormulaStore } from './formulas/formulaRegistry'

function snapshot(partial: Partial<CapacityMetricSnapshot> = {}): CapacityMetricSnapshot {
  return {
    beginningProductionHc: 10,
    plannedNewHires: 0,
    actualTrainingStartHc: 0,
    trainingHc: 0,
    nestingHc: 0,
    graduateHc: 0,
    trainingAttritionHc: 0,
    nestingAttritionHc: 0,
    attritionHc: 0,
    attritionPct: 0,
    trainingAttritionPct: null,
    nestingAttritionPct: null,
    transferInHc: 0,
    transferOutHc: 0,
    offRosterLoaHc: 0,
    supportHc: 0,
    volume: 1000,
    offeredVolume: 1000,
    handledVolume: 1000,
    ahtSeconds: 300,
    cappedAhtSeconds: 300,
    occupancy: 0.8,
    shrinkagePct: 0.15,
    nestingPhoneTimePct: 0,
    productionHc: 10,
    vlAllocationHc: 0,
    requiredFte: 10,
    coreProductionFte: 10,
    nestingProductiveFte: 0,
    productionFte: 10,
    staffingPct: 1,
    overUnderFte: 0,
    scheduledBillableHours: null,
    actualBillableHours: null,
    productiveHours: null,
    payrollHours: null,
    switchHours: null,
    seatCount: null,
    peakRatioPct: null,
    onsiteHc: null,
    wahHc: null,
    ...partial,
  }
}

function actualWeek(planned: CapacityMetricSnapshot, actual: CapacityMetricSnapshot): DerivedCapacityRow {
  return {
    periodIndex: 0,
    week: '2026-01-05',
    timeline: 'historical_actual',
    statusLabel: 'Actual',
    isCurrentPlanningWeek: false,
    planned,
    actual,
  }
}

describe('capacity revenue leakage', () => {
  afterEach(() => {
    saveFormulaStore({ overrides: [] })
  })
  it('prices understaffing at hours × hourly rate', () => {
    const row = actualWeek(snapshot({ productionHc: 10, productionFte: 10 }), snapshot({ productionHc: 8, productionFte: 8 }))
    const result = calculateCapacityRevenueLeakages([row], 'Production Hours', 22, 40, 12)
    expect(result.headcount).toBe(2 * 40 * 22)
    expect(result.overstaffing).toBe(0)
    expect(result.total).toBe(result.headcount)
  })

  it('prices overstaffing when actual HC exceeds plan', () => {
    const row = actualWeek(snapshot({ productionHc: 10, productionFte: 10 }), snapshot({ productionHc: 12, productionFte: 12 }))
    const result = calculateCapacityRevenueLeakages([row], 'Production Hours', 22, 40, 12)
    expect(result.overstaffing).toBe(2 * 40 * 22)
    expect(result.headcount).toBe(0)
    expect(result.total).toBe(result.overstaffing)
  })

  it('prices per-minute understaffing as hours × 60 × rate, not hours × rate', () => {
    const row = actualWeek(snapshot({ productionHc: 10 }), snapshot({ productionHc: 9 }))
    const perMinute = calculateCapacityRevenueLeakages([row], 'Per Minute', 0.4, 40, 12)
    expect(perMinute.headcount).toBe(1 * 40 * 60 * 0.4)
    expect(lostHeadWeeklyRevenue('per_minute', 0.4, 40, 1)).toBe(40 * 60 * 0.4)
  })

  it('prices transactional volume shortfall as missed handled units × rate', () => {
    const row = actualWeek(
      snapshot({ volume: 1000 }),
      snapshot({ volume: 800, offeredVolume: 800, handledVolume: 800 }),
    )
    const result = calculateCapacityRevenueLeakages([row], 'Transactional', 4, 40, 12)
    expect(result.volume).toBe(200 * 4)
  })

  it('prices hourly volume shortfall using planned AHT hours × rate', () => {
    const row = actualWeek(
      snapshot({ volume: 1000, ahtSeconds: 300, offeredVolume: 1000 }),
      snapshot({ volume: 800, offeredVolume: 800, handledVolume: 800, ahtSeconds: 300 }),
    )
    const result = calculateCapacityRevenueLeakages([row], 'Production Hours', 22, 40, 12)
    expect(result.volume).toBeCloseTo(200 * (300 / 3600) * 22, 6)
  })

  it('does not treat extra AHT as lost revenue on per-minute billing', () => {
    const row = actualWeek(
      snapshot({ ahtSeconds: 300, handledVolume: 1000, productionHc: 10 }),
      snapshot({ ahtSeconds: 360, handledVolume: 1000, productionHc: 10 }),
    )
    const result = calculateCapacityRevenueLeakages([row], 'Per Minute', 0.4, 40, 12)
    expect(result.aht).toBe(0)
  })

  it('prices extra AHT on hourly billing as extra handle hours × rate', () => {
    const row = actualWeek(
      snapshot({ ahtSeconds: 300, handledVolume: 1000, productionHc: 10 }),
      snapshot({ ahtSeconds: 360, handledVolume: 1000, productionHc: 10 }),
    )
    const result = calculateCapacityRevenueLeakages([row], 'Production Hours', 22, 40, 12)
    expect(result.aht).toBeCloseTo((60 / 3600) * 1000 * 22, 6)
  })

  it('honors an admin leakage total formula', () => {
    saveFormulaStore({
      overrides: [
        {
          formulaId: 'financial.leakageTotal',
          scopeType: 'all',
          clientName: '',
          lobName: '',
          expression: 'headcount + volume',
          updatedAt: new Date().toISOString(),
        },
      ],
    })
    const row = actualWeek(
      snapshot({ productionHc: 10, volume: 1000, ahtSeconds: 300 }),
      snapshot({
        productionHc: 8,
        productionFte: 8,
        volume: 800,
        offeredVolume: 800,
        handledVolume: 800,
        ahtSeconds: 360,
      }),
    )
    const result = calculateCapacityRevenueLeakages([row], 'Production Hours', 22, 40, 12)
    expect(result.total).toBeCloseTo(result.headcount + result.volume, 6)
    expect(result.aht).toBeGreaterThan(0)
  })
})

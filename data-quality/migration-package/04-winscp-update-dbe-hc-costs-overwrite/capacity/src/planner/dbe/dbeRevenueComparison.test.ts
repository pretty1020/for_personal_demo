import { describe, expect, it } from 'vitest'
import {
  rollupDbeRevenueComparisonByMonth,
  summarizeDbeRevenueComparison,
  type DbeRevenueComparisonRow,
} from './dbeRevenueComparison'

function detailRow(
  lineId: string,
  month: string,
  overrides: Partial<DbeRevenueComparisonRow> = {},
): DbeRevenueComparisonRow {
  return {
    key: `${lineId}:${month}`,
    label: month,
    manualAbsenteeismPct: 10,
    manualShrinkagePct: 20,
    manualRevenue: 1000,
    plannedAbsenteeismPct: 12,
    plannedShrinkagePct: 22,
    plannedRevenue: 900,
    variance: -100,
    variancePct: -0.1,
    plannedAvailable: true,
    manualFte: 10,
    plannedProductionHc: 12,
    fteVariance: 2,
    fteVariancePct: 0.2,
    fteComparable: true,
    matchedScenarioName: 'Plan A',
    matchedScenarioId: 'sc-a',
    ...overrides,
  }
}

/** LOB with no matching Staffing Plan: DBE FTE exists, Production HC does not. */
function unmatchedRow(lineId: string, month: string): DbeRevenueComparisonRow {
  return detailRow(lineId, month, {
    plannedAbsenteeismPct: null,
    plannedShrinkagePct: null,
    plannedRevenue: null,
    variance: null,
    variancePct: null,
    plannedAvailable: false,
    manualFte: 5,
    plannedProductionHc: null,
    fteVariance: null,
    fteVariancePct: null,
    fteComparable: false,
    matchedScenarioName: null,
    matchedScenarioId: null,
  })
}

describe('DBE vs Staffing Plan FTE comparison', () => {
  const months = ['2026-01', '2026-02']
  const rows = months.flatMap((month) => [detailRow('lob-a', month), unmatchedRow('lob-b', month)])

  it('sums FTE and Production HC across LOBs within a month', () => {
    const [january] = rollupDbeRevenueComparisonByMonth(rows)

    // Manual FTE covers every LOB, matched or not: 10 + 5.
    expect(january!.manualFte).toBe(15)
    // Production HC only exists for the matched LOB.
    expect(january!.plannedProductionHc).toBe(12)
    expect(january!.fteComparable).toBe(true)
  })

  it('measures FTE variance only over LOBs that have a matched plan', () => {
    const [january] = rollupDbeRevenueComparisonByMonth(rows)

    // 12 planned HC vs the matched LOB's 10 FTE — the unmatched LOB's 5 FTE must not
    // be counted, or an unmatched LOB would look like a staffing shortfall.
    expect(january!.fteVariance).toBe(2)
    expect(january!.fteVariancePct).toBeCloseTo(0.2, 10)
  })

  it('averages headcount across months rather than summing, unlike revenue', () => {
    const summary = summarizeDbeRevenueComparison(rows)

    // Revenue accumulates over the period: 4 rows x 1000.
    expect(summary.manualRevenue).toBe(4000)
    // Headcount is a level: each month totals 15, so the period average is 15 - not 30.
    expect(summary.manualFte).toBe(15)
    expect(summary.plannedProductionHc).toBe(12)
    expect(summary.fteVariance).toBe(2)
    expect(summary.fteComparable).toBe(true)
  })

  it('does not double-count Planned Production HC when two LOBs share one staffing plan', () => {
    const shared = ['2026-01', '2026-02'].flatMap((month) => [
      detailRow('lob-a', month, {
        clientName: 'Acme',
        projectCode: 'PC-1',
        matchedScenarioId: 'shared-plan',
        plannedProductionHc: 100,
        manualFte: 90,
      }),
      detailRow('lob-b', month, {
        clientName: 'Acme',
        projectCode: 'PC-1',
        matchedScenarioId: 'shared-plan',
        plannedProductionHc: 100,
        manualFte: 80,
      }),
    ])
    const [january] = rollupDbeRevenueComparisonByMonth(shared)
    expect(january!.plannedProductionHc).toBe(100)
    expect(summarizeDbeRevenueComparison(shared).plannedProductionHc).toBe(100)
  })

  it('sums distinct clients, then averages those monthly totals across chosen months', () => {
    const multi = [
      detailRow('c1', '2026-01', {
        clientName: 'A',
        matchedScenarioId: 'plan-a',
        plannedProductionHc: 10,
        manualFte: 10,
      }),
      detailRow('c2', '2026-01', {
        clientName: 'B',
        matchedScenarioId: 'plan-b',
        plannedProductionHc: 30,
        manualFte: 30,
      }),
      detailRow('c1', '2026-02', {
        clientName: 'A',
        matchedScenarioId: 'plan-a',
        plannedProductionHc: 20,
        manualFte: 20,
      }),
      detailRow('c2', '2026-02', {
        clientName: 'B',
        matchedScenarioId: 'plan-b',
        plannedProductionHc: 40,
        manualFte: 40,
      }),
    ]
    // Jan 40 + Feb 60 → average 50 (not sum 100).
    expect(summarizeDbeRevenueComparison(multi).plannedProductionHc).toBe(50)
  })

  it('reports FTE as not comparable when no LOB has Production HC', () => {
    const summary = summarizeDbeRevenueComparison(
      months.map((month) => unmatchedRow('lob-b', month)),
    )

    expect(summary.fteComparable).toBe(false)
    expect(summary.plannedProductionHc).toBeNull()
    expect(summary.fteVariance).toBeNull()
    // DBE FTE still reports, so the column is populated even with no plan match.
    expect(summary.manualFte).toBe(5)
  })

  it('keeps FTE comparable when a plan matched but has no shrinkage drivers', () => {
    const noDrivers = months.map((month) =>
      detailRow('lob-a', month, {
        plannedAbsenteeismPct: null,
        plannedShrinkagePct: null,
        plannedRevenue: null,
        variance: null,
        variancePct: null,
        plannedAvailable: false,
      }),
    )
    const summary = summarizeDbeRevenueComparison(noDrivers)

    expect(summary.plannedAvailable).toBe(false)
    expect(summary.plannedRevenue).toBeNull()
    expect(summary.fteComparable).toBe(true)
    expect(summary.plannedProductionHc).toBe(12)
  })
})

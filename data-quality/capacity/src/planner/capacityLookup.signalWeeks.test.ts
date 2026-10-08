import { describe, expect, it } from 'vitest'
import { weeksWithPlanSignal } from './capacityLookup'
import type { WeeklyLedgerRow } from './weeklyLedger'

function row(
  week: string,
  overrideSource: 'generated' | 'import',
  productionHc = 0,
): WeeklyLedgerRow {
  return {
    key: week,
    scenarioId: 's1',
    scenarioName: 'Test',
    client: 'Twilio',
    location: 'PH',
    billingType: 'FTE',
    weekStart: 'sunday',
    week,
    periodLabel: week,
    timeline: 'forward_plan',
    overrideSource,
    planned: {
      callVolume: null,
      ahtSeconds: null,
      occupancyPct: null,
      productionHc,
      productionFte: null,
      requiredFte: null,
      trainingHc: null,
      nestingHc: null,
      plannedNewHires: null,
      totalShrinkagePct: null,
    },
    actual: null,
    shrinkage: [],
  } as WeeklyLedgerRow
}

describe('weeksWithPlanSignal', () => {
  it('keeps import and override weeks only — not simulated filler', () => {
    const ledger = [
      row('2001-01-07', 'generated', 40),
      row('2023-07-02', 'import', 40),
      row('2026-04-05', 'generated', 40),
    ]
    expect(
      weeksWithPlanSignal(ledger, {
        '2023-07-09': { productionHc: 12 },
      }),
    ).toEqual(['2023-07-02', '2023-07-09'])
  })

  it('returns empty when there is no user or import signal', () => {
    expect(weeksWithPlanSignal([row('2026-04-05', 'generated', 40)], {})).toEqual([])
  })
})

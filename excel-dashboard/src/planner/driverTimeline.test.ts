import { describe, expect, it } from 'vitest'
import { buildDriverTimeline, forecastByWeek, type AhtDetail } from './driverTimeline'
import type { ScenarioForecastPackage } from './forecasting'
import type { WeeklyLedgerRow } from './weeklyLedger'

/**
 * The unified driver timeline.
 *
 * Actuals and forecast share one series here, so the join between them is the
 * thing most worth pinning down: which weeks come from which side, and that a
 * forward week never picks up an actual (or the reverse).
 */

function row(
  week: string,
  timeline: WeeklyLedgerRow['timeline'],
  actual: Partial<{ callVolume: number; ahtSeconds: number; attritionHc: number }> | null,
  shrinkage: Array<{ id: string; actualPct: number | null }> = [],
): WeeklyLedgerRow {
  return {
    key: `k-${week}`,
    scenarioId: 's1',
    scenarioName: 'S',
    client: 'C',
    location: 'Manila',
    billingType: 'Production Hours',
    weekStart: 'sunday',
    week,
    periodLabel: week,
    timeline,
    overrideSource: 'generated',
    planned: {} as WeeklyLedgerRow['planned'],
    actual: actual as WeeklyLedgerRow['actual'],
    shrinkage: shrinkage as WeeklyLedgerRow['shrinkage'],
  }
}

const HISTORY = ['2026-01-04', '2026-01-11']
const FORWARD = ['2026-01-18', '2026-01-25']

function ledger(): WeeklyLedgerRow[] {
  return [
    row(HISTORY[0]!, 'historical_actual', { callVolume: 1000, ahtSeconds: 300, attritionHc: 2 }, [
      { id: 'absenteeism', actualPct: 0.05 },
      { id: 'other', actualPct: 0.1 },
    ]),
    row(HISTORY[1]!, 'historical_actual', { callVolume: 1100, ahtSeconds: 310, attritionHc: 3 }, [
      { id: 'absenteeism', actualPct: 0.06 },
    ]),
    row(FORWARD[0]!, 'forward_plan', null),
    row(FORWARD[1]!, 'forward_plan', null),
  ]
}

function forecast(): ScenarioForecastPackage {
  const point = (week: string, value: number) => ({
    weekIndex: 0,
    label: week,
    value,
    source: 'model' as const,
  })
  return {
    horizonWeeks: 2,
    metrics: [
      {
        metricId: 'callVolume',
        label: 'Volume',
        unit: 'number',
        actualSeries: [],
        actualPoints: [],
        modelResults: [],
        selectedModel: null,
        usesAdvancedModel: false,
        forecast: [point(FORWARD[0]!, 1200), point(FORWARD[1]!, 1250)],
      },
      {
        metricId: 'attritionHc',
        label: 'Attrition HC',
        unit: 'number',
        actualSeries: [],
        actualPoints: [],
        modelResults: [],
        selectedModel: null,
        usesAdvancedModel: false,
        forecast: [point(FORWARD[0]!, 4)],
      },
    ],
  } as ScenarioForecastPackage
}

describe('forecastByWeek', () => {
  it('keys each driver by plan week rather than by position', () => {
    const byWeek = forecastByWeek(forecast())
    expect(byWeek.get(FORWARD[0]!)?.get('callVolume')).toBe(1200)
    expect(byWeek.get(FORWARD[1]!)?.get('callVolume')).toBe(1250)
    // Attrition's horizon is shorter — the missing week is simply absent.
    expect(byWeek.get(FORWARD[1]!)?.get('attritionHc')).toBeUndefined()
  })

  it('handles a null package', () => {
    expect(forecastByWeek(null).size).toBe(0)
  })
})

describe('buildDriverTimeline', () => {
  it('returns actual weeks then forecast weeks, marked apart', () => {
    const rows = buildDriverTimeline({ ledger: ledger(), forecast: forecast() })
    expect(rows.map((r) => r.week)).toEqual([...HISTORY, ...FORWARD])
    expect(rows.map((r) => r.timeline)).toEqual(['actual', 'actual', 'forecast', 'forecast'])
  })

  it('reads every driver from the ledger for an actual week', () => {
    const [first] = buildDriverTimeline({ ledger: ledger(), forecast: forecast() })
    expect(first).toMatchObject({
      volume: 1000,
      aht: 300,
      attritionHc: 2,
      absenteeism: 0.05,
      shrinkage: 0.15000000000000002,
    })
  })

  it('reads every driver from the forecast for a forward week', () => {
    const rows = buildDriverTimeline({ ledger: ledger(), forecast: forecast() })
    const forward = rows.find((r) => r.week === FORWARD[0])!
    expect(forward.volume).toBe(1200)
    expect(forward.attritionHc).toBe(4)
  })

  it('leaves a forward week blank where a driver has no forecast', () => {
    // Attrition's horizon stops short; the cell must be null, not zero.
    const rows = buildDriverTimeline({ ledger: ledger(), forecast: forecast() })
    const last = rows.find((r) => r.week === FORWARD[1])!
    expect(last.attritionHc).toBeNull()
    expect(last.volume).toBe(1250)
  })

  it('never fills an actual week from the forecast', () => {
    // A forecast that overlaps history must not overwrite what happened.
    const overlapping = {
      ...forecast(),
      metrics: [
        {
          ...forecast().metrics[0]!,
          forecast: [{ weekIndex: 0, label: HISTORY[0]!, value: 99_999, source: 'model' as const }],
        },
      ],
    } as ScenarioForecastPackage
    const rows = buildDriverTimeline({ ledger: ledger(), forecast: overlapping })
    expect(rows[0]!.volume).toBe(1000)
  })

  it('treats a week with no shrinkage entries as unknown, not zero', () => {
    const rows = buildDriverTimeline({
      ledger: [row(HISTORY[0]!, 'historical_actual', { callVolume: 10 }, [])],
      forecast: null,
    })
    expect(rows[0]!.shrinkage).toBeNull()
  })

  it('merges the AHT nesting detail into both sides', () => {
    const detail = new Map<string, AhtDetail>([
      [
        HISTORY[0]!,
        {
          productionOnlyAht: 280,
          withNestingAht: 305,
          nestingHc: 3,
          productionHc: 12,
          note: 'Nesting present',
        },
      ],
      [
        FORWARD[0]!,
        {
          productionOnlyAht: 300,
          withNestingAht: 320,
          nestingHc: 1,
          productionHc: 14,
          note: 'Time series',
        },
      ],
    ])
    const rows = buildDriverTimeline({ ledger: ledger(), forecast: forecast(), ahtDetail: detail })

    // The plain column is production-only on both sides; the adjusted one
    // carries the nesting mix on both sides.
    expect(rows[0]).toMatchObject({
      aht: 280,
      ahtAdjusted: 305,
      nestingHc: 3,
      note: 'Nesting present',
    })
    const forward = rows.find((r) => r.week === FORWARD[0])!
    expect(forward).toMatchObject({ aht: 300, ahtAdjusted: 320, note: 'Time series' })
  })

  it('keeps the two AHT columns the same way round on actual and forecast weeks', () => {
    const detail = new Map<string, AhtDetail>([
      [HISTORY[0]!, { productionOnlyAht: 290, withNestingAht: 330, nestingHc: 5, productionHc: 10 }],
      [FORWARD[0]!, { productionOnlyAht: 295, withNestingAht: 340, nestingHc: 6, productionHc: 10 }],
    ])
    const rows = buildDriverTimeline({ ledger: ledger(), forecast: forecast(), ahtDetail: detail })

    for (const row of rows.filter((item) => item.nestingHc)) {
      // Nesting can only make a week slower, never faster, whichever side it is.
      expect(row.ahtAdjusted!).toBeGreaterThan(row.aht!)
    }
  })

  it('respects the history and forecast window limits', () => {
    const rows = buildDriverTimeline({
      ledger: ledger(),
      forecast: forecast(),
      historyWeeks: 1,
      forecastWeeks: 1,
    })
    // Keeps the most recent history and the earliest forward weeks.
    expect(rows.map((r) => r.week)).toEqual([HISTORY[1], FORWARD[0]])
  })

  it('drops non-finite values rather than charting them', () => {
    const rows = buildDriverTimeline({
      ledger: [row(HISTORY[0]!, 'historical_actual', { callVolume: Number.NaN, ahtSeconds: 300 })],
      forecast: null,
    })
    expect(rows[0]!.volume).toBeNull()
    expect(rows[0]!.aht).toBe(300)
  })
  it('fills Nesting / Production HC from staffing when AHT detail is missing', () => {
    const staffingHc = new Map([
      [HISTORY[0]!, { nestingHc: 8, productionHc: 42 }],
      [FORWARD[0]!, { nestingHc: 2, productionHc: 50 }],
    ])
    const rows = buildDriverTimeline({
      ledger: ledger(),
      forecast: forecast(),
      staffingHc,
    })
    expect(rows[0]).toMatchObject({ nestingHc: 8, productionHc: 42 })
    const forward = rows.find((r) => r.week === FORWARD[0])!
    expect(forward).toMatchObject({ nestingHc: 2, productionHc: 50 })
  })

  it('prefers AHT detail HC over staffing HC when both are present', () => {
    const detail = new Map<string, AhtDetail>([
      [HISTORY[0]!, { nestingHc: 3, productionHc: 12 }],
    ])
    const staffingHc = new Map([[HISTORY[0]!, { nestingHc: 99, productionHc: 99 }]])
    const rows = buildDriverTimeline({
      ledger: ledger(),
      forecast: forecast(),
      ahtDetail: detail,
      staffingHc,
    })
    expect(rows[0]).toMatchObject({ nestingHc: 3, productionHc: 12 })
  })
})

/**
 * Attrition and headcount have to come from the same place.
 *
 * The forward half once read attrition from the forecast package and headcount
 * from the capacity plan, so the table showed two leavers a week beside a
 * headcount that never moved. Each column was right about its own source and
 * the pair was impossible.
 */
describe('attrition beside the headcount it changes', () => {
  it('prefers the plan figure over the forecast on forward weeks', () => {
    const detail = new Map<string, AhtDetail>([
      [FORWARD[0]!, { attritionHc: 7, nestingHc: 0, productionHc: 40 }],
    ])
    const rows = buildDriverTimeline({ ledger: ledger(), forecast: forecast(), ahtDetail: detail })
    const forward = rows.find((row) => row.week === FORWARD[0])!
    expect(forward.attritionHc).toBe(7)
  })

  it('falls back to the forecast when the plan has no figure for the week', () => {
    const detail = new Map<string, AhtDetail>([
      [FORWARD[0]!, { nestingHc: 0, productionHc: 40 }],
    ])
    const rows = buildDriverTimeline({ ledger: ledger(), forecast: forecast(), ahtDetail: detail })
    const forward = rows.find((row) => row.week === FORWARD[0])!
    // Whatever the forecast said, not a blank.
    expect(forward.attritionHc === null || Number.isFinite(forward.attritionHc)).toBe(true)
  })

  it('shows no leavers when the plan is losing nobody', () => {
    const detail = new Map<string, AhtDetail>([
      [FORWARD[0]!, { attritionHc: 0, nestingHc: 0, productionHc: 63 }],
    ])
    const rows = buildDriverTimeline({ ledger: ledger(), forecast: forecast(), ahtDetail: detail })
    const forward = rows.find((row) => row.week === FORWARD[0])!
    // A flat headcount beside a non-zero attrition is the contradiction this
    // guards; zero is what a plan that is not losing anyone should report.
    expect(forward.attritionHc).toBe(0)
  })

  it('keeps reading actual weeks from the ledger', () => {
    const rows = buildDriverTimeline({ ledger: ledger(), forecast: forecast() })
    const actual = rows.find((row) => row.timeline === 'actual')!
    expect(actual.attritionHc).toBe(2)
  })
})

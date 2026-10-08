import { describe, expect, it } from 'vitest'
import { buildForecastDriverGroups, buildScenarioForecast } from './forecasting'
import type { WeeklyLedgerRow } from './weeklyLedger'

/**
 * Which weeks the plan's own actuals are taken from, and what date each one
 * carries.
 *
 * The dates are the part worth pinning down. Weeks with no actual are dropped,
 * so the surviving values must keep their own week — reconstructing them by
 * counting backwards from the end of history shifts every value onto a
 * neighbouring week the moment a single week is missing, which moves the whole
 * series against the holiday calendar without changing anything visible.
 */

function row(
  week: string,
  timeline: WeeklyLedgerRow['timeline'],
  actual: Partial<{ callVolume: number; ahtSeconds: number; attritionHc: number }> | null,
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
    shrinkage: [] as WeeklyLedgerRow['shrinkage'],
  }
}

const WEEKS = ['2026-01-04', '2026-01-11', '2026-01-18', '2026-01-25', '2026-02-01']

const volumeOf = (ledger: WeeklyLedgerRow[]) =>
  buildScenarioForecast(ledger, undefined, 4).metrics.find((m) => m.metricId === 'callVolume')!

describe('actuals taken from the Capacity Plan', () => {
  it('uses only weeks marked as actual, never forward plan weeks', () => {
    const ledger = [
      row(WEEKS[0]!, 'historical_actual', { callVolume: 1000 }),
      row(WEEKS[1]!, 'historical_actual', { callVolume: 1100 }),
      // A forward week carrying a number must not be read as history.
      row(WEEKS[2]!, 'forward_plan', { callVolume: 9999 }),
      row(WEEKS[3]!, 'forward_plan', null),
    ]

    const volume = volumeOf(ledger)
    expect(volume.actualSeries).toEqual([1000, 1100])
    expect(volume.actualPoints.map((p) => p.value)).not.toContain(9999)
  })

  it('keeps every actual on the week it was recorded', () => {
    const ledger = [
      row(WEEKS[0]!, 'historical_actual', { callVolume: 1000 }),
      row(WEEKS[1]!, 'historical_actual', { callVolume: 1100 }),
      row(WEEKS[2]!, 'historical_actual', { callVolume: 1200 }),
      row(WEEKS[3]!, 'forward_plan', null),
    ]

    expect(volumeOf(ledger).actualPoints).toEqual([
      { date: WEEKS[0], value: 1000 },
      { date: WEEKS[1], value: 1100 },
      { date: WEEKS[2], value: 1200 },
    ])
  })

  it('does not shift later weeks when an earlier week has no actual', () => {
    const ledger = [
      row(WEEKS[0]!, 'historical_actual', { callVolume: 1000 }),
      // Nothing keyed in for this week.
      row(WEEKS[1]!, 'historical_actual', null),
      row(WEEKS[2]!, 'historical_actual', { callVolume: 1200 }),
      row(WEEKS[3]!, 'historical_actual', { callVolume: 1300 }),
      row(WEEKS[4]!, 'forward_plan', null),
    ]

    const points = volumeOf(ledger).actualPoints
    // The gap is dropped, and nothing slides into it.
    expect(points).toEqual([
      { date: WEEKS[0], value: 1000 },
      { date: WEEKS[2], value: 1200 },
      { date: WEEKS[3], value: 1300 },
    ])
    expect(points.find((p) => p.date === WEEKS[1])).toBeUndefined()
  })

  it('treats a missing week as unknown rather than zero', () => {
    const ledger = [
      row(WEEKS[0]!, 'historical_actual', { callVolume: 1000 }),
      row(WEEKS[1]!, 'historical_actual', null),
      row(WEEKS[2]!, 'forward_plan', null),
    ]
    // A zero would drag any fit down towards it.
    expect(volumeOf(ledger).actualSeries).not.toContain(0)
    expect(volumeOf(ledger).actualSeries).toEqual([1000])
  })

  it('reports no history at all for a driver that has none', () => {
    const ledger = [
      row(WEEKS[0]!, 'historical_actual', { ahtSeconds: 300 }),
      row(WEEKS[1]!, 'forward_plan', null),
    ]
    const volume = volumeOf(ledger)
    expect(volume.actualPoints).toEqual([])
    expect(volume.actualSeries).toEqual([])
  })

  it('keeps values and dates in step with each other', () => {
    const ledger = [
      row(WEEKS[0]!, 'historical_actual', { callVolume: 1000 }),
      row(WEEKS[1]!, 'historical_actual', null),
      row(WEEKS[2]!, 'historical_actual', { callVolume: 1200 }),
      row(WEEKS[3]!, 'forward_plan', null),
    ]
    const volume = volumeOf(ledger)
    expect(volume.actualPoints.map((p) => p.value)).toEqual(volume.actualSeries)
  })
})

/**
 * AHT is the one driver whose recorded actual is not on the basis the plan
 * needs. A week with agents in nesting reads high because of the staffing mix,
 * and planned AHT adds that premium back on top — so the history has to have it
 * taken out first, or nesting is charged for twice.
 */
describe('AHT actuals are production-equivalent', () => {
  const ahtRow = (
    week: string,
    timeline: WeeklyLedgerRow['timeline'],
    aht: number | null,
    nestingHc = 0,
    productionHc = 100,
  ): WeeklyLedgerRow => {
    const base = row(week, timeline, aht == null ? null : { ahtSeconds: aht })
    return {
      ...base,
      actual: (aht == null
        ? null
        : { ahtSeconds: aht, nestingHc, productionHc }) as WeeklyLedgerRow['actual'],
      planned: { nestingHc, productionHc } as WeeklyLedgerRow['planned'],
    }
  }

  const ahtOf = (ledger: WeeklyLedgerRow[]) =>
    buildScenarioForecast(ledger, undefined, 4).metrics.find((m) => m.metricId === 'ahtSeconds')!

  it('leaves weeks with no agents in nesting exactly as recorded', () => {
    const ledger = [
      ahtRow(WEEKS[0]!, 'historical_actual', 300, 0),
      ahtRow(WEEKS[1]!, 'historical_actual', 310, 0),
      ahtRow(WEEKS[2]!, 'forward_plan', null),
    ]
    expect(ahtOf(ledger).actualSeries).toEqual([300, 310])
  })

  it('takes the nesting premium out of a week that had agents in nesting', () => {
    const withNesting = [
      ahtRow(WEEKS[0]!, 'historical_actual', 300, 0, 100),
      ahtRow(WEEKS[1]!, 'historical_actual', 400, 40, 60),
      ahtRow(WEEKS[2]!, 'forward_plan', null),
    ]

    const series = ahtOf(withNesting).actualSeries
    // The nesting week must come through below what was recorded, because part
    // of the 400 was the slower cohort rather than the work itself.
    expect(series[1]!).toBeLessThan(400)
    // And it must stay a plausible handle time, not collapse.
    expect(series[1]!).toBeGreaterThan(250)
    // The production-only week is untouched.
    expect(series[0]).toBe(300)
  })

  it('takes out more premium the heavier the nesting mix', () => {
    const lightMix = ahtOf([
      ahtRow(WEEKS[0]!, 'historical_actual', 400, 5, 95),
      ahtRow(WEEKS[1]!, 'forward_plan', null),
    ]).actualSeries[0]!

    const heavyMix = ahtOf([
      ahtRow(WEEKS[0]!, 'historical_actual', 400, 50, 50),
      ahtRow(WEEKS[1]!, 'forward_plan', null),
    ]).actualSeries[0]!

    expect(heavyMix).toBeLessThan(lightMix)
  })

  it('factors staffing phone time into the demix when capacity HC is supplied', () => {
    const week = WEEKS[0]!
    const ledger = [
      ahtRow(week, 'historical_actual', 400, 40, 60),
      ahtRow(WEEKS[1]!, 'forward_plan', null),
    ]
    const fullPhone = buildScenarioForecast(
      ledger,
      undefined,
      4,
      undefined,
      new Map([[week, { nestingHc: 40, productionHc: 60, nestingPhoneTimePct: 1 }]]),
    ).metrics.find((m) => m.metricId === 'ahtSeconds')!.actualSeries[0]!

    const halfPhone = buildScenarioForecast(
      ledger,
      undefined,
      4,
      undefined,
      new Map([[week, { nestingHc: 40, productionHc: 60, nestingPhoneTimePct: 0.25 }]]),
    ).metrics.find((m) => m.metricId === 'ahtSeconds')!.actualSeries[0]!

    // Less phone time → smaller nesting share → less premium removed → higher production AHT.
    expect(halfPhone).toBeGreaterThan(fullPhone)
  })

  it('keeps AHT weeks dated correctly through the conversion', () => {
    const ledger = [
      ahtRow(WEEKS[0]!, 'historical_actual', 300, 0),
      ahtRow(WEEKS[1]!, 'historical_actual', null),
      ahtRow(WEEKS[2]!, 'historical_actual', 320, 10, 90),
      ahtRow(WEEKS[3]!, 'forward_plan', null),
    ]
    const points = ahtOf(ledger).actualPoints
    expect(points.map((p) => p.date)).toEqual([WEEKS[0], WEEKS[2]])
  })
})

/**
 * Order of the driver cards.
 *
 * AHT belongs last because it is the only driver with a second panel reading its
 * result — the nesting mix and its assumptions sit directly below. Anywhere else
 * and that panel is stranded under drivers it has nothing to do with.
 */
describe('driver group order', () => {
  it('runs volume, attrition, absenteeism, then AHT', () => {
    expect(buildForecastDriverGroups().map((group) => group.id)).toEqual([
      'volume',
      'attrition',
      'absenteeism',
      'aht',
    ])
  })

  it('keeps AHT adjacent to the analytics that read it', () => {
    const ids = buildForecastDriverGroups().map((group) => group.id)
    expect(ids[ids.length - 1]).toBe('aht')
  })

  it('puts custom shrinkage categories after the core drivers', () => {
    const ids = buildForecastDriverGroups(['coaching' as never]).map((group) => group.id)
    expect(ids[ids.length - 1]).toBe('in_office')
  })
})

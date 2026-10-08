import { describe, expect, it } from 'vitest'
import { deriveCapacityPlanRows } from './capacityPlanDerived'
import { buildSampleWorkspace } from './sampleWorkspace'
import { runSimulation } from './engine'
import { buildWeeklyPlanLedger } from './weeklyLedger'
import type { ScenarioForecastPackage } from './forecasting'

/**
 * An applied attrition forecast has to reach the plan.
 *
 * Switching a driver on is the moment a forecast stops being analysis, so a
 * plan that keeps its own attrition anyway is worse than one that never offered
 * the switch. On real data the first several weeks followed a Theta forecast of
 * roughly two a week and the weeks after it did not, which is the behaviour
 * these pin down.
 */

const PLAN_START = '2026-08-16'

function fixture() {
  const workspace = buildSampleWorkspace(PLAN_START)
  const scenario = workspace.scenarios[0]!
  const ledger = buildWeeklyPlanLedger(scenario, runSimulation(scenario, 'weekly', 52), [])
  return { scenario, ledger }
}

/** A forecast package carrying one flat attrition figure for every plan week. */
function attritionForecast(weeks: string[], perWeek: number): ScenarioForecastPackage {
  return {
    horizonWeeks: weeks.length,
    metrics: [
      {
        metricId: 'attritionHc',
        label: 'Attrition HC',
        unit: 'number',
        actualSeries: [],
        actualPoints: [],
        modelResults: [],
        selectedModel: null,
        usesAdvancedModel: true,
        forecast: weeks.map((week, index) => ({
          weekIndex: index,
          label: week,
          value: perWeek,
          source: 'model' as const,
        })),
      },
    ],
  } as unknown as ScenarioForecastPackage
}

function forwardRows(perWeek: number) {
  const { scenario, ledger } = fixture()
  const weeks = ledger.filter((row) => row.timeline === 'forward_plan').map((row) => row.week)
  const rows = deriveCapacityPlanRows(
    ledger,
    scenario,
    attritionForecast(weeks, perWeek),
    {},
    { attritionHc: 'forecast' },
    0,
    null,
    null,
    undefined,
    null,
  )
  return rows.filter((row) => row.timeline === 'forward_plan')
}

describe('an applied attrition forecast', () => {
  it('drives the first planned weeks', () => {
    const rows = forwardRows(2)
    // The start week is seeded rather than rolled forward, so the chain begins
    // at the second.
    expect(rows[1]!.planned.attritionHc).toBe(2)
    expect(rows[2]!.planned.attritionHc).toBe(2)
  })

  it('keeps driving them while the team can support it', () => {
    const rows = forwardRows(2)
    // A shrinking team cannot keep losing two a week forever, so the figure is
    // expected to fall — what it must not do is stop being the forecast while
    // there are still people to lose.
    for (const row of rows.slice(1, 20)) {
      if (row.planned.productionHc >= 8) {
        expect(row.planned.attritionHc, `${row.week} of ${row.planned.productionHc}`).toBe(2)
      }
    }
  })

  it('never reports nobody leaving while a team is still staffed', () => {
    const rows = forwardRows(2)
    for (const row of rows.slice(1, 30)) {
      if (row.planned.productionHc >= 4) {
        expect(row.planned.attritionHc, `${row.week} of ${row.planned.productionHc}`).toBeGreaterThan(0)
      }
    }
  })

  it('winds down instead of snapping to zero as the team empties', () => {
    const rows = forwardRows(2)
    const series = rows.slice(1, 30).map((row) => row.planned.attritionHc)
    // Each step may fall, but never straight from two or more to none: that jump
    // is the signature of the forecast being discarded rather than scaled.
    for (let i = 1; i < series.length; i++) {
      if (series[i] === 0) expect(series[i - 1]).toBeLessThanOrEqual(1)
    }
  })

  it('follows the forecast up when it forecasts more leavers', () => {
    const heavier = forwardRows(4).slice(1, 8).map((row) => row.planned.attritionHc)
    const lighter = forwardRows(1).slice(1, 8).map((row) => row.planned.attritionHc)
    expect(Math.max(...heavier)).toBeGreaterThan(Math.max(...lighter))
  })

  it('leaves production headcount falling by what the forecast said', () => {
    const rows = forwardRows(2)
    for (let i = 2; i < 8; i++) {
      const previous = rows[i - 1]!.planned.productionHc
      const row = rows[i]!
      const movement =
        (row.planned.graduateHc ?? 0) +
        (row.planned.transferInHc ?? 0) -
        (row.planned.attritionHc ?? 0) -
        (row.planned.transferOutHc ?? 0) -
        (row.planned.offRosterLoaHc ?? 0)
      expect(row.planned.productionHc, `${row.week}`).toBe(Math.max(0, Math.round(previous + movement)))
    }
  })
})

/**
 * The live plan that misbehaved was not merely shrinking — it had a hiring wave
 * graduating into production, and the attrition column went 2, 2, 5, 0 across
 * exactly those weeks. These reproduce a plan with intake rather than one that
 * only loses people.
 */
describe('an applied attrition forecast on a plan that is also hiring', () => {
  function hiringFixture(perWeek: number) {
    const workspace = buildSampleWorkspace(PLAN_START)
    const base = workspace.scenarios[0]!
    const scenario = {
      ...base,
      assumptions: {
        ...base.assumptions,
        newHire: { ...base.assumptions.newHire, hiringPlanPerPeriod: 20, classSize: 20 },
      },
    }
    const ledger = buildWeeklyPlanLedger(scenario, runSimulation(scenario, 'weekly', 52), [])
    const weeks = ledger.filter((row) => row.timeline === 'forward_plan').map((row) => row.week)
    const rows = deriveCapacityPlanRows(
      ledger,
      scenario,
      attritionForecast(weeks, perWeek),
      {},
      { attritionHc: 'forecast' },
      0,
      null,
      null,
      undefined,
      null,
    )
    return rows.filter((row) => row.timeline === 'forward_plan')
  }

  it('keeps reporting leavers through a graduation wave', () => {
    const rows = hiringFixture(2)
    const growing = rows.slice(1, 20).filter((row) => row.planned.productionHc >= 8)
    expect(growing.length).toBeGreaterThan(3)

    for (const row of growing) {
      expect(
        row.planned.attritionHc,
        `${row.week}: ${row.planned.productionHc} production, ${row.planned.graduateHc ?? 0} graduating`,
      ).toBeGreaterThan(0)
    }
  })

  it('does not spike attrition on the week a class graduates', () => {
    const rows = hiringFixture(2)
    const spikes = rows
      .slice(1, 20)
      .filter((row) => (row.planned.attritionHc ?? 0) > 3)
      .map((row) => `${row.week}=${row.planned.attritionHc}`)
    // A forecast of two a week has no business producing five.
    expect(spikes, spikes.join(', ')).toEqual([])
  })
})

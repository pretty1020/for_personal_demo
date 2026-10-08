import { describe, expect, it } from 'vitest'
import { addWeeks, isoDate } from './capacityWeekUtils'
import { deriveCapacityPlanRows } from './capacityPlanDerived'
import { runSimulation } from './engine'
import { SAMPLE_LOBS, buildSampleWorkspace } from './sampleWorkspace'
import {
  SAMPLE_ACTUAL_HISTORY_WEEKS,
  buildSampleActualOverrides,
  sampleActualOverrideForWeek,
} from './sampleLedgerActuals'
import { buildWeeklyPlanLedger } from './weeklyLedger'

const PLAN_START = '2026-08-16'

describe('buildSampleActualOverrides', () => {
  it('seeds the last 12 weeks before plan start', () => {
    const overrides = buildSampleActualOverrides(SAMPLE_LOBS[0]!, PLAN_START)
    expect(overrides).toHaveLength(SAMPLE_ACTUAL_HISTORY_WEEKS)
    expect(overrides[0]!.week).toBe(isoDate(addWeeks(new Date(`${PLAN_START}T12:00:00`), -12)))
    expect(overrides.at(-1)!.week).toBe(isoDate(addWeeks(new Date(`${PLAN_START}T12:00:00`), -1)))
  })

  it('keeps volume and AHT near each LOB baseline', () => {
    const abc = SAMPLE_LOBS[0]!
    const overrides = buildSampleActualOverrides(abc, PLAN_START)
    const volumes = overrides.map((row) => row.metrics.callVolume ?? 0)
    const ahts = overrides.map((row) => row.metrics.ahtSeconds ?? 0)
    const meanVolume = volumes.reduce((sum, value) => sum + value, 0) / volumes.length
    const meanAht = ahts.reduce((sum, value) => sum + value, 0) / ahts.length
    expect(meanVolume).toBeGreaterThan(abc.forecastVolume * 0.75)
    expect(meanVolume).toBeLessThan(abc.forecastVolume * 1.25)
    expect(meanAht).toBeGreaterThan(abc.ahtSeconds * 0.85)
    expect(meanAht).toBeLessThan(abc.ahtSeconds * 1.2)
    expect(overrides.every((row) => (row.metrics.callVolume ?? 0) > 0)).toBe(true)
    expect(overrides.every((row) => (row.metrics.ahtSeconds ?? 0) > 0)).toBe(true)
  })

  it('is deterministic for the same LOB', () => {
    const a = buildSampleActualOverrides(SAMPLE_LOBS[1]!, PLAN_START)
    const b = buildSampleActualOverrides(SAMPLE_LOBS[1]!, PLAN_START)
    expect(a.map((row) => row.metrics.callVolume)).toEqual(b.map((row) => row.metrics.callVolume))
  })

  it('differs across LOBs', () => {
    const abc = buildSampleActualOverrides(SAMPLE_LOBS[0]!, PLAN_START)
    const efg = buildSampleActualOverrides(SAMPLE_LOBS[1]!, PLAN_START)
    expect(abc.map((row) => row.metrics.callVolume)).not.toEqual(efg.map((row) => row.metrics.callVolume))
  })

  it('returns a week only inside the last-12-week window', () => {
    const lob = SAMPLE_LOBS[0]!
    expect(sampleActualOverrideForWeek(lob, PLAN_START, '2026-08-09')?.metrics.callVolume).toBeGreaterThan(0)
    expect(sampleActualOverrideForWeek(lob, PLAN_START, PLAN_START)).toBeNull()
    expect(sampleActualOverrideForWeek(lob, PLAN_START, '2026-05-17')).toBeNull()
  })
})

describe('sample actuals on the Capacity Plan ledger', () => {
  it('fills offered volume, AHT, attrition and absenteeism on the last 12 historical weeks', () => {
    const workspace = buildSampleWorkspace(PLAN_START)
    const scenario = workspace.scenarios[0]!
    const ledger = buildWeeklyPlanLedger(scenario, runSimulation(scenario, 'weekly', 52), [])
    const withActuals = ledger.filter(
      (row) => row.timeline === 'historical_actual' && row.actual?.callVolume != null,
    )
    expect(withActuals).toHaveLength(SAMPLE_ACTUAL_HISTORY_WEEKS)
    expect(withActuals[0]!.week).toBe('2026-05-24')
    expect(withActuals.at(-1)!.week).toBe('2026-08-09')
    expect(withActuals.every((row) => (row.actual?.handledVolume ?? 0) > 0)).toBe(true)
    expect(withActuals.every((row) => (row.actual?.ahtSeconds ?? 0) > 0)).toBe(true)
    expect(
      withActuals.every((row) =>
        row.shrinkage.some((item) => item.id === 'absenteeism' && item.actualPct != null && item.actualPct > 0),
      ),
    ).toBe(true)

    const derived = deriveCapacityPlanRows(ledger, scenario, null)
    const visible = derived.filter(
      (row) => row.timeline === 'historical_actual' && row.week >= '2026-05-24' && row.week <= '2026-08-09',
    )
    expect(visible).toHaveLength(SAMPLE_ACTUAL_HISTORY_WEEKS)
    expect(visible.every((row) => row.actual.offeredVolume > 0)).toBe(true)
    expect(visible.every((row) => (row.actual.ahtSeconds ?? 0) > 0)).toBe(true)
    expect(visible.every((row) => row.actual.attritionHc >= 0)).toBe(true)
  })
})

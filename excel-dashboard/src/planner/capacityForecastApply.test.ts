import { describe, expect, it } from 'vitest'
import { defaultDriverConfig } from './advancedForecastPersistence'
import {
  deriveCapacityPlanRows,
  plannedAhtFromNestingMix,
} from './capacityPlanDerived'
import { capacityWorkspaceForecastModes } from './capacityLookup'
import { runSimulation } from './engine'
import { buildScenarioForecast } from './forecasting'
import { buildSampleWorkspace } from './sampleWorkspace'
import { buildWeeklyPlanLedger } from './weeklyLedger'

const PLAN_START = '2026-08-16'

describe('capacityWorkspaceForecastModes', () => {
  it('keeps forecast mode so an applied driver can reach the Capacity Plan', () => {
    const workspace = buildSampleWorkspace(PLAN_START)
    const scenario = workspace.scenarios[0]!
    expect(scenario.plan.clientId).toBeTruthy()
    expect(scenario.plan.buildMethod).toBe('forward')
    expect(
      capacityWorkspaceForecastModes(scenario, {
        callVolume: 'forecast',
        ahtSeconds: 'forecast',
        occupancy: 'manual',
        attritionHc: 'forecast',
      }),
    ).toMatchObject({
      callVolume: 'forecast',
      ahtSeconds: 'forecast',
      occupancy: 'manual',
      attritionHc: 'forecast',
    })
  })
})

describe('applied forecast on Capacity Plan weeks', () => {
  it('fills future Forecast volume from the selected model', () => {
    const workspace = buildSampleWorkspace(PLAN_START)
    const scenario = workspace.scenarios[0]!
    const ledger = buildWeeklyPlanLedger(scenario, runSimulation(scenario, 'weekly', 52), [])
    const planWeeks = ledger.filter((row) => row.timeline === 'forward_plan').slice(0, 6).map((row) => row.week)
    const forecast = buildScenarioForecast(ledger, undefined, 52, {
      callVolume: {
        ...defaultDriverConfig('callVolume'),
        applyToCapacityPlan: true,
        selectedModelId: 'linear-trend',
        results: [
          {
            id: 'linear-trend',
            label: 'Linear trend',
            success: true,
            forecast: [],
            historicalPredictions: [],
            accuracy: {},
            parameters: {},
            weekly: planWeeks.map((week) => ({ week, value: 5762, days: 7 })),
          },
        ],
      },
    })
    const derived = deriveCapacityPlanRows(
      ledger,
      scenario,
      forecast,
      {},
      capacityWorkspaceForecastModes(scenario, { callVolume: 'forecast' }),
    )
    const future = derived.filter((row) => row.timeline === 'forward_plan').slice(0, 6)
    expect(future.map((row) => row.planned.volume)).toEqual([5762, 5762, 5762, 5762, 5762, 5762])
  })

  it('fills future Planned AHT from the selected model when AHT is applied', () => {
    const workspace = buildSampleWorkspace(PLAN_START)
    const scenario = workspace.scenarios[0]!
    const ledger = buildWeeklyPlanLedger(scenario, runSimulation(scenario, 'weekly', 52), [])
    const planWeeks = ledger.filter((row) => row.timeline === 'forward_plan').slice(0, 4).map((row) => row.week)
    const forecast = buildScenarioForecast(ledger, undefined, 52, {
      ahtSeconds: {
        ...defaultDriverConfig('ahtSeconds'),
        applyToCapacityPlan: true,
        selectedModelId: 'exponential-smoothing',
        results: [
          {
            id: 'exponential-smoothing',
            label: 'Exponential smoothing',
            success: true,
            forecast: [],
            historicalPredictions: [],
            accuracy: {},
            parameters: {},
            weekly: planWeeks.map((week) => ({ week, value: 312, days: 7 })),
          },
        ],
      },
    })
    const derived = deriveCapacityPlanRows(
      ledger,
      scenario,
      forecast,
      {},
      capacityWorkspaceForecastModes(scenario, { ahtSeconds: 'forecast' }),
    )
    const future = derived.filter((row) => row.timeline === 'forward_plan').slice(0, 4)
    expect(future.every((row) => row.forecastModelAht === 'Exponential smoothing')).toBe(true)
    expect(future.every((row) => (row.planned.ahtSeconds ?? 0) > 0)).toBe(true)
  })

  it('mixes Nesting HC into Planned AHT when AHT driver mode is forecast', () => {
    const workspace = buildSampleWorkspace(PLAN_START)
    const scenario =
      workspace.scenarios.find((item) => (item.assumptions.newHire.nestingPhoneTimePct ?? 0) > 0) ??
      workspace.scenarios[0]!
    // Ensure nesting agents take contacts so the mix can move AHT.
    scenario.assumptions.newHire.nestingPhoneTimePct = 0.5
    scenario.assumptions.newHire.nestingPhoneTimeRamp = [0.25, 0.5]
    const ledger = buildWeeklyPlanLedger(scenario, runSimulation(scenario, 'weekly', 52), [])
    const forward = ledger.filter((row) => row.timeline === 'forward_plan')
    const hireWeek = forward[0]!.week
    // Force a training class so later weeks carry Nesting HC with phone time.
    const overrides = {
      [hireWeek]: { plannedNewHires: 20 },
    }
    const planWeeks = forward.slice(0, 16).map((row) => row.week)
    const forecast = buildScenarioForecast(ledger, undefined, 52, {
      ahtSeconds: {
        ...defaultDriverConfig('ahtSeconds'),
        applyToCapacityPlan: true,
        selectedModelId: 'exponential-smoothing',
        results: [
          {
            id: 'exponential-smoothing',
            label: 'Exponential smoothing',
            success: true,
            forecast: [],
            historicalPredictions: [],
            accuracy: {},
            parameters: {},
            weekly: planWeeks.map((week) => ({ week, value: 300, days: 7 })),
          },
        ],
      },
    })
    const derived = deriveCapacityPlanRows(
      ledger,
      scenario,
      forecast,
      overrides,
      capacityWorkspaceForecastModes(scenario, { ahtSeconds: 'forecast' }),
    )
    const withNesting = derived.filter(
      (row) => row.timeline === 'forward_plan' && row.planned.nestingHc > 0 && row.planned.nestingPhoneTimePct > 0,
    )
    expect(withNesting.length).toBeGreaterThan(0)
    // Mix-adj must lift production-only 300 when nesting agents are on the phone.
    expect(withNesting.every((row) => (row.planned.ahtSeconds ?? 0) > 300)).toBe(true)

    const manual = deriveCapacityPlanRows(
      ledger,
      scenario,
      forecast,
      overrides,
      capacityWorkspaceForecastModes(scenario, { ahtSeconds: 'manual' }),
    )
    const manualWeek = manual.find((row) => row.week === withNesting[0]!.week)
    // Manual mode leaves the production-only series unmixed.
    expect(manualWeek?.planned.ahtSeconds).toBeLessThan(withNesting[0]!.planned.ahtSeconds!)
  })
})

describe('plannedAhtFromNestingMix Mix-adj contract', () => {
  it('makes Mix-adj AHT higher than production-only AHT when Nesting HC > 0', () => {
    const base = 375.8
    // Zero week phone time previously collapsed Mix-adj to the base — the bug
    // shown on the Driver timeline when Nesting HC was 10 and both columns matched.
    const mixed = plannedAhtFromNestingMix(
      base,
      10,
      50,
      {
        nestingMultiplier: 1.28,
        productionOnlyAht: base,
        withNestingAht: base * 1.28,
        nestingMultiplierSource: 'assumed',
        learningCurveWeeklyImprovementPct: 0.02,
        historicalAvgNestingHc: 10,
        historicalAvgProductionHc: 50,
        weeksProductionOnly: 0,
        weeksWithNesting: 4,
      },
      base,
      0,
    )
    expect(mixed).toBeGreaterThan(base)
  })

  it('leaves AHT unchanged when there is no Nesting HC', () => {
    const base = 375.8
    expect(plannedAhtFromNestingMix(base, 0, 50, null, base, 0)).toBe(Math.round(base * 10) / 10)
  })
})

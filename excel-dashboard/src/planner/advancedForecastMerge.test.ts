import { describe, expect, it } from 'vitest'
import { buildScenarioForecast } from './forecasting'
import type {
  DriverForecastConfig,
  ScenarioDriverForecasts,
  StoredWfmModel,
} from './advancedForecastPersistence'
import type { WeeklyLedgerRow } from './weeklyLedger'

/**
 * Merging service forecasts into the capacity plan.
 *
 * This is the seam where a wrong decision silently changes staffing numbers, so
 * the rules are pinned down here rather than left to the UI: which weeks a
 * forecast lands on, and whether it is allowed to land at all.
 */

const WEEKS = [
  '2026-01-04', '2026-01-11', '2026-01-18', '2026-01-25',
  '2026-02-01', '2026-02-08', '2026-02-15', '2026-02-22',
  '2026-03-01', '2026-03-08', '2026-03-15', '2026-03-22',
]
const PLAN_WEEKS = ['2026-03-29', '2026-04-05', '2026-04-12', '2026-04-19']

function row(week: string, timeline: WeeklyLedgerRow['timeline'], volume: number | null): WeeklyLedgerRow {
  return {
    key: `k-${week}`,
    scenarioId: 's1',
    scenarioName: 'Scenario',
    client: 'Client',
    location: 'Manila',
    billingType: 'Production Hours',
    weekStart: 'sunday',
    week,
    periodLabel: week,
    timeline,
    overrideSource: 'generated',
    planned: {} as WeeklyLedgerRow['planned'],
    actual: volume == null ? null : ({ callVolume: volume } as WeeklyLedgerRow['actual']),
    shrinkage: [],
  }
}

function ledger(): WeeklyLedgerRow[] {
  return [
    ...WEEKS.map((week, index) => row(week, 'historical_actual', 1000 + index * 10)),
    ...PLAN_WEEKS.map((week) => row(week, 'forward_plan', null)),
  ]
}

function model(overrides: Partial<StoredWfmModel> = {}): StoredWfmModel {
  return {
    id: 'exponential-smoothing',
    label: 'Exponential smoothing',
    success: true,
    forecast: [],
    historicalPredictions: [],
    accuracy: { rmse: 12, mape: 1.5, wape: 1.4, bias: -0.3 },
    parameters: { model_type: 'exponential-smoothing' },
    weekly: PLAN_WEEKS.map((week, index) => ({ week, value: 5000 + index * 100, days: 7 })),
    ...overrides,
  }
}

/** Per-driver config for callVolume, the driver these tests exercise. */
function advanced(
  models: StoredWfmModel[],
  overrides: Partial<DriverForecastConfig> = {},
): ScenarioDriverForecasts {
  const config: DriverForecastConfig = {
    dataSource: 'capacity_plan',
    applyToCapacityPlan: true,
    models: ['exponential-smoothing'],
    testSplit: '90/10',
    countries: ['PH'],
    operatingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    detectAnomalies: true,
    replaceAnomalies: false,
    horizonWeeks: 12,
    selectedModelId: 'exponential-smoothing',
    results: models,
    ...overrides,
  }
  return { callVolume: config }
}

function volumeOf(pkg: ReturnType<typeof buildScenarioForecast>) {
  return pkg.metrics.find((metric) => metric.metricId === 'callVolume')!
}

describe('buildScenarioForecast with service models', () => {
  it('falls back to browser models when there are no service results', () => {
    const volume = volumeOf(buildScenarioForecast(ledger(), undefined, 4))
    expect(volume.usesAdvancedModel).toBe(false)
    expect(volume.modelResults.every((entry) => entry.engine === 'browser')).toBe(true)
  })

  it('matches weekly values to plan weeks by date, not by position', () => {
    // Deliberately out of order, and carrying a week the plan does not contain.
    const shuffled = [
      { week: PLAN_WEEKS[2]!, value: 300, days: 7 },
      { week: '2025-12-28', value: 999, days: 7 },
      { week: PLAN_WEEKS[0]!, value: 100, days: 7 },
      { week: PLAN_WEEKS[1]!, value: 200, days: 7 },
      { week: PLAN_WEEKS[3]!, value: 400, days: 7 },
    ]
    const volume = volumeOf(
      buildScenarioForecast(ledger(), undefined, 4, advanced([model({ weekly: shuffled })])),
    )
    expect(volume.forecast.map((point) => point.value)).toEqual([100, 200, 300, 400])
  })

  it('carries the last forecast value into weeks the horizon does not reach', () => {
    const short = [{ week: PLAN_WEEKS[0]!, value: 100, days: 7 }]
    const volume = volumeOf(
      buildScenarioForecast(ledger(), undefined, 4, advanced([model({ weekly: short })])),
    )
    // Holds 100 rather than snapping back to history — and never NaN.
    expect(volume.forecast.map((point) => point.value)).toEqual([100, 100, 100, 100])
  })

  it('fills a leading gap from the first week the model reaches', () => {
    // The model's horizon starts after the plan's first week (history already
    // covered it). That leading week must not read as zero.
    const empty = ledger().map((row) =>
      row.timeline === 'historical_actual' ? { ...row, actual: null } : row,
    )
    const late = [
      { week: PLAN_WEEKS[1]!, value: 4000, days: 7 },
      { week: PLAN_WEEKS[2]!, value: 4100, days: 7 },
    ]
    const volume = volumeOf(
      buildScenarioForecast(empty, undefined, 4, advanced([model({ weekly: late })])),
    )
    expect(volume.forecast.map((point) => point.value)).toEqual([4000, 4000, 4100, 4100])
  })

  it('does not fall back to zero when the driver has no history at all', () => {
    // A driver with no actuals used to fall back to 0 past the model horizon,
    // so the plan read a collapse to zero in every remaining week.
    const empty = ledger().map((row) =>
      row.timeline === 'historical_actual' ? { ...row, actual: null } : row,
    )
    const short = [{ week: PLAN_WEEKS[0]!, value: 5000, days: 7 }]
    const volume = volumeOf(
      buildScenarioForecast(empty, undefined, 4, advanced([model({ weekly: short })])),
    )
    expect(volume.forecast.map((point) => point.value)).toEqual([5000, 5000, 5000, 5000])
  })

  it('does not apply a service model when the scenario switch is off', () => {
    const volume = volumeOf(
      buildScenarioForecast(
        ledger(),
        undefined,
        4,
        advanced([model()], { applyToCapacityPlan: false }),
      ),
    )
    expect(volume.usesAdvancedModel).toBe(false)
    expect(volume.selectedModel?.engine).toBe('browser')
    // Still listed, so the planner can compare it.
    expect(volume.modelResults.some((entry) => entry.engine === 'python')).toBe(true)
  })

  it('leaves other drivers untouched when one driver applies', () => {
    // Only callVolume is configured; attrition must keep its browser model.
    const pkg = buildScenarioForecast(ledger(), undefined, 4, advanced([model()]))
    const attrition = pkg.metrics.find((metric) => metric.metricId === 'attritionHc')!
    expect(attrition.usesAdvancedModel).toBe(false)
    expect(volumeOf(pkg).usesAdvancedModel).toBe(true)
  })

  it('applies the service model when the driver permits it', () => {
    const volume = volumeOf(buildScenarioForecast(ledger(), undefined, 4, advanced([model()])))
    expect(volume.usesAdvancedModel).toBe(true)
    expect(volume.forecast[0]!.value).toBe(5000)
  })

  it('never selects a failed model, even when pinned', () => {
    const volume = volumeOf(
      buildScenarioForecast(
        ledger(),
        undefined,
        4,
        advanced([model({ success: false, error: 'boom', weekly: [] })]),
      ),
    )
    expect(volume.selectedModel?.failed).not.toBe(true)
    expect(volume.usesAdvancedModel).toBe(false)
  })

  it('treats a model that reaches no plan week as failed', () => {
    const volume = volumeOf(
      buildScenarioForecast(
        ledger(),
        undefined,
        4,
        advanced([model({ weekly: [{ week: '2025-12-28', value: 42, days: 7 }] })]),
      ),
    )
    const entry = volume.modelResults.find((item) => item.engine === 'python')
    expect(entry?.failed).toBe(true)
    expect(entry?.error).toMatch(/does not reach/i)
  })

  it('keeps failed models visible so the planner can see why one is missing', () => {
    const volume = volumeOf(
      buildScenarioForecast(
        ledger(),
        undefined,
        4,
        advanced([model({ success: false, error: 'not enough history', weekly: [] })]),
      ),
    )
    expect(volume.modelResults.find((entry) => entry.failed)?.error).toBe('not enough history')
  })

  it('lets manual week overrides win over the service forecast', () => {
    const volume = volumeOf(
      buildScenarioForecast(ledger(), { callVolume: { 1: 42 } }, 4, advanced([model()])),
    )
    expect(volume.forecast[1]!.value).toBe(42)
    expect(volume.forecast[1]!.source).toBe('override')
    expect(volume.forecast[0]!.source).toBe('model')
  })
})

/**
 * The apply switch is the whole contract of the forecasting tab: on means this
 * forecast drives the plan, off means the plan is untouched. It previously read
 * as working while doing nothing, because a hardcoded per-driver preference for
 * a built-in model outranked the applied one whenever nothing was pinned.
 */
describe('applying a forecast to the plan', () => {
  it('drives the plan with the applied model even when none was pinned', () => {
    const pkg = buildScenarioForecast(
      ledger(),
      undefined,
      4,
      advanced([model()], { selectedModelId: undefined }),
    )
    const volume = volumeOf(pkg)

    expect(volume.usesAdvancedModel).toBe(true)
    expect(volume.selectedModel?.id).toBe('exponential-smoothing')
    // The applied numbers, not the built-in trend model's.
    expect(volume.forecast[0]?.value).toBe(5000)
  })

  it('honours a model the planner pinned by hand', () => {
    const pkg = buildScenarioForecast(
      ledger(),
      undefined,
      4,
      advanced([model({ id: 'theta', label: 'Theta', parameters: { model_type: 'theta' } })], {
        models: ['theta'],
        selectedModelId: 'theta',
      }),
    )
    expect(volumeOf(pkg).selectedModel?.id).toBe('theta')
  })

  it('leaves the plan on its own model when the driver is analysis only', () => {
    const pkg = buildScenarioForecast(
      ledger(),
      undefined,
      4,
      advanced([model()], { applyToCapacityPlan: false, selectedModelId: undefined }),
    )
    const volume = volumeOf(pkg)

    expect(volume.usesAdvancedModel).toBe(false)
    expect(volume.selectedModel?.id).not.toBe('exponential-smoothing')
    expect(volume.forecast[0]?.value).not.toBe(5000)
  })

  it('keeps the models visible for comparison while analysis only', () => {
    const pkg = buildScenarioForecast(
      ledger(),
      undefined,
      4,
      advanced([model()], { applyToCapacityPlan: false }),
    )
    // Switched off must mean "not driving the plan", not "hidden".
    expect(volumeOf(pkg).modelResults.some((m) => m.id === 'exponential-smoothing')).toBe(true)
  })

  it('falls back to a built-in model when every applied model failed', () => {
    const pkg = buildScenarioForecast(
      ledger(),
      undefined,
      4,
      advanced([model({ success: false, weekly: [], accuracy: {} })], { selectedModelId: undefined }),
    )
    const volume = volumeOf(pkg)
    expect(volume.selectedModel).not.toBeNull()
    expect(volume.usesAdvancedModel).toBe(false)
  })
})

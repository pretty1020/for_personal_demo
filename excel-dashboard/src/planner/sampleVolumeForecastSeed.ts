import { addWeeks, isoDate } from './capacityWeekUtils'
import {
  defaultDriverConfig,
  setDriverForecast,
  type StoredWfmModel,
} from './advancedForecastPersistence'
import { runBrowserWfmForecast } from './browserWfmForecast'
import { saveScenarioForecastModes } from './capacityForecastModesPersistence'
import { buildSampleActualOverrides } from './sampleLedgerActuals'
import {
  sampleStaffingPctForWeek,
  sampleVolumeForStaffingPct,
  type SampleLobDefinition,
} from './sampleWorkspace'
import type { PlannerScenario } from './types'
import type { DatedPoint } from './forecastDataSource'

function planWeeksFrom(planStart: string, count: number): string[] {
  const start = new Date(`${planStart}T12:00:00`)
  return Array.from({ length: count }, (_, index) => isoDate(addWeeks(start, index)))
}

/**
 * Pregenerate volume forecasts for sample LOBs and apply them to Capacity.
 * Forecast points are calibrated so Staffing % stays in the 95%–105% band.
 */
export function seedSampleVolumeForecasts(
  scenarios: PlannerScenario[],
  lobs: readonly SampleLobDefinition[],
  shrinkagePct = 0.25,
): void {
  const lobById = new Map(lobs.map((lob) => [lob.id, lob]))
  for (const scenario of scenarios) {
    const lob = lobById.get(scenario.id)
    if (!lob) continue
    const planStart = scenario.plan.capacityPlanStartWeek?.trim()
    if (!planStart) continue

    const history = buildSampleActualOverrides(
      { ...lob, shrinkagePct },
      planStart,
      12,
      scenario.plan.weekStart,
    )
    const data: DatedPoint[] = history
      .map((row) => ({
        date: row.week,
        value: Number(row.metrics?.callVolume ?? 0),
      }))
      .filter((point) => point.value > 0)
    if (data.length < 6) continue

    const targetWeeks = planWeeksFrom(planStart, 26)
    const calibratedForecast = targetWeeks.map((date, index) => ({
      date,
      value: Math.max(
        1,
        Math.round(sampleVolumeForStaffingPct(lob, sampleStaffingPctForWeek(index, 1.2), shrinkagePct)),
      ),
    }))

    try {
      const response = runBrowserWfmForecast({
        data,
        horizon: 26,
        models: ['holt-winters', 'seasonal-naive', 'theta', 'linear-trend', 'exponential-smoothing'],
        testSplit: '80/20',
        weekStart: scenario.plan.weekStart === 'monday' ? 'monday' : 'sunday',
        targetWeeks,
        metricId: 'callVolume',
        metricUnit: 'number',
        grain: 'weekly',
      })
      const models = (response.models ?? [])
        .filter((model): model is StoredWfmModel => Boolean(model?.success))
        .map((model) => ({
          ...model,
          forecast: calibratedForecast.map((point, index) => ({
            ...(model.forecast?.[index] ?? {}),
            date: point.date,
            value: point.value,
          })),
        }))
      if (!models.length) {
        const fallback: StoredWfmModel = {
          id: 'seasonal-naive',
          label: 'Seasonal naïve',
          success: true,
          forecast: calibratedForecast,
          historicalPredictions: [],
          accuracy: { wape: 0.06, bias: 0.01, folds: 1 },
          parameters: {},
          weekly: [],
        }
        setDriverForecast(scenario.id, 'callVolume', {
          ...defaultDriverConfig('callVolume'),
          dataSource: 'capacity_plan',
          applyToCapacityPlan: true,
          selectedModelId: 'seasonal-naive',
          results: [fallback],
          lastRunAt: new Date().toISOString(),
          planWeeks: targetWeeks,
          horizonWeeks: 26,
          interval: 'weekly',
          warnings: [],
        })
        saveScenarioForecastModes(scenario.id, { callVolume: 'forecast' })
        continue
      }
      const best = models[0]!
      setDriverForecast(scenario.id, 'callVolume', {
        ...defaultDriverConfig('callVolume'),
        dataSource: 'capacity_plan',
        applyToCapacityPlan: true,
        selectedModelId: best.id,
        results: models,
        lastRunAt: new Date().toISOString(),
        planWeeks: targetWeeks,
        horizonWeeks: 26,
        interval: 'weekly',
        warnings: response.warnings,
      })
      saveScenarioForecastModes(scenario.id, { callVolume: 'forecast' })
    } catch {
      const fallback: StoredWfmModel = {
        id: 'seasonal-naive',
        label: 'Seasonal naïve',
        success: true,
        forecast: calibratedForecast,
        historicalPredictions: [],
        accuracy: { wape: 0.06, bias: 0.01, folds: 1 },
        parameters: {},
        weekly: [],
      }
      setDriverForecast(scenario.id, 'callVolume', {
        ...defaultDriverConfig('callVolume'),
        dataSource: 'capacity_plan',
        applyToCapacityPlan: true,
        selectedModelId: 'seasonal-naive',
        results: [fallback],
        lastRunAt: new Date().toISOString(),
        planWeeks: targetWeeks,
        horizonWeeks: 26,
        interval: 'weekly',
        warnings: [],
      })
      saveScenarioForecastModes(scenario.id, { callVolume: 'forecast' })
    }
  }
}

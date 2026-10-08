import { runForecastModels, type ForecastModelResult } from '../utils/staffingCapacity/forecastModels'
import { SHRINKAGE_FORECAST_METRIC_IDS, type ScenarioForecastOverrides, type ForecastMetricId } from './forecastPersistence'
import type { WeeklyLedgerRow } from './weeklyLedger'

export type ForecastMetricUnit = 'number' | 'percent' | 'seconds'

export const IN_OFFICE_SHRINKAGE_FORECAST_IDS = [
  'aux_default',
  'meeting',
  'coaching',
  'training',
  'nesting',
  'calibration',
  'offline',
  'aux_other',
] as const satisfies readonly ForecastMetricId[]

export const SHRINKAGE_BEST_MODEL_METRIC_IDS: ForecastMetricId[] = [
  'totalShrinkagePct',
  ...SHRINKAGE_FORECAST_METRIC_IDS,
]

export function usesBestForecastModel(metricId: ForecastMetricId): boolean {
  return SHRINKAGE_BEST_MODEL_METRIC_IDS.includes(metricId)
}

export const FORECAST_DRIVER_METRIC_IDS: ForecastMetricId[] = [
  'callVolume',
  'attritionHc',
  'absenteeism',
  ...IN_OFFICE_SHRINKAGE_FORECAST_IDS,
]

export const FORECAST_DRIVER_GROUPS: Array<{ id: string; title: string; metricIds: ForecastMetricId[] }> = [
  { id: 'volume', title: 'Volume', metricIds: ['callVolume'] },
  { id: 'attrition', title: 'Attrition', metricIds: ['attritionHc'] },
  { id: 'absenteeism', title: 'Absenteeism', metricIds: ['absenteeism'] },
  { id: 'in_office', title: 'In office shrinkage', metricIds: [...IN_OFFICE_SHRINKAGE_FORECAST_IDS] },
]

const METRIC_MODEL_PREFERENCE: Partial<Record<ForecastMetricId, string>> = {
  callVolume: 'trend',
  attritionHc: 'ma',
  absenteeism: 'ses',
  aux_default: 'naive',
  meeting: 'ses',
  training: 'trend',
  coaching: 'ma',
  nesting: 'ses',
  calibration: 'ma',
  offline: 'ses',
  aux_other: 'naive',
  ahtSeconds: 'ses',
  occupancy: 'ma',
  totalShrinkagePct: 'trend',
}

export function forecastMetricDisplayLabel(metricId: ForecastMetricId): string {
  switch (metricId) {
    case 'callVolume':
      return 'Volume'
    case 'attritionHc':
      return 'Attrition HC'
    case 'absenteeism':
      return 'Absenteeism'
    case 'aux_default':
      return 'Default'
    case 'meeting':
      return 'Meetings'
    case 'training':
      return 'Training'
    case 'coaching':
      return 'Coaching'
    case 'nesting':
      return 'Nesting'
    case 'calibration':
      return 'Calibration'
    case 'offline':
      return 'Offline'
    case 'aux_other':
      return 'Others'
    default:
      return metricId
        .split('_')
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
        .join(' ')
  }
}

export type ForecastPoint = {
  weekIndex: number
  label: string
  value: number
  source: 'model' | 'override'
}

export type MetricForecastResult = {
  metricId: ForecastMetricId
  label: string
  unit: ForecastMetricUnit
  actualSeries: number[]
  modelResults: ForecastModelResult[]
  selectedModel: ForecastModelResult | null
  forecast: ForecastPoint[]
}

export type ScenarioForecastPackage = {
  horizonWeeks: number
  metrics: MetricForecastResult[]
}

const FORECAST_METRICS: Array<{
  metricId: ForecastMetricId
  label: string
  unit: ForecastMetricUnit
  pickActual: (row: WeeklyLedgerRow) => number | null
}> = [
  {
    metricId: 'callVolume',
    label: 'Volume',
    unit: 'number',
    pickActual: (row) => row.actual?.callVolume ?? null,
  },
  {
    metricId: 'ahtSeconds',
    label: 'AHT',
    unit: 'seconds',
    pickActual: (row) => row.actual?.ahtSeconds ?? null,
  },
  {
    metricId: 'occupancy',
    label: 'Occupancy',
    unit: 'percent',
    pickActual: (row) => row.actual?.occupancy ?? null,
  },
  {
    metricId: 'totalShrinkagePct',
    label: 'Shrinkage',
    unit: 'percent',
    // Match Capacity matrix: sum of category actual % (0 when none), not demo totalShrinkagePct.
    pickActual: (row) =>
      row.shrinkage.reduce((sum, item) => sum + Math.max(0, item.actualPct ?? 0), 0),
  },
  {
    metricId: 'attritionHc',
    label: 'Attrition HC',
    unit: 'number',
    pickActual: (row) => row.actual?.attritionHc ?? null,
  },
  ...SHRINKAGE_FORECAST_METRIC_IDS.map((metricId) => ({
    metricId,
    label: metricId
      .split('_')
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(' '),
    unit: 'percent' as const,
    pickActual: (row: WeeklyLedgerRow) => row.shrinkage.find((item) => item.id === metricId)?.actualPct ?? null,
  })),
]

function actualSeries(rows: WeeklyLedgerRow[], pick: (row: WeeklyLedgerRow) => number | null): number[] {
  return rows
    .filter((row) => row.timeline === 'historical_actual')
    .map((row) => pick(row))
    .filter((value): value is number => value != null && Number.isFinite(value))
}

function bestModel(models: ForecastModelResult[]): ForecastModelResult | null {
  const valid = models.filter((model) => Number.isFinite(model.rmse))
  if (!valid.length) return null
  return [...valid].sort((a, b) => a.rmse - b.rmse)[0] ?? null
}

function selectModelForMetric(metricId: ForecastMetricId, models: ForecastModelResult[]): ForecastModelResult | null {
  const preferredId = METRIC_MODEL_PREFERENCE[metricId]
  if (preferredId) {
    const preferred = models.find((model) => model.id === preferredId && Number.isFinite(model.rmse))
    if (preferred) return preferred
  }
  return bestModel(models)
}

export function buildScenarioForecast(
  rows: WeeklyLedgerRow[],
  overrides: ScenarioForecastOverrides | undefined,
  horizonWeeks = 12,
): ScenarioForecastPackage {
  const futureRows = rows.filter((row) => row.timeline === 'forward_plan').slice(0, horizonWeeks)
  return {
    horizonWeeks,
    metrics: FORECAST_METRICS.map((metric) => {
      const series = actualSeries(rows, metric.pickActual)
      const models = runForecastModels(series, horizonWeeks)
      const selected = usesBestForecastModel(metric.metricId)
        ? bestModel(models)
        : selectModelForMetric(metric.metricId, models)
      const perMetricOverrides = overrides?.[metric.metricId] ?? {}
      const forecast = futureRows.map((row, index) => {
        const override = perMetricOverrides[index]
        const modelValue = selected?.horizon[index] ?? series[series.length - 1] ?? 0
        return {
          weekIndex: index,
          label: row.week,
          value: override ?? modelValue,
          source: override != null ? ('override' as const) : ('model' as const),
        }
      })
      return {
        metricId: metric.metricId,
        label: metric.label,
        unit: metric.unit,
        actualSeries: series,
        modelResults: models,
        selectedModel: selected,
        forecast,
      }
    }),
  }
}

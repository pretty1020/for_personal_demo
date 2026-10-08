import type { ForecastMetricId } from './forecastPersistence'
import type { DatedPoint, ForecastDataSource } from './forecastDataSource'
import type { ForecastEvent, ForecastOverrides } from './forecastAdjustments'

/**
 * Forecasting configuration and results, saved per scenario *per driver*.
 *
 * Volume, attrition, absenteeism and AHT behave nothing alike — volume is
 * seasonal and holiday-driven, attrition is a slow count, absenteeism is a noisy
 * rate — so each carries its own data source, model set, horizon and decision
 * about whether it feeds the Capacity Plan.
 */

export const WFM_MODEL_IDS = [
  'fourier-holidays',
  'holt-winters',
  'theta',
  'seasonal-naive',
  'linear-trend',
  'exponential-smoothing',
  'simple-moving-average',
] as const

export type WfmModelId = (typeof WFM_MODEL_IDS)[number]

export const WFM_MODEL_LABELS: Record<WfmModelId, string> = {
  'fourier-holidays': 'Trend + Seasonality + Holidays',
  'holt-winters': 'Holt-Winters',
  theta: 'Theta',
  'seasonal-naive': 'Seasonal naïve',
  'linear-trend': 'Linear trend',
  'exponential-smoothing': 'Exponential smoothing',
  'simple-moving-average': 'Simple moving average',
}

export const WFM_MODEL_BLURBS: Record<WfmModelId, string> = {
  'fourier-holidays':
    'Piecewise trend, Fourier seasonality and a coefficient per holiday — the decomposition Prophet fits. The only model here that can learn what a named holiday does.',
  'holt-winters':
    'Level, trend and a full seasonal cycle, each smoothed separately. The strongest option when demand has a repeating shape.',
  theta:
    'Deseasonalise, smooth, then extend half the linear trend. Won the M3 competition and still competitive.',
  'seasonal-naive': 'Repeats the last season (week or day-of-week). Fast and stable for seasonal volume.',
  'linear-trend': 'Straight-line growth or decline fitted by least squares. Good for slow drift.',
  'exponential-smoothing': 'Holt linear trend: recent points weigh more than old ones. Fast in the browser.',
  'simple-moving-average': 'Rolling mean. Useful as an accuracy floor to beat.',
}

export function isWfmModelId(id: string): id is WfmModelId {
  return (WFM_MODEL_IDS as readonly string[]).includes(id)
}

export const TEST_SPLITS = ['90/10', '80/20', '70/30'] as const
export type TestSplit = (typeof TEST_SPLITS)[number]

export const HORIZON_OPTIONS = [4, 8, 12, 26, 52] as const

/** Calendar order, so a schedule always reads Monday to Sunday. */
export const OPERATING_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

export type OperatingDay = (typeof OPERATING_DAYS)[number]

export type SeriesInterval = 'daily' | 'weekly' | 'monthly'

export type WfmAccuracy = {
  /** Weighted absolute percentage error — the WFM convention. */
  wape?: number
  /** Mean signed percentage error. Positive means the forecast runs high. */
  bias?: number
  /** Rolling-origin folds behind the score; 1 is a single held-back split. */
  folds?: number
  mae?: number
  mse?: number
  rmse?: number
  mape?: number
  /**
   * Pearson correlation of forecast against actual, -1 to 1. Whether the model
   * moves when the business moves, which no error measure reveals on its own.
   */
  pattern_r?: number
  /**
   * Forecast spread over actual spread. 1 is the right size; well below it means
   * the model is flattening real variation and will miss peaks.
   */
  amplitude_ratio?: number
  train_test_split?: string
  test_samples?: number
}

export type WeeklyRollupPoint = {
  week: string
  value: number
  days: number
  /** Prediction interval, where the model could produce one. */
  lower?: number
  upper?: number
}

export type StoredWfmModel = {
  id: string
  label: string
  success: boolean
  error?: string | null
  forecast: Array<{ date?: string; value?: number; [key: string]: unknown }>
  historicalPredictions: Array<Record<string, unknown>>
  accuracy: WfmAccuracy
  parameters: Record<string, unknown>
  weekly: WeeklyRollupPoint[]
  aggregation?: string | null
}

export type StoredAnomaly = {
  date: string
  original?: number | null
  value?: number | null
  reason?: string | null
}

export type StoredHoliday = {
  date: string
  name: string
  week: string
  weekday: string
  event?: string | null
}

/** Provenance for generated sample history, so it can never pass as real. */
export type SampleMeta = {
  generatedAt: string
  points: number
  grain: 'daily' | 'weekly'
  profile: string
  weeks: number
}

export type UploadMeta = {
  fileName: string
  rows: number
  dateColumn: string
  valueColumn: string
  interval: SeriesInterval
  skipped: number
  uploadedAt: string
}

/** Everything the forecasting workspace holds for one driver. */
export type DriverForecastConfig = {
  /**
   * History for this driver: the plan's own actuals, an uploaded file, or
   * generated sample data for testing the models before real history exists.
   */
  dataSource: ForecastDataSource
  uploadedSeries?: DatedPoint[]
  uploadMeta?: UploadMeta
  /** Set when `uploadedSeries` holds generated sample data, never real data. */
  sampleMeta?: SampleMeta

  models: WfmModelId[]
  testSplit: TestSplit
  countries: string[]
  /**
   * Days the client operates. Closed days would otherwise be read as genuine
   * zeros, teaching the models an opening schedule as if it were demand.
   */
  operatingDays: OperatingDay[]
  detectAnomalies: boolean
  replaceAnomalies: boolean
  horizonWeeks: number
  /**
   * Grain to forecast at.
   *
   * Weekly feeds the Capacity Plan. Daily is available only when the uploaded
   * data is daily, reads the shape a week averages away, and cannot be applied —
   * the plan has no row to put a Tuesday in.
   */
  forecastGrain?: 'weekly' | 'daily'

  /** Whether this driver's forecast feeds the Capacity Plan. */
  applyToCapacityPlan: boolean
  /** Model chosen to drive the plan; unset means best-accuracy wins. */
  selectedModelId?: string

  /**
   * Forecaster judgment layered on the model. Kept separate from the model's
   * own output so the adjustment stays visible and reversible, and so it
   * survives a re-run — the reason for an event is still true after refitting.
   */
  events?: ForecastEvent[]
  overrides?: ForecastOverrides

  // ── last run ────────────────────────────────────────────────────────────
  lastRunAt?: string
  /** Fingerprint of the inputs the results came from, for staleness checks. */
  resultsSignature?: string
  planWeeks?: string[]
  interval?: SeriesInterval
  warnings?: string[]
  anomalies?: StoredAnomaly[]
  anomalousHolidayPatterns?: string[]
  holidays?: StoredHoliday[]
  results?: StoredWfmModel[]
}

/** Per-driver configs for one scenario, keyed by metric id. */
export type ScenarioDriverForecasts = Partial<Record<string, DriverForecastConfig>>

export type AdvancedForecastStore = Record<string, ScenarioDriverForecasts>

// v3: configuration moved from scenario level to per-driver, so each driver can
// use its own data and models. v2 entries describe a different shape.
const STORAGE_KEY = 'wfp-driver-forecast-v3'

/**
 * Sensible starting models per driver.
 *
 * Volume is seasonal and holiday-sensitive, so the models that accept exogenous
 * regressors earn their place. Attrition and absenteeism are short, noisy series
 * where the heavy learners overfit, so they start with steadier methods.
 */
export function defaultModelsFor(metricId: string): WfmModelId[] {
  switch (metricId) {
    case 'callVolume':
      // Volume carries the strongest weekly and annual shape, so the two
      // seasonal models lead and seasonal-naive stays as a baseline to beat.
      return ['holt-winters', 'fourier-holidays', 'theta']
    case 'ahtSeconds':
      // AHT drifts more than it cycles; Theta's half-trend suits that, with
      // Holt-Winters there in case a weekly pattern does exist.
      return ['theta', 'holt-winters', 'exponential-smoothing']
    case 'attritionHc':
      // Short, noisy counts. Theta is the steadiest of the three here.
      return ['theta', 'exponential-smoothing', 'simple-moving-average']
    default:
      // Absenteeism, shrinkage and custom rate drivers.
      return ['theta', 'holt-winters', 'exponential-smoothing']
  }
}


export function sanitizeWfmModels(models: readonly string[] | undefined, metricId: string): WfmModelId[] {
  const valid = (models ?? []).filter(isWfmModelId)
  return valid.length ? valid : defaultModelsFor(metricId)
}

export function defaultDriverConfig(metricId: string): DriverForecastConfig {
  return {
    dataSource: 'capacity_plan',
    models: defaultModelsFor(metricId),
    forecastGrain: 'weekly',
    testSplit: '90/10',
    countries: [],
    operatingDays: [...OPERATING_DAYS],
    detectAnomalies: false,
    replaceAnomalies: false,
    horizonWeeks: 52,
    // Off by default: writing a forecast into a staffing plan is deliberate.
    applyToCapacityPlan: false,
  }
}

/**
 * Fingerprint of everything that changes what a forecast means.
 *
 * Model choice and horizon are excluded on purpose: those produce a different
 * forecast of the same thing. A different source series produces a forecast of
 * something else.
 */
export function driverSignature(config: DriverForecastConfig): string {
  const series = config.uploadedSeries
  const shape = series?.length
    ? `${series.length}:${series[0]!.date}:${series[series.length - 1]!.date}`
    : 'none'
  return [
    config.dataSource,
    shape,
    config.sampleMeta?.generatedAt ?? '',
    config.countries.join('+'),
    config.operatingDays.join('+'),
    config.replaceAnomalies,
  ].join('|')
}

export function isDriverResultStale(config: DriverForecastConfig): boolean {
  return Boolean(
    config.results && config.resultsSignature && config.resultsSignature !== driverSignature(config),
  )
}

/**
 * Fit overlays only draw the model's line over history, and a multi-year daily
 * series across several models will exhaust the storage quota on its own. Keep a
 * recent window.
 */
const MAX_STORED_HISTORICAL_PREDICTIONS = 400

function trimModel(model: StoredWfmModel): StoredWfmModel {
  if ((model.historicalPredictions?.length ?? 0) <= MAX_STORED_HISTORICAL_PREDICTIONS) return model
  return {
    ...model,
    historicalPredictions: model.historicalPredictions.slice(-MAX_STORED_HISTORICAL_PREDICTIONS),
  }
}

export function loadAdvancedForecasts(): AdvancedForecastStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as AdvancedForecastStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveAdvancedForecasts(store: AdvancedForecastStore): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    return true
  } catch {
    // Over quota. Drop the fit overlays — the bulkiest part and the least
    // costly to lose — then try once more before giving up.
    try {
      const lean: AdvancedForecastStore = {}
      for (const [scenarioId, drivers] of Object.entries(store)) {
        lean[scenarioId] = Object.fromEntries(
          Object.entries(drivers).map(([metricId, config]) => [
            metricId,
            config
              ? {
                  ...config,
                  results: config.results?.map((model) => ({ ...model, historicalPredictions: [] })),
                }
              : config,
          ]),
        )
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lean))
      return true
    } catch {
      return false
    }
  }
}

export function getScenarioDrivers(scenarioId: string): ScenarioDriverForecasts {
  return loadAdvancedForecasts()[scenarioId] ?? {}
}

export function getDriverForecast(scenarioId: string, metricId: string): DriverForecastConfig {
  const stored = getScenarioDrivers(scenarioId)[metricId]
  const merged = stored ? { ...defaultDriverConfig(metricId), ...stored } : defaultDriverConfig(metricId)
  return { ...merged, models: sanitizeWfmModels(merged.models, metricId) }
}

export function setDriverForecast(
  scenarioId: string,
  metricId: string,
  config: DriverForecastConfig,
): AdvancedForecastStore {
  const store = loadAdvancedForecasts()
  const trimmed: DriverForecastConfig = config.results
    ? { ...config, results: config.results.map(trimModel) }
    : config
  const next: AdvancedForecastStore = {
    ...store,
    [scenarioId]: { ...(store[scenarioId] ?? {}), [metricId]: trimmed },
  }
  saveAdvancedForecasts(next)
  return next
}

export function patchDriverForecast(
  scenarioId: string,
  metricId: string,
  patch: Partial<DriverForecastConfig>,
): AdvancedForecastStore {
  return setDriverForecast(scenarioId, metricId, {
    ...getDriverForecast(scenarioId, metricId),
    ...patch,
  })
}

export function setDriverModelSelection(
  scenarioId: string,
  metricId: ForecastMetricId,
  modelId: string | null,
): AdvancedForecastStore {
  return patchDriverForecast(scenarioId, metricId, { selectedModelId: modelId ?? undefined })
}

export function clearDriverResults(scenarioId: string, metricId: string): AdvancedForecastStore {
  const current = getDriverForecast(scenarioId, metricId)
  return setDriverForecast(scenarioId, metricId, {
    ...current,
    results: undefined,
    anomalies: undefined,
    anomalousHolidayPatterns: undefined,
    holidays: undefined,
    warnings: undefined,
    planWeeks: undefined,
    lastRunAt: undefined,
    resultsSignature: undefined,
  })
}

/** Best successful model for a driver: the pinned one, else the top-ranked. */
export function bestDriverModel(config: DriverForecastConfig): StoredWfmModel | null {
  const usable = (config.results ?? []).filter((model) => model.success)
  if (!usable.length) return null
  const pinned = config.selectedModelId
    ? usable.find((model) => model.id === config.selectedModelId)
    : undefined
  return pinned ?? usable[0]!
}

/** True when this driver's history is generated sample data rather than real. */
export function usesSampleData(config: DriverForecastConfig): boolean {
  return config.dataSource === 'sample' && Boolean(config.sampleMeta)
}

/**
 * The grain of the history a driver is actually reading.
 *
 * Single-sourced because it answers two questions that must never disagree:
 * whether to offer a daily forecast, and what grain to fit at. A real upload
 * always carries its detected interval, so the weekly fallback only fires for a
 * source that has lost its metadata — a stale or failed upload. Unknown must
 * resolve to weekly: assuming daily offers a day-of-week shape on data that has
 * no days in it.
 */
export function resolveSourceGrain(
  dataSource: ForecastDataSource,
  meta: { uploadInterval?: SeriesInterval; sampleGrain?: SeriesInterval },
): SeriesInterval {
  if (dataSource === 'sample') return meta.sampleGrain ?? 'weekly'
  if (dataSource === 'upload') return meta.uploadInterval ?? 'weekly'
  // Plan actuals are weekly by construction.
  return 'weekly'
}

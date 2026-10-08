import type { DatedPoint } from './forecastDataSource'
import {
  WFM_MODEL_IDS,
  WFM_MODEL_LABELS,
  type SeriesInterval,
  type StoredWfmModel,
  type TestSplit,
  type WeeklyRollupPoint,
  type WfmModelId,
} from './advancedForecastPersistence'
import { runForecastModels } from '../utils/staffingCapacity/forecastModels'
import { holtWinters, seasonalPeriodFor, theta } from './browserSeasonalModels'
import { fourierHolidayModel } from './browserFourierModel'
import type { HolidayMap } from './browserHolidays'
import { collectPairs, predictionBand, rollingFolds, scorePairs } from './forecastAccuracy'
import type { WfmCatalogue, WfmForecastRequest, WfmForecastResponse } from '../data/forecastApiClient'

/** Fast statistical models that run in the browser on Vercel with no Python service. */
export const BROWSER_WFM_MODEL_IDS: readonly WfmModelId[] = WFM_MODEL_IDS

const SUM_METRICS = new Set(['callVolume', 'attritionHc'])
const MEAN_METRICS = new Set(['ahtSeconds', 'occupancy', 'totalShrinkagePct', 'absenteeism'])
const IMPLAUSIBLE_RATIO = 10

export function isBrowserWfmModel(id: string): id is WfmModelId {
  return (BROWSER_WFM_MODEL_IDS as readonly string[]).includes(id)
}

export function browserWfmCatalogue(): WfmCatalogue {
  return {
    models: WFM_MODEL_IDS.map((id) => ({
      id,
      label: WFM_MODEL_LABELS[id],
      available: isBrowserWfmModel(id),
      supportsHolidays: false,
      script: 'browser',
    })),
    testSplits: ['90/10', '80/20', '70/30'],
    // Forecasting is weekly throughout; finer input is aggregated first.
    intervals: ['weekly'],
  }
}

function testFraction(split: TestSplit): number {
  if (split === '70/30') return 0.3
  if (split === '80/20') return 0.2
  return 0.1
}

function addStep(iso: string, grain: SeriesInterval): string {
  const date = new Date(`${iso}T12:00:00`)
  if (grain === 'weekly') date.setDate(date.getDate() + 7)
  else if (grain === 'monthly') date.setMonth(date.getMonth() + 1)
  else date.setDate(date.getDate() + 1)
  return date.toISOString().slice(0, 10)
}

function futureDates(last: string, grain: SeriesInterval, count: number): string[] {
  const dates: string[] = []
  let cursor = last
  for (let i = 0; i < count; i++) {
    cursor = addStep(cursor, grain)
    dates.push(cursor)
  }
  return dates
}

/** Whether a stored date can be turned into a real day. */
function isUsableDate(iso: string): boolean {
  return typeof iso === 'string' && !Number.isNaN(new Date(`${iso}T12:00:00`).getTime())
}

function weekStartOf(iso: string, weekStart: 'sunday' | 'monday'): string {
  const date = new Date(`${iso}T12:00:00`)
  const day = date.getDay()
  const back = weekStart === 'monday' ? (day + 6) % 7 : day
  date.setDate(date.getDate() - back)
  return date.toISOString().slice(0, 10)
}

/**
 * Fold a series into whole weeks aligned to the plan's week start.
 *
 * Forecasting is weekly throughout, because the capacity plan is: a weekly
 * forecast lands directly on plan weeks with no rollup, no partial-week
 * arithmetic, and no risk of a daily horizon covering only a seventh of the
 * plan. Anything finer is aggregated here before a model ever sees it.
 *
 * Counts are summed and rates averaged, and incomplete weeks at either end are
 * dropped — a week holding two days sums to two days' worth and would read as a
 * collapse in demand rather than the edge of the data.
 */
function toWeeklySeries(
  series: DatedPoint[],
  weekStart: 'sunday' | 'monday',
  how: 'sum' | 'mean',
): DatedPoint[] {
  const buckets = new Map<string, number[]>()
  for (const point of series) {
    const week = weekStartOf(point.date, weekStart)
    buckets.set(week, [...(buckets.get(week) ?? []), point.value])
  }

  const weeks = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  if (!weeks.length) return []

  // Only the first and last week can legitimately be clipped by the range; an
  // interior short week is real missing data and stays.
  const expected = Math.max(...weeks.map(([, values]) => values.length))
  const complete = weeks.filter(([, values], index) => {
    const edge = index === 0 || index === weeks.length - 1
    return !edge || values.length >= expected
  })

  return complete.map(([week, values]) => ({
    date: week,
    value: how === 'sum' ? values.reduce((s, v) => s + v, 0) : values.reduce((s, v) => s + v, 0) / values.length,
  }))
}

/** Bucket holiday dates into the weeks that contain them. */
function toWeeklyHolidays(holidays: HolidayMap, weekStart: 'sunday' | 'monday'): HolidayMap {
  const weekly: HolidayMap = new Map()
  for (const [date, names] of holidays) {
    const week = weekStartOf(date, weekStart)
    const merged = weekly.get(week) ?? []
    for (const name of names) if (!merged.includes(name)) merged.push(name)
    weekly.set(week, merged)
  }
  return weekly
}

function aggregationFor(metricId: string | undefined, unit: string): 'sum' | 'mean' {
  if (metricId && SUM_METRICS.has(metricId)) return 'sum'
  if (metricId && MEAN_METRICS.has(metricId)) return 'mean'
  return unit === 'percent' || unit === 'seconds' ? 'mean' : 'sum'
}

/**
 * Hold a forecast inside the range its driver can physically take.
 *
 * Every driver here is a count, a duration or a rate, and none of them can be
 * negative: there is no such thing as -2,400 calls or -3 leavers. Models that
 * extrapolate a straight line do produce those — a declining account run out 52
 * weeks crosses zero and keeps going — and a negative volume reaching the plan
 * corrupts every staffing number derived from it.
 *
 * Clamping is the honest response rather than a fudge. Once a fitted line says
 * "below zero", the model has left the range where it means anything, and zero
 * is the nearest value that is still true. The accuracy scores are untouched, so
 * a model driven to the floor still shows the poor fit that put it there.
 */
function clampToDriverRange(value: number, unit: string): number {
  if (!Number.isFinite(value)) return value
  if (unit === 'percent') return Math.min(1, Math.max(0, value))
  return Math.max(0, value)
}

function aggregateToWeeks(
  points: Array<{ date: string; value: number }>,
  weekStart: 'sunday' | 'monday',
  how: 'sum' | 'mean',
  targetWeeks: string[],
  unit: string,
  /** Interval half-width per horizon step, aligned to `points`. */
  band?: number[],
): WeeklyRollupPoint[] {
  const buckets = new Map<string, number[]>()
  const bands = new Map<string, number[]>()
  points.forEach((point, index) => {
    const week = weekStartOf(point.date, weekStart)
    buckets.set(week, [...(buckets.get(week) ?? []), point.value])
    const half = band?.[index]
    if (half != null) bands.set(week, [...(bands.get(week) ?? []), half])
  })
  const rolled = new Map<string, WeeklyRollupPoint>()
  for (const [week, values] of buckets) {
    const total = values.reduce((sum, value) => sum + value, 0)
    const value = how === 'sum' ? total : total / values.length
    const halves = bands.get(week)
    // Summed weeks add their uncertainty in quadrature rather than linearly:
    // errors across days are not perfectly correlated, and adding them
    // straight would overstate the range badly.
    const half = halves?.length
      ? how === 'sum'
        ? Math.sqrt(halves.reduce((s, h) => s + h * h, 0))
        : halves.reduce((s, h) => s + h, 0) / halves.length
      : undefined
    const clamped = clampToDriverRange(value, unit)
    rolled.set(week, {
      week,
      value: clamped,
      days: values.length,
      ...(half != null
        ? {
            lower: clampToDriverRange(clamped - half, unit),
            upper: clampToDriverRange(clamped + half, unit),
          }
        : {}),
    })
  }
  if (!targetWeeks.length) return [...rolled.values()].sort((a, b) => a.week.localeCompare(b.week))
  return targetWeeks.flatMap((week) => {
    const row = rolled.get(week)
    return row ? [row] : []
  })
}

/**
 * Holt-Winters and Theta model the seasonal cycle directly, so they take the
 * series grain to know how long that cycle is. The others are grain-agnostic.
 */
function pickEngineResult(
  modelId: WfmModelId,
  y: number[],
  horizon: number,
  grain: SeriesInterval = 'weekly',
  calendar?: { dates: string[]; futureDates: string[]; holidays?: HolidayMap },
) {
  if (modelId === 'fourier-holidays') {
    if (!calendar) return undefined
    const fit = fourierHolidayModel(y, horizon, {
      dates: calendar.dates,
      futureDates: calendar.futureDates,
      grain,
      holidays: calendar.holidays,
    })
    return fit
      ? { id: modelId, label: fit.label, fitted: fit.fitted, horizon: fit.horizon }
      : undefined
  }
  if (modelId === 'holt-winters' || modelId === 'theta') {
    const period = seasonalPeriodFor(grain, y.length)
    const fit =
      modelId === 'holt-winters' ? holtWinters(y, period, horizon) : theta(y, period, horizon)
    return fit
      ? { id: modelId, label: fit.label, fitted: fit.fitted, horizon: fit.horizon }
      : undefined
  }
  const results = runForecastModels(y, horizon)
  if (modelId === 'simple-moving-average') {
    return results.find((item) => item.id === 'ma') ?? results[0]
  }
  if (modelId === 'linear-trend') {
    return results.find((item) => item.id === 'trend') ?? results[0]
  }
  if (modelId === 'seasonal-naive') {
    // No silent substitution: falling back to plain naive here would report a
    // non-seasonal forecast under the "Seasonal naive" label. Absent means the
    // series is too short for a yearly cycle, and the caller reports that.
    return results.find((item) => item.id === 'seasonal_naive')
  }
  return results.find((item) => item.id === 'holt') ?? results.find((item) => item.id === 'ses') ?? results[0]
}

function implausible(history: number[], forecast: number[]): string | undefined {
  const actuals = history.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  const values = forecast.filter((value) => Number.isFinite(value))
  if (actuals.length < 3 || !values.length) return undefined
  const median = actuals[Math.floor(actuals.length / 2)]!
  if (Math.abs(median) < 1e-9) return undefined
  const peak = Math.max(...values.map((value) => Math.abs(value)))
  if (peak > Math.abs(median) * IMPLAUSIBLE_RATIO) {
    return `Forecast reaches ${peak.toFixed(0)} against a historical median of ${median.toFixed(0)} — the fit diverged, so it was not offered.`
  }
  return undefined
}

function fitOne(
  modelId: WfmModelId,
  series: DatedPoint[],
  grain: SeriesInterval,
  horizon: number,
  testSplit: TestSplit,
  weekStart: 'sunday' | 'monday',
  targetWeeks: string[],
  metricId: string | undefined,
  metricUnit: string,
  holidays: HolidayMap | undefined,
): StoredWfmModel {
  // Nothing to fit. Reached when a driver has no actuals at all, or when every
  // week it does have was unusable — a crash here would take the whole tab down
  // over one badly keyed import.
  if (!series.length) {
    return {
      id: modelId,
      label: WFM_MODEL_LABELS[modelId] ?? modelId,
      success: false,
      error: 'No usable history: every week was missing, non-numeric, or undated.',
      forecast: [],
      historicalPredictions: [],
      accuracy: {},
      parameters: { engine: 'browser' },
      weekly: [],
    }
  }

  const y = series.map((point) => point.value)
  const lastDate = series[series.length - 1]!.date
  const allDates = series.map((point) => point.date)

  /**
   * Rolling-origin backtest: fit at several cut points and score each on the
   * weeks that follow. A single split on a short series scores on two or three
   * points, which is not enough to rank models by — consecutive runs reordered
   * them. Pooling folds gives a figure worth acting on.
   */
  const folds = rollingFolds(y.length, testFraction(testSplit))
  const pairs: Array<{ actual: number; predicted: number }> = []
  const residuals: number[] = []

  for (const fold of folds) {
    const train = y.slice(0, fold.trainSize)
    const actual = y.slice(fold.trainSize, fold.trainSize + fold.testSize)
    if (!actual.length) continue
    const fit = pickEngineResult(modelId, train, actual.length, grain, {
      // Each fold may only see its own history, or the model would be handed the
      // answer through its own design matrix.
      dates: allDates.slice(0, fold.trainSize),
      futureDates: allDates.slice(fold.trainSize, fold.trainSize + fold.testSize),
      holidays,
    })
    if (!fit) continue
    const predicted = fit.horizon.slice(0, actual.length)
    pairs.push(...collectPairs(actual, predicted))
    for (let i = 0; i < actual.length && i < predicted.length; i++) {
      residuals.push(predicted[i]! - actual[i]!)
    }
  }

  // A model that cannot be scored must not appear with blank accuracy beside
  // models that were: it sorts unpredictably and reads as a rounding gap rather
  // than a model that needs more history.
  if (!pairs.length) {
    return {
      id: modelId,
      label: WFM_MODEL_LABELS[modelId],
      success: false,
      error: `Needs more history: ${series.length} weeks is too few for this model to be fitted and scored.`,
      forecast: [],
      historicalPredictions: [],
      accuracy: {},
      parameters: { engine: 'browser' },
      weekly: [],
    }
  }

  const fullFit = pickEngineResult(modelId, y, horizon, grain, {
    dates: series.map((point) => point.date),
    futureDates: futureDates(lastDate, grain, horizon),
    holidays,
  })
  if (!fullFit) {
    return {
      id: modelId,
      label: WFM_MODEL_LABELS[modelId],
      success: false,
      error: 'Not enough history to fit this model in the browser.',
      forecast: [],
      historicalPredictions: [],
      accuracy: {},
      parameters: { engine: 'browser' },
      weekly: [],
    }
  }

  const forecastDates = futureDates(lastDate, grain, fullFit.horizon.length)
  const forecast = fullFit.horizon.map((value, index) => ({
    date: forecastDates[index]!,
    value,
    predicted: value,
  }))
  const diverged = implausible(y, fullFit.horizon)
  if (diverged) {
    return {
      id: modelId,
      label: WFM_MODEL_LABELS[modelId],
      success: false,
      error: diverged,
      forecast: [],
      historicalPredictions: [],
      accuracy: {},
      parameters: { engine: 'browser' },
      weekly: [],
    }
  }

  const how = aggregationFor(metricId, metricUnit)
  const score = scorePairs(pairs, folds.length)
  // Built from backtest errors, so the band reflects how wrong this model was
  // forecasting forward — not how closely it traced history it had seen.
  const band = predictionBand(residuals, fullFit.horizon.length)

  return {
    id: modelId,
    label: WFM_MODEL_LABELS[modelId],
    success: true,
    forecast,
    historicalPredictions: series.map((point, index) => ({
      date: point.date,
      value: fullFit.fitted[index] ?? point.value,
      predicted: fullFit.fitted[index] ?? point.value,
    })),
    accuracy: {
      // WAPE leads: it weights each week by its volume, so a quiet holiday
      // week cannot dominate the score the way it does under MAPE.
      wape: score.wape,
      mape: score.mape,
      bias: score.bias,
      rmse: score.rmse,
      mae: score.mae,
      train_test_split: testSplit,
      test_samples: score.samples,
      folds: score.folds,
      pattern_r: score.patternR,
      amplitude_ratio: score.amplitudeRatio,
    },
    parameters: { engine: 'browser', method: fullFit.label },
    /**
     * Plan weeks, and nothing at all when the fit was daily.
     *
     * The Capacity Plan reads this field and only this field, so leaving it
     * empty is what makes a daily forecast unusable by the plan rather than
     * merely discouraged. The daily points are still returned above, which is
     * what the charts and the data table read.
     */
    weekly:
      grain === 'daily'
        ? []
        : aggregateToWeeks(forecast, weekStart, how, targetWeeks, metricUnit, band),
    aggregation: grain === 'daily' ? 'daily' : how,
  }
}

export function runBrowserWfmForecast(
  request: WfmForecastRequest,
  holidays?: HolidayMap,
): WfmForecastResponse {
  // A date that cannot be parsed is dropped rather than carried: it would
  // otherwise reach `new Date(...)` further in and throw on a value nobody can
  // see, which reads to a planner as the app breaking rather than as one bad row.
  const raw = [...request.data]
    .filter((point) => Number.isFinite(point.value) && isUsableDate(point.date))
    .sort((a, b) => a.date.localeCompare(b.date))

  /**
   * Weekly unless asked otherwise, because the Capacity Plan is weekly and a
   * forecast it cannot consume is analysis rather than a plan input.
   *
   * Daily keeps the series at its own grain: the models already take a grain and
   * size their seasonal period from it — seven days rather than fifty two weeks
   * — and the holidays stay on their own dates rather than being rolled into the
   * week that contains them.
   */
  const how = aggregationFor(request.metricId, request.metricUnit)
  const grain: SeriesInterval = request.grain === 'daily' ? 'daily' : 'weekly'
  const series = grain === 'daily' ? raw : toWeeklySeries(raw, request.weekStart, how)
  const weeklyHolidays =
    holidays && grain === 'weekly' ? toWeeklyHolidays(holidays, request.weekStart) : holidays

  const requested = request.models.length ? request.models.filter(isBrowserWfmModel) : [...BROWSER_WFM_MODEL_IDS]
  const modelsToRun = requested.length ? requested : [...BROWSER_WFM_MODEL_IDS]
  const models = modelsToRun.map((modelId) =>
    fitOne(
      modelId,
      series,
      grain,
      Math.max(1, request.horizon),
      request.testSplit,
      request.weekStart,
      request.targetWeeks,
      request.metricId,
      request.metricUnit,
      weeklyHolidays,
    ),
  )

  /**
   * Best first, because the top row is what drives the plan unless a planner
   * picks otherwise.
   *
   * Ranked on WAPE, the same measure the table leads with and the one this file
   * documents as the WFM convention. It previously ranked on MAPE, which could
   * put a model first that the WAPE column showed to be worse — the app then
   * recommended a model its own scoreboard argued against.
   *
   * Ties break on the smaller absolute bias: between two models of equal error,
   * the one that does not lean is the safer plan driver.
   */
  models.sort((a, b) => {
    if (a.success !== b.success) return a.success ? -1 : 1

    const aWape = a.accuracy.wape ?? Number.POSITIVE_INFINITY
    const bWape = b.accuracy.wape ?? Number.POSITIVE_INFINITY
    if (aWape !== bWape) return aWape - bWape

    const aBias = Math.abs(a.accuracy.bias ?? Number.POSITIVE_INFINITY)
    const bBias = Math.abs(b.accuracy.bias ?? Number.POSITIVE_INFINITY)
    return aBias - bBias
  })

  return {
    models,
    interval: grain,
    horizon: request.horizon,
    anomalies: [],
    anomalousHolidayPatterns: [],
    holidays: [],
    warnings: [],
  }
}

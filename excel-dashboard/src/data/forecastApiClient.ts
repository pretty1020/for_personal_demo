import type {
  SeriesInterval,
  StoredAnomaly,
  StoredHoliday,
  StoredWfmModel,
  TestSplit,
  WfmModelId,
} from '../planner/advancedForecastPersistence'
import { WFM_MODEL_IDS } from '../planner/advancedForecastPersistence'
import { browserWfmCatalogue, runBrowserWfmForecast } from '../planner/browserWfmForecast'
import { resolveHolidays } from '../planner/browserHolidays'
import type { DatedPoint } from '../planner/forecastDataSource'

/**
 * Forecasting runs entirely in the browser with fast statistical models
 * (seasonal naïve, linear trend, exponential smoothing, moving average).
 * Prophet / torch / NeuralProphet are not used — they cannot run on Vercel
 * without a separate long-lived Python service and take minutes per fit.
 */

export function getForecastApiBase(): string {
  return ''
}

export function isForecastServiceConfigured(): boolean {
  return false
}

export class ForecastServiceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ForecastServiceError'
  }
}

export type ForecastServiceHealth = {
  ok: boolean
  models: Record<string, boolean>
  authRequired?: boolean
  engine?: 'python' | 'browser'
}

export async function fetchForecastHealth(): Promise<ForecastServiceHealth | null> {
  return {
    ok: true,
    engine: 'browser',
    models: Object.fromEntries(WFM_MODEL_IDS.map((id) => [id, true])),
  }
}

export type ForecastCountry = { code: string; name: string; featured: boolean }

export async function fetchForecastCountries(): Promise<ForecastCountry[]> {
  return []
}

export type WfmModelInfo = {
  id: WfmModelId
  label: string
  available: boolean
  supportsHolidays: boolean
  script: string
}

export type WfmCatalogue = {
  models: WfmModelInfo[]
  testSplits: TestSplit[]
  intervals: SeriesInterval[]
}

export async function fetchWfmCatalogue(): Promise<WfmCatalogue> {
  return browserWfmCatalogue()
}

export type WfmForecastRequest = {
  data: DatedPoint[]
  horizon: number
  interval?: SeriesInterval
  models: WfmModelId[]
  testSplit: TestSplit
  /** Holiday calendars for the trend + seasonality + holidays model. */
  countries?: string[]
  preserveZeros?: boolean
  weekStart: 'sunday' | 'monday'
  targetWeeks: string[]
  metricId?: string
  metricUnit: 'number' | 'percent' | 'seconds'
  /**
   * Grain to fit and forecast at.
   *
   * Weekly is the plan's own grain and the only one it can consume. Daily is
   * for reading a pattern the week hides — day-of-week shape, a holiday's own
   * profile — and deliberately produces nothing the Capacity Plan can take.
   */
  grain?: 'weekly' | 'daily'
}

export type WfmForecastResponse = {
  models: StoredWfmModel[]
  interval: SeriesInterval
  horizon: number
  anomalies: StoredAnomaly[]
  anomalousHolidayPatterns: string[]
  holidays: StoredHoliday[]
  warnings: string[]
}

export async function runWfmForecast(request: WfmForecastRequest): Promise<WfmForecastResponse> {
  // Holidays are only fetched when a country is chosen and a model can use
  // them; the calendar package is a separate chunk, so nobody else pays for it.
  const wantsHolidays =
    Boolean(request.countries?.length) && request.models.includes('fourier-holidays')
  if (!wantsHolidays) return runBrowserWfmForecast(request)

  const sorted = [...request.data].sort((a, b) => a.date.localeCompare(b.date))
  const first = sorted[0]?.date
  const last = request.targetWeeks[request.targetWeeks.length - 1] ?? sorted[sorted.length - 1]?.date
  if (!first || !last) return runBrowserWfmForecast(request)

  try {
    // Reach a year past the horizon so the final weeks still see their holidays.
    const until = `${Number(last.slice(0, 4)) + 1}${last.slice(4)}`
    const holidays = await resolveHolidays(request.countries ?? [], first, until)
    return runBrowserWfmForecast(request, holidays)
  } catch {
    // A calendar that fails to load must not lose the forecast.
    return runBrowserWfmForecast(request)
  }
}

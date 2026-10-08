import type {
  StoredAnomaly,
  StoredHoliday,
  StoredWfmModel,
} from './advancedForecastPersistence'
import type { DatedPoint } from './forecastDataSource'

/**
 * Assemble the historical / fitted / forecast series behind the forecasting
 * charts, at daily, weekly or monthly grain.
 *
 * The model scripts disagree on the key holding a value — the moving average
 * emits `predicted`, Prophet's frame uses `yhat` — so every read goes through
 * `readValue` rather than assuming one name.
 */

export type ChartGrain = 'daily' | 'weekly' | 'monthly'

export type ForecastRow = {
  /** Bucket key: an ISO date, week-start date, or YYYY-MM. */
  key: string
  label: string
  weekday: string | null
  historical: number | null
  /** In-sample fitted value, for the weeks the model trained on. */
  fitted: number | null
  /** Out-of-sample forecast. */
  forecast: number | null
  /** Prediction interval around the forecast, where the model produced one. */
  lower: number | null
  upper: number | null
  holiday: string | null
  anomaly: StoredAnomaly | null
  isFuture: boolean
  /** Points contributing to each series in this bucket, for spotting partials. */
  historicalDays: number
  fittedDays: number
  forecastDays: number
}

const VALUE_KEYS = ['value', 'predicted', 'yhat', 'forecast', 'prediction'] as const

export function readValue(point: Record<string, unknown> | undefined | null): number | null {
  if (!point) return null
  for (const key of VALUE_KEYS) {
    const raw = point[key]
    if (raw == null) continue
    const value = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isFinite(value)) return value
  }
  return null
}

function readDate(point: Record<string, unknown> | undefined | null): string | null {
  if (!point) return null
  const raw = point.date ?? point.ds ?? point.week
  if (raw == null) return null
  const text = String(raw).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null
}

function weekStartOf(iso: string, weekStart: 'sunday' | 'monday'): string {
  const date = new Date(`${iso}T12:00:00`)
  const day = date.getDay()
  const back = weekStart === 'monday' ? (day + 6) % 7 : day
  date.setDate(date.getDate() - back)
  return date.toISOString().slice(0, 10)
}

function bucketKey(iso: string, grain: ChartGrain, weekStart: 'sunday' | 'monday'): string {
  if (grain === 'monthly') return iso.slice(0, 7)
  if (grain === 'weekly') return weekStartOf(iso, weekStart)
  return iso
}

function weekdayOf(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })
}

type Bucket = {
  historical: number[]
  fitted: number[]
  forecast: number[]
  holidays: string[]
  anomaly: StoredAnomaly | null
  isFuture: boolean
  firstDate: string
}

/**
 * Build the chart rows.
 *
 * `aggregation` decides how a bucket folds up: counts add, rates average.
 * Summing a rate would turn a week of 300-second days into a 1500-second week.
 */
export function buildForecastRows(options: {
  history: DatedPoint[]
  model: StoredWfmModel | null
  grain: ChartGrain
  weekStart: 'sunday' | 'monday'
  aggregation: 'sum' | 'mean'
  holidays?: StoredHoliday[]
  anomalies?: StoredAnomaly[]
  /** Prediction interval per bucket key, from the model's weekly rollup. */
  bands?: Map<string, { lower: number; upper: number }>
}): ForecastRow[] {
  const { history, model, grain, weekStart, aggregation, holidays, anomalies, bands } = options

  const buckets = new Map<string, Bucket>()
  const ensure = (iso: string, isFuture: boolean): Bucket => {
    const key = bucketKey(iso, grain, weekStart)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = {
        historical: [],
        fitted: [],
        forecast: [],
        holidays: [],
        anomaly: null,
        isFuture,
        firstDate: iso,
      }
      buckets.set(key, bucket)
    }
    // A bucket counts as future only if nothing historical landed in it.
    if (!isFuture) bucket.isFuture = false
    if (iso < bucket.firstDate) bucket.firstDate = iso
    return bucket
  }

  for (const point of history) {
    if (!Number.isFinite(point.value)) continue
    ensure(point.date, false).historical.push(point.value)
  }

  if (model) {
    for (const raw of model.historicalPredictions ?? []) {
      const date = readDate(raw)
      const value = readValue(raw)
      if (date && value != null) ensure(date, false).fitted.push(value)
    }
    for (const raw of model.forecast ?? []) {
      const date = readDate(raw as Record<string, unknown>)
      const value = readValue(raw as Record<string, unknown>)
      if (date && value != null) ensure(date, true).forecast.push(value)
    }
  }

  for (const holiday of holidays ?? []) {
    const bucket = buckets.get(bucketKey(holiday.date, grain, weekStart))
    if (bucket) bucket.holidays.push(holiday.name)
  }

  for (const anomaly of anomalies ?? []) {
    const bucket = buckets.get(bucketKey(anomaly.date, grain, weekStart))
    // At coarser grains only the first anomaly in the bucket is surfaced.
    if (bucket && !bucket.anomaly) bucket.anomaly = anomaly
  }

  const fold = (values: number[]): number | null => {
    if (!values.length) return null
    const total = values.reduce((sum, value) => sum + value, 0)
    return aggregation === 'sum' ? total : total / values.length
  }

  // Materialise every bucket across the range, including empty ones. Without
  // this a missing week is simply absent, and the chart draws its neighbours
  // side by side — hiding the gap instead of showing a break in the line.
  const ordered = [...buckets.keys()].sort((a, b) => a.localeCompare(b))
  if (ordered.length > 1) {
    for (const key of enumerateBuckets(ordered[0]!, ordered[ordered.length - 1]!, grain)) {
      if (!buckets.has(key)) {
        buckets.set(key, {
          historical: [],
          fitted: [],
          forecast: [],
          holidays: [],
          anomaly: null,
          // An empty bucket inherits nothing; treat it as historical so it does
          // not extend the forecast region.
          isFuture: false,
          firstDate: key,
        })
      }
    }
  }

  const rows = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, bucket]) => ({
      key,
      label: key,
      weekday: grain === 'daily' ? weekdayOf(key) : null,
      historical: fold(bucket.historical),
      fitted: fold(bucket.fitted),
      forecast: fold(bucket.forecast),
      holiday: bucket.holidays.length ? [...new Set(bucket.holidays)].join(', ') : null,
      anomaly: bucket.anomaly,
      isFuture: bucket.isFuture,
      lower: bands?.get(key)?.lower ?? null,
      upper: bands?.get(key)?.upper ?? null,
      historicalDays: bucket.historical.length,
      fittedDays: bucket.fitted.length,
      forecastDays: bucket.forecast.length,
    }))

  return aggregation === 'sum' ? blankPartialEdges(rows, grain) : rows
}

/** Every bucket key from `first` to `last` inclusive, at the given grain. */
function enumerateBuckets(first: string, last: string, grain: ChartGrain): string[] {
  const keys: string[] = []
  if (grain === 'monthly') {
    const [startYear, startMonth] = first.split('-').map(Number)
    const [endYear, endMonth] = last.split('-').map(Number)
    let year = startYear!
    let month = startMonth!
    // Guard the loop: a malformed key must not spin forever.
    for (let i = 0; i < 1200; i++) {
      keys.push(`${year}-${String(month).padStart(2, '0')}`)
      if (year === endYear && month === endMonth) break
      month += 1
      if (month > 12) {
        month = 1
        year += 1
      }
    }
    return keys
  }

  const step = grain === 'weekly' ? 7 : 1
  const cursor = new Date(`${first}T12:00:00`)
  const end = new Date(`${last}T12:00:00`)
  for (let i = 0; i < 20_000 && cursor <= end; i++) {
    keys.push(cursor.toISOString().slice(0, 10))
    cursor.setDate(cursor.getDate() + step)
  }
  return keys
}

/**
 * Blank the incomplete buckets at each series' edges when values are summed.
 *
 * A week holding two days of data sums to two days' worth and draws as a cliff,
 * which reads as a collapse in demand rather than the edge of the data. Rates are
 * unaffected because averaging a short week is still a valid weekly rate.
 *
 * Only the first and last bucket of each series are blanked — an interior gap is
 * real missing data and should stay visible.
 */
const EDGE_COMPLETENESS = 0.9

function blankPartialEdges(rows: ForecastRow[], grain: ChartGrain): ForecastRow[] {
  if (grain === 'daily' || rows.length < 2) return rows

  const expected = (key: string): number => {
    if (grain === 'weekly') return 7
    const [year, month] = key.split('-').map(Number)
    return new Date(year!, month!, 0).getDate()
  }

  const out = rows.map((row) => ({ ...row }))

  const trimEdges = (
    field: 'historical' | 'fitted' | 'forecast',
    countField: 'historicalDays' | 'fittedDays' | 'forecastDays',
  ) => {
    const present = out
      .map((row, index) => (row[field] != null ? index : -1))
      .filter((index) => index >= 0)
    if (present.length < 2) return
    for (const index of [present[0]!, present[present.length - 1]!]) {
      const row = out[index]!
      // Tolerance, so a month missing a single day is not treated as partial —
      // only a genuinely short bucket draws as a cliff.
      if ((row[countField] ?? 0) < expected(row.key) * EDGE_COMPLETENESS) row[field] = null
    }
  }

  trimEdges('historical', 'historicalDays')
  trimEdges('fitted', 'fittedDays')
  trimEdges('forecast', 'forecastDays')
  return out
}

export type AccuracySplit = {
  rows: ForecastRow[]
  /** Index in `rows` where the held-back test window begins. */
  testStartIndex: number
  /** Index where the future forecast begins. */
  forecastStartIndex: number
}

/**
 * Split the daily rows into train / test / forecast for the accuracy view.
 *
 * The test window is the tail of the *historical* rows, matching the split the
 * models scored themselves on, so the chart shows the same comparison the
 * accuracy numbers came from.
 */
export function buildAccuracySplit(rows: ForecastRow[], testSplit: string): AccuracySplit {
  const historicalRows = rows.filter((row) => !row.isFuture)
  const testShare = Number(testSplit.split('/')[1] ?? '10') / 100
  const testCount = Math.max(1, Math.round(historicalRows.length * testShare))
  const testStartIndex = Math.max(0, historicalRows.length - testCount)
  const forecastStartIndex = historicalRows.length
  return { rows, testStartIndex, forecastStartIndex }
}

/** Rate drivers average across a bucket; counts add. */
export function aggregationForUnit(
  metricId: string,
  unit: 'number' | 'percent' | 'seconds',
): 'sum' | 'mean' {
  if (metricId === 'callVolume' || metricId === 'attritionHc') return 'sum'
  return unit === 'number' ? 'sum' : 'mean'
}

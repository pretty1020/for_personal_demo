import type { ForecastMetricUnit } from './forecasting'

/**
 * A starting file for uploading a driver's history.
 *
 * The uploader accepts a range of column names and date formats, which is
 * forgiving but gives someone starting from a blank spreadsheet nothing to aim
 * at — the first attempt tends to come back "No value column found" or with
 * every rate a hundred times too large. The template removes the guesswork by
 * being a file that already parses: the exact headers, real week-start dates
 * aligned to this plan, and whatever actuals the plan already holds filled in
 * so the expected magnitude is visible rather than described.
 */

export const UPLOAD_TEMPLATE_MIN_ROWS = 10

/** Row separator. Trailing one included so editors do not truncate the last row. */
const NEWLINE = String.fromCharCode(10)

/** Weeks of history a template offers when the plan has none of its own. */
const FALLBACK_WEEKS = 52

export type UploadTemplateGrain = 'weekly' | 'daily'

export type UploadTemplateInput = {
  /** Driver label, for the filename. */
  label: string
  /**
   * Weekly gives a row per plan week and can drive the Capacity Plan. Daily
   * gives a row per day, which is the only history that can carry a
   * day-of-week shape, and stays on the Forecasting page.
   */
  grain?: UploadTemplateGrain
  unit: ForecastMetricUnit
  /** Week-start dates from the plan, oldest first. */
  weeks: string[]
  /** Known actuals by week, so the file shows real numbers where they exist. */
  valuesByWeek?: Map<string, number>
  /** Week start, used only when the plan supplies no weeks to copy. */
  weekStart?: 'sunday' | 'monday'
}

export type UploadTemplate = {
  filename: string
  csv: string
  /** Rows offered, so the caller can say how many need filling. */
  rows: number
  /** Rows already carrying a value. */
  prefilled: number
  /** Which variant was built, so the caller can describe it correctly. */
  grain: UploadTemplateGrain
}

/**
 * Every day covered by a set of week-start dates.
 *
 * Derived from the weeks themselves rather than from a week-start setting, so
 * the days line up with whatever convention the plan already uses without
 * having to be told which one it is.
 */
function daysAcross(weeks: string[]): string[] {
  const days: string[] = []
  for (const week of weeks) {
    const start = new Date(`${week}T12:00:00Z`)
    if (Number.isNaN(start.getTime())) continue
    for (let offset = 0; offset < 7; offset++) {
      const day = new Date(start)
      day.setUTCDate(day.getUTCDate() + offset)
      days.push(day.toISOString().slice(0, 10))
    }
  }
  return days
}

function slug(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'driver'
}

/**
 * Week-start dates ending at the most recent one, when the plan has none to
 * copy. A template with no dates in it is just a header row.
 */
function fallbackWeeks(weekStart: 'sunday' | 'monday'): string[] {
  const today = new Date()
  const day = today.getUTCDay()
  const back = weekStart === 'monday' ? (day + 6) % 7 : day
  const latest = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back))

  return Array.from({ length: FALLBACK_WEEKS }, (_, i) => {
    const date = new Date(latest)
    date.setUTCDate(date.getUTCDate() - (FALLBACK_WEEKS - 1 - i) * 7)
    return date.toISOString().slice(0, 10)
  })
}

/**
 * How a value should be written for this driver.
 *
 * Rates are the reason this matters: the uploader reads 0.05 as five percent
 * and 5 as five hundred, and a planner filling a blank column has no way to know
 * which is wanted. Prefilled actuals answer it by example; this formats them so
 * the answer is legible.
 */
function formatValue(value: number, unit: ForecastMetricUnit): string {
  if (!Number.isFinite(value)) return ''
  if (unit === 'percent') return value.toFixed(4)
  if (unit === 'seconds') return value.toFixed(1)
  return String(Math.round(value))
}

export function buildUploadTemplate(input: UploadTemplateInput): UploadTemplate {
  const weeks = input.weeks.length ? [...input.weeks] : fallbackWeeks(input.weekStart ?? 'sunday')
  const grain: UploadTemplateGrain = input.grain === 'daily' ? 'daily' : 'weekly'

  if (grain === 'daily') {
    const days = daysAcross(weeks)
    /*
      The value column is deliberately left empty.

      The plan holds one figure per week, and the only ways to spread that over
      seven days are to repeat it or to divide it — both of which invent a flat
      week. Uploaded unchanged, that reads as a driver with no day-of-week shape
      at all, which is the one thing a daily forecast exists to find and the kind
      of error nobody would think to check for. An empty column cannot be
      mistaken for a measurement.
    */
    const dayLines = ['date,value', ...days.map((day) => `${day},`)]
    return {
      filename: `${slug(input.label)}-daily-history-template.csv`,
      csv: `${dayLines.join(NEWLINE)}${NEWLINE}`,
      rows: days.length,
      prefilled: 0,
      grain,
    }
  }

  const lines = ['week,value']
  let prefilled = 0

  for (const week of weeks) {
    const value = input.valuesByWeek?.get(week)
    const cell = value != null && Number.isFinite(value) ? formatValue(value, input.unit) : ''
    if (cell) prefilled += 1
    lines.push(`${week},${cell}`)
  }

  return {
    filename: `${slug(input.label)}-history-template.csv`,
    // Trailing newline so the last row is not truncated by editors that expect one.
    csv: `${lines.join('\n')}\n`,
    rows: weeks.length,
    prefilled,
    grain,
  }
}

/**
 * What to tell someone before they start filling it in.
 *
 * Kept beside the builder so the guidance and the file cannot describe different
 * things — the units line in particular has to match `formatValue`.
 */
export function describeUploadTemplate(
  unit: ForecastMetricUnit,
  grain: UploadTemplateGrain = 'weekly',
): string {
  const row = grain === 'daily' ? 'One row per day' : 'One row per week'
  if (unit === 'percent') {
    return `${row}. Write rates as decimals — 0.05 for 5%, not 5.`
  }
  if (unit === 'seconds') {
    return `${row}. Write handle time in seconds — 305.4, not 5m 05s.`
  }
  return `${row}, as a whole number.`
}

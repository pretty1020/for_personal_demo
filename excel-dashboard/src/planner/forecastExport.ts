import type { ForecastRow } from './forecastChartData'
import type { ForecastMetricUnit } from './forecasting'

/**
 * A forecast as a CSV, built from the rows already on screen.
 *
 * Deliberately takes the same `ForecastRow[]` the chart and the data table
 * render rather than reaching back to the model, so the file cannot disagree
 * with the screen it was downloaded from. Every quantity here has already been
 * bucketed, aggregated and unit-handled by `buildForecastRows`; this only
 * formats it.
 */

const NEWLINE = String.fromCharCode(13) + String.fromCharCode(10)

export type ForecastExportInput = {
  /** Driver label, for the filename. */
  label: string
  unit: ForecastMetricUnit
  grain: 'daily' | 'weekly' | 'monthly'
  rows: ForecastRow[]
  /** Model the rows were produced by, for the filename. */
  modelLabel?: string | null
}

export type ForecastExport = { filename: string; csv: string; rows: number }

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function escape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/**
 * Values as numbers, not as they are displayed.
 *
 * The table shows "305.5 sec" and "5.0%", which is right on screen and useless
 * in a spreadsheet — neither will sum or chart. Rates are written as the
 * decimals they are stored as, matching the upload template, so a figure means
 * the same thing on the way out as on the way in.
 *
 * Not a re-upload format, though: the unit is named in the header rather than
 * on every value, and the uploader looks for a bare `value` column. Anyone
 * wanting to feed numbers back in should start from the upload template.
 */
function cell(value: number | null, unit: ForecastMetricUnit): string {
  if (value == null || !Number.isFinite(value)) return ''
  if (unit === 'percent') return value.toFixed(4)
  if (unit === 'seconds') return value.toFixed(1)
  return String(Math.round(value))
}

/** Says what the bare numbers in a column are, since they carry no suffix. */
function unitSuffix(unit: ForecastMetricUnit): string {
  if (unit === 'percent') return ' (rate 0-1)'
  if (unit === 'seconds') return ' (seconds)'
  return ''
}

/** The same wording the data table's Status column uses. */
export function forecastRowStatus(row: ForecastRow): string {
  if (row.anomaly && row.holiday) return 'Anomalous holiday'
  if (row.anomaly) return 'Anomaly'
  if (row.isFuture) return 'Forecast'
  if (row.holiday) return 'Holiday'
  return 'Normal'
}

export function buildForecastExport(input: ForecastExportInput): ForecastExport {
  const { label, unit, grain, rows, modelLabel } = input
  const suffix = unitSuffix(unit)
  const dateHeader = grain === 'monthly' ? 'month' : grain === 'weekly' ? 'week' : 'date'

  const header = [
    dateHeader,
    // Only daily rows have a weekday worth carrying; a week-start date already
    // implies one.
    ...(grain === 'daily' ? ['weekday'] : []),
    `historical${suffix}`,
    `model_fit${suffix}`,
    `forecast${suffix}`,
    `forecast_low${suffix}`,
    `forecast_high${suffix}`,
    'holiday',
    'status',
  ]

  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.key,
        ...(grain === 'daily' ? [escape(row.weekday ?? '')] : []),
        cell(row.historical, unit),
        cell(row.fitted, unit),
        cell(row.forecast, unit),
        cell(row.lower, unit),
        cell(row.upper, unit),
        escape(row.holiday ?? ''),
        escape(forecastRowStatus(row)),
      ].join(','),
    )
  }

  const parts = [slug(label) || 'driver', 'forecast', grain]
  if (modelLabel) parts.push(slug(modelLabel))

  return {
    filename: `${parts.filter(Boolean).join('-')}.csv`,
    csv: `${lines.join(NEWLINE)}${NEWLINE}`,
    rows: rows.length,
  }
}

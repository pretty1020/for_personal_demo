import * as XLSX from 'xlsx'

/**
 * Historical input for the forecasting workbench.
 *
 * A forecast can be driven either by the scenario's own Capacity Plan actuals or
 * by a file the planner uploads. The uploaded path exists because the plan
 * ledger is weekly and often short, while the models do their best work on a
 * long daily series where day-of-week and holiday effects are still visible.
 */

/** `sample` is generated placeholder history — never real data. */
export type ForecastDataSource = 'capacity_plan' | 'upload' | 'sample'

export type DatedPoint = { date: string; value: number }

export type ParsedUpload = {
  points: DatedPoint[]
  dateColumn: string
  valueColumn: string
  /** Rows skipped because the date or value could not be read. */
  skipped: number
  columns: string[]
  interval: 'daily' | 'weekly' | 'monthly'
}

export class UploadParseError extends Error {}

const DATE_HEADERS = ['date', 'day', 'week', 'period', 'ds', 'datetime', 'timestamp', 'week start']
const VALUE_HEADERS = [
  'value',
  'volume',
  'calls',
  'call volume',
  'contacts',
  'offered',
  'y',
  'actual',
  'actuals',
  'count',
  'quantity',
]

function normalise(header: string): string {
  return header.trim().toLowerCase().replace(/[_-]+/g, ' ')
}

/**
 * Parse the date formats that turn up in operational exports.
 *
 * Deliberately explicit rather than trusting `new Date(string)`: that parses
 * "01/02/2026" as a US date in some engines and a UK date in others, which would
 * silently reorder a whole series.
 */
export function parseFlexibleDate(input: unknown): string | null {
  if (input == null || input === '') return null

  // xlsx hands back real Date objects for date-formatted cells.
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return toIso(input)
  }

  // Excel serial day numbers.
  if (typeof input === 'number' && Number.isFinite(input)) {
    if (input > 20000 && input < 60000) {
      const parsed = XLSX.SSF?.parse_date_code?.(input)
      if (parsed) {
        return toIso(new Date(parsed.y, parsed.m - 1, parsed.d))
      }
    }
    return null
  }

  const text = String(input).trim()
  if (!text) return null

  // ISO first — unambiguous.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text)
  if (iso) {
    return buildIso(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  }

  // D/M/Y or M/D/Y with either separator.
  const parts = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(text)
  if (parts) {
    const first = Number(parts[1])
    const second = Number(parts[2])
    let year = Number(parts[3])
    if (year < 100) year += year < 70 ? 2000 : 1900
    // A value above 12 can only be the day, which resolves the ambiguity.
    // Otherwise assume month-first, matching the source files' convention.
    const month = first > 12 ? second : first
    const day = first > 12 ? first : second
    return buildIso(year, month, day)
  }

  // "12 Jan 2026" / "Jan 12, 2026"
  const parsed = new Date(text)
  if (!Number.isNaN(parsed.getTime()) && /[A-Za-z]{3}/.test(text)) {
    return toIso(parsed)
  }

  return null
}

function buildIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return toIso(date)
}

function toIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseNumber(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null
  if (input == null) return null
  // Strip thousands separators and stray currency symbols.
  const cleaned = String(input).replace(/[,\s$₱£€]/g, '')
  if (!cleaned) return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

function pickColumn(columns: string[], candidates: string[]): string | null {
  const normalised = columns.map((column) => ({ column, key: normalise(column) }))
  for (const candidate of candidates) {
    const exact = normalised.find((item) => item.key === candidate)
    if (exact) return exact.column
  }
  for (const candidate of candidates) {
    const partial = normalised.find((item) => item.key.includes(candidate))
    if (partial) return partial.column
  }
  return null
}

/** Infer the series grain from its own spacing rather than trusting a label. */
export function inferInterval(points: DatedPoint[]): 'daily' | 'weekly' | 'monthly' {
  if (points.length < 3) return 'daily'
  const days = points
    .map((point) => new Date(`${point.date}T12:00:00`).getTime())
    .sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < days.length; i++) {
    const gap = Math.round((days[i]! - days[i - 1]!) / 86_400_000)
    if (gap > 0) gaps.push(gap)
  }
  if (!gaps.length) return 'daily'
  gaps.sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)]!
  if (median >= 26) return 'monthly'
  if (median >= 5) return 'weekly'
  return 'daily'
}

/**
 * Read a CSV or Excel file into a dated series.
 *
 * Column names are guessed from common operational headings, then overridable —
 * `dateColumn`/`valueColumn` let the caller correct a bad guess without
 * re-uploading.
 */
export async function parseHistoricalUpload(
  file: File,
  dateColumn?: string,
  valueColumn?: string,
): Promise<ParsedUpload> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new UploadParseError('The file has no sheets.')

  const sheet = workbook.Sheets[sheetName]!
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false })
  if (!rows.length) throw new UploadParseError('The first sheet has no rows.')

  const columns = Object.keys(rows[0] ?? {})
  const resolvedDate = dateColumn ?? pickColumn(columns, DATE_HEADERS)
  const resolvedValue = valueColumn ?? pickColumn(columns, VALUE_HEADERS)

  if (!resolvedDate) {
    throw new UploadParseError(
      `No date column found. Columns available: ${columns.join(', ') || 'none'}.`,
    )
  }
  if (!resolvedValue) {
    throw new UploadParseError(
      `No value column found. Columns available: ${columns.join(', ') || 'none'}.`,
    )
  }

  const byDate = new Map<string, number>()
  let skipped = 0

  for (const row of rows) {
    const date = parseFlexibleDate(row[resolvedDate])
    const value = parseNumber(row[resolvedValue])
    if (!date || value == null) {
      skipped++
      continue
    }
    // Duplicate dates are summed — exports are often split by queue or channel.
    byDate.set(date, (byDate.get(date) ?? 0) + value)
  }

  const points = [...byDate.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (points.length < 10) {
    throw new UploadParseError(
      `Only ${points.length} usable rows were read from ${rows.length}. ` +
        'At least 10 are needed. Check the date and value columns.',
    )
  }

  return {
    points,
    dateColumn: resolvedDate,
    valueColumn: resolvedValue,
    skipped,
    columns,
    interval: inferInterval(points),
  }
}

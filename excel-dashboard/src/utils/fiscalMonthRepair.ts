import type { ColumnSchema } from '../types/dashboard'

/**
 * April-start fiscal year (Q1 = Apr–Jun):
 * FY27 Q1 → Apr–Jun of calendar year (1999 + fyShort).
 */
function calendarYearForAprilStartFy(fyShort: number): number {
  return fyShort + 1999
}

function fiscalQuarterMonthIndexes(quarter: number): number[] {
  if (quarter === 1) return [3, 4, 5]
  if (quarter === 2) return [6, 7, 8]
  if (quarter === 3) return [9, 10, 11]
  return [0, 1, 2]
}

/**
 * Extract calendar month index (0–11) from a cell. No guessing beyond parsing.
 */
function monthIndexFromCell(v: unknown): number | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.getMonth()
  if (typeof v === 'number' && Number.isInteger(v) && v >= 199001 && v <= 210012) {
    const m = v % 100
    if (m >= 1 && m <= 12) return m - 1
  }
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  const parsed = Date.parse(s)
  if (!Number.isNaN(parsed)) return new Date(parsed).getMonth()
  const lower = s.toLowerCase()
  const names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  for (let i = 0; i < names.length; i++) {
    if (lower.startsWith(names[i])) return i
  }
  return null
}

function yearForMonthInFiscalQuarter(fyShort: number, quarter: number, monthIdx: number): number {
  const y0 = calendarYearForAprilStartFy(fyShort)
  if (quarter === 4) return monthIdx <= 2 ? y0 + 1 : y0
  return y0
}

/**
 * Matches labels like "FY27 - Q1", "FY 2027 – Q2", "FY27-Q1".
 */
export function parseFiscalQuarterLabel(text: string): { fy: number; quarter: number } | null {
  const t = text.trim()
  const m = t.match(/FY\s*(\d{2,4})\s*[-–]\s*Q\s*([1-4])/i)
  if (!m?.[1] || !m[2]) return null
  let fyRaw = Number.parseInt(m[1], 10)
  if (!Number.isFinite(fyRaw)) return null
  const fyShort = fyRaw >= 100 ? fyRaw % 100 : fyRaw
  const quarter = Number.parseInt(m[2], 10)
  if (quarter < 1 || quarter > 4) return null
  return { fy: fyShort, quarter }
}

function findFiscalQuarterColumnKey(columns: ColumnSchema[]): string | null {
  for (const c of columns) {
    const h = c.header.trim()
    if (/^fq$/i.test(h)) return c.key
  }
  for (const c of columns) {
    const h = c.header
    if (/fiscal|fy\b|quarter/i.test(h) && /fy|Q\s*[1-4]|quarter|\bfq\b/i.test(h)) return c.key
  }
  for (const c of columns) {
    if (/fiscal\s*quarter|fy\s*[-–]\s*quarter|reporting\s*period/i.test(c.header)) return c.key
  }
  return null
}

function findMonthColumnKey(columns: ColumnSchema[]): string | null {
  for (const c of columns) {
    const h = c.header.toLowerCase()
    if (/^month\b$/i.test(h) || /^calendar\s*month$/i.test(h)) return c.key
  }
  for (const c of columns) {
    const h = c.header.toLowerCase()
    if (/\bmonth\b/.test(h) && !/fiscal|fy\b|quarter|period\s*type/i.test(h)) return c.key
  }
  return null
}

/**
 * When FQ + Month exist: set Month to the canonical first-of-month Date for that FY/quarter
 * **only** when the row’s month name/index matches that fiscal quarter. No slot/increment fallback —
 * rows without a parseable month in-range are left unchanged so sums stay tied to source values.
 */
export function applyFiscalCalendarRepair(
  columns: ColumnSchema[],
  rows: Record<string, unknown>[],
): { columns: ColumnSchema[]; rows: Record<string, unknown>[] } {
  const fiscalKey = findFiscalQuarterColumnKey(columns)
  const monthKey = findMonthColumnKey(columns)
  if (!fiscalKey || !monthKey || fiscalKey === monthKey) {
    return { columns, rows }
  }

  const newRows = rows.map((r) => ({ ...r }))
  let ctx: { fy: number; quarter: number } | null = null
  let lastFiscalLabel = ''

  for (const row of newRows) {
    const fiscalRaw = row[fiscalKey]
    const fiscalStr =
      fiscalRaw !== null && fiscalRaw !== undefined && String(fiscalRaw).trim() !== ''
        ? String(fiscalRaw).trim()
        : ''

    if (fiscalStr) {
      const parsed = parseFiscalQuarterLabel(fiscalStr)
      if (parsed) {
        lastFiscalLabel = fiscalStr
        ctx = { fy: parsed.fy, quarter: parsed.quarter }
      }
    }

    if (ctx && lastFiscalLabel) {
      if (!fiscalStr) {
        row[fiscalKey] = lastFiscalLabel
      }
      const monthFromCell = monthIndexFromCell(row[monthKey])
      const validMonths = fiscalQuarterMonthIndexes(ctx.quarter)
      if (monthFromCell !== null && validMonths.includes(monthFromCell)) {
        const y = yearForMonthInFiscalQuarter(ctx.fy, ctx.quarter, monthFromCell)
        row[monthKey] = new Date(y, monthFromCell, 1)
      }
      /* else: leave month cell as already coerced — no inferred quarter slot */
    }
  }

  const newColumns = columns.map((c) =>
    c.key === monthKey
      ? { ...c, type: 'date' as const, dateGranularity: 'month' as const }
      : c,
  )

  return { columns: newColumns, rows: newRows }
}

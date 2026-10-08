import type { ColumnSchema, ColumnType } from '../types/dashboard'

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (typeof v === 'string' && v.trim() === '')
}

function tryParseNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string') {
    const raw = v.trim()
    if (!raw) return null
    const normalized = raw
      .replace(/[,$€£\s]/g, '')
      .replace(/\(([^)]+)\)/, '-$1')
      .replace(/%/g, '')
    const n = Number.parseFloat(normalized)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Integers like 202401 or strings 2024-01 / 202401 */
function tryCoerceYearMonthNumber(v: unknown): Date | null {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 199001 && v <= 210012) {
    const m = v % 100
    const y = Math.floor(v / 100)
    if (m >= 1 && m <= 12) {
      const d = new Date(y, m - 1, 1)
      return Number.isNaN(d.getTime()) ? null : d
    }
  }
  /* Compact YYMM (e.g. 2604 → Apr 2026) — not in full YYYYMM range */
  if (typeof v === 'number' && Number.isInteger(v) && v >= 101 && v < 199001) {
    const mm = v % 100
    const yy = Math.floor(v / 100)
    if (mm >= 1 && mm <= 12 && yy >= 1 && yy <= 99) {
      const year = yy >= 70 ? 1900 + yy : 2000 + yy
      const d = new Date(year, mm - 1, 1)
      return Number.isNaN(d.getTime()) ? null : d
    }
  }
  if (typeof v === 'string') {
    const t = v.trim()
    const compact = t.replace(/[-\s/]/g, '')
    if (/^\d{6}$/.test(compact)) {
      const n = Number(compact)
      return tryCoerceYearMonthNumber(n)
    }
  }
  return null
}

export function tryCoerceDate(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v
  const ym = tryCoerceYearMonthNumber(v)
  if (ym) return ym
  if (typeof v === 'number' && Number.isFinite(v)) {
    /* Excel serial day count (typical range ~30k–50k for 1980–2040) */
    if (v >= 20000 && v < 100_000) {
      try {
        const epoch = Math.round((v - 25569) * 86400 * 1000)
        const d = new Date(epoch)
        if (!Number.isNaN(d.getTime())) return d
      } catch {
        /* ignore */
      }
    }
  }
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return null
    // Guard: plain numeric strings like "900" must NOT become dates (Date.parse would treat them as year 900).
    if (/^[-+]?\d+(\.\d+)?$/.test(t)) return null
    const d = Date.parse(t)
    if (!Number.isNaN(d)) return new Date(d)
  }
  return null
}

function samplesLookLikeYearMonth(samples: unknown[]): boolean {
  const values = samples.filter((x) => !isBlank(x))
  if (values.length < 2) return false
  let hit = 0
  for (const v of values) {
    if (tryCoerceYearMonthNumber(v)) hit++
  }
  if (hit / values.length >= 0.8) return true
  /* String month names + year */
  let nameHit = 0
  const monthRx =
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,]+\d{2,4}$/i
  const revRx = /^\d{1,2}[\s/-]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i
  for (const v of values) {
    if (typeof v === 'string') {
      const s = v.trim()
      if (monthRx.test(s) || revRx.test(s)) nameHit++
    }
  }
  return nameHit / values.length >= 0.65
}

/**
 * Monetary / expense-like headers: values in the Excel serial numeric range must NOT be inferred as dates.
 */
export function looksLikeFinancialAmountHeader(header: string): boolean {
  const h = header.toLowerCase().trim()
  if (!h) return false
  if (
    /^(?:#\s*|count|hits?|calls?|sessions?|\bhours\b|\bqty\b|quantity\b|%|percent(?:age)?|head\s*count|hc\b)$/i.test(
      h,
    )
  ) {
    return false
  }
  /* "Forecast %" style columns — keep as numbers/rates, not $. */
  if (/%/.test(h) && !/(exp|cost|cogs|amount|amt|payroll|salary|wage|fee)/i.test(h)) {
    return false
  }
  // Treat "GM" / "Gross Margin" as financial amounts (PnL convention).
  if (/^\s*gm\s*$/.test(h) || /gross\s*margin|\bgm\s*\$/i.test(h)) return true
  return (
    /rec\s*exp|exp(?:ense|ns)?s?\b|^exp\b|cogs|capex\b|opex\b|budget|forecast|fcst\b|\bamt\b|amount\b|\$|usd\b|£|€/i.test(
      h,
    ) ||
    /payment|payroll|salaries|salary|wage|compensation|benefits?\b|deposit|withdraw|invoice|billing|pricing|purchase|subsidy|^rev\b|revenue|booking|^cost\b|^price\b|^fee\b|earn(?:ings)?|margin\b|balance\b/i.test(
      h,
    )
  )
}

function looksLikeDateHeader(header: string): boolean {
  const h = header.toLowerCase().trim()
  if (!h) return false
  return /\bdate\b|month|period|yyyy|yy\b|mth\b|fiscal|calendar|quarter|q[1-4]\b|week|day|daily|timestamp|posted on|created at|updated at/i.test(
    h,
  )
}

function formatMoneyCurrency(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

function formatProjectCodeDisplay(v: string, header?: string): string {
  const h = (header ?? '').toLowerCase()
  const looksLikeProject =
    h.includes('project code') || h === 'project' || h === 'projectcode' || h.includes('projectcode')
  if (!looksLikeProject) return v
  // Canonical display: no spaces around separators (e.g. CTR|ACT-CL-26001)
  return v.replace(/\s*\|\s*/g, '|').trim()
}

/** How to display and bucket date cells (used after `type === 'date'`). */
export function inferDateGranularity(
  header: string,
  samples: unknown[],
  type: ColumnType,
): 'month' | 'day' {
  if (type !== 'date') return 'day'
  if (samplesLookLikeYearMonth(samples)) return 'month'
  const h = header.toLowerCase()
  if (
    /month|period|yyyy|mth|fiscal|calendar|year[\s_-]*month/i.test(h) &&
    !/\bday\b|daily|dob|birth|timestamp/i.test(h)
  ) {
    return 'month'
  }
  const dates: Date[] = []
  for (const v of samples) {
    const d = tryCoerceDate(v)
    if (d) dates.push(d)
  }
  if (dates.length < 3) return 'day'
  const onFirst = dates.filter((d) => d.getDate() === 1).length
  if (onFirst / dates.length >= 0.6) return 'month'
  return 'day'
}

export function inferColumnType(header: string, samples: unknown[]): ColumnType {
  const hl = header.toLowerCase()
  if (hl.includes('project') && hl.includes('code')) return 'text'
  if (hl === 'campaign' || hl === 'client name' || hl === 'client') return 'text'

  const values = samples.filter((x) => !isBlank(x))
  if (values.length === 0) return 'text'

  if (!looksLikeDateHeader(header) && samplesLookLikeNumbers(values)) {
    return 'number'
  }

  if (
    looksLikeFinancialAmountHeader(header) &&
    samplesLookLikeFinancialNumbers(values)
  ) {
    return 'number'
  }

  if (samplesLookLikeYearMonth(values)) return 'date'

  let num = 0
  let date = 0
  for (const v of values) {
    const d = tryCoerceDate(v)
    if (d) {
      date++
      continue
    }
    const n = tryParseNumber(v)
    if (n !== null && typeof v !== 'boolean') {
      if (typeof v === 'string') {
        const t = v.trim()
        const onlyNum = /^[-+]?\d*\.?\d+([eE][-+]?\d+)?$/.test(t.replace(/,/g, ''))
        if (onlyNum) num++
      } else {
        num++
      }
      continue
    }
  }

  const denom = Math.max(values.length, 1)
  if (date / denom >= 0.55) return 'date'
  if (num / denom >= 0.55) return 'number'
  return 'text'
}

/** Share of cells that parse as plain numbers / currency strings (ignores Excel date serial heuristics). */
function samplesLookLikeNumbers(samples: unknown[]): boolean {
  const values = samples.filter((x) => !isBlank(x))
  if (values.length === 0) return false
  let hits = 0
  for (const v of values) {
    if (typeof v === 'boolean') continue
    if (tryParseNumber(v) !== null) hits++
  }
  return hits / values.length >= 0.7
}

/** Share of cells that parse as plain numbers / currency strings (ignores Excel date serial heuristics). */
function samplesLookLikeFinancialNumbers(samples: unknown[]): boolean {
  const values = samples.filter((x) => !isBlank(x))
  if (values.length === 0) return false
  let hits = 0
  for (const v of values) {
    if (typeof v === 'boolean') continue
    const n = tryParseNumber(v)
    if (n !== null) hits++
  }
  return hits / values.length >= 0.4
}

export function coerceCell(value: unknown, type: ColumnType): string | number | Date | null {
  if (isBlank(value)) return null
  if (type === 'date') {
    const ym = tryCoerceYearMonthNumber(value)
    if (ym) return ym
    const d = tryCoerceDate(value)
    return d ?? null
  }
  if (type === 'number') {
    const n = tryParseNumber(value)
    return n !== null ? n : null
  }
  return String(value).trim()
}

function formatMonthDisplay(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function formatDayDisplay(d: Date): string {
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Display cell text; pass the column schema when available so dates use month vs day formatting.
 */
export function formatCellForDisplay(
  value: unknown,
  column?: Pick<ColumnSchema, 'type' | 'dateGranularity'> & { header?: string },
): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const g = column?.dateGranularity
    if (g === 'month') return formatMonthDisplay(value)
    if (g === 'day') return formatDayDisplay(value)
    const h = column?.header?.toLowerCase() ?? ''
    if (/month|period|mth|fiscal|calendar/i.test(h) && !/\bday\b|daily/i.test(h)) {
      return formatMonthDisplay(value)
    }
    /* Heuristic: first of month only → show as month label */
    if (value.getDate() === 1 && value.getHours() === 0 && value.getMinutes() === 0) {
      return formatMonthDisplay(value)
    }
    return value.toLocaleString()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (
      column?.type === 'number' &&
      looksLikeFinancialAmountHeader(column.header ?? '')
    ) {
      return formatMoneyCurrency(value)
    }
    return value.toLocaleString(undefined, { maximumFractionDigits: 20 })
  }
  return formatProjectCodeDisplay(String(value), column?.header)
}

export function formatAxisLabel(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return formatCellForDisplay(value, { type: 'date' })
  return String(value)
}

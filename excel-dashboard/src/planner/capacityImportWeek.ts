import * as XLSX from 'xlsx'
import { snapToWeekStart } from './capacityWeekUtils'
import type { WeekStart } from './types'

/** Coerce Excel serials, Date objects, and ISO-like strings to YYYY-MM-DD. */
export function coerceImportWeekDate(value: unknown): string {
  if (value == null || value === '') return ''

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // SheetJS cellDates typically uses UTC midnight for the Excel day.
    const y = value.getUTCFullYear()
    const m = String(value.getUTCMonth() + 1).padStart(2, '0')
    const d = String(value.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 20000 && value < 100_000) {
      const parsed = XLSX.SSF.parse_date_code(value)
      if (parsed?.y && parsed.m && parsed.d) {
        return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
      }
    }
    return ''
  }

  const raw = String(value).trim()
  if (!raw) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)

  if (/^\d+(\.\d+)?$/.test(raw)) {
    const serial = Number(raw)
    if (serial >= 20000 && serial < 100_000) {
      const parsed = XLSX.SSF.parse_date_code(serial)
      if (parsed?.y && parsed.m && parsed.d) {
        return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
      }
    }
    return ''
  }

  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) return formatLocalIsoDate(parsed)
  return ''
}

function formatLocalIsoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function snapImportWeek(value: unknown, weekStart: WeekStart): string {
  const coerced = coerceImportWeekDate(value)
  if (!coerced) return ''
  return snapToWeekStart(coerced, weekStart)
}

/** Format a 0–1 rate for percent inputs without floating-point noise (e.g. 7.000000000000001). */
export function formatPercentInput(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ''
  const pct = value * 100
  const rounded = Math.round(pct * 1000) / 1000
  return String(rounded)
}

/** Parse a percent field (85 or 0.85) into a 0–1 rate. Empty → null. */
export function parsePercentInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '-' || trimmed === '.') return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return null
  const rate = parsed > 1 ? parsed / 100 : parsed
  return Math.max(0, Math.min(1, rate))
}

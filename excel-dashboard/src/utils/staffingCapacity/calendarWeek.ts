import { tryCoerceDate } from '../inferTypes'

/** Normalize a parsed or string week start to YYYY-MM-DD (UTC calendar parts for Date values). */
export function formatWeekStartIso(weekRaw: unknown): string {
  if (typeof weekRaw === 'string') {
    const t = weekRaw.trim()
    const iso = /^(\d{4}-\d{2}-\d{2})/.exec(t)
    if (iso) return iso[1]!
  }
  const d =
    weekRaw instanceof Date && !Number.isNaN(weekRaw.getTime()) ? weekRaw : tryCoerceDate(weekRaw)
  if (!d || Number.isNaN(d.getTime())) {
    return typeof weekRaw === 'string' ? weekRaw.trim().slice(0, 10) : ''
  }
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function normalizeWeekStartKey(raw: unknown): string {
  return formatWeekStartIso(raw)
}

/** Three-letter labels used in the staffing template and filters. */
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

function parseIsoDateLocal(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim())
  if (!match) return null
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (!Number.isFinite(y) || m < 1 || m > 12 || d < 1 || d > 31) return null
  return { y, m, d }
}

/**
 * Calendar month (YYYY-MM) that owns this planning week.
 * The week is the 7 calendar days starting on `weekStartIso` (Sunday or Monday).
 * The month with more of those days wins. Example: 2026-08-30 (Sun–Sat) has 2 days in
 * August and 5 in September, so it counts as September. 2026-11-29 has 2 days in
 * November and 5 in December, so it counts as December. Ties favor the later month.
 */
export function dominantMonthKeyFromWeekStart(weekStartIso: string): string {
  const iso = formatWeekStartIso(weekStartIso)
  const parsed = parseIsoDateLocal(iso)
  if (!parsed) return iso.length >= 7 ? iso.slice(0, 7) : ''
  const counts = new Map<string, number>()
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(parsed.y, parsed.m - 1, parsed.d + i)
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let bestKey = `${parsed.y}-${String(parsed.m).padStart(2, '0')}`
  let bestCount = -1
  for (const [key, count] of counts) {
    if (count > bestCount || (count === bestCount && key > bestKey)) {
      bestCount = count
      bestKey = key
    }
  }
  return bestKey
}

/**
 * Week is the 7 days starting on `weekStartIso`. Calendar month is the month that contains
 * the most of those days. Ties favor the later calendar month.
 */
export function dominantMonthShortFromSundayWeekStart(weekStartIso: string): string | null {
  const key = dominantMonthKeyFromWeekStart(weekStartIso)
  if (key.length < 7) return null
  const month = Number.parseInt(key.slice(5, 7), 10)
  if (!Number.isFinite(month) || month < 1 || month > 12) return null
  return MONTH_SHORT[month - 1] ?? null
}

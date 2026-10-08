import { dominantMonthShortFromSundayWeekStart } from './calendarWeek'

const QMAP: Record<string, 1 | 2 | 3 | 4> = {
  jan: 1,
  feb: 1,
  mar: 1,
  apr: 2,
  may: 2,
  jun: 2,
  jul: 3,
  aug: 3,
  sep: 3,
  oct: 4,
  nov: 4,
  dec: 4,
}

/** Maps three-letter month (Jan, Feb, …) to fiscal quarter 1–4. */
export function inferQuarterFromMonthShort(m: string): 1 | 2 | 3 | 4 | null {
  const k = m.trim().slice(0, 3).toLowerCase()
  return QMAP[k] ?? null
}

/** Stable label for grouping: `FY26 · Q1`. Uses dominant calendar month of the week when `monthShort` absent. */
export function quarterBucketLabel(fyRaw: string, monthShort: string | null, weekStartIso: string): string {
  const fy = fyRaw.trim() || '—'
  const m = monthShort ?? dominantMonthShortFromSundayWeekStart(weekStartIso)
  const q = m ? inferQuarterFromMonthShort(m) : null
  if (!q) return `${fy} · —`
  return `${fy} · Q${q}`
}

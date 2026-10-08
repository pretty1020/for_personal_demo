import { tryCoerceDate } from './inferTypes'

/** Monday 00:00:00 local of the ISO week containing `d`. */
export function startOfIsoWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const day = x.getDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  x.setDate(x.getDate() + mondayOffset)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getTime())
  x.setDate(x.getDate() + n)
  return x
}

/**
 * Assign a calendar week to the month that contains **more** of its days (Mon–Sun).
 */
export function majorityMonthForWeekRange(weekStart: Date, weekEnd: Date): { year: number; month: number } {
  const counts = new Map<string, number>()
  for (let t = weekStart.getTime(); t <= weekEnd.getTime(); t += 86400000) {
    const x = new Date(t)
    const key = `${x.getFullYear()}-${x.getMonth()}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let bestKey = ''
  let bestN = -1
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n
      bestKey = k
    }
  }
  const [y, m] = bestKey.split('-').map(Number)
  return { year: y!, month: m! }
}

export function monthBucketFirstDay(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-01`
}

/** Parse week cell to Mon–Sun range; if only one day known, infer full week around it. */
export function weekRangeFromCell(v: unknown): { start: Date; end: Date } | null {
  const d = tryCoerceDate(v)
  if (!d || Number.isNaN(d.getTime())) return null
  const start = startOfIsoWeek(d)
  const end = addDays(start, 6)
  end.setHours(23, 59, 59, 999)
  return { start, end }
}

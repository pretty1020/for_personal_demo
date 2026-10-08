import { tryCoerceDate } from './inferTypes'

/**
 * Parses Excel week column headers (M/D/Y, typos like 226 for 2026) for wide ops tabs
 * (Headcount, AHT, Attrition, Shrinkage). Shared by dataset detection and executive merge.
 */
export function parseOpsWeekColumnHeader(v: unknown): Date | null {
  const badYear = (d: Date | null): boolean =>
    Boolean(!d || Number.isNaN(d.getTime()) || d.getFullYear() < 1990 || d.getFullYear() > 2100)

  if (v instanceof Date && !Number.isNaN(v.getTime()) && !badYear(v)) return v

  let dQuick = tryCoerceDate(v)
  if (!badYear(dQuick)) return dQuick

  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  const m = t.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/)
  if (!m) return null
  const a = Number.parseInt(m[1]!, 10)
  const b = Number.parseInt(m[2]!, 10)
  let y = Number.parseInt(m[3]!, 10)
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(y)) return null
  if (y < 100) y = y >= 70 ? 1900 + y : 2000 + y
  else if (y >= 200 && y < 300) {
    y = 2000 + (y - 200)
  }
  const mm = a > 12 ? b : a
  const dd = a > 12 ? a : b
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  const out = new Date(y, mm - 1, dd)
  return Number.isNaN(out.getTime()) || badYear(out) ? null : out
}

export function countWeekLikeColumns(snap: { columns: { header: string }[] }): number {
  let n = 0
  for (const c of snap.columns) {
    if (parseOpsWeekColumnHeader(c.header)) n++
  }
  return n
}

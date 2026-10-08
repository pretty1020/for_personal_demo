import type { StaffingEnrichedRow } from './staffingCapacity/types'

/** Group leakage totals by calendar month (YYYY-MM) from week start dates. */
export function leakageTotalsByMonth(
  rows: StaffingEnrichedRow[],
): { month: string; label: string; total: number }[] {
  const byMonth = new Map<string, number>()
  for (const r of rows) {
    const mb = r.weekStartDate?.slice(0, 7)
    if (!mb) continue
    const parts = [r.hcLeakage, r.shrinkageLeakage, r.ahtLeakage, r.attritionLeakage, r.volumeLeakage]
    const add = parts.reduce<number>((s, p) => s + (p != null && Number.isFinite(p) ? p : 0), 0)
    byMonth.set(mb, (byMonth.get(mb) ?? 0) + add)
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => {
      const [y, m] = month.split('-')
      const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, {
        month: 'short',
        year: 'numeric',
      })
      return { month, label, total }
    })
}

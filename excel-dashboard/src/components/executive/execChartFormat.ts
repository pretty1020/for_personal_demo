export function formatCompact(n: number, currency = true): string {
  if (!Number.isFinite(n)) return '—'
  const sign = n < 0 ? '-' : ''
  const v = Math.abs(n)
  if (currency) {
    if (v >= 1e9) return `${sign}$${(v / 1e9).toFixed(1)}B`
    if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(1)}M`
    if (v >= 1e3) return `${sign}$${(v / 1e3).toFixed(1)}K`
    return `${sign}$${v.toFixed(0)}`
  }
  if (v >= 1e6) return `${sign}${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${sign}${(v / 1e3).toFixed(1)}K`
  return `${sign}${v.toFixed(0)}`
}

export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(1)}%`
}

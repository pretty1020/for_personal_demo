/** Location-level headcount totals — call-center portfolio (~165 production agents). */

export type LocationHcBucket = 'Philippines' | 'India'

export type LocationHcTotals = {
  activeProduction: number
  teamLead: number
  opsManager: number
  qa: number
  trainer: number
  wfm: number
}

export const LOCATION_HC_TOTALS: Record<LocationHcBucket, LocationHcTotals> = {
  Philippines: {
    activeProduction: 58,
    teamLead: 4,
    opsManager: 1,
    qa: 2,
    trainer: 1,
    wfm: 3,
  },
  India: {
    activeProduction: 95,
    teamLead: 6,
    opsManager: 1,
    qa: 3,
    trainer: 1.5,
    wfm: 4,
  },
}

/** Small Romania program (not in PH/IN rollup). */
export const ROMANIA_HC_TOTALS: LocationHcTotals = {
  activeProduction: 12,
  teamLead: 1,
  opsManager: 0.2,
  qa: 0.5,
  trainer: 0.3,
  wfm: 0.5,
}

export function locationHcBucket(location: string): LocationHcBucket | 'Romania' | null {
  const l = location.trim().toLowerCase()
  if (l === 'philippines' || l.includes('manila') || l.includes('cebu')) return 'Philippines'
  if (l === 'india' || l.includes('hyderabad') || l.includes('bangalore') || l.includes('chennai')) {
    return 'India'
  }
  if (l === 'romania' || l.includes('cluj')) return 'Romania'
  return null
}

/** Split `total` across weights; returned integers sum exactly to `total`. */
export function allocateIntegers(weights: number[], total: number): number[] {
  if (!weights.length || total <= 0) return weights.map(() => 0)
  const sumW = weights.reduce((a, b) => a + b, 0) || 1
  const raw = weights.map((w) => (w / sumW) * total)
  const out = raw.map((v) => Math.floor(v))
  let rem = total - out.reduce((a, b) => a + b, 0)
  const order = raw
    .map((v, i) => ({ i, frac: v - out[i]! }))
    .sort((a, b) => b.frac - a.frac)
  for (let k = 0; k < rem; k++) out[order[k % order.length]!.i]!++
  return out
}

/** Split a decimal total (e.g. trainers 1.5) with 2-decimal precision per slot. */
export function allocateDecimals(weights: number[], total: number, decimals = 2): number[] {
  if (!weights.length || total <= 0) return weights.map(() => 0)
  const factor = 10 ** decimals
  const scaledTotal = Math.round(total * factor)
  const ints = allocateIntegers(weights, scaledTotal)
  return ints.map((n) => n / factor)
}

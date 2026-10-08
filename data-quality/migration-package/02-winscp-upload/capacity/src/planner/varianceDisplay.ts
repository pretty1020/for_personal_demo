import { fmtNum, fmtPct } from './format'

const VARIANCE_EPSILON = 1e-9

export function fmtVarianceDelta(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (Math.abs(value) < VARIANCE_EPSILON) return fmtNum(0, decimals)
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${fmtNum(value, decimals)}`
}

export function fmtVarianceDeltaPct(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (Math.abs(value) < VARIANCE_EPSILON) return fmtPct(0, decimals)
  const pct = value * 100
  const prefix = pct > 0 ? '+' : ''
  return `${prefix}${pct.toFixed(decimals)}%`
}

export function fmtVarianceDeltaSeconds(value: number | null | undefined, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (Math.abs(value) < VARIANCE_EPSILON) return `${fmtNum(0, decimals)} sec`
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${fmtNum(value, decimals)} sec`
}

/** Positive delta is favorable (e.g. FTE surplus, handled volume above offered). */
export function varianceToneHigherBetter(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'neutral'
  if (value > VARIANCE_EPSILON) return 'variance-pos'
  if (value < -VARIANCE_EPSILON) return 'variance-neg'
  return 'neutral'
}

/** Negative delta is favorable (e.g. lower shrinkage, attrition, or AHT vs plan). */
export function varianceToneLowerBetter(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'neutral'
  if (value > VARIANCE_EPSILON) return 'variance-neg'
  if (value < -VARIANCE_EPSILON) return 'variance-pos'
  return 'neutral'
}

/** Staffing % near or above 100% is favorable. */
export function staffingPctTone(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'neutral'
  if (value < 0.95) return 'variance-neg'
  if (value <= 1.05) return 'variance-pos'
  return 'good'
}

/** Offered volume vs forecast — at or above plan is favorable. */
export function offeredToForecastTone(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'neutral'
  if (value < 0.95) return 'variance-neg'
  if (value >= 0.95) return 'variance-pos'
  return 'neutral'
}

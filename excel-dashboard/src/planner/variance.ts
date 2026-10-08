import type { VarianceMetricDef } from './metrics'
import type { PeriodResult } from './types'

/** Deterministic demo actuals when no database actuals are attached — replace via API later. */
export function deriveDemoActuals(plan: number, periodIndex: number, key: string, higherIsBetter: boolean): number {
  const seed = (periodIndex + 1) * 17 + key.length * 13
  const noise = ((seed % 100) / 100 - 0.5) * 0.06
  const bias = higherIsBetter ? -0.02 : 0.02
  return plan * (1 + bias + noise)
}

export function getActualValue(p: PeriodResult, m: VarianceMetricDef): number {
  if (m.actualKey && typeof p[m.actualKey] === 'number') return p[m.actualKey] as number
  if (m.actualsKey && p.actuals?.[m.actualsKey] != null) return p.actuals[m.actualsKey] as number
  const plan = p[m.planKey] as number
  return deriveDemoActuals(plan, p.periodIndex, m.key, m.higherIsBetter)
}

export function varianceTone(plan: number, actual: number, higherIsBetter: boolean): 'good' | 'bad' | 'neutral' {
  const delta = actual - plan
  if (Math.abs(delta) < plan * 0.005) return 'neutral'
  if (higherIsBetter) return delta >= 0 ? 'good' : 'bad'
  return delta <= 0 ? 'good' : 'bad'
}

export function fmtVariance(plan: number, actual: number, pct?: boolean): string {
  const delta = actual - plan
  if (pct && plan !== 0) {
    const pctDelta = (delta / plan) * 100
    const sign = pctDelta >= 0 ? '+' : ''
    return `${sign}${pctDelta.toFixed(1)}%`
  }
  const sign = delta >= 0 ? '+' : ''
  if (Math.abs(delta) >= 1000) return `${sign}${(delta / 1000).toFixed(1)}k`
  return `${sign}${delta.toFixed(pct ? 1 : delta % 1 === 0 ? 0 : 1)}`
}

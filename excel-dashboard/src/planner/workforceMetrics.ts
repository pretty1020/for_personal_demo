import type { ExecutiveSummary } from './types'

/** Production headcount − required headcount (signed: + over, − under). */
export function headcountOverUnder(productionHeadcount: number, requiredHeadcount: number): number {
  return productionHeadcount - requiredHeadcount
}

/** Understaffing shortfall (0 when over-staffed). */
export function headcountCapacityGap(productionHeadcount: number, requiredHeadcount: number): number {
  return Math.max(0, requiredHeadcount - productionHeadcount)
}

/** Production headcount ÷ required headcount (ratio; 1.0 = 100%). */
export function staffingPctRatio(productionHeadcount: number, requiredHeadcount: number): number | null {
  if (!requiredHeadcount || requiredHeadcount <= 0) return null
  return productionHeadcount / requiredHeadcount
}

export function staffingPctTone(
  productionHeadcount: number,
  requiredHeadcount: number,
): 'good' | 'warn' | 'bad' | 'info' | 'neutral' {
  const ratio = staffingPctRatio(productionHeadcount, requiredHeadcount)
  if (ratio == null) return 'neutral'
  if (ratio > 1.05) return 'info'
  if (ratio >= 1) return 'good'
  if (ratio >= 0.95) return 'warn'
  return 'bad'
}

export function summaryHeadcountKpis(summary: ExecutiveSummary) {
  const production = summary.workforceFte
  const productionFte = summary.productionFte
  const required = summary.requiredFte
  return {
    productionHeadcount: production,
    productionFte,
    requiredHeadcount: required,
    overUnderStaffing: headcountOverUnder(productionFte, required),
    staffingPct: staffingPctRatio(productionFte, required),
  }
}

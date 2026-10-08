import type { ParsedRateRow, StaffingEnrichedRow, StaffingPlanRow } from './types'
import {
  DEFAULT_IN_OFFICE_SHARE_OF_TOTAL_SHRINK,
  IN_OFFICE_NONBILLABLE_SHARE,
} from './shrinkageBreakdown'
import {
  classifyBillingModel,
  effectiveBillingRate,
  fteMonthlyRateFactor,
  resolveProductionHoursPerHead,
  throughputPerHead,
} from './billingModel'

export function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const t = v.replace(/[$€£,\s%]/g, '').trim()
    if (!t) return null
    const n = Number.parseFloat(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Shrinkage stored as 0.32 or 32 — returns 0–1 fraction when possible. */
export function toShrinkFraction(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null
  if (v >= 0 && v <= 1) return v
  if (v > 1 && v <= 100) return v / 100
  if (v > 100) return v / 100
  return v
}

/** Resolve in-office vs out-of-office shrink fractions (0–1). Missing pieces are inferred from total shrink when available. */
export function resolveIoOoShrinkFractions(r: StaffingPlanRow): {
  ioP: number | null
  ioA: number | null
  ooP: number | null
  ooA: number | null
} {
  const psF = toShrinkFraction(r.plannedShrinkPct)
  const asF = toShrinkFraction(r.actualShrinkPct)
  let ioP = toShrinkFraction(r.plannedInOfficeShrinkPct)
  let ooP = toShrinkFraction(r.plannedOutOfficeShrinkPct)
  let ioA = toShrinkFraction(r.actualInOfficeShrinkPct)
  let ooA = toShrinkFraction(r.actualOutOfficeShrinkPct)

  if (psF != null) {
    if (ioP == null && ooP == null) {
      ioP = psF * DEFAULT_IN_OFFICE_SHARE_OF_TOTAL_SHRINK
      ooP = psF - ioP
    } else if (ioP == null && ooP != null) {
      ioP = Math.max(0, psF - ooP)
    } else if (ooP == null && ioP != null) {
      ooP = Math.max(0, psF - ioP)
    }
  }
  if (asF != null) {
    if (ioA == null && ooA == null) {
      ioA = asF * DEFAULT_IN_OFFICE_SHARE_OF_TOTAL_SHRINK
      ooA = asF - ioA
    } else if (ioA == null && ooA != null) {
      ioA = Math.max(0, asF - ooA)
    } else if (ooA == null && ioA != null) {
      ooA = Math.max(0, asF - ioA)
    }
  }
  return { ioP, ioA, ooP, ooA }
}

export function nonBillableShrinkFraction(planned: boolean, r: StaffingPlanRow): number | null {
  const { ioP, ioA, ooP, ooA } = resolveIoOoShrinkFractions(r)
  const io = planned ? ioP : ioA
  const oo = planned ? ooP : ooA
  if (io == null && oo == null) return null
  return (oo ?? 0) + (io ?? 0) * IN_OFFICE_NONBILLABLE_SHARE
}

export function strCell(v: unknown): string {
  if (v == null) return ''
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  return String(v).trim()
}

function normDim(s: string): string {
  return s.trim().toLowerCase()
}

function rateKeyParts(projectCode: string, client: string, campaign: string, lob: string, billingType: string): string {
  return `${normDim(projectCode)}|${normDim(client)}|${normDim(campaign)}|${normDim(lob)}|${normDim(billingType)}`
}

export function ownerJoinKey(client: string, campaign: string, lob: string): string {
  return `${normDim(client)}|${normDim(campaign)}|${normDim(lob)}`
}

export function pickRateForRow(rates: ParsedRateRow[], row: StaffingPlanRow, weekStart: Date | null): { rate: number | null; currency: string | null } {
  const pc = row.projectCode
  const client = row.client
  const campaign = row.campaign
  const lob = row.lob
  const billingType = row.billingType

  const base = rates.filter((r) => {
    if (r.rate == null || !Number.isFinite(r.rate)) return false
    return (
      normDim(r.billingType) === normDim(billingType) &&
      normDim(r.client) === normDim(client) &&
      normDim(r.campaign) === normDim(campaign) &&
      normDim(r.lob) === normDim(lob)
    )
  })

  let candidates = base
  if (normDim(pc)) {
    const pcHits = base.filter((r) => normDim(r.projectCode) === normDim(pc))
    if (pcHits.length) candidates = pcHits
  }

  const inWindow = candidates.filter((r) => {
    if (!weekStart) return true
    const ws = weekStart.getTime()
    if (r.effectiveStart && ws < r.effectiveStart.getTime()) return false
    if (r.effectiveEnd && ws > r.effectiveEnd.getTime()) return false
    return true
  })

  const pool = inWindow.length ? inWindow : candidates
  if (!pool.length) return { rate: null, currency: null }
  const pick = pool[0]!
  return { rate: pick.rate, currency: pick.currency || null }
}

/** Manual rate map key (must match mergeManualRates). */
export function manualRateKey(row: Pick<StaffingPlanRow, 'projectCode' | 'client' | 'campaign' | 'lob' | 'billingType'>): string {
  return rateKeyParts(row.projectCode, row.client, row.campaign, row.lob, row.billingType)
}

export function enrichStaffingRow(r: StaffingPlanRow): StaffingEnrichedRow {
  const model = classifyBillingModel(r.billingType)
  const effRate = effectiveBillingRate(r)
  const hPer = resolveProductionHoursPerHead(r)
  const fte = r.activeProdFte
  const act = r.activeProdHc
  const req = r.requiredHc
  const fv = r.forecastVolume
  const ao = r.actualOfferedVolume
  const ah = r.actualHandledVolume
  const ps = r.plannedShrinkPct
  const as = r.actualShrinkPct
  const pa = r.plannedAttrition
  const aa = r.actualAttrition
  const pAht = r.plannedAht
  const aAht = r.actualAht

  const hcOu =
    req != null && act != null && Number.isFinite(req) && Number.isFinite(act) ? act - req : null

  const volumeGap = fv != null && ah != null && Number.isFinite(fv) && Number.isFinite(ah) ? fv - ah : null
  const offeredVsForecastGap = fv != null && ao != null && Number.isFinite(fv) && Number.isFinite(ao) ? ao - fv : null
  const handledVsForecastGap = fv != null && ah != null && Number.isFinite(fv) && Number.isFinite(ah) ? ah - fv : null

  const psF = toShrinkFraction(ps)
  const asF = toShrinkFraction(as)

  const trainingHcOut = r.trainingHc != null && Number.isFinite(r.trainingHc) ? r.trainingHc : null
  const supportHcOut = r.supportHc != null && Number.isFinite(r.supportHc) ? r.supportHc : null

  const availableFtePlanned =
    act != null && psF != null && Number.isFinite(act) && Number.isFinite(psF) ? act * (1 - psF) : null
  const availableFteActual =
    act != null && asF != null && Number.isFinite(act) && Number.isFinite(asF) ? act * (1 - asF) : null

  const shrinkageVariance =
    psF != null && asF != null && Number.isFinite(psF) && Number.isFinite(asF) ? asF - psF : null

  const attritionVariance =
    pa != null && aa != null && Number.isFinite(pa) && Number.isFinite(aa) ? aa - pa : null

  const ahtVariance =
    pAht != null && aAht != null && Number.isFinite(pAht) && Number.isFinite(aAht) ? aAht - pAht : null

  const gapHc = req != null && act != null && Number.isFinite(req) && Number.isFinite(act) ? Math.max(req - act, 0) : null
  const fteForShrink = fte != null && fte > 0 ? fte : act != null && act > 0 ? act : null
  const thr = throughputPerHead(r)

  const fteProrate = fteMonthlyRateFactor(r)

  let hcLeakage: number | null = null
  if (gapHc != null && effRate != null) {
    if (model === 'transactional') hcLeakage = gapHc * thr * effRate
    else if (model === 'fte_monthly') hcLeakage = gapHc * effRate * fteProrate
    else hcLeakage = gapHc * hPer * effRate
  }

  let volumeLeakage: number | null = null
  if (fv != null && ah != null && effRate != null && Number.isFinite(fv) && Number.isFinite(ah)) {
    volumeLeakage = Math.max(fv - ah, 0) * effRate
  }

  let shrinkageLeakage: number | null = null
  const nbPl = nonBillableShrinkFraction(true, r)
  const nbAc = nonBillableShrinkFraction(false, r)
  if (nbPl != null && nbAc != null && effRate != null) {
    const overrun = Math.max(nbAc - nbPl, 0)
    if (overrun <= 0) shrinkageLeakage = null
    else if (model === 'transactional' && ah != null && act != null && act > 0) {
      shrinkageLeakage = overrun * act * thr * effRate
    } else if (model === 'fte_monthly' && fteForShrink != null) {
      shrinkageLeakage = overrun * fteForShrink * effRate * fteProrate
    } else if (model === 'fte_monthly' && act != null && act > 0) {
      shrinkageLeakage = overrun * act * effRate * fteProrate
    } else if (fteForShrink != null && hPer > 0) {
      shrinkageLeakage = overrun * fteForShrink * hPer * effRate
    } else if (act != null && act > 0 && hPer > 0) {
      shrinkageLeakage = overrun * act * hPer * effRate
    }
  }

  let attritionLeakage: number | null = null
  if (pa != null && aa != null && effRate != null) {
    const heads = Math.max(aa - pa, 0)
    if (model === 'transactional') attritionLeakage = heads * thr * effRate
    else if (model === 'fte_monthly') attritionLeakage = heads * effRate * fteProrate
    else attritionLeakage = heads * hPer * effRate
  }

  let ahtLeakage: number | null = null
  if (pAht != null && aAht != null && ah != null && effRate != null) {
    const overrunSec = Math.max(aAht - pAht, 0)
    if (overrunSec > 0) {
      if (model === 'per_minute') ahtLeakage = (overrunSec / 60) * ah * effRate
      else if (model === 'transactional') ahtLeakage = (overrunSec / 3600) * ah * effRate
      else ahtLeakage = (overrunSec / 3600) * ah * effRate
    }
  }

  const parts = [hcLeakage, volumeLeakage, shrinkageLeakage, attritionLeakage, ahtLeakage]
  const allNull = parts.every((p) => p == null)
  const totalRevenueLeakage = allNull
    ? null
    : parts.reduce<number>((s, p) => s + (p != null && Number.isFinite(p) ? p : 0), 0)

  return {
    ...r,
    trainingHc: trainingHcOut,
    supportHc: supportHcOut,
    billingModel: model,
    productionHoursPerHead: Number.isFinite(hPer) ? hPer : null,
    availableFtePlanned,
    availableFteActual,
    hcOu,
    volumeGap,
    offeredVsForecastGap,
    handledVsForecastGap,
    shrinkageVariance,
    attritionVariance,
    ahtVariance,
    hcLeakage,
    volumeLeakage,
    shrinkageLeakage,
    attritionLeakage,
    ahtLeakage,
    totalRevenueLeakage,
  }
}

export function recommendationsForRow(r: StaffingEnrichedRow): string[] {
  const out: string[] = []
  const req = r.requiredHc
  const act = r.activeProdHc
  if (req != null && act != null && req > act) {
    out.push('Address headcount shortage: hiring plan, overtime, redeployment from surplus queues, or schedule optimization.')
  }
  const nbPl = nonBillableShrinkFraction(true, r)
  const nbAc = nonBillableShrinkFraction(false, r)
  if (nbPl != null && nbAc != null && nbAc > nbPl) {
    out.push(
      'Non-billable shrinkage overrun (in-office non-billable + out-of-office): tighten AUX caps, break/meeting adherence, leave governance, and absenteeism plans; upload in vs out-of-office shrink columns when available.',
    )
  }
  if (r.plannedAht != null && r.actualAht != null && r.actualAht > r.plannedAht) {
    out.push('AHT overrun: coaching, process redesign, knowledge base refresh, and call-driver analytics.')
  }
  if (r.plannedAttrition != null && r.actualAttrition != null && r.actualAttrition > r.plannedAttrition) {
    out.push('Attrition gap: retention reviews, hiring pipeline acceleration, nesting and training capacity.')
  }
  if (r.forecastVolume != null && r.actualHandledVolume != null && r.actualHandledVolume < r.forecastVolume) {
    out.push('Volume risk vs forecast: capacity recovery, routing review, backlog clearance, staffing alignment to demand.')
  }
  return out
}

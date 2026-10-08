/**
 * Billing model drives how Billing Rate ($) combines with FTE, production hours, and volumes.
 * — FTE: rate = USD per FTE per month (prorated weekly for capacity weeks).
 * — Production Hours: rate = USD per productive labor hour.
 * — Transactional: rate = USD per completed transaction / chat.
 * — Per Minute (legacy labels): rate = USD per handle minute.
 */

import type { StaffingPlanRow } from './types'

export type BillingModelKind = 'fte_monthly' | 'fte_hours' | 'per_minute' | 'transactional'

/** Canonical billing type for filters and rate KPIs. */
export type CanonicalBillingType = 'FTE' | 'Production Hours' | 'Transactional'

export const CANONICAL_BILLING_TYPES: readonly CanonicalBillingType[] = [
  'FTE',
  'Production Hours',
  'Transactional',
]

/** UI options for Financial / LOB billable type. */
export const BILLABLE_TYPE_OPTIONS: readonly { value: CanonicalBillingType; label: string; hint: string }[] = [
  {
    value: 'FTE',
    label: 'Per FTE',
    hint: 'Hourly: Production FTE × weekly productive hours × hourly rate. Monthly rate: Production HC × (monthly rate ÷ weeks in month).',
  },
  {
    value: 'Production Hours',
    label: 'Production Hours',
    hint: 'Hourly: Production FTE × weekly productive hours × hourly rate. Example $24: 19 FTE × hours × 24, so 7 FTE bills less than 19 FTE.',
  },
  {
    value: 'Transactional',
    label: 'Per Transactions / Chat',
    hint: 'Revenue = volume (or handled volume) × per-unit rate',
  },
] as const

const DEFAULT_DAYS = 21
const DEFAULT_HOURS_PER_DAY = 7.5

/** Realistic sample / reference rate bands by canonical billing type. */
export const BILLING_RATE_BANDS: Record<
  CanonicalBillingType,
  { label: string; hint: string; min: number; max: number }
> = {
  FTE: {
    label: 'Avg rate — FTE (USD / month)',
    hint: 'Mean monthly FTE billing rate (typical range $2,000–3,000 per FTE per month).',
    min: 2000,
    max: 3000,
  },
  'Production Hours': {
    label: 'Avg rate — production hours (USD / hr)',
    hint: 'Mean production-hour billing rate (typical range $15–25 per productive hour).',
    min: 15,
    max: 25,
  },
  Transactional: {
    label: 'Avg rate — transactional (USD / unit)',
    hint: 'Mean per-transaction / chat billing rate (typical range $3–5 per completed unit).',
    min: 3,
    max: 5,
  },
}

export function billableTypeLabel(billingType: string): string {
  const canon = canonicalBillingType(billingType)
  return BILLABLE_TYPE_OPTIONS.find((option) => option.value === canon)?.label ?? canon
}

export function canonicalBillingType(billingType: string): CanonicalBillingType {
  const s = billingType.trim().toLowerCase()
  if (!s) return 'Production Hours'
  if (/\btrans|per\s*transaction|unit\s*bill|outcome|\bchat\b|per\s*chat/i.test(s)) return 'Transactional'
  if (/\bmonth|monthly|per\s*fte|fte\s*\/\s*month|fte\s*month/i.test(s)) return 'FTE'
  if (/\bfte\b|full\s*time/i.test(s) && !/\bhour|production|minute/i.test(s)) return 'FTE'
  return 'Production Hours'
}

/** True when the LOB bills on a monthly FTE basis (manual required FTE in Capacity). */
export function isFteBillingPlan(billingType: string): boolean {
  return canonicalBillingType(billingType) === 'FTE'
}

/** Hourly / per-minute revenue is billed from staffed Production FTE hours, not handle-time volume. */
export function billsStaffedHours(billingType: string): boolean {
  const canon = canonicalBillingType(billingType)
  return canon === 'FTE' || canon === 'Production Hours'
}

export function classifyBillingModel(billingType: string): BillingModelKind {
  const s = billingType.trim().toLowerCase()
  const canon = canonicalBillingType(billingType)
  if (canon === 'Transactional') return 'transactional'
  if (/\bminute|per\s*min|ppm\b|cpm\b/i.test(s)) return 'per_minute'
  if (canon === 'FTE') return 'fte_monthly'
  return 'fte_hours'
}

/** @deprecated Use {@link canonicalBillingType} */
export type BillingRateBasis = CanonicalBillingType

/** @deprecated Use {@link canonicalBillingType} */
export function classifyBillingRateBasis(billingType: string): CanonicalBillingType {
  return canonicalBillingType(billingType)
}

export function rateBasisKpiMeta(kind: CanonicalBillingType) {
  return BILLING_RATE_BANDS[kind]
}

/** Prorate monthly FTE rate to the row period (default 21 working days / month). */
export function fteMonthlyRateFactor(r: Pick<StaffingPlanRow, 'days'>): number {
  const days = r.days != null && r.days > 0 && Number.isFinite(r.days) ? r.days : DEFAULT_DAYS
  return days / DEFAULT_DAYS
}

/**
 * Production Hours column: if ≤ 300, treated as **per-agent productive hours** in the period;
 * if larger, treated as **total team productive hours** → divided by Active Production HC.
 */
export function resolveProductionHoursPerHead(r: StaffingPlanRow): number {
  const ph = r.productionHours
  const act = r.activeProdHc
  const days = r.days != null && r.days > 0 && Number.isFinite(r.days) ? r.days : DEFAULT_DAYS
  const fallback = days * DEFAULT_HOURS_PER_DAY
  if (ph == null || !Number.isFinite(ph) || ph <= 0) return fallback
  if (ph <= 300) return ph
  if (act != null && act > 0) return ph / act
  return fallback
}

export function effectiveBillingRate(r: StaffingPlanRow): number | null {
  const br = r.billingRate
  if (br != null && Number.isFinite(br) && br > 0) return br
  const rt = r.rate
  if (rt != null && Number.isFinite(rt) && rt > 0) return rt
  return null
}

export function throughputPerHead(r: StaffingPlanRow): number {
  const ah = r.actualHandledVolume
  const act = r.activeProdHc
  if (ah != null && act != null && act > 0 && Number.isFinite(ah) && Number.isFinite(act)) return ah / act
  return 1
}

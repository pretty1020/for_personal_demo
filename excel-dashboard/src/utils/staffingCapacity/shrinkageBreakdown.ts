/**
 * Reference taxonomy for call-center shrinkage (in-office vs out-of-office).
 * Used for matrix drill-down labels; sub-line values are allocated from parent bucket
 * using weights when granular upload columns are not present.
 *
 * Out-of-office shrink is treated as non-billable for revenue. In-office shrink is
 * split between billable vs non-billable using per-line weights for display; leakage
 * math uses a single aggregate share of in-office shrink assumed non-billable (see leakage.ts).
 */

export const DEFAULT_IN_OFFICE_SHARE_OF_TOTAL_SHRINK = 0.62

/** Portion of *in-office* shrink attributed to non-billable AUX (rest can be billable client time). */
export const IN_OFFICE_NONBILLABLE_SHARE = 0.58

export type ShrinkDetailLine = {
  key: string
  label: string
  billable: boolean
  /** Relative share within the in-office or out-of-office bucket (sums to 1). */
  weight: number
}

/** Typical in-office / on-premise AUX and near-production time (Giva / industry summaries). */
export const SHRINK_IN_OFFICE_DETAIL: ShrinkDetailLine[] = [
  { key: 'break_nb', label: 'Break — not billable', billable: false, weight: 0.26 },
  { key: 'meal_nb', label: 'Meal / lunch — not billable', billable: false, weight: 0.14 },
  { key: 'meet_nb', label: 'Team meetings & huddles — not billable', billable: false, weight: 0.16 },
  { key: 'train_nb', label: 'Training & upskill (classroom / systems) — not billable', billable: false, weight: 0.12 },
  { key: 'coach_nb', label: 'Coaching & quality review — not billable', billable: false, weight: 0.12 },
  { key: 'coach_b', label: 'Coaching on live / billable work — billable', billable: true, weight: 0.08 },
  { key: 'acw_nb', label: 'After-call work / wrap — not billable', billable: false, weight: 0.07 },
  { key: 'sys_nb', label: 'System idle / IT downtime — not billable', billable: false, weight: 0.05 },
]

/** Typical out-of-office / off-phone shrink (PTO, absence, off-site). */
export const SHRINK_OUT_OFFICE_DETAIL: ShrinkDetailLine[] = [
  { key: 'pto_nb', label: 'Approved PTO / vacation — not billable', billable: false, weight: 0.42 },
  { key: 'sick_nb', label: 'Sick & unplanned absence — not billable', billable: false, weight: 0.24 },
  { key: 'late_nb', label: 'Late start / early leave — not billable', billable: false, weight: 0.14 },
  { key: 'offsite_nb', label: 'Off-site meetings & travel — not billable', billable: false, weight: 0.12 },
  { key: 'wfm_nb', label: 'WFH non-productive / connectivity — not billable', billable: false, weight: 0.08 },
]

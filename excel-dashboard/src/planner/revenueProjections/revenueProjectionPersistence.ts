import { billsStaffedHours, isFteBillingPlan } from '../../utils/staffingCapacity/billingModel'
import { CHANNEL_TYPES, type ChannelType } from '../types'
import { evaluateFormulaExact, evaluateFormulaOrFallback, isCustomFormula, roundFormula, type FormulaScope } from '../formulas/formulaRegistry'
import { networkDaysInMonth } from './networkDays'

const STORAGE_KEY = 'wfp-revenue-projection-lines-v2'
const LEGACY_STORAGE_KEY = 'wfp-revenue-projection-lines-v1'

/** Which bill rate(s) drive Total Revenue. Multiple methods may be enabled on one line. */
export type RevProjBillRateMethod = 'hourly' | 'monthly' | 'per_minute' | 'per_transaction'

export const REV_PROJ_BILL_RATE_METHODS: readonly {
  value: RevProjBillRateMethod
  label: string
  hint: string
}[] = [
  {
    value: 'hourly',
    label: 'Hourly bill rate',
    hint: 'Production Hours / FTE: Production FTE × hourly rate × Productive Hours. Transactional: Capacity × (AHT ÷ 3600) × hourly rate. If Production Hours has no FTE entered, Capacity hours are used so the month is not zero.',
  },
  {
    value: 'monthly',
    label: 'Per month bill rate',
    hint: 'Capacity path: required FTE × monthly rate. FTE billing: entered FTE × monthly rate.',
  },
  {
    value: 'per_minute',
    label: 'Per minute bill rate',
    hint: 'Capacity path: Capacity × (AHT ÷ 60) × per-minute rate. FTE billing: FTE × Productive Hours × 60 × per-minute rate.',
  },
  {
    value: 'per_transaction',
    label: 'Per chat, per sale or per transaction',
    hint: 'Capacity / transactions × unit rate. AHT and hours are not used. Missing units produce 0 — no substitute method.',
  },
] as const

const BILL_RATE_METHOD_VALUES: readonly RevProjBillRateMethod[] = REV_PROJ_BILL_RATE_METHODS.map(
  (item) => item.value,
)

export function isRevProjBillRateMethod(value: unknown): value is RevProjBillRateMethod {
  return BILL_RATE_METHOD_VALUES.includes(value as RevProjBillRateMethod)
}

/** Editable month inputs (Capacity & drivers). Blank = use LOB defaults. */
export type RevenueProjectionMonthInput = {
  capacity: number | null
  /** True when the user typed Capacity / Transactions for this month. */
  capacityManual: boolean
  /** Manual FTE for FTE billing type. */
  fte: number | null
  /** True when the user typed FTE for this month (keeps that value instead of the Capacity Plan average). */
  fteManual: boolean
  aht: number | null
  loginHours: number | null
  absenteeismPct: number | null
  shrinkagePct: number | null
  occupancyPct: number | null
  hourlyBillRate: number | null
  monthlyBillRate: number | null
  perMinuteBillRate: number | null
  perTransactionBillRate: number | null
  /** Manual discount / less-to-revenue amount deducted from Total Revenue. Default 0. */
  discountOrLessToRevenue: number | null
  /** Extra hours added into Total Revenue (× active rate). Default 0. */
  extraHours: number | null
  /** Optional signed % applied after billed methods + extra hours. +10 = +10%. Legacy; prefer factorValues. */
  revenueFactorPct: number | null
  /** Optional signed dollar adjustment after the % factor. Legacy; prefer factorValues. */
  revenueAdjustmentUsd: number | null
  /** Per-factor month overrides keyed by named factor id. */
  factorValues: Record<string, number | null>
}

/** LOB-level defaults applied when a month cell is empty. */
export type RevenueProjectionLobDefaults = {
  aht: number
  loginHours: number
  absenteeismPct: number
  shrinkagePct: number
  occupancyPct: number
  hourlyBillRate: number
  monthlyBillRate: number
  perMinuteBillRate: number
  perTransactionBillRate: number
  /** Production labor $ / hour (used when monthly labor is 0). */
  hourlySalaryUsd: number
  /** Optional production labor $ / FTE / month. When > 0, overrides hourly salary for GM. */
  monthlyLaborPerFteUsd: number
  /** Support / overhead $ per week. */
  supportSalaryUsd: number
  /** Training pipeline $ per HC per week. */
  trainingSalaryRateUsd: number
  /** Other operating cost $ per week. */
  otherCostUsd: number
  /** Optional signed % applied to billed revenue. 0 = no change. */
  revenueFactorPct: number
  /** Optional signed $ added after the % factor. 0 = no change. Synced from named amount factors. */
  revenueAdjustmentUsd: number
}

export const MAX_REVENUE_FACTORS = 12
export const MAX_COST_LINES = 12
export const MAX_COST_CATEGORY_LENGTH = 40
export const LEGACY_PERCENT_FACTOR_ID = 'legacy-percent'
export const LEGACY_AMOUNT_FACTOR_ID = 'legacy-amount'

/** Suggested cost categories — users can type any custom label. */
export const COST_CATEGORY_SUGGESTIONS = [
  'Salary',
  'OPEX',
  'Benefits',
  'Facilities',
  'Software',
  'Training overhead',
  'Contractor',
  'Other',
] as const

export type RevenueProjectionFactorKind = 'percent' | 'amount'
/** Free-text cost category label (e.g. Salary, OPEX, Benefits). */
export type RevenueProjectionCostCategory = string

/** User-named ± factor saved on the Client · LOB. */
export type RevenueProjectionNamedFactor = {
  id: string
  name: string
  kind: RevenueProjectionFactorKind
  defaultValue: number
}

/** Extra weekly cost line saved on the Client · LOB (custom category). */
export type RevenueProjectionCostLine = {
  id: string
  name: string
  category: RevenueProjectionCostCategory
  amountUsdPerWeek: number
}

export type RevenueProjectionLobLine = {
  id: string
  clientName: string
  lobProjectName: string
  location: string
  projectCode: string
  billingType: string
  /** Primary channel for this LOB. Blank until set or inferred from a matching Staffing Plan. */
  channel: ChannelType | ''
  agentGroup: string
  billRateMethod: RevProjBillRateMethod
  /** Methods included in Total Revenue. Always contains `billRateMethod`. Additional methods add their own formulas. */
  billRateMethods: RevProjBillRateMethod[]
  defaults: RevenueProjectionLobDefaults
  /** Optional named ± factors. Applied after billed methods and extra hours. */
  revenueFactors: RevenueProjectionNamedFactor[]
  /** Optional Salary / OPEX cost lines (weekly $). Included in total cost and GM. */
  costLines: RevenueProjectionCostLine[]
  /** When true, Absenteeism / Shrinkage, FTE, and Capacity / Transactions come from the matching Capacity Plan unless the month is a typed override. */
  useStaffingAbsenteeismShrinkage: boolean
  /** Per-month inputs keyed by YYYY-MM. */
  months: Record<string, RevenueProjectionMonthInput>
  createdAt: string
  updatedAt: string
}

export type RevenueProjectionMonthComputed = {
  month: string
  networkDays: number
  capacity: number
  fte: number
  aht: number
  loginHours: number
  absenteeismPct: number
  shrinkagePct: number
  occupancyPct: number
  hourlyBillRate: number
  monthlyBillRate: number
  perMinuteBillRate: number
  perTransactionBillRate: number
  discountOrLessToRevenue: number
  extraHours: number
  revenueFactorPct: number
  revenueAdjustmentUsd: number
  billRateMethod: RevProjBillRateMethod
  billRateMethods: RevProjBillRateMethod[]
  fteBilling: boolean
  /** NetworkDays × LoginHours × (1 − Absenteeism − Shrinkage) */
  productiveHours: number
  /** Productive Hours × Occupancy */
  productiveHoursPostOcc: number
  /** Required FTE from capacity / productive hours post occ (handle hours). */
  requiredFte: number
  totalRevenue: number
  totalCost: number
  grossMargin: number
  gmPct: number | null
}

export type RevenueProjectionComputeOptions = {
  /** Force Absenteeism % (0–100). */
  absenteeismPct?: number
  /** Force Shrinkage % (0–100). */
  shrinkagePct?: number
  /** Fallback Capacity / Transactions when the month cell is blank. */
  capacity?: number
  /** Fallback FTE when the month cell is blank (average of included Capacity weeks). */
  fte?: number
}

export const DEFAULT_REV_PROJ_DEFAULTS: RevenueProjectionLobDefaults = {
  aht: 300,
  loginHours: 8,
  absenteeismPct: 8,
  shrinkagePct: 15,
  occupancyPct: 80,
  hourlyBillRate: 22,
  monthlyBillRate: 0,
  perMinuteBillRate: 0,
  perTransactionBillRate: 0,
  hourlySalaryUsd: 12,
  monthlyLaborPerFteUsd: 0,
  supportSalaryUsd: 0,
  trainingSalaryRateUsd: 0,
  otherCostUsd: 0,
  revenueFactorPct: 0,
  revenueAdjustmentUsd: 0,
}

function optionalNonNeg(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return null
  return num
}

function optionalFinite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return num
}

function clampPct(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(100, value)
}

export function createRevenueProjectionFactor(
  partial?: Partial<RevenueProjectionNamedFactor>,
): RevenueProjectionNamedFactor {
  const id = (partial?.id ?? '').trim()
  return {
    id: id || `revfactor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: (partial?.name ?? '').trim().slice(0, 80),
    kind: partial?.kind === 'amount' ? 'amount' : 'percent',
    defaultValue: Number.isFinite(partial?.defaultValue) ? Number(partial?.defaultValue) : 0,
  }
}

export function createRevenueProjectionCostLine(
  partial?: Partial<RevenueProjectionCostLine>,
): RevenueProjectionCostLine {
  const id = (partial?.id ?? '').trim()
  const amount = Number(partial?.amountUsdPerWeek)
  return {
    id: id || `costline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: (partial?.name ?? '').trim().slice(0, 80),
    category: normalizeCostCategory(partial?.category),
    amountUsdPerWeek: Number.isFinite(amount) && amount > 0 ? amount : 0,
  }
}

/** Normalize a free-text category; migrate legacy salary/opex keys to display labels. */
export function normalizeCostCategory(raw: unknown): string {
  const trimmed = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, MAX_COST_CATEGORY_LENGTH)
  if (!trimmed) return 'Other'
  const lower = trimmed.toLowerCase()
  if (lower === 'salary') return 'Salary'
  if (lower === 'opex' || lower === 'op-ex' || lower === 'operating expense') return 'OPEX'
  // Prefer canonical suggestion casing when it matches ignoring case.
  const suggestion = COST_CATEGORY_SUGGESTIONS.find((item) => item.toLowerCase() === lower)
  return suggestion ?? trimmed
}

export function isSalaryLikeCostCategory(category: string): boolean {
  const lower = normalizeCostCategory(category).toLowerCase()
  return (
    lower === 'salary' ||
    lower === 'benefits' ||
    lower === 'contractor' ||
    lower.includes('salary') ||
    lower.includes('payroll') ||
    lower.includes('wage')
  )
}

export function factorSheetLabel(factor: RevenueProjectionNamedFactor): string {
  const name = factor.name.trim() || (factor.kind === 'percent' ? 'Revenue factor' : 'Revenue adjustment')
  return factor.kind === 'percent' ? `${name} (± %)` : `${name} (± $)`
}

export function sumNamedFactors(
  factors: readonly RevenueProjectionNamedFactor[],
  monthValues?: Record<string, number | null>,
): { revenueFactorPct: number; revenueAdjustmentUsd: number } {
  let revenueFactorPct = 0
  let revenueAdjustmentUsd = 0
  for (const factor of factors) {
    const raw = monthValues?.[factor.id]
    const value = raw !== null && raw !== undefined && Number.isFinite(raw) ? raw : factor.defaultValue
    if (factor.kind === 'percent') revenueFactorPct += value
    else revenueAdjustmentUsd += value
  }
  return { revenueFactorPct, revenueAdjustmentUsd }
}

export function normalizeRevenueFactors(
  raw: unknown,
  fallbackPct = 0,
  fallbackAdj = 0,
): RevenueProjectionNamedFactor[] {
  if (Array.isArray(raw)) {
    const seen = new Set<string>()
    const next: RevenueProjectionNamedFactor[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const factor = createRevenueProjectionFactor(item as Partial<RevenueProjectionNamedFactor>)
      if (!factor.id || seen.has(factor.id)) continue
      if (!factor.name && factor.defaultValue === 0) continue
      if (!factor.name) {
        factor.name = factor.kind === 'percent' ? 'Revenue factor' : 'Revenue adjustment'
      }
      seen.add(factor.id)
      next.push(factor)
      if (next.length >= MAX_REVENUE_FACTORS) break
    }
    if (next.length) return next
  }
  const factors: RevenueProjectionNamedFactor[] = []
  if (fallbackPct !== 0) {
    factors.push({
      id: LEGACY_PERCENT_FACTOR_ID,
      name: 'Revenue factor',
      kind: 'percent',
      defaultValue: fallbackPct,
    })
  }
  if (fallbackAdj !== 0) {
    factors.push({
      id: LEGACY_AMOUNT_FACTOR_ID,
      name: 'Revenue adjustment',
      kind: 'amount',
      defaultValue: fallbackAdj,
    })
  }
  return factors
}

export function normalizeCostLines(raw: unknown): RevenueProjectionCostLine[] {
  if (!Array.isArray(raw)) return []
  const lines: RevenueProjectionCostLine[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Partial<RevenueProjectionCostLine>
    const id = String(row.id ?? '').trim() || `cost-${lines.length + 1}`
    const name = String(row.name ?? '').trim() || `Cost line ${lines.length + 1}`
    const category = normalizeCostCategory(row.category)
    const amount = optionalNonNeg(row.amountUsdPerWeek) ?? 0
    lines.push({ id, name, category, amountUsdPerWeek: amount })
    if (lines.length >= MAX_COST_LINES) break
  }
  return lines
}

export function sumCostLinesWeekly(costLines: RevenueProjectionCostLine[] | undefined): {
  /** @deprecated Prefer byCategory — kept for Salary-like vs other rollups. */
  salaryUsd: number
  /** @deprecated Prefer byCategory — non–Salary-like lines. */
  opexUsd: number
  totalUsd: number
  byCategory: Array<{ category: string; amountUsd: number }>
} {
  let salaryUsd = 0
  let opexUsd = 0
  const bucket = new Map<string, number>()
  for (const line of costLines ?? []) {
    const amount = Math.max(0, line.amountUsdPerWeek || 0)
    if (amount <= 0) continue
    const category = normalizeCostCategory(line.category)
    bucket.set(category, (bucket.get(category) ?? 0) + amount)
    if (isSalaryLikeCostCategory(category)) salaryUsd += amount
    else opexUsd += amount
  }
  const byCategory = [...bucket.entries()]
    .map(([category, amountUsd]) => ({ category, amountUsd }))
    .sort((a, b) => b.amountUsd - a.amountUsd || a.category.localeCompare(b.category))
  return { salaryUsd, opexUsd, totalUsd: salaryUsd + opexUsd, byCategory }
}

function normalizeFactorValues(raw: unknown): Record<string, number | null> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const next: Record<string, number | null> = {}
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = id.trim()
    if (!key) continue
    const num = optionalFinite(value)
    if (num === null) continue
    next[key] = num
  }
  return next
}

function normalizeChannel(raw: unknown): ChannelType | '' {
  return CHANNEL_TYPES.includes(raw as ChannelType) ? (raw as ChannelType) : ''
}

function normalizeBillRateMethod(raw: unknown): RevProjBillRateMethod {
  return isRevProjBillRateMethod(raw) ? raw : 'hourly'
}

export function normalizeBillRateMethods(
  raw: unknown,
  primary: RevProjBillRateMethod,
): RevProjBillRateMethod[] {
  const listed = Array.isArray(raw) ? raw.filter(isRevProjBillRateMethod) : []
  const methods = listed.length ? listed : [primary]
  if (!methods.includes(primary)) methods.unshift(primary)
  return [...new Set(methods)]
}

export function enabledBillRateMethods(
  line: Pick<RevenueProjectionLobLine, 'billRateMethod' | 'billRateMethods'>,
): RevProjBillRateMethod[] {
  return normalizeBillRateMethods(line.billRateMethods, line.billRateMethod)
}

export type RevProjBillRates = {
  hourlyBillRate: number
  monthlyBillRate: number
  perMinuteBillRate: number
  perTransactionBillRate: number
}

/** When the primary method changes, unused rates default to 0 so they cannot silently contribute. */
export function zeroInactiveBillRates(primary: RevProjBillRateMethod, rates: RevProjBillRates): RevProjBillRates {
  return {
    hourlyBillRate: primary === 'hourly' ? rates.hourlyBillRate : 0,
    monthlyBillRate: primary === 'monthly' ? rates.monthlyBillRate : 0,
    perMinuteBillRate: primary === 'per_minute' ? rates.perMinuteBillRate : 0,
    perTransactionBillRate: primary === 'per_transaction' ? rates.perTransactionBillRate : 0,
  }
}

function normalizeMonthInput(raw: Partial<RevenueProjectionMonthInput> | undefined): RevenueProjectionMonthInput {
  const positiveOrNull = (value: unknown): number | null => {
    const num = optionalNonNeg(value)
    return num === null || num === 0 ? null : num
  }
  return {
    capacity: optionalNonNeg(raw?.capacity),
    capacityManual: Boolean(raw?.capacityManual),
    fte: optionalNonNeg(raw?.fte),
    fteManual: Boolean(raw?.fteManual),
    aht: optionalNonNeg(raw?.aht),
    loginHours: positiveOrNull(raw?.loginHours),
    absenteeismPct: optionalNonNeg(raw?.absenteeismPct),
    shrinkagePct: optionalNonNeg(raw?.shrinkagePct),
    occupancyPct: optionalNonNeg(raw?.occupancyPct),
    hourlyBillRate: optionalNonNeg(raw?.hourlyBillRate),
    monthlyBillRate: optionalNonNeg(raw?.monthlyBillRate),
    perMinuteBillRate: optionalNonNeg(raw?.perMinuteBillRate),
    perTransactionBillRate: optionalNonNeg(raw?.perTransactionBillRate),
    discountOrLessToRevenue: optionalNonNeg(raw?.discountOrLessToRevenue),
    extraHours: optionalNonNeg(raw?.extraHours),
    revenueFactorPct: optionalFinite(raw?.revenueFactorPct),
    revenueAdjustmentUsd: optionalFinite(raw?.revenueAdjustmentUsd),
    factorValues: (() => {
      const factorValues = normalizeFactorValues(raw?.factorValues)
      const pct = optionalFinite(raw?.revenueFactorPct)
      const adj = optionalFinite(raw?.revenueAdjustmentUsd)
      if (pct != null && factorValues[LEGACY_PERCENT_FACTOR_ID] == null) {
        factorValues[LEGACY_PERCENT_FACTOR_ID] = pct
      }
      if (adj != null && factorValues[LEGACY_AMOUNT_FACTOR_ID] == null) {
        factorValues[LEGACY_AMOUNT_FACTOR_ID] = adj
      }
      return factorValues
    })(),
  }
}

function normalizeDefaults(raw: Partial<RevenueProjectionLobDefaults> | undefined): RevenueProjectionLobDefaults {
  const d = DEFAULT_REV_PROJ_DEFAULTS
  const positiveOrDefault = (value: unknown, fallback: number): number => {
    const num = optionalNonNeg(value)
    return num === null || num === 0 ? fallback : num
  }
  return {
    aht: optionalNonNeg(raw?.aht) ?? d.aht,
    loginHours: positiveOrDefault(raw?.loginHours, d.loginHours),
    absenteeismPct: clampPct(optionalNonNeg(raw?.absenteeismPct) ?? d.absenteeismPct),
    shrinkagePct: clampPct(optionalNonNeg(raw?.shrinkagePct) ?? d.shrinkagePct),
    occupancyPct: clampPct(optionalNonNeg(raw?.occupancyPct) ?? d.occupancyPct),
    hourlyBillRate: optionalNonNeg(raw?.hourlyBillRate) ?? d.hourlyBillRate,
    monthlyBillRate: optionalNonNeg(raw?.monthlyBillRate) ?? d.monthlyBillRate,
    perMinuteBillRate: optionalNonNeg(raw?.perMinuteBillRate) ?? d.perMinuteBillRate,
    perTransactionBillRate: optionalNonNeg(raw?.perTransactionBillRate) ?? d.perTransactionBillRate,
    hourlySalaryUsd: optionalNonNeg(raw?.hourlySalaryUsd) ?? d.hourlySalaryUsd,
    monthlyLaborPerFteUsd: optionalNonNeg(raw?.monthlyLaborPerFteUsd) ?? d.monthlyLaborPerFteUsd,
    supportSalaryUsd: optionalNonNeg(raw?.supportSalaryUsd) ?? d.supportSalaryUsd,
    trainingSalaryRateUsd: optionalNonNeg(raw?.trainingSalaryRateUsd) ?? d.trainingSalaryRateUsd,
    otherCostUsd: optionalNonNeg(raw?.otherCostUsd) ?? d.otherCostUsd,
    revenueFactorPct: optionalFinite(raw?.revenueFactorPct) ?? d.revenueFactorPct,
    revenueAdjustmentUsd: optionalFinite(raw?.revenueAdjustmentUsd) ?? d.revenueAdjustmentUsd,
  }
}

export function emptyMonthInput(): RevenueProjectionMonthInput {
  return {
    capacity: null,
    capacityManual: false,
    fte: null,
    fteManual: false,
    aht: null,
    loginHours: null,
    absenteeismPct: null,
    shrinkagePct: null,
    occupancyPct: null,
    hourlyBillRate: null,
    monthlyBillRate: null,
    perMinuteBillRate: null,
    perTransactionBillRate: null,
    discountOrLessToRevenue: null,
    extraHours: null,
    revenueFactorPct: null,
    revenueAdjustmentUsd: null,
    factorValues: {},
  }
}

export function normalizeLine(
  raw: Partial<RevenueProjectionLobLine> & { id: string },
): RevenueProjectionLobLine {
  const months: Record<string, RevenueProjectionMonthInput> = {}
  if (raw.months && typeof raw.months === 'object') {
    for (const [key, value] of Object.entries(raw.months)) {
      months[key] = normalizeMonthInput(value)
    }
  }

  const revenueFactors = normalizeRevenueFactors(
    (raw as { revenueFactors?: unknown }).revenueFactors,
    optionalFinite(raw.defaults?.revenueFactorPct) ?? 0,
    optionalFinite(raw.defaults?.revenueAdjustmentUsd) ?? 0,
  )
  const costLines = normalizeCostLines((raw as { costLines?: unknown }).costLines)
  const factorSums = sumNamedFactors(revenueFactors)

  return {
    id: raw.id,
    clientName: (raw.clientName ?? '').trim(),
    lobProjectName: (raw.lobProjectName ?? '').trim(),
    location: (raw.location ?? '').trim(),
    projectCode: (raw.projectCode ?? '').trim(),
    billingType: raw.billingType || 'Production Hours',
    channel: normalizeChannel(raw.channel),
    agentGroup: (raw.agentGroup ?? '').trim(),
    billRateMethod: normalizeBillRateMethod(raw.billRateMethod),
    billRateMethods: normalizeBillRateMethods(
      (raw as { billRateMethods?: unknown }).billRateMethods,
      normalizeBillRateMethod(raw.billRateMethod),
    ),
    defaults: {
      ...normalizeDefaults(raw.defaults),
      revenueFactorPct: factorSums.revenueFactorPct,
      revenueAdjustmentUsd: factorSums.revenueAdjustmentUsd,
    },
    revenueFactors,
    costLines,
    useStaffingAbsenteeismShrinkage: Boolean(raw.useStaffingAbsenteeismShrinkage),
    months,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
  }
}

function readStorage(key: string): unknown[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function loadRevenueProjectionLines(): RevenueProjectionLobLine[] {
  const current = readStorage(STORAGE_KEY)
  const legacy = current.length ? [] : readStorage(LEGACY_STORAGE_KEY)
  const raw = current.length ? current : legacy
  if (!raw.length) return []
  const lines = raw.map((item) => normalizeLine(item as RevenueProjectionLobLine))
  if (!current.length && legacy.length) saveRevenueProjectionLines(lines)
  return lines
}

export function saveRevenueProjectionLines(lines: RevenueProjectionLobLine[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lines.map((line) => normalizeLine(line))))
  try {
    window.dispatchEvent(new Event('revenue-projection-changed'))
  } catch {
    /* ignore */
  }
}

export function createRevenueProjectionLine(
  input: Omit<
    RevenueProjectionLobLine,
    'id' | 'createdAt' | 'updatedAt' | 'billRateMethods' | 'revenueFactors' | 'costLines'
  > & {
    billRateMethods?: RevProjBillRateMethod[]
    revenueFactors?: RevenueProjectionNamedFactor[]
    costLines?: RevenueProjectionCostLine[]
  },
): RevenueProjectionLobLine {
  const now = new Date().toISOString()
  return normalizeLine({
    ...input,
    id: `revproj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  })
}

export function upsertRevenueProjectionLine(
  lines: RevenueProjectionLobLine[],
  next: RevenueProjectionLobLine,
): RevenueProjectionLobLine[] {
  const normalized = normalizeLine({ ...next, updatedAt: new Date().toISOString() })
  const index = lines.findIndex((line) => line.id === normalized.id)
  if (index < 0) return [...lines, normalized]
  const copy = [...lines]
  copy[index] = normalized
  return copy
}

export function deleteRevenueProjectionLine(
  lines: RevenueProjectionLobLine[],
  id: string,
): RevenueProjectionLobLine[] {
  return lines.filter((line) => line.id !== id)
}

function pickMonthValue(monthValue: number | null, fallback: number): number {
  return monthValue !== null && Number.isFinite(monthValue) ? monthValue : fallback
}

/** Capacity Plan FTE / volume wins unless the user typed an override for that month. */
function pickLinkedVolume(
  monthValue: number | null,
  manual: boolean,
  planValue: number | undefined,
): number {
  const plan = planValue != null && Number.isFinite(planValue) ? planValue : undefined
  if (plan != null && !manual) return plan
  return pickMonthValue(monthValue, plan ?? 0)
}

/** Fiscal / calendar year January–December. `year` is the calendar year. */
export function listFiscalMonthKeys(year: number): string[] {
  const safeYear = Number.isFinite(year) && year >= 2000 && year <= 2100 ? Math.round(year) : new Date().getFullYear()
  const keys: string[] = []
  for (let month = 1; month <= 12; month += 1) {
    keys.push(`${safeYear}-${String(month).padStart(2, '0')}`)
  }
  return keys
}

export function formatFiscalMonthLabel(monthKey: string): string {
  const date = new Date(`${monthKey.slice(0, 7)}-01T12:00:00`)
  if (Number.isNaN(date.getTime())) return monthKey
  return date.toLocaleDateString(undefined, { month: 'short' })
}

export function billRateMethodLabel(method: RevProjBillRateMethod): string {
  return REV_PROJ_BILL_RATE_METHODS.find((item) => item.value === method)?.label ?? method
}

export function billRateMethodsLabel(methods: readonly RevProjBillRateMethod[]): string {
  return methods.map(billRateMethodLabel).join(' + ')
}

function lineFormulaScope(line: RevenueProjectionLobLine): FormulaScope {
  return { clientName: line.clientName, lobName: line.lobProjectName }
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.round(value)
}

function revenueForBillMethod(args: {
  method: RevProjBillRateMethod
  billingType: string
  fteBilling: boolean
  capacity: number
  fte: number
  aht: number
  loginHours: number
  networkDays: number
  shrinkagePct: number
  productiveHours: number
  requiredFte: number
  hourlyBillRate: number
  monthlyBillRate: number
  perMinuteBillRate: number
  perTransactionBillRate: number
  scope: FormulaScope
}): number {
  const {
    method,
    billingType,
    fteBilling,
    capacity,
    fte,
    aht,
    loginHours,
    networkDays,
    shrinkagePct,
    productiveHours,
    requiredFte,
    hourlyBillRate,
    monthlyBillRate,
    perMinuteBillRate,
    perTransactionBillRate,
    scope,
  } = args

  if (method === 'hourly') {
    if (hourlyBillRate <= 0) return 0
    const useStaffedHours = fteBilling || (billsStaffedHours(billingType) && fte > 0)
    if (useStaffedHours) {
      if (fte <= 0 || productiveHours <= 0) return 0
      return roundMoney(
        evaluateFormulaExact(
          'revproj.hourlyFteRevenue',
          { fte, hourlyBillRate, productiveHours, networkDays, loginHours },
          scope,
        ),
      )
    }
    if (capacity <= 0 || aht <= 0) return 0
    return roundMoney(
      evaluateFormulaExact(
        'revproj.hourlyCapacityRevenue',
        { capacity, aht, hourlyBillRate, loginHours, shrinkagePct },
        scope,
      ),
    )
  }

  if (method === 'monthly') {
    if (monthlyBillRate <= 0) return 0
    const billedFte = fteBilling || (billsStaffedHours(billingType) && fte > 0) ? fte : requiredFte
    if (billedFte <= 0) return 0
    return roundMoney(
      evaluateFormulaExact(
        'revproj.monthlyRevenue',
        { fte: billedFte, requiredFte, monthlyBillRate },
        scope,
      ),
    )
  }

  if (method === 'per_minute') {
    if (perMinuteBillRate <= 0) return 0
    if (fteBilling || (billsStaffedHours(billingType) && fte > 0)) {
      if (fte <= 0 || productiveHours <= 0) return 0
      return roundMoney(
        evaluateFormulaExact(
          'revproj.perMinuteFteRevenue',
          { fte, productiveHours, perMinuteBillRate },
          scope,
        ),
      )
    }
    if (capacity <= 0 || aht <= 0) return 0
    return roundMoney(
      evaluateFormulaExact(
        'revproj.perMinuteCapacityRevenue',
        { capacity, aht, perMinuteBillRate },
        scope,
      ),
    )
  }

  if (perTransactionBillRate <= 0 || capacity <= 0) return 0
  return roundMoney(
    evaluateFormulaExact(
      fteBilling ? 'revproj.perTransactionFteRevenue' : 'revproj.perTransactionCapacityRevenue',
      { capacity, fte, perTransactionBillRate },
      scope,
    ),
  )
}

export function computeRevenueProjectionMonth(
  line: RevenueProjectionLobLine,
  month: string,
  options?: RevenueProjectionComputeOptions,
): RevenueProjectionMonthComputed {
  const input = line.months[month] ?? emptyMonthInput()
  const d = line.defaults
  const scope = lineFormulaScope(line)
  const networkDays = networkDaysInMonth(month)
  const capacity = pickLinkedVolume(input.capacity, input.capacityManual, options?.capacity)
  const fte = pickLinkedVolume(input.fte, input.fteManual, options?.fte)
  const aht = pickMonthValue(input.aht, d.aht)
  const loginHoursRaw = pickMonthValue(input.loginHours, d.loginHours)
  const loginHours = loginHoursRaw > 0 ? loginHoursRaw : DEFAULT_REV_PROJ_DEFAULTS.loginHours
  const absenteeismPct = clampPct(
    options?.absenteeismPct != null && Number.isFinite(options.absenteeismPct)
      ? options.absenteeismPct
      : pickMonthValue(input.absenteeismPct, d.absenteeismPct),
  )
  const shrinkagePct = clampPct(
    options?.shrinkagePct != null && Number.isFinite(options.shrinkagePct)
      ? options.shrinkagePct
      : pickMonthValue(input.shrinkagePct, d.shrinkagePct),
  )
  const occupancyPct = clampPct(pickMonthValue(input.occupancyPct, d.occupancyPct))
  const hourlyBillRate = pickMonthValue(input.hourlyBillRate, d.hourlyBillRate)
  const monthlyBillRate = pickMonthValue(input.monthlyBillRate, d.monthlyBillRate)
  const perMinuteBillRate = pickMonthValue(input.perMinuteBillRate, d.perMinuteBillRate)
  const perTransactionBillRate = pickMonthValue(input.perTransactionBillRate, d.perTransactionBillRate)
  const discountOrLessToRevenue = pickMonthValue(input.discountOrLessToRevenue, 0)
  const extraHours = pickMonthValue(input.extraHours, 0)
  const namedFactors = sumNamedFactors(line.revenueFactors ?? [], input.factorValues)
  const hasNamedFactors = (line.revenueFactors ?? []).length > 0
  const revenueFactorPct = hasNamedFactors
    ? namedFactors.revenueFactorPct
    : pickMonthValue(input.revenueFactorPct, d.revenueFactorPct)
  const revenueAdjustmentUsd = hasNamedFactors
    ? namedFactors.revenueAdjustmentUsd
    : pickMonthValue(input.revenueAdjustmentUsd, d.revenueAdjustmentUsd)
  const billRateMethod = line.billRateMethod
  const billRateMethods = enabledBillRateMethods(line)
  const fteBilling = isFteBillingPlan(line.billingType)

  const availability = Math.max(0, 1 - absenteeismPct / 100 - shrinkagePct / 100)
  const productiveHoursFallback = Math.round(networkDays * loginHours * availability * 100) / 100
  const productiveHours = Math.max(
    0,
    roundFormula(
      evaluateFormulaOrFallback(
        'revproj.productiveHours',
        { networkDays, loginHours, absenteeismPct, shrinkagePct },
        productiveHoursFallback,
        scope,
      ),
    ),
  )
  const productiveHoursPostOccFallback = Math.round(productiveHours * (occupancyPct / 100) * 100) / 100
  const productiveHoursPostOcc = Math.max(
    0,
    roundFormula(
      evaluateFormulaOrFallback(
        'revproj.productiveHoursPostOcc',
        { productiveHours, occupancyPct },
        productiveHoursPostOccFallback,
        scope,
      ),
    ),
  )

  const handleHours = capacity > 0 && aht > 0 ? (capacity * aht) / 3600 : 0
  const requiredFteFallback =
    productiveHoursPostOcc > 0 && handleHours > 0
      ? Math.round((handleHours / productiveHoursPostOcc) * 1000) / 1000
      : 0
  const requiredFte =
    productiveHoursPostOcc > 0
      ? Math.max(
          0,
          roundFormula(
            evaluateFormulaOrFallback(
              'revproj.requiredFte',
              { capacity, aht, productiveHoursPostOcc },
              requiredFteFallback,
              scope,
            ),
            3,
          ),
        )
      : 0

  const methodArgs = {
    billingType: line.billingType,
    fteBilling,
    capacity,
    fte,
    aht,
    loginHours,
    networkDays,
    shrinkagePct,
    productiveHours,
    requiredFte,
    hourlyBillRate,
    monthlyBillRate,
    perMinuteBillRate,
    perTransactionBillRate,
    scope,
  }
  let totalRevenue = 0
  for (const method of billRateMethods) {
    totalRevenue += revenueForBillMethod({ ...methodArgs, method })
  }

  if (extraHours > 0) {
    let extra = 0
    if (billRateMethod === 'hourly' && hourlyBillRate > 0) {
      extra = roundMoney(extraHours * hourlyBillRate)
    } else if (billRateMethod === 'per_minute' && perMinuteBillRate > 0) {
      extra = roundMoney(extraHours * 60 * perMinuteBillRate)
    } else if (billRateMethod === 'monthly' && monthlyBillRate > 0) {
      const monthHours = networkDays * loginHours
      extra = monthHours > 0 ? roundMoney((extraHours / monthHours) * monthlyBillRate) : 0
    }
    if (isCustomFormula('revproj.extraHoursRevenue', scope)) {
      extra = roundMoney(
        evaluateFormulaExact(
          'revproj.extraHoursRevenue',
          {
            extraHours,
            hourlyBillRate,
            perMinuteBillRate,
            monthlyBillRate,
            networkDays,
            loginHours,
          },
          scope,
        ),
      )
    } else if (billRateMethod === 'hourly' && hourlyBillRate > 0) {
      extra = roundMoney(
        evaluateFormulaExact(
          'revproj.extraHoursRevenue',
          {
            extraHours,
            hourlyBillRate,
            perMinuteBillRate,
            monthlyBillRate,
            networkDays,
            loginHours,
          },
          scope,
        ),
      )
    }
    totalRevenue += extra
  }

  const billedRevenue = totalRevenue
  const factoredFallback = billedRevenue * (1 + revenueFactorPct / 100) + revenueAdjustmentUsd
  const factoredRevenue = evaluateFormulaOrFallback(
    'revproj.revenueFactors',
    { billedRevenue, revenueFactorPct, revenueAdjustmentUsd },
    factoredFallback,
    scope,
  )
  totalRevenue = Math.max(
    0,
    Math.round(
      evaluateFormulaOrFallback(
        'revproj.discountRevenue',
        { factoredRevenue, discountOrLessToRevenue, billedRevenue },
        factoredRevenue - discountOrLessToRevenue,
        scope,
      ),
    ),
  )

  const fteForCost = fte > 0 ? fte : requiredFte
  const weeksInMonth = networkDays > 0 ? networkDays / 5 : 4.33
  const laborFallback =
    d.monthlyLaborPerFteUsd > 0 && fteForCost > 0
      ? fteForCost * d.monthlyLaborPerFteUsd
      : fteForCost * productiveHours * Math.max(0, d.hourlySalaryUsd)
  const laborCost = Math.max(
    0,
    isCustomFormula('revproj.laborCost', scope)
      ? evaluateFormulaOrFallback(
          'revproj.laborCost',
          {
            fteForCost,
            productiveHours,
            hourlySalaryUsd: Math.max(0, d.hourlySalaryUsd),
            monthlyLaborPerFteUsd: Math.max(0, d.monthlyLaborPerFteUsd),
          },
          laborFallback,
          scope,
        )
      : laborFallback,
  )
  const supportCost = Math.max(0, d.supportSalaryUsd) * weeksInMonth
  const trainingCost = Math.max(0, d.trainingSalaryRateUsd) * fteForCost * weeksInMonth
  const otherCost = Math.max(0, d.otherCostUsd) * weeksInMonth
  const extraWeekly = sumCostLinesWeekly(line.costLines)
  const extraSalaryCost = extraWeekly.salaryUsd * weeksInMonth
  const extraOpexCost = extraWeekly.opexUsd * weeksInMonth
  const totalCostFallback = Math.max(
    0,
    Math.round(laborCost + supportCost + trainingCost + otherCost + extraSalaryCost + extraOpexCost),
  )
  const totalCost = Math.max(
    0,
    Math.round(
      isCustomFormula('revproj.totalCost', scope)
        ? evaluateFormulaOrFallback(
            'revproj.totalCost',
            {
              laborCost,
              supportSalaryUsd: Math.max(0, d.supportSalaryUsd),
              trainingSalaryRateUsd: Math.max(0, d.trainingSalaryRateUsd),
              otherCostUsd: Math.max(0, d.otherCostUsd),
              extraSalaryCost,
              extraOpexCost,
              weeksInMonth,
              fteForCost,
            },
            totalCostFallback,
            scope,
          )
        : totalCostFallback,
    ),
  )
  const grossMargin = Math.round(
    evaluateFormulaOrFallback(
      'revproj.grossMargin',
      { totalRevenue, totalCost },
      totalRevenue - totalCost,
      scope,
    ),
  )
  const gmPct = totalRevenue > 0 ? (grossMargin / totalRevenue) * 100 : null

  return {
    month,
    networkDays,
    capacity,
    fte,
    aht,
    loginHours,
    absenteeismPct,
    shrinkagePct,
    occupancyPct,
    hourlyBillRate,
    monthlyBillRate,
    perMinuteBillRate,
    perTransactionBillRate,
    discountOrLessToRevenue,
    extraHours,
    revenueFactorPct,
    revenueAdjustmentUsd,
    billRateMethod,
    billRateMethods,
    fteBilling,
    productiveHours,
    productiveHoursPostOcc,
    requiredFte,
    totalRevenue,
    totalCost,
    grossMargin,
    gmPct,
  }
}

export function lineYearRevenue(
  line: RevenueProjectionLobLine,
  months: string[],
  resolveOptions?: (month: string) => RevenueProjectionComputeOptions | undefined,
): number {
  return months.reduce(
    (sum, month) =>
      sum + computeRevenueProjectionMonth(line, month, resolveOptions?.(month)).totalRevenue,
    0,
  )
}

export function lineYearCost(
  line: RevenueProjectionLobLine,
  months: string[],
  resolveOptions?: (month: string) => RevenueProjectionComputeOptions | undefined,
): number {
  return months.reduce(
    (sum, month) =>
      sum + computeRevenueProjectionMonth(line, month, resolveOptions?.(month)).totalCost,
    0,
  )
}

export function lineYearMargin(
  line: RevenueProjectionLobLine,
  months: string[],
  resolveOptions?: (month: string) => RevenueProjectionComputeOptions | undefined,
): number {
  return lineYearRevenue(line, months, resolveOptions) - lineYearCost(line, months, resolveOptions)
}

export type RevenueProjectionClientCombinedMonth = {
  month: string
  networkDays: number
  capacity: number
  fte: number
  productiveHours: number
  productiveHoursPostOcc: number
  totalRevenue: number
  totalCost: number
  grossMargin: number
  gmPct: number | null
  lobCount: number
}

export function combineRevenueProjectionMonths(
  lines: RevenueProjectionLobLine[],
  months: string[],
  resolveOptions?: (
    line: RevenueProjectionLobLine,
    month: string,
  ) => RevenueProjectionComputeOptions | undefined,
): RevenueProjectionClientCombinedMonth[] {
  return months.map((month) => {
    let capacity = 0
    let fte = 0
    let productiveHours = 0
    let productiveHoursPostOcc = 0
    let totalRevenue = 0
    let totalCost = 0
    for (const line of lines) {
      const row = computeRevenueProjectionMonth(line, month, resolveOptions?.(line, month))
      capacity += row.capacity
      fte += row.fte
      productiveHours += row.productiveHours
      productiveHoursPostOcc += row.productiveHoursPostOcc
      totalRevenue += row.totalRevenue
      totalCost += row.totalCost
    }
    return {
      month,
      networkDays: networkDaysInMonth(month),
      capacity: Math.round(capacity),
      fte: Math.round(fte * 100) / 100,
      productiveHours: Math.round(productiveHours * 100) / 100,
      productiveHoursPostOcc: Math.round(productiveHoursPostOcc * 100) / 100,
      totalRevenue,
      totalCost,
      grossMargin: totalRevenue - totalCost,
      gmPct: totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : null,
      lobCount: lines.length,
    }
  })
}

export function combineClientRevenueProjectionMonths(
  lines: RevenueProjectionLobLine[],
  clientName: string,
  months: string[],
  resolveOptions?: (
    line: RevenueProjectionLobLine,
    month: string,
  ) => RevenueProjectionComputeOptions | undefined,
): RevenueProjectionClientCombinedMonth[] {
  const clientLines = lines.filter(
    (line) => line.clientName.trim().toLowerCase() === clientName.trim().toLowerCase(),
  )
  return combineRevenueProjectionMonths(clientLines, months, resolveOptions)
}

export function listRevenueProjectionClients(lines: RevenueProjectionLobLine[]): string[] {
  return [...new Set(lines.map((line) => line.clientName.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
}

export function listRevenueProjectionLocations(lines: RevenueProjectionLobLine[]): string[] {
  return [...new Set(lines.map((line) => line.location.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
}

export function listRevenueProjectionLobs(lines: RevenueProjectionLobLine[]): string[] {
  return [...new Set(lines.map((line) => line.lobProjectName.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
}

export function listRevenueProjectionChannels(lines: RevenueProjectionLobLine[]): ChannelType[] {
  return CHANNEL_TYPES.filter((channel) => lines.some((line) => line.channel === channel))
}

export function listClientLobs(
  lines: RevenueProjectionLobLine[],
  clientName: string,
): RevenueProjectionLobLine[] {
  return lines
    .filter((line) => line.clientName.trim().toLowerCase() === clientName.trim().toLowerCase())
    .sort((a, b) => a.lobProjectName.localeCompare(b.lobProjectName))
}

export type RevProjMetricRowId =
  | 'capacity'
  | 'fte'
  | 'aht'
  | 'loginHours'
  | 'absenteeismPct'
  | 'shrinkagePct'
  | 'productiveHours'
  | 'occupancyPct'
  | 'productiveHoursPostOcc'
  | 'extraHours'
  | 'hourlyBillRate'
  | 'monthlyBillRate'
  | 'perMinuteBillRate'
  | 'perTransactionBillRate'
  | 'revenueFactorPct'
  | 'revenueAdjustmentUsd'
  | 'discountOrLessToRevenue'
  | 'totalRevenue'
  | 'totalCost'
  | 'grossMargin'
  | 'gmPct'

export const REV_PROJ_METRIC_ROWS: readonly {
  id: RevProjMetricRowId
  label: string
  editable: boolean
  kind: 'number' | 'pct' | 'currency' | 'computed'
}[] = [
  { id: 'capacity', label: 'Capacity / Transactions', editable: true, kind: 'number' },
  { id: 'fte', label: 'FTE', editable: true, kind: 'number' },
  { id: 'aht', label: 'AHT', editable: true, kind: 'number' },
  { id: 'loginHours', label: 'Login Hours', editable: true, kind: 'number' },
  { id: 'absenteeismPct', label: 'Absenteeism %', editable: true, kind: 'pct' },
  { id: 'shrinkagePct', label: 'In office Shrinkage', editable: true, kind: 'pct' },
  { id: 'productiveHours', label: 'Productive hours', editable: false, kind: 'computed' },
  { id: 'occupancyPct', label: 'Occupancy', editable: true, kind: 'pct' },
  { id: 'productiveHoursPostOcc', label: 'Productive Hours post Occupancy', editable: false, kind: 'computed' },
  { id: 'extraHours', label: 'Extra hours', editable: true, kind: 'number' },
  { id: 'hourlyBillRate', label: 'Hourly Bill Rate', editable: true, kind: 'currency' },
  { id: 'monthlyBillRate', label: 'Monthly Bill Rate', editable: true, kind: 'currency' },
  { id: 'perMinuteBillRate', label: 'Per Minute Bill Rate', editable: true, kind: 'currency' },
  { id: 'perTransactionBillRate', label: 'Per Chat / Sale / Transaction Rate', editable: true, kind: 'currency' },
  { id: 'discountOrLessToRevenue', label: 'Discount or Less to Revenue', editable: true, kind: 'currency' },
  { id: 'totalRevenue', label: 'Total Revenue', editable: false, kind: 'currency' },
  { id: 'totalCost', label: 'Total Cost', editable: false, kind: 'currency' },
  { id: 'grossMargin', label: 'Gross Margin', editable: false, kind: 'currency' },
  { id: 'gmPct', label: 'GM %', editable: false, kind: 'pct' },
] as const

export { isFteBillingPlan }

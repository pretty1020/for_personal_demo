import { isFteBillingPlan } from '../../utils/staffingCapacity/billingModel'
import { networkDaysInMonth } from './networkDays'

const STORAGE_KEY = 'wfp-dbe-lines-v3'
const LEGACY_KEYS = ['wfp-dbe-lines-v2', 'wfp-dbe-lines-v1'] as const

/** Which bill rate drives Total Revenue. */
export type DbeBillRateMethod = 'hourly' | 'monthly' | 'per_minute'

export const DBE_BILL_RATE_METHODS: readonly {
  value: DbeBillRateMethod
  label: string
  hint: string
}[] = [
  {
    value: 'hourly',
    label: 'Hourly bill rate',
    hint: 'Capacity path: Capacity × AHT × hourly rate ÷ (login hours² × (1 − shrinkage)). FTE billing: FTE × hourly rate × Productive Hours (network days are in Productive Hours).',
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
] as const

/** Editable month inputs (Capacity & drivers). Blank = use LOB defaults. */
export type DbeMonthInput = {
  capacity: number | null
  /** Manual FTE for FTE billing type. */
  fte: number | null
  aht: number | null
  loginHours: number | null
  absenteeismPct: number | null
  shrinkagePct: number | null
  occupancyPct: number | null
  hourlyBillRate: number | null
  monthlyBillRate: number | null
  perMinuteBillRate: number | null
  /** Manual discount / less-to-revenue amount deducted from Total Revenue. Default 0. */
  discountOrLessToRevenue: number | null
  /** Extra hours added into Total Revenue (× active rate). Default 0. */
  extraHours: number | null
}

export type DbeRevenueAdjustmentMode = 'amount' | 'percent'
export type DbeRevenueAdjustmentEffect = 'add' | 'deduct'

/** Custom revenue row that adds to or deducts from Total Revenue ($ or % of subtotal). */
export type DbeRevenueAdjustment = {
  id: string
  label: string
  mode: DbeRevenueAdjustmentMode
  effect: DbeRevenueAdjustmentEffect
  defaultValue: number
  months: Record<string, number | null>
}

export type DbeCostMode = 'amount' | 'percent_of_revenue' | 'per_fte' | 'per_productive_hour'

export type DbeCostBreakdownItem = {
  id: string
  label: string
  defaultValue: number
  months: Record<string, number | null>
}

/** Cost line (People Cost, OPEX, etc.) with optional breakdown rows. */
export type DbeCostItem = {
  id: string
  label: string
  mode: DbeCostMode
  defaultValue: number
  months: Record<string, number | null>
  breakdown: DbeCostBreakdownItem[]
}

export const DBE_COST_MODES: readonly { value: DbeCostMode; label: string }[] = [
  { value: 'amount', label: 'Fixed amount ($)' },
  { value: 'percent_of_revenue', label: '% of revenue' },
  { value: 'per_fte', label: '$ per FTE' },
  { value: 'per_productive_hour', label: '$ per productive hour' },
] as const

export const DBE_REVENUE_ADJUSTMENT_MODES: readonly { value: DbeRevenueAdjustmentMode; label: string }[] = [
  { value: 'amount', label: 'Cost ($)' },
  { value: 'percent', label: 'Percentage (%)' },
] as const

export const DBE_REVENUE_ADJUSTMENT_EFFECTS: readonly { value: DbeRevenueAdjustmentEffect; label: string }[] = [
  { value: 'add', label: 'Add to revenue' },
  { value: 'deduct', label: 'Deduct from revenue' },
] as const

function normalizeRowRemarks(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') out[key] = value
  }
  return out
}

export function dbeRemarkKey(
  kind: 'metric' | 'rev' | 'cost' | 'cost-bd' | 'total-revenue' | 'total-cost' | 'gm' | 'gm-pct',
  id?: string,
): string {
  if (kind === 'metric') return `metric:${id ?? ''}`
  if (kind === 'rev') return `rev:${id ?? ''}`
  if (kind === 'cost') return `cost:${id ?? ''}`
  if (kind === 'cost-bd') return `cost-bd:${id ?? ''}`
  return kind
}

export function getDbeRowRemark(line: DbeLobLine, key: string): string {
  return line.rowRemarks[key] ?? ''
}

export function createRevenueAdjustment(
  partial?: Partial<Omit<DbeRevenueAdjustment, 'id'>>,
): DbeRevenueAdjustment {
  return {
    id: `rev-adj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label: partial?.label?.trim() || 'Custom metric',
    mode: partial?.mode ?? 'amount',
    effect: partial?.effect ?? 'deduct',
    defaultValue: partial?.defaultValue ?? 0,
    months: partial?.months ?? {},
  }
}

export function createCostBreakdownItem(label = 'Breakdown item'): DbeCostBreakdownItem {
  return {
    id: `cost-bd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label,
    defaultValue: 0,
    months: {},
  }
}

export function createCostItem(partial?: Partial<Omit<DbeCostItem, 'id'>>): DbeCostItem {
  return {
    id: `cost-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    label: partial?.label?.trim() || 'Cost item',
    mode: partial?.mode ?? 'amount',
    defaultValue: partial?.defaultValue ?? 0,
    months: partial?.months ?? {},
    breakdown: partial?.breakdown ?? [],
  }
}

function emptyBreakdown(id: string, label: string): DbeCostBreakdownItem {
  return { id, label, defaultValue: 0, months: {} }
}

/**
 * Base Cost & Cost Breakdown for new DBE clients (form + Add Client template).
 * Planners can rename, add, or remove rows; values stay 0 until entered.
 */
export const DEFAULT_DBE_COST_ITEMS: DbeCostItem[] = [
  {
    id: 'cost-people',
    label: 'People Cost',
    mode: 'amount',
    defaultValue: 0,
    months: {},
    breakdown: [
      emptyBreakdown('cost-bd-salaries', 'Salaries'),
      emptyBreakdown('cost-bd-transportation', 'Transportation Cost'),
      emptyBreakdown('cost-bd-datacard-wfh', 'DataCard Charges (WFH)'),
      emptyBreakdown('cost-bd-ta-salary', 'TA Salary Cost'),
      emptyBreakdown('cost-bd-ta-opex', 'TA OPEX Cost'),
      emptyBreakdown('cost-bd-ta-recruitment', 'TA Recruitment Cost'),
    ],
  },
  {
    id: 'cost-opex',
    label: 'OPEX',
    mode: 'amount',
    defaultValue: 0,
    months: {},
    breakdown: [
      emptyBreakdown('cost-bd-recharge', 'Recharge Expenses'),
      emptyBreakdown('cost-bd-other-direct', 'Other Direct costs'),
      emptyBreakdown('cost-bd-telecom', 'Direct Telecom Expenses'),
      emptyBreakdown('cost-bd-outsource', 'Out Source Consultancy'),
      emptyBreakdown('cost-bd-travel', 'Travel Expenses'),
      emptyBreakdown('cost-bd-training', 'Training Expenses'),
      emptyBreakdown('cost-bd-support-oh', 'Support Function OH Cost'),
    ],
  },
]

/** LOB-level defaults applied when a month cell is empty. */
export type DbeLobDefaults = {
  aht: number
  loginHours: number
  absenteeismPct: number
  shrinkagePct: number
  occupancyPct: number
  hourlyBillRate: number
  monthlyBillRate: number
  perMinuteBillRate: number
}

export type DbeLobLine = {
  id: string
  clientName: string
  lobProjectName: string
  location: string
  projectCode: string
  billingType: string
  agentGroup: string
  billRateMethod: DbeBillRateMethod
  defaults: DbeLobDefaults
  /** When true, Absenteeism / Shrinkage come from Staffing Plan planned monthly drivers. */
  useStaffingAbsenteeismShrinkage: boolean
  /** Per-month inputs keyed by YYYY-MM. */
  months: Record<string, DbeMonthInput>
  /** Custom revenue metrics applied after base revenue + extra hours. */
  revenueAdjustments: DbeRevenueAdjustment[]
  /** Cost table rows used to compute GM and GM%. */
  costItems: DbeCostItem[]
  /** Free-text comments keyed by row id (metric, revenue adj, cost, etc.). */
  rowRemarks: Record<string, string>
  createdAt: string
  updatedAt: string
}

export type DbeMonthComputed = {
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
  discountOrLessToRevenue: number
  extraHours: number
  billRateMethod: DbeBillRateMethod
  fteBilling: boolean
  /** NetworkDays × LoginHours × (1 − Absenteeism − Shrinkage) */
  productiveHours: number
  /** Productive Hours × Occupancy */
  productiveHoursPostOcc: number
  /** Required FTE from capacity / productive hours post occ (handle hours). */
  requiredFte: number
  /** Revenue after base calc + extra hours, before custom adjustments and discount. */
  subtotalRevenue: number
  /** Applied custom adjustment amounts keyed by adjustment id. */
  revenueAdjustmentsApplied: Record<string, number>
  totalRevenue: number
  totalCost: number
  costByItem: Record<string, number>
  costBreakdownByItem: Record<string, Record<string, number>>
  gm: number
  gmPct: number
}

export type DbeComputeOptions = {
  /** Force Absenteeism % (0–100). */
  absenteeismPct?: number
  /** Force Shrinkage % (0–100). */
  shrinkagePct?: number
}

/** Neutral LOB defaults — no sample AHT / rates. Blank form fields stay blank until the user enters values. */
export const DEFAULT_DBE_DEFAULTS: DbeLobDefaults = {
  aht: 0,
  loginHours: 0,
  absenteeismPct: 0,
  shrinkagePct: 0,
  occupancyPct: 0,
  hourlyBillRate: 0,
  monthlyBillRate: 0,
  perMinuteBillRate: 0,
}

function optionalNonNeg(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return null
  return num
}

function clampPct(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(100, value)
}

function normalizeBillRateMethod(raw: unknown): DbeBillRateMethod {
  if (raw === 'monthly' || raw === 'per_minute' || raw === 'hourly') return raw
  return 'hourly'
}

function normalizeRevenueAdjustment(raw: Partial<DbeRevenueAdjustment>): DbeRevenueAdjustment {
  const months: Record<string, number | null> = {}
  if (raw.months && typeof raw.months === 'object') {
    for (const [key, value] of Object.entries(raw.months)) {
      months[key] = optionalNonNeg(value)
    }
  }
  return {
    id: raw.id || createRevenueAdjustment().id,
    label: (raw.label ?? 'Custom metric').trim() || 'Custom metric',
    mode: raw.mode === 'percent' ? 'percent' : 'amount',
    effect: raw.effect === 'add' ? 'add' : 'deduct',
    defaultValue: optionalNonNeg(raw.defaultValue) ?? 0,
    months,
  }
}

function normalizeCostBreakdownItem(raw: Partial<DbeCostBreakdownItem>): DbeCostBreakdownItem {
  const months: Record<string, number | null> = {}
  if (raw.months && typeof raw.months === 'object') {
    for (const [key, value] of Object.entries(raw.months)) {
      months[key] = optionalNonNeg(value)
    }
  }
  return {
    id: raw.id || createCostBreakdownItem().id,
    label: (raw.label ?? 'Breakdown item').trim() || 'Breakdown item',
    defaultValue: optionalNonNeg(raw.defaultValue) ?? 0,
    months,
  }
}

function normalizeCostItem(raw: Partial<DbeCostItem>): DbeCostItem {
  const months: Record<string, number | null> = {}
  if (raw.months && typeof raw.months === 'object') {
    for (const [key, value] of Object.entries(raw.months)) {
      months[key] = optionalNonNeg(value)
    }
  }
  const mode: DbeCostMode =
    raw.mode === 'percent_of_revenue' ||
    raw.mode === 'per_fte' ||
    raw.mode === 'per_productive_hour' ||
    raw.mode === 'amount'
      ? raw.mode
      : 'amount'
  return {
    id: raw.id || createCostItem().id,
    label: (raw.label ?? 'Cost item').trim() || 'Cost item',
    mode,
    defaultValue: optionalNonNeg(raw.defaultValue) ?? 0,
    months,
    breakdown: Array.isArray(raw.breakdown)
      ? raw.breakdown.map((item) => normalizeCostBreakdownItem(item))
      : [],
  }
}

function normalizeRevenueAdjustments(raw: unknown): DbeRevenueAdjustment[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => normalizeRevenueAdjustment(item as Partial<DbeRevenueAdjustment>))
}

function normalizeCostItems(raw: unknown): DbeCostItem[] {
  if (!Array.isArray(raw) || !raw.length) return DEFAULT_DBE_COST_ITEMS.map((item) => normalizeCostItem(item))
  return raw.map((item) => normalizeCostItem(item as Partial<DbeCostItem>))
}

function pickMonthOverride(
  months: Record<string, number | null>,
  month: string,
  fallback: number,
): number {
  const raw = months[month]
  if (raw !== null && raw !== undefined && Number.isFinite(raw)) return raw
  return fallback
}

function normalizeMonthInput(raw: Partial<DbeMonthInput> | undefined): DbeMonthInput {
  const positiveOrNull = (value: unknown): number | null => {
    const num = optionalNonNeg(value)
    return num === null || num === 0 ? null : num
  }
  return {
    capacity: optionalNonNeg(raw?.capacity),
    fte: optionalNonNeg(raw?.fte),
    // AHT / Occupancy: 0 is a valid manual override; null = use LOB default
    aht: optionalNonNeg(raw?.aht),
    // Login hours: 0 means “use LOB default” (zero hours is not operable)
    loginHours: positiveOrNull(raw?.loginHours),
    absenteeismPct: optionalNonNeg(raw?.absenteeismPct),
    shrinkagePct: optionalNonNeg(raw?.shrinkagePct),
    occupancyPct: optionalNonNeg(raw?.occupancyPct),
    hourlyBillRate: optionalNonNeg(raw?.hourlyBillRate),
    monthlyBillRate: optionalNonNeg(raw?.monthlyBillRate),
    perMinuteBillRate: optionalNonNeg(raw?.perMinuteBillRate),
    discountOrLessToRevenue: optionalNonNeg(raw?.discountOrLessToRevenue),
    extraHours: optionalNonNeg(raw?.extraHours),
  }
}

function normalizeDefaults(raw: Partial<DbeLobDefaults> | undefined): DbeLobDefaults {
  const positiveOrZero = (value: unknown): number => {
    const num = optionalNonNeg(value)
    return num === null ? 0 : num
  }
  return {
    // Allow explicit 0 — do not invent sample AHT / rates when the field is missing.
    aht: optionalNonNeg(raw?.aht) ?? 0,
    loginHours: positiveOrZero(raw?.loginHours),
    absenteeismPct: clampPct(optionalNonNeg(raw?.absenteeismPct) ?? 0),
    shrinkagePct: clampPct(optionalNonNeg(raw?.shrinkagePct) ?? 0),
    occupancyPct: clampPct(optionalNonNeg(raw?.occupancyPct) ?? 0),
    hourlyBillRate: optionalNonNeg(raw?.hourlyBillRate) ?? 0,
    monthlyBillRate: optionalNonNeg(raw?.monthlyBillRate) ?? 0,
    perMinuteBillRate: optionalNonNeg(raw?.perMinuteBillRate) ?? 0,
  }
}

export function emptyMonthInput(): DbeMonthInput {
  return {
    capacity: null,
    fte: null,
    aht: null,
    loginHours: null,
    absenteeismPct: null,
    shrinkagePct: null,
    occupancyPct: null,
    hourlyBillRate: null,
    monthlyBillRate: null,
    perMinuteBillRate: null,
    discountOrLessToRevenue: null,
    extraHours: null,
  }
}

export function normalizeLine(raw: Partial<DbeLobLine> & { id: string }): DbeLobLine {
  const months: Record<string, DbeMonthInput> = {}
  if (raw.months && typeof raw.months === 'object') {
    for (const [key, value] of Object.entries(raw.months)) {
      months[key] = normalizeMonthInput(value)
    }
  }

  const legacyMonthly = (raw as { monthlyFte?: Record<string, number> }).monthlyFte
  if (legacyMonthly && typeof legacyMonthly === 'object') {
    for (const key of Object.keys(legacyMonthly)) {
      if (!months[key]) months[key] = emptyMonthInput()
    }
  }

  const legacyFactors = (raw as { factors?: Record<string, number | null> }).factors
  let defaults = normalizeDefaults(raw.defaults)
  if (!raw.defaults && legacyFactors) {
    defaults = normalizeDefaults({
      aht: legacyFactors.ahtSeconds ?? defaults.aht,
      loginHours: legacyFactors.productiveHours ?? defaults.loginHours,
      absenteeismPct: legacyFactors.absenteeismPct ?? defaults.absenteeismPct,
      shrinkagePct: legacyFactors.shrinkagePct ?? defaults.shrinkagePct,
      occupancyPct: legacyFactors.occupancyPct ?? defaults.occupancyPct,
      hourlyBillRate:
        optionalNonNeg((raw as { hourlyRate?: number }).hourlyRate) ?? defaults.hourlyBillRate,
      monthlyBillRate: optionalNonNeg((raw as { rate?: number }).rate) ?? defaults.monthlyBillRate,
    })
  }

  return {
    id: raw.id,
    clientName: (raw.clientName ?? '').trim(),
    lobProjectName: (raw.lobProjectName ?? '').trim(),
    location: (raw.location ?? '').trim(),
    projectCode: (raw.projectCode ?? '').trim(),
    billingType: raw.billingType || 'Prod hours',
    agentGroup: (raw.agentGroup ?? '').trim(),
    billRateMethod: normalizeBillRateMethod(raw.billRateMethod),
    defaults,
    useStaffingAbsenteeismShrinkage: Boolean(raw.useStaffingAbsenteeismShrinkage),
    months,
    revenueAdjustments: normalizeRevenueAdjustments(raw.revenueAdjustments),
    costItems: normalizeCostItems(raw.costItems),
    rowRemarks: (() => {
      if (raw.rowRemarks) return normalizeRowRemarks(raw.rowRemarks)
      const legacy = (raw as { remarks?: string }).remarks
      if (typeof legacy === 'string' && legacy.trim()) {
        return { line: legacy.trim() }
      }
      return {}
    })(),
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

export function loadDbeLines(): DbeLobLine[] {
  const current = readStorage(STORAGE_KEY)
  if (current.length) return current.map((item) => normalizeLine(item as DbeLobLine))
  for (const key of LEGACY_KEYS) {
    const legacy = readStorage(key)
    if (legacy.length) {
      const migrated = legacy.map((item) => normalizeLine(item as DbeLobLine))
      saveDbeLines(migrated)
      return migrated
    }
  }
  return []
}

/**
 * Another planner's DBE lines, read straight from their capacity_documents payload.
 *
 * Deliberately does not touch localStorage, unlike loadDbeLines: Capacity mirrors
 * localStorage writes into the *reader's* own rows, so caching a colleague's lines
 * locally would republish their clients under the reader's name.
 */
export function parseDbeLinesPayload(payload: unknown): DbeLobLine[] {
  let value = payload
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return []
    }
  }
  if (!Array.isArray(value)) return []

  try {
    return value
      .filter((item): item is DbeLobLine => Boolean(item) && typeof item === 'object')
      .map((item) => normalizeLine(item))
  } catch {
    return []
  }
}

export function saveDbeLines(lines: DbeLobLine[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lines.map((line) => normalizeLine(line))))
}

export function createDbeLine(input: Omit<DbeLobLine, 'id' | 'createdAt' | 'updatedAt'>): DbeLobLine {
  const now = new Date().toISOString()
  return normalizeLine({
    ...input,
    id: `dbe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
  })
}

export function upsertDbeLine(lines: DbeLobLine[], next: DbeLobLine): DbeLobLine[] {
  const normalized = normalizeLine({ ...next, updatedAt: new Date().toISOString() })
  const index = lines.findIndex((line) => line.id === normalized.id)
  if (index < 0) return [...lines, normalized]
  const copy = [...lines]
  copy[index] = normalized
  return copy
}

export function deleteDbeLine(lines: DbeLobLine[], id: string): DbeLobLine[] {
  return lines.filter((line) => line.id !== id)
}

function pickMonthValue(monthValue: number | null, fallback: number): number {
  return monthValue !== null && Number.isFinite(monthValue) ? monthValue : fallback
}

/** Fiscal year starting April: Apr(Y) … Mar(Y+1). fiscalStartYear = Y. */
export function listFiscalMonthKeys(fiscalStartYear: number): string[] {
  const keys: string[] = []
  for (let month = 4; month <= 12; month += 1) {
    keys.push(`${fiscalStartYear}-${String(month).padStart(2, '0')}`)
  }
  for (let month = 1; month <= 3; month += 1) {
    keys.push(`${fiscalStartYear + 1}-${String(month).padStart(2, '0')}`)
  }
  return keys
}

export function formatFiscalMonthLabel(monthKey: string): string {
  const date = new Date(`${monthKey.slice(0, 7)}-01T12:00:00`)
  if (Number.isNaN(date.getTime())) return monthKey
  return date.toLocaleDateString(undefined, { month: 'short' })
}

export function billRateMethodLabel(method: DbeBillRateMethod): string {
  return DBE_BILL_RATE_METHODS.find((item) => item.value === method)?.label ?? method
}

export function computeDbeMonth(
  line: DbeLobLine,
  month: string,
  options?: DbeComputeOptions,
): DbeMonthComputed {
  const input = line.months[month] ?? emptyMonthInput()
  const d = line.defaults
  const networkDays = networkDaysInMonth(month)
  const capacity = pickMonthValue(input.capacity, 0)
  const fte = pickMonthValue(input.fte, 0)
  const aht = pickMonthValue(input.aht, d.aht)
  const loginHoursRaw = pickMonthValue(input.loginHours, d.loginHours)
  // Do not invent a sample login-hours figure — blank / zero stays zero (productive hours = 0).
  const loginHours = loginHoursRaw > 0 ? loginHoursRaw : 0
  const absenteeismPct = clampPct(
    options?.absenteeismPct != null
      ? options.absenteeismPct
      : pickMonthValue(input.absenteeismPct, d.absenteeismPct),
  )
  const shrinkagePct = clampPct(
    options?.shrinkagePct != null
      ? options.shrinkagePct
      : pickMonthValue(input.shrinkagePct, d.shrinkagePct),
  )
  const occupancyPct = clampPct(pickMonthValue(input.occupancyPct, d.occupancyPct))
  const hourlyBillRate = pickMonthValue(input.hourlyBillRate, d.hourlyBillRate)
  const monthlyBillRate = pickMonthValue(input.monthlyBillRate, d.monthlyBillRate)
  const perMinuteBillRate = pickMonthValue(input.perMinuteBillRate, d.perMinuteBillRate)
  const discountOrLessToRevenue = pickMonthValue(input.discountOrLessToRevenue, 0)
  const extraHours = pickMonthValue(input.extraHours, 0)
  const billRateMethod = line.billRateMethod
  const fteBilling = isFteBillingPlan(line.billingType)

  const availability = Math.max(0, 1 - absenteeismPct / 100 - shrinkagePct / 100)
  // Productive Hours = network days × login hours × (1 − absenteeism − shrinkage)
  const productiveHours = Math.round(networkDays * loginHours * availability * 100) / 100
  const productiveHoursPostOcc = Math.round(productiveHours * (occupancyPct / 100) * 100) / 100

  const handleHours = capacity > 0 && aht > 0 ? (capacity * aht) / 3600 : 0
  const requiredFte =
    productiveHoursPostOcc > 0 && handleHours > 0
      ? Math.round((handleHours / productiveHoursPostOcc) * 1000) / 1000
      : 0

  let totalRevenue = 0
  if (fteBilling && fte > 0) {
    // Hourly: FTE × hourly rate × Productive Hours (= FTE × rate × network days × login × availability)
    if (billRateMethod === 'hourly' && hourlyBillRate > 0) {
      const hoursBasis = productiveHours > 0 ? productiveHours : networkDays * loginHours
      if (hoursBasis > 0) totalRevenue = Math.round(fte * hourlyBillRate * hoursBasis)
    } else if (billRateMethod === 'monthly' && monthlyBillRate > 0) {
      totalRevenue = Math.round(fte * monthlyBillRate)
    } else if (billRateMethod === 'per_minute' && perMinuteBillRate > 0) {
      const hoursBasis = productiveHours > 0 ? productiveHours : networkDays * loginHours
      if (hoursBasis > 0) totalRevenue = Math.round(fte * hoursBasis * 60 * perMinuteBillRate)
    }
  } else if (!fteBilling && capacity > 0 && aht > 0) {
    // Mirrors the FTE-billing branch above with Required FTE standing in for entered
    // FTE, the same substitution the monthly branch below already makes. The previous
    // form divided contact-seconds by loginHours squared, which is dimensionally
    // meaningless and returned roughly 60x the FTE-billed revenue for identical work.
    if (billRateMethod === 'hourly' && hourlyBillRate > 0 && requiredFte > 0) {
      const hoursBasis = productiveHours > 0 ? productiveHours : networkDays * loginHours
      if (hoursBasis > 0) totalRevenue = Math.round(requiredFte * hourlyBillRate * hoursBasis)
    } else if (billRateMethod === 'per_minute' && perMinuteBillRate > 0) {
      totalRevenue = Math.round(capacity * (aht / 60) * perMinuteBillRate)
    } else if (billRateMethod === 'monthly' && monthlyBillRate > 0 && requiredFte > 0) {
      totalRevenue = Math.round(requiredFte * monthlyBillRate)
    }
  }

  // Extra hours add to revenue at the active rate.
  if (extraHours > 0) {
    if (billRateMethod === 'hourly' && hourlyBillRate > 0) {
      totalRevenue += Math.round(extraHours * hourlyBillRate)
    } else if (billRateMethod === 'per_minute' && perMinuteBillRate > 0) {
      totalRevenue += Math.round(extraHours * 60 * perMinuteBillRate)
    } else if (billRateMethod === 'monthly' && monthlyBillRate > 0) {
      const monthHours = networkDays * loginHours
      if (monthHours > 0) totalRevenue += Math.round((extraHours / monthHours) * monthlyBillRate)
    }
  }

  const subtotalRevenue = Math.max(0, Math.round(totalRevenue))
  const revenueAdjustmentsApplied: Record<string, number> = {}
  let adjustedRevenue = subtotalRevenue
  for (const adjustment of line.revenueAdjustments) {
    const raw = pickMonthOverride(adjustment.months, month, adjustment.defaultValue)
    const magnitude =
      adjustment.mode === 'percent'
        ? Math.round(subtotalRevenue * (raw / 100))
        : Math.round(raw)
    const signed = adjustment.effect === 'deduct' ? -magnitude : magnitude
    revenueAdjustmentsApplied[adjustment.id] = signed
    adjustedRevenue += signed
  }

  // Discount / less-to-revenue is deducted last.
  totalRevenue = Math.max(0, Math.round(adjustedRevenue - discountOrLessToRevenue))

  const costByItem: Record<string, number> = {}
  const costBreakdownByItem: Record<string, Record<string, number>> = {}
  let totalCost = 0
  const fteBasis = fteBilling ? fte : requiredFte
  for (const item of line.costItems) {
    if (item.breakdown.length > 0) {
      const breakdownAmounts: Record<string, number> = {}
      let itemTotal = 0
      for (const sub of item.breakdown) {
        const amount = Math.round(pickMonthOverride(sub.months, month, sub.defaultValue))
        breakdownAmounts[sub.id] = amount
        itemTotal += amount
      }
      costBreakdownByItem[item.id] = breakdownAmounts
      costByItem[item.id] = itemTotal
      totalCost += itemTotal
      continue
    }
    const raw = pickMonthOverride(item.months, month, item.defaultValue)
    let itemTotal = 0
    if (item.mode === 'amount') itemTotal = Math.round(raw)
    else if (item.mode === 'percent_of_revenue') itemTotal = Math.round(totalRevenue * (raw / 100))
    else if (item.mode === 'per_fte') itemTotal = Math.round(fteBasis * raw)
    // productiveHours is hours for ONE FTE, so the rate must also span the headcount.
    // Without fteBasis a 1-FTE and a 200-FTE programme booked the same cost.
    else if (item.mode === 'per_productive_hour') itemTotal = Math.round(fteBasis * productiveHours * raw)
    costByItem[item.id] = itemTotal
    totalCost += itemTotal
  }

  const gm = Math.round(totalRevenue - totalCost)
  const gmPct = totalRevenue > 0 ? Math.round((gm / totalRevenue) * 10000) / 100 : 0

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
    discountOrLessToRevenue,
    extraHours,
    billRateMethod,
    fteBilling,
    productiveHours,
    productiveHoursPostOcc,
    requiredFte,
    subtotalRevenue,
    revenueAdjustmentsApplied,
    totalRevenue,
    totalCost,
    costByItem,
    costBreakdownByItem,
    gm,
    gmPct,
  }
}

export function lineYearRevenue(
  line: DbeLobLine,
  months: string[],
  resolveOptions?: (month: string) => DbeComputeOptions | undefined,
): number {
  return months.reduce(
    (sum, month) => sum + computeDbeMonth(line, month, resolveOptions?.(month)).totalRevenue,
    0,
  )
}

export type DbeClientCombinedMonth = {
  month: string
  networkDays: number
  capacity: number
  fte: number
  productiveHours: number
  productiveHoursPostOcc: number
  totalRevenue: number
  totalCost: number
  gm: number
  gmPct: number
  lobCount: number
}

export function combineDbeMonths(
  lines: DbeLobLine[],
  months: string[],
  resolveOptions?: (line: DbeLobLine, month: string) => DbeComputeOptions | undefined,
): DbeClientCombinedMonth[] {
  return months.map((month) => {
    let capacity = 0
    let fte = 0
    let productiveHours = 0
    let productiveHoursPostOcc = 0
    let totalRevenue = 0
    let totalCost = 0
    let gm = 0
    for (const line of lines) {
      const row = computeDbeMonth(line, month, resolveOptions?.(line, month))
      capacity += row.capacity
      fte += row.fte
      productiveHours += row.productiveHours
      productiveHoursPostOcc += row.productiveHoursPostOcc
      totalRevenue += row.totalRevenue
      totalCost += row.totalCost
      gm += row.gm
    }
    const gmPct = totalRevenue > 0 ? Math.round((gm / totalRevenue) * 10000) / 100 : 0
    return {
      month,
      networkDays: networkDaysInMonth(month),
      capacity: Math.round(capacity),
      fte: Math.round(fte * 100) / 100,
      productiveHours: Math.round(productiveHours * 100) / 100,
      productiveHoursPostOcc: Math.round(productiveHoursPostOcc * 100) / 100,
      totalRevenue,
      totalCost,
      gm,
      gmPct,
      lobCount: lines.length,
    }
  })
}

export function combineClientDbeMonths(
  lines: DbeLobLine[],
  clientName: string,
  months: string[],
  resolveOptions?: (line: DbeLobLine, month: string) => DbeComputeOptions | undefined,
): DbeClientCombinedMonth[] {
  const clientLines = lines.filter(
    (line) => line.clientName.trim().toLowerCase() === clientName.trim().toLowerCase(),
  )
  return combineDbeMonths(clientLines, months, resolveOptions)
}

export function listDbeClients(lines: DbeLobLine[]): string[] {
  return [...new Set(lines.map((line) => line.clientName.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
}

export function listDbeLocations(lines: DbeLobLine[]): string[] {
  return [...new Set(lines.map((line) => line.location.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
}

export function listDbeLobs(lines: DbeLobLine[]): string[] {
  return [...new Set(lines.map((line) => line.lobProjectName.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  )
}

export function listClientLobs(lines: DbeLobLine[], clientName: string): DbeLobLine[] {
  return lines
    .filter((line) => line.clientName.trim().toLowerCase() === clientName.trim().toLowerCase())
    .sort((a, b) => a.lobProjectName.localeCompare(b.lobProjectName))
}

export type DbeMetricRowId =
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
  | 'discountOrLessToRevenue'
  | 'totalRevenue'

export const DBE_METRIC_ROWS: readonly {
  id: DbeMetricRowId
  label: string
  editable: boolean
  kind: 'number' | 'pct' | 'currency' | 'computed'
}[] = [
  { id: 'capacity', label: 'Capacity / Transactions', editable: true, kind: 'number' },
  { id: 'fte', label: 'FTE', editable: true, kind: 'number' },
  { id: 'aht', label: 'AHT', editable: true, kind: 'number' },
  { id: 'loginHours', label: 'Login Hours', editable: true, kind: 'number' },
  { id: 'absenteeismPct', label: 'Absenteeism %', editable: true, kind: 'pct' },
  { id: 'shrinkagePct', label: 'Shrinkage (in-office, excl. Break)', editable: true, kind: 'pct' },
  { id: 'productiveHours', label: 'Productive hours', editable: false, kind: 'computed' },
  { id: 'occupancyPct', label: 'Occupancy', editable: true, kind: 'pct' },
  { id: 'productiveHoursPostOcc', label: 'Productive Hours post Occupancy', editable: false, kind: 'computed' },
  { id: 'extraHours', label: 'Extra hours', editable: true, kind: 'number' },
  { id: 'hourlyBillRate', label: 'Hourly Bill Rate', editable: true, kind: 'currency' },
  { id: 'monthlyBillRate', label: 'Monthly Bill Rate', editable: true, kind: 'currency' },
  { id: 'perMinuteBillRate', label: 'Per Minute Bill Rate', editable: true, kind: 'currency' },
  { id: 'discountOrLessToRevenue', label: 'Discount or Less to Revenue', editable: true, kind: 'currency' },
  { id: 'totalRevenue', label: 'Total Revenue', editable: false, kind: 'currency' },
] as const

export { isFteBillingPlan }
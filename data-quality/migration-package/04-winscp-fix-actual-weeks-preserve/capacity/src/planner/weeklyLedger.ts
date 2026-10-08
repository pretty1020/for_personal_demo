import type { PlannerScenario, SimulationResult, WeekStart } from './types'
import {
  addWeeks,
  isoDate,
  resolveCapacityFiscalEndWeek,
  resolveCapacityFiscalStartWeek,
  resolveCapacityPlanStartWeek,
  startOfWeek,
  uniqueSortedWeeks,
} from './capacityWeekUtils'

export type LedgerMetricSnapshot = {
  callVolume: number | null
  handledVolume: number | null
  ahtSeconds: number | null
  cappedAhtSeconds: number | null
  occupancy: number | null
  beginningProductionHc: number | null
  plannedNewHires: number | null
  actualTrainingStartHc: number | null
  trainingHc: number | null
  nestingHc: number | null
  graduateHc: number | null
  attritionHc: number | null
  /** Planned attrition rate (0–1). Optional override; when set, drives attrition HC. */
  attritionPct: number | null
  /** Planned training attrition rate (0–1) for the calendar week. */
  trainingAttritionPct: number | null
  /** Planned nesting attrition rate (0–1) for the calendar week. */
  nestingAttritionPct: number | null
  transferInHc: number | null
  transferOutHc: number | null
  offRosterLoaHc: number | null
  supportHc: number | null
  /** Planned seat capacity for the site / LOB. */
  plannedSeats?: number | null
  /** Peak ratio (e.g. seats ÷ production HC). */
  peakRatio?: number | null
  productionHc: number | null
  requiredFte: number | null
  coreProductionFte: number | null
  nestingProductiveFte: number | null
  productionFte: number | null
  overUnderStaffing: number | null
  staffingPct: number | null
  totalShrinkagePct: number | null
  /** Manual Staffing Plan hours inputs (week overrides). */
  scheduledBillableHours: number | null
  actualBillableHours: number | null
  productiveHours: number | null
  payrollHours: number | null
  switchHours: number | null
}

export type WeeklyLedgerShrinkageCategory = {
  id: string
  name: string
  group: 'out_of_office' | 'in_office'
  billable: boolean
  plannedPct: number
  actualPct: number | null
}

export type WeeklyLedgerRow = {
  key: string
  scenarioId: string
  scenarioName: string
  client: string
  location: string
  billingType: string
  weekStart: WeekStart
  week: string
  periodLabel: string
  timeline: 'historical_actual' | 'forward_plan'
  overrideSource: 'generated' | 'import'
  notes?: string
  planned: LedgerMetricSnapshot
  actual: LedgerMetricSnapshot | null
  shrinkage: WeeklyLedgerShrinkageCategory[]
  /** Actual support HC by role from ledger overrides. */
  actualSupportHcByRole?: Record<string, number>
}

export type WeeklyLedgerView = 'weekly' | 'monthly' | 'quarterly'

export type ImportedActualOverride = {
  week: string
  notes?: string
  metrics: Partial<LedgerMetricSnapshot>
  shrinkageById?: Record<string, number>
  supportHcByRole?: Record<string, number>
}

import {
  SHRINKAGE_CATEGORY_TEMPLATES,
  mergeShrinkageCategoryTemplates,
  type ShrinkageCategoryTemplate,
} from './shrinkageCategories'
/** Default historical ACTUAL weeks generated before capacity plan start (enables forecasting). */
export const LEDGER_HISTORY_WEEKS = 8

const NUMERIC_OVERRIDE_FIELDS: Record<string, keyof LedgerMetricSnapshot> = {
  volume: 'callVolume',
  callvolume: 'callVolume',
  call_volume: 'callVolume',
  actualvolume: 'callVolume',
  handledvolume: 'handledVolume',
  aht: 'ahtSeconds',
  ahtseconds: 'ahtSeconds',
  cappedaht: 'cappedAhtSeconds',
  cappedahtseconds: 'cappedAhtSeconds',
  occupancy: 'occupancy',
  beginningproductionhc: 'beginningProductionHc',
  plannednewhires: 'plannedNewHires',
  actualtrainingstarthc: 'actualTrainingStartHc',
  traininghc: 'trainingHc',
  nestinghc: 'nestingHc',
  graduatehc: 'graduateHc',
  attritionhc: 'attritionHc',
  attritionpct: 'attritionPct',
  transferinhc: 'transferInHc',
  transferouthc: 'transferOutHc',
  offrosterloahc: 'offRosterLoaHc',
  offrosterhc: 'offRosterLoaHc',
  loahc: 'offRosterLoaHc',
  supporthc: 'supportHc',
  productionhc: 'productionHc',
  requiredfte: 'requiredFte',
  coreproductionfte: 'coreProductionFte',
  nestingproductivefte: 'nestingProductiveFte',
  productionfte: 'productionFte',
  overunderstaffing: 'overUnderStaffing',
  staffingpct: 'staffingPct',
  totalshrinkagepct: 'totalShrinkagePct',
  shrinkagepct: 'totalShrinkagePct',
  scheduledbillablehours: 'scheduledBillableHours',
  actualbillablehours: 'actualBillableHours',
  productivehours: 'productiveHours',
  payrollhours: 'payrollHours',
  switchhours: 'switchHours',
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function parsePct(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  return num > 1 ? num / 100 : num
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function monthShort(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

function quarterLabel(date: Date): string {
  const quarter = Math.floor(date.getMonth() / 3) + 1
  return `Q${quarter} ${String(date.getFullYear()).slice(-2)}`
}

function plannedMetrics(period: SimulationResult['periods'][number]): LedgerMetricSnapshot {
  return {
    callVolume: period.forecastVolume,
    handledVolume: null,
    ahtSeconds: null,
    cappedAhtSeconds: null,
    occupancy: period.occupancy,
    beginningProductionHc: period.beginningProductionHc,
    plannedNewHires: period.hiringPlanned,
    actualTrainingStartHc: period.actualTrainingStart,
    trainingHc: period.trainingHeadcount,
    nestingHc: period.nestingHeadcount,
    graduateHc: period.graduateHc,
    attritionHc: period.attritionPlanned,
    attritionPct:
      period.beginningProductionHc > 0 ? period.attritionPlanned / period.beginningProductionHc : null,
    trainingAttritionPct: null,
    nestingAttritionPct: null,
    transferInHc: 0,
    transferOutHc: 0,
    offRosterLoaHc: 0,
    supportHc: 0,
    productionHc: period.scheduledFte,
    requiredFte: period.requiredFte,
    coreProductionFte: period.coreProductionFte,
    nestingProductiveFte: period.nestingProductiveFte,
    productionFte: period.productiveFte,
    overUnderStaffing: period.netStaffing,
    staffingPct: period.staffingPct,
    totalShrinkagePct: period.totalShrinkageRate,
    scheduledBillableHours: null,
    actualBillableHours: null,
    productiveHours: null,
    payrollHours: null,
    switchHours: null,
  }
}

function plannedMetricsNormalized(
  _scenario: PlannerScenario,
  period: SimulationResult['periods'][number],
): LedgerMetricSnapshot {
  return plannedMetrics(period)
}

function scaleShrinkageActualTotal(
  categories: WeeklyLedgerShrinkageCategory[],
  actualTotal: number | null,
): WeeklyLedgerShrinkageCategory[] {
  if (actualTotal == null) {
    return categories.map((category) => ({ ...category, actualPct: null }))
  }
  const plannedSum = categories.reduce((sum, category) => sum + category.plannedPct, 0)
  if (plannedSum <= 0) {
    const weight = 1 / Math.max(categories.length, 1)
    return categories.map((category) => ({ ...category, actualPct: actualTotal * weight }))
  }
  const scale = actualTotal / plannedSum
  return categories.map((category) => ({
    ...category,
    actualPct: Math.max(0, category.plannedPct * scale),
  }))
}

function buildHistoricalActualMetrics(
  _scenario: PlannerScenario,
  _period: SimulationResult['periods'][number],
  _weekIndex: number,
  _planned: LedgerMetricSnapshot,
): LedgerMetricSnapshot {
  // No planned/assumption copies — actual weeks stay blank until imported or entered.
  return emptyMetrics()
}

function enrichHistoricalPlannedMetrics(
  _scenario: PlannerScenario,
  _period: SimulationResult['periods'][number],
  _weekIndex: number,
  planned: LedgerMetricSnapshot,
  isForward: boolean,
): LedgerMetricSnapshot {
  if (isForward) return planned
  return {
    ...planned,
    totalShrinkagePct: null,
  }
}

function buildShrinkageCategories(
  scenario: PlannerScenario,
  plannedTotal: number,
  actualTotal: number | null,
  periodSeed: number,
  override?: ImportedActualOverride,
  plannedCategoryOverrides?: Record<string, number>,
  categoryTemplates: ShrinkageCategoryTemplate[] = [],
): WeeklyLedgerShrinkageCategory[] {
  void scenario
  void plannedTotal
  void periodSeed
  return categoryTemplates.map((template) => {
    const plannedPct = plannedCategoryOverrides?.[template.id] ?? 0
    const overrideActual = override?.shrinkageById?.[template.id]
    const actualPct =
      overrideActual != null
        ? overrideActual
        : actualTotal == null
          ? null
          : null
    return {
      id: template.id,
      name: template.name,
      group: template.group,
      billable: template.billable,
      plannedPct,
      actualPct,
    }
  })
}

function withOverrides(base: LedgerMetricSnapshot, override?: ImportedActualOverride): LedgerMetricSnapshot {
  if (!override) return base
  return {
    ...base,
    ...override.metrics,
  }
}

function ledgerKey(scenario: PlannerScenario, week: string): string {
  const { client, location, billingType, weekStart } = scenario.plan
  return [client, location, billingType, weekStart, week].join('|')
}

export function buildWeeklyPlanLedger(
  scenario: PlannerScenario,
  result: SimulationResult,
  overrides: ImportedActualOverride[] = [],
  customCategories: ShrinkageCategoryTemplate[] = [],
): WeeklyLedgerRow[] {
  const categoryTemplates = mergeShrinkageCategoryTemplates(customCategories)
  const byWeek = new Map(overrides.map((item) => [item.week, item]))
  const weekStart = scenario.plan.weekStart
  const planStartIso = resolveCapacityPlanStartWeek(scenario.plan)
  const importedWeeks = uniqueSortedWeeks(scenario.plan.capacityImportedWeeks ?? [])

  const fiscalStart = new Date(`${resolveCapacityFiscalStartWeek(weekStart)}T12:00:00`)
  const fiscalEnd = new Date(`${resolveCapacityFiscalEndWeek(weekStart)}T12:00:00`)
  let rangeStart = fiscalStart
  let rangeEnd = fiscalEnd

  if (importedWeeks.length) {
    const firstImported = startOfWeek(new Date(`${importedWeeks[0]!}T12:00:00`), weekStart)
    const lastImported = startOfWeek(new Date(`${importedWeeks[importedWeeks.length - 1]!}T12:00:00`), weekStart)
    if (firstImported < rangeStart) rangeStart = firstImported
    if (lastImported > rangeEnd) rangeEnd = lastImported
  }

  const rows: WeeklyLedgerRow[] = []
  let weekIndex = 0
  let actualCounter = 0
  let planCounter = 0

  for (let cursor = new Date(rangeStart); cursor <= rangeEnd; cursor = addWeeks(cursor, 1)) {
    const week = isoDate(startOfWeek(cursor, weekStart))
    const isForward = week >= planStartIso
    const period = result.periods[weekIndex % result.periods.length]!
    const planned = enrichHistoricalPlannedMetrics(
      scenario,
      period,
      weekIndex,
      plannedMetricsNormalized(scenario, period),
      isForward,
    )
    const imported = byWeek.get(week)
    const actualGenerated = isForward
      ? null
      : buildHistoricalActualMetrics(scenario, period, weekIndex, planned)
    const actual = isForward
      ? imported
        ? withOverrides(emptyMetrics(), imported)
        : null
      : withOverrides(actualGenerated!, imported)
    const shrinkageCategories = buildShrinkageCategories(
      scenario,
      planned.totalShrinkagePct ?? 0,
      isForward ? actual?.totalShrinkagePct ?? null : null,
      weekIndex,
      imported,
      undefined,
      categoryTemplates,
    )

    if (isForward) planCounter += 1
    else actualCounter += 1

    rows.push({
      key: ledgerKey(scenario, week),
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      client: scenario.plan.client,
      location: scenario.plan.location,
      billingType: scenario.plan.billingType,
      weekStart,
      week,
      periodLabel: isForward ? `Plan W${planCounter}` : `Actual W${actualCounter}`,
      timeline: isForward ? 'forward_plan' : 'historical_actual',
      overrideSource: imported ? 'import' : 'generated',
      notes: imported?.notes,
      planned,
      actual,
      shrinkage: imported
        ? buildShrinkageCategories(
            scenario,
            planned.totalShrinkagePct ?? 0,
            actual?.totalShrinkagePct ?? null,
            weekIndex,
            imported,
            undefined,
            categoryTemplates,
          )
        : isForward
          ? buildShrinkageCategories(scenario, planned.totalShrinkagePct ?? 0, null, weekIndex + 100, imported, undefined, categoryTemplates)
          : scaleShrinkageActualTotal(shrinkageCategories, actual?.totalShrinkagePct ?? null),
      actualSupportHcByRole: imported?.supportHcByRole,
    })
    weekIndex += 1
  }

  return rows
}

type SummaryAccumulator = {
  planned: LedgerMetricSnapshot[]
  actual: LedgerMetricSnapshot[]
  rows: WeeklyLedgerRow[]
}

function emptyMetrics(): LedgerMetricSnapshot {
  return {
    callVolume: null,
    handledVolume: null,
    ahtSeconds: null,
    cappedAhtSeconds: null,
    occupancy: null,
    beginningProductionHc: null,
    plannedNewHires: null,
    actualTrainingStartHc: null,
    trainingHc: null,
    nestingHc: null,
    graduateHc: null,
    attritionHc: null,
    attritionPct: null,
    trainingAttritionPct: null,
    nestingAttritionPct: null,
    transferInHc: null,
    transferOutHc: null,
    offRosterLoaHc: null,
    supportHc: null,
    productionHc: null,
    requiredFte: null,
    coreProductionFte: null,
    nestingProductiveFte: null,
    productionFte: null,
    overUnderStaffing: null,
    staffingPct: null,
    totalShrinkagePct: null,
    scheduledBillableHours: null,
    actualBillableHours: null,
    productiveHours: null,
    payrollHours: null,
    switchHours: null,
  }
}

function average(values: (number | null)[]): number | null {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (!filtered.length) return null
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length
}

function sum(values: (number | null)[]): number | null {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (!filtered.length) return null
  return filtered.reduce((s, value) => s + value, 0)
}

function summarizeMetrics(rows: LedgerMetricSnapshot[]): LedgerMetricSnapshot {
  if (!rows.length) return emptyMetrics()
  return {
    callVolume: sum(rows.map((row) => row.callVolume)),
    handledVolume: sum(rows.map((row) => row.handledVolume)),
    ahtSeconds: average(rows.map((row) => row.ahtSeconds)),
    cappedAhtSeconds: average(rows.map((row) => row.cappedAhtSeconds)),
    occupancy: average(rows.map((row) => row.occupancy)),
    beginningProductionHc: rows[0]!.beginningProductionHc,
    plannedNewHires: sum(rows.map((row) => row.plannedNewHires)),
    actualTrainingStartHc: sum(rows.map((row) => row.actualTrainingStartHc)),
    trainingHc: average(rows.map((row) => row.trainingHc)),
    nestingHc: average(rows.map((row) => row.nestingHc)),
    graduateHc: sum(rows.map((row) => row.graduateHc)),
    attritionHc: sum(rows.map((row) => row.attritionHc)),
    attritionPct: average(rows.map((row) => row.attritionPct)),
    trainingAttritionPct: average(rows.map((row) => row.trainingAttritionPct)),
    nestingAttritionPct: average(rows.map((row) => row.nestingAttritionPct)),
    transferInHc: sum(rows.map((row) => row.transferInHc)),
    transferOutHc: sum(rows.map((row) => row.transferOutHc)),
    offRosterLoaHc: sum(rows.map((row) => row.offRosterLoaHc)),
    supportHc: sum(rows.map((row) => row.supportHc)),
    productionHc: rows[rows.length - 1]!.productionHc,
    requiredFte: average(rows.map((row) => row.requiredFte)),
    coreProductionFte: average(rows.map((row) => row.coreProductionFte)),
    nestingProductiveFte: average(rows.map((row) => row.nestingProductiveFte)),
    productionFte: average(rows.map((row) => row.productionFte)),
    overUnderStaffing: average(rows.map((row) => row.overUnderStaffing)),
    staffingPct: average(rows.map((row) => row.staffingPct)),
    totalShrinkagePct: average(rows.map((row) => row.totalShrinkagePct)),
    scheduledBillableHours: sum(rows.map((row) => row.scheduledBillableHours)),
    actualBillableHours: sum(rows.map((row) => row.actualBillableHours)),
    productiveHours: sum(rows.map((row) => row.productiveHours)),
    payrollHours: sum(rows.map((row) => row.payrollHours)),
    switchHours: sum(rows.map((row) => row.switchHours)),
  }
}

export function summarizeWeeklyLedgerRows(rows: WeeklyLedgerRow[], view: WeeklyLedgerView): WeeklyLedgerRow[] {
  if (view === 'weekly') return rows
  const buckets = new Map<string, SummaryAccumulator>()
  for (const row of rows) {
    const date = new Date(row.week + 'T12:00:00')
    const key = view === 'monthly' ? monthShort(date) : quarterLabel(date)
    const bucket = buckets.get(key) ?? { planned: [], actual: [], rows: [] }
    bucket.planned.push(row.planned)
    if (row.actual) bucket.actual.push(row.actual)
    bucket.rows.push(row)
    buckets.set(key, bucket)
  }

  return [...buckets.entries()].map(([label, bucket]) => {
    const first = bucket.rows[0]!
    const last = bucket.rows[bucket.rows.length - 1]!
    return {
      ...first,
      key: `${first.scenarioId}|${label}|${view}`,
      week: label,
      periodLabel: label,
      timeline: bucket.rows.every((row) => row.timeline === 'historical_actual') ? 'historical_actual' : 'forward_plan',
      overrideSource: bucket.rows.some((row) => row.overrideSource === 'import') ? 'import' : 'generated',
      notes: bucket.rows.find((row) => row.notes)?.notes,
      planned: summarizeMetrics(bucket.planned),
      actual: bucket.actual.length ? summarizeMetrics(bucket.actual) : null,
      shrinkage: last.shrinkage,
    }
  })
}

export function normalizeImportedActualOverrides(records: Record<string, unknown>[]): ImportedActualOverride[] {
  const parsed: Array<ImportedActualOverride | null> = records.map((record) => {
      const normalized = Object.fromEntries(Object.entries(record).map(([key, value]) => [normalizeHeader(key), value]))
      const weekRaw = normalized.week ?? normalized.weekstart ?? normalized.weekstartdate ?? normalized.date
      const week = String(weekRaw ?? '').slice(0, 10)
      if (!week) return null
      const metrics: Partial<LedgerMetricSnapshot> = {}
      const shrinkageById: Record<string, number> = {}
      for (const [rawKey, rawValue] of Object.entries(normalized)) {
        if (rawKey === 'week' || rawKey === 'weekstart' || rawKey === 'weekstartdate' || rawKey === 'date' || rawKey === 'notes') {
          continue
        }
        const key = rawKey.replace(/^actual/, '')
        if (key.startsWith('shrinkage') || key.startsWith('shrink')) {
          const shrinkId = key.replace(/^shrinkage/, '').replace(/^shrink/, '')
          const template = SHRINKAGE_CATEGORY_TEMPLATES.find(
            (item) => normalizeHeader(item.id) === shrinkId || normalizeHeader(item.name) === shrinkId,
          )
          if (template) {
            const pct = parsePct(rawValue)
            if (pct != null) shrinkageById[template.id] = pct
          } else if (shrinkId) {
            const pct = parsePct(rawValue)
            if (pct != null) shrinkageById[shrinkId] = pct
          }
          continue
        }
        const target = NUMERIC_OVERRIDE_FIELDS[key]
        if (!target) continue
        const value = target === 'occupancy' || target === 'staffingPct' || target === 'totalShrinkagePct' ? parsePct(rawValue) : parseNumber(rawValue)
        if (value != null) metrics[target] = value
      }
      return {
        week,
        notes: typeof normalized.notes === 'string' ? normalized.notes : undefined,
        metrics,
        shrinkageById: Object.keys(shrinkageById).length ? shrinkageById : undefined,
      }
    })
  return parsed.filter((item): item is ImportedActualOverride => item !== null)
}

export function actualsTemplateRows(weekStart: WeekStart): Array<Record<string, string | number>> {
  const currentStart = startOfWeek(new Date(), weekStart)
  return Array.from({ length: LEDGER_HISTORY_WEEKS }, (_, index) => {
    const week = isoDate(addWeeks(currentStart, index - LEDGER_HISTORY_WEEKS))
    return {
      Week: week,
      Notes: '',
      Volume: '',
      AHT: '',
      Capped_AHT: '',
      Occupancy: '',
      Total_Shrinkage_Pct: '',
      Attrition_HC: '',
      Transfer_In_HC: '',
      Transfer_Out_HC: '',
      Actual_Training_Start_HC: '',
      Production_HC: '',
      Staffing_Pct: '',
      Shrinkage_Absenteeism: '',
      Shrinkage_PTO: '',
      Shrinkage_Break: '',
      Shrinkage_Meeting: '',
      Shrinkage_Training: '',
      Shrinkage_Coaching: '',
      Shrinkage_Floor_Support: '',
    }
  })
}

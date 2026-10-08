import * as XLSX from 'xlsx'
import { coerceImportWeekDate } from './capacityImportWeek'
import { addWeeks, uniqueSortedWeeks } from './capacityWeekUtils'
import type { WeekCapacityPlanOverride } from './capacityPlanOverridePersistence'
import type { ImportedActualOverride, LedgerMetricSnapshot } from './weeklyLedger'
import type { WeekStart } from './types'
import type { CapacityMetricSnapshot, DerivedCapacityRow } from './capacityPlanDerived'

export type ManualInputImportMode = 'overwrite' | 'append'

/** Volume / AHT / Occupancy from a template always replace existing values (even in Append). */
export const TEMPLATE_DRIVER_ALWAYS_OVERWRITE = new Set<keyof LedgerMetricSnapshot>([
  'callVolume',
  'ahtSeconds',
  'cappedAhtSeconds',
  'occupancy',
])

export type ManualInputColumn = {
  /** Exact Excel header */
  header: string
  kind: 'planned' | 'actual'
  metricId?: keyof LedgerMetricSnapshot
  /** Percentage fields are entered as 0–100 in the sheet, stored as 0–1. */
  isPercent?: boolean
  shrinkageId?: string
  supportRoleId?: string
}

export type ManualInputTemplateContext = {
  planStartWeek: string
  weekStart: WeekStart
  weekCount: number
  client: string
  lob: string
  includeRequiredFte: boolean
  shrinkageCategories: Array<{ id: string; name: string }>
  supportRoles: Array<{ id: string; name: string }>
  /** Prefill from current planned overrides (includes drafts when provided by caller). */
  plannedOverrides?: Record<string, WeekCapacityPlanOverride>
  /** Prefill from current actual ledger overrides. */
  actualOverrides?: ImportedActualOverride[]
  /**
   * Extra weeks to include (e.g. matrix display weeks / imported weeks).
   * Always merged with the plan-start horizon and weeks that already have data.
   */
  displayWeeks?: string[]
  /**
   * Matrix-derived Planned/Actual snapshots keyed by week — fills cells when
   * overrides are empty so the download matches what the user sees on screen.
   */
  derivedByWeek?: Record<
    string,
    {
      planned?: WeekCapacityPlanOverride
      actual?: ImportedActualOverride
    }
  >
}

export type ManualInputImportResult = {
  success: boolean
  mode: ManualInputImportMode
  sheetName: string
  weeksApplied: number
  plannedCells: number
  actualCells: number
  skippedRows: number
  errors: string[]
  warnings: string[]
  message: string
  templateWeeks: string[]
  plannedByWeek: Record<string, WeekCapacityPlanOverride>
  actualOverrides: ImportedActualOverride[]
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || trimmed === '—' || trimmed === '-' || trimmed === '–' || trimmed.toLowerCase() === 'n/a') {
      return null
    }
    const cleaned = trimmed.replace(/,/g, '').replace(/%$/, '')
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * This is our own template: the sheet documents a 0–100 scale and formatPrefill writes
 * `value * 100`, so the scale is known and does not need guessing. The old
 * `parsed > 1 ? parsed / 100 : parsed` heuristic broke the round trip — a stored 0.8%
 * was written out as "0.8", read back as 80%, and inflated 100x with no edit to the
 * cell. Raw third-party workbooks still use the heuristic, where intent is unknown.
 * Prefer General/Number cells (85), not Excel Percentage format (0.85 → would become 0.85%).
 */
function parsePct(value: unknown): number | null {
  const parsed = parseNumber(value)
  if (parsed == null) return null
  return parsed / 100
}

function normalizeMetric(metricId: keyof LedgerMetricSnapshot, value: number): number {
  if (metricId === 'occupancy') return Math.max(0, Math.min(0.999, value))
  if (metricId === 'totalShrinkagePct' || metricId === 'attritionPct' || metricId === 'trainingAttritionPct' || metricId === 'nestingAttritionPct') {
    return Math.max(0, Math.min(1.25, value))
  }
  if (
    metricId === 'plannedNewHires' ||
    metricId === 'actualTrainingStartHc' ||
    metricId === 'handledVolume' ||
    metricId === 'callVolume' ||
    metricId.endsWith('Hc')
  ) {
    return Math.round(value)
  }
  return value
}

function formatPrefill(value: number | null | undefined, isPercent?: boolean): string | number {
  if (value == null || Number.isNaN(value)) return ''
  if (isPercent) return Number((value * 100).toFixed(4))
  return value
}

/** Static manual-input columns (no calculated fields). */
export function buildManualInputColumns(options: {
  includeRequiredFte: boolean
  shrinkageCategories: Array<{ id: string; name: string }>
  supportRoles: Array<{ id: string; name: string }>
}): ManualInputColumn[] {
  const columns: ManualInputColumn[] = [
    { header: 'ForecastVolume', kind: 'planned', metricId: 'callVolume' },
    { header: 'PlannedAHT', kind: 'planned', metricId: 'ahtSeconds' },
    { header: 'PlannedCappedAHT', kind: 'planned', metricId: 'cappedAhtSeconds' },
    { header: 'PlannedOccupancy', kind: 'planned', metricId: 'occupancy', isPercent: true },
    { header: 'PlannedAttritionPct', kind: 'planned', metricId: 'attritionPct', isPercent: true },
    { header: 'PlannedTrainingAttritionPct', kind: 'planned', metricId: 'trainingAttritionPct', isPercent: true },
    { header: 'PlannedNestingAttritionPct', kind: 'planned', metricId: 'nestingAttritionPct', isPercent: true },
    { header: 'PlannedNewHires', kind: 'planned', metricId: 'plannedNewHires' },
    { header: 'PlannedGraduateHc', kind: 'planned', metricId: 'graduateHc' },
    { header: 'PlannedTransferIn', kind: 'planned', metricId: 'transferInHc' },
    { header: 'PlannedTransferOut', kind: 'planned', metricId: 'transferOutHc' },
    { header: 'PlannedOffRosterLoaHc', kind: 'planned', metricId: 'offRosterLoaHc' },
    { header: 'PlannedSeats', kind: 'planned', metricId: 'plannedSeats' },
    { header: 'PeakRatio', kind: 'planned', metricId: 'peakRatio' },
    { header: 'ScheduledBillableHours', kind: 'planned', metricId: 'scheduledBillableHours' },
    { header: 'ProductiveHours', kind: 'planned', metricId: 'productiveHours' },
    { header: 'PayrollHours', kind: 'planned', metricId: 'payrollHours' },
    { header: 'SwitchHours', kind: 'planned', metricId: 'switchHours' },
    { header: 'PlannedTotalShrinkagePct', kind: 'planned', metricId: 'totalShrinkagePct', isPercent: true },
  ]

  if (options.includeRequiredFte) {
    columns.unshift({ header: 'RequiredProductionFTE', kind: 'planned', metricId: 'requiredFte' })
  }

  for (const category of options.shrinkageCategories) {
    const safe = category.name.replace(/[^A-Za-z0-9]+/g, '_') || category.id
    columns.push(
      { header: `PlannedShrink_${safe}`, kind: 'planned', shrinkageId: category.id, isPercent: true },
      { header: `ActualShrink_${safe}`, kind: 'actual', shrinkageId: category.id, isPercent: true },
    )
  }

  for (const role of options.supportRoles) {
    const safe = role.name.replace(/[^A-Za-z0-9]+/g, '_') || role.id
    columns.push(
      { header: `PlannedSupport_${safe}`, kind: 'planned', supportRoleId: role.id },
      { header: `ActualSupport_${safe}`, kind: 'actual', supportRoleId: role.id },
    )
  }

  columns.push(
    { header: 'ActualProductionHc', kind: 'actual', metricId: 'productionHc' },
    { header: 'OfferedVolume', kind: 'actual', metricId: 'callVolume' },
    { header: 'HandledVolume', kind: 'actual', metricId: 'handledVolume' },
    { header: 'ActualAHT', kind: 'actual', metricId: 'ahtSeconds' },
    { header: 'ActualOccupancy', kind: 'actual', metricId: 'occupancy', isPercent: true },
    { header: 'ActualTransferIn', kind: 'actual', metricId: 'transferInHc' },
    { header: 'ActualTransferOut', kind: 'actual', metricId: 'transferOutHc' },
    { header: 'ActualTrainingHc', kind: 'actual', metricId: 'trainingHc' },
    { header: 'ActualNestingHc', kind: 'actual', metricId: 'nestingHc' },
    { header: 'ActualOffRosterLoaHc', kind: 'actual', metricId: 'offRosterLoaHc' },
    { header: 'ActualTrainingStartHc', kind: 'actual', metricId: 'actualTrainingStartHc' },
    { header: 'ActualAttritionHc', kind: 'actual', metricId: 'attritionHc' },
    { header: 'ActualBillableHours', kind: 'actual', metricId: 'actualBillableHours' },
    { header: 'ActualProductiveHours', kind: 'actual', metricId: 'productiveHours' },
    { header: 'ActualPayrollHours', kind: 'actual', metricId: 'payrollHours' },
    { header: 'ActualSwitchHours', kind: 'actual', metricId: 'switchHours' },
  )

  return columns
}

function buildHeaderLookup(columns: ManualInputColumn[]): Map<string, ManualInputColumn> {
  const map = new Map<string, ManualInputColumn>()
  for (const column of columns) {
    map.set(normalizeHeader(column.header), column)
  }
  const forecast = columns.find((c) => c.header === 'ForecastVolume')
  if (forecast) {
    map.set('plannedvolume', forecast)
    map.set('callvolume', forecast)
  }
  const required = columns.find((c) => c.metricId === 'requiredFte')
  if (required) {
    map.set('requiredfte', required)
    map.set('requiredproductionfte', required)
  }
  return map
}

function weekHeaders(planStartWeek: string, weekCount: number): string[] {
  const start = new Date(`${planStartWeek}T12:00:00`)
  return Array.from({ length: weekCount }, (_, index) => addWeeks(start, index).toISOString().slice(0, 10))
}

/** Horizon weeks ∪ weeks with planned/actual/display data (sorted). */
export function resolveManualInputTemplateWeeks(context: ManualInputTemplateContext): string[] {
  const planned = context.plannedOverrides ?? {}
  const actualWeeks = (context.actualOverrides ?? []).map((item) => item.week)
  const derivedWeeks = Object.keys(context.derivedByWeek ?? {})
  // Always include the standard historical window before plan start so Actual weeks
  // are never dropped when overrides/derived maps are sparse.
  const historyStart = addWeeks(new Date(`${context.planStartWeek}T12:00:00`), -26)
  const historyWeeks = Array.from({ length: 26 }, (_, index) =>
    addWeeks(historyStart, index).toISOString().slice(0, 10),
  )
  return uniqueSortedWeeks([
    ...historyWeeks,
    ...weekHeaders(context.planStartWeek, context.weekCount),
    ...Object.keys(planned),
    ...actualWeeks,
    ...(context.displayWeeks ?? []),
    ...derivedWeeks,
  ])
}

function coalesceNumber(
  primary: number | null | undefined,
  fallback: number | null | undefined,
): number | null | undefined {
  if (primary != null && Number.isFinite(primary)) return primary
  if (fallback != null && Number.isFinite(fallback)) return fallback
  return primary ?? fallback
}

function mergePlannedPrefill(
  override: WeekCapacityPlanOverride | undefined,
  derived: WeekCapacityPlanOverride | undefined,
): WeekCapacityPlanOverride {
  const out: WeekCapacityPlanOverride = { ...(derived ?? {}) }
  if (!override) return out
  for (const [key, value] of Object.entries(override)) {
    if (key === 'shrinkageById') {
      out.shrinkageById = { ...(out.shrinkageById ?? {}), ...(value as Record<string, number>) }
      continue
    }
    if (key === 'supportHcByRole') {
      out.supportHcByRole = { ...(out.supportHcByRole ?? {}), ...(value as Record<string, number>) }
      continue
    }
    if (value != null && !(typeof value === 'number' && Number.isNaN(value))) {
      ;(out as Record<string, unknown>)[key] = value
    }
  }
  return out
}

function mergeActualPrefill(
  override: ImportedActualOverride | undefined,
  derived: ImportedActualOverride | undefined,
  week: string,
): ImportedActualOverride {
  const metrics: Partial<LedgerMetricSnapshot> = { ...(derived?.metrics ?? {}) }
  for (const [key, value] of Object.entries(override?.metrics ?? {})) {
    if (value != null && Number.isFinite(value as number)) {
      metrics[key as keyof LedgerMetricSnapshot] = value as number
    }
  }
  return {
    week,
    metrics,
    shrinkageById: {
      ...(derived?.shrinkageById ?? {}),
      ...(override?.shrinkageById ?? {}),
    },
    supportHcByRole: {
      ...(derived?.supportHcByRole ?? {}),
      ...(override?.supportHcByRole ?? {}),
    },
    ...(override?.notes || derived?.notes
      ? { notes: override?.notes ?? derived?.notes }
      : {}),
  }
}

export function downloadStaffingManualInputTemplate(context: ManualInputTemplateContext): void {
  const columns = buildManualInputColumns({
    includeRequiredFte: context.includeRequiredFte,
    shrinkageCategories: context.shrinkageCategories,
    supportRoles: context.supportRoles,
  })
  const weeks = resolveManualInputTemplateWeeks(context)
  const planned = context.plannedOverrides ?? {}
  const actualByWeek = new Map((context.actualOverrides ?? []).map((item) => [item.week, item]))
  const derived = context.derivedByWeek ?? {}

  const rows = weeks.map((week, index) => {
    const plannedWeek = mergePlannedPrefill(planned[week], derived[week]?.planned)
    const actualWeek = mergeActualPrefill(actualByWeek.get(week), derived[week]?.actual, week)
    const row: Record<string, string | number> = {
      Week: week,
      WeekNumber: index + 1,
      Client: context.client,
      LOB: context.lob,
    }
    for (const column of columns) {
      if (column.kind === 'planned') {
        if (column.metricId) {
          row[column.header] = formatPrefill(
            coalesceNumber(
              plannedWeek[column.metricId] as number | null | undefined,
              undefined,
            ),
            column.isPercent,
          )
        } else if (column.shrinkageId) {
          row[column.header] = formatPrefill(plannedWeek.shrinkageById?.[column.shrinkageId], column.isPercent)
        } else if (column.supportRoleId) {
          row[column.header] = formatPrefill(plannedWeek.supportHcByRole?.[column.supportRoleId])
        }
      } else {
        if (column.metricId) {
          row[column.header] = formatPrefill(
            actualWeek.metrics?.[column.metricId] as number | null | undefined,
            column.isPercent,
          )
        } else if (column.shrinkageId) {
          row[column.header] = formatPrefill(actualWeek.shrinkageById?.[column.shrinkageId], column.isPercent)
        } else if (column.supportRoleId) {
          row[column.header] = formatPrefill(actualWeek.supportHcByRole?.[column.supportRoleId])
        }
      }
    }
    return row
  })

  const instructions = [
    { Topic: 'Purpose', Detail: 'Prefills current Planned and Actual values for this plan. Edit cells, then upload.' },
    { Topic: 'Week', Detail: 'Use YYYY-MM-DD week-start dates (same as the template). Matching weeks are updated on upload.' },
    { Topic: 'Percents', Detail: 'Enter occupancy / attrition / shrinkage as 0–100 (example: 85 for 85%).' },
    {
      Topic: 'Overwrite mode',
      Detail:
        'For each week present in the file, uploaded Planned fields replace that week’s planned inputs; Actual weeks in the file fully replace existing actuals for those weeks.',
    },
    {
      Topic: 'Append / merge mode',
      Detail:
        'Fills only empty fields. Existing Planned/Actual values are kept, except Volume / AHT / Occupancy which always update from the file.',
    },
    { Topic: 'Actual columns', Detail: 'Use Actual* / OfferedVolume / HandledVolume for historical actual weeks.' },
    { Topic: 'Do not rename', Detail: 'Keep column headers exactly as downloaded so upload can match fields.' },
  ]

  const workbook = XLSX.utils.book_new()
  const dataSheet = XLSX.utils.json_to_sheet(rows)
  const helpSheet = XLSX.utils.json_to_sheet(instructions)
  XLSX.utils.book_append_sheet(workbook, dataSheet, 'Manual_Inputs')
  XLSX.utils.book_append_sheet(workbook, helpSheet, 'README')
  const safeClient = (context.client || 'plan').replace(/[^A-Za-z0-9]+/g, '_').slice(0, 24)
  XLSX.writeFile(workbook, `staffing_manual_inputs_${safeClient}_${context.planStartWeek}.xlsx`)
}

function finiteOrUndef(value: number | null | undefined): number | undefined {
  return value != null && Number.isFinite(value) ? value : undefined
}

/** Map a matrix Planned/Actual snapshot into manual-input override shape for prefill. */
export function capacitySnapshotToPlannedOverride(
  snap: CapacityMetricSnapshot,
  shrinkageById?: Record<string, number>,
): WeekCapacityPlanOverride {
  const out: WeekCapacityPlanOverride = {}
  const volume = finiteOrUndef(snap.volume)
  if (volume != null) out.callVolume = volume
  const aht = finiteOrUndef(snap.ahtSeconds)
  if (aht != null) out.ahtSeconds = aht
  const capped = finiteOrUndef(snap.cappedAhtSeconds)
  if (capped != null) out.cappedAhtSeconds = capped
  const occ = finiteOrUndef(snap.occupancy)
  if (occ != null) out.occupancy = occ
  const attritionPct = finiteOrUndef(snap.attritionPct)
  if (attritionPct != null) out.attritionPct = attritionPct
  const trainingAttritionPct = finiteOrUndef(snap.trainingAttritionPct)
  if (trainingAttritionPct != null) out.trainingAttritionPct = trainingAttritionPct
  const nestingAttritionPct = finiteOrUndef(snap.nestingAttritionPct)
  if (nestingAttritionPct != null) out.nestingAttritionPct = nestingAttritionPct
  const plannedNewHires = finiteOrUndef(snap.plannedNewHires)
  if (plannedNewHires != null) out.plannedNewHires = plannedNewHires
  const graduateHc = finiteOrUndef(snap.graduateHc)
  if (graduateHc != null) out.graduateHc = graduateHc
  const transferInHc = finiteOrUndef(snap.transferInHc)
  if (transferInHc != null) out.transferInHc = transferInHc
  const transferOutHc = finiteOrUndef(snap.transferOutHc)
  if (transferOutHc != null) out.transferOutHc = transferOutHc
  const offRosterLoaHc = finiteOrUndef(snap.offRosterLoaHc)
  if (offRosterLoaHc != null) out.offRosterLoaHc = offRosterLoaHc
  const plannedSeats = finiteOrUndef(snap.plannedSeats)
  if (plannedSeats != null) out.plannedSeats = plannedSeats
  const peakRatio = finiteOrUndef(snap.peakRatio)
  if (peakRatio != null) out.peakRatio = peakRatio
  const scheduledBillableHours = finiteOrUndef(snap.scheduledBillableHours)
  if (scheduledBillableHours != null) out.scheduledBillableHours = scheduledBillableHours
  const productiveHours = finiteOrUndef(snap.productiveHours)
  if (productiveHours != null) out.productiveHours = productiveHours
  const payrollHours = finiteOrUndef(snap.payrollHours)
  if (payrollHours != null) out.payrollHours = payrollHours
  const switchHours = finiteOrUndef(snap.switchHours)
  if (switchHours != null) out.switchHours = switchHours
  const shrinkagePct = finiteOrUndef(snap.shrinkagePct)
  if (shrinkagePct != null) out.totalShrinkagePct = shrinkagePct
  const requiredFte = finiteOrUndef(snap.requiredFte)
  if (requiredFte != null) out.requiredFte = requiredFte
  const productionFte = finiteOrUndef(snap.productionFte)
  if (productionFte != null) out.productionFte = productionFte
  if (snap.supportHcByRole && Object.keys(snap.supportHcByRole).length) {
    out.supportHcByRole = { ...snap.supportHcByRole }
  }
  if (shrinkageById && Object.keys(shrinkageById).length) {
    out.shrinkageById = { ...shrinkageById }
  }
  return out
}

export function capacitySnapshotToActualOverride(
  week: string,
  snap: CapacityMetricSnapshot,
  shrinkageById?: Record<string, number>,
): ImportedActualOverride {
  const metrics: Partial<LedgerMetricSnapshot> = {}
  const productionHc = finiteOrUndef(snap.productionHc)
  if (productionHc != null) metrics.productionHc = productionHc
  const beginningProductionHc = finiteOrUndef(snap.beginningProductionHc)
  if (beginningProductionHc != null) metrics.beginningProductionHc = beginningProductionHc
  const offered = finiteOrUndef(snap.offeredVolume) ?? finiteOrUndef(snap.volume)
  if (offered != null) metrics.callVolume = offered
  const handled = finiteOrUndef(snap.handledVolume)
  if (handled != null) metrics.handledVolume = handled
  const aht = finiteOrUndef(snap.ahtSeconds)
  if (aht != null) metrics.ahtSeconds = aht
  const capped = finiteOrUndef(snap.cappedAhtSeconds)
  if (capped != null) metrics.cappedAhtSeconds = capped
  const occ = finiteOrUndef(snap.occupancy)
  if (occ != null && occ > 0) metrics.occupancy = occ
  const transferInHc = finiteOrUndef(snap.transferInHc)
  if (transferInHc != null) metrics.transferInHc = transferInHc
  const transferOutHc = finiteOrUndef(snap.transferOutHc)
  if (transferOutHc != null) metrics.transferOutHc = transferOutHc
  const trainingHc = finiteOrUndef(snap.trainingHc)
  if (trainingHc != null) metrics.trainingHc = trainingHc
  const nestingHc = finiteOrUndef(snap.nestingHc)
  if (nestingHc != null) metrics.nestingHc = nestingHc
  const graduateHc = finiteOrUndef(snap.graduateHc)
  if (graduateHc != null) metrics.graduateHc = graduateHc
  const offRosterLoaHc = finiteOrUndef(snap.offRosterLoaHc)
  if (offRosterLoaHc != null) metrics.offRosterLoaHc = offRosterLoaHc
  const actualTrainingStartHc = finiteOrUndef(snap.actualTrainingStartHc)
  if (actualTrainingStartHc != null) metrics.actualTrainingStartHc = actualTrainingStartHc
  const attritionHc = finiteOrUndef(snap.attritionHc)
  if (attritionHc != null) metrics.attritionHc = attritionHc
  const attritionPct = finiteOrUndef(snap.attritionPct)
  if (attritionPct != null) metrics.attritionPct = attritionPct
  const supportHc = finiteOrUndef(snap.supportHc)
  if (supportHc != null) metrics.supportHc = supportHc
  const actualBillableHours = finiteOrUndef(snap.actualBillableHours)
  if (actualBillableHours != null) metrics.actualBillableHours = actualBillableHours
  const productiveHours = finiteOrUndef(snap.productiveHours)
  if (productiveHours != null) metrics.productiveHours = productiveHours
  const payrollHours = finiteOrUndef(snap.payrollHours)
  if (payrollHours != null) metrics.payrollHours = payrollHours
  const switchHours = finiteOrUndef(snap.switchHours)
  if (switchHours != null) metrics.switchHours = switchHours
  const shrinkagePct = finiteOrUndef(snap.shrinkagePct)
  if (shrinkagePct != null) metrics.totalShrinkagePct = shrinkagePct
  return {
    week,
    metrics,
    ...(shrinkageById && Object.keys(shrinkageById).length ? { shrinkageById } : {}),
    ...(snap.supportHcByRole && Object.keys(snap.supportHcByRole).length
      ? { supportHcByRole: { ...snap.supportHcByRole } }
      : {}),
  }
}

/** Build derivedByWeek prefill map from matrix rows for the active selection. */
export function buildDerivedPrefillByWeek(
  rows: DerivedCapacityRow[],
): NonNullable<ManualInputTemplateContext['derivedByWeek']> {
  const out: NonNullable<ManualInputTemplateContext['derivedByWeek']> = {}
  for (const row of rows) {
    const plannedShrink: Record<string, number> = {}
    const actualShrink: Record<string, number> = {}
    for (const cat of row.shrinkageCategories ?? []) {
      if (cat.plannedPct != null && Number.isFinite(cat.plannedPct)) plannedShrink[cat.id] = cat.plannedPct
      if (cat.actualPct != null && Number.isFinite(cat.actualPct)) actualShrink[cat.id] = cat.actualPct
    }
    out[row.week] = {
      planned: capacitySnapshotToPlannedOverride(row.planned, plannedShrink),
      actual: capacitySnapshotToActualOverride(row.week, row.actual, actualShrink),
    }
  }
  return out
}

/**
 * Merge stored actual overrides with matrix-derived Actual weeks so download
 * includes every Actual week the user sees (not only sparse override keys).
 */
export function buildDownloadActualOverrides(
  rows: DerivedCapacityRow[],
  stored: ImportedActualOverride[],
): ImportedActualOverride[] {
  const byWeek = new Map<string, ImportedActualOverride>()
  for (const item of stored) {
    byWeek.set(item.week, item)
  }
  for (const row of rows) {
    const isActualWeek =
      row.statusLabel === 'Actual' || row.timeline === 'historical_actual'
    if (!isActualWeek) continue
    const plannedShrink: Record<string, number> = {}
    const actualShrink: Record<string, number> = {}
    for (const cat of row.shrinkageCategories ?? []) {
      if (cat.plannedPct != null && Number.isFinite(cat.plannedPct)) plannedShrink[cat.id] = cat.plannedPct
      if (cat.actualPct != null && Number.isFinite(cat.actualPct)) actualShrink[cat.id] = cat.actualPct
    }
    void plannedShrink
    const derived = capacitySnapshotToActualOverride(row.week, row.actual, actualShrink)
    byWeek.set(row.week, mergeActualPrefill(byWeek.get(row.week), derived, row.week))
  }
  return [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week))
}

function ensureWeekOverride(
  target: Record<string, WeekCapacityPlanOverride>,
  week: string,
): WeekCapacityPlanOverride {
  if (!target[week]) target[week] = {}
  return target[week]!
}

function ensureActualOverride(
  target: Map<string, ImportedActualOverride>,
  week: string,
): ImportedActualOverride {
  const existing = target.get(week)
  if (existing) return existing
  const created: ImportedActualOverride = { week, metrics: {} }
  target.set(week, created)
  return created
}

function applyColumnValue(
  column: ManualInputColumn,
  raw: unknown,
  plannedByWeek: Record<string, WeekCapacityPlanOverride>,
  actualByWeek: Map<string, ImportedActualOverride>,
  week: string,
  counters: { plannedCells: number; actualCells: number },
): void {
  const parsed = column.isPercent ? parsePct(raw) : parseNumber(raw)
  if (parsed == null) return
  const value = column.metricId ? normalizeMetric(column.metricId, parsed) : parsed

  if (column.kind === 'planned') {
    const weekOverride = ensureWeekOverride(plannedByWeek, week)
    if (column.metricId) {
      ;(weekOverride as Record<string, unknown>)[column.metricId] = value
      counters.plannedCells += 1
      return
    }
    if (column.shrinkageId) {
      weekOverride.shrinkageById = { ...(weekOverride.shrinkageById ?? {}), [column.shrinkageId]: value }
      counters.plannedCells += 1
      return
    }
    if (column.supportRoleId) {
      weekOverride.supportHcByRole = { ...(weekOverride.supportHcByRole ?? {}), [column.supportRoleId]: value }
      counters.plannedCells += 1
    }
    return
  }

  const actual = ensureActualOverride(actualByWeek, week)
  if (column.metricId) {
    actual.metrics = { ...actual.metrics, [column.metricId]: value }
    counters.actualCells += 1
    return
  }
  if (column.shrinkageId) {
    actual.shrinkageById = { ...(actual.shrinkageById ?? {}), [column.shrinkageId]: value }
    counters.actualCells += 1
    return
  }
  if (column.supportRoleId) {
    actual.supportHcByRole = { ...(actual.supportHcByRole ?? {}), [column.supportRoleId]: value }
    counters.actualCells += 1
  }
}

/** Detect whether a workbook/CSV is our manual-inputs template (or compatible week+columns sheet). */
export function isManualInputWorkbook(workbook: XLSX.WorkBook): boolean {
  const preferred = workbook.SheetNames.find((name) => normalizeHeader(name) === 'manualinputs')
  const names = preferred ? [preferred, ...workbook.SheetNames] : workbook.SheetNames
  for (const name of names) {
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true })
    if (!rows.length) continue
    const headers = Object.keys(rows[0] ?? {}).map(normalizeHeader)
    const hasWeek = headers.includes('week')
    const hasManual =
      headers.includes('forecastvolume') ||
      headers.includes('plannedaht') ||
      headers.includes('requiredproductionfte') ||
      headers.includes('actualproductionhc') ||
      headers.some((h) => h.startsWith('plannedshrink') || h.startsWith('plannedsupport'))
    if (hasWeek && hasManual) return true
  }
  return false
}

export async function parseStaffingManualInputFile(
  file: File,
  options: {
    mode: ManualInputImportMode
    weekStart: WeekStart
    includeRequiredFte: boolean
    shrinkageCategories: Array<{ id: string; name: string }>
    supportRoles: Array<{ id: string; name: string }>
    /** Existing planned values — used for append skip. */
    existingPlanned?: Record<string, WeekCapacityPlanOverride>
    existingActual?: ImportedActualOverride[]
  },
): Promise<ManualInputImportResult> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  return parseStaffingManualInputWorkbook(workbook, options)
}

export function parseStaffingManualInputWorkbook(
  workbook: XLSX.WorkBook,
  options: {
    mode: ManualInputImportMode
    weekStart: WeekStart
    includeRequiredFte: boolean
    shrinkageCategories: Array<{ id: string; name: string }>
    supportRoles: Array<{ id: string; name: string }>
    existingPlanned?: Record<string, WeekCapacityPlanOverride>
    existingActual?: ImportedActualOverride[]
  },
): ManualInputImportResult {
  const columns = buildManualInputColumns({
    includeRequiredFte: options.includeRequiredFte,
    shrinkageCategories: options.shrinkageCategories,
    supportRoles: options.supportRoles,
  })
  const lookup = buildHeaderLookup(columns)

  const preferred = workbook.SheetNames.find((name) => normalizeHeader(name) === 'manualinputs')
  const orderedNames = preferred ? [preferred, ...workbook.SheetNames.filter((n) => n !== preferred)] : workbook.SheetNames

  let sheetName = ''
  let rows: Record<string, unknown>[] = []
  for (const name of orderedNames) {
    if (normalizeHeader(name) === 'readme') continue
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    const candidate = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true })
    if (!candidate.length) continue
    const headers = Object.keys(candidate[0] ?? {})
    if (!headers.some((h) => normalizeHeader(h) === 'week')) continue
    sheetName = name
    rows = candidate
    break
  }

  if (!rows.length) {
    return {
      success: false,
      mode: options.mode,
      sheetName: '',
      weeksApplied: 0,
      plannedCells: 0,
      actualCells: 0,
      skippedRows: 0,
      errors: ['No Manual_Inputs sheet with a Week column was found.'],
      warnings: [],
      message: 'Upload failed.',
      templateWeeks: [],
      plannedByWeek: {},
      actualOverrides: [],
    }
  }

  const plannedByWeek: Record<string, WeekCapacityPlanOverride> = {}
  const actualMap = new Map<string, ImportedActualOverride>()
  const templateWeeks: string[] = []
  const counters = { plannedCells: 0, actualCells: 0 }
  let skippedRows = 0
  const warnings: string[] = []
  const unknownHeaders = new Set<string>()

  for (const record of rows) {
    const weekRaw = record.Week ?? record.week ?? record.WEEK
    const week = coerceImportWeekDate(weekRaw)
    if (!week) {
      skippedRows += 1
      continue
    }
    templateWeeks.push(week)

    for (const [header, raw] of Object.entries(record)) {
      const normalized = normalizeHeader(header)
      if (normalized === 'week' || normalized === 'weeknumber' || normalized === 'client' || normalized === 'lob') continue
      const column = lookup.get(normalized)
      if (!column) {
        if (raw !== '' && raw != null) unknownHeaders.add(header)
        continue
      }
      applyColumnValue(column, raw, plannedByWeek, actualMap, week, counters)
    }
  }

  // Append mode: drop values that already exist.
  if (options.mode === 'append') {
    const existingPlanned = options.existingPlanned ?? {}
    const existingActual = new Map((options.existingActual ?? []).map((item) => [item.week, item]))

    for (const [week, patch] of Object.entries(plannedByWeek)) {
      const existing = existingPlanned[week] ?? {}
      const next: WeekCapacityPlanOverride = {}
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'shrinkageById') {
          const merged: Record<string, number> = {}
          for (const [id, pct] of Object.entries((value as Record<string, number>) ?? {})) {
            if (existing.shrinkageById?.[id] == null) merged[id] = pct
          }
          if (Object.keys(merged).length) next.shrinkageById = merged
          continue
        }
        if (key === 'supportHcByRole') {
          const merged: Record<string, number> = {}
          for (const [id, hc] of Object.entries((value as Record<string, number>) ?? {})) {
            if (existing.supportHcByRole?.[id] == null) merged[id] = hc
          }
          if (Object.keys(merged).length) next.supportHcByRole = merged
          continue
        }
        const metricId = key as keyof LedgerMetricSnapshot
        if (existing[metricId] != null && !TEMPLATE_DRIVER_ALWAYS_OVERWRITE.has(metricId)) continue
        ;(next as Record<string, unknown>)[metricId] = value
      }
      if (Object.keys(next).length) plannedByWeek[week] = next
      else delete plannedByWeek[week]
    }

    for (const [week, override] of [...actualMap.entries()]) {
      const existing = existingActual.get(week)
      const metrics: Partial<LedgerMetricSnapshot> = {}
      for (const [key, value] of Object.entries(override.metrics ?? {})) {
        const metricId = key as keyof LedgerMetricSnapshot
        if (existing?.metrics?.[metricId] != null) continue
        metrics[metricId] = value as number
      }
      const shrinkageById: Record<string, number> = {}
      for (const [id, pct] of Object.entries(override.shrinkageById ?? {})) {
        if (existing?.shrinkageById?.[id] != null) continue
        shrinkageById[id] = pct
      }
      const supportHcByRole: Record<string, number> = {}
      for (const [id, hc] of Object.entries(override.supportHcByRole ?? {})) {
        if (existing?.supportHcByRole?.[id] != null) continue
        supportHcByRole[id] = hc
      }
      if (!Object.keys(metrics).length && !Object.keys(shrinkageById).length && !Object.keys(supportHcByRole).length) {
        actualMap.delete(week)
        continue
      }
      actualMap.set(week, {
        week,
        metrics,
        ...(Object.keys(shrinkageById).length ? { shrinkageById } : {}),
        ...(Object.keys(supportHcByRole).length ? { supportHcByRole } : {}),
      })
    }
  }

  if (unknownHeaders.size) {
    warnings.push(`Ignored unrecognized columns: ${[...unknownHeaders].slice(0, 8).join(', ')}.`)
  }

  // Fill Required Production FTE from Volume × AHT ÷ (hours × occupancy) when not in the sheet.
  for (const [week, patch] of Object.entries(plannedByWeek)) {
    if (patch.requiredFte != null && Number.isFinite(patch.requiredFte)) continue
    const volume = patch.callVolume
    const aht = patch.ahtSeconds
    const occ = patch.occupancy
    if (volume == null || aht == null || occ == null) continue
    if (!(volume > 0) || !(aht > 0) || !(occ > 0)) continue
    const required = (volume * aht) / (40 * 3600 * occ)
    if (Number.isFinite(required) && required >= 0) {
      plannedByWeek[week] = { ...patch, requiredFte: required }
    }
  }

  const weeks = uniqueSortedWeeks(templateWeeks)
  const actualOverrides = [...actualMap.values()].sort((a, b) => a.week.localeCompare(b.week))
  const weeksApplied = uniqueSortedWeeks([...Object.keys(plannedByWeek), ...actualOverrides.map((item) => item.week)]).length
  const success = weeksApplied > 0

  return {
    success,
    mode: options.mode,
    sheetName,
    weeksApplied,
    plannedCells: counters.plannedCells,
    actualCells: counters.actualCells,
    skippedRows,
    errors: success ? [] : ['No manual input values were found for any week.'],
    warnings,
    message: success
      ? `Applied ${weeksApplied} week${weeksApplied === 1 ? '' : 's'} (${counters.plannedCells} planned, ${counters.actualCells} actual cells).`
      : 'Upload failed.',
    templateWeeks: weeks,
    plannedByWeek,
    actualOverrides,
  }
}

import * as XLSX from 'xlsx'
import { coerceImportWeekDate } from './capacityImportWeek'
import type { WeekCapacityPlanOverride } from './capacityPlanOverridePersistence'
import type { ImportedActualOverride, LedgerMetricSnapshot } from './weeklyLedger'
import { uniqueSortedWeeks } from './capacityWeekUtils'
import { normalizeImportedActualOverrides } from './weeklyLedger'

export type CapacityWorkbookImportResult = {
  success: boolean
  sheetName: string
  plannedCells: number
  actualRows: number
  skippedRows: number
  unknownWeeks: string[]
  templateWeeks: string[]
  errors: string[]
  warnings: string[]
  message: string
  plannedByWeek: Record<string, WeekCapacityPlanOverride>
  /** Driver fields present in the upload — Capacity should pin these to manual mode. */
  uploadedDriverMetricIds: string[]
  actualOverrides: ImportedActualOverride[]
}

/** Forecast/Capacity driver keys that should switch to manual after a template upload. */
export const CAPACITY_TEMPLATE_DRIVER_METRIC_IDS = [
  'callVolume',
  'ahtSeconds',
  'occupancy',
  'totalShrinkagePct',
  'attritionHc',
] as const

export type CapacityWorkbookImportOptions = {
  /** When true, import rows even if the week is not in the current ledger. */
  acceptUnknownWeeks?: boolean
}

/** Full-workbook Planned_* columns → override keys used by deriveCapacityPlanRows. */
const PLANNED_COLUMN_MAP: Partial<Record<string, keyof LedgerMetricSnapshot>> = {
  plannedvolume: 'callVolume',
  plannedcallvolume: 'callVolume',
  forecastvolume: 'callVolume',
  forecastcontacts: 'callVolume',
  forecastchats: 'callVolume',
  forecastemails: 'callVolume',
  forecastconversations: 'callVolume',
  forecastmessages: 'callVolume',
  forecasttransactions: 'callVolume',
  forecastsessions: 'callVolume',
  callvolume: 'callVolume',
  volume: 'callVolume',
  plannedtransactions: 'handledVolume',
  transactions: 'handledVolume',
  plannedhandledvolume: 'handledVolume',
  handledvolume: 'handledVolume',
  plannedaht: 'ahtSeconds',
  plannedahtseconds: 'ahtSeconds',
  aht: 'ahtSeconds',
  ahtseconds: 'ahtSeconds',
  chataht: 'ahtSeconds',
  averagesessiontime: 'ahtSeconds',
  averageprocessingtime: 'ahtSeconds',
  plannedcappedaht: 'cappedAhtSeconds',
  plannedcappedahtseconds: 'cappedAhtSeconds',
  plannedoccupancy: 'occupancy',
  occupancy: 'occupancy',
  utilization: 'occupancy',
  productivity: 'occupancy',
  chatoccupancy: 'occupancy',
  plannedshrinkagepct: 'totalShrinkagePct',
  plannedshrinkage: 'totalShrinkagePct',
  totalshrinkagepct: 'totalShrinkagePct',
  plannednewhires: 'plannedNewHires',
  plannednewhire: 'plannedNewHires',
  plannedtraininghc: 'trainingHc',
  plannednestinghc: 'nestingHc',
  plannedgraduatehc: 'graduateHc',
  graduatehc: 'graduateHc',
  plannedattritionhc: 'attritionHc',
  plannedproductionhcattrition: 'attritionHc',
  plannedattritionpct: 'attritionPct',
  plannedtransferinhc: 'transferInHc',
  plannedtransferouthc: 'transferOutHc',
  plannedoffrosterloahc: 'offRosterLoaHc',
  plannedoffrosterloa: 'offRosterLoaHc',
  plannedbeginningproductionhc: 'beginningProductionHc',
  beginningproductionhc: 'beginningProductionHc',
  plannedproductionhc: 'productionHc',
  productionhc: 'productionHc',
  plannedsupporthc: 'supportHc',
  supporthc: 'supportHc',
  plannedrequiredfte: 'requiredFte',
  requiredfte: 'requiredFte',
  requiredproductionfte: 'requiredFte',
  productionrequiredfte: 'requiredFte',
  plannedproductionfte: 'productionFte',
  plannedstaffingpct: 'staffingPct',
  plannedtrainingattritionpct: 'trainingAttritionPct',
  trainingattritionpct: 'trainingAttritionPct',
  plannednestingattritionpct: 'nestingAttritionPct',
  nestingattritionpct: 'nestingAttritionPct',
  scheduledbillablehours: 'scheduledBillableHours',
  plannedscheduledbillablehours: 'scheduledBillableHours',
  productivehours: 'productiveHours',
  plannedproductivehours: 'productiveHours',
  payrollhours: 'payrollHours',
  plannedpayrollhours: 'payrollHours',
  switchhours: 'switchHours',
  plannedswitchhours: 'switchHours',
  seatcount: 'seatCount',
  plannedseatcount: 'seatCount',
  numberofseats: 'seatCount',
  peakratiopct: 'peakRatioPct',
  plannedpeakratiopct: 'peakRatioPct',
}

/** Matrix Metric_Id / label → planned override keys. */
const MATRIX_METRIC_ID_MAP: Partial<Record<string, keyof LedgerMetricSnapshot>> = {
  callvolume: 'callVolume',
  ahtseconds: 'ahtSeconds',
  cappedahtseconds: 'cappedAhtSeconds',
  occupancy: 'occupancy',
  totalshrinkagepct: 'totalShrinkagePct',
  requiredfte: 'requiredFte',
  requiredproductionfte: 'requiredFte',
  requiredstaffing: 'requiredFte',
  plannednewhires: 'plannedNewHires',
  transferinhc: 'transferInHc',
  transferouthc: 'transferOutHc',
  attritionhc: 'attritionHc',
  attritionpct: 'attritionPct',
  trainingattritionpct: 'trainingAttritionPct',
  nestingattritionpct: 'nestingAttritionPct',
  graduatehc: 'graduateHc',
  offrosterloahc: 'offRosterLoaHc',
  beginningproductionhc: 'beginningProductionHc',
  productionhc: 'productionHc',
  productionfte: 'productionFte',
  production: 'productionFte',
  productionfteoverride: 'productionFte',
  supporthc: 'supportHc',
  handledvolume: 'handledVolume',
  traininghc: 'trainingHc',
  nestinghc: 'nestingHc',
  scheduledbillablehours: 'scheduledBillableHours',
  productivehours: 'productiveHours',
  payrollhours: 'payrollHours',
  switchhours: 'switchHours',
  seatcount: 'seatCount',
  peakratiopct: 'peakRatioPct',
}

/** Matrix display labels → planned override keys. */
const MATRIX_METRIC_LABEL_MAP: Record<string, keyof LedgerMetricSnapshot> = {
  requiredproductionfte: 'requiredFte',
  requiredfte: 'requiredFte',
  requiredstaffing: 'requiredFte',
  requiredstaffingfte: 'requiredFte',
  production: 'productionFte',
  productionfte: 'productionFte',
  productionhc: 'productionHc',
  actualproductionhc: 'productionHc',
  plannedproductionhc: 'productionHc',
  forecastvolume: 'callVolume',
  forecastcontacts: 'callVolume',
  forecastchats: 'callVolume',
  forecastemails: 'callVolume',
  forecastconversations: 'callVolume',
  forecastmessages: 'callVolume',
  forecasttransactions: 'callVolume',
  forecastsessions: 'callVolume',
  plannedaht: 'ahtSeconds',
  chataht: 'ahtSeconds',
  averagesessiontime: 'ahtSeconds',
  averageprocessingtime: 'ahtSeconds',
  plannedcappedaht: 'cappedAhtSeconds',
  plannedoccupancy: 'occupancy',
  utilization: 'occupancy',
  productivity: 'occupancy',
  chatoccupancy: 'occupancy',
  plannedshrinkage: 'totalShrinkagePct',
  plannedshrinkagepct: 'totalShrinkagePct',
  plannedtransferin: 'transferInHc',
  plannedtransferinhc: 'transferInHc',
  plannedtransferout: 'transferOutHc',
  plannedtransferouthc: 'transferOutHc',
  plannedattritionpct: 'attritionPct',
  plannedattrition: 'attritionPct',
  plannedproductionhcattrition: 'attritionHc',
  plannedattritionhc: 'attritionHc',
  plannednewhire: 'plannedNewHires',
  plannednewhires: 'plannedNewHires',
  beginningproductionhc: 'beginningProductionHc',
  plannedgraduatehc: 'graduateHc',
  graduatehc: 'graduateHc',
  plannedtraininghc: 'trainingHc',
  plannednestinghc: 'nestingHc',
  plannedoffrosterloa: 'offRosterLoaHc',
  plannedoffrosterloahc: 'offRosterLoaHc',
  plannedsupporthc: 'supportHc',
  transactions: 'handledVolume',
  handledvolume: 'handledVolume',
  plannedtrainingattritionpct: 'trainingAttritionPct',
  plannednestingattritionpct: 'nestingAttritionPct',
  scheduledbillablehours: 'scheduledBillableHours',
  productivehours: 'productiveHours',
  payrollhours: 'payrollHours',
  switchhours: 'switchHours',
  numberofseats: 'seatCount',
  peakratiopct: 'peakRatioPct',
  peakratio: 'peakRatioPct',
}

/** Metrics that should land in actual overrides when the week Status is Actual. */
const MATRIX_ACTUAL_IMPORT_METRICS = new Set<keyof LedgerMetricSnapshot>([
  'productionHc',
  'productionFte',
  'callVolume',
  'handledVolume',
  'ahtSeconds',
  'cappedAhtSeconds',
  'occupancy',
  'totalShrinkagePct',
  'attritionHc',
  'attritionPct',
  'transferInHc',
  'transferOutHc',
  'offRosterLoaHc',
  'supportHc',
  'trainingHc',
  'nestingHc',
  'graduateHc',
  'beginningProductionHc',
  'actualTrainingStartHc',
  'requiredFte',
  'scheduledBillableHours',
  'productiveHours',
  'payrollHours',
  'switchHours',
  'seatCount',
  'peakRatioPct',
])

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

function parsePct(value: unknown): number | null {
  const parsed = parseNumber(value)
  if (parsed == null) return null
  return parsed > 1 ? parsed / 100 : parsed
}

function normalizeMetricInput(metricId: keyof LedgerMetricSnapshot, value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  if (metricId === 'occupancy') return Math.max(0, Math.min(0.999, value))
  if (metricId === 'totalShrinkagePct') return Math.max(0, Math.min(1.25, value))
  if (metricId === 'attritionPct' || metricId === 'trainingAttritionPct' || metricId === 'nestingAttritionPct') {
    return Math.max(0, Math.min(1, value))
  }
  if (metricId === 'staffingPct' || metricId === 'peakRatioPct') return Math.max(0, Math.min(2, value))
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

function isPctMetric(metricId: keyof LedgerMetricSnapshot): boolean {
  return (
    metricId === 'occupancy' ||
    metricId === 'totalShrinkagePct' ||
    metricId === 'staffingPct' ||
    metricId === 'attritionPct' ||
    metricId === 'trainingAttritionPct' ||
    metricId === 'nestingAttritionPct' ||
    metricId === 'peakRatioPct'
  )
}

function recordHasWeekColumn(rows: Record<string, unknown>[]): boolean {
  return rows.some((row) => {
    const weekValue = row.Week ?? row.week ?? row.WEEK
    return Boolean(coerceImportWeekDate(weekValue))
  })
}

function headerLooksLikeMetricColumn(normalized: string): boolean {
  return (
    normalized === 'metric' ||
    normalized === 'metricid' ||
    normalized === 'metricstatus' ||
    normalized === 'metriclabel' ||
    normalized === 'metricname' ||
    normalized === 'status'
  )
}

function isMatrixSheet(rows: Record<string, unknown>[]): boolean {
  if (!rows.length) return false
  const headers = Object.keys(rows[0] ?? {}).map(normalizeHeader)
  const hasMetric = headers.some(headerLooksLikeMetricColumn)
  const weekHeaders = Object.keys(rows[0] ?? {}).filter((header) => coerceImportWeekDate(header))
  return hasMetric && weekHeaders.length >= 1
}

function readMatrixMetricLabel(record: Record<string, unknown>): string {
  const direct =
    record.Metric ??
    record.metric ??
    record['Metric Status'] ??
    record['Metric_Status'] ??
    record.MetricStatus ??
    record['Metric Label'] ??
    record.MetricLabel ??
    record['Metric Name'] ??
    record.MetricName
  if (direct != null && String(direct).trim()) return String(direct).trim()
  // Fallback: any column whose header normalizes to a metric label alias.
  for (const [key, value] of Object.entries(record)) {
    const normalized = normalizeHeader(key)
    if (
      normalized === 'metric' ||
      normalized === 'metricstatus' ||
      normalized === 'metriclabel' ||
      normalized === 'metricname'
    ) {
      const text = String(value ?? '').trim()
      if (text) return text
    }
  }
  return ''
}

function pickCapacitySheet(workbook: XLSX.WorkBook): { name: string; sheet: XLSX.WorkSheet; kind: 'plan' | 'matrix' } | null {
  const preferred = workbook.SheetNames.find((name) => normalizeHeader(name) === 'capacityplan')
  if (preferred) {
    const sheet = workbook.Sheets[preferred]
    if (sheet) {
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true })
      if (recordHasWeekColumn(rows)) return { name: preferred, sheet, kind: 'plan' }
    }
  }

  const matrixPreferred = workbook.SheetNames.find((name) => normalizeHeader(name) === 'capacitymatrix')
  if (matrixPreferred) {
    const sheet = workbook.Sheets[matrixPreferred]
    if (sheet) {
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true })
      if (isMatrixSheet(rows)) return { name: matrixPreferred, sheet, kind: 'matrix' }
    }
  }

  for (const name of workbook.SheetNames) {
    if (normalizeHeader(name) === 'instructions' || normalizeHeader(name) === 'exportinfo' || normalizeHeader(name) === 'scenario') {
      continue
    }
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true })
    if (recordHasWeekColumn(rows)) return { name, sheet, kind: 'plan' }
    if (isMatrixSheet(rows)) return { name, sheet, kind: 'matrix' }
  }
  return null
}

/** Detect Capacity_Plan / Capacity_Matrix workbooks so other upload panels can route correctly. */
export function detectCapacityWorkbookKind(workbook: XLSX.WorkBook): 'plan' | 'matrix' | null {
  return pickCapacitySheet(workbook)?.kind ?? null
}

function weekKey(value: unknown): string {
  return coerceImportWeekDate(value)
}

const SHRINKAGE_METRIC_ID_PREFIX = 'shrinkage:'

function parseShrinkageMetricId(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed.toLowerCase().startsWith(SHRINKAGE_METRIC_ID_PREFIX)) return null
  const categoryId = trimmed.slice(SHRINKAGE_METRIC_ID_PREFIX.length).trim()
  return categoryId || null
}

function resolveMatrixMetricId(record: Record<string, unknown>): keyof LedgerMetricSnapshot | null {
  const metricIdRaw = String(record.Metric_Id ?? record.metric_id ?? record.MetricId ?? '').trim()
  if (metricIdRaw) {
    if (parseShrinkageMetricId(metricIdRaw)) return null
    const fromId = MATRIX_METRIC_ID_MAP[normalizeHeader(metricIdRaw)]
    if (fromId) return fromId
    // Accept camelCase override keys directly (e.g. callVolume).
    if (
      metricIdRaw in MATRIX_METRIC_ID_MAP ||
      /^(callVolume|ahtSeconds|occupancy|requiredFte|productionFte|plannedNewHires|transferInHc|transferOutHc|attritionHc|attritionPct|graduateHc|offRosterLoaHc|beginningProductionHc|productionHc|supportHc|handledVolume|totalShrinkagePct|cappedAhtSeconds|trainingAttritionPct|nestingAttritionPct|scheduledBillableHours|productiveHours|payrollHours|switchHours|seatCount|peakRatioPct|trainingHc|nestingHc)$/.test(
        metricIdRaw,
      )
    ) {
      return metricIdRaw as keyof LedgerMetricSnapshot
    }
  }

  const metricLabel = readMatrixMetricLabel(record)
  if (!metricLabel) return null
  const normalizedLabel = normalizeHeader(metricLabel)
  if (
    normalizedLabel === 'status' ||
    normalizedLabel === 'ftevariance' ||
    normalizedLabel === 'staffing' ||
    normalizedLabel === 'staffingpct' ||
    normalizedLabel.endsWith('variance') ||
    (normalizedLabel.startsWith('actual') && normalizedLabel !== 'actualproductionhc')
  ) {
    return null
  }
  return MATRIX_METRIC_LABEL_MAP[normalizedLabel] ?? null
}

function mergeWeekOverride(
  target: Record<string, WeekCapacityPlanOverride>,
  week: string,
  patch: WeekCapacityPlanOverride,
): void {
  const existing = target[week] ?? {}
  const next: WeekCapacityPlanOverride = { ...existing, ...patch }
  if (patch.shrinkageById) {
    next.shrinkageById = { ...(existing.shrinkageById ?? {}), ...patch.shrinkageById }
  }
  target[week] = next
}

function collectUploadedDriverMetricIds(plannedByWeek: Record<string, WeekCapacityPlanOverride>): string[] {
  const found = new Set<string>()
  for (const week of Object.values(plannedByWeek)) {
    for (const [key, value] of Object.entries(week)) {
      if (key === 'shrinkageById') {
        if (value && typeof value === 'object') {
          found.add('totalShrinkagePct')
          for (const categoryId of Object.keys(value as Record<string, number>)) found.add(categoryId)
        }
        continue
      }
      if (value != null && typeof value === 'number' && Number.isFinite(value)) {
        found.add(key)
      }
    }
  }
  return [...found]
}

function parsePlanRows(
  rows: Record<string, unknown>[],
  knownWeekSet: Set<string>,
  acceptUnknownWeeks: boolean,
): {
  plannedByWeek: Record<string, WeekCapacityPlanOverride>
  plannedCells: number
  skippedRows: number
  unknownWeeks: string[]
  templateWeeksCollected: string[]
} {
  const plannedByWeek: Record<string, WeekCapacityPlanOverride> = {}
  const unknownWeeks: string[] = []
  const templateWeeksCollected: string[] = []
  let plannedCells = 0
  let skippedRows = 0

  rows.forEach((record) => {
    const week = weekKey(record.Week ?? record.week ?? record.WEEK)
    if (!week) {
      skippedRows += 1
      return
    }
    templateWeeksCollected.push(week)

    const isUnknown = knownWeekSet.size > 0 && !knownWeekSet.has(week)
    if (isUnknown && !acceptUnknownWeeks) {
      if (!unknownWeeks.includes(week)) unknownWeeks.push(week)
      skippedRows += 1
      return
    }
    if (isUnknown && acceptUnknownWeeks && !unknownWeeks.includes(week)) {
      unknownWeeks.push(week)
    }

    const plannedMetrics: WeekCapacityPlanOverride = {}
    const shrinkageById: Record<string, number> = {}
    Object.entries(record).forEach(([rawHeader, rawValue]) => {
      const normalized = normalizeHeader(rawHeader)
      if (
        normalized === 'week' ||
        normalized === 'weeknumber' ||
        normalized === 'status' ||
        normalized === 'client' ||
        normalized === 'lob' ||
        normalized === 'location' ||
        normalized === 'billingtype' ||
        normalized === 'weekstart'
      ) {
        return
      }
      if (normalized.startsWith('actual')) return

      // Planned_Shrinkage_<CategoryId> columns (not Planned_Shrinkage_Pct total).
      if (
        (normalized.startsWith('plannedshrinkage') || normalized.startsWith('shrinkage')) &&
        normalized !== 'plannedshrinkagepct' &&
        normalized !== 'plannedshrinkage' &&
        normalized !== 'shrinkagepct' &&
        normalized !== 'totalshrinkagepct'
      ) {
        const categoryKey = normalized
          .replace(/^plannedshrinkage/, '')
          .replace(/^shrinkage/, '')
        if (categoryKey) {
          const pct = parsePct(rawValue)
          if (pct != null) {
            shrinkageById[categoryKey] = pct
            plannedCells += 1
          }
          return
        }
      }

      const metricId = PLANNED_COLUMN_MAP[normalized]
      if (!metricId) return
      const parsed = isPctMetric(metricId) ? parsePct(rawValue) : parseNumber(rawValue)
      const nextValue = normalizeMetricInput(metricId, parsed)
      if (nextValue == null) return
      plannedMetrics[metricId] = nextValue
      plannedCells += 1
    })

    if (Object.keys(shrinkageById).length) plannedMetrics.shrinkageById = shrinkageById
    if (Object.keys(plannedMetrics).length) {
      mergeWeekOverride(plannedByWeek, week, plannedMetrics)
    }
  })

  return { plannedByWeek, plannedCells, skippedRows, unknownWeeks, templateWeeksCollected }
}

function mergeActualWeekOverride(
  target: Record<string, ImportedActualOverride>,
  week: string,
  metrics: Partial<LedgerMetricSnapshot>,
  shrinkageById?: Record<string, number>,
): void {
  const existing = target[week] ?? { week, metrics: {} }
  target[week] = {
    week,
    metrics: { ...(existing.metrics ?? {}), ...metrics },
    shrinkageById: {
      ...(existing.shrinkageById ?? {}),
      ...(shrinkageById ?? {}),
    },
  }
}

function parseWeekStatus(value: unknown): 'actual' | 'planned' | null {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (!text) return null
  if (text === 'actual' || text === 'act' || text.startsWith('actual')) return 'actual'
  if (text === 'planned' || text === 'plan' || text.startsWith('plan')) return 'planned'
  return null
}

function parseMatrixRows(rows: Record<string, unknown>[]): {
  plannedByWeek: Record<string, WeekCapacityPlanOverride>
  plannedCells: number
  templateWeeksCollected: string[]
  actualOverrides: ImportedActualOverride[]
} {
  const plannedByWeek: Record<string, WeekCapacityPlanOverride> = {}
  const actualByWeek: Record<string, ImportedActualOverride> = {}
  const templateWeeksCollected: string[] = []
  let plannedCells = 0
  if (!rows.length) {
    return { plannedByWeek, plannedCells, templateWeeksCollected, actualOverrides: [] }
  }

  const headers = Object.keys(rows[0] ?? {})
  const weekColumns = headers
    .map((header) => ({ header, week: coerceImportWeekDate(header) }))
    .filter((item) => item.week)

  weekColumns.forEach((item) => templateWeeksCollected.push(item.week))

  // Status row (Metric = "Status") maps each week column to Actual vs Planned.
  const statusByWeek: Record<string, 'actual' | 'planned'> = {}
  rows.forEach((record) => {
    const label = normalizeHeader(readMatrixMetricLabel(record))
    if (label !== 'status') return
    weekColumns.forEach(({ header, week }) => {
      const status = parseWeekStatus(record[header])
      if (status) statusByWeek[week] = status
    })
  })
  const hasStatusRow = Object.keys(statusByWeek).length > 0

  rows.forEach((record) => {
    const metricIdRaw = String(record.Metric_Id ?? record.metric_id ?? record.MetricId ?? '').trim()
    const shrinkageCategoryId = parseShrinkageMetricId(metricIdRaw)
    if (shrinkageCategoryId) {
      weekColumns.forEach(({ header, week }) => {
        const parsed = parsePct(record[header])
        if (parsed == null) return
        mergeWeekOverride(plannedByWeek, week, { shrinkageById: { [shrinkageCategoryId]: parsed } })
        plannedCells += 1
        const weekStatus = statusByWeek[week]
        if (!hasStatusRow || weekStatus === 'actual') {
          mergeActualWeekOverride(actualByWeek, week, {}, { [shrinkageCategoryId]: parsed })
        }
      })
      return
    }

    const metricId = resolveMatrixMetricId(record)
    if (!metricId) return

    weekColumns.forEach(({ header, week }) => {
      const rawValue = record[header]
      // Skip Status sub-header cells that leak into values ("Actual"/"Planned").
      if (parseWeekStatus(rawValue) != null && parseNumber(rawValue) == null) return
      const parsed = isPctMetric(metricId) ? parsePct(rawValue) : parseNumber(rawValue)
      const nextValue = normalizeMetricInput(metricId, parsed)
      if (nextValue == null) return

      // Required FTE always drives the Planned Required row in the matrix UI.
      // Production FTE uploads also set Production HC so headcount stays aligned.
      const patch: WeekCapacityPlanOverride =
        metricId === 'productionFte'
          ? { productionFte: nextValue, productionHc: Math.round(nextValue) }
          : { [metricId]: nextValue }
      mergeWeekOverride(plannedByWeek, week, patch)
      plannedCells += 1

      const weekStatus = statusByWeek[week]
      // Without a Status row, also write actual-capable metrics so historical
      // ACTUAL weeks (Production FTE, etc.) pick up the upload.
      if (MATRIX_ACTUAL_IMPORT_METRICS.has(metricId) && (!hasStatusRow || weekStatus === 'actual')) {
        const actualPatch: Partial<LedgerMetricSnapshot> =
          metricId === 'productionFte'
            ? { productionFte: nextValue, productionHc: Math.round(nextValue) }
            : { [metricId]: nextValue }
        mergeActualWeekOverride(actualByWeek, week, actualPatch)
      }
    })
  })

  return {
    plannedByWeek,
    plannedCells,
    templateWeeksCollected: uniqueSortedWeeks(templateWeeksCollected),
    actualOverrides: Object.values(actualByWeek),
  }
}

export function parseCapacityPlanWorkbook(
  workbook: XLSX.WorkBook,
  knownWeeks: string[],
  options: CapacityWorkbookImportOptions = {},
): CapacityWorkbookImportResult {
  const acceptUnknownWeeks = options.acceptUnknownWeeks === true
  const errors: string[] = []
  const knownWeekSet = new Set(knownWeeks)

  const picked = pickCapacitySheet(workbook)
  if (!picked) {
    return {
      success: false,
      sheetName: '',
      plannedCells: 0,
      actualRows: 0,
      skippedRows: 0,
      unknownWeeks: [],
      templateWeeks: [],
      errors: [
        'No worksheet with a Week column (Capacity_Plan) or matrix layout (Capacity_Matrix) was found. Use Download → Download full workbook, or Download matrix (Excel).',
      ],
      warnings: [],
      message: 'Upload failed: no valid worksheet found.',
      plannedByWeek: {},
      uploadedDriverMetricIds: [],
      actualOverrides: [],
    }
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(picked.sheet, { defval: '', raw: true })
  if (!rows.length) {
    return {
      success: false,
      sheetName: picked.name,
      plannedCells: 0,
      actualRows: 0,
      skippedRows: 0,
      unknownWeeks: [],
      templateWeeks: [],
      errors: ['The worksheet is empty.'],
      warnings: [],
      message: 'Upload failed: the worksheet has no data rows.',
      plannedByWeek: {},
      uploadedDriverMetricIds: [],
      actualOverrides: [],
    }
  }

  let plannedByWeek: Record<string, WeekCapacityPlanOverride> = {}
  let plannedCells = 0
  let skippedRows = 0
  let unknownWeeks: string[] = []
  let templateWeeksCollected: string[] = []
  let matrixActualOverrides: ImportedActualOverride[] = []

  if (picked.kind === 'matrix' || (!recordHasWeekColumn(rows) && isMatrixSheet(rows))) {
    const matrix = parseMatrixRows(rows)
    plannedByWeek = matrix.plannedByWeek
    plannedCells = matrix.plannedCells
    templateWeeksCollected = matrix.templateWeeksCollected
    matrixActualOverrides = matrix.actualOverrides
  } else {
    const plan = parsePlanRows(rows, knownWeekSet, acceptUnknownWeeks)
    plannedByWeek = plan.plannedByWeek
    plannedCells = plan.plannedCells
    skippedRows = plan.skippedRows
    unknownWeeks = plan.unknownWeeks
    templateWeeksCollected = plan.templateWeeksCollected
  }

  const templateWeeks = uniqueSortedWeeks(templateWeeksCollected)
  const uploadedDriverMetricIds = collectUploadedDriverMetricIds(plannedByWeek)

  const actualOverrides =
    picked.kind === 'plan'
      ? normalizeImportedActualOverrides(
          rows.map((record) => {
            const week = weekKey(record.Week ?? record.week ?? record.WEEK)
            return week ? { ...record, Week: week } : record
          }),
        ).filter((override) => {
          if (!knownWeekSet.size || acceptUnknownWeeks) return Boolean(override.week)
          if (knownWeekSet.has(override.week)) return true
          if (!unknownWeeks.includes(override.week)) unknownWeeks.push(override.week)
          return false
        })
      : matrixActualOverrides

  const actualRows = actualOverrides.filter(
    (override) =>
      Object.keys(override.metrics ?? {}).length > 0 || Object.keys(override.shrinkageById ?? {}).length > 0,
  ).length

  if (!plannedCells && !actualRows) {
    const sampleHeaders = Object.keys(rows[0] ?? {})
      .slice(0, 12)
      .join(', ')
    errors.push(
      'No planned or actual values matched the capacity file. Fill Planned_* columns in the full workbook, or editable metric rows (with Metric_Id) in the matrix download.',
    )
    if (sampleHeaders) errors.push(`Found columns: ${sampleHeaders}`)
    return {
      success: false,
      sheetName: picked.name,
      plannedCells: 0,
      actualRows: 0,
      skippedRows,
      unknownWeeks,
      templateWeeks,
      errors,
      warnings: [],
      message: 'Upload failed: no data could be applied to this capacity file.',
      plannedByWeek: {},
      uploadedDriverMetricIds: [],
      actualOverrides: [],
    }
  }

  const warnings: string[] = []
  if (unknownWeeks.length && !acceptUnknownWeeks) {
    warnings.push(`${unknownWeeks.length} row(s) skipped because the week was not in this capacity file.`)
  }
  if (skippedRows > 0) {
    warnings.push(`${skippedRows} row(s) skipped because Week was missing or invalid.`)
  }

  const requiredFteWeeks = Object.values(plannedByWeek).filter((week) => week.requiredFte != null).length
  const message = [
    `Imported ${plannedCells} planned value${plannedCells === 1 ? '' : 's'} across ${Object.keys(plannedByWeek).length} week${Object.keys(plannedByWeek).length === 1 ? '' : 's'} from ${picked.name}.`,
    requiredFteWeeks
      ? `Required Production FTE set for ${requiredFteWeeks} week${requiredFteWeeks === 1 ? '' : 's'}.`
      : null,
    actualRows
      ? `Applied ${actualRows} actual override row${actualRows === 1 ? '' : 's'}.`
      : null,
    uploadedDriverMetricIds.length
      ? `Driver fields pinned to manual: ${uploadedDriverMetricIds.join(', ')}.`
      : null,
    warnings.length ? warnings.join(' ') : null,
  ]
    .filter(Boolean)
    .join(' ')

  return {
    success: true,
    sheetName: picked.name,
    plannedCells,
    actualRows,
    skippedRows,
    unknownWeeks,
    templateWeeks,
    errors: [],
    warnings,
    message,
    plannedByWeek,
    uploadedDriverMetricIds,
    actualOverrides,
  }
}

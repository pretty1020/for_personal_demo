import * as XLSX from 'xlsx'
import { coerceImportWeekDate } from './capacityImportWeek'
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
  plannedByWeek: Record<string, Partial<LedgerMetricSnapshot>>
  /** Shrinkage Breakdown by week → categoryId → planned % (0–1). */
  plannedShrinkageByWeek: Record<string, Record<string, number>>
  actualOverrides: ImportedActualOverride[]
}

export type CapacityWorkbookImportOptions = {
  /** When true, import rows even if the week is not in the current ledger. */
  acceptUnknownWeeks?: boolean
  /** Category id/name pairs used to map PlannedShrink_* columns and matrix labels. */
  shrinkageCategories?: Array<{ id: string; name: string }>
}

const PLANNED_COLUMN_MAP: Partial<Record<string, keyof LedgerMetricSnapshot>> = {
  plannedvolume: 'callVolume',
  plannedcallvolume: 'callVolume',
  plannedtransactions: 'handledVolume',
  transactions: 'handledVolume',
  plannedhandledvolume: 'handledVolume',
  forecastvolume: 'callVolume',
  callvolume: 'callVolume',
  volume: 'callVolume',
  plannedaht: 'ahtSeconds',
  plannedahtseconds: 'ahtSeconds',
  aht: 'ahtSeconds',
  ahtseconds: 'ahtSeconds',
  plannedcappedaht: 'cappedAhtSeconds',
  plannedcappedahtseconds: 'cappedAhtSeconds',
  plannedoccupancy: 'occupancy',
  occupancy: 'occupancy',
  plannedshrinkagepct: 'totalShrinkagePct',
  plannednewhires: 'plannedNewHires',
  plannedtraininghc: 'trainingHc',
  plannednestinghc: 'nestingHc',
  plannedgraduatehc: 'graduateHc',
  plannedattritionhc: 'attritionHc',
  plannedattritionpct: 'attritionPct',
  plannedtransferinhc: 'transferInHc',
  plannedtransferouthc: 'transferOutHc',
  plannedoffrosterloahc: 'offRosterLoaHc',
  plannedbeginningproductionhc: 'beginningProductionHc',
  plannedrequiredfte: 'requiredFte',
  requiredfte: 'requiredFte',
  requiredproductionfte: 'requiredFte',
  productionrequiredfte: 'requiredFte',
  plannedproductionfte: 'productionFte',
  plannedstaffingpct: 'staffingPct',
}

/** Matrix export metric labels → planned override keys. */
const MATRIX_METRIC_LABEL_MAP: Record<string, keyof LedgerMetricSnapshot> = {
  requiredproductionfte: 'requiredFte',
  forecastvolume: 'callVolume',
  plannedaht: 'ahtSeconds',
  plannedoccupancy: 'occupancy',
  plannedtransferin: 'transferInHc',
  plannedtransferout: 'transferOutHc',
  plannedattrition: 'attritionHc',
  plannedattritionpct: 'attritionPct',
  plannednewhires: 'plannedNewHires',
  plannedproductionhc: 'productionHc',
  beginningproductionhc: 'beginningProductionHc',
  plannedgraduatehc: 'graduateHc',
  plannedtraininghc: 'trainingHc',
  plannednestinghc: 'nestingHc',
  plannedoffrosterloa: 'offRosterLoaHc',
  transactions: 'handledVolume',
  handledvolume: 'handledVolume',
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

function parsePct(value: unknown): number | null {
  const parsed = parseNumber(value)
  if (parsed == null) return null
  return parsed > 1 ? parsed / 100 : parsed
}

function normalizeMetricInput(metricId: keyof LedgerMetricSnapshot, value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  if (metricId === 'occupancy') return Math.max(0, Math.min(0.999, value))
  if (metricId === 'totalShrinkagePct') return Math.max(0, Math.min(1.25, value))
  if (metricId === 'attritionPct') return Math.max(0, Math.min(1, value))
  if (metricId === 'staffingPct') return Math.max(0, Math.min(2, value))
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

function recordHasWeekColumn(rows: Record<string, unknown>[]): boolean {
  return rows.some((row) => {
    const weekValue = row.Week ?? row.week ?? row.WEEK
    return Boolean(coerceImportWeekDate(weekValue))
  })
}

function isMatrixSheet(rows: Record<string, unknown>[]): boolean {
  if (!rows.length) return false
  const headers = Object.keys(rows[0] ?? {}).map(normalizeHeader)
  const hasMetric = headers.includes('metric')
  const weekHeaders = Object.keys(rows[0] ?? {}).filter((header) => coerceImportWeekDate(header))
  return hasMetric && weekHeaders.length >= 2
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
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true })
    if (recordHasWeekColumn(rows)) return { name, sheet, kind: 'plan' }
    if (isMatrixSheet(rows)) return { name, sheet, kind: 'matrix' }
  }
  return null
}

function weekKey(value: unknown): string {
  return coerceImportWeekDate(value)
}

function resolveShrinkageCategoryId(
  token: string,
  categories: Array<{ id: string; name: string }>,
): string | null {
  const normalized = normalizeHeader(token)
  if (!normalized) return null
  for (const category of categories) {
    if (normalizeHeader(category.id) === normalized || normalizeHeader(category.name) === normalized) {
      return category.id
    }
  }
  // Accept PlannedShrink_Absenteeism style tokens without a category list match.
  if (/^[a-z0-9_]+$/.test(normalized)) return normalized
  return null
}

function parsePlanRows(
  rows: Record<string, unknown>[],
  knownWeekSet: Set<string>,
  acceptUnknownWeeks: boolean,
  shrinkageCategories: Array<{ id: string; name: string }>,
): {
  plannedByWeek: Record<string, Partial<LedgerMetricSnapshot>>
  plannedShrinkageByWeek: Record<string, Record<string, number>>
  plannedCells: number
  skippedRows: number
  unknownWeeks: string[]
  templateWeeksCollected: string[]
} {
  const plannedByWeek: Record<string, Partial<LedgerMetricSnapshot>> = {}
  const plannedShrinkageByWeek: Record<string, Record<string, number>> = {}
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

    const plannedMetrics: Partial<LedgerMetricSnapshot> = {}
    const shrinkageForWeek: Record<string, number> = {
      ...(plannedShrinkageByWeek[week] ?? {}),
    }
    Object.entries(record).forEach(([rawHeader, rawValue]) => {
      const normalized = normalizeHeader(rawHeader)
      if (normalized === 'week' || normalized === 'weeknumber' || normalized === 'status') return
      // Prefer Planned_* columns; ignore Actual_* in the planned pass.
      if (normalized.startsWith('actual') && !normalized.startsWith('actualshrink')) return

      if (normalized.startsWith('plannedshrink') || normalized.startsWith('shrink')) {
        const token = normalized
          .replace(/^plannedshrink_?/, '')
          .replace(/^shrink_?/, '')
          .replace(/^planned/, '')
        const categoryId = resolveShrinkageCategoryId(token, shrinkageCategories)
        if (!categoryId) return
        const nextValue = normalizeMetricInput('totalShrinkagePct', parsePct(rawValue))
        if (nextValue == null) return
        shrinkageForWeek[categoryId] = nextValue
        plannedCells += 1
        return
      }

      const metricId = PLANNED_COLUMN_MAP[normalized]
      if (!metricId) return
      const parsed =
        metricId === 'occupancy' ||
        metricId === 'totalShrinkagePct' ||
        metricId === 'staffingPct' ||
        metricId === 'attritionPct'
          ? parsePct(rawValue)
          : parseNumber(rawValue)
      const nextValue = normalizeMetricInput(metricId, parsed)
      if (nextValue == null) return
      plannedMetrics[metricId] = nextValue
      plannedCells += 1
    })

    if (Object.keys(plannedMetrics).length) {
      plannedByWeek[week] = { ...(plannedByWeek[week] ?? {}), ...plannedMetrics }
    }
    if (Object.keys(shrinkageForWeek).length) {
      plannedShrinkageByWeek[week] = shrinkageForWeek
    }
  })

  return {
    plannedByWeek,
    plannedShrinkageByWeek,
    plannedCells,
    skippedRows,
    unknownWeeks,
    templateWeeksCollected,
  }
}

function parseMatrixRows(
  rows: Record<string, unknown>[],
  shrinkageCategories: Array<{ id: string; name: string }>,
): {
  plannedByWeek: Record<string, Partial<LedgerMetricSnapshot>>
  plannedShrinkageByWeek: Record<string, Record<string, number>>
  plannedCells: number
  templateWeeksCollected: string[]
} {
  const plannedByWeek: Record<string, Partial<LedgerMetricSnapshot>> = {}
  const plannedShrinkageByWeek: Record<string, Record<string, number>> = {}
  const templateWeeksCollected: string[] = []
  let plannedCells = 0
  if (!rows.length) return { plannedByWeek, plannedShrinkageByWeek, plannedCells, templateWeeksCollected }

  const headers = Object.keys(rows[0] ?? {})
  const weekColumns = headers
    .map((header) => ({ header, week: coerceImportWeekDate(header) }))
    .filter((item) => item.week)

  weekColumns.forEach((item) => templateWeeksCollected.push(item.week))

  const categoryByNormalizedName = new Map<string, string>()
  for (const category of shrinkageCategories) {
    categoryByNormalizedName.set(normalizeHeader(category.name), category.id)
    categoryByNormalizedName.set(normalizeHeader(category.id), category.id)
  }

  rows.forEach((record) => {
    const metricLabel = String(record.Metric ?? record.metric ?? '').trim()
    if (!metricLabel) return
    // Skip status row and calculated-only labels that should not overwrite drivers.
    const normalizedLabel = normalizeHeader(metricLabel)
    if (normalizedLabel === 'status' || normalizedLabel === 'ftevariance' || normalizedLabel === 'staffing') return

    // Category breakdown rows: "Absenteeism planned (Not Billable)" / "Meetings planned (Billable)"
    const plannedCategoryMatch = /^(.*?)planned(?:notbillable|billable)?$/.exec(normalizedLabel)
    if (plannedCategoryMatch && !MATRIX_METRIC_LABEL_MAP[normalizedLabel]) {
      const nameToken = plannedCategoryMatch[1]!
        .replace(/(not)?billable$/i, '')
        .replace(/planned$/, '')
      // Strip trailing billable tags already removed via normalizeHeader collapsing.
      let categoryId = categoryByNormalizedName.get(nameToken) ?? null
      if (!categoryId) {
        // Try without billable suffix fragments that may remain in label text before normalize.
        const labelWithoutTag = metricLabel
          .replace(/\s*\((?:Not\s*)?Billable\)\s*$/i, '')
          .replace(/\s+planned\s*$/i, '')
          .trim()
        categoryId = categoryByNormalizedName.get(normalizeHeader(labelWithoutTag)) ?? null
      }
      if (categoryId) {
        weekColumns.forEach(({ header, week }) => {
          const nextValue = normalizeMetricInput('totalShrinkagePct', parsePct(record[header]))
          if (nextValue == null) return
          plannedShrinkageByWeek[week] = {
            ...(plannedShrinkageByWeek[week] ?? {}),
            [categoryId!]: nextValue,
          }
          plannedCells += 1
        })
        return
      }
    }

    const metricId = MATRIX_METRIC_LABEL_MAP[normalizedLabel]
    if (!metricId) {
      // Also map "Planned shrinkage" aggregate → totalShrinkagePct
      if (normalizedLabel === 'plannedshrinkage' || normalizedLabel === 'totalshrinkage') {
        weekColumns.forEach(({ header, week }) => {
          const nextValue = normalizeMetricInput('totalShrinkagePct', parsePct(record[header]))
          if (nextValue == null) return
          plannedByWeek[week] = { ...(plannedByWeek[week] ?? {}), totalShrinkagePct: nextValue }
          plannedCells += 1
        })
      }
      return
    }

    weekColumns.forEach(({ header, week }) => {
      const rawValue = record[header]
      const parsed =
        metricId === 'occupancy' || metricId === 'totalShrinkagePct' || metricId === 'attritionPct' || metricId === 'staffingPct'
          ? parsePct(rawValue)
          : parseNumber(rawValue)
      const nextValue = normalizeMetricInput(metricId, parsed)
      if (nextValue == null) return
      plannedByWeek[week] = { ...(plannedByWeek[week] ?? {}), [metricId]: nextValue }
      plannedCells += 1
    })
  })

  return {
    plannedByWeek,
    plannedShrinkageByWeek,
    plannedCells,
    templateWeeksCollected: uniqueSortedWeeks(templateWeeksCollected),
  }
}

export function parseCapacityPlanWorkbook(
  workbook: XLSX.WorkBook,
  knownWeeks: string[],
  options: CapacityWorkbookImportOptions = {},
): CapacityWorkbookImportResult {
  const acceptUnknownWeeks = options.acceptUnknownWeeks === true
  const shrinkageCategories = options.shrinkageCategories ?? []
  const errors: string[] = []
  const knownWeekSet = new Set(knownWeeks)

  const emptyResult = (partial: Partial<CapacityWorkbookImportResult>): CapacityWorkbookImportResult => ({
    success: false,
    sheetName: '',
    plannedCells: 0,
    actualRows: 0,
    skippedRows: 0,
    unknownWeeks: [],
    templateWeeks: [],
    errors: [],
    warnings: [],
    message: '',
    plannedByWeek: {},
    plannedShrinkageByWeek: {},
    actualOverrides: [],
    ...partial,
  })

  const picked = pickCapacitySheet(workbook)
  if (!picked) {
    return emptyResult({
      errors: [
        'No worksheet with a Week column (Capacity_Plan) or matrix layout (Capacity_Matrix) was found. Use Download → Download full workbook, or Download matrix (Excel).',
      ],
      message: 'Upload failed: no valid worksheet found.',
    })
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(picked.sheet, { defval: '', raw: true })
  if (!rows.length) {
    return emptyResult({
      sheetName: picked.name,
      errors: ['The worksheet is empty.'],
      message: 'Upload failed: the worksheet has no data rows.',
    })
  }

  let plannedByWeek: Record<string, Partial<LedgerMetricSnapshot>> = {}
  let plannedShrinkageByWeek: Record<string, Record<string, number>> = {}
  let plannedCells = 0
  let skippedRows = 0
  let unknownWeeks: string[] = []
  let templateWeeksCollected: string[] = []

  if (picked.kind === 'matrix' || (!recordHasWeekColumn(rows) && isMatrixSheet(rows))) {
    const matrix = parseMatrixRows(rows, shrinkageCategories)
    plannedByWeek = matrix.plannedByWeek
    plannedShrinkageByWeek = matrix.plannedShrinkageByWeek
    plannedCells = matrix.plannedCells
    templateWeeksCollected = matrix.templateWeeksCollected
  } else {
    const plan = parsePlanRows(rows, knownWeekSet, acceptUnknownWeeks, shrinkageCategories)
    plannedByWeek = plan.plannedByWeek
    plannedShrinkageByWeek = plan.plannedShrinkageByWeek
    plannedCells = plan.plannedCells
    skippedRows = plan.skippedRows
    unknownWeeks = plan.unknownWeeks
    templateWeeksCollected = plan.templateWeeksCollected
  }

  const templateWeeks = uniqueSortedWeeks(templateWeeksCollected)

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
      : []

  const actualRows = actualOverrides.filter(
    (override) =>
      Object.keys(override.metrics ?? {}).length > 0 || Object.keys(override.shrinkageById ?? {}).length > 0,
  ).length

  const shrinkageCells = Object.values(plannedShrinkageByWeek).reduce(
    (sum, byCat) => sum + Object.keys(byCat).length,
    0,
  )

  if (!plannedCells && !actualRows) {
    const sampleHeaders = Object.keys(rows[0] ?? {})
      .slice(0, 12)
      .join(', ')
    errors.push(
      'No planned or actual values matched the capacity file. For Per FTE plans, fill Planned_Required_FTE (full workbook) or the Required Production FTE row (matrix download).',
    )
    if (sampleHeaders) errors.push(`Found columns: ${sampleHeaders}`)
    return emptyResult({
      sheetName: picked.name,
      skippedRows,
      unknownWeeks,
      templateWeeks,
      errors,
      message: 'Upload failed: no data could be applied to this capacity file.',
    })
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
    shrinkageCells
      ? `Shrinkage Breakdown captured for ${Object.keys(plannedShrinkageByWeek).length} week${Object.keys(plannedShrinkageByWeek).length === 1 ? '' : 's'}.`
      : null,
    actualRows
      ? `Applied ${actualRows} actual override row${actualRows === 1 ? '' : 's'}.`
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
    plannedShrinkageByWeek,
    actualOverrides,
  }
}

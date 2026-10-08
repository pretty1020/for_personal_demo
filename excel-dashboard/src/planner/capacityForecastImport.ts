import * as XLSX from 'xlsx'
import { coerceImportWeekDate, snapImportWeek } from './capacityImportWeek'
import { addWeeks, snapToWeekStart } from './capacityWeekUtils'
import type { WeekCapacityPlanOverride } from './capacityPlanOverridePersistence'
import type { LedgerMetricSnapshot } from './weeklyLedger'
import type { WeekStart } from './types'

export type CapacityForecastTemplateType =
  | 'forecast_volume'
  | 'planned_aht'
  | 'planned_occupancy'
  | 'required_fte'
  | 'transactions'
  | 'volume_aht_occupancy'

export type CapacityForecastImportMode = 'overwrite' | 'append'

export type CapacityForecastImportResult = {
  success: boolean
  templateType: CapacityForecastTemplateType | 'auto'
  mode: CapacityForecastImportMode
  weeksApplied: number
  cellsApplied: number
  errors: string[]
  message: string
  plannedByWeek: Record<string, WeekCapacityPlanOverride>
}

const TEMPLATE_LABELS: Record<CapacityForecastTemplateType, string> = {
  forecast_volume: 'Forecast Volume',
  planned_aht: 'Planned AHT',
  planned_occupancy: 'Planned Occupancy',
  required_fte: 'Required FTE',
  transactions: 'Transactions',
  volume_aht_occupancy: 'Volume + AHT + Occupancy',
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parsePct(value: unknown): number | null {
  const parsed = parseNumber(value)
  if (parsed == null) return null
  return parsed > 1 ? parsed / 100 : parsed
}

function weekKey(value: unknown): string {
  return coerceImportWeekDate(value)
}

function buildWeekHeaders(planStartWeek: string, weekCount = 52): string[] {
  const start = new Date(`${planStartWeek}T12:00:00`)
  return Array.from({ length: weekCount }, (_, index) =>
    addWeeks(start, index).toISOString().slice(0, 10),
  )
}

function requiredFteFromDrivers(
  volume: number,
  ahtSeconds: number,
  occupancy: number,
  standardHours = 40,
): number {
  const capacitySeconds = Math.max(standardHours * 3600 * occupancy, 1)
  return (volume * ahtSeconds) / capacitySeconds
}

function workloadHours(volume: number, ahtSeconds: number): number {
  return (volume * ahtSeconds) / 3600
}

function requiredHeadcount(requiredFte: number): number {
  return Math.ceil(requiredFte)
}

export function capacityForecastTemplateLabel(type: CapacityForecastTemplateType): string {
  return TEMPLATE_LABELS[type]
}

export function downloadCapacityForecastTemplate(
  type: CapacityForecastTemplateType,
  planStartWeek: string,
  weekCount = 52,
): void {
  const weeks = buildWeekHeaders(planStartWeek, weekCount)
  const rows: Record<string, string | number>[] = weeks.map((week, index) => {
    const base: Record<string, string | number> = {
      Week: week,
      WeekNumber: index + 1,
    }
    switch (type) {
      case 'forecast_volume':
        return { ...base, ForecastVolume: '' }
      case 'planned_aht':
        return { ...base, PlannedAHT: '' }
      case 'planned_occupancy':
        return { ...base, PlannedOccupancy: '' }
      case 'required_fte':
        return { ...base, RequiredFTE: '' }
      case 'transactions':
        return { ...base, Transactions: '' }
      case 'volume_aht_occupancy':
        return {
          ...base,
          ForecastVolume: '',
          PlannedAHT: '',
          PlannedOccupancy: '',
          WorkloadHours: '',
          RequiredFTE: '',
          RequiredHeadcount: '',
        }
      default:
        return base
    }
  })

  const sheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, TEMPLATE_LABELS[type].replace(/[^A-Za-z0-9]+/g, '_'))
  XLSX.writeFile(workbook, `capacity_${type}_${planStartWeek}.xlsx`)
}

function detectTemplateType(headers: string[]): CapacityForecastTemplateType | 'auto' {
  const normalized = new Set(headers.map(normalizeHeader))
  const hasVolume = normalized.has('forecastvolume') || normalized.has('plannedvolume') || normalized.has('callvolume')
  const hasAht = normalized.has('plannedaht') || normalized.has('aht')
  const hasOccupancy = normalized.has('plannedoccupancy') || normalized.has('occupancy')
  const hasRequiredFte = normalized.has('requiredfte')
  const hasTransactions = normalized.has('transactions')

  if (hasVolume && hasAht && hasOccupancy) return 'volume_aht_occupancy'
  if (hasRequiredFte && !hasVolume && !hasAht) return 'required_fte'
  if (hasTransactions && !hasVolume && !hasAht) return 'transactions'
  if (hasAht && !hasVolume) return 'planned_aht'
  if (hasOccupancy && !hasVolume) return 'planned_occupancy'
  if (hasVolume) return 'forecast_volume'
  return 'auto'
}

function mergeWeekOverride(
  target: Record<string, WeekCapacityPlanOverride>,
  week: string,
  patch: Partial<LedgerMetricSnapshot>,
): void {
  target[week] = { ...(target[week] ?? {}), ...patch }
}

export function parseCapacityForecastUpload(
  workbook: XLSX.WorkBook,
  options: {
    planStartWeek: string
    weekStart: WeekStart
    mode?: CapacityForecastImportMode
    templateType?: CapacityForecastTemplateType
    standardHours?: number
    existingOverrides?: Record<string, WeekCapacityPlanOverride>
  },
): CapacityForecastImportResult {
  const mode = options.mode ?? 'overwrite'
  const standardHours = options.standardHours ?? 40
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    return {
      success: false,
      templateType: 'auto',
      mode,
      weeksApplied: 0,
      cellsApplied: 0,
      errors: ['Workbook has no sheets.'],
      message: 'Upload failed.',
      plannedByWeek: {},
    }
  }

  const sheet = workbook.Sheets[sheetName]!
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  if (!records.length) {
    return {
      success: false,
      templateType: 'auto',
      mode,
      weeksApplied: 0,
      cellsApplied: 0,
      errors: ['Sheet is empty.'],
      message: 'Upload failed.',
      plannedByWeek: {},
    }
  }

  const headers = Object.keys(records[0] ?? {})
  const detectedType = options.templateType ?? detectTemplateType(headers)
  const plannedByWeek: Record<string, WeekCapacityPlanOverride> = {}
  let cellsApplied = 0
  const errors: string[] = []
  const touchedWeeks = new Set<string>()

  records.forEach((record, rowIndex) => {
    const rawWeek = weekKey(record.Week ?? record.week)
    const weekNumber = parseNumber(record.WeekNumber ?? record.weeknumber)
    const week =
      rawWeek ||
      (weekNumber != null
        ? snapToWeekStart(
            addWeeks(new Date(`${options.planStartWeek}T12:00:00`), Math.max(0, Math.round(weekNumber) - 1)),
            options.weekStart,
          )
        : '')

    if (!week) {
      errors.push(`Row ${rowIndex + 2}: missing Week or WeekNumber.`)
      return
    }
    const snappedWeek = snapImportWeek(week, options.weekStart) || snapToWeekStart(week, options.weekStart)

    const readNumber = (...keys: string[]) => {
      for (const key of keys) {
        const match = Object.entries(record).find(([header]) => normalizeHeader(header) === normalizeHeader(key))
        if (!match) continue
        const value = parseNumber(match[1])
        if (value != null) return value
      }
      return null
    }

    const readPct = (...keys: string[]) => {
      for (const key of keys) {
        const match = Object.entries(record).find(([header]) => normalizeHeader(header) === normalizeHeader(key))
        if (!match) continue
        const value = parsePct(match[1])
        if (value != null) return value
      }
      return null
    }

    const volume = readNumber('ForecastVolume', 'PlannedVolume', 'CallVolume', 'Volume')
    const aht = readNumber('PlannedAHT', 'AHT', 'PlannedAhtSeconds')
    const occupancy = readPct('PlannedOccupancy', 'Occupancy')
    const requiredFte = readNumber('RequiredFTE', 'RequiredFte')
    const transactions = readNumber('Transactions', 'HandledVolume', 'PlannedHandledVolume')

    const patch: Partial<LedgerMetricSnapshot> = {}

    if (detectedType === 'forecast_volume' || detectedType === 'volume_aht_occupancy') {
      if (volume != null) patch.callVolume = volume
    }
    if (detectedType === 'planned_aht' || detectedType === 'volume_aht_occupancy') {
      if (aht != null) patch.ahtSeconds = aht
    }
    if (detectedType === 'planned_occupancy' || detectedType === 'volume_aht_occupancy') {
      if (occupancy != null) patch.occupancy = Math.max(0, Math.min(0.999, occupancy))
    }
    if (detectedType === 'required_fte') {
      if (requiredFte != null) patch.requiredFte = requiredFte
    }
    if (detectedType === 'transactions') {
      if (transactions != null) {
        patch.handledVolume = transactions
        patch.callVolume = transactions
      }
    }

    if (detectedType === 'volume_aht_occupancy' && volume != null && aht != null && occupancy != null) {
      const computedFte = requiredFteFromDrivers(volume, aht, occupancy, standardHours)
      patch.requiredFte = computedFte
      void workloadHours(volume, aht)
      void requiredHeadcount(computedFte)
    }

    if (Object.keys(patch).length) {
      if (
        patch.callVolume != null &&
        patch.ahtSeconds != null &&
        patch.occupancy != null &&
        patch.requiredFte == null
      ) {
        patch.requiredFte = requiredFteFromDrivers(
          patch.callVolume,
          patch.ahtSeconds,
          patch.occupancy,
          standardHours,
        )
      }
      const existing = options.existingOverrides?.[snappedWeek] ?? {}
      const nextPatch: Partial<LedgerMetricSnapshot> = {}
      for (const [key, value] of Object.entries(patch) as Array<[keyof LedgerMetricSnapshot, number]>) {
        if (value == null || Number.isNaN(value)) continue
        if (mode === 'append' && existing[key] != null) continue
        nextPatch[key] = value
      }
      if (Object.keys(nextPatch).length) {
        cellsApplied += Object.keys(nextPatch).length
        mergeWeekOverride(plannedByWeek, snappedWeek, nextPatch)
        touchedWeeks.add(snappedWeek)
      }
    }
  })

  if (!cellsApplied || !touchedWeeks.size) {
    return {
      success: false,
      templateType: detectedType,
      mode,
      weeksApplied: 0,
      cellsApplied: 0,
      errors: ['No values matched expected columns. Download a template and try again.', ...errors],
      message: 'Upload failed: no data applied.',
      plannedByWeek: {},
    }
  }

  return {
    success: true,
    templateType: detectedType,
    mode,
    weeksApplied: touchedWeeks.size,
    cellsApplied,
    errors,
    message: `Applied ${cellsApplied} value${cellsApplied === 1 ? '' : 's'} across ${touchedWeeks.size} week${touchedWeeks.size === 1 ? '' : 's'} (${TEMPLATE_LABELS[detectedType as CapacityForecastTemplateType] ?? detectedType}, ${mode}).`,
    plannedByWeek,
  }
}

export async function parseCapacityForecastFile(
  file: File,
  options: Parameters<typeof parseCapacityForecastUpload>[1],
): Promise<CapacityForecastImportResult> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  return parseCapacityForecastUpload(workbook, options)
}

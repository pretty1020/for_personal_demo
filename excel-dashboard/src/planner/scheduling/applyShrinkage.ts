import * as XLSX from 'xlsx'

import type { SchedulingWorkspace } from './types'
import {
  allIntervalTimes,
  normalizeDayKey,
  normalizeIntervalLabel,
} from './intervalSlots'

export const SHRINKAGE_TEMPLATE_HEADERS = [
  'Day',
  'Interval',
  'Shrinkage_Pct',
] as const

export type ShrinkageUploadRow = {
  day: string
  interval: string
  absenteeismPct: number
  inOfficePct: number
  /** Combined 0–100 when file uses Shrinkage_Pct only */
  shrinkagePct: number
}

export type BuildSchedulingResultShrinkageOptions = {
  intervalApplyShrinkagePct?: Record<string, Record<string, number>>
  flatApplyShrinkagePct?: number
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function pickColumn(headers: string[], candidates: string[]): string | null {
  for (const candidate of candidates) {
    const match = headers.find((header) => normalizeHeader(header) === candidate)
    if (match) return match
  }
  return null
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const parsed = Number(String(value ?? '').replace(/%/g, '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

/** Combined Absenteeism + In-office % as 0–100, capped at 100. */
export function combinedApplyShrinkagePct(absenteeismPct: number, inOfficePct: number): number {
  return clampPct(clampPct(absenteeismPct) + clampPct(inOfficePct))
}

export function shrinkageFactorFromPct(pct0to100: number): number {
  return 1 - clampPct(pct0to100) / 100
}

export function applyShrinkageToNetFte(netFte: number, pct: number): number {
  if (!Number.isFinite(netFte) || netFte === 0) return 0
  const clamped = clampPct(pct)
  if (clamped <= 0) return netFte
  return netFte * shrinkageFactorFromPct(clamped)
}

/** Staffing base for Variance / SL / Occupancy / Staffing % — after shrinkage, or Net FTE at 0%. */
export function staffingNetFteFromRow(row: {
  netFte?: number | null
  netFteAfterShrinkage?: number | null
}): number {
  if (row.netFteAfterShrinkage != null && Number.isFinite(row.netFteAfterShrinkage)) {
    return row.netFteAfterShrinkage
  }
  return row.netFte ?? 0
}

/** Per-interval map value when present; otherwise flat Absenteeism+InOffice combined. */
export function resolveIntervalShrinkagePct(
  workspace: Pick<
    SchedulingWorkspace,
    'applyAbsenteeismPct' | 'applyInOfficePct' | 'intervalApplyShrinkagePct'
  >,
  day: string,
  interval: string,
): number {
  const mapped = workspace.intervalApplyShrinkagePct?.[day]?.[interval]
  if (mapped != null && Number.isFinite(mapped)) return clampPct(mapped)
  return combinedApplyShrinkagePct(workspace.applyAbsenteeismPct ?? 0, workspace.applyInOfficePct ?? 0)
}

export function buildApplyShrinkageOptions(
  workspace: Pick<
    SchedulingWorkspace,
    'applyAbsenteeismPct' | 'applyInOfficePct' | 'intervalApplyShrinkagePct' | 'applyShrinkageMode'
  >,
): BuildSchedulingResultShrinkageOptions {
  const flat = combinedApplyShrinkagePct(
    workspace.applyAbsenteeismPct ?? 0,
    workspace.applyInOfficePct ?? 0,
  )
  // Flat mode must ignore leftover upload maps so Shrinkage Assumption % applies to every interval.
  if (workspace.applyShrinkageMode === 'per_interval') {
    return {
      intervalApplyShrinkagePct: workspace.intervalApplyShrinkagePct ?? {},
      flatApplyShrinkagePct: flat,
    }
  }
  return {
    flatApplyShrinkagePct: flat,
  }
}

/**
 * Effective Apply Shrinkage % (0–100) for Staffing quality matrix.
 * Per-interval mode uses the mean of uploaded interval values when present.
 */
export function effectiveApplyShrinkagePct(
  workspace: Pick<
    SchedulingWorkspace,
    'applyAbsenteeismPct' | 'applyInOfficePct' | 'intervalApplyShrinkagePct' | 'applyShrinkageMode'
  >,
): number {
  if (workspace.applyShrinkageMode === 'per_interval') {
    const intervalMap = workspace.intervalApplyShrinkagePct ?? {}
    const values: number[] = []
    for (const dayMap of Object.values(intervalMap)) {
      for (const value of Object.values(dayMap ?? {})) {
        if (Number.isFinite(value)) values.push(clampPct(value))
      }
    }
    if (values.length > 0) {
      return clampPct(values.reduce((sum, value) => sum + value, 0) / values.length)
    }
  }
  return combinedApplyShrinkagePct(workspace.applyAbsenteeismPct ?? 0, workspace.applyInOfficePct ?? 0)
}

export function clearApplyShrinkage(workspace: SchedulingWorkspace): SchedulingWorkspace {
  return {
    ...workspace,
    applyAbsenteeismPct: 0,
    applyInOfficePct: 0,
    intervalApplyShrinkagePct: {},
    shrinkagePct: 0,
  }
}

/** Flat-mode Shrinkage Assumption % (0–100). Legacy abs+in-office values are summed. */
export function flatShrinkageAssumptionPct(
  workspace: Pick<SchedulingWorkspace, 'applyAbsenteeismPct' | 'applyInOfficePct'>,
): number {
  return combinedApplyShrinkagePct(workspace.applyAbsenteeismPct ?? 0, workspace.applyInOfficePct ?? 0)
}

/** Persist a single flat Shrinkage Assumption (clears split abs/in-office). */
export function withFlatShrinkageAssumption(
  workspace: SchedulingWorkspace,
  pct0to100: number,
): SchedulingWorkspace {
  const pct = clampPct(pct0to100)
  return {
    ...workspace,
    applyAbsenteeismPct: pct,
    applyInOfficePct: 0,
    shrinkagePct: pct,
  }
}

function dayLabelForIso(dayIso: string): string {
  const date = new Date(`${dayIso}T12:00:00`)
  return date.toLocaleDateString('en-US', { weekday: 'long' })
}

export function downloadShrinkageTemplate(
  weekStartIso: string,
  weekDates: string[],
  intervals: string[] = allIntervalTimes(),
  filename = 'apply-shrinkage-template.xlsx',
): void {
  const rows: (string | number)[][] = [SHRINKAGE_TEMPLATE_HEADERS.slice()]
  for (const dayIso of weekDates) {
    const dayLabel = dayLabelForIso(dayIso)
    for (const interval of intervals) {
      rows.push([dayLabel, interval, 0])
    }
  }
  const guide: (string | number)[][] = [
    ['Apply Shrinkage upload'],
    [''],
    ['Required columns'],
    ['Day', 'Interval', 'Shrinkage_Pct'],
    ['Monday', '08:00', '12'],
    [''],
    ['Legacy two-column files still work'],
    ['Day', 'Interval', 'Absenteeism_Pct', 'InOffice_Pct'],
    ['Monday', '08:00', '5', '7'],
    [''],
    ['Percentages are 0–100. Flat mode uses one Shrinkage Assumption for all intervals.'],
    ['Net FTE = Scheduled after Break and Lunch. Net FTE after shrinkage = Net FTE × (1 − Shrinkage% / 100).'],
    ['Example: 7 × (1 − 0.01) = 6.93. At 0% shrinkage, Variance / SL / Occupancy / Staffing % use Net FTE.'],
    ['Week start', weekStartIso],
  ]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'ApplyShrinkage')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(guide), 'Guide')
  XLSX.writeFile(workbook, filename)
}

export function parseShrinkageWorkbook(
  workbook: XLSX.WorkBook,
  weekDates: string[],
): { rows: ShrinkageUploadRow[]; errors: string[]; intervalApplyShrinkagePct: Record<string, Record<string, number>> } {
  const errors: string[] = []
  const sheetNames = [...workbook.SheetNames]
  const preferred =
    sheetNames.find((name) => normalizeHeader(name).includes('applyshrinkage')) ??
    sheetNames.find((name) => normalizeHeader(name).includes('shrinkage')) ??
    sheetNames[0]

  const orderedSheets = preferred ? [preferred, ...sheetNames.filter((name) => name !== preferred)] : sheetNames
  const validIntervals = new Set(allIntervalTimes())

  for (const sheetName of orderedSheets) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const table = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    if (!table.length) continue

    const headers = Object.keys(table[0] ?? {})
    const dayCol = pickColumn(headers, ['day', 'date', 'weekday', 'dow'])
    const intervalCol = pickColumn(headers, ['interval', 'time', 'slot', 'halfhour'])
    const absCol = pickColumn(headers, ['absenteeisempct', 'absenteeism', 'absentpct', 'absent'])
    const inOfficeCol = pickColumn(headers, [
      'inofficepct',
      'inoffice',
      'inofficeshrinkage',
      'inofficeshrinkagepct',
      'officepct',
    ])
    const combinedCol = pickColumn(headers, [
      'shrinkagepct',
      'shrinkage',
      'applyshrinkage',
      'applyshrinkagepct',
      'totalpct',
    ])

    if (!dayCol || !intervalCol) continue
    if (!absCol && !inOfficeCol && !combinedCol) continue

    const rows: ShrinkageUploadRow[] = []
    const intervalApplyShrinkagePct: Record<string, Record<string, number>> = {}

    for (const record of table) {
      const rawDay = record[dayCol]
      const dayRaw =
        typeof rawDay === 'number' && Number.isFinite(rawDay)
          ? (() => {
              // Excel serial date → ISO via SheetJS when possible
              try {
                const parsed = XLSX.SSF.parse_date_code(rawDay)
                if (!parsed) return String(rawDay)
                const month = String(parsed.m).padStart(2, '0')
                const dayNum = String(parsed.d).padStart(2, '0')
                return `${parsed.y}-${month}-${dayNum}`
              } catch {
                return String(rawDay)
              }
            })()
          : String(rawDay ?? '')
      const day = normalizeDayKey(dayRaw, weekDates)
      const interval = normalizeIntervalLabel(String(record[intervalCol] ?? ''))
      if (!day) {
        errors.push(`Unrecognized day: ${dayRaw}`)
        continue
      }
      if (!interval || !validIntervals.has(interval)) {
        errors.push(`Invalid interval: ${String(record[intervalCol] ?? '')}`)
        continue
      }

      let absenteeismPct = 0
      let inOfficePct = 0
      let shrinkagePct = 0

      if (combinedCol && !absCol && !inOfficeCol) {
        const combined = parseNumeric(record[combinedCol])
        if (combined == null || combined < 0 || combined > 100) {
          errors.push(`${day} ${interval}: Shrinkage_Pct must be 0–100`)
          continue
        }
        shrinkagePct = clampPct(combined)
      } else {
        const abs = absCol ? parseNumeric(record[absCol]) : 0
        const office = inOfficeCol ? parseNumeric(record[inOfficeCol]) : 0
        if (abs == null || abs < 0 || abs > 100) {
          errors.push(`${day} ${interval}: Absenteeism_Pct must be 0–100`)
          continue
        }
        if (office == null || office < 0 || office > 100) {
          errors.push(`${day} ${interval}: InOffice_Pct must be 0–100`)
          continue
        }
        absenteeismPct = clampPct(abs)
        inOfficePct = clampPct(office)
        shrinkagePct = combinedApplyShrinkagePct(absenteeismPct, inOfficePct)
      }

      rows.push({ day, interval, absenteeismPct, inOfficePct, shrinkagePct })
      if (!intervalApplyShrinkagePct[day]) intervalApplyShrinkagePct[day] = {}
      intervalApplyShrinkagePct[day]![interval] = shrinkagePct
    }

    if (rows.length) {
      return {
        rows,
        errors: errors.slice(0, 12),
        intervalApplyShrinkagePct,
      }
    }
  }

  errors.push(
    'Could not parse Apply Shrinkage file. Use columns: Day, Interval, Shrinkage_Pct (or Absenteeism_Pct + InOffice_Pct).',
  )
  return { rows: [], errors, intervalApplyShrinkagePct: {} }
}

export async function parseShrinkageFile(file: File, weekDates: string[]) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  return parseShrinkageWorkbook(workbook, weekDates)
}

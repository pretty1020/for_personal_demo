import * as XLSX from 'xlsx'

import type { VolumeAhtRow } from './types'
import {
  buildWeekDateKeys,
  normalizeDayKey,
  normalizeIntervalLabel,
} from './intervalSlots'

export const VOLUME_AHT_HEADERS = ['Day', 'Interval', 'Volume', 'AHT_Seconds'] as const

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
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim())
  return Number.isFinite(parsed) ? parsed : null
}

export function parseVolumeAhtWorkbook(
  workbook: XLSX.WorkBook,
  weekStartIso: string,
): { rows: VolumeAhtRow[]; errors: string[] } {
  const weekDates = buildWeekDateKeys(weekStartIso)
  const errors: string[] = []
  const sheetNames = [...workbook.SheetNames]
  const preferred =
    sheetNames.find((name) => normalizeHeader(name).includes('volumeaht')) ??
    sheetNames.find((name) => normalizeHeader(name).includes('volume')) ??
    sheetNames[0]

  const orderedSheets = preferred ? [preferred, ...sheetNames.filter((name) => name !== preferred)] : sheetNames

  for (const sheetName of orderedSheets) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const table = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    if (!table.length) continue

    const headers = Object.keys(table[0] ?? {})
    const dayCol = pickColumn(headers, ['day', 'date', 'weekday', 'dow'])
    const intervalCol = pickColumn(headers, ['interval', 'time', 'slot', 'halfhour'])
    const volumeCol = pickColumn(headers, ['volume', 'calls', 'contacts', 'demand', 'count'])
    const ahtCol = pickColumn(headers, [
      'ahtseconds',
      'aht',
      'averagedhandletime',
      'handletime',
      'ahtsec',
    ])

    if (!dayCol || !intervalCol || !volumeCol || !ahtCol) continue

    const rows: VolumeAhtRow[] = []
    for (const record of table) {
      const day = normalizeDayKey(String(record[dayCol] ?? ''), weekDates)
      const interval = normalizeIntervalLabel(String(record[intervalCol] ?? ''))
      const volume = parseNumeric(record[volumeCol])
      const ahtSeconds = parseNumeric(record[ahtCol])
      if (!day || !interval || volume == null || volume < 0 || ahtSeconds == null || ahtSeconds <= 0) continue
      rows.push({ day, interval, volume, ahtSeconds })
    }

    if (rows.length) return { rows, errors }
  }

  errors.push(
    'Could not parse Volume/AHT file. Use columns: Day, Interval, Volume, AHT_Seconds (download the template).',
  )
  return { rows: [], errors }
}

export async function parseVolumeAhtFile(file: File, weekStartIso: string) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  return parseVolumeAhtWorkbook(workbook, weekStartIso)
}

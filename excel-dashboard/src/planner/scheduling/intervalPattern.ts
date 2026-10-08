import * as XLSX from 'xlsx'
import type { IntervalPatternRow, WeekIntervalPattern } from './types'
import {
  allIntervalTimes,
  buildWeekDateKeys,
  intervalToMinutes,
  normalizeDayKey,
  normalizeIntervalLabel,
} from './intervalSlots'

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

export function parseIntervalPatternWorkbook(
  workbook: XLSX.WorkBook,
  weekStartIso: string,
): { rows: IntervalPatternRow[]; errors: string[] } {
  const weekDates = buildWeekDateKeys(weekStartIso)
  const errors: string[] = []
  const sheetNames = [...workbook.SheetNames]
  const preferred = sheetNames.find((name) => normalizeHeader(name).includes('intervalpattern')) ?? sheetNames[0]
  const orderedSheets = preferred ? [preferred, ...sheetNames.filter((name) => name !== preferred)] : sheetNames

  for (const sheetName of orderedSheets) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const table = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    if (!table.length) continue

    const headers = Object.keys(table[0] ?? {})
    const dayCol = pickColumn(headers, ['day', 'date', 'weekday', 'dow'])
    const intervalCol = pickColumn(headers, ['interval', 'time', 'slot', 'halfhour', 'half_hour', 'timestamp'])
    const valueCol = pickColumn(headers, ['value', 'volume', 'calls', 'contacts', 'demand', 'count', 'transactions'])

    const rows: IntervalPatternRow[] = []

    if (dayCol && intervalCol && valueCol) {
      for (const record of table) {
        const day = normalizeDayKey(String(record[dayCol] ?? ''), weekDates)
        const interval = normalizeIntervalLabel(String(record[intervalCol] ?? ''))
        const value = parseNumeric(record[valueCol])
        if (!day || !interval || value == null || value < 0) continue
        rows.push({ day, interval, value })
      }
    } else {
      const intervalHeader = headers.find((header) => normalizeIntervalLabel(header))
      if (intervalHeader) {
        for (const record of table) {
          const interval = normalizeIntervalLabel(String(record[intervalHeader] ?? intervalHeader))
          if (!interval) continue
          for (const header of headers) {
            if (header === intervalHeader) continue
            const day = normalizeDayKey(header, weekDates)
            const value = parseNumeric(record[header])
            if (!day || value == null || value < 0) continue
            rows.push({ day, interval, value })
          }
        }
      }
    }

    if (rows.length) return { rows, errors }
  }

  errors.push(
    'Could not parse interval pattern. Use columns Day, Interval, Value — or a matrix with interval times as rows and day names/dates as columns.',
  )
  return { rows: [], errors }
}

export async function parseIntervalPatternFile(file: File, weekStartIso: string) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  return parseIntervalPatternWorkbook(workbook, weekStartIso)
}

/** Convert raw interval values into percentage distribution per day (pattern only). Rest days stay zero. */
export function buildWeekIntervalPattern(rows: IntervalPatternRow[], weekDates: string[]): WeekIntervalPattern {
  const slots = allIntervalTimes()
  const bucket = new Map<string, number>()
  const dayTotals = new Map<string, number>()

  for (const row of rows) {
    const key = `${row.day}|${row.interval}`
    bucket.set(key, (bucket.get(key) ?? 0) + row.value)
    if (row.value > 0) {
      dayTotals.set(row.day, (dayTotals.get(row.day) ?? 0) + row.value)
    }
  }

  const pattern: WeekIntervalPattern = {}
  for (const day of weekDates) {
    const dayTotal = dayTotals.get(day) ?? 0
    const dayPattern: Record<string, number> = {}
    for (const interval of slots) {
      const raw = bucket.get(`${day}|${interval}`) ?? 0
      dayPattern[interval] = dayTotal > 0 ? (raw / dayTotal) * 100 : 0
    }
    pattern[day] = dayPattern
  }
  return pattern
}

export function averagePatternAcrossWeek(pattern: WeekIntervalPattern, weekDates: string[]): Record<string, number> {
  const slots = allIntervalTimes()
  const averaged: Record<string, number> = {}
  for (const interval of slots) {
    const values = weekDates.map((day) => pattern[day]?.[interval] ?? 0)
    averaged[interval] = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
  }
  return averaged
}

export function fillMissingDaysFromAverage(pattern: WeekIntervalPattern, weekDates: string[]): WeekIntervalPattern {
  const average = averagePatternAcrossWeek(pattern, weekDates)
  const next: WeekIntervalPattern = { ...pattern }
  for (const day of weekDates) {
    const dayTotal = Object.values(next[day] ?? {}).reduce((sum, value) => sum + value, 0)
    if (dayTotal <= 0.001) next[day] = { ...average }
  }
  return next
}

export function isPatternReady(pattern: WeekIntervalPattern, weekDates: string[]): boolean {
  return weekDates.some((day) => Object.values(pattern[day] ?? {}).some((value) => value > 0))
}

/**
 * Map pattern rows onto the current planning week by calendar weekday.
 * Fixes orphaned ISO dates after Sunday/Monday week snaps (e.g. Sun Jul 19 → Sun Jul 12).
 */
export function reconcilePatternRowsToWeekDates(
  rows: IntervalPatternRow[],
  weekDates: string[],
): IntervalPatternRow[] {
  if (!rows.length || !weekDates.length) return rows
  const weekSet = new Set(weekDates)
  const byDow = new Map<number, string>()
  for (const day of weekDates) {
    byDow.set(new Date(`${day}T12:00:00`).getDay(), day)
  }

  const alreadyAligned = rows.every((row) => row.value <= 0 || weekSet.has(row.day))
  if (alreadyAligned) return rows

  const merged = new Map<string, number>()
  for (const row of rows) {
    let day = weekSet.has(row.day) ? row.day : null
    if (!day) {
      const iso = row.day.slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        const dow = new Date(`${iso}T12:00:00`).getDay()
        day = byDow.get(dow) ?? null
      }
    }
    if (!day) continue
    const key = `${day}|${row.interval}`
    merged.set(key, (merged.get(key) ?? 0) + Math.max(0, row.value))
  }

  return [...merged.entries()].map(([key, value]) => {
    const sep = key.indexOf('|')
    return {
      day: key.slice(0, sep),
      interval: key.slice(sep + 1),
      value,
    }
  })
}

/** True when the user has uploaded pattern rows with positive volume for the planning week. */
export function hasUploadedPatternData(rows: IntervalPatternRow[], weekDates: string[]): boolean {
  if (!rows.length || !weekDates.length) return false
  return reconcilePatternRowsToWeekDates(rows, weekDates).some((row) => row.value > 0)
}

export function sortIntervals(intervals: string[]): string[] {
  return [...intervals].sort((a, b) => intervalToMinutes(a) - intervalToMinutes(b))
}

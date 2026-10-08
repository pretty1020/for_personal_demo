/**
 * Staffing Plan volume forecasting — Offered Volume → Forecast Volume.
 * Handles historical series extraction, DOW factors, and grain aggregation.
 */

import type { WeekStart } from './types'
import type { WeeklyLedgerRow } from './weeklyLedger'
import { snapToWeekStart } from './capacityWeekUtils'
import {
  pickBestForecastModel,
  runVolumeForecastModels,
  type ForecastModelResult,
} from './volumeForecastModels'

export type VolumeHistoryGrain = 'daily' | 'weekly' | 'monthly'

export type VolumeHistoryPoint = {
  /** ISO date (day) or week-start ISO or YYYY-MM for monthly. */
  date: string
  volume: number
}

export type DayOfWeekFactor = {
  /** 0 = Sunday … 6 = Saturday (JS getDay). */
  day: number
  label: string
  /** Share of weekly volume (sums ≈ 1 when all days present). */
  share: number
  /** Average daily volume for this weekday. */
  avgVolume: number
}

export type WeeklyVolumePoint = {
  week: string
  volume: number
  source: 'ledger' | 'upload'
}

export type VolumeForecastRun = {
  history: WeeklyVolumePoint[]
  models: ForecastModelResult[]
  bestModel: ForecastModelResult | null
  selectedModelId: string | null
  /** Future week ISO → forecast volume from the selected (or best) model. */
  forecastByWeek: Record<string, number>
  dayOfWeekFactors: DayOfWeekFactor[]
  grain: VolumeHistoryGrain | 'ledger'
  message: string
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function weekMonthKey(iso: string): string {
  return iso.length >= 7 ? iso.slice(0, 7) : iso
}

function parseIsoDate(value: string): Date | null {
  const raw = value.trim()
  if (!raw) return null
  // YYYY-MM → first of month
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}-01T12:00:00`)
    return Number.isNaN(d.getTime()) ? null : d
  }
  // YYYY-MM-DD or MM/DD/YYYY
  const iso = raw.includes('/')
    ? (() => {
        const [a, b, c] = raw.split(/[/\-.]/).map((t) => t.trim())
        if (!a || !b || !c) return raw
        // Prefer MDY when first token ≤ 12
        if (Number(a) <= 12) return `${c.padStart(4, '20')}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`
        return `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}`
      })()
    : raw
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Build day-of-week share factors from daily history. */
export function computeDayOfWeekFactors(daily: VolumeHistoryPoint[]): DayOfWeekFactor[] {
  const buckets = Array.from({ length: 7 }, () => ({ sum: 0, count: 0 }))
  for (const point of daily) {
    const d = parseIsoDate(point.date)
    if (!d || !(point.volume > 0)) continue
    const day = d.getDay()
    buckets[day]!.sum += point.volume
    buckets[day]!.count += 1
  }
  const avgs = buckets.map((b) => (b.count > 0 ? b.sum / b.count : 0))
  const total = avgs.reduce((s, v) => s + v, 0)
  return avgs.map((avg, day) => ({
    day,
    label: DOW_LABELS[day]!,
    avgVolume: Math.round(avg * 100) / 100,
    share: total > 0 ? avg / total : 1 / 7,
  }))
}

/** Aggregate daily points to week-start ISO volumes. */
export function aggregateDailyToWeekly(
  daily: VolumeHistoryPoint[],
  weekStart: WeekStart,
): WeeklyVolumePoint[] {
  const byWeek = new Map<string, number>()
  for (const point of daily) {
    const d = parseIsoDate(point.date)
    if (!d || !Number.isFinite(point.volume)) continue
    const week = snapToWeekStart(isoDate(d), weekStart)
    byWeek.set(week, (byWeek.get(week) ?? 0) + Math.max(0, point.volume))
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, volume]) => ({ week, volume: Math.round(volume), source: 'upload' as const }))
}

/** Aggregate monthly YYYY-MM totals into weekly points (even split across weeks in month). */
export function aggregateMonthlyToWeekly(
  monthly: VolumeHistoryPoint[],
  weekStart: WeekStart,
): WeeklyVolumePoint[] {
  const byWeek = new Map<string, number>()
  for (const point of monthly) {
    const monthKey = point.date.trim().slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(monthKey) || !Number.isFinite(point.volume)) continue
    const [year, month] = monthKey.split('-').map(Number)
    const first = new Date(year!, month! - 1, 1, 12, 0, 0)
    const last = new Date(year!, month!, 0, 12, 0, 0)
    const weeks: string[] = []
    for (let cursor = new Date(first); cursor <= last; cursor.setDate(cursor.getDate() + 7)) {
      weeks.push(snapToWeekStart(isoDate(cursor), weekStart))
    }
    // Include last week of month if not already captured
    const lastWeek = snapToWeekStart(isoDate(last), weekStart)
    if (!weeks.includes(lastWeek)) weeks.push(lastWeek)
    const unique = [...new Set(weeks)].sort((a, b) => a.localeCompare(b))
    // Only weeks whose month key matches (avoid spilling prior/next month week-start)
    const inMonth = unique.filter((w) => weekMonthKey(w) === monthKey)
    const targets = inMonth.length ? inMonth : unique
    const each = point.volume / targets.length
    for (const week of targets) {
      byWeek.set(week, (byWeek.get(week) ?? 0) + each)
    }
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, volume]) => ({ week, volume: Math.round(volume), source: 'upload' as const }))
}

export function normalizeWeeklyUpload(
  points: VolumeHistoryPoint[],
  weekStart: WeekStart,
): WeeklyVolumePoint[] {
  const byWeek = new Map<string, number>()
  for (const point of points) {
    const d = parseIsoDate(point.date)
    if (!d || !Number.isFinite(point.volume)) continue
    const week = snapToWeekStart(isoDate(d), weekStart)
    byWeek.set(week, (byWeek.get(week) ?? 0) + Math.max(0, point.volume))
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, volume]) => ({ week, volume: Math.round(volume), source: 'upload' as const }))
}

/** Offered Volume (actual callVolume) from ledger Actual / historical weeks. */
export function extractOfferedVolumeHistory(ledger: WeeklyLedgerRow[]): WeeklyVolumePoint[] {
  const out: WeeklyVolumePoint[] = []
  for (const row of ledger) {
    const vol = row.actual?.callVolume
    if (vol == null || !Number.isFinite(vol) || vol <= 0) continue
    // Any week with measured actual Offered Volume (historical or elapsed forward weeks).
    out.push({ week: row.week, volume: Math.round(vol), source: 'ledger' })
  }
  return out.sort((a, b) => a.week.localeCompare(b.week))
}

export function futurePlanWeeks(ledger: WeeklyLedgerRow[], fromWeek?: string | null): string[] {
  return ledger
    .filter((row) => row.timeline === 'forward_plan')
    .map((row) => row.week)
    .filter((week) => !fromWeek || week >= fromWeek)
    .sort((a, b) => a.localeCompare(b))
}

export function runVolumeForecast(options: {
  history: WeeklyVolumePoint[]
  futureWeeks: string[]
  dayOfWeekFactors?: DayOfWeekFactor[]
  grain?: VolumeHistoryGrain | 'ledger'
  selectedModelId?: string | null
}): VolumeForecastRun {
  const history = [...options.history].sort((a, b) => a.week.localeCompare(b.week))
  const series = history.map((p) => p.volume)
  const futureWeeks = [...options.futureWeeks].sort((a, b) => a.localeCompare(b))
  const grain = options.grain ?? 'ledger'

  if (series.length < 3) {
    return {
      history,
      models: [],
      bestModel: null,
      selectedModelId: null,
      forecastByWeek: {},
      dayOfWeekFactors: options.dayOfWeekFactors ?? [],
      grain,
      message:
        'Need at least 3 weeks of Offered Volume (Actual) or uploaded history to forecast.',
    }
  }

  const models = runVolumeForecastModels(series, Math.max(1, futureWeeks.length))
  const bestModel = pickBestForecastModel(models)
  const selected =
    (options.selectedModelId
      ? models.find((m) => m.id === options.selectedModelId)
      : null) ?? bestModel

  const forecastByWeek: Record<string, number> = {}
  if (selected) {
    futureWeeks.forEach((week, index) => {
      const raw = selected.horizon[index] ?? selected.horizon[selected.horizon.length - 1] ?? 0
      forecastByWeek[week] = Math.max(0, Math.round(raw))
    })
  }

  return {
    history,
    models,
    bestModel,
    selectedModelId: selected?.id ?? null,
    forecastByWeek,
    dayOfWeekFactors: options.dayOfWeekFactors ?? [],
    grain,
    message: selected
      ? `Best fit: ${bestModel?.label ?? '—'} (lowest MAPE). Showing ${selected.label}.`
      : 'No models produced a valid fit.',
  }
}

/** Parse a simple CSV string: Date/Week/Month, Volume columns. */
export function parseVolumeHistoryCsv(
  text: string,
  grain: VolumeHistoryGrain,
): { points: VolumeHistoryPoint[]; error: string } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 2) return { points: [], error: 'File needs a header row and at least one data row.' }

  const header = splitCsvLine(lines[0]!)
  const dateIdx = header.findIndex((h) => /^(date|week|month|period|day)$/i.test(h.trim()))
  const volIdx = header.findIndex((h) =>
    /^(volume|offeredvolume|offered|calls|contacts|transactions|forecastvolume)$/i.test(
      h.trim().replace(/\s+/g, ''),
    ),
  )
  if (dateIdx < 0 || volIdx < 0) {
    return {
      points: [],
      error: 'Header must include Date/Week/Month and Volume (or OfferedVolume) columns.',
    }
  }

  const points: VolumeHistoryPoint[] = []
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line)
    const date = (cols[dateIdx] ?? '').trim()
    const volume = Number(String(cols[volIdx] ?? '').replace(/,/g, ''))
    if (!date || !Number.isFinite(volume)) continue
    if (grain === 'monthly' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      points.push({ date: date.slice(0, 7), volume })
    } else {
      points.push({ date, volume })
    }
  }
  if (!points.length) return { points: [], error: 'No valid volume rows found.' }
  return { points, error: '' }
}

function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (ch === ',' && !inQuotes) {
      out.push(cur)
      cur = ''
      continue
    }
    cur += ch
  }
  out.push(cur)
  return out
}

export function historyPointsToWeekly(
  points: VolumeHistoryPoint[],
  grain: VolumeHistoryGrain,
  weekStart: WeekStart,
): { weekly: WeeklyVolumePoint[]; dayOfWeekFactors: DayOfWeekFactor[] } {
  if (grain === 'daily') {
    return {
      weekly: aggregateDailyToWeekly(points, weekStart),
      dayOfWeekFactors: computeDayOfWeekFactors(points),
    }
  }
  if (grain === 'monthly') {
    return { weekly: aggregateMonthlyToWeekly(points, weekStart), dayOfWeekFactors: [] }
  }
  return { weekly: normalizeWeeklyUpload(points, weekStart), dayOfWeekFactors: [] }
}

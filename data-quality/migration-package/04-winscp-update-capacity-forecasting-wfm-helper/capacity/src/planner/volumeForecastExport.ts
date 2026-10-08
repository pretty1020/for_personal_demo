/**
 * Download Forecast Volume at Daily / Weekly / Monthly grains from a model run.
 * Weekly is the model output; Daily uses DOW shares (or equal 1/7); Monthly sums weeks.
 */

import * as XLSX from 'xlsx'
import { triggerDownloadCsv } from '../utils/exportCsv'
import { isoDate, snapToWeekStart } from './capacityWeekUtils'
import type { WeekStart } from './types'
import type { DayOfWeekFactor, VolumeForecastRun, WeeklyVolumePoint } from './volumeForecastEngine'

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export type ForecastDownloadGrain = 'daily' | 'weekly' | 'monthly'

export type WeeklyForecastRow = {
  week: string
  forecastVolume: number
  modelId: string
  modelLabel: string
  isBestFit: boolean
}

export type DailyForecastRow = {
  date: string
  week: string
  day: string
  forecastVolume: number
  modelId: string
  modelLabel: string
}

export type MonthlyForecastRow = {
  month: string
  forecastVolume: number
  weekCount: number
  modelId: string
  modelLabel: string
}

function weekMonthKey(weekIso: string): string {
  return weekIso.length >= 7 ? weekIso.slice(0, 7) : weekIso
}

function parseWeekStart(weekIso: string): Date | null {
  const d = new Date(`${weekIso.slice(0, 10)}T12:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Equal weekday shares when no daily history was uploaded. */
export function defaultDayOfWeekFactors(): DayOfWeekFactor[] {
  return DOW_LABELS.map((label, day) => ({
    day,
    label,
    share: 1 / 7,
    avgVolume: 0,
  }))
}

function normalizedShares(factors: DayOfWeekFactor[]): number[] {
  const source = factors.length === 7 ? factors : defaultDayOfWeekFactors()
  const shares = Array.from({ length: 7 }, (_, day) => {
    const hit = source.find((f) => f.day === day)
    return hit && Number.isFinite(hit.share) && hit.share > 0 ? hit.share : 0
  })
  const total = shares.reduce((sum, value) => sum + value, 0)
  if (!(total > 0)) return Array.from({ length: 7 }, () => 1 / 7)
  return shares.map((value) => value / total)
}

/**
 * Split a weekly forecast across the 7 calendar days of that week using DOW shares.
 * Day volumes are whole numbers that always sum exactly to the weekly total.
 */
export function disaggregateWeeklyForecastToDaily(
  forecastByWeek: Record<string, number>,
  factors: DayOfWeekFactor[],
  weekStart: WeekStart,
  meta: { modelId: string; modelLabel: string },
): DailyForecastRow[] {
  const shares = normalizedShares(factors)
  const rows: DailyForecastRow[] = []
  const weeks = Object.keys(forecastByWeek).sort((a, b) => a.localeCompare(b))

  for (const week of weeks) {
    const weekly = Math.max(0, Math.round(forecastByWeek[week] ?? 0))
    const start = parseWeekStart(snapToWeekStart(week, weekStart))
    if (!start) continue

    const dayVolumes: number[] = []
    let allocated = 0
    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const dow = d.getDay()
      if (i === 6) {
        dayVolumes.push(Math.max(0, weekly - allocated))
      } else {
        const part = Math.round(weekly * shares[dow]!)
        dayVolumes.push(part)
        allocated += part
      }
    }
    // If early rounding overshot, pull back from the last positive day.
    let drift = dayVolumes.reduce((sum, value) => sum + value, 0) - weekly
    for (let i = 6; drift !== 0 && i >= 0; i--) {
      const adjustable = dayVolumes[i]!
      if (drift > 0 && adjustable > 0) {
        const cut = Math.min(adjustable, drift)
        dayVolumes[i] = adjustable - cut
        drift -= cut
      } else if (drift < 0) {
        dayVolumes[i] = adjustable - drift
        drift = 0
      }
    }

    for (let i = 0; i < 7; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      rows.push({
        date: isoDate(d),
        week,
        day: DOW_LABELS[d.getDay()]!,
        forecastVolume: dayVolumes[i]!,
        modelId: meta.modelId,
        modelLabel: meta.modelLabel,
      })
    }
  }

  return rows
}

export function aggregateWeeklyForecastToMonthly(
  forecastByWeek: Record<string, number>,
  meta: { modelId: string; modelLabel: string },
): MonthlyForecastRow[] {
  const byMonth = new Map<string, { volume: number; weekCount: number }>()
  for (const [week, volume] of Object.entries(forecastByWeek)) {
    const month = weekMonthKey(week)
    const current = byMonth.get(month) ?? { volume: 0, weekCount: 0 }
    current.volume += Math.max(0, Math.round(volume))
    current.weekCount += 1
    byMonth.set(month, current)
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, item]) => ({
      month,
      forecastVolume: item.volume,
      weekCount: item.weekCount,
      modelId: meta.modelId,
      modelLabel: meta.modelLabel,
    }))
}

export function buildWeeklyForecastRows(run: VolumeForecastRun): WeeklyForecastRow[] {
  const model =
    run.models.find((item) => item.id === run.selectedModelId) ?? run.bestModel
  const modelId = model?.id ?? 'none'
  const modelLabel = model?.label ?? 'No model'
  const isBestFit = Boolean(run.bestModel && run.bestModel.id === modelId)
  return Object.entries(run.forecastByWeek)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, volume]) => ({
      week,
      forecastVolume: Math.max(0, Math.round(volume)),
      modelId,
      modelLabel,
      isBestFit,
    }))
}

function resolveModelMeta(run: VolumeForecastRun): { modelId: string; modelLabel: string } {
  const model =
    run.models.find((item) => item.id === run.selectedModelId) ?? run.bestModel
  return {
    modelId: model?.id ?? 'none',
    modelLabel: model?.label ?? 'No model',
  }
}

function safeFileBase(scenarioName: string, grain: string): string {
  const stamp = new Date().toISOString().slice(0, 10)
  const name = scenarioName.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'StaffingPlan'
  return `${name}_ForecastVolume_${grain}_${stamp}`
}

function csvEscape(value: string | number | boolean): string {
  const text = String(value)
  if (/[,"\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

function rowsToCsv(headers: string[], rows: Array<Record<string, string | number | boolean>>): string {
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header] ?? '')).join(','))
  }
  return lines.join('\r\n')
}

export function buildForecastDownloadBundle(
  run: VolumeForecastRun,
  weekStart: WeekStart,
): {
  meta: { modelId: string; modelLabel: string }
  weekly: WeeklyForecastRow[]
  daily: DailyForecastRow[]
  monthly: MonthlyForecastRow[]
} {
  const meta = resolveModelMeta(run)
  const weekly = buildWeeklyForecastRows(run)
  const factors =
    run.dayOfWeekFactors.length === 7 ? run.dayOfWeekFactors : defaultDayOfWeekFactors()
  const daily = disaggregateWeeklyForecastToDaily(run.forecastByWeek, factors, weekStart, meta)
  const monthly = aggregateWeeklyForecastToMonthly(run.forecastByWeek, meta)
  return { meta, weekly, daily, monthly }
}

/** Download a single-grain Forecast Volume CSV for the selected / best model. */
export function downloadForecastVolumeCsv(
  run: VolumeForecastRun,
  grain: ForecastDownloadGrain,
  weekStart: WeekStart,
  scenarioName: string,
): { ok: true; rows: number } | { ok: false; error: string } {
  if (!Object.keys(run.forecastByWeek).length) {
    return { ok: false, error: 'No forecast values to download. Run a model with enough history first.' }
  }
  const bundle = buildForecastDownloadBundle(run, weekStart)
  if (grain === 'weekly') {
    const csv = rowsToCsv(
      ['Week', 'ForecastVolume', 'ModelId', 'ModelLabel', 'BestFit'],
      bundle.weekly.map((row) => ({
        Week: row.week,
        ForecastVolume: row.forecastVolume,
        ModelId: row.modelId,
        ModelLabel: row.modelLabel,
        BestFit: row.isBestFit ? 'Yes' : 'No',
      })),
    )
    triggerDownloadCsv(csv, safeFileBase(scenarioName, 'Weekly'))
    return { ok: true, rows: bundle.weekly.length }
  }
  if (grain === 'daily') {
    const csv = rowsToCsv(
      ['Date', 'Week', 'Day', 'ForecastVolume', 'ModelId', 'ModelLabel'],
      bundle.daily.map((row) => ({
        Date: row.date,
        Week: row.week,
        Day: row.day,
        ForecastVolume: row.forecastVolume,
        ModelId: row.modelId,
        ModelLabel: row.modelLabel,
      })),
    )
    triggerDownloadCsv(csv, safeFileBase(scenarioName, 'Daily'))
    return { ok: true, rows: bundle.daily.length }
  }
  const csv = rowsToCsv(
    ['Month', 'ForecastVolume', 'WeekCount', 'ModelId', 'ModelLabel'],
    bundle.monthly.map((row) => ({
      Month: row.month,
      ForecastVolume: row.forecastVolume,
      WeekCount: row.weekCount,
      ModelId: row.modelId,
      ModelLabel: row.modelLabel,
    })),
  )
  triggerDownloadCsv(csv, safeFileBase(scenarioName, 'Monthly'))
  return { ok: true, rows: bundle.monthly.length }
}

/**
 * Excel workbook with Daily, Weekly, Monthly forecast sheets plus model errors and history.
 * Production-ready single download for WFM handoff.
 */
export function downloadForecastVolumeWorkbook(
  run: VolumeForecastRun,
  weekStart: WeekStart,
  scenarioName: string,
  history: WeeklyVolumePoint[],
): { ok: true } | { ok: false; error: string } {
  if (!Object.keys(run.forecastByWeek).length) {
    return { ok: false, error: 'No forecast values to download. Run a model with enough history first.' }
  }

  const bundle = buildForecastDownloadBundle(run, weekStart)
  const workbook = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      bundle.weekly.map((row) => ({
        Week: row.week,
        ForecastVolume: row.forecastVolume,
        ModelId: row.modelId,
        ModelLabel: row.modelLabel,
        BestFit: row.isBestFit ? 'Yes' : 'No',
      })),
    ),
    'Weekly_Forecast',
  )

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      bundle.daily.map((row) => ({
        Date: row.date,
        Week: row.week,
        Day: row.day,
        ForecastVolume: row.forecastVolume,
        ModelId: row.modelId,
        ModelLabel: row.modelLabel,
      })),
    ),
    'Daily_Forecast',
  )

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      bundle.monthly.map((row) => ({
        Month: row.month,
        ForecastVolume: row.forecastVolume,
        WeekCount: row.weekCount,
        ModelId: row.modelId,
        ModelLabel: row.modelLabel,
      })),
    ),
    'Monthly_Forecast',
  )

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      run.models.map((model) => ({
        ModelId: model.id,
        ModelLabel: model.label,
        MAPE_Pct: Number.isFinite(model.mapePct) ? Math.round(model.mapePct * 1000) / 1000 : '',
        RMSE: Number.isFinite(model.rmse) ? Math.round(model.rmse * 1000) / 1000 : '',
        MAE: Number.isFinite(model.mae) ? Math.round(model.mae * 1000) / 1000 : '',
        BestFit: run.bestModel?.id === model.id ? 'Yes' : 'No',
        Selected: run.selectedModelId === model.id ? 'Yes' : 'No',
      })),
    ),
    'Model_Errors',
  )

  if (history.length) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        history.map((point) => ({
          Week: point.week,
          OfferedVolume: point.volume,
          Source: point.source,
        })),
      ),
      'History_OfferedVolume',
    )
  }

  if (run.dayOfWeekFactors.length) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        run.dayOfWeekFactors.map((factor) => ({
          Day: factor.label,
          AvgVolume: factor.avgVolume,
          SharePct: Math.round(factor.share * 10000) / 100,
        })),
      ),
      'DayOfWeek_Factors',
    )
  }

  const horizonEnd = Object.keys(run.forecastByWeek).sort().at(-1)
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      { Field: 'Scenario', Value: scenarioName },
      { Field: 'SelectedModel', Value: bundle.meta.modelLabel },
      { Field: 'BestFitModel', Value: run.bestModel?.label ?? '' },
      { Field: 'HistoryWeeks', Value: history.length },
      { Field: 'ForecastWeeks', Value: Object.keys(run.forecastByWeek).length },
      { Field: 'HorizonEnd', Value: horizonEnd ?? '' },
      { Field: 'WeekStart', Value: weekStart },
      { Field: 'ExportedAt', Value: new Date().toISOString() },
      {
        Field: 'Notes',
        Value:
          'Daily = weekly forecast split by day-of-week shares (equal 1/7 when no daily history). Monthly = sum of weekly forecasts by week-start month.',
      },
    ]),
    'Export_Info',
  )

  XLSX.writeFile(workbook, `${safeFileBase(scenarioName, 'All')}.xlsx`)
  return { ok: true }
}

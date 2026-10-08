import * as XLSX from 'xlsx'
import { allIntervalTimes, buildWeekDateKeys, intervalToMinutes } from './intervalSlots'

export const INTERVAL_PATTERN_HEADERS = ['Day', 'Interval', 'Value'] as const

/** Demo week (Monday start) — align Scheduling page week picker to this date for a direct match. */
export const SAMPLE_INTERVAL_WEEK_START = '2026-07-06'

function dayLabelForIso(dayIso: string): string {
  const date = new Date(`${dayIso}T12:00:00`)
  return date.toLocaleDateString('en-US', { weekday: 'long' })
}

function intradayVolumeWeight(interval: string): number {
  const minutes = intervalToMinutes(interval)
  const hour = minutes / 60

  if (hour < 6) return 0.35 + hour * 0.05
  if (hour < 9) return 0.65 + (hour - 6) * 0.18
  if (hour < 12) return 1.05 + (hour - 9) * 0.08
  if (hour < 14) return 0.92
  if (hour < 17) return 1.0 + (hour - 14) * 0.06
  if (hour < 20) return 0.88 - (hour - 17) * 0.12
  return Math.max(0.25, 0.52 - (hour - 20) * 0.14)
}

function dayScaleForIso(dayIso: string): number {
  const dow = new Date(`${dayIso}T12:00:00`).getDay() // 0=Sun … 6=Sat
  if (dow === 0 || dow === 6) return 0.62
  if (dow === 5) return 0.88
  return 1
}

/** Relative contact volumes — pattern reference only, not staffing FTE. */
export function buildSampleIntervalPatternRows(weekStartIso = SAMPLE_INTERVAL_WEEK_START): string[][] {
  const weekDates = buildWeekDateKeys(weekStartIso)
  const intervals = allIntervalTimes()
  const rows: string[][] = [INTERVAL_PATTERN_HEADERS.slice()]

  weekDates.forEach((dayIso, dayIndex) => {
    const dayLabel = dayLabelForIso(dayIso)
    const scale = dayScaleForIso(dayIso)
    for (const interval of intervals) {
      const weight = intradayVolumeWeight(interval) * scale
      const value = Math.max(1, Math.round(weight * 100 + (dayIndex + 1) * 3))
      rows.push([dayLabel, interval, String(value)])
    }
  })

  return rows
}

const GUIDE_ROWS: (string | number)[][] = [
  ['Interval pattern upload — user guide'],
  [''],
  ['Purpose'],
  [
    'Upload this file on Scheduling to define intraday demand trend only. Values are converted to percentage distribution per day — they do NOT set Required FTE, Scheduled FTE, or agent counts.',
  ],
  [''],
  ['Required columns (long format)'],
  ['Day', 'Interval', 'Value'],
  ['Monday', '08:00', '120'],
  ['Monday', '08:30', '145'],
  ['…', '…', '…'],
  [''],
  ['Day column'],
  ['Accepted formats: Monday, Mon, or ISO date (YYYY-MM-DD) matching your selected planning week.'],
  [`Sample week in this file starts ${SAMPLE_INTERVAL_WEEK_START}. Prefer downloading the sample from Scheduling so it matches your selected planning week (Sunday or Monday start).`],
  [''],
  ['Interval column'],
  ['30-minute slots in 24-hour time: 00:00, 00:30, … 23:30. AM/PM labels are also accepted (e.g. 8:00 AM).'],
  [''],
  ['Value column'],
  [
    'Any positive number representing relative volume (calls, contacts, transactions). The system calculates each interval as a % of the daily total, then scales to Required Production FTE from Capacity Plan or manual input.',
  ],
  [''],
  ['Example'],
  ['If Monday Required Production FTE = 100 and 08:00 = 3% of daily volume → generated requirement = 3 FTE at 08:00.'],
  [''],
  ['Alternate format'],
  ['You may also upload a matrix with interval times as rows and day names/dates as columns.'],
  [''],
  ['Staffing sources (never from this file)'],
  ['Required FTE', 'Capacity Plan Production/Required FTE or manual weekly FTE'],
  ['Scheduled FTE', 'Capacity Plan Production HC or manual agent count'],
]

export function buildSampleIntervalPatternWorkbook(weekStartIso = SAMPLE_INTERVAL_WEEK_START): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildSampleIntervalPatternRows(weekStartIso)), 'Interval_Pattern')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(GUIDE_ROWS), 'Guide')
  return wb
}

export const SAMPLE_INTERVAL_PATTERN_FILENAME = 'Interval_Pattern_Sample.xlsx'

export function downloadSampleIntervalPatternTemplate(weekStartIso = SAMPLE_INTERVAL_WEEK_START): void {
  XLSX.writeFile(buildSampleIntervalPatternWorkbook(weekStartIso), SAMPLE_INTERVAL_PATTERN_FILENAME)
}

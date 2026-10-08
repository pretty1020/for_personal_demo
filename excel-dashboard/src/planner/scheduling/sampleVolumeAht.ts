import * as XLSX from 'xlsx'

import { allIntervalTimes, buildWeekDateKeys, intervalToMinutes } from './intervalSlots'
import { VOLUME_AHT_HEADERS } from './volumeAhtPattern'

function dayLabelForIso(dayIso: string): string {
  const date = new Date(`${dayIso}T12:00:00`)
  return date.toLocaleDateString('en-US', { weekday: 'long' })
}

function sampleVolume(interval: string): number {
  const hour = intervalToMinutes(interval) / 60
  if (hour < 8) return Math.round(8 + hour * 2)
  if (hour < 12) return Math.round(25 + (hour - 8) * 12)
  if (hour < 14) return 18
  if (hour < 18) return Math.round(30 + (hour - 14) * 8)
  return Math.max(5, Math.round(20 - (hour - 18) * 4))
}

export function buildSampleVolumeAhtRows(weekStartIso: string): string[][] {
  const weekDates = buildWeekDateKeys(weekStartIso)
  const intervals = allIntervalTimes().filter((interval) => {
    const hour = intervalToMinutes(interval) / 60
    return hour >= 7 && hour <= 20
  })
  const rows: string[][] = [VOLUME_AHT_HEADERS.slice()]

  for (const dayIso of weekDates) {
    const dayLabel = dayLabelForIso(dayIso)
    for (const interval of intervals) {
      rows.push([dayLabel, interval, String(sampleVolume(interval)), '320'])
    }
  }

  return rows
}

export function downloadVolumeAhtTemplate(weekStartIso: string, filename = 'volume-aht-template.xlsx') {
  const rows = buildSampleVolumeAhtRows(weekStartIso)
  const guide: (string | number)[][] = [
    ['Volume & AHT upload — for Projected Service Level and Occupancy'],
    [''],
    ['Required columns'],
    ['Day', 'Interval', 'Volume', 'AHT_Seconds'],
    ['Monday', '08:00', '120', '320'],
    [''],
    ['Day', 'Calendar day (Monday / Mon) or ISO date matching your planning week'],
    ['Interval', '30-minute slots: 08:00, 08:30, …'],
    ['Volume', 'Contacts / calls in the interval'],
    ['AHT_Seconds', 'Average handle time in seconds'],
    [''],
    ['Without this file, Occupancy uses Required÷Scheduled proxy and Projected SL is unavailable.'],
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'VolumeAHT')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(guide), 'Guide')
  XLSX.writeFile(workbook, filename)
}

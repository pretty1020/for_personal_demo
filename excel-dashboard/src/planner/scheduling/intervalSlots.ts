import type { IntervalTime } from './types'

export const INTERVAL_MINUTES = 30
export const INTERVALS_PER_DAY = (24 * 60) / INTERVAL_MINUTES

export function allIntervalTimes(): IntervalTime[] {
  const slots: IntervalTime[] = []
  for (let minutes = 0; minutes < 24 * 60; minutes += INTERVAL_MINUTES) {
    slots.push(minutesToInterval(minutes))
  }
  return slots
}

export function minutesToInterval(totalMinutes: number): IntervalTime {
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const hours = Math.floor(normalized / 60)
  const mins = normalized % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

export function intervalToMinutes(interval: IntervalTime): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(interval.trim())
  if (!match) return 0
  return Number(match[1]) * 60 + Number(match[2])
}

export function normalizeIntervalLabel(value: string): IntervalTime | null {
  const trimmed = value.trim()
  const colon = /^(\d{1,2}):(\d{2})$/.exec(trimmed)
  if (colon) {
    const mins = Number(colon[1]) * 60 + Number(colon[2])
    if (mins % INTERVAL_MINUTES !== 0) return null
    return minutesToInterval(mins)
  }
  const ampm = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(trimmed)
  if (ampm) {
    let hours = Number(ampm[1]) % 12
    if (ampm[3].toLowerCase() === 'pm') hours += 12
    const mins = hours * 60 + Number(ampm[2] ?? 0)
    if (mins % INTERVAL_MINUTES !== 0) return null
    return minutesToInterval(mins)
  }
  return null
}

export function normalizeDayKey(value: string, weekDates: string[]): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  const byName: Record<string, number> = {
    sun: 0,
    sunday: 0,
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    wednesday: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
  }
  if (lower in byName) {
    const weekStart = new Date(`${weekDates[0]}T12:00:00`)
    const weekStartDow = weekStart.getDay()
    const targetDow = byName[lower]
    const offset = (targetDow - weekStartDow + 7) % 7
    return weekDates[offset] ?? null
  }
  const iso = trimmed.slice(0, 10)
  if (weekDates.includes(iso)) return iso
  return null
}

function localIsoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Seven consecutive calendar days starting at weekStartIso (local date, not UTC). */
export function buildWeekDateKeys(weekStartIso: string, count = 7): string[] {
  const start = new Date(`${weekStartIso.slice(0, 10)}T12:00:00`)
  const dates: string[] = []
  for (let index = 0; index < count; index += 1) {
    const next = new Date(start)
    next.setDate(start.getDate() + index)
    dates.push(localIsoDate(next))
  }
  return dates
}

export function formatDayLabel(dayKey: string): string {
  const date = new Date(`${dayKey}T12:00:00`)
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

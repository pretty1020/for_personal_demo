/** Explainable anomaly scores for daily, weekly, and monthly series. */

export type Grain = 'daily' | 'weekly' | 'monthly'

export type SeriesPoint = {
  date: string
  value: number
}

export type Method = 'rhythm' | 'zscore' | 'iqr' | 'moving'

export type PointAction = 'valid' | 'invalid' | 'exclude' | 'impute' | 'interpolate'

export type ScoredPoint = SeriesPoint & {
  expected: number
  low: number
  high: number
  score: number
  anomaly: boolean
  reason: string
}

export type CleanedRow = {
  date: string
  value: number
  original: number
  action: PointAction | ''
}

export const DETECTION_METHODS: Array<{ id: Method; label: string; summary: string }> = [
  {
    id: 'rhythm',
    label: 'Usual level',
    summary: 'Compares each point with the middle of the points that share its rhythm. One spike does not move that middle. A quiet Saturday is judged against other Saturdays.',
  },
  {
    id: 'zscore',
    label: 'Z-score',
    summary: 'Compares each point with the average of those same matching points, in standard deviations. A spike can pull the average, so this method is less steady than the usual level.',
  },
  {
    id: 'iqr',
    label: 'Quartile fence',
    summary: 'Flags a point outside the middle half of its matching points. The sensitivity stretches or tightens that fence.',
  },
  {
    id: 'moving',
    label: 'Moving average',
    summary: 'Uses only the nearest matching points: recent Mondays, recent weeks, or the same month nearby. Older history stays out of the comparison.',
  },
]

export const POINT_ACTIONS: Array<{ id: PointAction; label: string; detail: string }> = [
  { id: 'valid', label: 'Valid', detail: 'Keep the number. It was a real event.' },
  { id: 'invalid', label: 'Invalid', detail: 'The reading is wrong. The cleaned series uses the usual level.' },
  { id: 'exclude', label: 'Exclude', detail: 'Drop this row from the cleaned series.' },
  { id: 'impute', label: 'Impute', detail: 'Fill the cleaned series with the usual level.' },
  { id: 'interpolate', label: 'Interpolate', detail: 'Bridge the cleaned series between the neighboring points.' },
]

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Daily contacts. Weekends sit lower on purpose. Two weekdays are broken; Saturdays are not. */
export function sampleDaily(): SeriesPoint[] {
  const start = new Date('2026-08-02T12:00:00')
  const points: SeriesPoint[] = []
  for (let i = 0; i < 64; i += 1) {
    const date = new Date(start)
    date.setDate(start.getDate() + i)
    const dow = date.getDay()
    const typical = [1500, 4200, 4480, 4600, 4420, 3900, 2100][dow]!
    const wobble = ((i * 13) % 11 - 5) * 28
    points.push({ date: isoDate(date), value: typical + wobble })
  }
  replace(points, '2026-09-16', 9800)
  replace(points, '2026-09-29', 900)
  return points
}

/** Weekly offered contacts. One spike and one drop, among a slow rise. */
export function sampleWeekly(): SeriesPoint[] {
  const start = new Date('2026-04-05T12:00:00')
  return Array.from({ length: 26 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index * 7)
    let value = 26800 + index * 180 + ((index * 5) % 4 - 1) * 220
    const iso = isoDate(date)
    if (iso === '2026-07-12') value = 51000
    if (iso === '2026-08-23') value = 14200
    return { date: iso, value }
  })
}

/** Two years of monthly volume. November and December are high every year. March 2025 is not. */
export function sampleMonthly(): SeriesPoint[] {
  const season = [0.9, 0.92, 0.95, 1, 1.02, 0.98, 0.96, 0.97, 1.05, 1.12, 1.28, 1.35]
  const points: SeriesPoint[] = []
  for (let year = 2024; year <= 2025; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-01`
      const value = Math.round(82000 * season[month]! + (year === 2025 ? 1500 : 0))
      points.push({ date: iso, value: iso === '2025-03-01' ? 31000 : value })
    }
  }
  return points
}

export function sampleSeries(grain: Grain): SeriesPoint[] {
  if (grain === 'weekly') return sampleWeekly()
  if (grain === 'monthly') return sampleMonthly()
  return sampleDaily()
}

export function scoreSeries(points: SeriesPoint[], grain: Grain, threshold: number, method: Method = 'rhythm'): ScoredPoint[] {
  const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const baselines = ordered.map((_, index) => {
    const peers = peerIndexes(ordered, index, grain).map((peer) => ordered[peer]!.value)
    return { peers, expected: peers.length ? median(peers) : ordered[index]!.value }
  })
  const globalSpread = median(ordered.map((point, index) => Math.abs(point.value - baselines[index]!.expected))) * 1.4826
  return ordered.map((point, index) => {
    const judged = judgePoint(ordered, index, grain, threshold, method, baselines[index]!, globalSpread)
    return {
      ...point,
      expected: Math.round(judged.expected),
      low: Math.round(judged.low),
      high: Math.round(judged.high),
      score: Math.round(judged.score * 10) / 10,
      anomaly: judged.anomaly,
      reason: explain(point, judged.expected, grain, judged.anomaly, judged.peers, judged.score),
    }
  })
}

export function cleanSeries(scored: ScoredPoint[], actions: Record<string, PointAction>): CleanedRow[] {
  const provisional = scored.map((point) => {
    const action = point.anomaly ? actions[point.date] : undefined
    if (action === 'exclude') return { value: point.value, action, skip: true }
    if (action === 'invalid' || action === 'impute') return { value: point.expected, action, skip: false }
    if (action === 'interpolate') return { value: Number.NaN, action, skip: false }
    return { value: point.value, action: action ?? ('' as const), skip: false }
  })
  const rows: CleanedRow[] = []
  provisional.forEach((row, index) => {
    if (row.skip) return
    const value = row.action === 'interpolate' ? interpolated(scored, provisional, index) : row.value
    rows.push({
      date: scored[index]!.date,
      value: Math.round(value),
      original: scored[index]!.value,
      action: row.action,
    })
  })
  return rows
}

export function toCleanedCsv(rows: CleanedRow[]): string {
  const lines = ['date,value,original,action', ...rows.map((row) => `${row.date},${row.value},${row.original},${row.action}`)]
  return `${lines.join('\n')}\n`
}

export function toCsv(points: SeriesPoint[]): string {
  const lines = ['date,value', ...points.map((point) => `${point.date},${point.value}`)]
  return `${lines.join('\n')}\n`
}

export function parseSeriesCsv(text: string): { points: SeriesPoint[]; error: string | null } {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  if (!lines.length) return { points: [], error: 'The file is empty.' }
  const table = lines.map((line) => line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, '')))
  let dateCol = 0
  let valueCol = 1
  let start = 0
  const header = table[0]!.map((cell) => cell.toLowerCase())
  const dateIndex = header.findIndex((cell) => ['date', 'week', 'month', 'day', 'period'].includes(cell))
  const valueIndex = header.findIndex((cell) => ['value', 'volume', 'contacts', 'amount', 'count', 'actual'].includes(cell))
  if (dateIndex >= 0 && valueIndex >= 0) {
    dateCol = dateIndex
    valueCol = valueIndex
    start = 1
  }
  const points: SeriesPoint[] = []
  table.slice(start).forEach((row, index) => {
    const rawDate = row[dateCol] ?? ''
    const rawValue = row[valueCol] ?? ''
    const date = normalizeDate(rawDate)
    const value = Number(rawValue.replace(/,/g, ''))
    if (!date || !Number.isFinite(value)) return
    points.push({ date, value })
    void index
  })
  if (!points.length) return { points: [], error: 'No rows with a date and a number were found. Use columns named date and value.' }
  const byDate = new Map<string, number>()
  points.forEach((point) => byDate.set(point.date, point.value))
  return {
    points: [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value })),
    error: null,
  }
}

export function formatPointDate(iso: string, grain: Grain): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  if (grain === 'monthly') return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function judgePoint(
  points: SeriesPoint[],
  index: number,
  grain: Grain,
  threshold: number,
  method: Method,
  baseline: { peers: number[]; expected: number },
  globalSpread: number,
) {
  const peers = peerIndexes(points, index, grain)
  const values = (method === 'moving'
    ? [...peers].sort((a, b) => Math.abs(a - index) - Math.abs(b - index)).slice(0, 4)
    : peers
  ).map((peer) => points[peer]!.value)
  if (method === 'zscore' && values.length >= 2) {
    const expected = mean(values)
    const spread = stdev(values)
    if (spread > 0) {
      const score = (points[index]!.value - expected) / spread
      const band = threshold * spread
      return { expected, low: expected - band, high: expected + band, score, anomaly: Math.abs(score) >= threshold, peers: values.length }
    }
  }
  if (method === 'iqr' && values.length >= 4) {
    const sorted = [...values].sort((a, b) => a - b)
    const q1 = quantile(sorted, 0.25)
    const q3 = quantile(sorted, 0.75)
    const iqr = q3 - q1
    if (iqr > 0) {
      const fence = (threshold / 2) * iqr
      const expected = median(values)
      const low = q1 - fence
      const high = q3 + fence
      const value = points[index]!.value
      const score = (value - expected) / (iqr / 1.349)
      return { expected, low, high, score, anomaly: value < low || value > high, peers: values.length }
    }
  }
  if (method === 'moving' && values.length >= 2) {
    const expected = mean(values)
    const spread = median(values.map((value) => Math.abs(value - expected))) * 1.4826
    if (spread > 0) {
      const score = (points[index]!.value - expected) / spread
      const band = threshold * spread
      return { expected, low: expected - band, high: expected + band, score, anomaly: Math.abs(score) >= threshold, peers: values.length }
    }
  }
  return rhythmJudgement(points[index]!.value, baseline, threshold, globalSpread)
}

function rhythmJudgement(
  value: number,
  baseline: { peers: number[]; expected: number },
  threshold: number,
  globalSpread: number,
) {
  if (!baseline.peers.length) return { expected: value, low: value, high: value, score: 0, anomaly: false, peers: 0 }
  const expected = baseline.expected
  const score = globalSpread === 0 ? (value === expected ? 0 : value > expected ? 99 : -99) : (value - expected) / globalSpread
  const band = Math.max(globalSpread, 0) * threshold
  return {
    expected,
    low: expected - band,
    high: expected + band,
    score,
    anomaly: Math.abs(score) >= threshold,
    peers: baseline.peers.length,
  }
}

function peerIndexes(points: SeriesPoint[], index: number, grain: Grain): number[] {
  const current = points[index]!
  if (grain === 'daily') {
    const day = new Date(`${current.date}T12:00:00`).getDay()
    return points.flatMap((point, peer) => (peer !== index && new Date(`${point.date}T12:00:00`).getDay() === day ? [peer] : []))
  }
  if (grain === 'monthly') {
    const month = current.date.slice(5, 7)
    const sameMonth = points.flatMap((point, peer) => (peer !== index && point.date.slice(5, 7) === month ? [peer] : []))
    if (sameMonth.length) return sameMonth
  }
  const reach = grain === 'monthly' ? 3 : 6
  const indexes: number[] = []
  for (let peer = Math.max(0, index - reach); peer < Math.min(points.length, index + reach + 1); peer += 1) {
    if (peer !== index) indexes.push(peer)
  }
  return indexes
}

function interpolated(
  scored: ScoredPoint[],
  provisional: Array<{ value: number; action: PointAction | ''; skip: boolean }>,
  index: number,
): number {
  let previous = index - 1
  while (previous >= 0 && (provisional[previous]!.skip || provisional[previous]!.action === 'interpolate')) previous -= 1
  let next = index + 1
  while (next < scored.length && (provisional[next]!.skip || provisional[next]!.action === 'interpolate')) next += 1
  if (previous < 0 || next >= scored.length) return scored[index]!.expected
  const span = next - previous
  const left = provisional[previous]!.value
  const right = provisional[next]!.value
  return left + ((right - left) * (index - previous)) / span
}

function explain(point: SeriesPoint, expected: number, grain: Grain, anomaly: boolean, peers: number, score: number): string {
  if (!peers) {
    if (grain === 'daily') return `Not enough other ${dayName(point.date)}s yet to know what is usual.`
    if (grain === 'monthly') return 'Not enough other months yet to know what is usual.'
    return 'Not enough nearby weeks yet to know what is usual.'
  }
  const comparison = grain === 'daily' ? `a typical ${dayName(point.date)}` : grain === 'monthly' ? `a typical ${monthName(point.date)}` : 'the surrounding weeks'
  if (!anomaly) return `Close to ${comparison} (${Math.round(expected).toLocaleString('en-US')}).`
  const direction = score > 0 ? 'higher' : 'lower'
  return `Much ${direction} than ${comparison} (${Math.round(expected).toLocaleString('en-US')}). Hold it out of the forecast until someone checks it.`
}

function dayName(iso: string): string {
  return DAY_NAMES[new Date(`${iso}T12:00:00`).getDay()] ?? 'day'
}

function monthName(iso: string): string {
  return MONTH_NAMES[Number(iso.slice(5, 7)) - 1] ?? 'month'
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function stdev(values: number[]): number {
  const avg = mean(values)
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function quantile(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p
  const low = Math.floor(pos)
  const high = Math.ceil(pos)
  if (low === high) return sorted[low]!
  return sorted[low]! * (high - pos) + sorted[high]! * (pos - low)
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2) return sorted[mid]!
  return (sorted[mid - 1]! + sorted[mid]!) / 2
}

function replace(points: SeriesPoint[], date: string, value: number) {
  const found = points.find((point) => point.date === date)
  if (found) found.value = value
}

function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function normalizeDate(raw: string): string | null {
  const value = raw.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value)
  if (slash) return `${slash[3]}-${slash[1]!.padStart(2, '0')}-${slash[2]!.padStart(2, '0')}`
  const named = new Date(`${value}T12:00:00`)
  if (!Number.isNaN(named.getTime()) && value.length > 6) return isoDate(named)
  return null
}

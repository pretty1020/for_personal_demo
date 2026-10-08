/**
 * Capacity Anomaly Detection — time-series quality gateway before forecasting.
 * Pure TypeScript: Z-score, IQR, MAD, STL residuals, Isolation Forest + DQ checks.
 */

import * as XLSX from 'xlsx'

export type SeriesFrequency = 'daily' | 'weekly' | 'monthly'
export type DetectionMethod = 'zscore' | 'iqr' | 'mad' | 'stl' | 'isolation_forest'
export type AnomalyType =
  | 'outlier'
  | 'spike'
  | 'dip'
  | 'level_shift'
  | 'change_point'
  | 'seasonality_break'
export type AnomalySeverity = 'low' | 'medium' | 'high' | 'critical'
export type AnomalyAction = 'keep' | 'exclude' | 'impute' | 'interpolate' | 'cap' | 'mark_valid' | 'mark_invalid'
export type QualitySeverity = 'info' | 'warning' | 'blocking'
export type ReadinessStatus = 'passed' | 'warnings' | 'blocking' | 'unchecked'

export type SeriesPoint = {
  timestamp: string
  value: number
  originalValue: number
  excluded?: boolean
}

export type DetectedAnomaly = {
  id: string
  timestamp: string
  value: number
  type: AnomalyType
  severity: AnomalySeverity
  score: number
  method: DetectionMethod
  action: AnomalyAction
  note?: string
}

export type QualityIssue = {
  id: string
  code: string
  title: string
  detail: string
  severity: QualitySeverity
  count?: number
}

export type ForecastReadiness = {
  status: ReadinessStatus
  blocking: QualityIssue[]
  warnings: QualityIssue[]
  infos: QualityIssue[]
  anomalyCount: number
  unresolvedCriticalAnomalies: number
  message: string
  checkedAt: string
  seriesLabel: string
  frequency: SeriesFrequency
  pointCount: number
}

export type DetectionOptions = {
  method: DetectionMethod
  /** 0–1; higher = more sensitive (more anomalies). Default 0.5 */
  sensitivity: number
  frequency: SeriesFrequency
}

export type ParsedSeriesFile = {
  columns: string[]
  rows: Record<string, string>[]
  preview: Record<string, string>[]
  error: string
}

const READINESS_STORAGE_KEY = 'cap.anomaly.forecastReadiness.v1'

function mean(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0
  const avg = mean(values)
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function mad(values: number[]): number {
  const med = median(values)
  return median(values.map((value) => Math.abs(value - med)))
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  const next = sorted[base + 1]
  if (next == null) return sorted[base]!
  return sorted[base]! + rest * (next - sorted[base]!)
}

function parseLooseDate(raw: string): Date | null {
  const text = raw.trim()
  if (!text) return null
  if (/^\d{4}-\d{2}$/.test(text)) {
    const d = new Date(`${text}-01T12:00:00`)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const d = new Date(`${text.slice(0, 10)}T12:00:00`)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(text)) {
    const [a, b, c] = text.split(/[/-]/).map((part) => part.trim())
    if (!a || !b || !c) return null
    const year = c.length === 2 ? `20${c}` : c
    const month = a.padStart(2, '0')
    const day = b.padStart(2, '0')
    // Prefer MDY when first token ≤ 12
    const iso = Number(a) <= 12 ? `${year}-${month}-${day}` : `${year}-${day}-${month}`
    const d = new Date(`${iso}T12:00:00`)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(text)
  return Number.isNaN(d.getTime()) ? null : d
}

export function toIsoTimestamp(date: Date, frequency: SeriesFrequency): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  if (frequency === 'monthly') return `${y}-${m}`
  return `${y}-${m}-${d}`
}

function expectedGapMs(frequency: SeriesFrequency): number {
  if (frequency === 'daily') return 24 * 60 * 60 * 1000
  if (frequency === 'weekly') return 7 * 24 * 60 * 60 * 1000
  return 30 * 24 * 60 * 60 * 1000
}

function seasonPeriod(frequency: SeriesFrequency): number {
  if (frequency === 'daily') return 7
  if (frequency === 'weekly') return 4
  return 12
}

function minPointsForFrequency(frequency: SeriesFrequency): number {
  if (frequency === 'daily') return 14
  if (frequency === 'weekly') return 8
  return 6
}

function severityFromScore(score: number, sensitivity: number): AnomalySeverity {
  const adj = score * (0.7 + sensitivity * 0.6)
  if (adj >= 4.5) return 'critical'
  if (adj >= 3.2) return 'high'
  if (adj >= 2.2) return 'medium'
  return 'low'
}

function anomalyTypeFromResidual(value: number, baseline: number, score: number): AnomalyType {
  if (score >= 3.5 && value > baseline) return 'spike'
  if (score >= 3.5 && value < baseline) return 'dip'
  return 'outlier'
}

/** Sensitivity 0–1 → threshold multiplier (lower threshold = more sensitive). */
function thresholdFor(method: DetectionMethod, sensitivity: number): number {
  const s = Math.min(1, Math.max(0, sensitivity))
  if (method === 'zscore') return 3.5 - s * 1.8
  if (method === 'iqr') return 2.2 - s * 1.0
  if (method === 'mad') return 3.5 - s * 1.8
  if (method === 'stl') return 3.2 - s * 1.6
  return 0.62 - s * 0.28 // isolation forest anomaly score cutoff
}

function movingAverage(values: number[], window: number): number[] {
  const half = Math.max(1, Math.floor(window / 2))
  return values.map((_, index) => {
    const start = Math.max(0, index - half)
    const end = Math.min(values.length, index + half + 1)
    return mean(values.slice(start, end))
  })
}

function stlResiduals(values: number[], period: number): number[] {
  const trend = movingAverage(values, Math.max(3, period))
  const detrended = values.map((value, index) => value - trend[index]!)
  const seasonal = new Array(values.length).fill(0) as number[]
  for (let season = 0; season < period; season++) {
    const bucket: number[] = []
    for (let i = season; i < values.length; i += period) bucket.push(detrended[i]!)
    const seasonMean = mean(bucket)
    for (let i = season; i < values.length; i += period) seasonal[i] = seasonMean
  }
  return values.map((value, index) => value - trend[index]! - seasonal[index]!)
}

/** Lightweight Isolation Forest (pure JS) — score in ~[0,1], higher = more anomalous. */
function isolationForestScores(values: number[], trees = 48, sampleSize = 128): number[] {
  const n = values.length
  if (n < 4) return values.map(() => 0)
  const c = (size: number) => {
    if (size <= 1) return 0
    const h = Math.log(size - 1) + 0.5772156649
    return 2 * h - (2 * (size - 1)) / size
  }
  const avgPath = new Array(n).fill(0) as number[]

  function pathLength(point: number, sample: number[], depth: number, maxDepth: number): number {
    if (sample.length <= 1 || depth >= maxDepth) return depth
    const min = Math.min(...sample)
    const max = Math.max(...sample)
    if (max === min) return depth
    const split = min + Math.random() * (max - min)
    const left = sample.filter((value) => value < split)
    const right = sample.filter((value) => value >= split)
    if (point < split) return pathLength(point, left.length ? left : sample, depth + 1, maxDepth)
    return pathLength(point, right.length ? right : sample, depth + 1, maxDepth)
  }

  for (let t = 0; t < trees; t++) {
    const size = Math.min(sampleSize, n)
    const sample: number[] = []
    for (let i = 0; i < size; i++) sample.push(values[Math.floor(Math.random() * n)]!)
    const maxDepth = Math.ceil(Math.log2(Math.max(2, size)))
    for (let i = 0; i < n; i++) {
      avgPath[i]! += pathLength(values[i]!, sample, 0, maxDepth)
    }
  }

  const cn = c(Math.min(sampleSize, n))
  return avgPath.map((path) => {
    const avg = path / trees
    const score = cn > 0 ? 2 ** (-avg / cn) : 0
    return score
  })
}

function detectLevelShifts(
  points: SeriesPoint[],
  sensitivity: number,
): Array<{ index: number; score: number; type: AnomalyType }> {
  const values = points.map((point) => point.value)
  const window = Math.max(3, Math.floor(values.length / 10))
  const hits: Array<{ index: number; score: number; type: AnomalyType }> = []
  if (values.length < window * 2 + 2) return hits
  const threshold = 2.4 - sensitivity * 1.2
  for (let i = window; i < values.length - window; i++) {
    const left = mean(values.slice(i - window, i))
    const right = mean(values.slice(i, i + window))
    const pooled = stdDev([...values.slice(i - window, i), ...values.slice(i, i + window)]) || 1
    const score = Math.abs(right - left) / pooled
    if (score >= threshold) {
      hits.push({
        index: i,
        score,
        type: score >= threshold + 1 ? 'level_shift' : 'change_point',
      })
    }
  }
  return hits
}

function detectSeasonalityBreaks(
  points: SeriesPoint[],
  frequency: SeriesFrequency,
  sensitivity: number,
): Array<{ index: number; score: number }> {
  const period = seasonPeriod(frequency)
  const values = points.map((point) => point.value)
  const hits: Array<{ index: number; score: number }> = []
  if (values.length < period * 3) return hits
  const residuals = stlResiduals(values, period)
  const half = Math.floor(values.length / 2)
  const earlyMad = mad(residuals.slice(0, half)) || 1
  const lateMad = mad(residuals.slice(half)) || 1
  const ratio = Math.max(earlyMad, lateMad) / Math.min(earlyMad, lateMad)
  const threshold = 2.2 - sensitivity * 0.8
  if (ratio >= threshold) {
    hits.push({ index: half, score: ratio })
  }
  return hits
}

export function runAnomalyDetection(
  points: SeriesPoint[],
  options: DetectionOptions,
): DetectedAnomaly[] {
  const active = points
    .map((point, index) => ({ point, index }))
    .filter((entry) => !entry.point.excluded && Number.isFinite(entry.point.value))
  if (active.length < 4) return []

  const values = active.map((entry) => entry.point.value)
  const method = options.method
  const sensitivity = options.sensitivity
  const threshold = thresholdFor(method, sensitivity)
  const anomalies = new Map<string, DetectedAnomaly>()

  const push = (
    index: number,
    type: AnomalyType,
    score: number,
    note?: string,
  ) => {
    const point = points[index]!
    const id = `${point.timestamp}:${type}:${method}`
    const existing = anomalies.get(id)
    const severity = severityFromScore(score, sensitivity)
    if (existing && existing.score >= score) return
    anomalies.set(id, {
      id,
      timestamp: point.timestamp,
      value: point.value,
      type,
      severity,
      score: Math.round(score * 1000) / 1000,
      method,
      action: existing?.action ?? 'keep',
      note,
    })
  }

  if (method === 'zscore') {
    const avg = mean(values)
    const sd = stdDev(values) || 1
    active.forEach(({ point, index }) => {
      const score = Math.abs(point.value - avg) / sd
      if (score >= threshold) {
        push(index, anomalyTypeFromResidual(point.value, avg, score), score)
      }
    })
  } else if (method === 'iqr') {
    const q1 = quantile(values, 0.25)
    const q3 = quantile(values, 0.75)
    const iqr = Math.max(q3 - q1, 1e-9)
    active.forEach(({ point, index }) => {
      const lower = q1 - threshold * iqr
      const upper = q3 + threshold * iqr
      if (point.value < lower || point.value > upper) {
        const score = Math.abs(point.value < lower ? (q1 - point.value) / iqr : (point.value - q3) / iqr)
        push(index, anomalyTypeFromResidual(point.value, mean(values), score), score)
      }
    })
  } else if (method === 'mad') {
    const med = median(values)
    const deviation = mad(values) || 1
    active.forEach(({ point, index }) => {
      const score = (0.6745 * Math.abs(point.value - med)) / deviation
      if (score >= threshold) {
        push(index, anomalyTypeFromResidual(point.value, med, score), score)
      }
    })
  } else if (method === 'stl') {
    const residuals = stlResiduals(
      points.map((point) => point.value),
      seasonPeriod(options.frequency),
    )
    const residActive = active.map(({ index }) => residuals[index]!)
    const med = median(residActive)
    const deviation = mad(residActive) || 1
    active.forEach(({ point, index }) => {
      const residual = residuals[index]!
      const score = (0.6745 * Math.abs(residual - med)) / deviation
      if (score >= threshold) {
        push(index, anomalyTypeFromResidual(point.value, point.value - residual, score), score, 'STL residual')
      }
    })
  } else {
    const scores = isolationForestScores(values)
    active.forEach(({ point, index }, activeIndex) => {
      const score = scores[activeIndex]!
      if (score >= threshold) {
        push(
          index,
          anomalyTypeFromResidual(point.value, mean(values), score * 5),
          score * 5,
          'Isolation Forest',
        )
      }
    })
  }

  for (const hit of detectLevelShifts(points, sensitivity)) {
    push(hit.index, hit.type, hit.score, 'Rolling mean shift')
  }
  for (const hit of detectSeasonalityBreaks(points, options.frequency, sensitivity)) {
    push(hit.index, 'seasonality_break', hit.score, 'Seasonal residual change')
  }

  return [...anomalies.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

export function runQualityChecks(
  points: SeriesPoint[],
  frequency: SeriesFrequency,
  options?: { freshnessDays?: number; minValue?: number; maxValue?: number },
): QualityIssue[] {
  const issues: QualityIssue[] = []
  const freshnessDays = options?.freshnessDays ?? (frequency === 'daily' ? 7 : frequency === 'weekly' ? 21 : 45)
  const active = points.filter((point) => !point.excluded)

  if (!active.length) {
    issues.push({
      id: 'empty',
      code: 'EMPTY',
      title: 'No data points',
      detail: 'Load a time series before anomaly detection or forecasting.',
      severity: 'blocking',
      count: 0,
    })
    return issues
  }

  const minRequired = minPointsForFrequency(frequency)
  if (active.length < minRequired) {
    issues.push({
      id: 'insufficient',
      code: 'INSUFFICIENT_POINTS',
      title: 'Insufficient data points',
      detail: `${active.length} points loaded; ${frequency} forecasting needs at least ${minRequired}.`,
      severity: 'blocking',
      count: active.length,
    })
  }

  const missing = points.filter(
    (point) => point.excluded !== true && (!Number.isFinite(point.value) || point.value === null),
  )
  // Missing encoded as NaN originals during parse
  const missingCount = points.filter((point) => !Number.isFinite(point.originalValue)).length
  if (missingCount > 0) {
    issues.push({
      id: 'missing',
      code: 'MISSING_VALUES',
      title: 'Missing values',
      detail: `${missingCount} row(s) have missing or non-numeric values.`,
      severity: missingCount > active.length * 0.1 ? 'blocking' : 'warning',
      count: missingCount,
    })
  }

  const stampCounts = new Map<string, number>()
  for (const point of points) {
    stampCounts.set(point.timestamp, (stampCounts.get(point.timestamp) ?? 0) + 1)
  }
  const duplicates = [...stampCounts.values()].filter((count) => count > 1).length
  if (duplicates > 0) {
    issues.push({
      id: 'duplicates',
      code: 'DUPLICATE_TIMESTAMPS',
      title: 'Duplicate timestamps',
      detail: `${duplicates} timestamp(s) appear more than once.`,
      severity: 'blocking',
      count: duplicates,
    })
  }

  const sortedDates = active
    .map((point) => parseLooseDate(point.timestamp))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime())

  if (sortedDates.length >= 2) {
    const expected = expectedGapMs(frequency)
    let gaps = 0
    let irregular = 0
    for (let i = 1; i < sortedDates.length; i++) {
      const delta = sortedDates[i]!.getTime() - sortedDates[i - 1]!.getTime()
      if (delta > expected * 1.75) gaps += 1
      else if (delta < expected * 0.45 || (delta > expected * 1.35 && delta <= expected * 1.75)) {
        irregular += 1
      }
    }
    if (gaps > 0) {
      issues.push({
        id: 'gaps',
        code: 'TIME_GAPS',
        title: 'Time gaps',
        detail: `${gaps} interval(s) are larger than expected for ${frequency} data.`,
        severity: gaps > 3 ? 'blocking' : 'warning',
        count: gaps,
      })
    }
    if (irregular > 0) {
      issues.push({
        id: 'irregular',
        code: 'IRREGULAR_INTERVALS',
        title: 'Irregular intervals',
        detail: `${irregular} interval(s) deviate from a regular ${frequency} cadence.`,
        severity: 'warning',
        count: irregular,
      })
    }

    const last = sortedDates[sortedDates.length - 1]!
    const ageDays = (Date.now() - last.getTime()) / (24 * 60 * 60 * 1000)
    if (ageDays > freshnessDays) {
      issues.push({
        id: 'freshness',
        code: 'STALE_DATA',
        title: 'Data freshness',
        detail: `Latest point is ${Math.round(ageDays)} days old (threshold ${freshnessDays}).`,
        severity: ageDays > freshnessDays * 2 ? 'blocking' : 'warning',
        count: Math.round(ageDays),
      })
    }
  }

  const finiteValues = active.map((point) => point.value).filter((value) => Number.isFinite(value))
  if (finiteValues.length >= 3) {
    const variance = stdDev(finiteValues)
    if (variance < 1e-9) {
      issues.push({
        id: 'flatline',
        code: 'FLATLINE',
        title: 'Flatline / zero variance',
        detail: 'Series has essentially constant values — forecasting signal is weak.',
        severity: 'blocking',
        count: finiteValues.length,
      })
    }
    const zeroShare = finiteValues.filter((value) => value === 0).length / finiteValues.length
    if (zeroShare >= 0.6) {
      issues.push({
        id: 'zeros',
        code: 'ZERO_HEAVY',
        title: 'Excessive zeros',
        detail: `${Math.round(zeroShare * 100)}% of values are zero.`,
        severity: 'warning',
        count: Math.round(zeroShare * finiteValues.length),
      })
    }
  }

  const minValue = options?.minValue
  const maxValue = options?.maxValue
  if (minValue != null || maxValue != null) {
    const outOfRange = finiteValues.filter(
      (value) => (minValue != null && value < minValue) || (maxValue != null && value > maxValue),
    ).length
    if (outOfRange > 0) {
      issues.push({
        id: 'range',
        code: 'OUT_OF_RANGE',
        title: 'Out-of-range values',
        detail: `${outOfRange} value(s) outside allowed range` +
          (minValue != null && maxValue != null
            ? ` [${minValue}, ${maxValue}].`
            : minValue != null
              ? ` (≥ ${minValue}).`
              : ` (≤ ${maxValue}).`),
        severity: 'warning',
        count: outOfRange,
      })
    }
  }

  const invalid = points.filter((point) => Number.isFinite(point.originalValue) && point.originalValue < 0).length
  if (invalid > 0) {
    issues.push({
      id: 'negative',
      code: 'NEGATIVE_VALUES',
      title: 'Negative values',
      detail: `${invalid} value(s) are negative — unusual for Offered Volume.`,
      severity: 'warning',
      count: invalid,
    })
  }

  void missing
  return issues
}

export function buildForecastReadiness(
  points: SeriesPoint[],
  anomalies: DetectedAnomaly[],
  issues: QualityIssue[],
  meta: { seriesLabel: string; frequency: SeriesFrequency },
): ForecastReadiness {
  const blocking = issues.filter((issue) => issue.severity === 'blocking')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  const infos = issues.filter((issue) => issue.severity === 'info')
  const unresolvedCriticalAnomalies = anomalies.filter(
    (anomaly) =>
      (anomaly.severity === 'critical' || anomaly.severity === 'high') &&
      anomaly.action !== 'mark_valid' &&
      anomaly.action !== 'exclude' &&
      anomaly.action !== 'impute' &&
      anomaly.action !== 'interpolate' &&
      anomaly.action !== 'cap',
  ).length

  let status: ReadinessStatus = 'passed'
  if (blocking.length || unresolvedCriticalAnomalies > 0) status = 'blocking'
  else if (warnings.length || anomalies.some((anomaly) => anomaly.action === 'keep')) status = 'warnings'

  const message =
    status === 'passed'
      ? 'Series is forecast-ready. Critical quality checks passed.'
      : status === 'warnings'
        ? 'Forecast allowed with warnings — review anomalies and quality notes.'
        : 'Forecasting blocked until critical quality issues or high-severity anomalies are resolved.'

  return {
    status,
    blocking,
    warnings,
    infos,
    anomalyCount: anomalies.length,
    unresolvedCriticalAnomalies,
    message,
    checkedAt: new Date().toISOString(),
    seriesLabel: meta.seriesLabel,
    frequency: meta.frequency,
    pointCount: points.filter((point) => !point.excluded).length,
  }
}

export function persistForecastReadiness(readiness: ForecastReadiness): void {
  try {
    sessionStorage.setItem(READINESS_STORAGE_KEY, JSON.stringify(readiness))
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadForecastReadiness(): ForecastReadiness | null {
  try {
    const raw = sessionStorage.getItem(READINESS_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as ForecastReadiness
  } catch {
    return null
  }
}

export function applyAnomalyActions(
  points: SeriesPoint[],
  anomalies: DetectedAnomaly[],
): SeriesPoint[] {
  const byTs = new Map(anomalies.map((anomaly) => [anomaly.timestamp, anomaly]))
  const finite = points
    .filter((point) => Number.isFinite(point.value) && !point.excluded)
    .map((point) => point.value)
  const lo = quantile(finite, 0.05)
  const hi = quantile(finite, 0.95)
  const seriesMean = mean(finite)

  return points.map((point, index) => {
    const anomaly = byTs.get(point.timestamp)
    if (!anomaly) return { ...point }
    if (anomaly.action === 'exclude' || anomaly.action === 'mark_invalid') {
      return { ...point, excluded: true }
    }
    if (anomaly.action === 'mark_valid' || anomaly.action === 'keep') {
      return { ...point, excluded: false, value: point.originalValue }
    }
    if (anomaly.action === 'cap') {
      const capped = Math.min(hi, Math.max(lo, point.originalValue))
      return { ...point, value: Math.round(capped * 1000) / 1000, excluded: false }
    }
    if (anomaly.action === 'impute') {
      return { ...point, value: Math.round(seriesMean * 1000) / 1000, excluded: false }
    }
    if (anomaly.action === 'interpolate') {
      let left = index - 1
      while (left >= 0 && (points[left]!.excluded || !Number.isFinite(points[left]!.originalValue))) left -= 1
      let right = index + 1
      while (
        right < points.length &&
        (points[right]!.excluded || !Number.isFinite(points[right]!.originalValue))
      ) {
        right += 1
      }
      const leftVal = left >= 0 ? points[left]!.originalValue : seriesMean
      const rightVal = right < points.length ? points[right]!.originalValue : seriesMean
      const interpolated =
        left >= 0 && right < points.length ? (leftVal + rightVal) / 2 : left >= 0 ? leftVal : rightVal
      return { ...point, value: Math.round(interpolated * 1000) / 1000, excluded: false }
    }
    return { ...point }
  })
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

function rowsFromMatrix(matrix: string[][]): ParsedSeriesFile {
  if (matrix.length < 2) {
    return { columns: [], rows: [], preview: [], error: 'File needs a header row and at least one data row.' }
  }
  const columns = matrix[0]!.map((cell) => String(cell ?? '').trim()).filter(Boolean)
  if (columns.length < 2) {
    return { columns: [], rows: [], preview: [], error: 'Need at least a date column and one value column.' }
  }
  const rows: Record<string, string>[] = []
  for (const line of matrix.slice(1)) {
    if (!line.some((cell) => String(cell ?? '').trim())) continue
    const row: Record<string, string> = {}
    columns.forEach((column, index) => {
      row[column] = String(line[index] ?? '').trim()
    })
    rows.push(row)
  }
  if (!rows.length) return { columns, rows: [], preview: [], error: 'No data rows found.' }
  return { columns, rows, preview: rows.slice(0, 12), error: '' }
}

export function parseSeriesCsvText(text: string): ParsedSeriesFile {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
  const matrix = lines.map(splitCsvLine)
  return rowsFromMatrix(matrix)
}

export function parseSeriesWorkbook(buffer: ArrayBuffer): ParsedSeriesFile {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return { columns: [], rows: [], preview: [], error: 'Workbook has no sheets.' }
  const sheet = workbook.Sheets[sheetName]!
  const matrix = XLSX.utils.sheet_to_json<(string | number | Date | null)[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
  }) as unknown as string[][]
  return rowsFromMatrix(matrix.map((row) => row.map((cell) => String(cell ?? ''))))
}

export function parseSeriesJsonText(text: string): ParsedSeriesFile {
  try {
    const parsed = JSON.parse(text) as unknown
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { data?: unknown }).data)
        ? ((parsed as { data: unknown[] }).data)
        : null
    if (!list?.length || typeof list[0] !== 'object' || list[0] == null) {
      return { columns: [], rows: [], preview: [], error: 'JSON must be an array of objects (or { data: [...] }).' }
    }
    const columns = [...new Set(list.flatMap((row) => Object.keys(row as object)))]
    const rows = list.map((row) => {
      const record: Record<string, string> = {}
      for (const column of columns) {
        const value = (row as Record<string, unknown>)[column]
        record[column] = value == null ? '' : String(value)
      }
      return record
    })
    return { columns, rows, preview: rows.slice(0, 12), error: '' }
  } catch {
    return { columns: [], rows: [], preview: [], error: 'Invalid JSON.' }
  }
}

export function buildSeriesPoints(
  rows: Record<string, string>[],
  dateColumn: string,
  valueColumn: string,
  frequency: SeriesFrequency,
): { points: SeriesPoint[]; error: string } {
  if (!dateColumn || !valueColumn) {
    return { points: [], error: 'Select a date column and a value column.' }
  }
  const byTs = new Map<string, number>()
  let skipped = 0
  for (const row of rows) {
    const date = parseLooseDate(row[dateColumn] ?? '')
    const raw = String(row[valueColumn] ?? '').replace(/,/g, '').trim()
    if (!date) {
      skipped += 1
      continue
    }
    const timestamp = toIsoTimestamp(date, frequency)
    if (!raw) {
      byTs.set(timestamp, Number.NaN)
      continue
    }
    const value = Number(raw)
    if (!Number.isFinite(value)) {
      skipped += 1
      continue
    }
    byTs.set(timestamp, (byTs.get(timestamp) ?? 0) + value)
  }
  const points = [...byTs.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, value]) => ({
      timestamp,
      value: Number.isFinite(value) ? value : 0,
      originalValue: value,
      excluded: !Number.isFinite(value),
    }))
  if (!points.length) {
    return { points: [], error: 'Could not build a time series from the selected columns.' }
  }
  return {
    points,
    error: skipped ? `Loaded ${points.length} points (${skipped} rows skipped).` : '',
  }
}

export function guessDateColumn(columns: string[]): string {
  return (
    columns.find((column) => /^(date|week|month|period|day|timestamp|ds)$/i.test(column.trim())) ??
    columns[0] ??
    ''
  )
}

export function guessValueColumn(columns: string[], dateColumn: string): string {
  const preferred = columns.find((column) =>
    /^(volume|offeredvolume|offered|value|y|calls|contacts|transactions|forecastvolume|count)$/i.test(
      column.trim().replace(/\s+/g, ''),
    ),
  )
  if (preferred) return preferred
  return columns.find((column) => column !== dateColumn) ?? ''
}

export function exportCleanedSeriesCsv(points: SeriesPoint[]): string {
  const lines = ['Timestamp,Value,OriginalValue,Excluded']
  for (const point of points) {
    lines.push(
      [
        point.timestamp,
        Number.isFinite(point.value) ? String(point.value) : '',
        Number.isFinite(point.originalValue) ? String(point.originalValue) : '',
        point.excluded ? 'Yes' : 'No',
      ].join(','),
    )
  }
  return lines.join('\r\n')
}

export function exportAnomalyReportCsv(anomalies: DetectedAnomaly[]): string {
  const lines = ['Timestamp,Value,Type,Severity,Score,Method,Action,Note']
  for (const anomaly of anomalies) {
    const note = (anomaly.note ?? '').replaceAll('"', '""')
    lines.push(
      [
        anomaly.timestamp,
        anomaly.value,
        anomaly.type,
        anomaly.severity,
        anomaly.score,
        anomaly.method,
        anomaly.action,
        `"${note}"`,
      ].join(','),
    )
  }
  return lines.join('\r\n')
}

export function exportAnomalyWorkbook(
  points: SeriesPoint[],
  anomalies: DetectedAnomaly[],
  issues: QualityIssue[],
  readiness: ForecastReadiness,
  fileNameBase: string,
): void {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      points.map((point) => ({
        Timestamp: point.timestamp,
        Value: point.value,
        OriginalValue: point.originalValue,
        Excluded: point.excluded ? 'Yes' : 'No',
      })),
    ),
    'Cleaned_Series',
  )
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      anomalies.map((anomaly) => ({
        Timestamp: anomaly.timestamp,
        Value: anomaly.value,
        Type: anomaly.type,
        Severity: anomaly.severity,
        Score: anomaly.score,
        Method: anomaly.method,
        Action: anomaly.action,
        Note: anomaly.note ?? '',
      })),
    ),
    'Anomalies',
  )
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet(
      issues.map((issue) => ({
        Code: issue.code,
        Title: issue.title,
        Severity: issue.severity,
        Detail: issue.detail,
        Count: issue.count ?? '',
      })),
    ),
    'Quality_Checks',
  )
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      { Field: 'Status', Value: readiness.status },
      { Field: 'Message', Value: readiness.message },
      { Field: 'Series', Value: readiness.seriesLabel },
      { Field: 'Frequency', Value: readiness.frequency },
      { Field: 'Points', Value: readiness.pointCount },
      { Field: 'Anomalies', Value: readiness.anomalyCount },
      { Field: 'CheckedAt', Value: readiness.checkedAt },
    ]),
    'Readiness',
  )
  XLSX.writeFile(workbook, `${fileNameBase}.xlsx`)
}

export const DETECTION_METHOD_OPTIONS: Array<{ id: DetectionMethod; label: string; blurb: string }> = [
  { id: 'zscore', label: 'Z-score', blurb: 'Distance from mean in standard deviations' },
  { id: 'iqr', label: 'IQR', blurb: 'Tukey fences from quartiles' },
  { id: 'mad', label: 'MAD', blurb: 'Robust median absolute deviation' },
  { id: 'stl', label: 'STL', blurb: 'Seasonal-trend residual outliers' },
  { id: 'isolation_forest', label: 'Isolation Forest', blurb: 'Ensemble isolation scores' },
]

/** Empty upload template header rows for daily / weekly / monthly. */
export function buildUploadTemplateCsv(frequency: SeriesFrequency): string {
  if (frequency === 'daily') {
    return [
      'Date,Volume',
      '2026-01-05,1200',
      '2026-01-06,1180',
      '2026-01-07,1210',
      '# Replace rows with your Offered Volume history. Date = YYYY-MM-DD. Volume = numeric.',
    ].join('\r\n')
  }
  if (frequency === 'monthly') {
    return [
      'Month,Volume',
      '2025-10,42000',
      '2025-11,43500',
      '2025-12,44800',
      '# Replace rows with your monthly totals. Month = YYYY-MM. Volume = numeric.',
    ].join('\r\n')
  }
  return [
    'Week,Volume',
    '2026-01-05,8500',
    '2026-01-12,8620',
    '2026-01-19,8710',
    '# Replace rows with your weekly Offered Volume. Week = week-start YYYY-MM-DD. Volume = numeric.',
  ].join('\r\n')
}

/**
 * Sample Offered Volume series with intentional spike, dip, flat gap, and mild trend
 * so users can try anomaly detection immediately.
 */
export function buildSampleSeriesRows(frequency: SeriesFrequency): {
  columns: string[]
  rows: Record<string, string>[]
  label: string
} {
  if (frequency === 'daily') {
    const rows: Record<string, string>[] = []
    // 28 days starting Mon 2026-03-02
    for (let i = 0; i < 28; i++) {
      const d = new Date(Date.UTC(2026, 2, 2 + i, 12))
      const iso = d.toISOString().slice(0, 10)
      const dow = new Date(`${iso}T12:00:00`).getDay()
      let volume = dow === 0 || dow === 6 ? 420 + (i % 3) * 8 : 980 + i * 3 + (dow === 1 ? 40 : 0)
      if (i === 10) volume = 2100 // spike
      if (i === 18) volume = 180 // dip
      rows.push({ Date: iso, Volume: String(volume) })
    }
    return { columns: ['Date', 'Volume'], rows, label: 'Sample Daily Offered Volume' }
  }

  if (frequency === 'monthly') {
    const rows = [
      { Month: '2025-01', Volume: '38000' },
      { Month: '2025-02', Volume: '37200' },
      { Month: '2025-03', Volume: '40100' },
      { Month: '2025-04', Volume: '41500' },
      { Month: '2025-05', Volume: '42800' },
      { Month: '2025-06', Volume: '44000' },
      { Month: '2025-07', Volume: '71000' }, // spike
      { Month: '2025-08', Volume: '45200' },
      { Month: '2025-09', Volume: '46100' },
      { Month: '2025-10', Volume: '47000' },
      { Month: '2025-11', Volume: '12000' }, // dip
      { Month: '2025-12', Volume: '48500' },
    ]
    return { columns: ['Month', 'Volume'], rows, label: 'Sample Monthly Offered Volume' }
  }

  // weekly — 16 weeks with spike + dip
  const rows: Record<string, string>[] = []
  for (let i = 0; i < 16; i++) {
    const d = new Date(Date.UTC(2026, 0, 5 + i * 7, 12))
    const iso = d.toISOString().slice(0, 10)
    let volume = 8200 + i * 45
    if (i === 7) volume = 14500 // spike
    if (i === 12) volume = 3100 // dip
    rows.push({ Week: iso, Volume: String(volume) })
  }
  return { columns: ['Week', 'Volume'], rows, label: 'Sample Weekly Offered Volume' }
}

export function buildSampleSeriesCsv(frequency: SeriesFrequency): string {
  const sample = buildSampleSeriesRows(frequency)
  const lines = [sample.columns.join(',')]
  for (const row of sample.rows) {
    lines.push(sample.columns.map((column) => row[column] ?? '').join(','))
  }
  return lines.join('\r\n')
}

/** Excel template with Daily / Weekly / Monthly sheets (headers + example rows). */
export function downloadAnomalyUploadTemplateWorkbook(fileNameBase = 'AnomalyDetection_UploadTemplate'): void {
  const workbook = XLSX.utils.book_new()
  for (const frequency of ['daily', 'weekly', 'monthly'] as SeriesFrequency[]) {
    const csv = buildUploadTemplateCsv(frequency)
    const dataRows = csv
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split(','))
    const sheetName = frequency === 'daily' ? 'Daily' : frequency === 'weekly' ? 'Weekly' : 'Monthly'
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(dataRows), sheetName)
  }
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['Field', 'Guidance'],
      ['Date / Week / Month', 'Use ISO dates (YYYY-MM-DD) or YYYY-MM for monthly'],
      ['Volume', 'Numeric Offered Volume / contacts / transactions'],
      ['Frequency', 'Pick Daily, Weekly, or Monthly in the Anomaly Detection page to match your file'],
      ['Tips', 'Keep one header row. Avoid blank timestamps. Duplicate weeks are flagged as blocking.'],
    ]),
    'Instructions',
  )
  XLSX.writeFile(workbook, `${fileNameBase}.xlsx`)
}

/** Excel sample pack with intentional anomalies for demos. */
export function downloadAnomalySampleWorkbook(fileNameBase = 'AnomalyDetection_SampleData'): void {
  const workbook = XLSX.utils.book_new()
  for (const frequency of ['daily', 'weekly', 'monthly'] as SeriesFrequency[]) {
    const sample = buildSampleSeriesRows(frequency)
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet(
        sample.rows.map((row) => {
          const out: Record<string, string | number> = {}
          for (const column of sample.columns) {
            const raw = row[column] ?? ''
            out[column] = column === 'Volume' ? Number(raw) : raw
          }
          return out
        }),
      ),
      frequency === 'daily' ? 'Daily_Sample' : frequency === 'weekly' ? 'Weekly_Sample' : 'Monthly_Sample',
    )
  }
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ['What to expect'],
      ['Weekly sheet has a spike around mid-series and a dip later.'],
      ['Daily sheet has weekend lows, one spike, and one dip.'],
      ['Monthly sheet has a July spike and a November dip.'],
      ['Upload any sheet (save as CSV) or load sample in-app, then tune sensitivity.'],
    ]),
    'Readme',
  )
  XLSX.writeFile(workbook, `${fileNameBase}.xlsx`)
}

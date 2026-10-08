import type { WeekCapacityPlanOverride } from './capacityPlanOverridePersistence'
import type { LedgerMetricSnapshot, WeeklyLedgerRow } from './weeklyLedger'

export type MatrixEditKind = 'planned' | 'actual'

export type DraftParseStatus = 'empty' | 'incomplete' | 'invalid' | 'ok'

export type DraftParseResult =
  | { status: 'empty' }
  | { status: 'incomplete' }
  | { status: 'invalid'; message: string }
  | { status: 'ok'; displayValue: number; storedValue: number; clamped: boolean }

const WHOLE_METRIC_MAX = 50_000_000
const HEADCOUNT_MAX = 100_000
const AHT_MAX_SECONDS = 36_000
const HOURS_MAX = 1_000_000
const FTE_MAX = 100_000

export function cellDraftId(kind: MatrixEditKind, week: string, metricId: string): string {
  return `${kind}:${week}:${metricId}`
}

export function parseCellDraftId(
  draftId: string,
): { kind: MatrixEditKind; week: string; metricId: string } | null {
  const match = /^(planned|actual):(\d{4}-\d{2}-\d{2}):(.+)$/.exec(draftId)
  if (!match) return null
  return { kind: match[1] as MatrixEditKind, week: match[2]!, metricId: match[3]! }
}

export function isPercentDraftMetric(metricId: string): boolean {
  if (metricId.startsWith('shrinkage:')) return true
  return (
    metricId === 'occupancy' ||
    metricId === 'trainingAttritionPct' ||
    metricId === 'nestingAttritionPct' ||
    metricId.endsWith('Pct') ||
    metricId === 'totalShrinkagePct'
  )
}

export function isHeadcountMetric(metricId: string): boolean {
  return metricId === 'plannedNewHires' || metricId === 'actualTrainingStartHc' || metricId.endsWith('Hc')
}

export function isWholeNumberMetric(metricId: string): boolean {
  return isHeadcountMetric(metricId) || metricId === 'handledVolume' || metricId === 'callVolume' || metricId === 'seatCount'
}

export function toInputString(
  value: number | null | undefined,
  options?: { percent?: boolean; whole?: boolean },
): string {
  if (value == null || !Number.isFinite(value)) return ''
  if (options?.percent) {
    const pct = value * 100
    return String(Math.round(pct * 1000) / 1000)
  }
  if (options?.whole) return String(Math.round(value))
  return String(Math.round(value * 1000) / 1000)
}

export type MetricInputBounds = {
  min: number
  max: number
  storedMin: number
  storedMax: number
}

export function metricInputBounds(metricId: string): MetricInputBounds {
  if (metricId === 'occupancy') {
    return { min: 0, max: 99.9, storedMin: 0, storedMax: 0.999 }
  }
  if (metricId === 'totalShrinkagePct' || metricId.startsWith('shrinkage:')) {
    return { min: 0, max: 125, storedMin: 0, storedMax: 1.25 }
  }
  if (metricId === 'peakRatioPct') {
    return { min: 0, max: 500, storedMin: 0, storedMax: 5 }
  }
  if (
    metricId === 'attritionPct' ||
    metricId === 'trainingAttritionPct' ||
    metricId === 'nestingAttritionPct' ||
    metricId.endsWith('Pct')
  ) {
    return { min: 0, max: 100, storedMin: 0, storedMax: 1 }
  }
  if (isHeadcountMetric(metricId) || metricId === 'seatCount' || metricId === 'plannedNewHires') {
    return { min: 0, max: HEADCOUNT_MAX, storedMin: 0, storedMax: HEADCOUNT_MAX }
  }
  if (metricId === 'callVolume' || metricId === 'handledVolume') {
    return { min: 0, max: WHOLE_METRIC_MAX, storedMin: 0, storedMax: WHOLE_METRIC_MAX }
  }
  if (metricId === 'ahtSeconds' || metricId === 'cappedAhtSeconds') {
    return { min: 0, max: AHT_MAX_SECONDS, storedMin: 0, storedMax: AHT_MAX_SECONDS }
  }
  if (metricId.toLowerCase().includes('hours') || metricId.endsWith('Hours')) {
    return { min: 0, max: HOURS_MAX, storedMin: 0, storedMax: HOURS_MAX }
  }
  if (metricId === 'requiredFte' || metricId.toLowerCase().includes('fte')) {
    return { min: 0, max: FTE_MAX, storedMin: 0, storedMax: FTE_MAX }
  }
  return { min: 0, max: WHOLE_METRIC_MAX, storedMin: 0, storedMax: WHOLE_METRIC_MAX }
}

/** Keep in-progress typing (blank, minus, trailing decimal) while stripping junk. */
export function sanitizeNumericDraft(raw: string): string {
  const stripped = raw.replace(/,/g, '').replace(/\s/g, '')
  if (stripped === '' || stripped === '-' || stripped === '.' || stripped === '-.') return stripped
  let sign = ''
  let body = stripped
  if (body.startsWith('-')) {
    sign = '-'
    body = body.slice(1)
  }
  body = body.replace(/[^\d.]/g, '')
  const dot = body.indexOf('.')
  if (dot >= 0) {
    body = `${body.slice(0, dot + 1)}${body.slice(dot + 1).replace(/\./g, '')}`
  }
  return `${sign}${body}`
}

export function isIncompleteNumericDraft(draft: string): boolean {
  const trimmed = draft.trim()
  return trimmed === '-' || trimmed === '.' || trimmed === '-.' || trimmed.endsWith('.')
}

export function parseMetricDraft(metricId: string, draft: string): DraftParseResult {
  const trimmed = draft.trim()
  if (trimmed === '') return { status: 'empty' }
  if (isIncompleteNumericDraft(trimmed)) return { status: 'incomplete' }

  const sanitized = sanitizeNumericDraft(trimmed)
  if (sanitized === '') {
    return { status: 'invalid', message: 'Enter a number, or leave blank to clear.' }
  }
  const parsed = Number(sanitized)
  if (!Number.isFinite(parsed)) {
    return { status: 'invalid', message: 'Enter a number, or leave blank to clear.' }
  }

  const bounds = metricInputBounds(metricId)
  if (parsed < 0) {
    return { status: 'invalid', message: 'Negative values are not allowed.' }
  }

  let displayValue = parsed
  let clamped = false
  if (displayValue > bounds.max) {
    displayValue = bounds.max
    clamped = true
  }
  if (displayValue < bounds.min) {
    displayValue = bounds.min
    clamped = true
  }

  const storedRaw = isPercentDraftMetric(metricId) ? displayValue / 100 : displayValue
  const storedValue = normalizeMetricInput(metricId, storedRaw) ?? 0
  return { status: 'ok', displayValue, storedValue, clamped }
}

export function draftValidationMessage(metricId: string, draft: string | undefined): string | null {
  if (draft == null) return null
  const parsed = parseMetricDraft(metricId, draft)
  if (parsed.status === 'invalid') return parsed.message
  if (parsed.status === 'ok' && parsed.clamped) {
    const bounds = metricInputBounds(metricId)
    return `Value was capped at ${bounds.max}.`
  }
  return null
}

export function normalizeMetricInput(metricId: string, value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const bounds = metricInputBounds(metricId)
  const clamped = Math.min(bounds.storedMax, Math.max(bounds.storedMin, value))
  if (isWholeNumberMetric(metricId)) return Math.round(clamped)
  if (isPercentDraftMetric(metricId)) return Math.round(clamped * 1_000_000) / 1_000_000
  return Math.round(clamped * 1000) / 1000
}

export function storedValueFromDraft(metricId: string, draft: string): number | null | undefined {
  const parsed = parseMetricDraft(metricId, draft)
  if (parsed.status === 'empty') return null
  if (parsed.status === 'ok') return parsed.storedValue
  return undefined
}

export function parseClipboardGrid(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  if (!lines.length) return []
  const hasTab = lines.some((line) => line.includes('\t'))
  return lines.map((line) => (hasTab ? line.split('\t') : [line]).map((cell) => sanitizeNumericDraft(cell)))
}

export function applyClipboardGridToDrafts(
  current: Record<string, string>,
  start: { kind: MatrixEditKind; week: string; metricId: string },
  weeks: string[],
  metricIds: string[],
  grid: string[][],
): Record<string, string> {
  const startCol = weeks.indexOf(start.week)
  const startRow = metricIds.indexOf(start.metricId)
  if (startCol < 0 || startRow < 0 || !grid.length) return current
  const next = { ...current }
  grid.forEach((line, rowOffset) => {
    line.forEach((cell, colOffset) => {
      const metricId = metricIds[startRow + rowOffset]
      const week = weeks[startCol + colOffset]
      if (!metricId || !week) return
      next[cellDraftId(start.kind, week, metricId)] = cell
    })
  })
  return next
}

function applyShrinkageDraft(
  weekRow: WeekCapacityPlanOverride,
  categoryId: string,
  stored: number | null | undefined,
): WeekCapacityPlanOverride {
  const shrinkageById = { ...(weekRow.shrinkageById ?? {}) }
  if (stored == null) delete shrinkageById[categoryId]
  else shrinkageById[categoryId] = stored
  return { ...weekRow, shrinkageById }
}

/** Merge unsaved matrix cell drafts into planned overrides so Required FTE recalculates while typing. */
export function mergePlannedOverridesWithDrafts(
  plannedOverrides: Record<string, WeekCapacityPlanOverride>,
  cellDrafts: Record<string, string>,
): Record<string, WeekCapacityPlanOverride> {
  let merged: Record<string, WeekCapacityPlanOverride> | null = null
  for (const [draftId, draft] of Object.entries(cellDrafts)) {
    const parsedId = parseCellDraftId(draftId)
    if (!parsedId || parsedId.kind !== 'planned') continue
    const stored = storedValueFromDraft(parsedId.metricId, draft)
    if (stored === undefined) continue
    if (!merged) merged = { ...plannedOverrides }
    const weekRow = { ...(merged[parsedId.week] ?? plannedOverrides[parsedId.week] ?? {}) }
    if (parsedId.metricId.startsWith('shrinkage:')) {
      merged[parsedId.week] = applyShrinkageDraft(weekRow, parsedId.metricId.replace('shrinkage:', ''), stored)
      continue
    }
    merged[parsedId.week] = {
      ...weekRow,
      [parsedId.metricId]: stored,
    }
  }
  return merged ?? plannedOverrides
}

/** Apply unsaved Actual cell drafts onto ledger rows for live Required FTE / variance calcs. */
export function mergeLedgerWithActualDrafts(
  ledger: WeeklyLedgerRow[],
  cellDrafts: Record<string, string>,
): WeeklyLedgerRow[] {
  const byWeek = new Map<string, Partial<LedgerMetricSnapshot>>()
  for (const [draftId, draft] of Object.entries(cellDrafts)) {
    const parsedId = parseCellDraftId(draftId)
    if (!parsedId || parsedId.kind !== 'actual') continue
    if (parsedId.metricId.startsWith('shrinkage:')) continue
    const stored = storedValueFromDraft(parsedId.metricId, draft)
    if (stored === undefined) continue
    byWeek.set(parsedId.week, { ...(byWeek.get(parsedId.week) ?? {}), [parsedId.metricId]: stored })
  }
  if (!byWeek.size) return ledger

  return ledger.map((row) => {
    const patch = byWeek.get(row.week)
    if (!patch || !row.actual) return row
    return {
      ...row,
      actual: {
        ...row.actual,
        ...patch,
      },
    }
  })
}

/** Coerce in-progress typing (trailing `.`) so Save can succeed on the first click. */
export function finalizeNumericDraft(draft: string): string {
  const trimmed = draft.trim()
  if (!trimmed) return ''
  if (trimmed === '-' || trimmed === '.' || trimmed === '-.') return ''
  if (trimmed.endsWith('.')) return trimmed.slice(0, -1)
  return trimmed
}

export function finalizeCellDrafts(cellDrafts: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [draftId, draft] of Object.entries(cellDrafts)) {
    next[draftId] = finalizeNumericDraft(draft)
  }
  return next
}

export function collectInvalidDraftMessages(cellDrafts: Record<string, string>): string[] {
  const messages: string[] = []
  for (const [draftId, draft] of Object.entries(finalizeCellDrafts(cellDrafts))) {
    const parsedId = parseCellDraftId(draftId)
    if (!parsedId) continue
    const parsed = parseMetricDraft(parsedId.metricId, draft)
    if (parsed.status === 'invalid') messages.push(`${parsedId.week}: ${parsed.message}`)
    else if (parsed.status === 'incomplete') messages.push(`${parsedId.week}: Finish entering the number.`)
  }
  return messages
}

import type { StaffingEnrichedRow } from './types'

/** Program dimension for rollups when Campaign is absent: Client · LOB (fallback Project Code). */
function programRollupKey(r: StaffingEnrichedRow): string {
  const client = r.client?.trim()
  const lob = r.lob?.trim()
  const joined = [client, lob].filter(Boolean).join(' · ')
  if (joined) return joined
  return r.projectCode?.trim() || '—'
}

export type ExecPanelGranularity = 'week' | 'month' | 'quarter'

export type WeeklyAggLike = {
  week: string
  requiredHc: number
  activeHc: number
  plannedShrink: number | null
  actualShrink: number | null
  plannedAttrOverActiveHcPct: number | null
  actualAttrOverActiveHcPct: number | null
  newHires: number
  plannedNewHireClassHc: number
  trainingPipeline: number
  graduates: number
  plannedNewHireTrainHrs: number | null
  actualTrainHrs: number | null
}

function tryParseWeekDate(iso: string): number | null {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** Last `days` calendar window from max week in rows; inclusive of boundary. */
export function filterRowsLastDays(rows: StaffingEnrichedRow[], days: number): StaffingEnrichedRow[] {
  if (!rows.length || days <= 0) return rows
  let maxT = -Infinity
  for (const r of rows) {
    const w = r.weekStartDate || r.week
    const t = tryParseWeekDate(w)
    if (t != null && t > maxT) maxT = t
  }
  if (!Number.isFinite(maxT)) return rows
  const minT = maxT - days * 86400000
  return rows.filter((r) => {
    const t = tryParseWeekDate(r.weekStartDate || r.week || '')
    return t != null && t >= minT && t <= maxT
  })
}

export type NamedTotal = { name: string; value: number }

function rollupSum(rows: StaffingEnrichedRow[], keyFn: (r: StaffingEnrichedRow) => string, valFn: (r: StaffingEnrichedRow) => number): NamedTotal[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const k = keyFn(r).trim() || '—'
    const v = valFn(r)
    if (!Number.isFinite(v)) continue
    m.set(k, (m.get(k) ?? 0) + v)
  }
  return [...m.entries()]
    .map(([name, value]) => ({ name, value }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value)
}

/** Donut slices: planned new hire class HC by program or site; falls back to new hire count when class is not populated. */
export function rollupPlannedNewHireClassBy(rows: StaffingEnrichedRow[], mode: 'program' | 'site'): NamedTotal[] {
  const keyFn =
    mode === 'site'
      ? (r: StaffingEnrichedRow) => r.location || r.client || '—'
      : programRollupKey

  const byClass = rollupSum(rows, keyFn, (r) => r.plannedNewHireClassHc ?? 0)
  const sumClass = byClass.reduce((s, x) => s + x.value, 0)
  if (sumClass > 0) return byClass
  return rollupSum(rows, keyFn, (r) => r.newHireCount ?? 0)
}

/** Actual attrition % of active HC: Σ actual attrition ÷ Σ active HC × 100 per dimension (recent rows). */
export function attritionPctActualBy(rows: StaffingEnrichedRow[], mode: 'program' | 'site'): { name: string; pct: number | null }[] {
  type Acc = { actHc: number; actAttr: number; rows: number }
  const m = new Map<string, Acc>()
  const keyFn =
    mode === 'site'
      ? (r: StaffingEnrichedRow) => r.location?.trim() || r.client || '—'
      : programRollupKey

  for (const r of rows) {
    const k = keyFn(r)
    const cur = m.get(k) ?? { actHc: 0, actAttr: 0, rows: 0 }
    if (r.activeProdHc != null && Number.isFinite(r.activeProdHc)) cur.actHc += r.activeProdHc
    if (r.actualAttrition != null && Number.isFinite(r.actualAttrition)) cur.actAttr += r.actualAttrition
    cur.rows += 1
    m.set(k, cur)
  }
  const out: { name: string; pct: number | null }[] = []
  for (const [name, acc] of m) {
    if (acc.actHc <= 0) {
      out.push({ name, pct: null })
      continue
    }
    out.push({ name, pct: (acc.actAttr / acc.actHc) * 100 })
  }
  return out.sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1))
}

/** Under-staffing (Active − Required) sum per program/site — negative means shortage. */
export function hcGapSumBy(rows: StaffingEnrichedRow[], mode: 'program' | 'site'): { name: string; gap: number }[] {
  type Acc = { req: number; act: number }
  const m = new Map<string, Acc>()
  const keyFn =
    mode === 'site'
      ? (r: StaffingEnrichedRow) => r.location?.trim() || r.client || '—'
      : programRollupKey

  for (const r of rows) {
    const k = keyFn(r)
    const cur = m.get(k) ?? { req: 0, act: 0 }
    if (r.requiredHc != null && Number.isFinite(r.requiredHc)) cur.req += r.requiredHc
    if (r.activeProdHc != null && Number.isFinite(r.activeProdHc)) cur.act += r.activeProdHc
    m.set(k, cur)
  }
  return [...m.entries()]
    .map(([name, acc]) => ({ name, gap: acc.act - acc.req }))
    .filter((x) => x.gap !== 0)
    .sort((a, b) => a.gap - b.gap)
}

/** Shrinkage actual vs planned (0–1 fractions) averaged per dimension over recent rows. */
export function shrinkAvgBy(rows: StaffingEnrichedRow[], mode: 'program' | 'site'): { name: string; planned: number | null; actual: number | null }[] {
  type Acc = { ps: number[]; as: number[] }
  const m = new Map<string, Acc>()
  const keyFn =
    mode === 'site'
      ? (r: StaffingEnrichedRow) => r.location?.trim() || r.client || '—'
      : programRollupKey

  const toF = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return null
    if (v >= 0 && v <= 1) return v
    if (v > 1 && v <= 100) return v / 100
    return null
  }

  for (const r of rows) {
    const k = keyFn(r)
    const cur = m.get(k) ?? { ps: [], as: [] }
    const p = toF(r.plannedShrinkPct)
    const a = toF(r.actualShrinkPct)
    if (p != null) cur.ps.push(p)
    if (a != null) cur.as.push(a)
    m.set(k, cur)
  }
  const avg = (a: number[]) => {
    const vals = a.filter((v) => Number.isFinite(v) && v !== 0)
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
  }
  return [...m.entries()]
    .map(([name, acc]) => ({ name, planned: avg(acc.ps), actual: avg(acc.as) }))
    .filter((x) => x.planned != null || x.actual != null)
    .sort((a, b) => (b.actual ?? 0) - (a.actual ?? 0))
}

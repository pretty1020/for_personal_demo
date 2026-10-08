import type { DatasetKind, ExecutiveUnifiedRow } from '../types/dashboard'

/** Accent palette aligned with dashboard reference (orange / pink / purple) */
export const EXEC_CHART_COLORS = ['#1c1915', '#2c5648', '#8c7348', '#4d6b5e', '#9a6b2f', '#6e675f']

export interface ClientAgg {
  client: string
  metrics: Record<string, number>
  /** Convenience sums after semantic resolution */
  revenue: number
  gm: number
  peopleCost: number
  opex: number
  otherCost: number
  fte: number
  marginPct: number | null
  revPerFte: number | null
}

export interface MonthlyPoint {
  month: string
  label: string
  metrics: Record<string, number>
}

export interface WeeklyPoint {
  week: string
  label: string
  metrics: Record<string, number>
}

export interface OpsClientPoint {
  client: string
  periodKey: string
  label: string
  metrics: Record<string, number>
}

function sumMetrics(rows: ExecutiveUnifiedRow[]): Record<string, number> {
  const acc: Record<string, number> = {}
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.metrics)) {
      if (!Number.isFinite(v)) continue
      acc[k] = (acc[k] ?? 0) + v
    }
  }
  return acc
}

function scoreKey(key: string, patterns: RegExp[]): number {
  let s = 0
  const lower = key.toLowerCase()
  for (const p of patterns) {
    if (p.test(lower)) s += 1
  }
  return s
}

/** Pick best-matching numeric column keys for financial semantics */
export function resolveSemanticKeys(
  allKeys: string[],
  opts?: { preferDataset?: 'datasheet' | 'commit_vs_actuals' | 'budget_vs_trending' | 'lw_cw_datasheet' },
) {
  const keys = [...new Set(allKeys)]

  const preferDataset = opts?.preferDataset
  const inPreferredDataset = (k: string) => (preferDataset ? k.startsWith(preferDataset + '_') : false)
  const preferOne = (cands: (string | null | undefined)[]) => {
    const list = cands.filter((x): x is string => Boolean(x))
    if (!list.length) return null
    const preferred = list.find((k) => inPreferredDataset(k))
    return preferred ?? list[0]!
  }

  const preferredGm = preferOne([
    keys.find((k) => /_gm$/i.test(k)),
    keys.find((k) => /_gross_margin$/i.test(k)),
  ])
  const preferredGmPct = preferOne([
    keys.find((k) => /_gm%$/i.test(k)),
    keys.find((k) => /_gm_pct$/i.test(k)),
    keys.find((k) => /_gm_percent$/i.test(k)),
    keys.find((k) => /_margin%$/i.test(k)),
    keys.find((k) => /_margin_pct$/i.test(k)),
  ])
  const revenue =
    keys
      .filter((k) => scoreKey(k, [/revenue/, /rev(?!erse)/, /billings/, /sales/]) > 0)
      .sort((a, b) => scoreKey(b, [/revenue/, /total/]) - scoreKey(a, [/revenue/, /total/]))[0] ?? null
  const gm =
    preferredGm ??
    keys
      .filter((k) => {
        if (/pct|percent|%/i.test(k) && !/dollar|\$/i.test(k)) return false
        return (
          scoreKey(k, [/gross/, /\bgm\b/, /margin_dollar/, /margin\$/, /contribution/]) > 0 ||
          (/margin/i.test(k) && !/pct|percent|%/i.test(k))
        )
      })
      .sort((a, b) => scoreKey(b, [/gross/, /gm/]) - scoreKey(a, [/gross/, /gm/]))[0] ?? null
  const peopleCost =
    keys
      .filter((k) => scoreKey(k, [/people/, /payroll/, /wage/, /staff\s*cost/]) > 0 && !/training|salary/i.test(k))
      .sort((a, b) => scoreKey(b, [/people/, /total/]) - scoreKey(a, [/people/, /total/]))[0] ?? null
  const salaryCost =
    keys
      .filter((k) => scoreKey(k, [/salary/, /benefit/, /wage/]) > 0)
      .sort((a, b) => scoreKey(b, [/salary/]) - scoreKey(a, [/salary/]))[0] ?? null
  const trainingCost =
    keys
      .filter((k) => scoreKey(k, [/training/]) > 0 && !/revenue|projected/i.test(k))
      .sort((a, b) => scoreKey(b, [/training/]) - scoreKey(a, [/training/]))[0] ?? null
  const opex =
    keys
      .filter((k) => scoreKey(k, [/opex/, /operating\s*exp/, /overhead/]) > 0)
      .sort((a, b) => scoreKey(b, [/opex/]) - scoreKey(a, [/opex/]))[0] ?? null
  const outsource =
    keys
      .filter((k) => scoreKey(k, [/outsourc/, /consult/, /vendor/, /contractor/]) > 0)
      .sort((a, b) => scoreKey(b, [/outsource/, /consult/]) - scoreKey(a, [/outsource/, /consult/]))[0] ?? null
  const otherDelivery =
    keys
      .filter((k) => scoreKey(k, [/other/, /delivery/, /direct\s*cost/]) > 0 && !/revenue/.test(k))
      .sort((a, b) => b.length - a.length)[0] ?? null
  const fte =
    keys
      .filter((k) => scoreKey(k, [/fte/, /headcount/, /hc\b/, /billed\s*fte/, /staff\s*count/]) > 0)
      .sort((a, b) => scoreKey(b, [/billed/, /fte/]) - scoreKey(a, [/billed/, /fte/]))[0] ?? null
  const commit =
    keys.filter((k) => /commit|forecast|plan|budget|target/i.test(k) && /revenue|rev/i.test(k)).sort()[0] ??
    keys.filter((k) => /commit/i.test(k)).sort()[0] ??
    null
  const actual =
    keys.filter((k) => /actual/i.test(k) && /revenue|rev/i.test(k)).sort()[0] ??
    keys.filter((k) => /actual/i.test(k)).sort()[0] ??
    null
  const budget =
    keys.find((k) => /^budget|^bud\b/i.test(k) || (/budget/i.test(k) && !/vs|variance/i.test(k))) ?? null
  const projection =
    keys.find((k) => /projection|proj\b|forecast/i.test(k) && !/actual/i.test(k)) ??
    keys.find((k) => /trending|plan\s*revenue/i.test(k)) ??
    null
  /** Explicit GM% / margin rate column (not dollar GM) */
  const gmPct =
    preferredGmPct ??
    keys.find((k) => {
      const l = k.toLowerCase()
      if (/dollar|\$|_usd|amount/i.test(l) && !/pct|percent|%/i.test(l)) return false
      if (!/(gm|gross|margin)/i.test(l)) return false
      return /pct|percent|%|rate$/i.test(l) || /\bmargin\s*%/i.test(l)
    }) ??
    null
  return { revenue, gm, gmPct, peopleCost, salaryCost, trainingCost, opex, outsource, otherDelivery, fte, commit, actual, budget, projection }
}

/** Heuristic pairs for ops comparison charts (keys are merged model slugs like `aht_handle_time`). */
export function resolveOperationalMetricKeys(allKeys: string[]) {
  const keys = [...new Set(allKeys)]
  const aht = keys.filter((k) => k.startsWith('aht_') || (/aht/i.test(k) && !/attr/i.test(k)))
  const ahtPlanned =
    aht.find((k) => /plan|target|budget|std|sla|goal|bench|objective/i.test(k)) ?? (aht.length ? aht[0]! : null)
  const ahtActual =
    aht.find((k) => /actual|real|result|achieved/i.test(k)) ?? aht.find((k) => k !== ahtPlanned) ?? null
  const ahtCap = aht.find((k) => /\bcap\b|capacity|limit|ceiling/i.test(k)) ?? null

  const attr = keys.filter((k) => k.startsWith('attrition_'))
  const attrAssumption =
    attr.find((k) => /assumpt|plan|target|forecast|expected/i.test(k)) ?? (attr.length ? attr[0]! : null)
  const attrActual =
    attr.find((k) => /actual|true|result/i.test(k)) ?? attr.find((k) => k !== attrAssumption) ?? null

  const shr = keys.filter((k) => k.startsWith('shrinkage_'))
  const shrinkAssumption =
    shr.find((k) => /assumpt|plan|target|forecast|expected|model/i.test(k)) ?? (shr.length ? shr[0]! : null)
  const shrinkActual =
    shr.find((k) => /actual|true|result/i.test(k)) ?? shr.find((k) => k !== shrinkAssumption) ?? null

  const hc = keys.filter((k) => k.startsWith('headcount_'))
  const hcRequirement =
    hc.find((k) => /req|requirement|demand|needed|required/i.test(k)) ?? (hc.length ? hc[0]! : null)
  const hcProjection =
    hc.find((k) => /proj|projection|forecast|plan/i.test(k)) ?? hc.find((k) => k !== hcRequirement) ?? null

  return {
    ahtPlanned,
    ahtActual,
    ahtCap,
    attrAssumption,
    attrActual,
    shrinkAssumption,
    shrinkActual,
    hcRequirement,
    hcProjection,
  }
}

function val(m: Record<string, number>, key: string | null): number {
  if (!key) return 0
  const v = m[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export function aggregateKpisFromRows(rows: ExecutiveUnifiedRow[]): Record<string, number> {
  const allKeys = [...new Set(rows.flatMap((r) => Object.keys(r.metrics)))]
  const sem = resolveSemanticKeys(allKeys)
  const acc: Record<string, number> = {}
  for (const k of allKeys) {
    if (sem.gmPct && k === sem.gmPct) {
      const vals: number[] = []
      for (const r of rows) {
        const v = r.metrics[k]
        if (typeof v === 'number' && Number.isFinite(v)) vals.push(v)
      }
      acc[k] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
      continue
    }
    let s = 0
    for (const r of rows) {
      const v = r.metrics[k]
      if (typeof v === 'number' && Number.isFinite(v)) s += v
    }
    acc[k] = s
  }
  return acc
}

export function aggregateByClient(
  rows: ExecutiveUnifiedRow[],
  opts?: { preferDataset?: 'datasheet' | 'commit_vs_actuals' | 'budget_vs_trending' | 'lw_cw_datasheet' },
): ClientAgg[] {
  const byClient = new Map<string, ExecutiveUnifiedRow[]>()
  for (const r of rows) {
    const c = (r.client_name ?? '').trim() || '— Unassigned —'
    const list = byClient.get(c) ?? []
    list.push(r)
    byClient.set(c, list)
  }
  const allKeys = rows.flatMap((r) => Object.keys(r.metrics))
  const sem = resolveSemanticKeys(allKeys, opts)

  const out: ClientAgg[] = []
  for (const [client, list] of byClient) {
    const metrics = sumMetrics(list)
    const revenue = val(metrics, sem.revenue)
    const gm = val(metrics, sem.gm)
    const peopleFromKey = val(metrics, sem.peopleCost)
    const opex = val(metrics, sem.opex)
    const outsource = val(metrics, sem.outsource)
    const otherRaw = val(metrics, sem.otherDelivery)
    const fte = val(metrics, sem.fte)
    let peopleCost = peopleFromKey
    if (!peopleCost && outsource) peopleCost += outsource
    const otherCost = Math.max(0, otherRaw)
    const marginPct = revenue > 0 ? (gm / revenue) * 100 : null
    const revPerFte = fte > 0 ? revenue / fte : null
    out.push({
      client,
      metrics,
      revenue,
      gm,
      peopleCost,
      opex,
      otherCost,
      fte,
      marginPct,
      revPerFte,
    })
  }
  return out
}

/** Client rollup per calendar month (`month_bucket` YYYY-MM) for time-scrub animations (e.g. profitability map). */
export function monthlyClientAggregateSeries(
  rows: ExecutiveUnifiedRow[],
  opts?: { preferDataset?: 'datasheet' | 'commit_vs_actuals' | 'budget_vs_trending' | 'lw_cw_datasheet' },
): { monthKey: string; label: string; clients: ClientAgg[] }[] {
  const byMonth = new Map<string, ExecutiveUnifiedRow[]>()
  for (const r of rows) {
    const mb = r.month_bucket
    if (!mb || mb.length < 7) continue
    const key = mb.slice(0, 7)
    const list = byMonth.get(key) ?? []
    list.push(r)
    byMonth.set(key, list)
  }
  const keys = [...byMonth.keys()].sort()
  return keys.map((monthKey) => ({
    monthKey,
    label: new Date(monthKey + '-01T12:00:00').toLocaleDateString(undefined, {
      month: 'short',
      year: '2-digit',
    }),
    clients: aggregateByClient(byMonth.get(monthKey) ?? [], opts),
  }))
}

const BUBBLE_BUILTIN = ['__revenue__', '__gm__', '__gm_pct__', '__fte__', '__rev_fte__'] as const

/** Dropdown options: canonical measures plus file column keys. */
export function bubbleDimensionOptions(rows: ExecutiveUnifiedRow[]): string[] {
  const fromFile = measureOptionsForDropdowns(rows)
  return [...BUBBLE_BUILTIN, ...fromFile.filter((k) => !BUBBLE_BUILTIN.includes(k as (typeof BUBBLE_BUILTIN)[number]))]
}

function labelBuiltinBubbleKey(key: string): string {
  switch (key) {
    case '__revenue__':
      return 'Revenue'
    case '__gm__':
      return 'GM $'
    case '__gm_pct__':
      return 'GM %'
    case '__fte__':
      return 'FTE'
    case '__rev_fte__':
      return 'Rev / FTE'
    default:
      return key.replace(/_/g, ' ')
  }
}

export function formatBubbleAxisLabel(key: string): string {
  return BUBBLE_BUILTIN.includes(key as (typeof BUBBLE_BUILTIN)[number]) ? labelBuiltinBubbleKey(key) : key.replace(/_/g, ' ')
}

/** Resolve X/Y/size for profitability bubble when user picks built-ins or raw metric keys. */
export function clientMetricForBubble(
  a: ClientAgg,
  sem: ReturnType<typeof resolveSemanticKeys>,
  key: string,
): number {
  if (!key) return 0
  if (key === '__revenue__') return a.revenue
  if (key === '__gm__') return a.gm
  if (key === '__gm_pct__')
    return a.revenue > 0 ? (a.gm / a.revenue) * 100 : (a.marginPct ?? 0)
  if (key === '__fte__') return a.fte
  if (key === '__rev_fte__') return a.revPerFte ?? 0
  if (sem.revenue && key === sem.revenue) return a.revenue
  if (sem.gm && key === sem.gm) return a.gm
  if (sem.gmPct && key === sem.gmPct) {
    const raw = a.metrics[sem.gmPct]
    return typeof raw === 'number' && Number.isFinite(raw)
      ? raw
      : a.revenue > 0
        ? (a.gm / a.revenue) * 100
        : 0
  }
  const v = a.metrics[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Weekly ops datasets: each ISO week is assigned to one month (majority of Mon–Sun days) before rows land here.
 *
 * Rollup rule:
 * - AHT / Shrinkage / Headcount: **average** per month/week bucket
 * - Attrition: **sum** per month/week bucket (not average)
 */
const WEEKLY_AVG_DATASETS = new Set<DatasetKind>(['shrinkage', 'headcount', 'aht'])

function averageMetricsAcrossRows(rows: ExecutiveUnifiedRow[]): Record<string, number> {
  const keySet = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r.metrics)) keySet.add(k)
  const out: Record<string, number> = {}
  for (const k of keySet) {
    // Average per Project Code (then average across projects) so projects with more rows
    // do not overweight the overall average. Disregard 0 values.
    const byProject = new Map<string, number[]>()
    for (const r of rows) {
      const v = r.metrics[k]
      if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) <= 1e-12) continue
      const pc = (r.project_code ?? '').trim()
      if (!pc) continue
      const list = byProject.get(pc) ?? []
      list.push(v)
      byProject.set(pc, list)
    }
    const perProject: number[] = []
    for (const list of byProject.values()) {
      if (!list.length) continue
      perProject.push(list.reduce((a, b) => a + b, 0) / list.length)
    }
    if (perProject.length > 0) {
      out[k] = perProject.reduce((a, b) => a + b, 0) / perProject.length
      continue
    }
    // Fallback if project codes are missing: average across rows (still ignoring 0s).
    const vals: number[] = []
    for (const r of rows) {
      const v = r.metrics[k]
      if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) > 1e-12) vals.push(v)
    }
    if (vals.length > 0) out[k] = vals.reduce((a, b) => a + b, 0) / vals.length
  }
  return out
}

/**
 * Monthly AUTO-CALC (§4): financial revenue-style facts are **summed** per month;
 * Attrition / Shrinkage / Headcount / AHT weekly rows (already bucketed by majority-month rule in merge) are **averaged** within each month so each week counts once toward that month.
 */
export function monthlyExecutiveTrendSeries(rows: ExecutiveUnifiedRow[]): MonthlyPoint[] {
  const byMonth = new Map<string, ExecutiveUnifiedRow[]>()
  for (const r of rows) {
    const mb = r.month_bucket
    if (!mb) continue
    const key = mb.slice(0, 7)
    const list = byMonth.get(key) ?? []
    list.push(r)
    byMonth.set(key, list)
  }
  const keys = [...byMonth.keys()].sort()
  return keys.map((month) => {
    const list = byMonth.get(month) ?? []
    const weeklyAvgRows = list.filter((r) => WEEKLY_AVG_DATASETS.has(r.dataset))
    const otherRows = list.filter((r) => !WEEKLY_AVG_DATASETS.has(r.dataset))
    const summed = sumMetrics(otherRows)
    const averaged = averageMetricsAcrossRows(weeklyAvgRows)
    const metrics = { ...summed, ...averaged }
    const d = month + '-01'
    const label = new Date(d + 'T12:00:00').toLocaleDateString(undefined, {
      month: 'short',
      year: '2-digit',
    })
    return { month, label, metrics }
  })
}

/** Weekly view: week_start buckets. Weekly ops metrics are averaged; other metrics are summed. */
export function weeklyExecutiveTrendSeries(rows: ExecutiveUnifiedRow[]): WeeklyPoint[] {
  const byWeek = new Map<string, ExecutiveUnifiedRow[]>()
  for (const r of rows) {
    const ws = r.week_start
    if (!ws) continue
    const list = byWeek.get(ws) ?? []
    list.push(r)
    byWeek.set(ws, list)
  }
  const keys = [...byWeek.keys()].sort()
  return keys.map((week) => {
    const list = byWeek.get(week) ?? []
    const weeklyAvgRows = list.filter((r) => WEEKLY_AVG_DATASETS.has(r.dataset))
    const otherRows = list.filter((r) => !WEEKLY_AVG_DATASETS.has(r.dataset))
    const summed = sumMetrics(otherRows)
    const averaged = averageMetricsAcrossRows(weeklyAvgRows)
    const metrics = { ...summed, ...averaged }
    // Match Excel-like axis format (e.g. 1/4/2026)
    const label = new Date(week + 'T12:00:00').toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    })
    return { week, label, metrics }
  })
}

/**
 * Ops tables (Excel-style): group by (period, client) so the table can show
 * Client Name + week/month + Assumption vs Actual columns.
 *
 * Rollup rule mirrors trend logic:
 * - AHT / Shrinkage / Headcount: averaged within the bucket
 * - Attrition: summed within the bucket
 */
export function opsByClientAndPeriod(
  rows: ExecutiveUnifiedRow[],
  mode: 'weekly' | 'monthly',
): OpsClientPoint[] {
  const byKey = new Map<string, ExecutiveUnifiedRow[]>()
  for (const r of rows) {
    const client = (r.client_name ?? '').trim() || '—'
    const periodKey =
      mode === 'weekly'
        ? r.week_start
        : r.month_bucket
          ? r.month_bucket.slice(0, 7)
          : null
    if (!periodKey) continue
    const k = `${periodKey}||${client}`
    const list = byKey.get(k) ?? []
    list.push(r)
    byKey.set(k, list)
  }

  const keys = [...byKey.keys()].sort((a, b) => {
    const [pa, ca] = a.split('||')
    const [pb, cb] = b.split('||')
    if (pa! !== pb!) return pa! < pb! ? -1 : 1
    return ca! < cb! ? -1 : 1
  })

  return keys.map((k) => {
    const [periodKey, client] = k.split('||') as [string, string]
    const list = byKey.get(k) ?? []
    const weeklyAvgRows = list.filter((r) => WEEKLY_AVG_DATASETS.has(r.dataset))
    const otherRows = list.filter((r) => !WEEKLY_AVG_DATASETS.has(r.dataset))
    const summed = sumMetrics(otherRows)
    const averaged = averageMetricsAcrossRows(weeklyAvgRows)
    const metrics = { ...summed, ...averaged }
    const label =
      mode === 'weekly'
        ? new Date(periodKey + 'T12:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' })
        : new Date(periodKey + '-01T12:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
    return { client, periodKey, label, metrics }
  })
}

/** @deprecated Prefer monthlyExecutiveTrendSeries for executive views */
export function monthlyTrendSeries(rows: ExecutiveUnifiedRow[]): MonthlyPoint[] {
  return monthlyExecutiveTrendSeries(rows)
}

export function totalKpiMap(rows: ExecutiveUnifiedRow[]): Record<string, number> {
  return aggregateKpisFromRows(rows)
}

/** For dropdowns: numeric measure keys sorted by total absolute contribution */
export function measureOptionsForDropdowns(rows: ExecutiveUnifiedRow[]): string[] {
  const totals = aggregateKpisFromRows(rows)
  const ranked = Object.entries(totals)
    .filter(([, v]) => Number.isFinite(v) && Math.abs(v) > 1e-9)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([k]) => k)

  // Ensure ops keys are selectable even when the total is 0 (common when blanks/0s exist in weekly sheets).
  const keySet = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r.metrics ?? {})) keySet.add(k)
  const ops = [...keySet].filter((k) => /^(aht|attrition|shrinkage|headcount)_/i.test(k)).sort()

  const out: string[] = []
  const seen = new Set<string>()
  for (const k of ranked) {
    if (seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  for (const k of ops) {
    if (seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

export interface WaterfallSegment {
  label: string
  /** Bar bottom on value scale */
  start: number
  /** Bar top */
  end: number
  /** Signed delta (for tooltip) */
  value: number
  kind: 'total' | 'negative' | 'positive' | 'bridge'
}

export function buildRevenueToGmSegments(
  kpis: Record<string, number>,
  sem: ReturnType<typeof resolveSemanticKeys>,
): WaterfallSegment[] {
  const rev = val(kpis, sem.revenue)
  const gm = val(kpis, sem.gm)
  let salary = val(kpis, sem.salaryCost)
  const training = val(kpis, sem.trainingCost)
  let people = val(kpis, sem.peopleCost)
  if (!salary && people) salary = Math.round(people * 0.84)
  if (!people) people = val(kpis, sem.outsource)
  const opex = val(kpis, sem.opex)
  let other = val(kpis, sem.otherDelivery)
  const impliedCosts = Math.max(0, rev - gm)
  const named = salary + training + opex + other
  if (named < impliedCosts * 0.85 && impliedCosts > 0) {
    other += impliedCosts - named
  }
  const afterSalary = rev - salary
  const afterTraining = afterSalary - training
  const afterOpex = afterTraining - opex
  const s: WaterfallSegment[] = [
    { label: 'Revenue', start: 0, end: rev, value: rev, kind: 'total' },
    {
      label: 'Salary & benefits',
      start: afterSalary,
      end: rev,
      value: -salary,
      kind: 'negative',
    },
    ...(training > 0
      ? [
          {
            label: 'Training',
            start: afterTraining,
            end: afterSalary,
            value: -training,
            kind: 'negative' as const,
          },
        ]
      : []),
    {
      label: 'OPEX',
      start: afterOpex,
      end: afterTraining,
      value: -opex,
      kind: 'negative',
    },
    {
      label: 'Other cost',
      start: afterOpex - other,
      end: afterOpex,
      value: -other,
      kind: 'negative',
    },
    /** GM $ total (summed across rows) — must match KPI GM $ */
    { label: 'GM', start: 0, end: gm, value: gm, kind: 'total' },
  ]
  return s
}

export function buildCommitToActualSegments(
  kpis: Record<string, number>,
  sem: ReturnType<typeof resolveSemanticKeys>,
): WaterfallSegment[] {
  const fin = (key: string | null): number | null => {
    if (!key) return null
    const v = kpis[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }
  const commitRev = fin(sem.commit)
  const actualRev = fin(sem.actual)
  if (commitRev == null || actualRev == null) return []

  const bridge = actualRev - commitRev

  const volKeys = Object.keys(kpis).filter((k) => /volume|call/i.test(k))
  const ahtKeys = Object.keys(kpis).filter((k) => /aht/i.test(k))
  const attrKeys = Object.keys(kpis).filter((k) => /attrition|attr/i.test(k))
  const mixKeys = Object.keys(kpis).filter((k) => /mix|rate|other/i.test(k) && !/revenue/.test(k))
  const t1 = volKeys[0] ? val(kpis, volKeys[0]) : NaN
  const t2 = ahtKeys[0] ? val(kpis, ahtKeys[0]) : NaN
  const t3 = attrKeys[0] ? val(kpis, attrKeys[0]) : NaN
  const t4 = mixKeys[0] ? val(kpis, mixKeys[0]) : NaN
  const labeled: { label: string; v: number }[] = []
  if (Number.isFinite(t1)) labeled.push({ label: 'Call volume', v: t1 })
  if (Number.isFinite(t2)) labeled.push({ label: 'AHT', v: t2 })
  if (Number.isFinite(t3)) labeled.push({ label: 'Attrition', v: t3 })
  if (Number.isFinite(t4)) labeled.push({ label: 'Mix / rate / other', v: t4 })

  /** Only show driver ribbons when KPIs resolve; otherwise a single factual variance bar. */
  const mid: WaterfallSegment[] =
    labeled.length >= 2
      ? (() => {
          let cursor = commitRev
          return labeled.map((d) => {
            const start = cursor
            const end = cursor + d.v
            cursor = end
            return {
              label: d.label,
              start: Math.min(start, end),
              end: Math.max(start, end),
              value: d.v,
              kind: d.v >= 0 ? 'positive' : 'negative',
            } as WaterfallSegment
          })
        })()
      : [
          {
            label: 'Actual − Commit',
            start: Math.min(commitRev, actualRev),
            end: Math.max(commitRev, actualRev),
            value: bridge,
            kind: 'bridge',
          },
        ]

  return [
    { label: 'Commit Revenue', start: 0, end: commitRev, value: commitRev, kind: 'total' },
    ...mid,
    { label: 'Actual Revenue', start: 0, end: actualRev, value: actualRev, kind: 'total' },
  ]
}

/** GM gap to target (25% default) in “dollar opportunity” scale — uses margin % * revenue */
export function gmGapToTarget(agg: ClientAgg[], targetPct = 25): { client: string; gap: number; gmPct: number }[] {
  return agg
    .map((a) => {
      const gmPct = a.revenue > 0 ? (a.gm / a.revenue) * 100 : a.marginPct ?? 0
      const targetGmDollar = a.revenue * (targetPct / 100)
      const gap = targetGmDollar - a.gm
      return { client: a.client, gap, gmPct }
    })
    .filter((x) => Number.isFinite(x.gap))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 12)
}

export function paretoClients(aggs: ClientAgg[], value: 'revenue' | 'gm'): { name: string; value: number; cumPct: number }[] {
  const sorted = [...aggs]
    .filter((a) => a[value] > 0)
    .sort((a, b) => b[value] - a[value])
  const total = sorted.reduce((s, a) => s + a[value], 0)
  let cum = 0
  return sorted.map((a) => {
    cum += a[value]
    return {
      name: a.client,
      value: a[value],
      cumPct: total > 0 ? (cum / total) * 100 : 0,
    }
  })
}

/** Pareto by any merged metric key on ClientAgg.metrics; top = largest first, bottom = smallest first */
export function paretoClientsByMetricKey(
  aggs: ClientAgg[],
  metricKey: string,
  order: 'top' | 'bottom',
  limit: number,
): { name: string; value: number; cumPct: number }[] {
  const rows = aggs
    .map((a) => {
      const raw = a.metrics[metricKey]
      const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0
      return { name: a.client, value }
    })
    .filter((x) => (order === 'top' ? x.value > 0 : true))
  const sorted =
    order === 'top'
      ? [...rows].sort((a, b) => b.value - a.value)
      : [...rows].sort((a, b) => a.value - b.value)
  const taken = sorted.slice(0, Math.max(3, limit))
  const total = taken.reduce((s, a) => s + Math.abs(a.value), 0)
  let cum = 0
  return taken.map((a) => {
    cum += Math.abs(a.value)
    return {
      name: a.name,
      value: a.value,
      cumPct: total > 0 ? (cum / total) * 100 : 0,
    }
  })
}

export interface ChordFlow {
  source: string
  target: string
  value: number
}

export function buildChordFlows(aggs: ClientAgg[], sem: ReturnType<typeof resolveSemanticKeys>): ChordFlow[] {
  const flows: ChordFlow[] = []
  for (const a of aggs) {
    if (a.revenue <= 0 && a.peopleCost + a.opex <= 0) continue
    const s1 = Math.max(0, a.peopleCost)
    const s2 = Math.max(0, val(a.metrics, sem.outsource) || a.peopleCost * 0.12)
    const s3 = Math.max(0, a.opex || a.revenue * 0.04)
    const pool = s1 + s2 + s3
    if (pool <= 1e-6) continue
    flows.push(
      { source: a.client, target: 'Salaries', value: s1 },
      { source: a.client, target: 'Outsource', value: s2 },
      { source: a.client, target: 'OPEX', value: s3 },
    )
  }
  return flows
}

export interface ChordDiagramData {
  labels: string[]
  matrix: number[][]
}

/** Symmetric chord matrix: first `clientCount` nodes are clients, rest are cost sinks */
export function chordDataFromFlows(flows: ChordFlow[], maxClients = 8): ChordDiagramData {
  const costLabels = ['Salaries', 'Outsource', 'OPEX']
  const byClient = new Map<string, Record<string, number>>()
  for (const f of flows) {
    const row = byClient.get(f.source) ?? { Salaries: 0, Outsource: 0, OPEX: 0 }
    if (f.target in row) {
      row[f.target as keyof typeof row] = (row[f.target as keyof typeof row] ?? 0) + f.value
    }
    byClient.set(f.source, row)
  }
  const ranked = [...byClient.entries()]
    .map(([c, m]) => ({
      c,
      t: (m.Salaries ?? 0) + (m.Outsource ?? 0) + (m.OPEX ?? 0),
    }))
    .filter((x) => x.t > 0)
    .sort((a, b) => b.t - a.t)
    .slice(0, maxClients)
  const clients = ranked.map((x) => x.c)
  const labels = [...clients, ...costLabels]
  const n = labels.length
  const matrix: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0))
  let ci = 0
  for (const c of clients) {
    const m = byClient.get(c)
    if (!m) continue
    for (let k = 0; k < costLabels.length; k++) {
      const v = m[costLabels[k]!] ?? 0
      const i = ci
      const j = clients.length + k
      matrix[i]![j]! += v
      matrix[j]![i]! += v
    }
    ci++
  }
  return { labels, matrix }
}

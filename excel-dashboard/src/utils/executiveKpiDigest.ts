import type { DatasetKind, ExecutiveUnifiedRow, WeeklyChangeRow } from '../types/dashboard'
import { resolveSemanticKeys, aggregateByClient } from './executiveAnalytics'
import { formatCompact } from '../components/executive/execChartFormat'

export type ExecutiveKpiDigest = {
  revenue: number
  peopleCost: number
  /** Gross margin dollars (merged totals) */
  gm: number
  /** GM % — from explicit % column (row average) or GM÷Revenue */
  gmPct: number | null
  gmPctSource: 'column_average' | 'revenue_ratio'
  billedFteAvg: number | null
  headcountAvg: number | null
  budget: number
  projection: number
  /** Actual minus baseline (Commit or Projection) */
  revVariance: number | null
  /** GM dollars minus baseline (Commit or Projection) */
  gmVariance: number | null
  varianceBaseline: 'commit' | 'projection'
  peopleCostIntensityPct: number | null
  watchlist: Array<{ name: string; marginPct: number }>
  watchlistSummary: string
  insightRevenue: string
  insightPeople: string
  insightMargin: string
  insightFte: string
  scenarioHint: string
}

function avgForDataset(
  rows: ExecutiveUnifiedRow[],
  dataset: DatasetKind,
  preferKeyRe: RegExp,
): number | null {
  const sub = rows.filter((r) => r.dataset === dataset)
  if (!sub.length) return null
  const keyScores = new Map<string, number>()
  for (const r of sub) {
    for (const k of Object.keys(r.metrics)) {
      const n = r.metrics[k]
      if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) <= 1e-12) continue
      let score = 0
      if (preferKeyRe.test(k)) score += 3
      if (/fte|billed|head|hc|count|staff/i.test(k)) score += 1
      keyScores.set(k, (keyScores.get(k) ?? 0) + score)
    }
  }
  const ranked = [...keyScores.entries()].sort((a, b) => b[1] - a[1])
  const bestKey = ranked[0]?.[0]
  if (!bestKey) return null
  const vals = sub
    .map((r) => r.metrics[bestKey])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) > 1e-12)
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function avgFromAnyRows(rows: ExecutiveUnifiedRow[], key: string | null): number | null {
  if (!key) return null
  const vals = rows
    .map((r) => r.metrics[key])
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) > 1e-12)
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

export function buildExecutiveKpiDigest(
  rows: ExecutiveUnifiedRow[],
  kpis: Record<string, number>,
  scenarioFilter: string,
  opts?: {
    gmPctMode?: 'ratio' | 'prefer_column'
    preferDataset?: 'datasheet' | 'budget_vs_trending' | 'lw_cw_datasheet'
  },
): ExecutiveKpiDigest {
  const keys = Object.keys(kpis)
  const sem = resolveSemanticKeys(keys, { preferDataset: opts?.preferDataset })

  const revenue = sem.revenue ? kpis[sem.revenue] ?? 0 : 0
  const peopleCost = sem.peopleCost ? kpis[sem.peopleCost] ?? 0 : 0
  const gm = sem.gm ? kpis[sem.gm] ?? 0 : 0

  // Requirement: read GM% directly from the preferred base sheet column (e.g. AJ/AK),
  // otherwise use GM ÷ Revenue.
  let gmPct: number | null = null
  let gmPctSource: ExecutiveKpiDigest['gmPctSource'] = 'revenue_ratio'
  if (opts?.gmPctMode === 'prefer_column' && sem.gmPct) {
    const inPreferredDataset = (k: string) =>
      opts?.preferDataset ? k.startsWith(opts.preferDataset + '_') : true
    if (inPreferredDataset(sem.gmPct)) {
    const vals = rows
      .map((r) => r.metrics[sem.gmPct!])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (vals.length) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length
      // Normalize common scaling issues:
      // - 0.231 -> 23.1
      // - 673.1 -> treat as invalid and fall back to ratio
      const scaled = Math.abs(avg) <= 1.5 ? avg * 100 : avg
      if (Math.abs(scaled) <= 200) {
        gmPct = scaled
        gmPctSource = 'column_average'
      }
    }
    }
  }
  if (gmPct == null) {
    gmPct = revenue > 0 && Math.abs(gm) > 1e-9 ? (gm / revenue) * 100 : null
    gmPctSource = 'revenue_ratio'
  }

  const budget = sem.budget ? kpis[sem.budget] ?? 0 : 0
  const projection = sem.projection ? kpis[sem.projection] ?? 0 : 0

  const commitRev = sem.commit ? kpis[sem.commit] ?? 0 : 0
  const actualRev = sem.actual ? kpis[sem.actual] ?? 0 : 0
  const commitGm = commitRev > 0 && gmPct != null ? commitRev * (gmPct / 100) : 0
  const projectionGm = projection > 0 && gmPct != null ? projection * (gmPct / 100) : 0

  const varianceBaseline: ExecutiveKpiDigest['varianceBaseline'] =
    opts?.preferDataset === 'datasheet' ||
    opts?.preferDataset === 'budget_vs_trending' ||
    opts?.preferDataset === 'lw_cw_datasheet'
      ? 'projection'
      : 'commit'

  const revVarianceVsCommit = sem.commit && sem.actual ? actualRev - commitRev : null
  const revVarianceVsProjection = sem.projection && sem.actual ? actualRev - projection : null
  const gmVarianceVsCommit = sem.commit && sem.gm ? gm - commitGm : null
  const gmVarianceVsProjection = sem.projection && sem.gm ? gm - projectionGm : null

  const revVariance = varianceBaseline === 'projection' ? revVarianceVsProjection : revVarianceVsCommit
  const gmVariance = varianceBaseline === 'projection' ? gmVarianceVsProjection : gmVarianceVsCommit

  const peopleCostIntensityPct = revenue > 0 ? (peopleCost / revenue) * 100 : null

  // Billed FTE: prefer the dedicated fte dataset; otherwise use best detected fte semantic key (no fabricated numbers).
  const billedFteAvg = avgForDataset(rows, 'fte', /billed/i) ?? avgFromAnyRows(rows, sem.fte)
  // Headcount: only from `headcount` dataset; prefer projection-style columns.
  const headcountAvg = avgForDataset(rows, 'headcount', /proj|projection/i)

  const clients = aggregateByClient(rows, { preferDataset: opts?.preferDataset })
  const worstClients = [...clients]
    .filter((c) => c.revenue > 0)
    .map((c) => ({ name: c.client, pct: (c.gm / c.revenue) * 100 }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3)
  const watchlist = worstClients
    .filter((w) => Boolean(w.name) && Number.isFinite(w.pct))
    .map((w) => ({ name: w.name, marginPct: w.pct }))
  const watchlistSummary = worstClients.map((w) => w.name).filter(Boolean).join(', ') || '—'

  const rv = revVariance
  const insightRevenue =
    rv != null
      ? `${formatCompact(rv, true)} actual revenue variance versus ${varianceBaseline} for the selected filters.`
      : 'Map actual + projection/commit columns to show variance.'

  const insightPeople =
    peopleCostIntensityPct != null
      ? `${peopleCostIntensityPct.toFixed(1)}% of revenue, with salaries and outsource consultancy separated for review.`
      : 'People cost intensity appears when people-cost and revenue columns are detected.'

  const insightMargin =
    gmPct != null
      ? `${formatCompact(gm, true)} GM (${gmPct.toFixed(1)}%${
          gmPctSource === 'column_average' ? ' from Datasheet GM%' : ' = GM ÷ Revenue'
        }).`
      : 'Gross margin appears when GM and revenue measures are present in the merged model.'

  const insightFte =
    billedFteAvg != null || headcountAvg != null
      ? `Billed FTE avg ${billedFteAvg != null ? billedFteAvg.toFixed(1) : '—'} (fte sheet); Headcount avg ${headcountAvg != null ? headcountAvg.toFixed(1) : '—'} (headcount sheet).`
      : 'Billed FTE and headcount averages appear only when fte / headcount sheets and the right columns are detected—no blended fallbacks.'

  const scenarioHint =
    scenarioFilter ||
    (rows.some((r) => /actual/i.test(String(r.scenario ?? ''))) ? 'Actuals view' : 'All scenarios')

  return {
    revenue,
    peopleCost,
    gm,
    gmPct,
    gmPctSource,
    billedFteAvg,
    headcountAvg,
    budget,
    projection,
    revVariance,
    gmVariance,
    varianceBaseline,
    peopleCostIntensityPct,
    watchlist,
    watchlistSummary,
    insightRevenue,
    insightPeople,
    insightMargin,
    insightFte,
    scenarioHint,
  }
}

export function summarizeWeeklyForKpi(weekly: WeeklyChangeRow[], max = 6): WeeklyChangeRow[] {
  return weekly.slice(0, max)
}

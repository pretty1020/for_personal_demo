import type { ExecutiveUnifiedRow, WeeklyChangeRow } from '../types/dashboard'
import type { ExecCategory } from './executiveMerge'
import {
  aggregateByClient,
  aggregateKpisFromRows,
  buildRevenueToGmSegments,
  resolveSemanticKeys,
  type WaterfallSegment,
} from './executiveAnalytics'
import {
  buildClientVariance,
  buildClientVarianceBetweenScenarios,
  type ClientVarianceRow,
  type PreferFinancialDataset,
  isCommitLocked,
  commitLockNote,
} from './commitVsActualsAnalytics'
import type { CommitActualsKpis } from './commitVsActualsAnalytics'

export type TrendGranularity = 'week' | 'month' | 'quarter'

export type ScenarioPairId = 'projection_vs_actual' | 'budget_vs_projection' | 'commit_vs_actual'

export const SCENARIO_PAIR_META: Record<
  ScenarioPairId,
  { title: string; left: ExecCategory; right: ExecCategory; leftLabel: string; rightLabel: string }
> = {
  projection_vs_actual: {
    title: 'Actuals vs Projections',
    left: 'Projections',
    right: 'Actuals',
    leftLabel: 'Projection',
    rightLabel: 'Actuals',
  },
  budget_vs_projection: {
    title: 'Budget vs Projections',
    left: 'Budget',
    right: 'Projections',
    leftLabel: 'Budget',
    rightLabel: 'Projection',
  },
  commit_vs_actual: {
    title: 'Commit vs Actuals',
    left: 'Commit',
    right: 'Actuals',
    leftLabel: 'Commit',
    rightLabel: 'Actuals',
  },
}

export interface ScenarioTrendPoint {
  periodKey: string
  label: string
  left: number
  right: number
}

export interface ProjectionPeriodVariance {
  periodKey: string
  label: string
  current: number
  prior: number
  variance: number
  variancePct: number | null
}

const REV_KEY = 'commit_vs_actuals_revenue'

function quarterKeyFromMonthBucket(mb: string | null): string | null {
  if (!mb || mb.length < 7) return null
  const y = mb.slice(0, 4)
  const m = Number.parseInt(mb.slice(5, 7), 10)
  if (!Number.isFinite(m) || m < 1 || m > 12) return null
  const q = Math.ceil(m / 3)
  return `${y}-Q${q}`
}

function periodKeyForRow(r: ExecutiveUnifiedRow, granularity: TrendGranularity): string | null {
  if (granularity === 'week') return r.week_start
  if (granularity === 'month') return r.month_bucket ? r.month_bucket.slice(0, 7) : null
  return quarterKeyFromMonthBucket(r.month_bucket)
}

function labelForPeriod(key: string, granularity: TrendGranularity): string {
  if (granularity === 'week') {
    return new Date(key + 'T12:00:00').toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    })
  }
  if (granularity === 'month') {
    return new Date(key + '-01T12:00:00').toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
  }
  const [y, q] = key.split('-Q')
  return `${q} '${y?.slice(2) ?? ''}`
}

function aggregateByPeriodAndScenario(
  rows: ExecutiveUnifiedRow[],
  granularity: TrendGranularity,
): Map<string, Map<ExecCategory, number>> {
  const out = new Map<string, Map<ExecCategory, number>>()
  for (const r of rows) {
    const pk = periodKeyForRow(r, granularity)
    if (!pk || !r.scenario) continue
    const sc = r.scenario as ExecCategory
    const rev = r.metrics[REV_KEY]
    if (typeof rev !== 'number' || !Number.isFinite(rev)) continue
    if (!out.has(pk)) out.set(pk, new Map())
    const m = out.get(pk)!
    m.set(sc, (m.get(sc) ?? 0) + rev)
  }
  return out
}

export function buildScenarioPairTrend(
  rows: ExecutiveUnifiedRow[],
  granularity: TrendGranularity,
  pairId: ScenarioPairId,
): ScenarioTrendPoint[] {
  const meta = SCENARIO_PAIR_META[pairId]
  const byPeriod = aggregateByPeriodAndScenario(rows, granularity)
  const keys = [...byPeriod.keys()].sort()
  return keys.map((periodKey) => {
    const m = byPeriod.get(periodKey)!
    return {
      periodKey,
      label: labelForPeriod(periodKey, granularity),
      left: m.get(meta.left) ?? 0,
      right: m.get(meta.right) ?? 0,
    }
  })
}

export function buildAllScenarioPairTrends(
  rows: ExecutiveUnifiedRow[],
  granularity: TrendGranularity,
): Record<ScenarioPairId, ScenarioTrendPoint[]> {
  const ids: ScenarioPairId[] = ['projection_vs_actual', 'budget_vs_projection', 'commit_vs_actual']
  const out = {} as Record<ScenarioPairId, ScenarioTrendPoint[]>
  for (const id of ids) out[id] = buildScenarioPairTrend(rows, granularity, id)
  return out
}

export function buildProjectionPeriodVariance(
  rows: ExecutiveUnifiedRow[],
  granularity: TrendGranularity,
): ProjectionPeriodVariance[] {
  const projRows = rows.filter((r) => r.scenario === 'Projections')
  const byPeriod = aggregateByPeriodAndScenario(projRows, granularity)
  const keys = [...byPeriod.keys()].sort()
  const out: ProjectionPeriodVariance[] = []
  for (let i = 0; i < keys.length; i++) {
    const periodKey = keys[i]!
    const current = byPeriod.get(periodKey)?.get('Projections') ?? 0
    const prior = i > 0 ? (byPeriod.get(keys[i - 1]!)?.get('Projections') ?? 0) : 0
    const variance = i > 0 ? current - prior : 0
    const variancePct = i > 0 && prior !== 0 ? (variance / Math.abs(prior)) * 100 : null
    out.push({
      periodKey,
      label: labelForPeriod(periodKey, granularity),
      current,
      prior,
      variance,
      variancePct,
    })
  }
  return out.filter((_, i) => i > 0)
}

export function granularityLabel(g: TrendGranularity): string {
  switch (g) {
    case 'week':
      return 'Week on week'
    case 'month':
      return 'Month on month'
    case 'quarter':
      return 'Quarter on quarter'
  }
}

export interface IdealFinancialPanelModel {
  kpis: CommitActualsKpis
  clientVarianceBudget: ClientVarianceRow[]
  clientVarianceCommit: ClientVarianceRow[]
  clientVarianceProjection: ClientVarianceRow[]
  clientVarianceBudgetVsProjection: ClientVarianceRow[]
  revenueToMarginBridge: WaterfallSegment[]
  projectionWow: WeeklyChangeRow[]
  trends: Record<ScenarioPairId, ScenarioTrendPoint[]>
  projectionPeriodVariance: ProjectionPeriodVariance[]
  commitLocked: boolean
  commitLockNote: string
}

export function buildIdealFinancialPanelModel(input: {
  rows: ExecutiveUnifiedRow[]
  projectionWow: WeeklyChangeRow[]
  granularity: TrendGranularity
  preferDataset?: PreferFinancialDataset
  /** When true, KPI cards reflect the latest week in scope (not summed across all weeks). */
  latestWeekKpis?: boolean
}): IdealFinancialPanelModel {
  const { rows, projectionWow, granularity, preferDataset = 'commit_vs_actuals', latestWeekKpis = true } = input
  const allKeys = rows.flatMap((r) => Object.keys(r.metrics))
  const sem = resolveSemanticKeys(allKeys, { preferDataset })

  const kpiRows = (() => {
    if (!latestWeekKpis) return rows
    const weeks = [...new Set(rows.map((r) => r.week_start).filter(Boolean))].sort()
    const latest = weeks[weeks.length - 1]
    return latest ? rows.filter((r) => r.week_start === latest) : rows
  })()

  const actualRows = kpiRows.filter((r) => r.scenario === 'Actuals')
  const actualKpis = aggregateKpisFromRows(actualRows.length ? actualRows : kpiRows)
  const budgetKpis = aggregateKpisFromRows(kpiRows.filter((r) => r.scenario === 'Budget'))
  const commitKpis = aggregateKpisFromRows(kpiRows.filter((r) => r.scenario === 'Commit'))
  const projKpis = aggregateKpisFromRows(kpiRows.filter((r) => r.scenario === 'Projections'))

  const val = (kpis: Record<string, number>, key: string | null) => {
    if (!key) return 0
    const v = kpis[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }

  const revenueKey =
    sem.revenue ??
    allKeys.find((k) => /commit_vs_actuals.*revenue/i.test(k)) ??
    allKeys.find((k) => /revenue/i.test(k)) ??
    null

  const scenarioTagged =
    Boolean(revenueKey) &&
    rows.some((r) => r.scenario === 'Budget' || r.scenario === 'Commit' || r.scenario === 'Projections')

  const revenue = val(actualKpis, scenarioTagged ? revenueKey : sem.actual || sem.revenue)
  const gm = val(actualKpis, sem.gm)
  const budget = val(budgetKpis, scenarioTagged ? revenueKey : sem.budget || sem.projection)
  const commit = val(commitKpis, scenarioTagged ? revenueKey : sem.commit)
  const projection = val(projKpis, scenarioTagged ? revenueKey : sem.projection)

  let gmPct: number | null = null
  if (sem.gmPct && actualRows.length) {
    const vals = actualRows
      .map((r) => r.metrics[sem.gmPct!])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (vals.length) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length
      gmPct = Math.abs(avg) <= 1.5 ? avg * 100 : avg
    }
  }
  if (gmPct == null && revenue > 0) gmPct = (gm / revenue) * 100

  const hoursKey =
    allKeys.find((k) => /commit_vs_actuals.*hour/i.test(k) && !/per|rate/i.test(k)) ??
    allKeys.find((k) => /\bhour\b|\bhrs\b/i.test(k) && !/per|rate/i.test(k)) ??
    null
  let hours = 0
  for (const r of actualRows.length ? actualRows : rows) {
    if (hoursKey) {
      const v = r.metrics[hoursKey]
      if (typeof v === 'number' && Number.isFinite(v)) hours += v
    }
  }
  const peopleCost = val(actualKpis, sem.peopleCost)
  const salaryCost = val(actualKpis, sem.salaryCost) || Math.round(peopleCost * 0.84)
  const trainingCost = val(actualKpis, sem.trainingCost)
  const projectedRevenue = val(projKpis, 'commit_vs_actuals_projected_revenue') || projection
  const projectedCost = val(projKpis, 'commit_vs_actuals_projected_cost')
  const opex = val(actualKpis, sem.opex)
  const otherCost = val(actualKpis, sem.otherDelivery)
  const totalCost = salaryCost + trainingCost + opex + otherCost
  const costVarianceVsProjected = totalCost - projectedCost
  const revPerHour = hours > 0 ? revenue / hours : null
  const costPerHour = hours > 0 ? totalCost / hours : null

  return {
    kpis: {
      budget,
      actual: revenue,
      commit,
      projection,
      revenue,
      gm,
      gmPct,
      revVarianceVsBudget: revenue - budget,
      revVarianceVsCommit: revenue - commit,
      revPerHour,
      costPerHour,
      hours,
      salaryCost,
      trainingCost,
      peopleCost,
      opex,
      otherCost,
      totalCost,
      projectedRevenue,
      projectedCost,
      costVarianceVsProjected,
    },
    clientVarianceBudget: buildClientVariance(rows, 'Budget', preferDataset),
    clientVarianceCommit: buildClientVariance(rows, 'Commit', preferDataset),
    clientVarianceBudgetVsProjection: buildClientVarianceBetweenScenarios(
      rows,
      'Budget',
      'Projections',
      preferDataset,
    ),
    clientVarianceProjection: (() => {
      const actualAggs = aggregateByClient(actualRows.length ? actualRows : rows, { preferDataset })
      const projRows = rows.filter((r) => r.scenario === 'Projections')
      const projAggs = aggregateByClient(projRows.length ? projRows : rows, { preferDataset })
      const baseByClient = new Map(projAggs.map((a) => [a.client, a.revenue]))
      return actualAggs
        .map((a) => {
          const base = baseByClient.get(a.client) ?? 0
          const varianceDollar = a.revenue - base
          return {
            client: a.client,
            actual: a.revenue,
            baseline: base,
            varianceDollar,
            variancePct: base !== 0 ? (varianceDollar / Math.abs(base)) * 100 : null,
          }
        })
        .filter((x) => Math.abs(x.actual) > 1e-9 || Math.abs(x.baseline) > 1e-9)
        .sort((a, b) => Math.abs(b.varianceDollar) - Math.abs(a.varianceDollar))
    })(),
    revenueToMarginBridge: buildRevenueToGmSegments(actualKpis, sem),
    projectionWow,
    trends: buildAllScenarioPairTrends(rows, granularity),
    projectionPeriodVariance: buildProjectionPeriodVariance(rows, granularity),
    commitLocked: isCommitLocked(),
    commitLockNote: commitLockNote(),
  }
}

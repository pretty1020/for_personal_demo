import type { ExecutiveUnifiedRow, WeeklyChangeRow } from '../types/dashboard'
import type { ExecCategory } from './executiveMerge'
import {
  aggregateByClient,
  aggregateKpisFromRows,
  buildRevenueToGmSegments,
  resolveSemanticKeys,
  weeklyExecutiveTrendSeries,
  type WaterfallSegment,
} from './executiveAnalytics'
import { rowInPeriod, type CalendarQuarter, type PeriodView } from './executiveQuarter'

export type PreferFinancialDataset =
  | 'datasheet'
  | 'commit_vs_actuals'
  | 'budget_vs_trending'
  | 'lw_cw_datasheet'

export interface CommitActualsKpis {
  budget: number
  actual: number
  commit: number
  projection: number
  revenue: number
  gm: number
  gmPct: number | null
  revVarianceVsBudget: number | null
  revVarianceVsCommit: number | null
  revPerHour: number | null
  costPerHour: number | null
  hours: number
  salaryCost: number
  trainingCost: number
  peopleCost: number
  opex: number
  otherCost: number
  totalCost: number
  projectedRevenue: number
  projectedCost: number
  costVarianceVsProjected: number
}

export interface ClientVarianceRow {
  client: string
  actual: number
  baseline: number
  varianceDollar: number
  variancePct: number | null
}

export interface WeekScenarioPoint {
  week: string
  label: string
  budget: number
  actual: number
}

export interface MonthScenarioPoint {
  month: string
  label: string
  budget: number
  actual: number
  variance: number
  variancePct: number | null
}

export type BudgetActualTrend =
  | { mode: 'weekly'; points: WeekScenarioPoint[]; disclaimer?: undefined }
  | { mode: 'monthly'; points: MonthScenarioPoint[]; disclaimer: string }

const MONTHLY_BUDGET_DISCLAIMER =
  'Budget is shown at monthly granularity only; weekly budget is not available in the source data.'

export interface CommitActualsModel {
  kpis: CommitActualsKpis
  clientVariance: ClientVarianceRow[]
  weeklyBudgetVsActual: WeekScenarioPoint[]
  budgetActualTrend: BudgetActualTrend
  monthlyBudgetVariance: MonthScenarioPoint[]
  projectionWow: WeeklyChangeRow[]
  revenueToMarginBridge: WaterfallSegment[]
  commitLocked: boolean
  commitLockNote: string
}

const COMMIT_LOCK_DAY = 11

export function isCommitLocked(asOf: Date = new Date()): boolean {
  return asOf.getDate() >= COMMIT_LOCK_DAY
}

export function commitLockNote(asOf: Date = new Date()): string {
  const month = asOf.toLocaleString(undefined, { month: 'long', year: 'numeric' })
  if (isCommitLocked(asOf)) {
    return `Commit is locked for ${month} (locked on the ${COMMIT_LOCK_DAY}th of each month).`
  }
  return `Commit unlocks on the ${COMMIT_LOCK_DAY}th — values may still change before then.`
}

function rowsForScenario(rows: ExecutiveUnifiedRow[], scenario: ExecCategory): ExecutiveUnifiedRow[] {
  return rows.filter((r) => r.scenario === scenario)
}

function valFromKpis(kpis: Record<string, number>, key: string | null): number {
  if (!key) return 0
  const v = kpis[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** Revenue metric for scenario-tagged rows (e.g. commit_vs_actuals_revenue on Budget / Actuals rows). */
export function resolveScenarioRevenueKey(
  sem: ReturnType<typeof resolveSemanticKeys>,
  preferDataset?: PreferFinancialDataset,
): string | null {
  if (sem.revenue) return sem.revenue
  if (preferDataset) {
    const prefixed = `${preferDataset}_revenue`
    return prefixed
  }
  return sem.actual ?? sem.commit ?? null
}

function formatMonthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-')
  const yi = Number(y)
  const mi = Number(m)
  if (!Number.isFinite(yi) || !Number.isFinite(mi)) return yyyyMm
  return new Date(yi, mi - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

function sumScenarioRevenue(rows: ExecutiveUnifiedRow[], scenario: ExecCategory, revKey: string | null): number {
  if (!revKey) return 0
  let s = 0
  for (const r of rowsForScenario(rows, scenario)) {
    const v = r.metrics[revKey]
    if (typeof v === 'number' && Number.isFinite(v)) s += v
  }
  return s
}

function resolveHoursKey(keys: string[]): string | null {
  const prefixed =
    keys.find((k) => /commit_vs_actuals.*hour/i.test(k) && !/per|rate/i.test(k)) ??
    keys.find((k) => /budget_vs_trending.*hour/i.test(k) && !/per|rate/i.test(k)) ??
    null
  if (prefixed) return prefixed

  const ranked = keys
    .map((k) => {
      const l = k.toLowerCase()
      let score = 0
      if (/productive.*hour|billable.*hour|total.*hour/.test(l)) score += 5
      if (/\bhour\b|\bhrs\b|handle_time|handletime/.test(l)) score += 3
      if (/per.*hour|\/hour|hourly|rate/.test(l)) score -= 4
      if (/cost|revenue|rev|gm|margin|fte|head/.test(l)) score -= 2
      return { k, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  return ranked[0]?.k ?? null
}

function sumHours(rows: ExecutiveUnifiedRow[], hoursKey: string | null): number {
  if (!hoursKey) return 0
  let s = 0
  for (const r of rows) {
    const v = r.metrics[hoursKey]
    if (typeof v === 'number' && Number.isFinite(v)) s += v
  }
  return s
}

export function filterCommitActualsRows(
  rows: ExecutiveUnifiedRow[],
  opts: {
    periodView: PeriodView
    calendarYear: string
    monthPrefix: string
    quarter: CalendarQuarter | ''
    client: string
    preferDatasets?: PreferFinancialDataset[]
  },
): ExecutiveUnifiedRow[] {
  let r = rows
  if (opts.preferDatasets?.length) {
    const allowed = new Set(opts.preferDatasets)
    const scoped = r.filter((x) => allowed.has(x.dataset as PreferFinancialDataset))
    if (scoped.length) r = scoped
  }
  if (opts.client) r = r.filter((x) => (x.client_name ?? '') === opts.client)
  if (opts.periodView !== 'month' || opts.monthPrefix || opts.quarter || opts.calendarYear) {
    r = r.filter((row) =>
      rowInPeriod(row, opts.periodView, opts.calendarYear, opts.monthPrefix, opts.quarter),
    )
  }
  return r
}

export function buildWeeklyBudgetVsActual(
  rows: ExecutiveUnifiedRow[],
  preferDataset?: PreferFinancialDataset,
): WeekScenarioPoint[] {
  const weekly = weeklyExecutiveTrendSeries(rows)
  if (!weekly.length) return []

  const allKeys = rows.flatMap((r) => Object.keys(r.metrics))
  const sem = resolveSemanticKeys(allKeys, { preferDataset })
  const revKey = resolveScenarioRevenueKey(sem, preferDataset)

  return weekly.map((p) => {
    const budgetRows = rows.filter((r) => r.week_start === p.week && r.scenario === 'Budget')
    const actualRows = rows.filter((r) => r.week_start === p.week && r.scenario === 'Actuals')
    const budgetKpis = aggregateKpisFromRows(budgetRows.length ? budgetRows : rows.filter((r) => r.scenario === 'Budget' && r.week_start === p.week))
    const actualKpis = aggregateKpisFromRows(actualRows.length ? actualRows : rows.filter((r) => r.scenario === 'Actuals' && r.week_start === p.week))
    const budget = valFromKpis(budgetKpis, revKey)
    const actual = valFromKpis(actualKpis, revKey)
    return {
      week: p.week,
      label: p.label,
      budget,
      actual,
    }
  })
}

export function buildMonthlyBudgetVsActual(
  rows: ExecutiveUnifiedRow[],
  preferDataset?: PreferFinancialDataset,
): MonthScenarioPoint[] {
  const allKeys = rows.flatMap((r) => Object.keys(r.metrics))
  const sem = resolveSemanticKeys(allKeys, { preferDataset })
  const revKey = resolveScenarioRevenueKey(sem, preferDataset)
  if (!revKey) return []

  const byMonth = new Map<string, { budget: number; actual: number }>()
  for (const r of rows) {
    const mb = r.month_bucket?.slice(0, 7)
    if (!mb) continue
    const cur = byMonth.get(mb) ?? { budget: 0, actual: 0 }
    const v = r.metrics[revKey]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    if (r.scenario === 'Budget') cur.budget += v
    if (r.scenario === 'Actuals') cur.actual += v
    byMonth.set(mb, cur)
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => {
      const variance = v.actual - v.budget
      const variancePct = v.budget !== 0 ? (variance / Math.abs(v.budget)) * 100 : null
      return {
        month,
        label: formatMonthLabel(month),
        budget: v.budget,
        actual: v.actual,
        variance,
        variancePct,
      }
    })
}

export function resolveBudgetActualTrend(
  rows: ExecutiveUnifiedRow[],
  preferDataset?: PreferFinancialDataset,
): BudgetActualTrend {
  const weekly = buildWeeklyBudgetVsActual(rows, preferDataset)
  const monthly = buildMonthlyBudgetVsActual(rows, preferDataset)
  const weeklyHasBudget = weekly.some((p) => Math.abs(p.budget) >= 0.5)
  const monthlyHasBudget = monthly.some((p) => Math.abs(p.budget) >= 0.5)

  if (weeklyHasBudget) {
    return { mode: 'weekly', points: weekly }
  }
  if (monthlyHasBudget) {
    return { mode: 'monthly', points: monthly, disclaimer: MONTHLY_BUDGET_DISCLAIMER }
  }
  return { mode: 'weekly', points: weekly }
}

export function buildClientVarianceBetweenScenarios(
  rows: ExecutiveUnifiedRow[],
  baselineScenario: ExecCategory,
  compareScenario: ExecCategory,
  preferDataset?: PreferFinancialDataset,
): ClientVarianceRow[] {
  const compareRows = rowsForScenario(rows, compareScenario)
  const baselineRows = rowsForScenario(rows, baselineScenario)
  const compareAggs = aggregateByClient(compareRows.length ? compareRows : rows, { preferDataset })
  const baseAggs = aggregateByClient(baselineRows.length ? baselineRows : rows, { preferDataset })
  const baseByClient = new Map(baseAggs.map((a) => [a.client, a.revenue]))

  return compareAggs
    .map((a) => {
      const base = baseByClient.get(a.client) ?? 0
      const varianceDollar = a.revenue - base
      const variancePct = base !== 0 ? (varianceDollar / Math.abs(base)) * 100 : null
      return {
        client: a.client,
        actual: a.revenue,
        baseline: base,
        varianceDollar,
        variancePct,
      }
    })
    .filter((x) => Math.abs(x.actual) > 1e-9 || Math.abs(x.baseline) > 1e-9)
    .sort((a, b) => Math.abs(b.varianceDollar) - Math.abs(a.varianceDollar))
}

export function buildClientVariance(
  rows: ExecutiveUnifiedRow[],
  baseline: 'Budget' | 'Commit',
  preferDataset?: PreferFinancialDataset,
): ClientVarianceRow[] {
  const actualRows = rowsForScenario(rows, 'Actuals')
  const baselineRows = rowsForScenario(rows, baseline)
  const actualAggs = aggregateByClient(actualRows.length ? actualRows : rows, { preferDataset })
  const baseAggs = aggregateByClient(baselineRows.length ? baselineRows : rows, { preferDataset })
  const baseByClient = new Map(baseAggs.map((a) => [a.client, a.revenue]))

  return actualAggs
    .map((a) => {
      const base = baseByClient.get(a.client) ?? 0
      const varianceDollar = a.revenue - base
      const variancePct = base !== 0 ? (varianceDollar / Math.abs(base)) * 100 : null
      return {
        client: a.client,
        actual: a.revenue,
        baseline: base,
        varianceDollar,
        variancePct,
      }
    })
    .filter((x) => Math.abs(x.actual) > 1e-9 || Math.abs(x.baseline) > 1e-9)
    .sort((a, b) => Math.abs(b.varianceDollar) - Math.abs(a.varianceDollar))
}

export function buildCommitActualsModel(input: {
  rows: ExecutiveUnifiedRow[]
  projectionWow: WeeklyChangeRow[]
  preferDataset?: PreferFinancialDataset
  varianceBaseline?: 'Budget' | 'Commit'
}): CommitActualsModel {
  const { rows, projectionWow, preferDataset, varianceBaseline = 'Budget' } = input
  const allKeys = rows.flatMap((r) => Object.keys(r.metrics))
  const sem = resolveSemanticKeys(allKeys, { preferDataset })

  const actualKpis = aggregateKpisFromRows(rowsForScenario(rows, 'Actuals'))

  const revKey = resolveScenarioRevenueKey(sem, preferDataset)
  const budget = sumScenarioRevenue(rows, 'Budget', revKey)
  const actual = sumScenarioRevenue(rows, 'Actuals', revKey)
  const commit = sumScenarioRevenue(rows, 'Commit', revKey)
  const projection = sumScenarioRevenue(rows, 'Projections', revKey)
  const revenue = actual
  const gm = valFromKpis(actualKpis, sem.gm) || valFromKpis(aggregateKpisFromRows(rows), sem.gm)

  let gmPct: number | null = null
  if (sem.gmPct) {
    const vals = rowsForScenario(rows, 'Actuals')
      .map((r) => r.metrics[sem.gmPct!])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (vals.length) {
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length
      gmPct = Math.abs(avg) <= 1.5 ? avg * 100 : avg
      if (Math.abs(gmPct) > 200) gmPct = revenue > 0 ? (gm / revenue) * 100 : null
    }
  }
  if (gmPct == null && revenue > 0) gmPct = (gm / revenue) * 100

  const hoursKey = resolveHoursKey(allKeys)
  const actualOnly = rowsForScenario(rows, 'Actuals').length ? rowsForScenario(rows, 'Actuals') : rows
  const hours = sumHours(actualOnly, hoursKey)
  const peopleCostKey =
    sem.peopleCost ?? allKeys.find((k) => /commit_vs_actuals_people_cost/i.test(k)) ?? null
  let peopleCost = valFromKpis(actualKpis, peopleCostKey)
  if (!peopleCost && peopleCostKey) {
    for (const r of actualOnly) {
      const v = r.metrics[peopleCostKey]
      if (typeof v === 'number' && Number.isFinite(v)) peopleCost += v
    }
  }
  const revPerHour = hours > 0 ? revenue / hours : null
  const salaryCost = valFromKpis(actualKpis, sem.salaryCost) || Math.round(peopleCost * 0.84)
  const trainingCost = valFromKpis(actualKpis, sem.trainingCost)
  const opex = valFromKpis(actualKpis, sem.opex)
  const otherCost = valFromKpis(actualKpis, sem.otherDelivery)
  const totalCost = salaryCost + trainingCost + opex + otherCost
  const costPerHour = hours > 0 ? totalCost / hours : null
  const projKpis = aggregateKpisFromRows(rowsForScenario(rows, 'Projections'))
  const projectedRevenue =
    valFromKpis(projKpis, 'commit_vs_actuals_projected_revenue') || projection
  const projectedCost =
    valFromKpis(projKpis, 'commit_vs_actuals_projected_cost') || totalCost
  const costVarianceVsProjected = totalCost - projectedCost

  const clientVariance = buildClientVariance(rows, varianceBaseline, preferDataset)
  const weeklyBudgetVsActual = buildWeeklyBudgetVsActual(rows, preferDataset)
  const budgetActualTrend = resolveBudgetActualTrend(rows, preferDataset)
  const monthlyBudgetVariance = buildMonthlyBudgetVsActual(rows, preferDataset)
  const revenueToMarginBridge = buildRevenueToGmSegments(aggregateKpisFromRows(rowsForScenario(rows, 'Actuals').length ? rowsForScenario(rows, 'Actuals') : rows), sem)

  return {
    kpis: {
      budget,
      actual,
      commit,
      projection,
      revenue,
      gm,
      gmPct,
      revVarianceVsBudget: actual - budget,
      revVarianceVsCommit: actual - commit,
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
    clientVariance,
    weeklyBudgetVsActual,
    budgetActualTrend,
    monthlyBudgetVariance,
    projectionWow,
    revenueToMarginBridge,
    commitLocked: isCommitLocked(),
    commitLockNote: commitLockNote(),
  }
}

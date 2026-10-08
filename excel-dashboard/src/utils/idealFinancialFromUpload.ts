import type { ExecutiveUnifiedRow, WeeklyChangeRow } from '../types/dashboard'
import { resolveSemanticKeys } from './executiveAnalytics'
import type { IdealSampleRow } from './idealFinancialSample'

function collectMetricKeys(rows: ExecutiveUnifiedRow[]): string[] {
  return [...new Set(rows.flatMap((r) => Object.keys(r.metrics)))]
}

function sumMetricForWeek(rows: ExecutiveUnifiedRow[], week: string, key: string | null): number {
  if (!key) return 0
  let s = 0
  for (const r of rows) {
    if ((r.week_start ?? '') !== week) continue
    const v = r.metrics[key]
    if (typeof v === 'number' && Number.isFinite(v)) s += v
  }
  return s
}

function resolveHoursKey(keys: string[]): string | null {
  const exact = keys.find((k) => /^commit_vs_actuals_hours$/i.test(k) || /_hours$/i.test(k))
  if (exact) return exact
  return (
    keys.find(
      (k) =>
        /hours|productive|billable\s*hour|labor\s*hour/i.test(k.toLowerCase()) &&
        !/aht|attrition|shrink/i.test(k.toLowerCase()),
    ) ?? null
  )
}

/**
 * Week-on-week projection totals (same shape as {@link buildIdealProjectionWow}) using uploaded
 * `commit_vs_actuals` rows with scenario `Projections`.
 */
export function buildProjectionWowFromCommitFacts(facts: ExecutiveUnifiedRow[]): WeeklyChangeRow[] {
  const proj = facts.filter(
    (r) => r.dataset === 'commit_vs_actuals' && r.scenario === 'Projections' && Boolean(r.week_start?.trim()),
  )
  if (!proj.length) return []
  const weeks = [...new Set(proj.map((r) => r.week_start!).filter(Boolean))].sort()
  if (weeks.length < 2) return []

  const keys = collectMetricKeys(proj)
  const sem = resolveSemanticKeys(keys, { preferDataset: 'commit_vs_actuals' })
  const hoursKey = resolveHoursKey(keys)

  const lwWeek = weeks[weeks.length - 2]!
  const cwWeek = weeks[weeks.length - 1]!

  const lwRev = sumMetricForWeek(proj, lwWeek, sem.revenue)
  const cwRev = sumMetricForWeek(proj, cwWeek, sem.revenue)
  const lwGm = sumMetricForWeek(proj, lwWeek, sem.gm)
  const cwGm = sumMetricForWeek(proj, cwWeek, sem.gm)
  const lwGmPctCol = sem.gmPct ? sumMetricForWeek(proj, lwWeek, sem.gmPct) : null
  const cwGmPctCol = sem.gmPct ? sumMetricForWeek(proj, cwWeek, sem.gmPct) : null
  const lwGmPct = lwRev > 0 ? (lwGm / lwRev) * 100 : lwGmPctCol ?? 0
  const cwGmPct = cwRev > 0 ? (cwGm / cwRev) * 100 : cwGmPctCol ?? lwGmPct

  const metrics = ['Revenue', 'GM', 'People Cost', 'Productive Hours', 'GM %']
  const lwBase = [
    lwRev,
    lwGm,
    sumMetricForWeek(proj, lwWeek, sem.peopleCost),
    sumMetricForWeek(proj, lwWeek, hoursKey),
    lwGmPct,
  ]
  const cwBase = [
    cwRev,
    cwGm,
    sumMetricForWeek(proj, cwWeek, sem.peopleCost),
    sumMetricForWeek(proj, cwWeek, hoursKey),
    cwGmPct,
  ]

  return metrics.map((metric, i) => {
    const lw = lwBase[i]!
    const cw = cwBase[i]!
    const variance = cw - lw
    const variancePct = lw !== 0 ? (variance / Math.abs(lw)) * 100 : null
    let direction: WeeklyChangeRow['direction'] = 'flat'
    if (variance > 0) direction = 'up'
    else if (variance < 0) direction = 'down'
    return { metric, lastWeek: lw, currentWeek: cw, variance, variancePct, direction }
  })
}

/** Actuals preview rows from uploaded facts (same columns as sample table). */
export function buildCommitActualsTableRowsFromFacts(facts: ExecutiveUnifiedRow[]): IdealSampleRow[] {
  const actual = facts.filter(
    (r) => r.dataset === 'commit_vs_actuals' && r.scenario === 'Actuals' && Boolean(r.week_start?.trim()),
  )
  if (!actual.length) return []
  const keys = collectMetricKeys(actual)
  const sem = resolveSemanticKeys(keys, { preferDataset: 'commit_vs_actuals' })
  const hoursKey = resolveHoursKey(keys)

  return actual.map((r) => {
    const peopleCost = sem.peopleCost ? (r.metrics[sem.peopleCost] ?? 0) : 0
  return {
    fy: String(r.fy ?? ''),
    month: (r.month_bucket ?? '').slice(0, 7),
    week: r.week_start ?? '',
    projectCode: r.project_code,
    client: r.client_name ?? '',
    location: r.location ?? '',
    scenario: String(r.scenario ?? 'Actuals'),
    revenue: sem.revenue ? (r.metrics[sem.revenue] ?? 0) : 0,
    gm: sem.gm ? (r.metrics[sem.gm] ?? 0) : 0,
    gmPct: sem.gmPct ? (r.metrics[sem.gmPct] ?? 0) : 0,
    salaryCost: sem.salaryCost ? (r.metrics[sem.salaryCost] ?? 0) : Math.round(peopleCost * 0.84),
    trainingCost: sem.trainingCost ? (r.metrics[sem.trainingCost] ?? 0) : 0,
    peopleCost,
    opex: sem.opex ? (r.metrics[sem.opex] ?? 0) : 0,
    otherCost: sem.otherDelivery ? (r.metrics[sem.otherDelivery] ?? 0) : 0,
    hours: hoursKey ? (r.metrics[hoursKey] ?? 0) : 0,
    projectedRevenue: r.metrics.commit_vs_actuals_projected_revenue ?? (sem.revenue ? (r.metrics[sem.revenue] ?? 0) : 0),
    projectedCost:
      r.metrics.commit_vs_actuals_projected_cost ??
      (sem.peopleCost ? (r.metrics[sem.peopleCost] ?? 0) : 0) +
        (sem.trainingCost ? (r.metrics[sem.trainingCost] ?? 0) : 0) +
        (sem.opex ? (r.metrics[sem.opex] ?? 0) : 0),
  }
  })
}

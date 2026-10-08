import type { ExecutiveUnifiedRow, WeeklyChangeRow } from '../types/dashboard'
import type { WaterfallSegment } from './executiveAnalytics'

const REV = 'commit_vs_actuals_revenue'
const GM = 'commit_vs_actuals_gm'
const PEOPLE = 'commit_vs_actuals_people_cost'
const OPEX = 'commit_vs_actuals_opex'
const HOURS = 'commit_vs_actuals_hours'

export function formatProjectionWeekLabel(weekIso: string): string {
  return new Date(weekIso + 'T12:00:00').toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function filterProjectionRows(
  rows: ExecutiveUnifiedRow[],
  opts?: { client?: string; location?: string; weekStart?: string; weekEnd?: string },
): ExecutiveUnifiedRow[] {
  let out = rows.filter((r) => r.scenario === 'Projections')
  if (opts?.client) out = out.filter((r) => (r.client_name ?? '') === opts.client)
  if (opts?.location) out = out.filter((r) => (r.location ?? '') === opts.location)
  if (opts?.weekStart) out = out.filter((r) => (r.week_start ?? '') >= opts.weekStart!)
  if (opts?.weekEnd) out = out.filter((r) => (r.week_start ?? '') <= opts.weekEnd!)
  return out
}

export function availableProjectionWeeks(rows: ExecutiveUnifiedRow[]): string[] {
  return [...new Set(filterProjectionRows(rows).map((r) => r.week_start).filter(Boolean) as string[])].sort()
}

function sumForWeek(proj: ExecutiveUnifiedRow[], week: string, key: string): number {
  return proj
    .filter((r) => r.week_start === week)
    .reduce((a, r) => {
      const v = r.metrics[key]
      return a + (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    }, 0)
}

export type ProjectionWeekTrendPoint = {
  week: string
  label: string
  revenue: number
  gm: number
  peopleCost: number
  hours: number
  gmPct: number | null
}

export function buildProjectionWeeklyTrend(
  rows: ExecutiveUnifiedRow[],
  opts?: { client?: string; location?: string; weekStart?: string; weekEnd?: string },
): ProjectionWeekTrendPoint[] {
  const proj = filterProjectionRows(rows, opts)
  const weeks = [...new Set(proj.map((r) => r.week_start).filter(Boolean) as string[])].sort()
  return weeks.map((week) => {
    const revenue = sumForWeek(proj, week, REV)
    const gm = sumForWeek(proj, week, GM)
    const peopleCost = sumForWeek(proj, week, PEOPLE)
    const hours = sumForWeek(proj, week, HOURS)
    return {
      week,
      label: formatProjectionWeekLabel(week),
      revenue,
      gm,
      peopleCost,
      hours,
      gmPct: revenue > 0 ? (gm / revenue) * 100 : null,
    }
  })
}

export function buildProjectionWowCompare(
  rows: ExecutiveUnifiedRow[],
  lwWeek: string,
  cwWeek: string,
  client?: string,
): WeeklyChangeRow[] {
  if (!lwWeek || !cwWeek) return []
  const proj = filterProjectionRows(rows, { client })

  const lwRev = sumForWeek(proj, lwWeek, REV)
  const cwRev = sumForWeek(proj, cwWeek, REV)
  const lwGm = sumForWeek(proj, lwWeek, GM)
  const cwGm = sumForWeek(proj, cwWeek, GM)
  const lwPeople = sumForWeek(proj, lwWeek, PEOPLE)
  const cwPeople = sumForWeek(proj, cwWeek, PEOPLE)
  const lwHours = sumForWeek(proj, lwWeek, HOURS)
  const cwHours = sumForWeek(proj, cwWeek, HOURS)
  const lwGmPct = lwRev > 0 ? (lwGm / lwRev) * 100 : null
  const cwGmPct = cwRev > 0 ? (cwGm / cwRev) * 100 : null

  const specs: { metric: string; lw: number | null; cw: number | null }[] = [
    { metric: 'Revenue', lw: lwRev, cw: cwRev },
    { metric: 'GM', lw: lwGm, cw: cwGm },
    { metric: 'People Cost', lw: lwPeople, cw: cwPeople },
    { metric: 'Productive Hours', lw: lwHours, cw: cwHours },
    { metric: 'GM %', lw: lwGmPct, cw: cwGmPct },
  ]

  return specs.map(({ metric, lw, cw }) => {
    const variance = lw != null && cw != null ? cw - lw : null
    const variancePct =
      lw != null && lw !== 0 && cw != null ? ((cw - lw) / Math.abs(lw)) * 100 : null
    let direction: WeeklyChangeRow['direction'] = 'flat'
    if (variance != null) {
      if (variance > 0) direction = 'up'
      else if (variance < 0) direction = 'down'
    }
    return { metric, lastWeek: lw, currentWeek: cw, variance, variancePct, direction }
  })
}

/** Consecutive week-on-week projection revenue change (historical WoW $). */
export function buildProjectionRevenueWowSeries(
  trend: ProjectionWeekTrendPoint[],
): { week: string; label: string; variance: number; variancePct: number | null }[] {
  const out: { week: string; label: string; variance: number; variancePct: number | null }[] = []
  for (let i = 1; i < trend.length; i++) {
    const prev = trend[i - 1]!
    const cur = trend[i]!
    const variance = cur.revenue - prev.revenue
    const variancePct = prev.revenue !== 0 ? (variance / Math.abs(prev.revenue)) * 100 : null
    out.push({
      week: cur.week,
      label: `${prev.label} → ${cur.label}`,
      variance,
      variancePct,
    })
  }
  return out
}

/** Revenue → People Cost → Other Cost → GM bridge for one projection week. */
export function buildProjectionBridgeForWeek(
  rows: ExecutiveUnifiedRow[],
  week: string,
  client?: string,
  location?: string,
): WaterfallSegment[] {
  if (!week) return []
  const proj = filterProjectionRows(rows, { client, location })
  const revenue = sumForWeek(proj, week, REV)
  const gm = sumForWeek(proj, week, GM)
  const people = sumForWeek(proj, week, PEOPLE)
  const opex = sumForWeek(proj, week, OPEX)
  let other = Math.max(0, revenue - gm - people - opex)
  const otherCost = opex + other
  if (revenue <= 0 && gm <= 0 && people <= 0) return []

  return [
    { label: 'Revenue', start: 0, end: revenue, value: revenue, kind: 'total' },
    {
      label: 'People Cost',
      start: revenue - people,
      end: revenue,
      value: -people,
      kind: 'negative',
    },
    {
      label: 'Other Cost',
      start: revenue - people - otherCost,
      end: revenue - people,
      value: -otherCost,
      kind: 'negative',
    },
    { label: 'GM', start: 0, end: gm, value: gm, kind: 'total' },
  ]
}

export function defaultProjectionWowWeeks(weeks: string[]): { lwWeek: string; cwWeek: string } {
  if (weeks.length >= 2) {
    return { lwWeek: weeks[weeks.length - 2]!, cwWeek: weeks[weeks.length - 1]! }
  }
  const only = weeks[0] ?? ''
  return { lwWeek: only, cwWeek: only }
}

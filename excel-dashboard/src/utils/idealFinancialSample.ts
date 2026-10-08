import type { ExecutiveUnifiedRow, WeeklyChangeRow } from '../types/dashboard'
import type { ExecCategory } from './executiveMerge'
import { IDEAL_SAMPLE_CLIENTS, IDEAL_SAMPLE_WEEKS } from './idealSampleShared'
import {
  PORTFOLIO_WEEKLY_REVENUE_PER_AGENT,
  PORTFOLIO_WEEKLY_REVENUE_TARGET,
} from './portfolioConstants'

export { IDEAL_SAMPLE_CLIENTS, IDEAL_SAMPLE_WEEKS } from './idealSampleShared'
export { downloadApplicationSampleData as downloadIdealFinancialSampleXlsx } from './applicationSampleData'

/** Workbook tab name for the financial facts sheet in the sample .xlsx */
export const IDEAL_SAMPLE_SHEET = 'Financial_Sample'

export const IDEAL_SAMPLE_DISPLAY_NAME = 'Ideal Financial Sample'

const CLIENTS = IDEAL_SAMPLE_CLIENTS

const TOTAL_BUDGET_BASE = CLIENTS.reduce((s, c) => s + c.budgetBase, 0)

const SCENARIOS: ExecCategory[] = ['Budget', 'Actuals', 'Commit', 'Projections']

const WEEKS = IDEAL_SAMPLE_WEEKS

function monthBucketFromWeek(weekIso: string): string {
  const d = new Date(weekIso + 'T12:00:00')
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

function scenarioMultiplier(scenario: ExecCategory, weekIdx: number): number {
  const season = 1 + 0.022 * Math.sin((weekIdx / Math.max(WEEKS.length - 1, 1)) * Math.PI * 2)
  const weekNoise = 0.978 + ((weekIdx * 7 + 2) % 17) * 0.0028
  const stress = weekIdx === 3 || weekIdx === 9 ? 0.93 : weekIdx === 7 ? 1.04 : 1
  switch (scenario) {
    case 'Budget':
      return season * stress
    case 'Commit':
      return season * stress * 0.992
    case 'Projections':
      return season * stress * 1.008
    case 'Actuals':
      return season * weekNoise * stress * 0.996
    default:
      return 1
  }
}

function clientWeekTrend(clientIdx: number, weekIdx: number): number {
  const slope = 1 + (weekIdx - 5.5) * 0.0022 * ((clientIdx % 7) - 3)
  const pulse = weekIdx % 6 === 2 ? 1.028 : weekIdx % 5 === 0 ? 0.965 : 1
  return slope * pulse
}

function callCenterCostSplit(revenue: number, clientIdx: number, weekIdx: number) {
  const peoplePct = 0.58 + (clientIdx % 5) * 0.008 + (weekIdx % 3) * 0.003
  const trainingPct = 0.02 + (clientIdx % 4) * 0.002
  const opexPct = 0.085 + (clientIdx % 3) * 0.004 + (weekIdx % 4) * 0.002
  const gmPct = 0.21 + (clientIdx % 6) * 0.006 + (weekIdx % 4) * 0.004 + (weekIdx === 3 ? -0.012 : weekIdx === 7 ? 0.006 : 0)

  const peopleCost = Math.round(revenue * peoplePct)
  const trainingCost = Math.round(revenue * trainingPct)
  const opex = Math.round(revenue * opexPct)
  const gm = Math.round(revenue * gmPct)
  const salaryCost = Math.round(peopleCost * (0.84 + (clientIdx % 3) * 0.01))
  const otherCost = Math.max(0, revenue - gm - peopleCost - trainingCost - opex)

  return {
    gm,
    gmPct: gmPct * 100,
    peopleCost,
    salaryCost,
    trainingCost,
    opex,
    otherCost,
  }
}

function projectedCostFromComponents(componentTotal: number, clientIdx: number, weekIdx: number): number {
  const planBuffer = 1.02 + (clientIdx % 4) * 0.006 + (weekIdx % 3) * 0.004
  return Math.round(componentTotal * planBuffer)
}

function agentsFromRevenue(revenue: number): number {
  return Math.max(2, Math.round(revenue / PORTFOLIO_WEEKLY_REVENUE_PER_AGENT))
}

function clientSkew(clientIdx: number, scenario: ExecCategory): number {
  const base = 0.91 + (clientIdx % 11) * 0.011
  if (scenario === 'Actuals') return base * (0.985 + (clientIdx % 5) * 0.005)
  if (scenario === 'Commit') return base * 0.994
  if (scenario === 'Projections') return base * 1.009
  return base
}

export function buildIdealFinancialFacts(): ExecutiveUnifiedRow[] {
  const rows: ExecutiveUnifiedRow[] = []
  for (let wi = 0; wi < WEEKS.length; wi++) {
    const week_start = WEEKS[wi]!
    const month_bucket = monthBucketFromWeek(week_start)
    const fy = 'FY26'
    for (let ci = 0; ci < CLIENTS.length; ci++) {
      const c = CLIENTS[ci]!
      for (const scenario of SCENARIOS) {
        const mult =
          scenarioMultiplier(scenario, wi) * clientSkew(ci, scenario) * clientWeekTrend(ci, wi)
        const clientShare = c.budgetBase / TOTAL_BUDGET_BASE
        const revenue = Math.round(PORTFOLIO_WEEKLY_REVENUE_TARGET * clientShare * mult)
        const costs = callCenterCostSplit(revenue, ci, wi)
        const agents = agentsFromRevenue(revenue)
        const shrinkWeek = 0.25 + (wi % 6) * 0.003 + (ci % 5) * 0.001
        const hours = Math.round(agents * 37.5 * (1 - shrinkWeek))
        const projectedRevenue = Math.round(
          PORTFOLIO_WEEKLY_REVENUE_TARGET *
            clientShare *
            scenarioMultiplier('Projections', wi) *
            clientSkew(ci, 'Projections') *
            clientWeekTrend(ci, wi),
        )
        const componentTotal = costs.salaryCost + costs.trainingCost + costs.opex + costs.otherCost
        const projectedCost =
          scenario === 'Projections'
            ? projectedCostFromComponents(componentTotal, ci, wi)
            : 0

        rows.push({
          dataset: 'commit_vs_actuals',
          sheetName: IDEAL_SAMPLE_SHEET,
          project_code: c.code,
          fy,
          month_bucket,
          week_start,
          scenario,
          client_name: c.name,
          location: c.location,
          metrics: {
            commit_vs_actuals_revenue: revenue,
            commit_vs_actuals_gm: costs.gm,
            commit_vs_actuals_gm_pct: costs.gmPct,
            commit_vs_actuals_people_cost: costs.peopleCost,
            commit_vs_actuals_salary_cost: costs.salaryCost,
            commit_vs_actuals_training_cost: costs.trainingCost,
            commit_vs_actuals_opex: costs.opex,
            commit_vs_actuals_other_cost: costs.otherCost,
            commit_vs_actuals_hours: hours,
            commit_vs_actuals_projected_revenue: projectedRevenue,
            commit_vs_actuals_projected_cost: projectedCost,
          },
        })
      }
    }
  }
  return rows
}

export function buildIdealProjectionWow(): WeeklyChangeRow[] {
  const weeks = IDEAL_SAMPLE_WEEKS
  const lwWeek = weeks[weeks.length - 2]
  const cwWeek = weeks[weeks.length - 1]
  const facts = buildIdealFinancialFacts()
  const sumProj = (week: string | undefined) =>
    facts
      .filter((r) => r.scenario === 'Projections' && r.week_start === week)
      .reduce((a, r) => a + (r.metrics.commit_vs_actuals_revenue ?? 0), 0)
  const sumGm = (week: string | undefined) =>
    facts
      .filter((r) => r.scenario === 'Projections' && r.week_start === week)
      .reduce((a, r) => a + (r.metrics.commit_vs_actuals_gm ?? 0), 0)
  const sumPeople = (week: string | undefined) =>
    facts
      .filter((r) => r.scenario === 'Projections' && r.week_start === week)
      .reduce((a, r) => a + (r.metrics.commit_vs_actuals_people_cost ?? 0), 0)
  const sumHours = (week: string | undefined) =>
    facts
      .filter((r) => r.scenario === 'Projections' && r.week_start === week)
      .reduce((a, r) => a + (r.metrics.commit_vs_actuals_hours ?? 0), 0)
  const lwRev = sumProj(lwWeek)
  const cwRev = sumProj(cwWeek)
  const lwGm = sumGm(lwWeek)
  const cwGm = sumGm(cwWeek)
  const lwGmPct = lwRev > 0 ? (lwGm / lwRev) * 100 : 26.5
  const cwGmPct = cwRev > 0 ? (cwGm / cwRev) * 100 : lwGmPct

  const metrics = ['Revenue', 'GM', 'People Cost', 'Productive Hours', 'GM %']
  const lwBase = [lwRev, lwGm, sumPeople(lwWeek), sumHours(lwWeek), lwGmPct]
  const cwBase = [cwRev, cwGm, sumPeople(cwWeek), sumHours(cwWeek), cwGmPct]
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

export type IdealSampleRow = {
  fy: string
  month: string
  week: string
  projectCode: string
  client: string
  location: string
  scenario: string
  revenue: number
  gm: number
  gmPct: number
  salaryCost: number
  trainingCost: number
  peopleCost: number
  opex: number
  otherCost: number
  hours: number
  projectedRevenue: number
  projectedCost: number
}

export function buildIdealSampleTableRows(): IdealSampleRow[] {
  return buildIdealFinancialFacts()
    .filter((r) => r.scenario === 'Actuals')
    .map((r) => ({
      fy: String(r.fy ?? ''),
      month: (r.month_bucket ?? '').slice(0, 7),
      week: r.week_start ?? '',
      projectCode: r.project_code,
      client: r.client_name ?? '',
      location: r.location ?? '',
      scenario: r.scenario ?? '',
      revenue: r.metrics.commit_vs_actuals_revenue ?? 0,
      gm: r.metrics.commit_vs_actuals_gm ?? 0,
      gmPct: r.metrics.commit_vs_actuals_gm_pct ?? 0,
      salaryCost: r.metrics.commit_vs_actuals_salary_cost ?? 0,
      trainingCost: r.metrics.commit_vs_actuals_training_cost ?? 0,
      peopleCost: r.metrics.commit_vs_actuals_people_cost ?? 0,
      opex: r.metrics.commit_vs_actuals_opex ?? 0,
      otherCost: r.metrics.commit_vs_actuals_other_cost ?? 0,
      hours: r.metrics.commit_vs_actuals_hours ?? 0,
      projectedRevenue: r.metrics.commit_vs_actuals_projected_revenue ?? 0,
      projectedCost: r.metrics.commit_vs_actuals_projected_cost ?? 0,
    }))
}


export function uniqIdealClients(rows: ExecutiveUnifiedRow[]): string[] {
  return [...new Set(rows.map((r) => r.client_name ?? '').filter(Boolean))].sort()
}

export function uniqIdealMonths(rows: ExecutiveUnifiedRow[]): string[] {
  return [...new Set(rows.map((r) => (r.month_bucket ? r.month_bucket.slice(0, 7) : '')).filter(Boolean))].sort()
}

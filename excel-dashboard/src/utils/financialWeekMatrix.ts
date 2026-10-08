import type { ExecutiveUnifiedRow } from '../types/dashboard'
import type { ExecCategory } from './executiveMerge'
import { periodWeekDate } from '../planner/capacityMatrixMetrics'

export type FinancialMatrixRow = {
  id: string
  sectionId: 'revenue' | 'cost' | 'margin'
  label: string
  scenario?: ExecCategory
  metricKey: string
  kind?: 'value' | 'variance'
  higherIsBetter?: boolean
}

export const FINANCIAL_MATRIX_SECTIONS = [
  { id: 'revenue', title: 'Revenue' },
  { id: 'cost', title: 'Cost' },
  { id: 'margin', title: 'Margin' },
] as const

export const FINANCIAL_MATRIX_ROWS: FinancialMatrixRow[] = [
  { id: 'actualRev', sectionId: 'revenue', label: 'Actuals', scenario: 'Actuals', metricKey: 'commit_vs_actuals_revenue' },
  {
    id: 'projRev',
    sectionId: 'revenue',
    label: 'Projections',
    scenario: 'Projections',
    metricKey: 'commit_vs_actuals_revenue',
  },
  {
    id: 'revVariance',
    sectionId: 'revenue',
    label: 'Revenue variance (Act − Proj)',
    kind: 'variance',
    higherIsBetter: true,
    metricKey: '_revVariance',
  },
  { id: 'salary', sectionId: 'cost', label: 'Salary & benefits', scenario: 'Actuals', metricKey: 'commit_vs_actuals_salary_cost' },
  { id: 'training', sectionId: 'cost', label: 'Training cost', scenario: 'Actuals', metricKey: 'commit_vs_actuals_training_cost' },
  { id: 'opex', sectionId: 'cost', label: 'OPEX', scenario: 'Actuals', metricKey: 'commit_vs_actuals_opex' },
  { id: 'other', sectionId: 'cost', label: 'Other cost', scenario: 'Actuals', metricKey: 'commit_vs_actuals_other_cost' },
  {
    id: 'projCost',
    sectionId: 'cost',
    label: 'Projected cost',
    scenario: 'Projections',
    metricKey: 'commit_vs_actuals_projected_cost',
  },
  { id: 'totalCost', sectionId: 'cost', label: 'Total cost', scenario: 'Actuals', metricKey: '_totalCost' },
  {
    id: 'costVariance',
    sectionId: 'cost',
    label: 'Cost variance (Act − Proj)',
    kind: 'variance',
    higherIsBetter: false,
    metricKey: '_costVariance',
  },
  { id: 'gm', sectionId: 'margin', label: 'Gross margin', scenario: 'Actuals', metricKey: 'commit_vs_actuals_gm' },
  { id: 'gmPct', sectionId: 'margin', label: 'GM %', scenario: 'Actuals', metricKey: 'commit_vs_actuals_gm_pct' },
  {
    id: 'gmVariance',
    sectionId: 'margin',
    label: 'GM variance (Act − Proj)',
    kind: 'variance',
    higherIsBetter: true,
    metricKey: '_gmVariance',
  },
]

export type FinancialWeekMatrix = {
  weeks: string[]
  weekLabels: string[]
  values: Record<string, number[]>
}

function rowTotalCost(r: ExecutiveUnifiedRow): number {
  const salary = r.metrics.commit_vs_actuals_salary_cost ?? 0
  const training = r.metrics.commit_vs_actuals_training_cost ?? 0
  const opex = r.metrics.commit_vs_actuals_opex ?? 0
  const other = r.metrics.commit_vs_actuals_other_cost ?? 0
  return salary + training + opex + other
}

function sumMetric(rows: ExecutiveUnifiedRow[], scenario: ExecCategory | undefined, metricKey: string): number {
  const weekRows = rows.filter((r) => !scenario || r.scenario === scenario)
  if (!weekRows.length) return 0
  if (metricKey === '_totalCost') {
    return weekRows.reduce((s, r) => s + rowTotalCost(r), 0)
  }
  if (metricKey === 'commit_vs_actuals_gm_pct') {
    const pcts = weekRows
      .map((r) => r.metrics.commit_vs_actuals_gm_pct)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    return pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0
  }
  return weekRows.reduce((s, r) => {
    const v = r.metrics[metricKey]
    return s + (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  }, 0)
}

export function buildFinancialWeekMatrix(rows: ExecutiveUnifiedRow[]): FinancialWeekMatrix {
  const weeks = [...new Set(rows.map((r) => r.week_start).filter(Boolean))].sort() as string[]
  const weekLabels = weeks.map((_, i) => periodWeekDate(i))

  const values: Record<string, number[]> = {}

  for (const row of FINANCIAL_MATRIX_ROWS) {
    if (row.kind === 'variance') continue
    values[row.id] = weeks.map((week) => {
      const weekRows = rows.filter((r) => r.week_start === week)
      return sumMetric(weekRows, row.scenario, row.metricKey)
    })
  }

  values.revVariance = weeks.map((_, wi) => (values.actualRev?.[wi] ?? 0) - (values.projRev?.[wi] ?? 0))
  values.costVariance = weeks.map((_, wi) => (values.totalCost?.[wi] ?? 0) - (values.projCost?.[wi] ?? 0))
  values.gmVariance = weeks.map((_, wi) => {
    const actualGm = values.gm?.[wi] ?? 0
    const projRows = rows.filter((r) => r.week_start === weeks[wi] && r.scenario === 'Projections')
    const projGm = projRows.reduce((s, r) => s + (r.metrics.commit_vs_actuals_gm ?? 0), 0)
    return actualGm - projGm
  })

  return { weeks, weekLabels, values }
}

export function formatFinancialCell(rowId: string, value: number): string {
  if (!Number.isFinite(value)) return '—'
  const row = FINANCIAL_MATRIX_ROWS.find((r) => r.id === rowId)
  if (row?.kind === 'variance') {
    const sign = value >= 0 ? '+' : '−'
    const abs = Math.abs(value)
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`
    return `${sign}$${Math.round(abs).toLocaleString()}`
  }
  if (rowId === 'gmPct') return `${value.toFixed(1)}%`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${Math.round(value).toLocaleString()}`
}

export function financialMatrixTone(rowId: string, value: number): string {
  const row = FINANCIAL_MATRIX_ROWS.find((r) => r.id === rowId)
  if (row?.kind !== 'variance' || !Number.isFinite(value)) return 'neutral'
  if (Math.abs(value) < 500) return 'neutral'
  const favorable = row.higherIsBetter ? value >= 0 : value <= 0
  return favorable ? 'variance-pos' : 'variance-neg'
}

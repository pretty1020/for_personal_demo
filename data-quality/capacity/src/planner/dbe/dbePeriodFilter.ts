import {
  capacityPeriodLabel,
  defaultCapacityPeriodState,
  type CapacityPeriodState,
  weeksMatchingCapacityPeriod,
} from '../capacityPeriod'
import { formatFiscalMonthLabel, listFiscalMonthKeys, type DbeClientCombinedMonth } from './dbePersistence'

const DBE_PERIOD_STORAGE_KEY = 'wfp-dbe-period-v1'

const DBE_PERIOD_MODES = ['month', 'quarter', 'h1', 'h2', 'full_year'] as const

export type DbePeriodMode = (typeof DBE_PERIOD_MODES)[number]

export function defaultDbePeriodState(fiscalStartYear: number): CapacityPeriodState {
  const months = listFiscalMonthKeys(fiscalStartYear)
  return {
    mode: 'month',
    years: [String(fiscalStartYear), String(fiscalStartYear + 1)],
    months: months.length ? [months[0]!] : defaultCapacityPeriodState().months,
    quarters: ['Q1', 'Q2', 'Q3', 'Q4'],
  }
}
export function loadDbePeriod(fiscalStartYear: number): CapacityPeriodState {
  const fallback = defaultDbePeriodState(fiscalStartYear)
  try {
    const raw = localStorage.getItem(DBE_PERIOD_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<CapacityPeriodState>
    const mode = DBE_PERIOD_MODES.includes(parsed.mode as DbePeriodMode)
      ? (parsed.mode as CapacityPeriodState['mode'])
      : fallback.mode
    return {
      mode,
      years: Array.isArray(parsed.years) && parsed.years.length ? parsed.years : fallback.years,
      months: Array.isArray(parsed.months) && parsed.months.length ? parsed.months : fallback.months,
      quarters: Array.isArray(parsed.quarters) && parsed.quarters.length ? parsed.quarters : fallback.quarters,
    }
  } catch {
    return fallback
  }
}

export function saveDbePeriod(state: CapacityPeriodState): void {
  localStorage.setItem(DBE_PERIOD_STORAGE_KEY, JSON.stringify(state))
}

function monthKeyMatchesPeriod(monthKey: string, state: CapacityPeriodState, fiscalStartYear: number): boolean {
  if (state.mode === 'full_year') {
    const yearSet = new Set(state.years)
    if (yearSet.has(String(fiscalStartYear))) return true
    return yearSet.has(monthKey.slice(0, 4))
  }
  const anchorWeek = `${monthKey}-07`
  return weeksMatchingCapacityPeriod([anchorWeek], state).length > 0
}

export function filterDbeMonthKeys(
  allMonths: string[],
  state: CapacityPeriodState,
  fiscalStartYear: number,
): string[] {
  if (state.mode === 'month') {
    if (!state.months.length) return allMonths
    const selected = new Set(state.months)
    return allMonths.filter((month) => selected.has(month))
  }
  return allMonths.filter((month) => monthKeyMatchesPeriod(month, state, fiscalStartYear))
}

function quarterForMonthNum(monthNum: number): string {
  if (monthNum <= 3) return 'Q1'
  if (monthNum <= 6) return 'Q2'
  if (monthNum <= 9) return 'Q3'
  return 'Q4'
}

export function periodBucketLabelForMonth(monthKey: string, state: CapacityPeriodState): string {
  const year = monthKey.slice(0, 4)
  const monthNum = Number.parseInt(monthKey.slice(5, 7), 10)
  if (state.mode === 'quarter') return `${quarterForMonthNum(monthNum)} ${year}`
  if (state.mode === 'h1') return `H1 ${year}`
  if (state.mode === 'h2') return `H2 ${year}`
  if (state.mode === 'full_year') return `FY ${year}`
  return formatFiscalMonthLabel(monthKey)
}

export type DbeFinancialChartPoint = {
  label: string
  totalRevenue: number
  totalCost: number
  gm: number
  gmPct: number
}

export function buildDbeFinancialChartSeries(
  rows: DbeClientCombinedMonth[],
  state: CapacityPeriodState,
): DbeFinancialChartPoint[] {
  if (!rows.length) return []

  if (state.mode === 'month') {
    return rows.map((row) => ({
      label: formatFiscalMonthLabel(row.month),
      totalRevenue: row.totalRevenue,
      totalCost: row.totalCost,
      gm: row.gm,
      gmPct: row.gmPct,
    }))
  }

  const buckets = new Map<string, { totalRevenue: number; totalCost: number; gm: number }>()
  for (const row of rows) {
    const label = periodBucketLabelForMonth(row.month, state)
    const prev = buckets.get(label) ?? { totalRevenue: 0, totalCost: 0, gm: 0 }
    buckets.set(label, {
      totalRevenue: prev.totalRevenue + row.totalRevenue,
      totalCost: prev.totalCost + row.totalCost,
      gm: prev.gm + row.gm,
    })
  }

  return [...buckets.entries()].map(([label, values]) => ({
    label,
    totalRevenue: values.totalRevenue,
    totalCost: values.totalCost,
    gm: values.gm,
    gmPct: values.totalRevenue > 0 ? (values.gm / values.totalRevenue) * 100 : 0,
  }))
}

export function dbePeriodSummaryLabel(state: CapacityPeriodState, fiscalStartYear: number): string {
  if (state.mode === 'full_year' && state.years.includes(String(fiscalStartYear))) {
    return `FY ${fiscalStartYear}–${String(fiscalStartYear + 1).slice(2)}`
  }
  return capacityPeriodLabel(state)
}

export { DBE_PERIOD_MODES }

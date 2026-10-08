import type { Aggregation, ChartKind, ColumnFilters, SheetSnapshot } from '../types/dashboard'
import { applyFilters } from './filters'
import { formatAxisLabel } from './inferTypes'
import { rowLooksLikePivotTotal } from './pivotTotalRows'

export interface ChartDatum {
  /** X label */
  name: string
  /** Numeric value(s) — may include stacked keys */
  value: number
  [seriesKey: string]: string | number | undefined | null
}

function aggregateVals(values: number[], agg: Aggregation): number {
  if (values.length === 0) return 0
  switch (agg) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'average':
      return values.reduce((a, b) => a + b, 0) / values.length
    case 'count':
      return values.length
    case 'min':
      return Math.min(...values)
    case 'max':
      return Math.max(...values)
    default:
      return values.reduce((a, b) => a + b, 0)
  }
}

function getYNumbers(rows: SheetSnapshot['rows'], key: string): number[] {
  const out: number[] = []
  for (const r of rows) {
    const v = r[key]
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v)
  }
  return out
}

function getXComparable(v: unknown): { label: string; sortKey: number | string } {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return { label: formatAxisLabel(v), sortKey: v.getTime() }
  }
  const label = formatAxisLabel(v)
  return { label, sortKey: label }
}

export interface BuildChartSeriesResult {
  data: ChartDatum[]
  /** For donut inner radius styling */
  isDonut?: boolean
  /** Category keys present in stacked dataset */
  seriesKeys?: string[]
  /** Error message when chart cannot render */
  error?: string
}

export function buildChartSeries(args: {
  snapshot: SheetSnapshot
  filters: ColumnFilters
  chartType: ChartKind
  xKey: string
  yKey: string
  categoryKey?: string
  sizeKey?: string
  aggregation: Aggregation
  /** Default false: omit pivot Total / Grand Total rows from series. */
  includePivotTotalRows?: boolean
}): BuildChartSeriesResult {
  const {
    snapshot,
    filters,
    chartType,
    xKey,
    yKey,
    categoryKey,
    sizeKey,
    aggregation,
    includePivotTotalRows = false,
  } = args
  const cols = snapshot.columns
  const hasX = cols.some((c) => c.key === xKey)
  const hasY = cols.some((c) => c.key === yKey)
  if (!hasX || !hasY) {
    return { data: [], error: 'Pick valid X and Y columns to build this chart.' }
  }

  const filtered = applyFilters(snapshot, filters)
  const chartRows =
    includePivotTotalRows
      ? filtered.rows
      : filtered.rows.filter((r) => !rowLooksLikePivotTotal(r, cols))
  if (chartRows.length === 0) {
    return {
      data: [],
      error:
        filtered.rows.length > 0 && !includePivotTotalRows
          ? 'No rows left — only pivot Total / Grand Total rows match. Turn on “Include pivot Total rows” or widen filters.'
          : 'No rows left after applying filters.',
    }
  }

  const scatterLike = chartType === 'scatter' || chartType === 'bubble'

  if (scatterLike) {
    const cx = cols.find((c) => c.key === xKey)
    const cy = cols.find((c) => c.key === yKey)
    if (!cx || !cy || cx.type !== 'number' || cy.type !== 'number') {
      return {
        data: [],
        error: 'Scatter and bubble charts need numeric columns on both X and Y.',
      }
    }
    const data: ChartDatum[] = []
    let i = 0
    for (const r of chartRows) {
      const xv = r[xKey]
      const yv = r[yKey]
      if (typeof xv !== 'number' || typeof yv !== 'number') continue
      const point: ChartDatum = {
        name: `p${i++}`,
        value: yv,
        x: xv,
        y: yv,
      }
      if (chartType === 'bubble' && sizeKey) {
        const sz = r[sizeKey]
        if (typeof sz === 'number' && Number.isFinite(sz) && sz > 0) {
          point.z = sz
        } else {
          point.z = 8
        }
      } else if (chartType === 'bubble') {
        point.z = 12
      }
      if (categoryKey) {
        point.cat = String(r[categoryKey] ?? '—')
      }
      data.push(point)
    }
    if (data.length === 0) {
      return { data: [], error: 'No numeric X/Y pairs found for this chart.' }
    }
    return { data }
  }

  /* Category / grouped bar-line-area */
  if (categoryKey && categoryKey !== '') {
    type GroupMap = Map<string, Map<string, number[]>>
    const groups: GroupMap = new Map()
    const sortKeyByX = new Map<string, number | string>()

    for (const r of chartRows) {
      const xc = getXComparable(r[xKey])
      const xv = xc.label
      const catRaw = r[categoryKey]
      const cat = formatAxisLabel(catRaw)
      const nums = getYNumbers([r], yKey)
      if (nums.length === 0) continue
      if (!groups.has(xv)) groups.set(xv, new Map())
      if (!sortKeyByX.has(xv)) sortKeyByX.set(xv, xc.sortKey)
      const inner = groups.get(xv)!
      if (!inner.has(cat)) inner.set(cat, [])
      inner.get(cat)!.push(...nums)
    }

    const categories = [...new Set([...groups.values()].flatMap((m) => [...m.keys()]))].sort()
    const xLabels = [...groups.keys()].sort((a, b) => {
      const sa = sortKeyByX.get(a) ?? a
      const sb = sortKeyByX.get(b) ?? b
      if (typeof sa === 'number' && typeof sb === 'number') return sa - sb
      return String(sa).localeCompare(String(sb), undefined, { numeric: true })
    })

    const data: ChartDatum[] = xLabels.map((xLab) => {
      const inner = groups.get(xLab)!
      const row: ChartDatum = { name: xLab, value: 0 }
      for (const c of categories) {
        const aggVal = aggregateVals(inner.get(c) ?? [], aggregation)
        row[c] = aggVal
      }
      return row
    })

    if (chartType === 'pie' || chartType === 'donut') {
      return {
        data: [],
        error: 'Pie/donut charts work best without a grouping column — remove grouping or switch chart type.',
      }
    }

    return { data, seriesKeys: categories }
  }

  /* Simple X → aggregate Y */
  const map = new Map<string, number[]>()
  const sortKeyByX = new Map<string, number | string>()
  for (const r of chartRows) {
    const xc = getXComparable(r[xKey])
    const xLab = xc.label
    const nums = getYNumbers([r], yKey)
    if (nums.length === 0) continue
    if (!map.has(xLab)) map.set(xLab, [])
    if (!sortKeyByX.has(xLab)) sortKeyByX.set(xLab, xc.sortKey)
    map.get(xLab)!.push(...nums)
  }

  const ordered = [...map.entries()].sort((a, b) => {
    const sa = sortKeyByX.get(a[0]) ?? a[0]
    const sb = sortKeyByX.get(b[0]) ?? b[0]
    if (typeof sa === 'number' && typeof sb === 'number') return sa - sb
    const na = Number(sa)
    const nb = Number(sb)
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb
    return String(sa).localeCompare(String(sb), undefined, { numeric: true })
  })

  let data: ChartDatum[] = ordered.map(([name, vals]) => ({
    name,
    value: aggregateVals(vals, aggregation),
  }))

  if ((chartType === 'pie' || chartType === 'donut') && data.length === 0) {
    return { data: [], error: 'Pie/donut needs at least one category on X with numeric Y.' }
  }

  if ((chartType === 'pie' || chartType === 'donut') && data.length > 24) {
    data = data.slice(0, 24)
  }

  return {
    data,
    isDonut: chartType === 'donut',
  }
}

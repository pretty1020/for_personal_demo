import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import {
  useCapacityFinancial,
  type CapacityWeeklyFinancialRow,
} from '../../context/CapacityFinancialContext'
import { fmtCurrency } from '../../planner/format'
import type { TrendGranularity } from '../../utils/idealFinancialTrending'
import { dominantMonthKeyFromWeekStart } from '../../utils/staffingCapacity/calendarWeek'

const COLORS = {
  revenue: '#1c1915',
  actualRev: '#8c7348',
  labor: '#2c5648',
  training: '#6d7f4e',
  salary: '#4d6b5e',
  opex: '#9a6b2f',
  margin: '#8c7348',
  axis: '#6e675f',
  grid: '#e3dbd0',
  ink: '#1c1915',
  paper: '#f7f3ec',
} as const

type ChartPoint = {
  key: string
  label: string
  projectedRevenue: number
  projectedCost: number
  projectedLabor: number
  projectedTraining: number
  projectedSalarySupport: number
  projectedOpex: number
  actualRevenue: number | null
  actualCost: number | null
  hasActual: boolean
  t: number
}

type TipState = {
  visible: boolean
  x: number
  y: number
  point: ChartPoint | null
}

function formatWeekTick(iso: string): string {
  if (iso.length < 10) return iso
  const date = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatMonthTick(key: string): string {
  if (key.length < 7) return key
  const date = new Date(`${key}-01T12:00:00`)
  if (Number.isNaN(date.getTime())) return key
  return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

function periodKeyForWeek(week: string, granularity: TrendGranularity): string {
  if (granularity === 'week') return week
  const monthKey = dominantMonthKeyFromWeekStart(week)
  if (granularity === 'month') return monthKey.slice(0, 7)
  const month = Number.parseInt(monthKey.slice(5, 7), 10)
  const year = monthKey.slice(0, 4)
  const q = Number.isFinite(month) ? Math.ceil(month / 3) : 1
  return `${year}-Q${q}`
}

function periodLabel(key: string, granularity: TrendGranularity): string {
  if (granularity === 'week') return formatWeekTick(key)
  if (granularity === 'month') return formatMonthTick(key)
  return key.replace('-', ' ')
}

function chartTitle(granularity: TrendGranularity): string {
  if (granularity === 'month') return 'Monthly revenue & cost'
  if (granularity === 'quarter') return 'Quarterly revenue & cost'
  return 'Weekly revenue & cost'
}

function parseTime(key: string, granularity: TrendGranularity): number {
  if (granularity === 'week') {
    const d = new Date(`${key}T12:00:00`)
    return Number.isNaN(d.getTime()) ? 0 : d.getTime()
  }
  if (granularity === 'month') {
    const d = new Date(`${key}-01T12:00:00`)
    return Number.isNaN(d.getTime()) ? 0 : d.getTime()
  }
  const match = /^(\d{4})-Q([1-4])$/.exec(key)
  if (!match) return 0
  const year = Number(match[1])
  const q = Number(match[2])
  return new Date(year, (q - 1) * 3, 15).getTime()
}

function compactMoney(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}k`
  return `$${Math.round(value)}`
}

function aggregateFinancialRows(
  rows: CapacityWeeklyFinancialRow[],
  granularity: TrendGranularity,
): ChartPoint[] {
  if (granularity === 'week') {
    return rows.map((row) => ({
      key: row.week,
      label: formatWeekTick(row.week),
      projectedRevenue: row.projectedRevenue,
      projectedCost: row.projectedCost,
      projectedLabor: row.projectedLabor ?? 0,
      projectedTraining: row.projectedTraining ?? 0,
      projectedSalarySupport: row.projectedSalarySupport ?? 0,
      projectedOpex: row.projectedOpex ?? 0,
      actualRevenue: row.isActual ? row.actualRevenue : null,
      actualCost: row.isActual ? row.actualCost : null,
      hasActual: row.isActual,
      t: parseTime(row.week, 'week'),
    }))
  }

  const buckets = new Map<string, ChartPoint>()
  for (const row of rows) {
    const key = periodKeyForWeek(row.week, granularity)
    const existing = buckets.get(key) ?? {
      key,
      label: periodLabel(key, granularity),
      projectedRevenue: 0,
      projectedCost: 0,
      projectedLabor: 0,
      projectedTraining: 0,
      projectedSalarySupport: 0,
      projectedOpex: 0,
      actualRevenue: null,
      actualCost: null,
      hasActual: false,
      t: parseTime(key, granularity),
    }
    existing.projectedRevenue += row.projectedRevenue
    existing.projectedCost += row.projectedCost
    existing.projectedLabor += row.projectedLabor ?? 0
    existing.projectedTraining += row.projectedTraining ?? 0
    existing.projectedSalarySupport += row.projectedSalarySupport ?? 0
    existing.projectedOpex += row.projectedOpex ?? 0
    if (row.isActual) {
      existing.hasActual = true
      existing.actualRevenue = (existing.actualRevenue ?? 0) + row.actualRevenue
      existing.actualCost = (existing.actualCost ?? 0) + row.actualCost
    }
    buckets.set(key, existing)
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t)
}

type StackKey = 'projectedLabor' | 'projectedTraining' | 'projectedSalarySupport' | 'projectedOpex'

const STACK_SERIES: Array<{ key: StackKey; label: string; color: string }> = [
  { key: 'projectedLabor', label: 'Labor', color: COLORS.labor },
  { key: 'projectedTraining', label: 'Training', color: COLORS.training },
  { key: 'projectedSalarySupport', label: 'Salary-like / support', color: COLORS.salary },
  { key: 'projectedOpex', label: 'OPEX / other lines', color: COLORS.opex },
]

type Props = {
  granularity?: TrendGranularity
}

/** Revenue / cost trend with stacked cost breakdown. */
export function CapacityFinancialTrendChart({ granularity = 'week' }: Props) {
  const model = useCapacityFinancial()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 720, h: 420 })
  const [tip, setTip] = useState<TipState>({ visible: false, x: 0, y: 0, point: null })
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const [showActual, setShowActual] = useState(true)
  const [showStack, setShowStack] = useState(true)

  const points = useMemo(
    () => aggregateFinancialRows(model.weeklyFinancials, granularity),
    [granularity, model.weeklyFinancials],
  )

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const apply = () => {
      const rect = el.getBoundingClientRect()
      const w = Math.max(320, rect.width || 720)
      const h = Math.max(320, Math.min(460, w * 0.52))
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg.cap-fin-d3')
    svg.selectAll('*').remove()

    if (!model.hasScope || points.length === 0) return

    const margin = { top: 28, right: 24, bottom: 56, left: 58 }
    const iw = size.w - margin.left - margin.right
    const ih = size.h - margin.top - margin.bottom
    if (iw < 80 || ih < 80) return

    const root = svg
      .attr('width', size.w)
      .attr('height', size.h)
      .attr('viewBox', `0 0 ${size.w} ${size.h}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    const defs = svg.append('defs')
    const revGrad = defs
      .append('linearGradient')
      .attr('id', 'cap-fin-rev-area')
      .attr('x1', '0')
      .attr('x2', '0')
      .attr('y1', '0')
      .attr('y2', '1')
    revGrad.append('stop').attr('offset', '0%').attr('stop-color', COLORS.revenue).attr('stop-opacity', 0.1)
    revGrad.append('stop').attr('offset', '100%').attr('stop-color', COLORS.revenue).attr('stop-opacity', 0.01)

    const x = d3
      .scaleBand<string>()
      .domain(points.map((p) => p.key))
      .range([0, iw])
      .paddingInner(0.28)
      .paddingOuter(0.08)

    const maxY =
      d3.max(points, (p) =>
        Math.max(
          p.projectedRevenue,
          p.projectedCost,
          p.actualRevenue ?? 0,
          p.actualCost ?? 0,
          p.projectedLabor + p.projectedTraining + p.projectedSalarySupport + p.projectedOpex,
        ),
      ) ?? 1

    const y = d3
      .scaleLinear()
      .domain([0, maxY * 1.08])
      .nice()
      .range([ih, 0])

    root
      .append('g')
      .attr('class', 'cap-fin-d3__grid')
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickSize(-iw)
          .tickFormat(() => ''),
      )
      .call((g) => g.select('.domain').remove())
      .call((g) =>
        g
          .selectAll('line')
          .attr('stroke', COLORS.grid)
          .attr('stroke-width', 1),
      )

    const stack = d3
      .stack<ChartPoint, StackKey>()
      .keys(STACK_SERIES.map((s) => s.key))
      .value((d, key) => (showStack ? d[key] : 0))
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone)

    const stacked = showStack ? stack(points) : []

    if (showStack) {
      STACK_SERIES.forEach((series, seriesIndex) => {
        const layer = stacked[seriesIndex]
        if (!layer) return
        root
          .append('g')
          .attr('class', `cap-fin-d3__stack cap-fin-d3__stack--${series.key}`)
          .selectAll('rect')
          .data(layer)
          .join('rect')
          .attr('x', (d) => (x(d.data.key) ?? 0) + x.bandwidth() * 0.12)
          .attr('width', Math.max(4, x.bandwidth() * 0.76))
          .attr('y', (d) => y(d[1]))
          .attr('height', (d) => Math.max(0, y(d[0]) - y(d[1])))
          .attr('rx', 0)
          .attr('fill', series.color)
          .attr('opacity', 0.92)
          .attr('cursor', 'pointer')
          .on('mousemove', (event: MouseEvent, d) => {
            setTip({
              visible: true,
              x: event.clientX + 14,
              y: event.clientY + 14,
              point: d.data,
            })
          })
          .on('mouseleave', () => setTip((prev) => ({ ...prev, visible: false })))
          .on('click', (_event, d) => {
            setFocusedKey((current) => (current === d.data.key ? null : d.data.key))
          })
      })
    } else {
      root
        .append('g')
        .selectAll('rect')
        .data(points)
        .join('rect')
        .attr('x', (d) => (x(d.key) ?? 0) + x.bandwidth() * 0.15)
        .attr('width', Math.max(4, x.bandwidth() * 0.7))
        .attr('y', (d) => y(d.projectedCost))
        .attr('height', (d) => Math.max(0, y(0) - y(d.projectedCost)))
        .attr('rx', 0)
        .attr('fill', COLORS.opex)
        .attr('opacity', 0.72)
        .attr('cursor', 'pointer')
        .on('mousemove', (event: MouseEvent, d) => {
          setTip({ visible: true, x: event.clientX + 14, y: event.clientY + 14, point: d })
        })
        .on('mouseleave', () => setTip((prev) => ({ ...prev, visible: false })))
        .on('click', (_event, d) => {
          setFocusedKey((current) => (current === d.key ? null : d.key))
        })
    }

    const lineGen = d3
      .line<ChartPoint>()
      .x((d) => (x(d.key) ?? 0) + x.bandwidth() / 2)
      .y((d) => y(d.projectedRevenue))
      .curve(d3.curveMonotoneX)

    const areaGen = d3
      .area<ChartPoint>()
      .x((d) => (x(d.key) ?? 0) + x.bandwidth() / 2)
      .y0(ih)
      .y1((d) => y(d.projectedRevenue))
      .curve(d3.curveMonotoneX)

    if (points.length >= 2) {
      root
        .append('path')
        .datum(points)
        .attr('fill', 'url(#cap-fin-rev-area)')
        .attr('d', areaGen)
        .attr('pointer-events', 'none')

      root
        .append('path')
        .datum(points)
        .attr('fill', 'none')
        .attr('stroke', COLORS.revenue)
        .attr('stroke-width', 1.6)
        .attr('stroke-linecap', 'round')
        .attr('d', lineGen)
        .attr('pointer-events', 'none')
    }

    if (showActual && points.some((p) => p.hasActual)) {
      const actualLine = d3
        .line<ChartPoint>()
        .defined((d) => d.hasActual && d.actualRevenue != null)
        .x((d) => (x(d.key) ?? 0) + x.bandwidth() / 2)
        .y((d) => y(d.actualRevenue ?? 0))
        .curve(d3.curveMonotoneX)

      root
        .append('path')
        .datum(points)
        .attr('fill', 'none')
        .attr('stroke', COLORS.actualRev)
        .attr('stroke-width', 1.4)
        .attr('stroke-dasharray', '4 3')
        .attr('d', actualLine)
        .attr('pointer-events', 'none')
    }

    const focusOverlay = root
      .append('g')
      .attr('class', 'cap-fin-d3__hits')
      .selectAll('rect')
      .data(points)
      .join('rect')
      .attr('x', (d) => x(d.key) ?? 0)
      .attr('width', x.bandwidth())
      .attr('y', 0)
      .attr('height', ih)
      .attr('fill', (d) => (focusedKey === d.key ? 'rgba(28,25,21,0.05)' : 'transparent'))
      .attr('cursor', 'crosshair')
      .on('mousemove', (event: MouseEvent, d) => {
        setTip({ visible: true, x: event.clientX + 14, y: event.clientY + 14, point: d })
      })
      .on('mouseleave', () => setTip((prev) => ({ ...prev, visible: false })))
      .on('click', (_event, d) => {
        setFocusedKey((current) => (current === d.key ? null : d.key))
      })
    void focusOverlay

    root
      .selectAll('circle.cap-fin-d3__rev-dot')
      .data(points)
      .join('circle')
      .attr('class', 'cap-fin-d3__rev-dot')
      .attr('cx', (d) => (x(d.key) ?? 0) + x.bandwidth() / 2)
      .attr('cy', (d) => y(d.projectedRevenue))
      .attr('r', (d) => (focusedKey === d.key ? 4.5 : 3))
      .attr('fill', COLORS.revenue)
      .attr('stroke', COLORS.paper)
      .attr('stroke-width', 1)
      .attr('pointer-events', 'none')

    const xAxis = root
      .append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(
            points.length > 18
              ? points.filter((_, i) => i % Math.ceil(points.length / 12) === 0).map((p) => p.key)
              : points.map((p) => p.key),
          )
          .tickFormat((key) => points.find((p) => p.key === key)?.label ?? String(key)),
      )
    xAxis.select('.domain').attr('stroke', COLORS.ink)
    xAxis.selectAll('line').attr('stroke', COLORS.ink)
    xAxis
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('font-weight', '400')
      .attr('fill', COLORS.axis)
      .style('font-family', 'IBM Plex Sans, sans-serif')
      .attr('transform', points.length > 14 ? 'rotate(-28)' : null)
      .style('text-anchor', points.length > 14 ? 'end' : 'middle')

    const yAxis = root.append('g').call(
      d3
        .axisLeft(y)
        .ticks(5)
        .tickFormat((v) => compactMoney(Number(v))),
    )
    yAxis.select('.domain').attr('stroke', COLORS.ink)
    yAxis.selectAll('text').attr('font-size', '11px').attr('fill', COLORS.axis).style('font-family', 'IBM Plex Sans, sans-serif')
    yAxis.selectAll('line').attr('stroke', COLORS.ink)

    const legend = root.append('g').attr('transform', `translate(0, ${-18})`)
    const legendItems = [
      { label: 'Projected revenue', color: COLORS.revenue, kind: 'line' as const },
      ...(showActual && points.some((p) => p.hasActual)
        ? [{ label: 'Actual revenue', color: COLORS.actualRev, kind: 'dash' as const }]
        : []),
      ...(showStack
        ? STACK_SERIES.map((s) => ({ label: s.label, color: s.color, kind: 'swatch' as const }))
        : [{ label: 'Projected cost', color: COLORS.opex, kind: 'swatch' as const }]),
    ]
    let lx = 0
    legendItems.forEach((item) => {
      const g = legend.append('g').attr('transform', `translate(${lx}, 0)`)
      if (item.kind === 'line' || item.kind === 'dash') {
        g.append('line')
          .attr('x1', 0)
          .attr('x2', 16)
          .attr('y1', 0)
          .attr('y2', 0)
          .attr('stroke', item.color)
          .attr('stroke-width', 1.5)
          .attr('stroke-dasharray', item.kind === 'dash' ? '5 4' : null)
      } else {
        g.append('rect').attr('width', 12).attr('height', 8).attr('rx', 0).attr('y', -4).attr('fill', item.color)
      }
      g.append('text')
        .attr('x', 20)
        .attr('y', 0)
        .attr('dy', '0.32em')
        .attr('font-size', '10px')
        .attr('font-weight', '500')
        .style('font-family', 'IBM Plex Sans, sans-serif')
        .attr('fill', COLORS.axis)
        .text(item.label)
      lx += 20 + item.label.length * 6.2 + 14
    })
  }, [focusedKey, model.hasScope, points, showActual, showStack, size.h, size.w])

  const focused = focusedKey ? points.find((point) => point.key === focusedKey) : null

  if (!model.hasScope) return null

  return (
    <section className="cap-fin-trend-chart saas-card mb-6 cap-fin-trend-chart--modern cap-fin-trend-chart--d3" aria-label="Revenue and cost trend">
      <header className="cap-fin-trend-chart__head">
        <div>
          <h3 className="m-0 text-base font-bold text-slate-900">{chartTitle(granularity)}</h3>
          <p className="cap-fin-trend-chart__sub">Interactive cost stack · hover for detail · click to pin a period</p>
        </div>
        <div className="cap-fin-trend-chart__controls">
          <label className="cap-fin-trend-chart__toggle">
            <input type="checkbox" checked={showStack} onChange={(e) => setShowStack(e.target.checked)} />
            <span>Cost breakdown</span>
          </label>
          <label className="cap-fin-trend-chart__toggle">
            <input type="checkbox" checked={showActual} onChange={(e) => setShowActual(e.target.checked)} />
            <span>Actual revenue</span>
          </label>
          {focused ? (
            <div className="cap-fin-trend-chart__chip" aria-hidden>
              <span>{focused.label}</span>
              <strong>{fmtCurrency(focused.projectedRevenue - focused.projectedCost)}</strong>
              <em>projected margin</em>
            </div>
          ) : null}
        </div>
      </header>
      <div ref={wrapRef} className="cap-fin-trend-chart__body cap-fin-d3-wrap mt-3">
        {points.length === 0 ? (
          <p className="cap-fin-trend-chart__empty">Trends appear when Capacity has weeks in scope.</p>
        ) : (
          <svg className="cap-fin-d3" role="img" aria-label={chartTitle(granularity)} />
        )}
        {tip.visible && tip.point ? (
          <div
            className="cap-fin-d3-tooltip"
            style={{ left: tip.x, top: tip.y }}
            role="status"
          >
            <strong>{tip.point.label}</strong>
            <div>Revenue {fmtCurrency(tip.point.projectedRevenue)}</div>
            <div>Cost {fmtCurrency(tip.point.projectedCost)}</div>
            <div>Margin {fmtCurrency(tip.point.projectedRevenue - tip.point.projectedCost)}</div>
            {showStack ? (
              <>
                <hr />
                <div>Labor {fmtCurrency(tip.point.projectedLabor)}</div>
                <div>Training {fmtCurrency(tip.point.projectedTraining)}</div>
                <div>Salary-like / support {fmtCurrency(tip.point.projectedSalarySupport)}</div>
                <div>OPEX / other lines {fmtCurrency(tip.point.projectedOpex)}</div>
              </>
            ) : null}
            {tip.point.hasActual ? (
              <>
                <hr />
                <div>Actual rev {fmtCurrency(tip.point.actualRevenue ?? 0)}</div>
                <div>Actual cost {fmtCurrency(tip.point.actualCost ?? 0)}</div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {focused ? (
        <p className="cap-fin-trend-chart__focus" role="status">
          <strong>{focused.label}</strong>
          {' · projected '}
          {fmtCurrency(focused.projectedRevenue)}
          {' rev / '}
          {fmtCurrency(focused.projectedCost)}
          {' cost / '}
          {fmtCurrency(focused.projectedRevenue - focused.projectedCost)}
          {' margin'}
          {showStack
            ? ` · labor ${fmtCurrency(focused.projectedLabor)} · salary-like ${fmtCurrency(focused.projectedSalarySupport)} · other lines ${fmtCurrency(focused.projectedOpex)}`
            : ''}
          {focused.hasActual
            ? ` · actual ${fmtCurrency(focused.actualRevenue ?? 0)} rev / ${fmtCurrency(focused.actualCost ?? 0)} cost`
            : ''}
        </p>
      ) : (
        <p className="cap-fin-trend-chart__hint saas-muted m-0">
          Switch Period to Monthly or Quarterly to roll up this chart. Toggle cost breakdown for Salary / OPEX stack.
        </p>
      )}
    </section>
  )
}

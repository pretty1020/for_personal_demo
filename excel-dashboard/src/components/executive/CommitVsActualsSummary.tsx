import { useLayoutEffect, useMemo, useState } from 'react'
import type { ExecutiveUnifiedRow, WeeklyChangeRow } from '../../types/dashboard'
import type {
  BudgetActualTrend,
  ClientVarianceRow,
  CommitActualsModel,
  MonthScenarioPoint,
  WeekScenarioPoint,
} from '../../utils/commitVsActualsAnalytics'
import { buildCommitActualsModel } from '../../utils/commitVsActualsAnalytics'
import type { PreferFinancialDataset } from '../../utils/commitVsActualsAnalytics'
import type { WaterfallSegment } from '../../utils/executiveAnalytics'
import { EXEC_CHART_COLORS } from '../../utils/executiveAnalytics'
import { ExecChartCard } from './ExecChartCard'
import { useExecChartCardExpanded } from './ExecChartCardContext'
import { useExecChartSize } from './useExecChartSize'
import { pickCategoryTickIndices } from './execChartTicks'
import { formatCompact, formatPct } from './execChartFormat'
import * as d3 from 'd3'

type Props = {
  rows: ExecutiveUnifiedRow[]
  projectionWow: WeeklyChangeRow[]
  client: string
  preferDataset?: PreferFinancialDataset
  /** Section label for accessibility (default: Commit vs Actuals). */
  summaryLabel?: string
  /** Budget page: budget vs actual trend only (no projection WoW chart). */
  layout?: 'commit' | 'budget'
}

function KpiTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="exec-kpi-tile">
      <span className="exec-kpi-tile__label">{label}</span>
      <span className="exec-kpi-tile__value">{value}</span>
      {sub ? <span className="exec-kpi-tile__sub">{sub}</span> : null}
    </div>
  )
}

function VarianceBarChart({
  title,
  rows,
  mode,
  insight,
}: {
  title: string
  rows: ClientVarianceRow[]
  mode: 'dollar' | 'percent'
  insight: string
}) {
  const { wrapRef, w, h } = useExecChartSize()
  const [tip, setTip] = useState({ v: false, x: 0, y: 0, lines: [] as string[] })
  const [labels, setLabels] = useState(false)
  const top = rows.slice(0, 14)

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!top.length) return

    const margin = { top: 12, right: 24, bottom: 12, left: 140 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom
    const values = top.map((d) => (mode === 'dollar' ? d.varianceDollar : d.variancePct ?? 0))
    const x = d3
      .scaleLinear()
      .domain([Math.min(0, d3.min(values) ?? 0), Math.max(0, d3.max(values) ?? 0)])
      .nice()
      .range([0, iw])
    const y = d3
      .scaleBand()
      .domain(top.map((d) => d.client))
      .range([0, ih])
      .padding(0.22)

    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)
    const zero = x(0)

    g.append('line')
      .attr('x1', zero)
      .attr('x2', zero)
      .attr('y1', 0)
      .attr('y2', ih)
      .attr('stroke', '#94a3b8')
      .attr('stroke-dasharray', '4 3')

    g.selectAll('rect')
      .data(top)
      .join('rect')
      .attr('y', (d) => y(d.client) ?? 0)
      .attr('x', (d) => {
        const v = mode === 'dollar' ? d.varianceDollar : d.variancePct ?? 0
        return v >= 0 ? zero : x(v)
      })
      .attr('width', (d) => {
        const v = mode === 'dollar' ? d.varianceDollar : d.variancePct ?? 0
        return Math.abs(x(v) - zero)
      })
      .attr('height', y.bandwidth())
      .attr('fill', (d) => {
        const v = mode === 'dollar' ? d.varianceDollar : d.variancePct ?? 0
        return v >= 0 ? '#22c55e' : '#ef4444'
      })
      .attr('rx', 0)
      .on('mousemove', (e: MouseEvent, d: ClientVarianceRow) => {
        setTip({
          v: true,
          x: e.clientX + 12,
          y: e.clientY + 12,
          lines: [
            d.client,
            `Actual: ${formatCompact(d.actual, true)}`,
            `Baseline: ${formatCompact(d.baseline, true)}`,
            `Variance: ${formatCompact(d.varianceDollar, true)} (${d.variancePct != null ? formatPct(d.variancePct) : '—'})`,
          ],
        })
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, v: false })))

    g.selectAll('text.label')
      .data(top)
      .join('text')
      .attr('class', 'label')
      .attr('x', -8)
      .attr('y', (d) => (y(d.client) ?? 0) + y.bandwidth() / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#334155')
      .attr('font-size', 11)
      .text((d) => (d.client.length > 18 ? d.client.slice(0, 17) + '…' : d.client))
  }, [top, w, h, mode, wrapRef])

  const table = (
    <table className="exec-data-table">
      <thead>
        <tr>
          <th>Client</th>
          <th>Actual</th>
          <th>Baseline</th>
          <th>Variance $</th>
          <th>Variance %</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.client}>
            <td>{r.client}</td>
            <td>{formatCompact(r.actual, true)}</td>
            <td>{formatCompact(r.baseline, true)}</td>
            <td>{formatCompact(r.varianceDollar, true)}</td>
            <td>{r.variancePct != null ? formatPct(r.variancePct) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <ExecChartCard
      title={title}
      insight={insight}
      expandTitle={title}
      expandContent={table}
      showDataLabels={labels}
      onToggleLabels={setLabels}
    >
        <div ref={wrapRef} className="exec-chart-host" style={{ minHeight: 280 }}>
          <svg />
          {tip.v ? (
            <div className="exec-d3-tooltip" style={{ left: tip.x, top: tip.y }}>
              {tip.lines.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          ) : null}
        </div>
    </ExecChartCard>
  )
}

function BudgetActualTrendChart({
  trend,
  insight,
  scenarioLayout = false,
}: {
  trend: BudgetActualTrend
  insight: string
  scenarioLayout?: boolean
}) {
  if (trend.mode === 'weekly') {
    return (
      <WowTrendChart
        points={trend.points}
        title={scenarioLayout ? 'Week on week trend' : 'Budget vs Actual — week on week'}
        insight={scenarioLayout ? 'Budget vs Actuals revenue over time.' : insight}
        scenarioLayout={scenarioLayout}
      />
    )
  }
  return (
    <>
      <p className="ideal-budget-disclaimer mb-3 text-sm text-rose-900/90" role="note">
        {trend.disclaimer}
      </p>
      <MonthlyBudgetTrendChart points={trend.points} insight={insight} />
    </>
  )
}

function MonthlyBudgetTrendChart({ points, insight }: { points: MonthScenarioPoint[]; insight: string }) {
  const { wrapRef, w, h } = useExecChartSize()
  const [labels, setLabels] = useState(false)
  const [tip, setTip] = useState({ v: false, x: 0, y: 0, lines: [] as string[] })

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!points.length) return

    const margin = { top: 28, right: 20, bottom: 48, left: 56 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom
    const x = d3.scalePoint().domain(points.map((p) => p.label)).range([0, iw]).padding(0.45)
    const maxY = d3.max(points, (p) => Math.max(p.budget, p.actual)) ?? 1
    const y = d3.scaleLinear().domain([0, maxY * 1.08]).nice().range([ih, 0])
    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const lineBudget = d3.line<MonthScenarioPoint>().x((d) => x(d.label) ?? 0).y((d) => y(d.budget))
    const lineActual = d3.line<MonthScenarioPoint>().x((d) => x(d.label) ?? 0).y((d) => y(d.actual))
    g.append('path').datum(points).attr('fill', 'none').attr('stroke', EXEC_CHART_COLORS[0]).attr('stroke-width', 1.5).attr('d', lineBudget)
    g.append('path').datum(points).attr('fill', 'none').attr('stroke', EXEC_CHART_COLORS[1]).attr('stroke-width', 1.5).attr('d', lineActual)

    for (const p of points) {
      const cx = x(p.label) ?? 0
      for (const [val, color, label] of [
        [p.budget, EXEC_CHART_COLORS[0], 'Budget'],
        [p.actual, EXEC_CHART_COLORS[1], 'Actual'],
      ] as const) {
        g.append('circle')
          .attr('cx', cx)
          .attr('cy', y(val))
          .attr('r', 5)
          .attr('fill', color)
          .on('mousemove', (e: MouseEvent) => {
            setTip({
              v: true,
              x: e.clientX + 12,
              y: e.clientY + 12,
              lines: [p.label, `${label}: ${formatCompact(val, true)}`],
            })
          })
          .on('mouseleave', () => setTip((t) => ({ ...t, v: false })))
      }
    }

    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('transform', 'rotate(-28)')
      .style('text-anchor', 'end')
    g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat((d) => formatCompact(Number(d), true)))
  }, [points, w, h, wrapRef])

  return (
    <ExecChartCard
      title="Budget vs Actual — monthly"
      insight={insight}
      expandTitle="Budget vs Actual monthly"
      expandContent={
        <table className="exec-data-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Budget</th>
              <th>Actual</th>
              <th>Variance</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.month}>
                <td>{p.label}</td>
                <td>{formatCompact(p.budget, true)}</td>
                <td>{formatCompact(p.actual, true)}</td>
                <td>{formatCompact(p.variance, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      showDataLabels={labels}
      onToggleLabels={setLabels}
    >
      <div ref={wrapRef} className="exec-chart-host" style={{ minHeight: 300 }}>
        <svg />
        <div className="exec-chart-legend mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
          <span>
            <span className="mr-1 inline-block h-2 w-4 rounded" style={{ background: EXEC_CHART_COLORS[0] }} />
            Budget
          </span>
          <span>
            <span className="mr-1 inline-block h-2 w-4 rounded" style={{ background: EXEC_CHART_COLORS[1] }} />
            Actual
          </span>
        </div>
        {tip.v ? (
          <div className="exec-d3-tooltip" style={{ left: tip.x, top: tip.y }}>
            {tip.lines.map((l, i) => (
              <div key={i}>{l}</div>
            ))}
          </div>
        ) : null}
      </div>
    </ExecChartCard>
  )
}

function WowTrendChart({
  points,
  title,
  insight,
  scenarioLayout = false,
}: {
  points: WeekScenarioPoint[]
  title: string
  insight: string
  scenarioLayout?: boolean
}) {
  const expanded = useExecChartCardExpanded()
  const { wrapRef, w, h, ready } = useExecChartSize([points])
  const [labels, setLabels] = useState(false)

  useLayoutEffect(() => {
    if (!ready) return
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!points.length) return

    const margin = { top: labels ? 36 : 28, right: 16, bottom: expanded ? 64 : 52, left: 56 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom
    const x = d3.scalePoint().domain(points.map((p) => p.label)).range([0, iw]).padding(0.45)
    const maxY = d3.max(points, (p) => Math.max(p.budget, p.actual)) ?? 1
    const y = d3.scaleLinear().domain([0, maxY * 1.12]).nice().range([ih, 0])
    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const lineBudget = d3
      .line<WeekScenarioPoint>()
      .x((d) => x(d.label) ?? 0)
      .y((d) => y(d.budget))
    const lineActual = d3
      .line<WeekScenarioPoint>()
      .x((d) => x(d.label) ?? 0)
      .y((d) => y(d.actual))

    g.append('path').datum(points).attr('fill', 'none').attr('stroke', EXEC_CHART_COLORS[0]).attr('stroke-width', 1.5).attr('d', lineBudget)
    g.append('path').datum(points).attr('fill', 'none').attr('stroke', EXEC_CHART_COLORS[1]).attr('stroke-width', 1.5).attr('d', lineActual)

    points.forEach((p) => {
      const cx = x(p.label) ?? 0
      g.append('circle').attr('cx', cx).attr('cy', y(p.budget)).attr('r', 3.5).attr('fill', EXEC_CHART_COLORS[0])
      g.append('circle').attr('cx', cx).attr('cy', y(p.actual)).attr('r', 3.5).attr('fill', EXEC_CHART_COLORS[1])
    })

    if (labels) {
      points.forEach((p) => {
        const cx = x(p.label) ?? 0
        g.append('text')
          .attr('x', cx)
          .attr('y', y(p.budget) - 6)
          .attr('text-anchor', 'middle')
          .attr('font-size', expanded ? 9 : 8)
          .attr('fill', EXEC_CHART_COLORS[0])
          .text(formatCompact(p.budget, true))
        g.append('text')
          .attr('x', cx)
          .attr('y', y(p.actual) + 14)
          .attr('text-anchor', 'middle')
          .attr('font-size', expanded ? 9 : 8)
          .attr('fill', EXEC_CHART_COLORS[1])
          .text(formatCompact(p.actual, true))
      })
    }

    const tickIdx = pickCategoryTickIndices(points.length, expanded ? 12 : 6)
    const tickLabels = tickIdx.map((i) => points[i]!.label)
    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).tickValues(tickLabels))
      .selectAll('text')
      .attr('transform', 'rotate(-32)')
      .style('text-anchor', 'end')
      .attr('font-size', expanded ? 11 : 10)
      .attr('fill', '#334155')
    g.append('g')
      .call(d3.axisLeft(y).ticks(expanded ? 6 : 4).tickFormat((d) => formatCompact(Number(d), true)))
      .selectAll('text')
      .attr('font-size', expanded ? 11 : 10)
      .attr('fill', '#334155')
  }, [points, w, h, labels, wrapRef, expanded, ready])

  return (
    <ExecChartCard
      title={title}
      insight={insight}
      expandTitle="Budget vs Actual weekly"
      expandContent={
        <table className="exec-data-table">
          <thead>
            <tr>
              <th>Week</th>
              <th>Budget</th>
              <th>Actual</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.week}>
                <td>{p.label}</td>
                <td>{formatCompact(p.budget, true)}</td>
                <td>{formatCompact(p.actual, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      showDataLabels={labels}
      onToggleLabels={setLabels}
    >
        <div
          ref={wrapRef}
          className="exec-chart-host"
          style={{ minHeight: scenarioLayout ? (expanded ? 400 : 260) : 300 }}
        >
          <svg />
          <div className="exec-chart-legend mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
            <span>
              <span className="mr-1 inline-block h-2 w-4 rounded" style={{ background: EXEC_CHART_COLORS[0] }} />
              Budget
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-4 rounded" style={{ background: EXEC_CHART_COLORS[1] }} />
              Actual
            </span>
          </div>
        </div>
    </ExecChartCard>
  )
}

function ProjectionWowChart({ rows, insight }: { rows: WeeklyChangeRow[]; insight: string }) {
  const { wrapRef, w, h } = useExecChartSize()
  const [labels, setLabels] = useState(false)
  const top = rows.slice(0, 12)

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!top.length) return

    const margin = { top: 20, right: 16, bottom: 72, left: 48 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom
    const x = d3
      .scaleBand()
      .domain(top.map((d) => d.metric))
      .range([0, iw])
      .padding(0.25)
    const vals = top.map((d) => d.variance ?? 0)
    const y = d3
      .scaleLinear()
      .domain([Math.min(0, d3.min(vals) ?? 0), Math.max(0, d3.max(vals) ?? 0)])
      .nice()
      .range([ih, 0])
    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)
    const zero = y(0)

    g.selectAll('rect')
      .data(top)
      .join('rect')
      .attr('x', (d) => x(d.metric) ?? 0)
      .attr('width', x.bandwidth())
      .attr('y', (d) => {
        const v = d.variance ?? 0
        return v >= 0 ? y(v) : y(0)
      })
      .attr('height', (d) => {
        const v = d.variance ?? 0
        return Math.abs(y(v) - zero)
      })
      .attr('fill', (d) => ((d.variance ?? 0) >= 0 ? '#22c55e' : '#ef4444'))
      .attr('rx', 0)

    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('transform', 'rotate(-40)')
      .style('text-anchor', 'end')
    g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat((d) => formatCompact(Number(d), true)))
  }, [top, w, h, wrapRef])

  return (
    <ExecChartCard
      title="Week on week — projection variance"
      insight={insight}
      expandTitle="Projection WoW"
      expandContent={
        <table className="exec-data-table">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Last week</th>
              <th>Current week</th>
              <th>Variance</th>
              <th>Variance %</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.metric}>
                <td>{r.metric}</td>
                <td>{r.lastWeek != null ? formatCompact(r.lastWeek, true) : '—'}</td>
                <td>{r.currentWeek != null ? formatCompact(r.currentWeek, true) : '—'}</td>
                <td>{r.variance != null ? formatCompact(r.variance, true) : '—'}</td>
                <td>{r.variancePct != null ? formatPct(r.variancePct) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      showDataLabels={labels}
      onToggleLabels={setLabels}
    >
        <div ref={wrapRef} className="exec-chart-host" style={{ minHeight: 280 }}>
          <svg />
        </div>
    </ExecChartCard>
  )
}

function BridgeChart({ segments, insight }: { segments: WaterfallSegment[]; insight: string }) {
  const { wrapRef, w, h } = useExecChartSize()
  const [labels, setLabels] = useState(false)

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!segments.length) return

    const margin = { top: 28, right: 20, bottom: 52, left: 56 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom
    const maxY = d3.max(segments, (s) => Math.max(s.start, s.end)) ?? 1
    const y = d3.scaleLinear().domain([0, maxY]).nice().range([ih, 0])
    const x = d3
      .scaleBand()
      .domain(segments.map((s) => s.label))
      .range([0, iw])
      .padding(0.28)
    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    g.selectAll('rect')
      .data(segments)
      .join('rect')
      .attr('x', (d) => x(d.label) ?? 0)
      .attr('y', (d) => y(Math.max(d.start, d.end)))
      .attr('width', x.bandwidth())
      .attr('height', (d) => Math.abs(y(d.start) - y(d.end)))
      .attr('fill', (d) =>
        d.kind === 'negative' ? '#9a3b2f' : d.kind === 'positive' ? '#2c5648' : d.label.includes('GM') ? '#8c7348' : '#9a6b2f',
      )
      .attr('rx', 0)

    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('transform', 'rotate(-28)')
      .style('text-anchor', 'end')
    g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat((d) => formatCompact(Number(d), true)))
  }, [segments, w, h, wrapRef])

  return (
    <ExecChartCard
      title="Revenue to margin bridge"
      insight={insight}
      expandTitle="Revenue to GM bridge"
      expandContent={
        <table className="exec-data-table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((s) => (
              <tr key={s.label}>
                <td>{s.label}</td>
                <td>{formatCompact(s.value, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      showDataLabels={labels}
      onToggleLabels={setLabels}
    >
        <div ref={wrapRef} className="exec-chart-host" style={{ minHeight: 300 }}>
          <svg />
        </div>
    </ExecChartCard>
  )
}

export function CommitVsActualsSummary({
  rows,
  projectionWow,
  client: _client,
  preferDataset,
  summaryLabel = 'Commit vs Actuals',
  layout = 'commit',
}: Props) {
  const model: CommitActualsModel = useMemo(
    () => buildCommitActualsModel({ rows, projectionWow, preferDataset, varianceBaseline: 'Budget' }),
    [rows, projectionWow, preferDataset],
  )
  const { kpis } = model

  if (!rows.length) {
    return (
      <p className="exec-muted exec-muted--box">
        No rows matched the Commit vs Actuals view and filters. Upload a Financial workbook with a{' '}
        <strong>Commit_vs_Actuals</strong> tab (or use PnL / Budget vs Trending with Category = Commit, Actual, Budget,
        Projections).
      </p>
    )
  }

  return (
    <section className="commit-actuals-summary" aria-label={`${summaryLabel} overall summary`}>
      <div
        className={`commit-lock-banner ${model.commitLocked ? 'commit-lock-banner--locked' : ''}`}
        role="status"
      >
        {model.commitLockNote}
      </div>

      <div className="exec-kpi-grid exec-kpi-grid--dense mb-6">
        <KpiTile label="Budget" value={formatCompact(kpis.budget, true)} />
        <KpiTile label="Actual" value={formatCompact(kpis.actual, true)} />
        <KpiTile label="Commit" value={formatCompact(kpis.commit, true)} sub={model.commitLocked ? 'Locked' : 'Open'} />
        <KpiTile
          label="Variance vs Budget"
          value={kpis.revVarianceVsBudget != null ? formatCompact(kpis.revVarianceVsBudget, true) : '—'}
        />
        <KpiTile
          label="Revenue / hour"
          value={kpis.revPerHour != null ? formatCompact(kpis.revPerHour, true) : '—'}
          sub={kpis.hours > 0 ? `${kpis.hours.toLocaleString()} hrs` : 'Map hours column'}
        />
        <KpiTile
          label="Cost / hour"
          value={kpis.costPerHour != null ? formatCompact(kpis.costPerHour, true) : '—'}
        />
        <KpiTile
          label="GM"
          value={formatCompact(kpis.gm, true)}
          sub={kpis.gmPct != null ? `${kpis.gmPct.toFixed(1)}%` : undefined}
        />
        <KpiTile label="Projection" value={formatCompact(kpis.projection, true)} />
      </div>

      {layout === 'budget' ? (
        <section className="ideal-scenario-section mb-10" aria-label="Budget vs Actual trend">
          <h2 className="ideal-scenario-section__title">Budget vs Actual</h2>
          <p className="ideal-scenario-section__sub mb-4 text-sm text-slate-600">
            Revenue comparison: Budget versus Actuals · Week on week view.
          </p>
          <BudgetActualTrendChart
            trend={model.budgetActualTrend}
            scenarioLayout
            insight={
              model.budgetActualTrend.mode === 'weekly'
                ? model.weeklyBudgetVsActual.length
                  ? 'Week-on-week revenue: Budget (plan) versus Actuals.'
                  : 'Add week-level rows with Budget and Actuals to see trending.'
                : 'Monthly budget compared to monthly actuals for the selected period.'
            }
          />
        </section>
      ) : (
        <div className="exec-charts-grid exec-charts-grid--2">
          <BudgetActualTrendChart
            trend={model.budgetActualTrend}
            insight={
              model.budgetActualTrend.mode === 'weekly'
                ? model.weeklyBudgetVsActual.length
                  ? 'Week-on-week revenue: Budget (plan) versus Actuals.'
                  : 'Add week-level rows with Budget and Actuals to see trending.'
                : 'Monthly budget compared to monthly actuals for the selected period.'
            }
          />
          <ProjectionWowChart
            rows={model.projectionWow}
            insight={
              model.projectionWow.length
                ? 'Change in projection metrics from last week to current week (LW‑CW sheet, Projections category).'
                : 'Map LW‑CW projection columns to show week-on-week projection variance.'
            }
          />
        </div>
      )}

      <div className="exec-charts-grid exec-charts-grid--2 mt-6">
        <VarianceBarChart
          title="Variance by client — %"
          mode="percent"
          rows={model.clientVariance}
          insight="Actual revenue versus budget by client; bars show percent variance (green favorable, red unfavorable)."
        />
        <VarianceBarChart
          title="Variance by client — $"
          mode="dollar"
          rows={model.clientVariance}
          insight="Dollar variance by client (Actual − Budget) for the selected period and client filter."
        />
      </div>

      <div className="mt-6">
        <BridgeChart
          segments={model.revenueToMarginBridge}
          insight="Walk from revenue through people cost, OPEX, and other delivery to gross margin for actuals in this slice."
        />
      </div>
    </section>
  )
}


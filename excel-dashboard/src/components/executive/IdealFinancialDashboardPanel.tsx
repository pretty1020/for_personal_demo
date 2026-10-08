import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import type { ExecutiveUnifiedRow, WeeklyChangeRow } from '../../types/dashboard'
import {
  buildIdealFinancialPanelModel,
  granularityLabel,
  SCENARIO_PAIR_META,
  type IdealFinancialPanelModel,
  type ScenarioPairId,
  type ScenarioTrendPoint,
  type TrendGranularity,
} from '../../utils/idealFinancialTrending'
import type { WaterfallSegment } from '../../utils/executiveAnalytics'
import { EXEC_CHART_COLORS } from '../../utils/executiveAnalytics'
import { ExecChartCard } from './ExecChartCard'
import { useExecChartCardExpanded } from './ExecChartCardContext'
import { pickCategoryTickIndices } from './execChartTicks'
import { useExecChartSize } from './useExecChartSize'
import { IdealProjectionWowSection } from './IdealProjectionWowSection'
import { formatCompact } from './execChartFormat'
import {
  movateBridgeSegmentFill,
  MOVATE_BRAND,
  styleMovateD3Axis,
} from '../../utils/movateTheme'
import * as d3 from 'd3'

export type IdealPanelView = 'overview' | ScenarioPairId

type Props = {
  rows: ExecutiveUnifiedRow[]
  sourceRows: ExecutiveUnifiedRow[]
  projectionWow: WeeklyChangeRow[]
  granularity: TrendGranularity
  onGranularityChange: (g: TrendGranularity) => void
  clientOptions: string[]
  weekOptions: string[]
  weekStart: string
  weekEnd: string
  headerClient: string
  view: IdealPanelView
  hideKpis?: boolean
  /** When true, overview charts start collapsed behind a Show charts control. */
  chartsCollapsedByDefault?: boolean
  /** @deprecated Use chartsCollapsedByDefault instead */
  showProjectionWow?: boolean
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

function isMeaningfulAmount(n: number | null | undefined): boolean {
  return n != null && Number.isFinite(n) && Math.abs(n) >= 0.5
}

function KpiTileMaybe({
  label,
  amount,
  value,
  sub,
}: {
  label: string
  amount: number | null | undefined
  value?: string
  sub?: string
}) {
  if (!isMeaningfulAmount(amount)) return null
  return <KpiTile label={label} value={value ?? formatCompact(amount!, true)} sub={sub} />
}

function ScenarioComparisonSection({
  pairId,
  points,
  granularity,
  children,
}: {
  pairId: ScenarioPairId
  points: ScenarioTrendPoint[]
  granularity: TrendGranularity
  children?: ReactNode
}) {
  const meta = SCENARIO_PAIR_META[pairId]
  return (
    <section className="ideal-scenario-section mb-10" aria-labelledby={`ideal-section-${pairId}`}>
      <h2 id={`ideal-section-${pairId}`} className="ideal-scenario-section__title">
        {meta.title}
      </h2>
      <p className="ideal-scenario-section__sub mb-4 text-sm text-slate-600">
        {meta.leftLabel} vs {meta.rightLabel}
      </p>
      <ScenarioTrendChart pairId={pairId} points={points} granularity={granularity} />
      {children}
    </section>
  )
}

function ScenarioTrendChartPlot({
  pairId,
  points,
  labels,
}: {
  pairId: ScenarioPairId
  points: ScenarioTrendPoint[]
  labels: boolean
}) {
  const meta = SCENARIO_PAIR_META[pairId]
  const expanded = useExecChartCardExpanded()
  const { wrapRef, w, h, ready } = useExecChartSize([points, labels])

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
    const maxY = d3.max(points, (p) => Math.max(p.left, p.right)) ?? 1
    const y = d3.scaleLinear().domain([0, maxY * 1.12]).nice().range([ih, 0])
    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const lineL = d3.line<ScenarioTrendPoint>().x((d) => x(d.label) ?? 0).y((d) => y(d.left))
    const lineR = d3.line<ScenarioTrendPoint>().x((d) => x(d.label) ?? 0).y((d) => y(d.right))
    g.append('path').datum(points).attr('fill', 'none').attr('stroke', EXEC_CHART_COLORS[0]).attr('stroke-width', 1.5).attr('d', lineL)
    g.append('path').datum(points).attr('fill', 'none').attr('stroke', EXEC_CHART_COLORS[1]).attr('stroke-width', 1.5).attr('d', lineR)

    points.forEach((p) => {
      const cx = x(p.label) ?? 0
      g.append('circle').attr('cx', cx).attr('cy', y(p.left)).attr('r', 3.5).attr('fill', EXEC_CHART_COLORS[0])
      g.append('circle').attr('cx', cx).attr('cy', y(p.right)).attr('r', 3.5).attr('fill', EXEC_CHART_COLORS[1])
    })

    if (labels) {
      points.forEach((p) => {
        const cx = x(p.label) ?? 0
        g.append('text')
          .attr('x', cx)
          .attr('y', y(p.left) - 6)
          .attr('text-anchor', 'middle')
          .attr('font-size', expanded ? 9 : 8)
          .attr('fill', EXEC_CHART_COLORS[0])
          .text(formatCompact(p.left, true))
        g.append('text')
          .attr('x', cx)
          .attr('y', y(p.right) + 14)
          .attr('text-anchor', 'middle')
          .attr('font-size', expanded ? 9 : 8)
          .attr('fill', EXEC_CHART_COLORS[1])
          .text(formatCompact(p.right, true))
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
    <div ref={wrapRef} className="exec-chart-host" style={{ minHeight: expanded ? 400 : 260 }}>
      <svg />
      <div className="exec-chart-legend mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
        <span>
          <span className="mr-1 inline-block h-2 w-4 rounded" style={{ background: EXEC_CHART_COLORS[0] }} />
          {meta.leftLabel}
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-4 rounded" style={{ background: EXEC_CHART_COLORS[1] }} />
          {meta.rightLabel}
        </span>
      </div>
    </div>
  )
}

function ScenarioTrendChart({
  pairId,
  points,
  granularity,
}: {
  pairId: ScenarioPairId
  points: ScenarioTrendPoint[]
  granularity: TrendGranularity
}) {
  const meta = SCENARIO_PAIR_META[pairId]
  const [labels, setLabels] = useState(false)

  const table = (
    <table className="exec-data-table">
      <thead>
        <tr>
          <th>Period</th>
          <th>{meta.leftLabel}</th>
          <th>{meta.rightLabel}</th>
          <th>Variance</th>
        </tr>
      </thead>
      <tbody>
        {points.map((p) => (
          <tr key={p.periodKey}>
            <td>{p.label}</td>
            <td>{formatCompact(p.left, true)}</td>
            <td>{formatCompact(p.right, true)}</td>
            <td>{formatCompact(p.right - p.left, true)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  return (
    <ExecChartCard
      title={`${granularityLabel(granularity)} trend`}
      insight={`${meta.leftLabel} vs ${meta.rightLabel} revenue over time.`}
      expandTitle={meta.title}
      expandContent={table}
      showDataLabels={labels}
      onToggleLabels={setLabels}
      renderChart={() => <ScenarioTrendChartPlot pairId={pairId} points={points} labels={labels} />}
    />
  )
}

function formatSignedCompact(n: number): string {
  const abs = formatCompact(Math.abs(n), true)
  if (n > 0) return `+${abs}`
  if (n < 0) return `−${abs}`
  return abs
}

function BridgeChart({ segments, defaultHidden = true }: { segments: WaterfallSegment[]; defaultHidden?: boolean }) {
  const { wrapRef, w, h, ready } = useExecChartSize([segments])
  const [labels, setLabels] = useState(false)

  useLayoutEffect(() => {
    if (!ready) return
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!segments.length) return

    const margin = { top: labels ? 28 : 22, right: 12, bottom: 48, left: 52 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom
    const maxY = d3.max(segments, (s) => Math.max(s.start, s.end)) ?? 1
    const y = d3.scaleLinear().domain([0, maxY * 1.1]).nice().range([ih, 0])
    const x = d3.scaleBand().domain(segments.map((s) => s.label)).range([0, iw]).padding(0.28)
    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    g.selectAll('rect')
      .data(segments)
      .join('rect')
      .attr('x', (d) => x(d.label) ?? 0)
      .attr('y', (d) => y(Math.max(d.start, d.end)))
      .attr('width', x.bandwidth())
      .attr('height', (d) => Math.abs(y(d.start) - y(d.end)))
      .attr('fill', (d) => movateBridgeSegmentFill(d))
      .attr('rx', 0)

    if (labels) {
      segments.forEach((s) => {
        const cx = (x(s.label) ?? 0) + x.bandwidth() / 2
        g.append('text')
          .attr('x', cx)
          .attr('y', y(Math.max(s.start, s.end)) - 4)
          .attr('text-anchor', 'middle')
          .attr('font-size', 9)
          .attr('fill', MOVATE_BRAND.deep)
          .text(formatCompact(s.value, true))
      })
    }

    styleMovateD3Axis(g.append('g').attr('transform', `translate(0,${ih})`).call(d3.axisBottom(x)))
    styleMovateD3Axis(g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat((d) => formatCompact(Number(d), true))))
  }, [segments, w, h, labels, wrapRef, ready])

  return (
    <ExecChartCard
      title="Revenue to margin bridge"
      insight="Waterfall from revenue through people cost and OPEX to gross margin."
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
      defaultChartHidden={defaultHidden}
    >
      <div ref={wrapRef} className="exec-chart-host" style={{ minHeight: 300 }}>
        <svg />
      </div>
    </ExecChartCard>
  )
}

function ScenarioKpiGrid({ model }: { view: IdealPanelView; model: IdealFinancialPanelModel }) {
  const { kpis } = model
  const hoursSub = kpis.hours > 0 ? `${kpis.hours.toLocaleString()} hrs` : undefined
  const gmSub = kpis.gmPct != null ? `${kpis.gmPct.toFixed(1)}%` : undefined
  const varRev = kpis.actual - kpis.projection

  return (
    <>
      <KpiTileMaybe label="Actuals" amount={kpis.actual} />
      <KpiTileMaybe label="Projections" amount={kpis.projection} />
      {isMeaningfulAmount(kpis.actual) || isMeaningfulAmount(kpis.projection) ? (
        <KpiTile label="Actual − Projection" value={formatSignedCompact(varRev)} />
      ) : null}
      <KpiTileMaybe label="GM (actuals)" amount={kpis.gm} sub={gmSub} />
      <KpiTileMaybe label="Revenue / hour" amount={kpis.revPerHour} sub={hoursSub} />
      <KpiTileMaybe label="Cost / hour" amount={kpis.costPerHour} />
      <KpiTileMaybe label="Projected revenue" amount={kpis.projectedRevenue} />
      <KpiTileMaybe label="Projected cost" amount={kpis.projectedCost} />
      <KpiTileMaybe label="Salary & benefits" amount={kpis.salaryCost} />
      <KpiTileMaybe label="Training cost" amount={kpis.trainingCost} />
      <KpiTileMaybe label="OPEX" amount={kpis.opex} />
      <KpiTileMaybe label="Total cost" amount={kpis.totalCost} />
    </>
  )
}

export function IdealFinancialDashboardPanel({
  rows,
  sourceRows,
  projectionWow,
  granularity,
  onGranularityChange,
  clientOptions,
  weekOptions,
  weekStart,
  weekEnd,
  headerClient,
  view,
  hideKpis = false,
  chartsCollapsedByDefault = false,
}: Props) {
  const [chartsOpen, setChartsOpen] = useState(!chartsCollapsedByDefault)
  const model = useMemo(
    () => buildIdealFinancialPanelModel({ rows, projectionWow, granularity }),
    [rows, projectionWow, granularity],
  )

  if (!rows.length) {
    return <p className="exec-muted exec-muted--box">No rows for the selected filters.</p>
  }

  return (
    <section className="ideal-fin-panel" aria-label="Financial dashboard">
      {view !== 'overview' ? (
        <>
          <div className="ideal-trend-toolbar mb-6 flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold text-slate-700">Trend granularity</span>
            {(['week', 'month', 'quarter'] as const).map((g) => (
              <button
                key={g}
                type="button"
                className={`exec-pill-btn ${granularity === g ? 'exec-pill-btn--on' : ''}`}
                onClick={() => onGranularityChange(g)}
              >
                {granularityLabel(g)}
              </button>
            ))}
          </div>
          <div className="exec-kpi-grid exec-kpi-grid--dense mb-8">
            <ScenarioKpiGrid view={view} model={model} />
          </div>
          <ScenarioComparisonSection pairId="projection_vs_actual" points={model.trends.projection_vs_actual} granularity={granularity} />
        </>
      ) : (
        <>
          {!hideKpis ? (
            <div className="exec-kpi-grid exec-kpi-grid--dense mb-6">
              <ScenarioKpiGrid view={view} model={model} />
            </div>
          ) : null}

          <div className="ideal-fin-charts-toolbar mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="ideal-scenario-section__title m-0">Charts</h2>
            <button
              type="button"
              className="exec-chart-card__btn"
              aria-expanded={chartsOpen}
              onClick={() => setChartsOpen((v) => !v)}
            >
              {chartsOpen ? 'Hide charts' : 'Show charts'}
            </button>
          </div>

          {chartsOpen ? (
            <>
              <section className="ideal-scenario-section mb-6" aria-label="Revenue bridge">
                <BridgeChart segments={model.revenueToMarginBridge} defaultHidden={false} />
              </section>

              <section className="ideal-scenario-section mb-6" aria-label="Week-on-week projection">
                <h3 className="ideal-scenario-section__title m-0 mb-3 text-sm font-bold text-slate-800">
                  Week-on-week projection revenue change
                </h3>
                <IdealProjectionWowSection
                  sourceRows={sourceRows}
                  clientOptions={clientOptions}
                  weekOptions={weekOptions}
                  weekStart={weekStart}
                  weekEnd={weekEnd}
                  headerClient={headerClient}
                  chartsHiddenByDefault={false}
                />
              </section>
            </>
          ) : (
            <p className="saas-muted mb-6 text-sm">Charts hidden — use Show charts to view revenue bridge and projection trends.</p>
          )}
        </>
      )}
    </section>
  )
}

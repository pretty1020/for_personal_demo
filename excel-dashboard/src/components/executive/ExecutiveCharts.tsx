import { formatCompact, formatPct } from './execChartFormat'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { ExecutiveUnifiedRow } from '../../types/dashboard'
import type { WaterfallSegment } from '../../utils/executiveAnalytics'
import {
  EXEC_CHART_COLORS,
  type ClientAgg,
  aggregateByClient,
  aggregateKpisFromRows,
  bubbleDimensionOptions,
  buildChordFlows,
  buildCommitToActualSegments,
  chordDataFromFlows,
  buildRevenueToGmSegments,
  clientMetricForBubble,
  formatBubbleAxisLabel,
  gmGapToTarget,
  measureOptionsForDropdowns,
  monthlyExecutiveTrendSeries,
  monthlyClientAggregateSeries,
  paretoClientsByMetricKey,
  paretoClients,
  resolveSemanticKeys,
} from '../../utils/executiveAnalytics'
import { ExecChartCard } from './ExecChartCard'
import { useExecChartSize } from './useExecChartSize'
import * as d3 from 'd3'
import { chord as d3chord, ribbon as d3ribbon } from 'd3-chord'
import type { ChordGroup } from 'd3-chord'
import type { MonthlyPoint } from '../../utils/executiveAnalytics'
import type { ExecChartId } from './executiveChartIds'
import { defaultChartVisibility } from './executiveChartIds'
import { OpsComparisonCharts } from './OpsComparisonCharts'

type Props = {
  rows: ExecutiveUnifiedRow[]
  onSelectClient?: (client: string) => void
  visibility?: Partial<Record<ExecChartId, boolean>>
  preferDataset?: 'datasheet' | 'budget_vs_trending' | 'lw_cw_datasheet'
  opsRows?: ExecutiveUnifiedRow[]
}

function Tooltip({
  visible,
  x,
  y,
  lines,
}: {
  visible: boolean
  x: number
  y: number
  lines: string[]
}) {
  if (!visible || lines.length === 0) return null
  return (
    <div className="exec-d3-tooltip" style={{ left: x, top: y }} role="status">
      {lines.map((l, i) => (
        <div key={i}>{l}</div>
      ))}
    </div>
  )
}

export function ExecutiveCharts(props: Props) {
  const { rows, opsRows, onSelectClient, visibility: visibilityProp, preferDataset } = props
  const vis = useMemo(() => ({ ...defaultChartVisibility(), ...visibilityProp }), [visibilityProp])
  const show = (id: ExecChartId) => vis[id] !== false

  const measures = useMemo(() => measureOptionsForDropdowns(rows), [rows])
  const kpisAll = useMemo(() => aggregateKpisFromRows(rows), [rows])
  const sem = useMemo(() => resolveSemanticKeys(Object.keys(kpisAll), { preferDataset }), [kpisAll, preferDataset])
  const clientAggs = useMemo(() => aggregateByClient(rows, { preferDataset }), [rows, preferDataset])
  const monthly = useMemo(() => monthlyExecutiveTrendSeries(rows), [rows])

  const [line1, setLine1] = useState('')
  const [line2, setLine2] = useState('')
  const [line3, setLine3] = useState('')
  const [chordRank, setChordRank] = useState<'Revenue' | 'GM'>('Revenue')
  const [peopleTop, setPeopleTop] = useState(10)
  const [paretoMetricKey, setParetoMetricKey] = useState('')
  const [paretoOrder, setParetoOrder] = useState<'top' | 'bottom'>('top')
  const [paretoLimit, setParetoLimit] = useState(15)
  const [marginOrder, setMarginOrder] = useState<'top' | 'bottom'>('top')
  const [bubbleX, setBubbleX] = useState('__revenue__')
  const [bubbleY, setBubbleY] = useState('__gm_pct__')
  const [bubbleSize, setBubbleSize] = useState('__fte__')
  const [revFteOrder, setRevFteOrder] = useState<'top' | 'bottom'>('top')
  const [revFteLimit, setRevFteLimit] = useState(16)

  const m1 = measures[0] ?? ''
  const m2 = measures[1] ?? ''
  const m3 = measures[2] ?? ''

  const bubbleDims = useMemo(() => bubbleDimensionOptions(rows), [rows])

  const paretoMetricResolved = paretoMetricKey || sem.revenue || ''
  const pareto = useMemo(() => {
    if (!paretoMetricResolved)
      return paretoClients(clientAggs, 'revenue').slice(0, paretoLimit)
    return paretoClientsByMetricKey(clientAggs, paretoMetricResolved, paretoOrder, paretoLimit)
  }, [clientAggs, paretoMetricResolved, paretoOrder, paretoLimit])

  const paretoInsight = useMemo(() => {
    if (!pareto.length)
      return 'Client concentration shows revenue concentration. Map client and revenue columns to populate this Pareto view.'
    const top3 = pareto.slice(0, 3).reduce((s, p) => s + p.value, 0)
    const tot = pareto.reduce((s, p) => s + p.value, 0)
    const pct = tot > 0 ? (top3 / tot) * 100 : 0
    return `Client concentration (${paretoOrder === 'top' ? 'largest' : 'smallest'} values first). Top three in view carry about ${pct.toFixed(0)}% of the metric total shown; follow the cumulative line for concentration.`
  }, [pareto, paretoOrder])

  const marginRank = useMemo(() => {
    const arr = [...clientAggs]
      .filter((a) => a.revenue > 0)
      .map((a) => ({
        name: a.client,
        margin: (a.gm / a.revenue) * 100,
        gm: a.gm,
        revenue: a.revenue,
      }))
    const sorted =
      marginOrder === 'top'
        ? arr.sort((a, b) => b.margin - a.margin)
        : arr.sort((a, b) => a.margin - b.margin)
    return sorted.slice(0, 12)
  }, [clientAggs, marginOrder])
  const marginInsight = useMemo(() => {
    if (!marginRank.length)
      return 'Client margin ranking needs margin and revenue at client grain. Detection maps GM / gross margin style columns when present.'
    const lowest = [...marginRank].sort((a, b) => a.margin - b.margin)[0]
    return `Client margin ranking separates accretive accounts from dilution. Weakest margin in view: ${lowest?.name ?? '—'} (${formatPct(lowest?.margin ?? 0)}) — good candidates for scope and pricing review.`
  }, [marginRank])

  const totalRev = clientAggs.reduce((s, a) => s + a.revenue, 0)
  const totalGm = clientAggs.reduce((s, a) => s + a.gm, 0)
  const gmPct = totalRev > 0 ? (totalGm / totalRev) * 100 : null
  const monthlyInsight = useMemo(() => {
    const g = gmPct != null ? gmPct.toFixed(1) : '—'
    return `Monthly trend: financial metrics (e.g. revenue) are summed per month. Weekly Attrition, Shrinkage, Headcount, and AHT rows use ISO weeks assigned to the month with more days (Mon–Sun), then averaged within each month—aligned against financial revenue for comparison. Blended GM% in this slice: ${g}%.`
  }, [gmPct])

  const commitActualInsight = useMemo(() => {
    const ck = sem.commit ?? null
    const ak = sem.actual ?? null
    if (!ck || !ak) {
      return 'Map commit/plan revenue and actual revenue columns to compare plan versus actual.'
    }
    const c = kpisAll[ck]
    const a = kpisAll[ak]
    if (typeof c !== 'number' || typeof a !== 'number' || !Number.isFinite(c) || !Number.isFinite(a)) {
      return 'Commit versus Actual compares plan revenue to actual when both KPI values resolve for the filtered slice.'
    }
    const v = a - c
    return `Commit versus Actual: actual revenue differs from planned by ${formatCompact(v, true)} for this slice.`
  }, [kpisAll, sem])

  const watch = useMemo(() => gmGapToTarget(clientAggs, 25), [clientAggs])
  const watchInsight = useMemo(() => {
    const worst = watch.length ? watch[watch.length - 1] : null
    const row = worst ? clientAggs.find((x) => x.client === worst.client) : null
    const pct =
      row && row.revenue > 0 ? (row.gm / row.revenue) * 100 : worst?.gmPct ?? 0
    return `GM Watchlist ranks opportunity versus a 25% GM target. Lowest GM% displayed: ${worst?.client ?? '—'} at ${formatPct(pct)} — click a bar to filter Client on this summary.`
  }, [watch, clientAggs])

  const revFteList = useMemo(() => {
    const arr = [...clientAggs].filter((a) => a.revPerFte != null && (a.revPerFte ?? 0) > 0)
    const sorted =
      revFteOrder === 'top'
        ? arr.sort((a, b) => (b.revPerFte ?? 0) - (a.revPerFte ?? 0))
        : arr.sort((a, b) => (a.revPerFte ?? 0) - (b.revPerFte ?? 0))
    return sorted.slice(0, Math.max(5, revFteLimit))
  }, [clientAggs, revFteOrder, revFteLimit])
  const avgRevFte =
    revFteList.length > 0
      ? revFteList.reduce((s, a) => s + (a.revPerFte ?? 0), 0) / revFteList.length
      : null
  const revFteInsight = `Revenue per FTE shows operating leverage. Average rev/FTE across clients shown: ${avgRevFte != null ? formatCompact(avgRevFte, true) : '—'}.`

  const bridgeGm = useMemo(() => buildRevenueToGmSegments(kpisAll, sem), [kpisAll, sem])
  const bridgeGmK = kval(kpisAll, sem.gm)
  const bridgeGmInsight = `Revenue to GM bridge walks from revenue through people cost, OPEX, and other delivery. The GM total bar equals your KPI GM $ in this slice (summed GM dollars): ${formatCompact(bridgeGmK, true)}.`

  const bridgeCommit = useMemo(() => buildCommitToActualSegments(kpisAll, sem), [kpisAll, sem])
  const bridgeCommitInsight = sem.commit && sem.actual
    ? `Commit versus actual revenue with any optional driver KPIs from the workbook (no fabricated breakdown).`
    : `Map commit/plan revenue and actual revenue columns to build this bridge—values are omitted when KPIs do not resolve.`

  const peopleShare = totalRev > 0 ? ((kpisAll[sem.peopleCost ?? ''] ?? 0) / totalRev) * 100 : null
  const peopleInsight = `People cost share of revenue (merged totals): ${peopleShare != null ? `${peopleShare.toFixed(1)}%` : '—'}. Use client breakdown to find salary and outsource concentration.`

  const fteTotal = clientAggs.reduce((s, a) => s + a.fte, 0)
  void fteTotal

  const bubbleInsight =
    'Profitability map: choose X axis, Y axis, and bubble size (defaults revenue × GM% × FTE). Large, unfavorable Y positions are the first portfolio review targets.'

  const chordFlows = useMemo(() => {
    const sorted =
      chordRank === 'Revenue'
        ? [...clientAggs].sort((a, b) => b.revenue - a.revenue)
        : [...clientAggs].sort((a, b) => {
            const ma = a.revenue > 0 ? a.gm / a.revenue : 0
            const mb = b.revenue > 0 ? b.gm / b.revenue : 0
            return mb - ma
          })
    const top = sorted.slice(0, 10)
    return buildChordFlows(top, sem)
  }, [clientAggs, chordRank, sem])

  return (
    <div className="exec-charts-root">
      <section className="exec-charts-section">
        <h2 className="exec-charts-section__title">Client & profitability</h2>
        <div className="exec-charts-grid exec-charts-grid--client-top">
          {show('clientPareto') ? (
            <ParetoCard
              data={pareto}
              insight={paretoInsight}
              valueColumnLabel={formatBubbleAxisLabel(paretoMetricKey || sem.revenue || '__revenue__')}
              controls={
                <div className="exec-chart-toolbar exec-chart-toolbar--wrap">
                  <label className="exec-chart-toolbar__field">
                    Metric (bars)
                    <select
                      className="exec-chart-toolbar__select"
                      value={paretoMetricKey}
                      onChange={(e) => setParetoMetricKey(e.target.value)}
                    >
                      <option value="">Revenue (default)</option>
                      {measures.map((m) => (
                        <option key={m} value={m}>
                          {m.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="exec-chart-toolbar__field">
                    Rank
                    <select
                      className="exec-chart-toolbar__select"
                      value={paretoOrder}
                      onChange={(e) => setParetoOrder(e.target.value as 'top' | 'bottom')}
                    >
                      <option value="top">Top clients</option>
                      <option value="bottom">Bottom clients</option>
                    </select>
                  </label>
                  <label className="exec-chart-toolbar__field">
                    Count
                    <input
                      type="number"
                      min={5}
                      max={40}
                      value={paretoLimit}
                      onChange={(e) =>
                        setParetoLimit(Math.max(5, Math.min(40, Number(e.target.value) || 15)))
                      }
                    />
                  </label>
                </div>
              }
              onSelectClient={onSelectClient}
            />
          ) : null}
          {show('clientMarginRank') ? (
            <MarginRankCard
              data={marginRank}
              insight={marginInsight}
              onSelectClient={onSelectClient}
              controls={
                <div className="exec-chart-toolbar">
                  <span className="exec-chart-toolbar__lbl">Show</span>
                  <select
                    className="exec-chart-toolbar__select"
                    value={marginOrder}
                    onChange={(e) => setMarginOrder(e.target.value as 'top' | 'bottom')}
                  >
                    <option value="top">Top margins</option>
                    <option value="bottom">Bottom margins</option>
                  </select>
                </div>
              }
            />
          ) : null}
        </div>

        {(show('profitabilityMap') || show('monthlyTrend')) && (
          <div className="exec-charts-grid exec-charts-grid--trend-pair">
            {show('profitabilityMap') ? (
              <BubbleCard
                rows={rows}
                preferDataset={preferDataset}
                clientAggs={clientAggs}
                sem={sem}
                bubbleDims={bubbleDims}
                xKey={bubbleX}
                yKey={bubbleY}
                sizeKey={bubbleSize}
                onX={setBubbleX}
                onY={setBubbleY}
                onSize={setBubbleSize}
                insight={bubbleInsight}
                onSelectClient={onSelectClient}
              />
            ) : null}
            {show('monthlyTrend') ? (
              <MonthlyTrendCard
                monthly={monthly}
                measures={measures}
                l1={line1}
                l2={line2}
                l3={line3}
                setLine1={setLine1}
                setLine2={setLine2}
                setLine3={setLine3}
                fallbacks={[m1, m2, m3]}
                insight={monthlyInsight}
              />
            ) : null}
          </div>
        )}

        {show('clientCostChord') ? (
          <div className="exec-charts-grid exec-charts-grid--chord-row">
            <ChordCard
              flows={chordFlows}
              chordRank={chordRank}
              setChordRank={setChordRank}
              insight="Chord view links clients to salary, outsource, and OPEX ribbons; thickness encodes attributed spend."
            />
          </div>
        ) : null}
      </section>

      <section className="exec-charts-section">
        <h2 className="exec-charts-section__title">Trends & execution</h2>
        <div className="exec-charts-grid">
          {show('commitVsActual') ? (
            <CommitActualCard kpis={kpisAll} sem={sem} insight={commitActualInsight} />
          ) : null}
          {show('gmWatchlist') ? (
            <GmWatchlistCard watch={watch} insight={watchInsight} onSelectClient={onSelectClient} />
          ) : null}
          {show('revPerFte') ? (
            <RevFteCard
              data={revFteList}
              insight={revFteInsight}
              order={revFteOrder}
              onOrder={setRevFteOrder}
              limit={revFteLimit}
              onLimit={setRevFteLimit}
              onSelectClient={onSelectClient}
            />
          ) : null}
        </div>
      </section>

      <section className="exec-charts-section">
        <h2 className="exec-charts-section__title">Bridges & cost structure</h2>
        <div className="exec-charts-grid">
          {show('revenueGmBridge') ? (
            <WaterfallCard segments={bridgeGm} title="Revenue to GM bridge" insight={bridgeGmInsight} />
          ) : null}
          {show('commitActualBridge') ? (
            <WaterfallCard segments={bridgeCommit} title="Commit to Actual bridge" insight={bridgeCommitInsight} />
          ) : null}
          {show('peopleCostBreakdown') ? (
            <PeopleCostCard
              clientAggs={clientAggs}
              topN={peopleTop}
              setTopN={setPeopleTop}
              insight={peopleInsight}
              onSelectClient={onSelectClient}
            />
          ) : null}
        </div>
      </section>

      {show('movingBubbles') || show('timelineInfographic') ? (
        <section className="exec-charts-section">
          <h2 className="exec-charts-section__title">Portfolio stories</h2>
          <div className="exec-charts-grid">
            {show('movingBubbles') ? (
              <MovingBubblesCard rows={rows} preferDataset={preferDataset} onSelectClient={onSelectClient} />
            ) : null}
            {show('timelineInfographic') ? (
              <TimelineInfographicCard rows={rows} preferDataset={preferDataset} />
            ) : null}
          </div>
        </section>
      ) : null}

      <OpsComparisonCharts rows={opsRows ?? rows} visibility={vis} />
    </div>
  )
}

type ParetoRow = { name: string; value: number; cumPct: number }

function uniqSorted(vals: string[]): string[] {
  return [...new Set(vals)].filter(Boolean).sort()
}

function MovingBubblesCard(props: {
  rows: ExecutiveUnifiedRow[]
  preferDataset?: 'datasheet' | 'budget_vs_trending' | 'lw_cw_datasheet'
  onSelectClient?: (c: string) => void
}) {
  const { rows, preferDataset, onSelectClient } = props
  const { wrapRef, w, h } = useExecChartSize()
  const [tip, setTip] = useState({ v: false, x: 0, y: 0, lines: [] as string[] })
  const [labels, setLabels] = useState(false)

  const months = useMemo(
    () => uniqSorted(rows.map((r) => (r.month_bucket ? r.month_bucket.slice(0, 7) : '')).filter(Boolean)),
    [rows],
  )
  const [month, setMonth] = useState('')
  const activeMonth = month || months[months.length - 1] || ''

  const monthRows = useMemo(() => {
    if (!activeMonth) return rows
    return rows.filter((r) => (r.month_bucket ?? '').startsWith(activeMonth))
  }, [rows, activeMonth])

  const clientAggs = useMemo(() => aggregateByClient(monthRows, { preferDataset }), [monthRows, preferDataset])

  const insight = activeMonth
    ? `Bubble view for ${activeMonth}. X=Revenue, Y=GM%, size=FTE.`
    : 'Bubble view: X=Revenue, Y=GM%, size=FTE.'

  const controls = (
    <div className="exec-chart-toolbar exec-chart-toolbar--wrap">
      <span className="exec-chart-toolbar__lbl">Month</span>
      <select className="exec-chart-toolbar__select" value={month} onChange={(e) => setMonth(e.target.value)}>
        <option value="">Latest</option>
        {months.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  )

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!clientAggs.length) return

    const pts = clientAggs.filter((a) => a.revenue > 0).map((a) => ({ name: a.client, x: a.revenue, y: a.marginPct ?? 0, s: a.fte }))
    if (pts.length === 0) return

    const margin = { top: 18, right: 18, bottom: 52, left: 56 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom
    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const x = d3.scaleLinear().domain([0, d3.max(pts, (d) => d.x) ?? 1]).nice().range([0, iw])
    const y = d3.scaleLinear().domain([d3.min(pts, (d) => d.y) ?? 0, d3.max(pts, (d) => d.y) ?? 1]).nice().range([ih, 0])
    const r = d3.scaleSqrt().domain([0, d3.max(pts, (d) => d.s) ?? 1]).range([6, 28])

    g.append('g').attr('transform', `translate(0,${ih})`).call(d3.axisBottom(x).ticks(6).tickFormat((v) => formatCompact(Number(v), true)))
    g.append('g').call(d3.axisLeft(y).ticks(6).tickFormat((v) => `${Number(v).toFixed(0)}%`))

    g.selectAll('circle')
      .data(pts)
      .join('circle')
      .attr('cx', (d) => x(d.x))
      .attr('cy', (d) => y(d.y))
      .attr('r', (d) => r(d.s))
      .attr('fill', '#8E24AA')
      .attr('opacity', 0.18)
      .attr('stroke', '#8E24AA')
      .attr('stroke-width', 2)
      .style('cursor', onSelectClient ? 'pointer' : 'default')
      .on('click', (_, d) => onSelectClient?.(d.name))
      .on('mousemove', (e: MouseEvent, d) => {
        setTip({
          v: true,
          x: e.clientX + 12,
          y: e.clientY + 12,
          lines: [d.name, `Revenue: ${formatCompact(d.x, true)}`, `GM%: ${d.y.toFixed(1)}%`, `FTE: ${formatCompact(d.s, true)}`],
        })
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, v: false })))

    if (labels) {
      g.selectAll('text.lab')
        .data(pts.slice(0, 18))
        .join('text')
        .attr('class', 'lab')
        .attr('x', (d) => x(d.x))
        .attr('y', (d) => y(d.y) - r(d.s) - 6)
        .attr('text-anchor', 'middle')
        .attr('font-size', '9px')
        .attr('fill', '#111827')
        .text((d) => d.name.slice(0, 14))
    }
  }, [clientAggs, w, h, labels, onSelectClient, wrapRef])

  return (
    <ExecChartCard
      title="Moving client bubbles"
      insight={insight}
      controls={controls}
      showDataLabels={labels}
      onToggleLabels={setLabels}
      expandTitle="Moving client bubbles — data"
      expandContent={
        <table className="exec-data-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Revenue</th>
              <th>GM%</th>
              <th>FTE</th>
            </tr>
          </thead>
          <tbody>
            {clientAggs.map((a) => (
              <tr key={a.client}>
                <td>{a.client}</td>
                <td>{formatCompact(a.revenue, true)}</td>
                <td>{a.marginPct != null ? `${a.marginPct.toFixed(1)}%` : '—'}</td>
                <td>{formatCompact(a.fte, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      accent={1}
    >
      <div ref={wrapRef} className="exec-d3-wrap">
        <svg className="exec-d3-svg" />
        <Tooltip visible={tip.v} x={tip.x} y={tip.y} lines={tip.lines} />
      </div>
    </ExecChartCard>
  )
}

function TimelineInfographicCard(props: {
  rows: ExecutiveUnifiedRow[]
  preferDataset?: 'datasheet' | 'budget_vs_trending' | 'lw_cw_datasheet'
}) {
  const { rows, preferDataset } = props
  const { wrapRef, w, h } = useExecChartSize()
  const [tip, setTip] = useState({ v: false, x: 0, y: 0, lines: [] as string[] })
  const [labels, setLabels] = useState(false)

  const kpisAll = useMemo(() => aggregateKpisFromRows(rows), [rows])
  const sem = useMemo(() => resolveSemanticKeys(Object.keys(kpisAll), { preferDataset }), [kpisAll, preferDataset])
  const monthly = useMemo(() => monthlyExecutiveTrendSeries(rows), [rows])

  const pts = useMemo(() => {
    const revK = sem.revenue
    const gmK = sem.gm
    if (!revK || !gmK) return []
    return monthly
      .map((m) => ({
        month: m.month,
        label: m.label,
        rev: m.metrics[revK] ?? Number.NaN,
        gm: m.metrics[gmK] ?? Number.NaN,
      }))
      .filter((p) => Number.isFinite(p.rev) || Number.isFinite(p.gm))
  }, [monthly, sem.revenue, sem.gm])

  const insight =
    sem.revenue && sem.gm
      ? 'Timeline view: Revenue and GM by month (from uploaded data).'
      : 'Timeline view needs Revenue and GM measures in the merged model.'

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (pts.length < 2) return

    const margin = { top: 18, right: 18, bottom: 52, left: 56 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom
    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const x = d3
      .scaleTime()
      .domain(d3.extent(pts, (d) => new Date(d.month + '-01T12:00:00')) as [Date, Date])
      .range([0, iw])
    const all = pts.flatMap((p) => [p.rev, p.gm]).filter((v) => Number.isFinite(v))
    const y = d3.scaleLinear().domain([0, (d3.max(all) ?? 1) * 1.08]).nice().range([ih, 0])

    const line = (key: 'rev' | 'gm', color: string) => {
      const l = d3
        .line<(typeof pts)[0]>()
        .defined((d) => Number.isFinite(d[key]))
        .x((d) => x(new Date(d.month + '-01T12:00:00')))
        .y((d) => y(d[key]))
      g.append('path').datum(pts).attr('fill', 'none').attr('stroke', color).attr('stroke-width', 2.6).attr('d', l)
      g.selectAll(`circle.${key}`)
        .data(pts.filter((d) => Number.isFinite(d[key])))
        .join('circle')
        .attr('class', key)
        .attr('cx', (d) => x(new Date(d.month + '-01T12:00:00')))
        .attr('cy', (d) => y(d[key]))
        .attr('r', 4)
        .attr('fill', color)
        .on('mousemove', (e: MouseEvent, d) => {
          setTip({
            v: true,
            x: e.clientX + 12,
            y: e.clientY + 12,
            lines: [d.label, `Revenue: ${formatCompact(d.rev, true)}`, `GM: ${formatCompact(d.gm, true)}`],
          })
        })
        .on('mouseleave', () => setTip((t) => ({ ...t, v: false })))
      if (labels) {
        g.selectAll(`text.lab-${key}`)
          .data(pts.filter((d) => Number.isFinite(d[key])))
          .join('text')
          .attr('class', `lab-${key}`)
          .attr('x', (d) => x(new Date(d.month + '-01T12:00:00')))
          .attr('y', (d) => y(d[key]) - 8)
          .attr('text-anchor', 'middle')
          .attr('font-size', '8px')
          .attr('fill', '#111827')
          .text((d) => formatCompact(d[key], true))
      }
    }

    line('rev', '#9a6b2f')
    line('gm', '#8c7348')

    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).ticks(8).tickFormat((v) => d3.timeFormat('%b %y')(v as Date)))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .attr('font-size', '9px')
      .attr('fill', '#334155')

    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => formatCompact(Number(v), true)))
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#334155')
  }, [pts, w, h, labels, wrapRef])

  return (
    <ExecChartCard
      title="Timeline infographic"
      insight={insight}
      showDataLabels={labels}
      onToggleLabels={setLabels}
      expandTitle="Timeline infographic — data"
      expandContent={
        <table className="exec-data-table">
          <thead>
            <tr>
              <th>Month</th>
              <th>Revenue</th>
              <th>GM</th>
            </tr>
          </thead>
          <tbody>
            {pts.map((p) => (
              <tr key={p.month}>
                <td>{p.label}</td>
                <td>{formatCompact(p.rev, true)}</td>
                <td>{formatCompact(p.gm, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      accent={2}
    >
      <div ref={wrapRef} className="exec-d3-wrap">
        <svg className="exec-d3-svg" />
        <Tooltip visible={tip.v} x={tip.x} y={tip.y} lines={tip.lines} />
      </div>
    </ExecChartCard>
  )
}

function ParetoCard({
  data,
  insight,
  valueColumnLabel = 'Value',
  controls,
  onSelectClient,
}: {
  data: ParetoRow[]
  insight: string
  valueColumnLabel?: string
  controls?: ReactNode
  onSelectClient?: (c: string) => void
}) {
  const { wrapRef, w, h } = useExecChartSize()
  const [tip, setTip] = useState({ v: false, x: 0, y: 0, lines: [] as string[] })
  const [labels, setLabels] = useState(false)

  const table = (
    <table className="exec-data-table">
      <thead>
        <tr>
          <th>Client</th>
          <th>{valueColumnLabel}</th>
          <th>Cumulative %</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.name}>
            <td>{d.name}</td>
            <td>{formatCompact(d.value, true)}</td>
            <td>{d.cumPct.toFixed(1)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!data.length) return

    const margin = { top: 24, right: 56, bottom: 64, left: 56 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom
    const x0 = d3
      .scaleBand()
      .domain(data.map((d) => d.name))
      .range([0, iw])
      .padding(0.2)
    const maxV = d3.max(data, (d) => d.value) ?? 1
    const yL = d3.scaleLinear().domain([0, maxV]).nice().range([ih, 0])
    const yR = d3.scaleLinear().domain([0, 100]).nice().range([ih, 0])
    const line = d3
      .line<ParetoRow>()
      .x((d) => (x0(d.name) ?? 0) + x0.bandwidth() / 2)
      .y((d) => yR(d.cumPct))

    const root = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    root
      .append('g')
      .selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', (d) => x0(d.name) ?? 0)
      .attr('y', (d) => yL(d.value))
      .attr('width', x0.bandwidth())
      .attr('height', (d) => ih - yL(d.value))
      .attr('fill', (_, i) => EXEC_CHART_COLORS[i % EXEC_CHART_COLORS.length]!)
      .attr('rx', 0)
      .style('cursor', onSelectClient ? 'pointer' : 'default')
      .on('click', (_, d) => onSelectClient?.(d.name))
      .on('mousemove', (e: MouseEvent, d: ParetoRow) => {
        setTip({
          v: true,
          x: e.clientX + 12,
          y: e.clientY + 12,
          lines: [`${d.name}`, `${valueColumnLabel}: ${formatCompact(d.value, true)}`, `Cumulative: ${d.cumPct.toFixed(1)}%`],
        })
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, v: false })))

    root.append('path').datum(data).attr('fill', 'none').attr('stroke', '#2c5648').attr('stroke-width', 2).attr('d', line)

    root
      .append('g')
      .selectAll('circle')
      .data(data)
      .join('circle')
      .attr('cx', (d) => (x0(d.name) ?? 0) + x0.bandwidth() / 2)
      .attr('cy', (d) => yR(d.cumPct))
      .attr('r', 4)
      .attr('fill', '#8c7348')

    const xAxis = d3.axisBottom(x0).tickSizeOuter(0)
    root
      .append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(xAxis)
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .attr('dx', '-0.6em')
      .attr('dy', '0.2em')
      .attr('fill', '#334155')
      .attr('font-size', '10px')

    root.append('g').call(d3.axisLeft(yL).ticks(5)).selectAll('text').attr('fill', '#334155').attr('font-size', '10px')

    root
      .append('g')
      .attr('transform', `translate(${iw},0)`)
      .call(d3.axisRight(yR).ticks(5).tickFormat((d) => `${d}%`))
      .selectAll('text')
      .attr('fill', '#334155')
      .attr('font-size', '10px')

    if (labels) {
      root
        .append('g')
        .selectAll('text.barlab')
        .data(data)
        .join('text')
        .attr('class', 'barlab')
        .attr('x', (d) => (x0(d.name) ?? 0) + x0.bandwidth() / 2)
        .attr('y', (d) => yL(d.value) - 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', '9px')
        .attr('fill', '#0f172a')
        .text((d) => formatCompact(d.value, true))
    }
  }, [data, w, h, labels, onSelectClient, wrapRef, valueColumnLabel])

  return (
    <ExecChartCard
      title="Client concentration"
      insight={insight}
      controls={controls}
      showDataLabels={labels}
      onToggleLabels={setLabels}
      expandTitle="Client concentration — data"
      expandContent={table}
    >
      <div ref={wrapRef} className="exec-d3-wrap">
        <svg className="exec-d3-svg" />
        <Tooltip visible={tip.v} x={tip.x} y={tip.y} lines={tip.lines} />
      </div>
    </ExecChartCard>
  )
}

function MarginRankCard({
  data,
  insight,
  controls,
  onSelectClient,
}: {
  data: { name: string; margin: number; gm: number; revenue: number }[]
  insight: string
  controls?: ReactNode
  onSelectClient?: (c: string) => void
}) {
  const { wrapRef, w, h } = useExecChartSize()
  const [tip, setTip] = useState({ v: false, x: 0, y: 0, lines: [] as string[] })
  const [labels, setLabels] = useState(false)

  const table = (
    <table className="exec-data-table">
      <thead>
        <tr>
          <th>Client</th>
          <th>Margin %</th>
          <th>GM $</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.name}>
            <td>{d.name}</td>
            <td>{formatPct(d.margin)}</td>
            <td>{formatCompact(d.gm, true)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!data.length) return
    const margin = { top: 24, right: 24, bottom: 72, left: 56 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom
    const x = d3
      .scaleBand()
      .domain(data.map((d) => d.name))
      .range([0, iw])
      .padding(0.22)
    const y = d3
      .scaleLinear()
      .domain([0, Math.max(10, d3.max(data, (d) => d.margin) ?? 80)])
      .nice()
      .range([ih, 0])

    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    g.append('g')
      .selectAll('rect')
      .data(data)
      .join('rect')
      .attr('x', (d) => x(d.name) ?? 0)
      .attr('y', (d) => y(d.margin))
      .attr('width', x.bandwidth())
      .attr('height', (d) => ih - y(d.margin))
      .attr('fill', (_, i) => EXEC_CHART_COLORS[i % EXEC_CHART_COLORS.length]!)
      .attr('rx', 0)
      .style('cursor', onSelectClient ? 'pointer' : 'default')
      .on('click', (_, d) => onSelectClient?.(d.name))
      .on('mousemove', (e: MouseEvent, d: { name: string; margin: number }) => {
        const row = data.find((x) => x.name === d.name)
        setTip({
          v: true,
          x: e.clientX + 12,
          y: e.clientY + 12,
          lines: [
            d.name,
            `GM%: ${formatPct(d.margin)}`,
            `GM $: ${formatCompact(row?.gm ?? 0, true)}`,
          ],
        })
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, v: false })))

    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).tickSizeOuter(0))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .attr('font-size', '10px')
      .attr('fill', '#334155')

    g.append('g')
      .call(d3.axisLeft(y).tickFormat((v) => `${v}%`))
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#334155')

    if (labels) {
      g.append('g')
        .selectAll('text')
        .data(data)
        .join('text')
        .attr('x', (d) => (x(d.name) ?? 0) + x.bandwidth() / 2)
        .attr('y', (d) => y(d.margin) - 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', '9px')
        .attr('fill', '#0f172a')
        .text((d) => formatPct(d.margin))
    }
  }, [data, w, h, labels, onSelectClient, wrapRef])

  return (
    <ExecChartCard
      title="Client margin ranking"
      insight={insight}
      controls={controls}
      showDataLabels={labels}
      onToggleLabels={setLabels}
      expandTitle="Margin ranking"
      expandContent={table}
      accent={1}
    >
      <div ref={wrapRef} className="exec-d3-wrap">
        <svg className="exec-d3-svg" />
        <Tooltip visible={tip.v} x={tip.x} y={tip.y} lines={tip.lines} />
      </div>
    </ExecChartCard>
  )
}

type BubblePt = { name: string; xv: number; yv: number; zv: number }

function bubbleColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return EXEC_CHART_COLORS[h % EXEC_CHART_COLORS.length]!
}

function BubbleCard({
  rows,
  preferDataset,
  clientAggs,
  sem,
  bubbleDims,
  xKey,
  yKey,
  sizeKey,
  onX,
  onY,
  onSize,
  insight,
  onSelectClient,
}: {
  rows: ExecutiveUnifiedRow[]
  preferDataset?: 'datasheet' | 'budget_vs_trending' | 'lw_cw_datasheet'
  clientAggs: ClientAgg[]
  sem: ReturnType<typeof resolveSemanticKeys>
  bubbleDims: string[]
  xKey: string
  yKey: string
  sizeKey: string
  onX: (k: string) => void
  onY: (k: string) => void
  onSize: (k: string) => void
  insight: string
  onSelectClient?: (c: string) => void
}) {
  const { wrapRef, w, h } = useExecChartSize()
  const [tip, setTip] = useState({ v: false, x: 0, y: 0, lines: [] as string[] })
  const [labels, setLabels] = useState(false)
  const [limit, setLimit] = useState(30)

  const timeSlices = useMemo(
    () => monthlyClientAggregateSeries(rows, preferDataset !== undefined ? { preferDataset } : undefined),
    [rows, preferDataset],
  )
  const canPlay = timeSlices.length >= 2

  const animateNextRef = useRef(false)
  const [frameIx, setFrameIx] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    setPlaying(false)
    if (timeSlices.length >= 2) setFrameIx(timeSlices.length - 1)
    else setFrameIx(0)
  }, [timeSlices])

  useEffect(() => {
    if (!playing || timeSlices.length < 2) return
    const id = window.setInterval(() => {
      animateNextRef.current = true
      setFrameIx((i) => (i + 1) % timeSlices.length)
    }, 1300)
    return () => clearInterval(id)
  }, [playing, timeSlices.length])

  const aggForPlot = useMemo(() => {
    if (timeSlices.length >= 2) return timeSlices[Math.min(frameIx, timeSlices.length - 1)]!.clients
    return clientAggs
  }, [timeSlices, frameIx, clientAggs])

  const periodLabel = canPlay ? timeSlices[Math.min(frameIx, timeSlices.length - 1)]?.label ?? '' : ''

  const xLbl = formatBubbleAxisLabel(xKey)
  const yLbl = formatBubbleAxisLabel(yKey)
  const zLbl = formatBubbleAxisLabel(sizeKey)
  const yIsPct =
    yKey === '__gm_pct__' || yKey.toLowerCase().includes('pct') || (sem.gmPct !== null && yKey === sem.gmPct)

  const pts = useMemo(() => {
    return [...aggForPlot]
      .map((a) => ({
        name: a.client,
        xv: clientMetricForBubble(a, sem, xKey),
        yv: clientMetricForBubble(a, sem, yKey),
        zv: Math.max(1e-9, Math.abs(clientMetricForBubble(a, sem, sizeKey))),
      }))
      .filter((d) => Number.isFinite(d.xv) && Number.isFinite(d.yv) && Number.isFinite(d.zv))
      .sort((a, b) => Math.abs(b.xv) - Math.abs(a.xv))
      .slice(0, limit)
  }, [aggForPlot, sem, xKey, yKey, sizeKey, limit])

  const controls = (
    <div className="exec-chart-toolbar exec-chart-toolbar--wrap">
      {canPlay ? (
        <div className="exec-chart-toolbar__field exec-chart-toolbar__field--play">
          <span className="exec-chart-toolbar__lbl">Time</span>
          <button type="button" className="exec-pill-btn exec-pill-btn--sm" 
            onClick={() => setPlaying((p) => !p)}
            aria-pressed={playing}
          >
            {playing ? 'Pause' : 'Play'}
          </button>
          <input
            type="range"
            className="exec-bubble-time-slider"
            min={0}
            max={timeSlices.length - 1}
            value={Math.min(frameIx, timeSlices.length - 1)}
            onChange={(e) => {
              animateNextRef.current = false
              setFrameIx(Number(e.target.value))
            }}
            aria-label="Period"
          />
          <span className="exec-chart-toolbar__muted exec-chart-toolbar__period">{periodLabel}</span>
        </div>
      ) : null}
      <label className="exec-chart-toolbar__field">
        X axis
        <select className="exec-chart-toolbar__select" value={xKey} onChange={(e) => onX(e.target.value)}>
          {bubbleDims.map((m) => (
            <option key={m} value={m}>
              {formatBubbleAxisLabel(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="exec-chart-toolbar__field">
        Y axis
        <select className="exec-chart-toolbar__select" value={yKey} onChange={(e) => onY(e.target.value)}>
          {bubbleDims.map((m) => (
            <option key={m} value={m}>
              {formatBubbleAxisLabel(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="exec-chart-toolbar__field">
        Bubble size
        <select className="exec-chart-toolbar__select" value={sizeKey} onChange={(e) => onSize(e.target.value)}>
          {bubbleDims.map((m) => (
            <option key={m} value={m}>
              {formatBubbleAxisLabel(m)}
            </option>
          ))}
        </select>
      </label>
      <label className="exec-chart-toolbar__field">
        Clients (limit)
        <input
          type="number"
          min={5}
          max={60}
          value={limit}
          onChange={(e) => setLimit(Math.max(5, Math.min(60, Number(e.target.value) || 30)))}
        />
      </label>
    </div>
  )

  const table = (
    <table className="exec-data-table">
      <thead>
        <tr>
          <th>Client</th>
          <th>{xLbl}</th>
          <th>{yLbl}</th>
          <th>{zLbl}</th>
        </tr>
      </thead>
      <tbody>
        {pts.map((d) => (
          <tr key={d.name}>
            <td>{d.name}</td>
            <td>{formatCompact(d.xv, true)}</td>
            <td>{yIsPct ? formatPct(d.yv) : formatCompact(d.yv, true)}</td>
            <td>{formatCompact(d.zv, true)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    const transitionMs = animateNextRef.current ? 480 : 0
    animateNextRef.current = false
    const t = d3.transition().duration(transitionMs).ease(d3.easeCubicInOut)

    const margin = { top: 24, right: 28, bottom: 44, left: 52 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom

    let root = svg.select<SVGGElement>('g.bubble-root')
    if (root.empty()) {
      svg.selectAll('*').remove()
      svg.attr('width', w).attr('height', h)
      root = svg
        .append('g')
        .attr('class', 'bubble-root')
        .attr('transform', `translate(${margin.left},${margin.top})`)
      root.append('g').attr('class', 'bubble-x-axis')
      root.append('g').attr('class', 'bubble-y-axis')
      root.append('g').attr('class', 'bubble-circles')
      root.append('g').attr('class', 'bubble-labels')
    } else {
      svg.attr('width', w).attr('height', h)
      root.attr('transform', `translate(${margin.left},${margin.top})`)
    }

    if (!pts.length) {
      root.select('.bubble-circles').selectAll('*').remove()
      root.select('.bubble-labels').selectAll('*').remove()
      return
    }

    const xr = d3.extent(pts, (d) => d.xv) as [number, number]
    const yg = d3.extent(pts, (d) => d.yv) as [number, number]
    const sx = d3.scaleLinear().domain(xr).nice().range([0, iw])
    const yPad = Math.max(Math.abs(yg[1]! - yg[0]!) * 0.05, 1)
    const sy = d3
      .scaleLinear()
      .domain([yg[0]! - yPad, yg[1]! + yPad])
      .nice()
      .range([ih, 0])
    const zMin = d3.min(pts, (d) => d.zv)!
    const zMax = d3.max(pts, (d) => d.zv)!
    const area = d3.scaleSqrt().domain([zMin, zMax]).range([6, 38])

    const axBottom = d3.axisBottom(sx).ticks(5).tickFormat((v) => formatCompact(Number(v), true))
    const axLeft = d3
      .axisLeft(sy)
      .ticks(5)
      .tickFormat((v) => (yIsPct ? `${Number(v).toFixed(0)}%` : formatCompact(Number(v), true)))

    const gx = root.select<SVGGElement>('.bubble-x-axis').attr('transform', `translate(0,${ih})`)
    gx.transition(t).call(axBottom)
    gx.selectAll('text').attr('font-size', '10px').attr('fill', '#334155')

    const gy = root.select<SVGGElement>('.bubble-y-axis')
    gy.transition(t).call(axLeft)
    gy.selectAll('text').attr('font-size', '10px').attr('fill', '#334155')

    const circG = root.select('.bubble-circles')
    const sel = circG.selectAll<SVGCircleElement, BubblePt>('circle.bubble-dot').data(pts, (d) => d.name)
    sel.exit().transition(t).attr('r', 0).remove()

    const enter = sel
      .enter()
      .append('circle')
      .attr('class', 'bubble-dot')
      .attr('cx', (d) => sx(d.xv))
      .attr('cy', (d) => sy(d.yv))
      .attr('r', 0)
      .attr('fill-opacity', 0.55)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
      .style('cursor', onSelectClient ? 'pointer' : 'default')

    enter
      .merge(sel)
      .attr('fill', (d) => bubbleColor(d.name))
      .on('click', (_, d) => onSelectClient?.(d.name))
      .on('mousemove', (e: MouseEvent, d: BubblePt) => {
        setTip({
          v: true,
          x: e.clientX + 12,
          y: e.clientY + 12,
          lines: [
            periodLabel ? `${d.name} · ${periodLabel}` : d.name,
            `${xLbl}: ${formatCompact(d.xv, true)}`,
            `${yLbl}: ${yIsPct ? formatPct(d.yv) : formatCompact(d.yv, true)}`,
            `${zLbl}: ${formatCompact(d.zv, true)}`,
          ],
        })
      })
      .on('mouseleave', () => setTip((x) => ({ ...x, v: false })))
      .transition(t)
      .attr('cx', (d) => sx(d.xv))
      .attr('cy', (d) => sy(d.yv))
      .attr('r', (d) => area(d.zv))

    const labG = root.select('.bubble-labels')
    labG.selectAll('*').remove()
    if (labels) {
      labG
        .selectAll('text')
        .data(pts)
        .join('text')
        .attr('x', (d) => sx(d.xv))
        .attr('y', (d) => sy(d.yv))
        .attr('dy', (d) => -area(d.zv) - 2)
        .attr('text-anchor', 'middle')
        .attr('font-size', '8px')
        .attr('fill', '#0f172a')
        .text((d) => d.name.slice(0, 10))
    }
  }, [pts, w, h, labels, onSelectClient, wrapRef, xLbl, yLbl, zLbl, yIsPct, periodLabel])

  const insightMerged =
    insight + (canPlay ? ` Use Play or the slider when multiple months exist in filtered rows.` : '')

  return (
    <ExecChartCard
      title="Profitability map"
      insight={insightMerged}
      controls={controls}
      showDataLabels={labels}
      onToggleLabels={setLabels}
      expandTitle="Profitability map"
      expandContent={table}
      accent={2}
    >
      <div ref={wrapRef} className="exec-d3-wrap">
        <svg className="exec-d3-svg" />
        <Tooltip visible={tip.v} x={tip.x} y={tip.y} lines={tip.lines} />
      </div>
    </ExecChartCard>
  )
}

function ChordCard({
  flows,
  chordRank,
  setChordRank,
  insight,
}: {
  flows: { source: string; target: string; value: number }[]
  chordRank: 'Revenue' | 'GM'
  setChordRank: (v: 'Revenue' | 'GM') => void
  insight: string
}) {
  const { wrapRef, w, h } = useExecChartSize()
  const [tip, setTip] = useState({ v: false, x: 0, y: 0, lines: [] as string[] })
  const [labels, setLabels] = useState(false)

  const { labels: chordLabs, matrix } = useMemo(() => chordDataFromFlows(flows, 8), [flows])

  const controls = (
    <div className="exec-chart-toolbar">
      <span className="exec-chart-toolbar__lbl">RANK CLIENTS BY</span>
      <select
        className="exec-chart-toolbar__select"
        value={chordRank}
        onChange={(e) => setChordRank(e.target.value as 'Revenue' | 'GM')}
      >
        <option value="Revenue">Revenue</option>
        <option value="GM">GM%</option>
      </select>
      <span className="exec-chart-toolbar__muted">Costs: Salaries · Outsource · OPEX (attributed)</span>
    </div>
  )

  const table = (
    <table className="exec-data-table">
      <thead>
        <tr>
          <th>From</th>
          <th>To</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        {flows.map((f, i) => (
          <tr key={i}>
            <td>{f.source}</td>
            <td>{f.target}</td>
            <td>{formatCompact(f.value, true)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!chordLabs.length || matrix.length < 2) return

    const outerRadius = Math.min(w, h) * 0.36
    const innerRadius = outerRadius - 18
    const chordGen = d3chord().padAngle(0.03)
    const chords = chordGen(matrix)
    const arc = d3.arc<ChordGroup>().innerRadius(innerRadius).outerRadius(outerRadius)
    const rib = d3ribbon().radius(innerRadius)
    const color = d3.scaleOrdinal<string>().domain(chordLabs).range(EXEC_CHART_COLORS)

    const g = svg
      .attr('width', w)
      .attr('height', h)
      .append('g')
      .attr('transform', `translate(${w / 2},${h / 2 + 8})`)

    g.append('g')
      .selectAll('path.arc')
      .data(chords.groups)
      .join('path')
      .attr('class', 'arc')
      .style('fill', (d) => color(chordLabs[d.index]!))
      .style('stroke', '#0f172a')
      .attr('d', arc)
      .on('mousemove', (e: MouseEvent, d: ChordGroup) => {
        setTip({
          v: true,
          x: e.clientX + 12,
          y: e.clientY + 12,
          lines: [chordLabs[d.index] ?? ''],
        })
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, v: false })))

    g.append('g')
      .attr('fill-opacity', 0.72)
      .selectAll('path.ribbon')
      .data(chords)
      .join('path')
      .attr('class', 'ribbon')
      .style('fill', (d) => color(chordLabs[d.source.index]!))
      .style('stroke', 'none')
      .attr('d', (d) => (rib as unknown as (datum: (typeof chords)[number]) => string | null)(d) ?? '')

    if (labels) {
      g.append('g')
        .selectAll('text')
        .data(chords.groups)
        .join('text')
        .each(function (d: ChordGroup) {
          const angle = (d.startAngle + d.endAngle) / 2 - Math.PI / 2
          d3.select(this)
            .attr('x', Math.cos(angle) * (outerRadius + 8))
            .attr('y', Math.sin(angle) * (outerRadius + 8))
            .attr('dy', '0.35em')
            .attr('text-anchor', angle > Math.PI / 2 && angle < (3 * Math.PI) / 2 ? 'end' : 'start')
            .attr('font-size', '9px')
            .attr('fill', '#0f172a')
            .text(chordLabs[d.index]!.slice(0, 12))
        })
    }
  }, [chordLabs, matrix, w, h, labels, wrapRef])

  return (
    <ExecChartCard
      title="Cost flow concentration"
      insight={insight}
      controls={controls}
      showDataLabels={labels}
      onToggleLabels={setLabels}
      expandTitle="Chord data"
      expandContent={table}
      accent={3}
    >
      <div ref={wrapRef} className="exec-d3-wrap">
        <svg className="exec-d3-svg" />
        <Tooltip visible={tip.v} x={tip.x} y={tip.y} lines={tip.lines} />
      </div>
    </ExecChartCard>
  )
}

function kval(kpis: Record<string, number>, key: string | null): number {
  if (!key) return 0
  const v = kpis[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function MonthlyTrendCard({
  monthly,
  measures,
  l1,
  l2,
  l3,
  setLine1,
  setLine2,
  setLine3,
  fallbacks,
  insight,
}: {
  monthly: MonthlyPoint[]
  measures: string[]
  l1: string
  l2: string
  l3: string
  setLine1: (s: string) => void
  setLine2: (s: string) => void
  setLine3: (s: string) => void
  fallbacks: string[]
  insight: string
}) {
  const { wrapRef, w, h } = useExecChartSize()
  const [tip, setTip] = useState({ v: false, x: 0, y: 0, lines: [] as string[] })
  const [labels, setLabels] = useState(false)

  const effective = [l1 || fallbacks[0] || '', l2 || fallbacks[1] || '', l3 || fallbacks[2] || ''].filter(Boolean)

  const series = monthly.map((m) => ({
    label: m.label,
    values: effective.map((k) => {
      const v = m.metrics[k]
      return typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN
    }),
  }))

  const controls = (
    <div className="exec-chart-toolbar exec-chart-toolbar--wrap">
      <label className="exec-chart-toolbar__field">
        LINE 1
        <select className="exec-chart-toolbar__select" value={l1} onChange={(e) => setLine1(e.target.value)}>
          <option value="">Auto ({fallbacks[0] ?? '—'})</option>
          {measures.map((m) => (
            <option key={m} value={m}>
              {m.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </label>
      <label className="exec-chart-toolbar__field">
        LINE 2
        <select className="exec-chart-toolbar__select" value={l2} onChange={(e) => setLine2(e.target.value)}>
          <option value="">Auto ({fallbacks[1] ?? '—'})</option>
          {measures.map((m) => (
            <option key={m} value={m}>
              {m.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </label>
      <label className="exec-chart-toolbar__field">
        LINE 3
        <select className="exec-chart-toolbar__select" value={l3} onChange={(e) => setLine3(e.target.value)}>
          <option value="">Auto ({fallbacks[2] ?? '—'})</option>
          {measures.map((m) => (
            <option key={m} value={m}>
              {m.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </label>
    </div>
  )

  const table = (
    <table className="exec-data-table">
      <thead>
        <tr>
          <th>Month</th>
          {effective.map((k) => (
            <th key={k}>{k.replace(/_/g, ' ')}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {series.map((row) => (
          <tr key={row.label}>
            <td>{row.label}</td>
            {row.values.map((v, i) => (
              <td key={i}>{formatCompact(v as number, true)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!series.length || !effective.length) return

    const margin = { top: 28, right: 24, bottom: 48, left: 56 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom

    const x = d3
      .scalePoint<string>()
      .domain(series.map((s) => s.label))
      .range([0, iw])
      .padding(0.5)

    const allVals = series.flatMap((s) => s.values)
    const finite = allVals.filter((v) => Number.isFinite(v))
    const lo = finite.length ? d3.min(finite)! : 0
    const hi = finite.length ? d3.max(finite)! : 1
    const y = d3
      .scaleLinear()
      .domain([Math.min(0, lo), hi <= lo ? lo + 1 : hi * 1.05])
      .nice()
      .range([ih, 0])

    const lineGens = effective.map((_, i) =>
      d3
        .line<(typeof series)[0]>()
        .defined((d) => Number.isFinite(d.values[i] as number))
        .x((d) => x(d.label) ?? 0)
        .y((d) => y(d.values[i] as number)),
    )

    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    effective.forEach((_, i) => {
      const color = EXEC_CHART_COLORS[i % EXEC_CHART_COLORS.length]!
      g.append('path')
        .datum(series)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 2.5)
        .attr('d', lineGens[i]!)

      g.append('g')
        .selectAll('circle')
        .data(series.filter((d) => Number.isFinite(d.values[i] as number)))
        .join('circle')
        .attr('cx', (d) => x(d.label) ?? 0)
        .attr('cy', (d) => y(d.values[i] as number))
        .attr('r', 5)
        .attr('fill', color)
        .on('mousemove', (e: MouseEvent, d: (typeof series)[0]) => {
          setTip({
            v: true,
            x: e.clientX + 12,
            y: e.clientY + 12,
            lines: [
              d.label,
              ...effective.map((k, j) =>
                `${k.replace(/_/g, ' ')}: ${formatCompact(d.values[j] as number, true)}`,
              ),
              'Tip: toggle labels from the card header.',
            ],
          })
        })
        .on('mouseleave', () => setTip((t) => ({ ...t, v: false })))
    })

    if (labels) {
      g.append('g')
        .selectAll('text')
        .data(series)
        .join('text')
        .attr('x', (d) => x(d.label) ?? 0)
        .attr('y', (d) => {
          const finiteNums = (d.values as number[]).filter((v) => Number.isFinite(v))
          const top = finiteNums.length ? d3.max(finiteNums)! : 0
          return y(top) - 8
        })
        .attr('text-anchor', 'middle')
        .attr('font-size', '8px')
        .attr('fill', '#0f172a')
        .text((d) => {
          const finiteNums = (d.values as number[]).filter((v) => Number.isFinite(v))
          return formatCompact(finiteNums.length ? d3.max(finiteNums)! : Number.NaN, true)
        })
    }

    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#334155')

    g.append('g')
      .call(d3.axisLeft(y).tickFormat((v) => formatCompact(Number(v), true)))
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#334155')

    const leg = g.append('g').attr('transform', `translate(${iw - 160}, 0)`)
    effective.forEach((key, i) => {
      const ly = i * 16
      leg
        .append('circle')
        .attr('cx', 0)
        .attr('cy', ly)
        .attr('r', 5)
        .attr('fill', EXEC_CHART_COLORS[i % EXEC_CHART_COLORS.length])
      leg
        .append('text')
        .attr('x', 10)
        .attr('y', ly)
        .attr('dy', '0.35em')
        .attr('font-size', '9px')
        .attr('fill', '#334155')
        .text(key.replace(/_/g, ' ').slice(0, 22))
    })
  }, [series, effective, w, h, labels, wrapRef])

  return (
    <ExecChartCard
      title="Monthly trend"
      insight={insight}
      controls={controls}
      showDataLabels={labels}
      onToggleLabels={setLabels}
      expandTitle="Monthly trend — data"
      expandContent={table}
    >
      <div ref={wrapRef} className="exec-d3-wrap">
        <svg className="exec-d3-svg" />
        <Tooltip visible={tip.v} x={tip.x} y={tip.y} lines={tip.lines} />
      </div>
    </ExecChartCard>
  )
}

function CommitActualCard({
  kpis,
  sem,
  insight,
}: {
  kpis: Record<string, number>
  sem: ReturnType<typeof resolveSemanticKeys>
  insight: string
}) {
  const { wrapRef, w, h } = useExecChartSize()
  const [tip, setTip] = useState({ v: false, x: 0, y: 0, lines: [] as string[] })
  const [labels, setLabels] = useState(false)

  const fin = (key: string | null) => {
    if (!key) return null
    const v = kpis[key]
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  }

  type Row = { label: string; c: number | null; a: number | null }
  const cats: Row[] = []
  const cRev = fin(sem.commit)
  const aRev = fin(sem.actual)
  if (cRev != null || aRev != null) cats.push({ label: 'Revenue', c: cRev, a: aRev })

  const table = (
    <table className="exec-data-table">
      <thead>
        <tr>
          <th>Category</th>
          <th>Commit</th>
          <th>Actual</th>
        </tr>
      </thead>
      <tbody>
        {cats.map((c) => (
          <tr key={c.label}>
            <td>{c.label}</td>
            <td>{c.c != null ? formatCompact(c.c, true) : '—'}</td>
            <td>{c.a != null ? formatCompact(c.a, true) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!cats.length) return
    const margin = { top: 28, right: 24, bottom: 56, left: 56 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom

    const nums = cats.flatMap((c) => [c.c, c.a]).filter((v): v is number => v != null)
    if (!nums.length) return
    const maxV = d3.max(nums) ?? 1
    const y = d3.scaleLinear().domain([0, maxV]).nice().range([ih, 0])

    const x0 = d3
      .scaleBand()
      .domain(cats.map((c) => c.label))
      .range([0, iw])
      .padding(0.25)
    const x1 = d3.scaleBand().domain(['Commit', 'Actual']).range([0, x0.bandwidth()]).padding(0.15)

    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const grp = g.append('g').selectAll('g').data(cats).join('g').attr('transform', (d) => `translate(${x0(d.label) ?? 0},0)`)

    grp
      .append('rect')
      .attr('x', x1('Commit') ?? 0)
      .attr('y', (d) => (d.c != null ? y(d.c) : ih))
      .attr('width', x1.bandwidth())
      .attr('height', (d) => (d.c != null ? ih - y(d.c) : 0))
      .attr('fill', '#8c7348')
      .attr('opacity', (d) => (d.c != null ? 1 : 0))
      .attr('rx', 0)
      .on('mousemove', (e: MouseEvent, d: Row) => {
        if (d.c == null) return
        setTip({
          v: true,
          x: e.clientX + 12,
          y: e.clientY + 12,
          lines: [`${d.label} — Commit`, formatCompact(d.c, true)],
        })
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, v: false })))

    grp
      .append('rect')
      .attr('x', x1('Actual') ?? 0)
      .attr('y', (d) => (d.a != null ? y(d.a) : ih))
      .attr('width', x1.bandwidth())
      .attr('height', (d) => (d.a != null ? ih - y(d.a) : 0))
      .attr('fill', '#9a6b2f')
      .attr('opacity', (d) => (d.a != null ? 1 : 0))
      .attr('rx', 0)
      .on('mousemove', (e: MouseEvent, d: Row) => {
        if (d.a == null) return
        setTip({
          v: true,
          x: e.clientX + 12,
          y: e.clientY + 12,
          lines: [`${d.label} — Actual`, formatCompact(d.a, true)],
        })
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, v: false })))

    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x0))
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#334155')

    g.append('g')
      .call(d3.axisLeft(y).tickFormat((v) => formatCompact(Number(v), true)))
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#334155')

    const legend = g.append('g').attr('transform', `translate(${iw - 130}, -6)`)
    ;(
      [
        ['#9a6b2f', 'Actuals'],
        ['#8c7348', 'Commit'],
      ] as const
    ).forEach(([col, lab], i) => {
      legend
        .append('rect')
        .attr('x', 0)
        .attr('y', i * 18)
        .attr('width', 12)
        .attr('height', 12)
        .attr('rx', 0)
        .attr('fill', col)
      legend
        .append('text')
        .attr('x', 18)
        .attr('y', i * 18 + 10)
        .attr('font-size', '10px')
        .attr('fill', '#334155')
        .text(lab)
    })

    if (labels) {
      grp.each(function (d: Row) {
        const node = d3.select(this)
        if (d.c != null) {
          node
            .append('text')
            .attr('x', (x1('Commit') ?? 0) + x1.bandwidth() / 2)
            .attr('y', y(d.c) - 4)
            .attr('text-anchor', 'middle')
            .attr('font-size', '8px')
            .attr('fill', '#0f172a')
            .text(formatCompact(d.c, true))
        }
        if (d.a != null) {
          node
            .append('text')
            .attr('x', (x1('Actual') ?? 0) + x1.bandwidth() / 2)
            .attr('y', y(d.a) - 4)
            .attr('text-anchor', 'middle')
            .attr('font-size', '8px')
            .attr('fill', '#0f172a')
            .text(formatCompact(d.a, true))
        }
      })
    }
  }, [cats, w, h, labels, wrapRef])

  if (!cats.length) {
    return (
      <ExecChartCard
        title="Commit versus Actual"
        insight={insight}
        showDataLabels={false}
        onToggleLabels={() => {}}
        expandTitle="Commit vs Actual"
        expandContent={<p className="exec-muted">No commit and actual revenue KPIs resolved for this slice.</p>}
        accent={1}
      >
        <div className="exec-d3-wrap exec-d3-wrap--empty">
          <p className="exec-muted" style={{ padding: '18px 12px', margin: 0 }}>
            Map separate commit/plan revenue and actual revenue columns to chart plan vs. actual—no synthetic substitutes.
          </p>
        </div>
      </ExecChartCard>
    )
  }

  return (
    <ExecChartCard
      title="Commit versus Actual"
      insight={insight}
      showDataLabels={labels}
      onToggleLabels={setLabels}
      expandTitle="Commit vs Actual"
      expandContent={table}
      accent={1}
    >
      <div ref={wrapRef} className="exec-d3-wrap">
        <svg className="exec-d3-svg" />
        <Tooltip visible={tip.v} x={tip.x} y={tip.y} lines={tip.lines} />
      </div>
    </ExecChartCard>
  )
}

function GmWatchlistCard({
  watch,
  insight,
  onSelectClient,
}: {
  watch: { client: string; gap: number; gmPct: number }[]
  insight: string
  onSelectClient?: (c: string) => void
}) {
  const { wrapRef, w, h } = useExecChartSize()
  const [tip, setTip] = useState({ v: false, x: 0, y: 0, lines: [] as string[] })
  const [showLab, setShowLab] = useState(false)

  const table = (
    <table className="exec-data-table">
      <thead>
        <tr>
          <th>Client</th>
          <th>Gap to 25% GM $</th>
          <th>GM %</th>
        </tr>
      </thead>
      <tbody>
        {watch.map((row) => (
          <tr key={row.client}>
            <td>{row.client}</td>
            <td>{formatCompact(row.gap, true)}</td>
            <td>{formatPct(row.gmPct)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!watch.length) return
    const margin = { top: 36, right: 24, bottom: 32, left: 120 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom

    const y = d3
      .scaleBand()
      .domain(watch.map((d) => d.client))
      .range([0, ih])
      .padding(0.18)

    const maxG = d3.max(watch, (d) => d.gap) ?? 1
    const x = d3.scaleLinear().domain([0, maxG]).nice().range([0, iw])

    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    g.append('g')
      .selectAll('rect')
      .data(watch)
      .join('rect')
      .attr('x', 0)
      .attr('y', (d) => y(d.client) ?? 0)
      .attr('width', (d) => x(d.gap))
      .attr('height', y.bandwidth())
      .attr('fill', '#8c7348')
      .attr('rx', 0)
      .style('cursor', onSelectClient ? 'pointer' : 'default')
      .on('click', (_, d) => onSelectClient?.(d.client))
      .on('mousemove', (e: MouseEvent, d: (typeof watch)[0]) => {
        setTip({
          v: true,
          x: e.clientX + 12,
          y: e.clientY + 12,
          lines: [d.client, `Gap: ${formatCompact(d.gap, true)}`, `GM%: ${formatPct(d.gmPct)}`],
        })
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, v: false })))

    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).tickFormat((v) => formatCompact(Number(v), true)))
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#334155')

    g.append('g').call(d3.axisLeft(y)).selectAll('text').attr('font-size', '10px').attr('fill', '#334155')
  }, [watch, w, h, onSelectClient, wrapRef])

  return (
    <ExecChartCard
      title="GM watchlist"
      insight={insight}
      showDataLabels={showLab}
      onToggleLabels={setShowLab}
      expandTitle="GM watchlist"
      expandContent={
        <>
          <p className="exec-chart-watchlist-note">
            <button type="button" className="exec-pill-btn" onClick={() => watch[0] && onSelectClient?.(watch[0].client)}>
              View full watchlist
            </button>
          </p>
          {table}
        </>
      }
      accent={2}
    >
      <div ref={wrapRef} className="exec-d3-wrap">
        <svg className="exec-d3-svg" />
        <Tooltip visible={tip.v} x={tip.x} y={tip.y} lines={tip.lines} />
      </div>
    </ExecChartCard>
  )
}

function RevFteCard({
  data,
  insight,
  order,
  onOrder,
  limit,
  onLimit,
  onSelectClient,
}: {
  data: ClientAgg[]
  insight: string
  order: 'top' | 'bottom'
  onOrder: (o: 'top' | 'bottom') => void
  limit: number
  onLimit: (n: number) => void
  onSelectClient?: (c: string) => void
}) {
  const { wrapRef, w, h } = useExecChartSize()
  const [tip, setTip] = useState({ v: false, x: 0, y: 0, lines: [] as string[] })
  const [labels, setLabels] = useState(false)

  const controls = (
    <div className="exec-chart-toolbar">
      <span className="exec-chart-toolbar__lbl">Clients</span>
      <select
        className="exec-chart-toolbar__select"
        value={order}
        onChange={(e) => onOrder(e.target.value as 'top' | 'bottom')}
      >
        <option value="top">Top rev/FTE</option>
        <option value="bottom">Bottom rev/FTE</option>
      </select>
      <label className="exec-chart-toolbar__field">
        Count
        <input
          type="number"
          min={5}
          max={40}
          value={limit}
          onChange={(e) => onLimit(Math.max(5, Math.min(40, Number(e.target.value) || 16)))}
        />
      </label>
    </div>
  )

  const rows = data.map((d) => ({ name: d.client, v: d.revPerFte ?? 0 }))

  const table = (
    <table className="exec-data-table">
      <thead>
        <tr>
          <th>Client</th>
          <th>Rev / FTE</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <td>{r.name}</td>
            <td>{formatCompact(r.v, true)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!rows.length) return
    const margin = { top: 24, right: 24, bottom: 64, left: 48 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom

    const x = d3
      .scaleBand()
      .domain(rows.map((r) => r.name))
      .range([0, iw])
      .padding(0.2)
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(rows, (r) => r.v) ?? 1])
      .nice()
      .range([ih, 0])

    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    g.append('g')
      .selectAll('rect')
      .data(rows)
      .join('rect')
      .attr('x', (d) => x(d.name) ?? 0)
      .attr('y', (d) => y(d.v))
      .attr('width', x.bandwidth())
      .attr('height', (d) => ih - y(d.v))
      .attr('fill', (_, i) => EXEC_CHART_COLORS[i % EXEC_CHART_COLORS.length]!)
      .attr('rx', 0)
      .style('cursor', onSelectClient ? 'pointer' : 'default')
      .on('click', (_, d) => onSelectClient?.(d.name))
      .on('mousemove', (e: MouseEvent, d: (typeof rows)[0]) => {
        setTip({
          v: true,
          x: e.clientX + 12,
          y: e.clientY + 12,
          lines: [d.name, `Rev/FTE: ${formatCompact(d.v, true)}`],
        })
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, v: false })))

    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('transform', 'rotate(-45)')
      .style('text-anchor', 'end')
      .attr('font-size', '9px')
      .attr('fill', '#334155')

    g.append('g')
      .call(d3.axisLeft(y).tickFormat((v) => formatCompact(Number(v), true)))
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#334155')

    if (labels) {
      g.append('g')
        .selectAll('text')
        .data(rows)
        .join('text')
        .attr('x', (d) => (x(d.name) ?? 0) + x.bandwidth() / 2)
        .attr('y', (d) => y(d.v) - 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', '8px')
        .attr('fill', '#0f172a')
        .text((d) => formatCompact(d.v, true))
    }
  }, [rows, w, h, labels, onSelectClient, wrapRef])

  return (
    <ExecChartCard
      title="Revenue per FTE"
      insight={insight}
      controls={controls}
      showDataLabels={labels}
      onToggleLabels={setLabels}
      expandTitle="Revenue per FTE"
      expandContent={table}
      accent={3}
    >
      <div ref={wrapRef} className="exec-d3-wrap">
        <svg className="exec-d3-svg" />
        <Tooltip visible={tip.v} x={tip.x} y={tip.y} lines={tip.lines} />
      </div>
    </ExecChartCard>
  )
}

function WaterfallCard({
  segments,
  title,
  insight,
}: {
  segments: WaterfallSegment[]
  title: string
  insight: string
}) {
  const { wrapRef, w, h } = useExecChartSize()
  const [tip, setTip] = useState({ v: false, x: 0, y: 0, lines: [] as string[] })
  const [labels, setLabels] = useState(false)

  const table = (
    <table className="exec-data-table">
      <thead>
        <tr>
          <th>Step</th>
          <th>Value</th>
          <th>Start</th>
          <th>End</th>
        </tr>
      </thead>
      <tbody>
        {segments.map((s) => (
          <tr key={s.label}>
            <td>{s.label}</td>
            <td>{formatCompact(s.value, true)}</td>
            <td>{formatCompact(s.start, true)}</td>
            <td>{formatCompact(s.end, true)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

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
        d.kind === 'negative'
          ? '#ef4444'
          : d.kind === 'positive' || d.kind === 'bridge'
            ? '#22c55e'
            : d.label.includes('GM')
              ? '#8c7348'
              : '#9a6b2f',
      )
      .attr('rx', 0)
      .on('mousemove', (e: MouseEvent, d: WaterfallSegment) => {
        setTip({
          v: true,
          x: e.clientX + 12,
          y: e.clientY + 12,
          lines: [`${d.label}`, `${formatCompact(d.value, true)}`],
        })
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, v: false })))

    if (labels) {
      g.selectAll('text.lab')
        .data(segments)
        .join('text')
        .attr('class', 'lab')
        .attr('x', (d) => (x(d.label) ?? 0) + x.bandwidth() / 2)
        .attr('y', (d) => y(Math.max(d.start, d.end)) - 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', '9px')
        .attr('fill', '#0f172a')
        .text((d) => formatCompact(d.value, true))
    }

    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('transform', 'rotate(-28)')
      .style('text-anchor', 'end')
      .attr('font-size', '9px')
      .attr('fill', '#334155')

    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => formatCompact(Number(v), true)))
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#334155')
  }, [segments, w, h, labels, wrapRef])

  return (
    <ExecChartCard
      title={title}
      insight={insight}
      showDataLabels={labels}
      onToggleLabels={setLabels}
      expandTitle={title}
      expandContent={table}
    >
      <div ref={wrapRef} className="exec-d3-wrap">
        <svg className="exec-d3-svg" />
        <Tooltip visible={tip.v} x={tip.x} y={tip.y} lines={tip.lines} />
      </div>
    </ExecChartCard>
  )
}

function PeopleCostCard({
  clientAggs,
  topN,
  setTopN,
  insight,
  onSelectClient,
}: {
  clientAggs: ClientAgg[]
  topN: number
  setTopN: (n: number) => void
  insight: string
  onSelectClient?: (c: string) => void
}) {
  const { wrapRef, w, h } = useExecChartSize()
  const [tip, setTip] = useState({ v: false, x: 0, y: 0, lines: [] as string[] })
  const [labels, setLabels] = useState(false)

  const ranked = [...clientAggs].sort((a, b) => b.peopleCost - a.peopleCost).slice(0, topN)

  const controls = (
    <div className="exec-chart-toolbar exec-chart-toolbar--wrap">
      <span className="exec-chart-toolbar__lbl">Dimension</span>
      <span className="exec-chart-toolbar__static">Client Name</span>
      <span className="exec-chart-toolbar__lbl">Metric</span>
      <span className="exec-chart-toolbar__static">People Cost</span>
      <label className="exec-chart-toolbar__field">
        Top N
        <select className="exec-chart-toolbar__select" value={topN} onChange={(e) => setTopN(Number(e.target.value))}>
          {[5, 10, 15, 20].map((n) => (
            <option key={n} value={n}>
              Top {n}
            </option>
          ))}
        </select>
      </label>
    </div>
  )

  const table = (
    <table className="exec-data-table">
      <thead>
        <tr>
          <th>Client</th>
          <th>People cost</th>
        </tr>
      </thead>
      <tbody>
        {ranked.map((r) => (
          <tr key={r.client}>
            <td>{r.client}</td>
            <td>{formatCompact(r.peopleCost, true)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!ranked.length) return
    const margin = { top: 24, right: 20, bottom: 64, left: 48 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom

    const x = d3
      .scaleBand()
      .domain(ranked.map((r) => r.client))
      .range([0, iw])
      .padding(0.2)
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(ranked, (r) => r.peopleCost) ?? 1])
      .nice()
      .range([ih, 0])

    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    g.append('g')
      .selectAll('rect')
      .data(ranked)
      .join('rect')
      .attr('x', (d) => x(d.client) ?? 0)
      .attr('y', (d) => y(d.peopleCost))
      .attr('width', x.bandwidth())
      .attr('height', (d) => ih - y(d.peopleCost))
      .attr('fill', (_, i) => EXEC_CHART_COLORS[i % EXEC_CHART_COLORS.length]!)
      .attr('rx', 0)
      .style('cursor', onSelectClient ? 'pointer' : 'default')
      .on('click', (_, d) => onSelectClient?.(d.client))
      .on('mousemove', (e: MouseEvent, d: ClientAgg) => {
        setTip({
          v: true,
          x: e.clientX + 12,
          y: e.clientY + 12,
          lines: [d.client, `People cost: ${formatCompact(d.peopleCost, true)}`],
        })
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, v: false })))

    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x))
      .selectAll('text')
      .attr('transform', 'rotate(-40)')
      .style('text-anchor', 'end')
      .attr('font-size', '9px')
      .attr('fill', '#334155')

    g.append('g')
      .call(d3.axisLeft(y).tickFormat((v) => formatCompact(Number(v), true)))
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#334155')

    if (labels) {
      g.append('g')
        .selectAll('text')
        .data(ranked)
        .join('text')
        .attr('x', (d) => (x(d.client) ?? 0) + x.bandwidth() / 2)
        .attr('y', (d) => y(d.peopleCost) - 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', '8px')
        .attr('fill', '#0f172a')
        .text((d) => formatCompact(d.peopleCost, true))
    }
  }, [ranked, w, h, labels, onSelectClient, wrapRef])

  return (
    <ExecChartCard
      title="People cost breakdown"
      insight={insight}
      controls={controls}
      showDataLabels={labels}
      onToggleLabels={setLabels}
      expandTitle="People cost by client"
      expandContent={table}
      accent={1}
    >
      <div ref={wrapRef} className="exec-d3-wrap">
        <svg className="exec-d3-svg" />
        <Tooltip visible={tip.v} x={tip.x} y={tip.y} lines={tip.lines} />
      </div>
    </ExecChartCard>
  )
}

// Removed: FteSplitCard (Billed FTE chart).

import { useLayoutEffect, useMemo, useState } from 'react'
import * as d3 from 'd3'
import type { ExecChartId } from './executiveChartIds'
import { ExecChartCard } from './ExecChartCard'
// (No currency formatting needed in ops charts.)
import { useExecChartSize } from './useExecChartSize'
import {
  aggregateKpisFromRows,
  measureOptionsForDropdowns,
  monthlyExecutiveTrendSeries,
  weeklyExecutiveTrendSeries,
  resolveOperationalMetricKeys,
  type MonthlyPoint,
  type WeeklyPoint,
} from '../../utils/executiveAnalytics'
import type { ExecutiveUnifiedRow } from '../../types/dashboard'

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

// (bar-style cards removed in favor of Excel-style line charts)

function MomDualLineCard({
  title,
  insight,
  points,
  mode,
  chartK1,
  chartK2,
  chartK3,
  label1,
  label2,
  label3,
  showControls = true,
  sel1,
  sel2,
  sel3,
  setSel1,
  setSel2,
  setSel3,
  measures,
  pairALabel,
  pairBLabel,
  onPairA,
  onPairB,
}: {
  title: string
  insight: string
  points: (MonthlyPoint | WeeklyPoint)[]
  mode: 'monthly' | 'weekly'
  /** Resolved column keys (after auto-detection fallbacks) */
  chartK1: string
  chartK2: string
  chartK3?: string
  label1: string
  label2: string
  label3?: string
  showControls?: boolean
  /** Select widget values (may be empty for auto) */
  sel1?: string
  sel2?: string
  sel3?: string
  setSel1?: (v: string) => void
  setSel2?: (v: string) => void
  setSel3?: (v: string) => void
  measures?: string[]
  pairALabel?: string
  pairBLabel?: string
  onPairA?: () => void
  onPairB?: () => void
}) {
  const { wrapRef, w, h } = useExecChartSize()
  const [tip, setTip] = useState({ v: false, x: 0, y: 0, lines: [] as string[] })
  // Excel-style: show point labels by default.
  const [labels, setLabels] = useState(true)

  const seriesKeys = [chartK1, chartK2, chartK3].filter(Boolean) as string[]
  const isPct =
    (chartK1 && /attrition|shrink|%|pct|percent/i.test(chartK1)) ||
    (chartK2 && /attrition|shrink|%|pct|percent/i.test(chartK2)) ||
    (chartK3 && /attrition|shrink|%|pct|percent/i.test(chartK3))
  const fmtVal = (v: number) => {
    if (!Number.isFinite(v)) return '—'
    if (isPct) return `${(Math.round(v * 10) / 10).toFixed(1)}%`
    // Ops metrics are not currency.
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  }
  const series = points
    .map((p) => {
      const date =
        'week' in p
          ? new Date(`${p.week}T12:00:00`)
          : new Date(`${p.month}-01T12:00:00`)
      if (Number.isNaN(date.getTime())) return null
      return {
        date,
        label: p.label,
        // IMPORTANT: keep missing values as NaN (not 0) so charts don't draw fake zero lines.
        values: seriesKeys.map((key) => {
          const v = p.metrics[key]
          return typeof v === 'number' && Number.isFinite(v) ? v : Number.NaN
        }),
      }
    })
    .filter(Boolean) as { date: Date; label: string; values: number[] }[]

  const momNote = insight

  const controls =
    showControls && measures && setSel1 && setSel2 ? (
      <div className="exec-chart-toolbar exec-chart-toolbar--wrap">
        {onPairA && onPairB && pairALabel && pairBLabel ? (
          <div className="exec-chart-toolbar__pair-btns" role="group" aria-label="Quick pairings">
            <button type="button" className="exec-pill-btn exec-pill-btn--sm" onClick={onPairA}>
              {pairALabel}
            </button>
            <button type="button" className="exec-pill-btn exec-pill-btn--sm" onClick={onPairB}>
              {pairBLabel}
            </button>
          </div>
        ) : null}
        <label className="exec-chart-toolbar__field">
          {label1}
          <select className="exec-chart-toolbar__select" value={sel1 ?? ''} onChange={(e) => setSel1(e.target.value)}>
            <option value="">Auto</option>
            {measures.map((m) => (
              <option key={m} value={m}>
                {m.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="exec-chart-toolbar__field">
          {label2}
          <select className="exec-chart-toolbar__select" value={sel2 ?? ''} onChange={(e) => setSel2(e.target.value)}>
            <option value="">Auto</option>
            {measures.map((m) => (
              <option key={m} value={m}>
                {m.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        {label3 && setSel3 ? (
          <label className="exec-chart-toolbar__field">
            {label3}
            <select className="exec-chart-toolbar__select" value={sel3 ?? ''} onChange={(e) => setSel3(e.target.value)}>
              <option value="">Auto</option>
              {measures.map((m) => (
                <option key={m} value={m}>
                  {m.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    ) : null

  const table = (
    <table className="exec-data-table">
      <thead>
        <tr>
          <th>{mode === 'weekly' ? 'Week' : 'Month'}</th>
          <th>{label1}</th>
          <th>{label2}</th>
          {label3 ? <th>{label3}</th> : null}
        </tr>
      </thead>
      <tbody>
        {points.map((p) => (
          <tr key={'month' in p ? p.month : p.week}>
            <td>{p.label}</td>
            <td>{(p.metrics[chartK1] ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
            <td>{(p.metrics[chartK2] ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
            {chartK3 ? (
              <td>{(p.metrics[chartK3] ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
            ) : null}
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
    // Allow single-series rendering (e.g. only Planned present).
    if (!series.length || seriesKeys.length < 1) return

    // More bottom space for rotated date labels (Excel style)
    const margin = { top: 22, right: 18, bottom: 70, left: 52 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom

    const extent0 = d3.extent(series, (s) => s.date) as [Date, Date]
    let extent: [Date, Date] = extent0
    // If all points land on the same date (common when only one bucket has data),
    // expand domain so x-axis ticks don't overlap and lines/circles are readable.
    if (extent0[0] && extent0[1] && extent0[0].getTime() === extent0[1].getTime()) {
      const base = extent0[0]
      const padDays = mode === 'weekly' ? 7 : 31
      extent = [d3.timeDay.offset(base, -padDays), d3.timeDay.offset(base, padDays)]
    }
    const x = d3.scaleTime().domain(extent).range([0, iw])

    const allVals = series.flatMap((s) => s.values).filter((v) => Number.isFinite(v))
    const lo = d3.min(allVals) ?? 0
    const hi = d3.max(allVals) ?? 1
    const pad = hi <= lo ? 1 : (hi - lo) * 0.08
    const y = d3
      .scaleLinear()
      // Excel-style: metrics like HC/AHT should read from zero baseline.
      .domain([0, Math.max(1, hi + pad)])
      .nice()
      .range([ih, 0])

    const colors = ['#1f77b4', '#ff7f0e', '#2ca02c'] // Excel-like palette (blue, orange, green)
    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Horizontal gridlines (Excel feel)
    g.append('g')
      .attr('class', 'grid')
      .call(d3.axisLeft(y).ticks(6).tickSize(-iw).tickFormat(() => ''))
      .selectAll('line')
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1)
    g.selectAll('.grid path').attr('stroke', 'none')

    seriesKeys.forEach((_, i) => {
      const line = d3
        .line<(typeof series)[0]>()
        .defined((d) => Number.isFinite(d.values[i] ?? Number.NaN))
        .x((d) => x(d.date))
        .y((d) => y(d.values[i] ?? 0))
      const c = colors[i % colors.length]!
      g.append('path')
        .datum(series)
        .attr('fill', 'none')
        .attr('stroke', c)
        .attr('stroke-width', 1.5)
        .attr('d', line)

      g.append('g')
        .selectAll('circle')
        .data(series.filter((d) => Number.isFinite(d.values[i] ?? Number.NaN)))
        .join('circle')
        .attr('cx', (d) => x(d.date))
        .attr('cy', (d) => y(d.values[i] ?? 0))
        .attr('r', 3.8)
        .attr('fill', c)
        .on('mousemove', (e: MouseEvent, d: (typeof series)[0]) => {
          setTip({
            v: true,
            x: e.clientX + 12,
            y: e.clientY + 12,
            lines: [
              d.label,
              `${label1}: ${fmtVal(d.values[0] ?? Number.NaN)}`,
              `${label2}: ${fmtVal(d.values[1] ?? Number.NaN)}`,
              ...(label3 ? [`${label3}: ${fmtVal(d.values[2] ?? Number.NaN)}`] : []),
            ],
          })
        })
        .on('mouseleave', () => setTip((t) => ({ ...t, v: false })))
    })

    const fmtDate = mode === 'weekly' ? d3.timeFormat('%-m/%-d/%Y') : d3.timeFormat('%b %y')
    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(Math.min(10, Math.max(3, Math.floor(iw / 90))))
          .tickFormat((d) => fmtDate(d as Date)),
      )
      .selectAll('text')
      .attr('font-size', '9px')
      .attr('fill', '#334155')
      .attr('text-anchor', 'end')
      .attr('transform', 'rotate(-45)')
      .attr('dx', '-0.6em')
      .attr('dy', '0.25em')

    const yAxis = g
      .append('g')
      .call(
        d3
          .axisLeft(y)
          .ticks(6)
          .tickFormat((v) => (isPct ? `${Number(v)}%` : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }))),
      )
    yAxis.selectAll('text').attr('font-size', '10px').attr('fill', '#334155')
    if (isPct) {
      // Only apply % suffix to the Y-axis ticks (never touch the X-axis ticks).
      yAxis.selectAll('g.tick text').text((d: any) => `${d}%`)
    }

    // Legend at bottom (Excel style)
    const leg = g.append('g').attr('transform', `translate(${Math.max(0, iw / 2 - 110)}, ${ih + 52})`)
    seriesKeys.forEach((_, i) => {
      const ly = i * 15
      leg.append('circle').attr('cx', 0).attr('cy', ly).attr('r', 4).attr('fill', colors[i % colors.length]!)
      leg
        .append('text')
        .attr('x', 8)
        .attr('y', ly)
        .attr('dy', '0.35em')
        .attr('font-size', '9px')
        .attr('fill', '#334155')
        .text((i === 0 ? label1 : i === 1 ? label2 : label3 ?? '').slice(0, 22))
    })

    if (labels && series.length > 0) {
      // Label every point (Excel feel)
      seriesKeys.forEach((_, i) => {
        g.append('g')
          .selectAll(`text.p${i}`)
          .data(series.filter((d) => Number.isFinite(d.values[i] ?? Number.NaN)))
          .join('text')
          .attr('class', `p${i}`)
          .attr('x', (d) => x(d.date))
          .attr('y', (d) => y(d.values[i] ?? 0) - 8)
          .attr('text-anchor', 'middle')
          .attr('font-size', '9px')
          .attr('fill', '#111827')
          .text((d) => {
            const v = d.values[i] ?? Number.NaN
            return Number.isFinite(v) ? (isPct ? `${Math.round(v * 10) / 10}%` : String(Math.round(v * 100) / 100)) : ''
          })
      })
    }
  }, [series, seriesKeys, chartK1, chartK2, w, h, label1, label2, labels, wrapRef])

  return (
    <ExecChartCard
      title={title}
      insight={momNote}
      controls={controls}
      showDataLabels={labels}
      onToggleLabels={setLabels}
      expandTitle={`${title} — data`}
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

function PlaceholderOpsCard({ title, body }: { title: string; body: string }) {
  return (
    <article className="exec-placeholder-card">
      <h3 className="exec-placeholder-card__title">{title}</h3>
      <p className="exec-placeholder-card__body">{body}</p>
    </article>
  )
}

type Vis = Record<ExecChartId, boolean>

type Props = {
  rows: ExecutiveUnifiedRow[]
  visibility: Vis
}

export function OpsComparisonCharts(props: Props) {
  const { rows, visibility } = props
  const kpis = useMemo(() => aggregateKpisFromRows(rows), [rows])
  const measures = useMemo(() => measureOptionsForDropdowns(rows), [rows])
  const op0 = useMemo(() => resolveOperationalMetricKeys(Object.keys(kpis)), [kpis])

  const [trendMode, setTrendMode] = useState<'monthly' | 'weekly'>('monthly')
  const monthlySeries = useMemo(() => monthlyExecutiveTrendSeries(rows), [rows])
  const weeklySeries = useMemo(() => weeklyExecutiveTrendSeries(rows), [rows])
  const trendSeries: (MonthlyPoint | WeeklyPoint)[] = trendMode === 'weekly' ? weeklySeries : monthlySeries

  const ahtMeasures = useMemo(
    () => measures.filter((k) => k.startsWith('aht_') || (/aht/i.test(k) && !/attr/i.test(k))),
    [measures],
  )
  const attrMeasures = useMemo(() => measures.filter((k) => k.startsWith('attrition_')), [measures])
  const shrMeasures = useMemo(() => measures.filter((k) => k.startsWith('shrinkage_')), [measures])
  const hcMeasures = useMemo(() => measures.filter((k) => k.startsWith('headcount_')), [measures])

  // Default series keys (auto), but allow overrides via dropdowns.
  const ahtPicked = useMemo(() => {
    // No fallback: Planned/Actuals/Cap must bind to their own measures, or stay blank.
    // (Prevents Actuals/Cap silently reusing Planned.)
    const keys = ahtMeasures
    const planned =
      (op0.ahtPlanned && keys.includes(op0.ahtPlanned) ? op0.ahtPlanned : null) ??
      keys.find((k) => /^aht_planned$/i.test(k)) ??
      keys.find((k) => /planned|plan|target|budget|std|sla|goal|bench|objective/i.test(k)) ??
      ''
    const actual =
      (op0.ahtActual && keys.includes(op0.ahtActual) ? op0.ahtActual : null) ??
      keys.find((k) => /^aht_actuals?$/i.test(k)) ??
      keys.find((k) => /actuals?\b|actual|act\b|real|result|achieved/i.test(k)) ??
      ''
    const cap =
      (op0.ahtCap && keys.includes(op0.ahtCap) ? op0.ahtCap : null) ??
      keys.find((k) => /^aht_cap$/i.test(k)) ??
      keys.find((k) => /\bcap\b|capacity|limit|ceiling/i.test(k)) ??
      ''
    return { planned, actual, cap }
  }, [ahtMeasures, op0.ahtPlanned, op0.ahtActual, op0.ahtCap])

  const ahtPlanned0 = ahtPicked.planned
  const ahtActual0 = ahtPicked.actual
  const ahtCap0 = ahtPicked.cap
  const [ahtK1, setAhtK1] = useState('')
  const [ahtK2, setAhtK2] = useState('')
  const [ahtK3, setAhtK3] = useState('')
  const ahtPlanned = ahtK1 || ahtPlanned0
  // Prevent Actuals/Cap accidentally using Planned when canonical keys exist.
  const ahtActual =
    ahtK2 && ahtK2 !== ahtPlanned
      ? ahtK2
      : ahtMeasures.includes('aht_actuals')
        ? 'aht_actuals'
        : ahtActual0 && ahtActual0 !== ahtPlanned
          ? ahtActual0
          : ''
  const ahtCap =
    ahtK3 && ahtK3 !== ahtPlanned
      ? ahtK3
      : ahtMeasures.includes('aht_cap')
        ? 'aht_cap'
        : ahtCap0 && ahtCap0 !== ahtPlanned
          ? ahtCap0
          : ''

  const attrAssumption0 =
    op0.attrAssumption ||
    attrMeasures.find((k) => /assumpt|assump|plan|target|forecast|expected/i.test(k)) ||
    attrMeasures[0] ||
    ''
  const attrActual0 =
    op0.attrActual ||
    attrMeasures.find((k) => /actual|result|achieved/i.test(k)) ||
    attrMeasures.find((k) => k !== attrAssumption0) ||
    attrMeasures[1] ||
    ''
  const [attrK1, setAttrK1] = useState('')
  const [attrK2, setAttrK2] = useState('')
  const attrAssumption = attrK1 || attrAssumption0
  const attrActual = attrK2 || attrActual0

  const shrinkTotal =
    shrMeasures.find((k) => /total[_\s]*shrinkage/i.test(k) && !/actual/i.test(k)) ??
    shrMeasures.find((k) => /^shrinkage_total/i.test(k)) ??
    op0.shrinkAssumption ??
    shrMeasures[0] ??
    ''
  const shrinkActualTotal =
    shrMeasures.find((k) => /actual.*total[_\s]*shrinkage/i.test(k) || /total[_\s]*shrinkage.*actual/i.test(k)) ??
    shrMeasures.find((k) => /^shrinkage_actual/i.test(k) && /total/i.test(k)) ??
    op0.shrinkActual ??
    shrMeasures[1] ??
    ''

  void op0
  void hcMeasures

  const hasAnyMetric = (k: string) =>
    Boolean(k) &&
    trendSeries.some((p) => typeof p.metrics?.[k] === 'number' && Number.isFinite(p.metrics[k] as number))

  const show = (id: ExecChartId) => visibility[id] !== false

  const showOpsMom = show('opsMomTrending')
  const showPlaceholders =
    show('sankeyDiagram') || show('radarChart') || show('funnelChart') || show('customView')

  if (!showOpsMom && !showPlaceholders) return null

  return (
    <section className="exec-charts-section" aria-label="Operations comparisons">
      <h2 className="exec-charts-section__title">Ops metrics</h2>
      {showOpsMom ? (
        <>
          <p className="exec-muted exec-charts-mom-hint">Weekly view = week-on-week. Monthly view = MoM.</p>
          <div className="exec-chart-toolbar exec-chart-toolbar--wrap" style={{ marginBottom: 10 }}>
            <span className="exec-chart-toolbar__lbl">TREND</span>
            <select
              className="exec-chart-toolbar__select"
              value={trendMode}
              onChange={(e) => setTrendMode(e.target.value as 'monthly' | 'weekly')}
            >
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          <div className="exec-charts-grid">
            {show('ahtPlannedVsActual') ? (
              ahtMeasures.length === 0 || !hasAnyMetric('aht_planned') ? (
                <PlaceholderOpsCard
                  title="AHT — Planned vs Actuals vs Cap"
                  body="No AHT planned numeric series detected in the merged model for the current Ops filters. Check that the AHT sheet week columns were parsed correctly and contain numeric values."
                />
              ) : (
                <MomDualLineCard
                  title="AHT — Planned vs Actuals vs Cap"
                  insight="AHT planned vs actuals (plus cap) over time."
                  points={trendSeries}
                  mode={trendMode}
                  // Auto enabled: prefer canonical keys from upload, allow override dropdowns.
                  chartK1={ahtPlanned}
                  chartK2={ahtActual}
                  chartK3={ahtCap}
                  sel1={ahtK1}
                  sel2={ahtK2}
                  sel3={ahtK3}
                  setSel1={setAhtK1}
                  setSel2={setAhtK2}
                  setSel3={setAhtK3}
                  measures={ahtMeasures}
                  label1="Planned"
                  label2="Actuals"
                  label3="Cap"
                />
              )
            ) : null}

            {show('attritionAssumptionVsActual') ? (
              attrMeasures.length === 0 || !hasAnyMetric(attrAssumption) ? (
                <PlaceholderOpsCard
                  title="Attrition — Assumption vs Actuals"
                  body="No Attrition numeric series detected in the merged model for the current Ops filters."
                />
              ) : (
                <MomDualLineCard
                  title="Attrition — Assumption vs Actuals"
                  insight="Attrition assumption/plan vs actuals over time."
                  points={trendSeries}
                  mode={trendMode}
                  chartK1={attrAssumption}
                  chartK2={attrActual}
                  sel1={attrK1}
                  sel2={attrK2}
                  setSel1={setAttrK1}
                  setSel2={setAttrK2}
                  measures={attrMeasures}
                  label1="Attrition Assumption"
                  label2="Actual"
                />
              )
            ) : null}

            {show('shrinkageAssumptionVsActual') ? (
              shrMeasures.length === 0 || !hasAnyMetric(shrinkTotal) ? (
                <PlaceholderOpsCard
                  title="Shrinkage — Total vs Actual total"
                  body="No Shrinkage numeric series detected in the merged model for the current Ops filters."
                />
              ) : (
                <MomDualLineCard
                  title="Shrinkage — Total vs Actual total"
                  insight="Total Shrinkage vs Actual Total Shrinkage over time."
                  points={trendSeries}
                  mode={trendMode}
                  chartK1={shrinkTotal}
                  chartK2={shrinkActualTotal}
                  label1="Total Shrinkage"
                  label2="Actual Total Shrinkage"
                  showControls={false}
                />
              )
            ) : null}

            {show('headcountRequirementVsProjection') ? (
              hcMeasures.length === 0 || !hasAnyMetric('headcount_requirement') ? (
                <PlaceholderOpsCard
                  title="Headcount — Requirement vs Projection"
                  body="No Headcount numeric series detected in the merged model for the current Ops filters."
                />
              ) : (
                <MomDualLineCard
                  title="Headcount — Requirement vs Projection"
                  insight="HC Requirement vs HC Projection over time."
                  points={trendSeries}
                  mode={trendMode}
                  // No fallback: bind to canonical keys from uploaded Headcount tab.
                  chartK1="headcount_requirement"
                  chartK2="headcount_projection"
                  label1="HC Requirement"
                  label2="HC Projection"
                  showControls={false}
                />
              )
            ) : null}
          </div>
        </>
      ) : null}

      <div className="exec-charts-grid exec-charts-grid--placeholder">
        {show('sankeyDiagram') ? (
          <PlaceholderOpsCard
            title="Sankey Diagram"
            body="Future: revenue → cost pool flows when multi-level cost tagging exists in source files."
          />
        ) : null}
        {show('radarChart') ? (
          <PlaceholderOpsCard
            title="Radar Chart"
            body="Future: normalized multi-metric client scorecard (select metrics from Customize when implemented)."
          />
        ) : null}
        {show('funnelChart') ? (
          <PlaceholderOpsCard
            title="Funnel Chart"
            body="Future: pipeline funnel when CRM or staged measures are linked in the workbook."
          />
        ) : null}
        {show('customView') ? (
          <PlaceholderOpsCard
            title="Custom View"
            body="Reserved for saved chart definitions or worksheet-linked visuals. Export chart data from any card via Expand."
          />
        ) : null}
      </div>
    </section>
  )
}

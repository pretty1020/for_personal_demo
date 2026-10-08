import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { ExecutiveUnifiedRow } from '../../types/dashboard'
import {
  availableProjectionWeeks,
  buildProjectionBridgeForWeek,
  buildProjectionRevenueWowSeries,
  buildProjectionWeeklyTrend,
  defaultProjectionWowWeeks,
  filterProjectionRows,
  formatProjectionWeekLabel,
} from '../../utils/idealProjectionWow'
import type { WaterfallSegment } from '../../utils/executiveAnalytics'
import {
  ensureMovateVarianceGradients,
  movateBridgeSegmentFill,
  MOVATE_AXIS_PINK,
  MOVATE_BRAND,
  styleMovateD3Axis,
} from '../../utils/movateTheme'
import { ExecChartCard } from './ExecChartCard'
import { useExecChartCardExpanded } from './ExecChartCardContext'
import { useExecChartSize } from './useExecChartSize'
import { formatCompact, formatPct } from './execChartFormat'
import * as d3 from 'd3'

type Props = {
  sourceRows: ExecutiveUnifiedRow[]
  clientOptions: string[]
  weekOptions: string[]
  weekStart: string
  weekEnd: string
  headerClient: string
  chartsHiddenByDefault?: boolean
}

function ProjectionWowBridgeChart({
  segments,
  title,
  subtitle,
  defaultHidden = false,
}: {
  segments: WaterfallSegment[]
  title: string
  subtitle: string
  defaultHidden?: boolean
}) {
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
      g.selectAll('text.wlab')
        .data(segments)
        .join('text')
        .attr('class', 'wlab')
        .attr('x', (d) => (x(d.label) ?? 0) + x.bandwidth() / 2)
        .attr('y', (d) => y(Math.max(d.start, d.end)) - 4)
        .attr('text-anchor', 'middle')
        .attr('font-size', 8)
        .attr('fill', MOVATE_BRAND.deep)
        .text((d) => formatCompact(d.value, true))
    }

    const xAxis = g.append('g').attr('transform', `translate(0,${ih})`).call(d3.axisBottom(x))
    xAxis
      .selectAll('text')
      .attr('transform', 'rotate(-24)')
      .style('text-anchor', 'end')
      .attr('font-size', 10)
    styleMovateD3Axis(xAxis)
    const yAxis = g.append('g').call(d3.axisLeft(y).ticks(4).tickFormat((d) => formatCompact(Number(d), true)))
    styleMovateD3Axis(yAxis)
  }, [segments, w, h, labels, wrapRef, ready])

  return (
    <ExecChartCard
      title={title}
      insight={subtitle}
      expandTitle={title}
      expandContent={
        <table className="exec-data-table">
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
      <div ref={wrapRef} className="exec-chart-host" style={{ minHeight: 260 }}>
        <svg />
        {!segments.length ? <p className="exec-muted mt-2 text-sm">No projection data for this week.</p> : null}
      </div>
    </ExecChartCard>
  )
}

function ProjectionRevenueTrendChart({
  trend,
  lwWeek,
  cwWeek,
  defaultHidden = false,
}: {
  trend: ReturnType<typeof buildProjectionWeeklyTrend>
  lwWeek: string
  cwWeek: string
  defaultHidden?: boolean
}) {
  const { wrapRef, w, h, ready } = useExecChartSize([trend, lwWeek, cwWeek])
  const [labels, setLabels] = useState(false)
  const expanded = useExecChartCardExpanded()

  useLayoutEffect(() => {
    if (!ready) return
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!trend.length) return

    const hasWeekHighlight = Boolean(lwWeek || cwWeek)
    const margin = {
      top: hasWeekHighlight ? (labels ? 44 : 38) : labels ? 28 : 22,
      right: 16,
      bottom: expanded ? 64 : 52,
      left: 56,
    }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom
    const x = d3.scalePoint().domain(trend.map((p) => p.label)).range([0, iw]).padding(0.4)
    const maxY = d3.max(trend, (p) => p.revenue) ?? 1
    const y = d3.scaleLinear().domain([0, maxY * 1.1]).nice().range([ih, 0])
    const defs = svg.append('defs')
    const glow = defs
      .append('filter')
      .attr('id', 'movate-week-glow')
      .attr('x', '-80%')
      .attr('y', '-80%')
      .attr('width', '260%')
      .attr('height', '260%')
    glow.append('feDropShadow').attr('dx', 0).attr('dy', 0).attr('stdDeviation', 3).attr('flood-color', MOVATE_BRAND.magenta).attr('flood-opacity', 0.55)

    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    const line = d3
      .line<(typeof trend)[0]>()
      .x((d) => x(d.label) ?? 0)
      .y((d) => y(d.revenue))
    g.append('path')
      .datum(trend)
      .attr('fill', 'none')
      .attr('stroke', MOVATE_BRAND.magenta)
      .attr('stroke-width', 2.4)
      .attr('opacity', 0.92)
      .attr('d', line)

    const drawHighlightedWeek = (
      cx: number,
      cy: number,
      kind: 'lw' | 'cw',
      badge: string,
      valueLabel?: string,
    ) => {
      const fill = kind === 'cw' ? MOVATE_BRAND.magenta : MOVATE_BRAND.coral
      const ring = kind === 'cw' ? MOVATE_BRAND.deep : MOVATE_BRAND.hotPink
      const outerR = expanded ? 13 : 11
      const innerR = expanded ? 7.5 : 6.5

      g.append('line')
        .attr('x1', cx)
        .attr('x2', cx)
        .attr('y1', cy)
        .attr('y2', ih)
        .attr('stroke', fill)
        .attr('stroke-width', 1.25)
        .attr('stroke-dasharray', '4 3')
        .attr('opacity', 0.35)

      g.append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', outerR + 5)
        .attr('fill', fill)
        .attr('opacity', 0.14)
        .attr('filter', 'url(#movate-week-glow)')

      g.append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', outerR)
        .attr('fill', '#fff')
        .attr('stroke', ring)
        .attr('stroke-width', 2.75)

      g.append('circle').attr('cx', cx).attr('cy', cy).attr('r', innerR).attr('fill', fill).attr('stroke', '#fff').attr('stroke-width', 1.25)

      const badgeY = cy - outerR - (valueLabel ? 22 : 14)
      g.append('rect')
        .attr('x', cx - 14)
        .attr('y', badgeY - 10)
        .attr('width', 28)
        .attr('height', 14)
        .attr('rx', 7)
        .attr('fill', fill)
      g.append('text')
        .attr('x', cx)
        .attr('y', badgeY)
        .attr('text-anchor', 'middle')
        .attr('font-size', 8)
        .attr('font-weight', 800)
        .attr('fill', '#fff')
        .text(badge)

      if (valueLabel) {
        g.append('text')
          .attr('x', cx)
          .attr('y', badgeY - 12)
          .attr('text-anchor', 'middle')
          .attr('font-size', expanded ? 10 : 9)
          .attr('font-weight', 700)
          .attr('fill', MOVATE_BRAND.deep)
          .text(valueLabel)
      }
    }

    trend.forEach((p) => {
      const cx = x(p.label) ?? 0
      const cy = y(p.revenue)
      const isLw = Boolean(lwWeek && p.week === lwWeek)
      const isCw = Boolean(cwWeek && p.week === cwWeek)
      if (isLw || isCw) return

      g.append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', 3.25)
        .attr('fill', MOVATE_BRAND.rose)
        .attr('opacity', 0.72)
    })

    trend.forEach((p) => {
      const cx = x(p.label) ?? 0
      const cy = y(p.revenue)
      const isLw = Boolean(lwWeek && p.week === lwWeek)
      const isCw = Boolean(cwWeek && p.week === cwWeek)
      if (!isLw && !isCw) return

      const valueLabel = labels ? formatCompact(p.revenue, true) : undefined
      if (isLw && isCw) {
        drawHighlightedWeek(cx, cy, 'cw', 'LW·CW', valueLabel)
        return
      }
      if (isLw) drawHighlightedWeek(cx, cy, 'lw', 'LW', valueLabel)
      if (isCw) drawHighlightedWeek(cx, cy, 'cw', 'CW', valueLabel)
    })

    const xAxis = g.append('g').attr('transform', `translate(0,${ih})`).call(d3.axisBottom(x))
    xAxis
      .selectAll('text')
      .attr('transform', 'rotate(-32)')
      .style('text-anchor', 'end')
      .attr('font-size', expanded ? 11 : 10)
    styleMovateD3Axis(xAxis)
    const yAxis = g
      .append('g')
      .call(d3.axisLeft(y).ticks(expanded ? 6 : 4).tickFormat((d) => formatCompact(Number(d), true)))
    yAxis.selectAll('text').attr('font-size', expanded ? 11 : 10)
    styleMovateD3Axis(yAxis)
  }, [trend, w, h, labels, wrapRef, expanded, lwWeek, cwWeek, ready])

  return (
    <ExecChartCard
      title="Projection revenue trend (weekly)"
      insight="Historical projection revenue by week. Highlighted points match your prior / current week selection."
      expandTitle="Projection revenue trend"
      expandContent={
        <table className="exec-data-table">
          <thead>
            <tr>
              <th>Week</th>
              <th>Revenue</th>
              <th>GM</th>
              <th>GM %</th>
            </tr>
          </thead>
          <tbody>
            {trend.map((p) => (
              <tr key={p.week}>
                <td>{p.label}</td>
                <td>{formatCompact(p.revenue, true)}</td>
                <td>{formatCompact(p.gm, true)}</td>
                <td>{p.gmPct != null ? `${p.gmPct.toFixed(1)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      showDataLabels={labels}
      onToggleLabels={setLabels}
      defaultChartHidden={defaultHidden}
    >
      <div ref={wrapRef} className="exec-chart-host" style={{ minHeight: 260 }}>
        <svg />
        <div className="exec-chart-legend exec-chart-legend--wow-weeks mt-2 flex flex-wrap gap-4 text-xs text-slate-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded" style={{ background: MOVATE_BRAND.magenta }} />
            Projection revenue
          </span>
          {lwWeek ? (
            <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: MOVATE_BRAND.coral }}>
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border-2 bg-white text-[7px] font-extrabold leading-none"
                style={{ borderColor: MOVATE_BRAND.hotPink, color: MOVATE_BRAND.coral }}
                aria-hidden
              >
                LW
              </span>
              Prior week (LW)
            </span>
          ) : null}
          {cwWeek ? (
            <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: MOVATE_BRAND.magenta }}>
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full border-2 bg-white text-[7px] font-extrabold leading-none"
                style={{ borderColor: MOVATE_BRAND.deep, color: MOVATE_BRAND.magenta }}
                aria-hidden
              >
                CW
              </span>
              Current week (CW)
            </span>
          ) : null}
        </div>
      </div>
    </ExecChartCard>
  )
}

function ProjectionWowRevenueChangeTrend({
  series,
  defaultHidden = false,
}: {
  series: ReturnType<typeof buildProjectionRevenueWowSeries>
  defaultHidden?: boolean
}) {
  const { wrapRef, w, h, ready } = useExecChartSize([series])
  const expanded = useExecChartCardExpanded()
  const [labels, setLabels] = useState(false)

  useLayoutEffect(() => {
    if (!ready) return
    const host = wrapRef.current
    if (!host) return
    const svg = d3.select(host).select<SVGSVGElement>('svg')
    svg.selectAll('*').remove()
    if (!series.length) return

    const margin = { top: labels ? 28 : 22, right: 16, bottom: expanded ? 72 : 56, left: 52 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom
    const x = d3.scalePoint().domain(series.map((p) => p.label)).range([0, iw]).padding(0.35)
    const vals = series.map((p) => p.variance)
    const y = d3
      .scaleLinear()
      .domain([Math.min(0, d3.min(vals) ?? 0), Math.max(0, (d3.max(vals) ?? 0) * 1.15)])
      .nice()
      .range([ih, 0])
    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)
    const zero = y(0)

    const line = d3
      .line<(typeof series)[0]>()
      .x((d) => x(d.label) ?? 0)
      .y((d) => y(d.variance))
    ensureMovateVarianceGradients(svg)
    g.append('path')
      .datum(series)
      .attr('fill', 'none')
      .attr('stroke', MOVATE_BRAND.magenta)
      .attr('stroke-width', 2.2)
      .attr('d', line)
    series.forEach((p) => {
      const cx = x(p.label) ?? 0
      const cy = y(p.variance)
      g.append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', 3.5)
        .attr('fill', p.variance >= 0 ? MOVATE_BRAND.magenta : MOVATE_BRAND.deep)
        .attr('stroke', '#fff')
        .attr('stroke-width', 0.75)
      if (labels) {
        g.append('text')
          .attr('x', cx)
          .attr('y', cy - 8)
          .attr('text-anchor', 'middle')
          .attr('font-size', 9)
          .attr('fill', MOVATE_BRAND.deep)
          .text(formatCompact(p.variance, true))
      }
    })
    g.append('line').attr('x1', 0).attr('x2', iw).attr('y1', zero).attr('y2', zero).attr('stroke', MOVATE_AXIS_PINK.line)
    const xAxis = g.append('g').attr('transform', `translate(0,${ih})`).call(d3.axisBottom(x))
    xAxis
      .selectAll('text')
      .attr('transform', 'rotate(-36)')
      .style('text-anchor', 'end')
      .attr('font-size', 9)
    styleMovateD3Axis(xAxis)
    const yAxis = g.append('g').call(d3.axisLeft(y).ticks(5).tickFormat((d) => formatCompact(Number(d), true)))
    styleMovateD3Axis(yAxis)
  }, [series, w, h, wrapRef, expanded, ready, labels])

  return (
    <ExecChartCard
      title="Week-on-week projection revenue change"
      insight="Each point is the change in total projection revenue versus the prior week (consecutive pairs in range)."
      expandTitle="WoW revenue change"
      expandContent={
        <table className="exec-data-table">
          <thead>
            <tr>
              <th>Week pair</th>
              <th>Revenue change</th>
              <th>Change %</th>
            </tr>
          </thead>
          <tbody>
            {series.map((p) => (
              <tr key={p.week}>
                <td>{p.label}</td>
                <td>{formatCompact(p.variance, true)}</td>
                <td>{p.variancePct != null ? formatPct(p.variancePct) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
      showDataLabels={labels}
      onToggleLabels={setLabels}
      defaultChartHidden={defaultHidden}
    >
      <div ref={wrapRef} className="exec-chart-host" style={{ minHeight: 240 }}>
        <svg />
      </div>
    </ExecChartCard>
  )
}

export function IdealProjectionWowSection({
  sourceRows,
  clientOptions,
  weekOptions,
  weekStart,
  weekEnd,
  headerClient,
  chartsHiddenByDefault = false,
}: Props) {
  const [wowClient, setWowClient] = useState(headerClient)
  const [wowSite, setWowSite] = useState('')
  const siteOptions = useMemo(() => {
    const names = new Set<string>()
    sourceRows.forEach((row) => {
      if (wowClient && (row.client_name ?? '') !== wowClient) return
      const site = row.location?.trim()
      if (site) names.add(site)
    })
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [sourceRows, wowClient])
  const activeSite = siteOptions.includes(wowSite) ? wowSite : ''
  const scopedWeeks = useMemo(() => {
    const inRange = weekOptions.filter((w) => {
      if (weekStart && w < weekStart) return false
      if (weekEnd && w > weekEnd) return false
      return true
    })
    const projWeeks = availableProjectionWeeks(
      filterProjectionRows(sourceRows, {
        client: wowClient || undefined,
        location: activeSite || undefined,
        weekStart: weekStart || undefined,
        weekEnd: weekEnd || undefined,
      }),
    )
    const pool = projWeeks.length ? projWeeks : inRange
    return pool.length ? pool : availableProjectionWeeks(sourceRows)
  }, [sourceRows, wowClient, activeSite, weekStart, weekEnd, weekOptions])

  const [lwWeek, setLwWeek] = useState('')
  const [cwWeek, setCwWeek] = useState('')

  useEffect(() => {
    setWowClient(headerClient)
  }, [headerClient])

  useEffect(() => {
    const { lwWeek: lw, cwWeek: cw } = defaultProjectionWowWeeks(scopedWeeks)
    setLwWeek(lw)
    setCwWeek(cw)
  }, [scopedWeeks.join('|')])

  const trend = useMemo(
    () =>
      buildProjectionWeeklyTrend(sourceRows, {
        client: wowClient || undefined,
        location: activeSite || undefined,
        weekStart: weekStart || undefined,
        weekEnd: weekEnd || undefined,
      }),
    [sourceRows, wowClient, activeSite, weekStart, weekEnd],
  )

  const lwBridge = useMemo(
    () => buildProjectionBridgeForWeek(sourceRows, lwWeek, wowClient || undefined, activeSite || undefined),
    [sourceRows, lwWeek, wowClient, activeSite],
  )

  const cwBridge = useMemo(
    () => buildProjectionBridgeForWeek(sourceRows, cwWeek, wowClient || undefined, activeSite || undefined),
    [sourceRows, cwWeek, wowClient, activeSite],
  )

  const revenueWowSeries = useMemo(() => buildProjectionRevenueWowSeries(trend), [trend])

  const pairLabel =
    lwWeek && cwWeek
      ? `${formatProjectionWeekLabel(lwWeek)} vs ${formatProjectionWeekLabel(cwWeek)}`
      : 'Select two weeks'

  if (!scopedWeeks.length) {
    return (
      <p className="exec-muted exec-muted--box">
        No projection weeks in the selected range. Widen the week filter or switch to sample data.
      </p>
    )
  }

  return (
    <div className="ideal-projection-wow">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="exec-filter">
          <span className="exec-filter__label">Client</span>
          <select
            className="exec-filter__select"
            value={wowClient}
            onChange={(e) => {
              setWowClient(e.target.value)
              setWowSite('')
            }}
          >
            <option value="">All clients</option>
            {clientOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="exec-filter">
          <span className="exec-filter__label">Site</span>
          <select
            className="exec-filter__select"
            value={activeSite}
            onChange={(e) => setWowSite(e.target.value)}
          >
            <option value="">All sites</option>
            {siteOptions.map((site) => (
              <option key={site} value={site}>
                {site}
              </option>
            ))}
          </select>
        </label>
        <label className="exec-filter">
          <span className="exec-filter__label">Prior week (LW)</span>
          <select className="exec-filter__select" value={lwWeek} onChange={(e) => setLwWeek(e.target.value)}>
            {scopedWeeks.map((w) => (
              <option key={w} value={w}>
                {formatProjectionWeekLabel(w)}
              </option>
            ))}
          </select>
        </label>
        <label className="exec-filter">
          <span className="exec-filter__label">Current week (CW)</span>
          <select className="exec-filter__select" value={cwWeek} onChange={(e) => setCwWeek(e.target.value)}>
            {scopedWeeks.map((w) => (
              <option key={w} value={w}>
                {formatProjectionWeekLabel(w)}
              </option>
            ))}
          </select>
        </label>
        <p className="m-0 text-xs text-slate-500">{pairLabel} · Projections scenario</p>
      </div>

      <div className="exec-charts-grid exec-charts-grid--2 mb-4">
        <ProjectionRevenueTrendChart trend={trend} lwWeek={lwWeek} cwWeek={cwWeek} defaultHidden={chartsHiddenByDefault} />
        <ProjectionWowRevenueChangeTrend series={revenueWowSeries} defaultHidden={chartsHiddenByDefault} />
      </div>

      <h3 className="ideal-scenario-section__title mb-3 text-base">Week on week — projection vs prior week (LW‑CW)</h3>
      <p className="mb-4 text-sm text-slate-600">
        Revenue → People Cost → Other Cost → GM bridge for each selected week ({pairLabel}
        {wowClient ? ` · ${wowClient}` : ' · all clients'}
        {activeSite ? ` · ${activeSite}` : ''}).
      </p>
      <div className="exec-charts-grid exec-charts-grid--2">
        <ProjectionWowBridgeChart
          segments={lwBridge}
          title={`Prior week (LW) — ${formatProjectionWeekLabel(lwWeek)}`}
          subtitle="Projection bridge: revenue through people and other cost to GM."
          defaultHidden={chartsHiddenByDefault}
        />
        <ProjectionWowBridgeChart
          segments={cwBridge}
          title={`Current week (CW) — ${formatProjectionWeekLabel(cwWeek)}`}
          subtitle="Projection bridge: revenue through people and other cost to GM."
          defaultHidden={chartsHiddenByDefault}
        />
      </div>
    </div>
  )
}

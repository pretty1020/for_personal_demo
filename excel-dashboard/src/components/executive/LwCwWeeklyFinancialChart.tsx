import { useLayoutEffect, useMemo, useState } from 'react'
import * as d3 from 'd3'
import type { SheetSnapshot } from '../../types/dashboard'
import { normalizeHeaderLabel } from '../../utils/slicerColumns'
import { tryCoerceDate } from '../../utils/inferTypes'
import { ExecChartCard } from './ExecChartCard'
import { useExecChartSize } from './useExecChartSize'
import { formatCompact } from './execChartFormat'

type Pt = { t: number; label: string; revenue: number; peopleCost: number }

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const t = v.replace(/[,$€£%\s]/g, '')
    const n = Number.parseFloat(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function parseWeekToTime(v: unknown): { t: number; label: string } | null {
  if (v == null) return null
  const d0 = tryCoerceDate(v) ?? tryCoerceDate(String(v).trim())
  if (!d0 || Number.isNaN(d0.getTime())) return null
  const t = d0.getTime()
  const label = d0.toLocaleDateString(undefined, { year: '2-digit', month: 'short', day: '2-digit' })
  return { t, label }
}

function detectColumnKey(snapshot: SheetSnapshot, re: RegExp): string | null {
  for (const c of snapshot.columns) {
    const h = normalizeHeaderLabel(c.header)
    if (re.test(h)) return c.key
  }
  return null
}

export function LwCwWeeklyFinancialChart(props: { snapshot: SheetSnapshot; weekFilter?: string }) {
  const { snapshot, weekFilter } = props
  const { wrapRef, w, h } = useExecChartSize()
  const [tip, setTip] = useState({ v: false, x: 0, y: 0, lines: [] as string[] })
  const [labels, setLabels] = useState(false)

  // LW-CW requirement: week filter comes from column A.
  const weekKey = useMemo(() => snapshot.columns[0]?.key ?? null, [snapshot])
  const revKey = useMemo(() => detectColumnKey(snapshot, /revenue|\brev\b|billings|sales/i), [snapshot])
  const pplKey = useMemo(() => detectColumnKey(snapshot, /people\s*cost|salary|payroll|wage|staff\s*cost/i), [snapshot])

  const pts = useMemo(() => {
    if (!weekKey || !revKey || !pplKey) return []
    const out: Pt[] = []
    for (const r of snapshot.rows) {
      const wt = parseWeekToTime(r[weekKey])
      if (!wt) continue
      if (weekFilter) {
        const raw = String(r[weekKey] ?? '').trim()
        if (raw !== weekFilter) continue
      }
      const revenue = toNum(r[revKey]) ?? 0
      const peopleCost = toNum(r[pplKey]) ?? 0
      if (!Number.isFinite(revenue) && !Number.isFinite(peopleCost)) continue
      out.push({ t: wt.t, label: wt.label, revenue, peopleCost })
    }
    out.sort((a, b) => a.t - b.t)
    return out.slice(-52) // keep last ~year if long
  }, [snapshot.rows, weekKey, revKey, pplKey, weekFilter])

  const insight = useMemo(() => {
    if (!weekKey) return 'No Week column detected on the LW‑CW sheet.'
    if (!revKey || !pplKey) return 'Map Revenue and People Cost columns on the LW‑CW sheet to render weekly time series.'
    return 'Weekly financial trend using the LW‑CW sheet’s Week column. Revenue and People Cost are plotted over time.'
  }, [weekKey, revKey, pplKey])

  const table = (
    <table className="exec-data-table">
      <thead>
        <tr>
          <th>Week</th>
          <th>Revenue</th>
          <th>People Cost</th>
        </tr>
      </thead>
      <tbody>
        {pts.map((p) => (
          <tr key={p.t}>
            <td>{p.label}</td>
            <td>{formatCompact(p.revenue, true)}</td>
            <td>{formatCompact(p.peopleCost, true)}</td>
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
    if (pts.length < 1) return

    const margin = { top: 18, right: 18, bottom: 34, left: 56 }
    const iw = w - margin.left - margin.right
    const ih = h - margin.top - margin.bottom

    const x = d3
      .scaleTime()
      .domain(d3.extent(pts, (d) => new Date(d.t)) as [Date, Date])
      .range([0, iw])

    const allVals = pts.flatMap((p) => [p.revenue, p.peopleCost])
    const y = d3
      .scaleLinear()
      .domain([0, (d3.max(allVals) ?? 1) * 1.06])
      .nice()
      .range([ih, 0])

    const g = svg.attr('width', w).attr('height', h).append('g').attr('transform', `translate(${margin.left},${margin.top})`)
    const colors = { revenue: '#1c1915', people: '#2c5648' }

    const line = (key: 'revenue' | 'peopleCost') =>
      d3
        .line<Pt>()
        .x((d) => x(new Date(d.t)))
        .y((d) => y(d[key]))

    if (pts.length >= 2) {
      g.append('path').datum(pts).attr('fill', 'none').attr('stroke', colors.revenue).attr('stroke-width', 1.5).attr('d', line('revenue'))
      g.append('path').datum(pts).attr('fill', 'none').attr('stroke', colors.people).attr('stroke-width', 1.5).attr('d', line('peopleCost'))
    }

    const hit = g.append('g').selectAll('circle').data(pts).join('circle')
      .attr('cx', (d) => x(new Date(d.t)))
      .attr('cy', (d) => y(d.revenue))
      .attr('r', 8)
      .attr('fill', 'transparent')
      .on('mousemove', (e: MouseEvent, d: Pt) => {
        setTip({
          v: true,
          x: e.clientX + 12,
          y: e.clientY + 12,
          lines: [d.label, `Revenue: ${formatCompact(d.revenue, true)}`, `People Cost: ${formatCompact(d.peopleCost, true)}`],
        })
      })
      .on('mouseleave', () => setTip((t) => ({ ...t, v: false })))
    void hit

    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat((v) => d3.timeFormat('%b %d')(v as Date)))
      .selectAll('text')
      .attr('font-size', '9px')
      .attr('fill', '#334155')

    g.append('g')
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => formatCompact(Number(v), true)))
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('fill', '#334155')

    const leg = g.append('g').attr('transform', `translate(${iw - 170}, 0)`)
    ;[
      { label: 'Revenue', c: colors.revenue },
      { label: 'People Cost', c: colors.people },
    ].forEach((d, i) => {
      const ly = i * 16
      leg.append('circle').attr('cx', 0).attr('cy', ly).attr('r', 5).attr('fill', d.c)
      leg.append('text').attr('x', 10).attr('y', ly).attr('dy', '0.35em').attr('font-size', '9px').attr('fill', '#334155').text(d.label)
    })

    if (labels) {
      const last = pts[pts.length - 1]!
      g.append('text').attr('x', x(new Date(last.t)) + 8).attr('y', y(last.revenue) - 4).attr('font-size', '9px').attr('fill', colors.revenue).text(formatCompact(last.revenue, true))
      g.append('text').attr('x', x(new Date(last.t)) + 8).attr('y', y(last.peopleCost) - 4).attr('font-size', '9px').attr('fill', colors.people).text(formatCompact(last.peopleCost, true))
    }
  }, [pts, w, h, labels, wrapRef])

  return (
    <ExecChartCard
      title="Weekly financial metrics (LW‑CW)"
      insight={insight}
      showDataLabels={labels}
      onToggleLabels={setLabels}
      expandTitle="Weekly financial metrics — data"
      expandContent={table}
      accent={0}
    >
      <div ref={wrapRef} className="exec-d3-wrap">
        <svg className="exec-d3-svg" />
        {tip.v ? <div className="exec-d3-tooltip" style={{ left: tip.x, top: tip.y }} role="status">{tip.lines.map((l, i) => <div key={i}>{l}</div>)}</div> : null}
      </div>
    </ExecChartCard>
  )
}


import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'

export type D3SeriesType = 'line' | 'area' | 'bar' | 'dash' | 'scatter' | 'band'

export type InteractiveD3Series = {
  id: string
  label: string
  color: string
  type: D3SeriesType
  values: Array<number | null>
  /** For `band` series: upper bound (values = lower). */
  upperValues?: Array<number | null>
  /** Optional dynamic bar fill (e.g. positive/negative gap). */
  barColor?: (value: number, index: number) => string
  /** Hide from tooltip rows (still drawn if visible). */
  hideFromTooltip?: boolean
  /** Start hidden when the chart mounts. */
  defaultHidden?: boolean
}

export type InteractiveD3ChartProps = {
  labels: string[]
  series: InteractiveD3Series[]
  height?: number
  yLabel?: string
  formatValue?: (value: number) => string
  emptyMessage?: string
  /** Initial visible window start as fraction 0–1 (for large series). */
  initialZoomStart?: number
  /** Initial visible window end as fraction 0–1. */
  initialZoomEnd?: number
  onPointClick?: (index: number) => void
  highlightIndex?: number | null
  /** Shade from this index to the end (forecast horizon). */
  futureStartIndex?: number
  ariaLabel?: string
}

type TipState = {
  visible: boolean
  x: number
  y: number
  index: number
}

const MARGIN = { top: 16, right: 18, bottom: 44, left: 56 }
const COLORS = {
  axis: '#6e675f',
  grid: '#e3dbd0',
  ink: '#1c1915',
  paper: '#f7f3ec',
  future: 'rgba(44, 86, 72, 0.07)',
}

function defaultFormat(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`
  if (Number.isInteger(value)) return String(value)
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function finiteValues(series: InteractiveD3Series[], visible: Set<string>): number[] {
  const out: number[] = []
  for (const item of series) {
    if (!visible.has(item.id)) continue
    for (const value of item.values) {
      if (value != null && Number.isFinite(value)) out.push(value)
    }
    if (item.type === 'band' && item.upperValues) {
      for (const value of item.upperValues) {
        if (value != null && Number.isFinite(value)) out.push(value)
      }
    }
  }
  return out
}

function hasAnyData(series: InteractiveD3Series[]): boolean {
  return series.some((item) =>
    item.values.some((value) => value != null && Number.isFinite(value)),
  )
}

/**
 * Shared interactive multi-series chart (D3): zoom/pan, legend toggles,
 * hover crosshair + tooltip, responsive layout, empty/single/large-data handling.
 */
export function InteractiveD3Chart({
  labels,
  series,
  height = 380,
  yLabel,
  formatValue = defaultFormat,
  emptyMessage = 'No data to chart yet.',
  initialZoomStart = 0,
  initialZoomEnd = 1,
  onPointClick,
  highlightIndex = null,
  futureStartIndex,
  ariaLabel = 'Interactive chart',
}: InteractiveD3ChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 720, h: height })
  const [tip, setTip] = useState<TipState>({ visible: false, x: 0, y: 0, index: -1 })
  const [visibleIds, setVisibleIds] = useState<Set<string>>(() => {
    const next = new Set<string>()
    for (const item of series) {
      if (!item.defaultHidden) next.add(item.id)
    }
    return next
  })
  const [range, setRange] = useState(() => ({
    start: Math.max(0, Math.min(1, initialZoomStart)),
    end: Math.max(0, Math.min(1, initialZoomEnd)),
  }))

  // Sync legend visibility when series ids change (tab/model switch).
  const seriesKey = series.map((item) => item.id).join('|')
  useEffect(() => {
    const next = new Set<string>()
    for (const item of series) {
      if (!item.defaultHidden) next.add(item.id)
    }
    setVisibleIds(next)
    // seriesKey captures id identity; series itself is intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesKey])

  // Reset / apply zoom window when data length or initial window changes.
  useEffect(() => {
    setRange({
      start: Math.max(0, Math.min(1, initialZoomStart)),
      end: Math.max(0, Math.min(1, Math.max(initialZoomStart + 0.02, initialZoomEnd))),
    })
    setTip((prev) => ({ ...prev, visible: false }))
  }, [labels.length, initialZoomStart, initialZoomEnd, seriesKey])

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const apply = () => {
      const rect = el.getBoundingClientRect()
      const w = Math.max(280, rect.width || 720)
      const h = Math.max(240, height)
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }))
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [height])

  const toggleSeries = useCallback((id: string) => {
    setVisibleIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        if (next.size <= 1) return prev
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const resetZoom = useCallback(() => {
    setRange({ start: 0, end: 1 })
  }, [])

  const pointCount = labels.length
  const empty = pointCount === 0 || !hasAnyData(series)
  const singlePoint = pointCount === 1

  useLayoutEffect(() => {
    const host = wrapRef.current
    if (!host || empty) return
    const svg = d3.select(host).select<SVGSVGElement>('svg.cap-d3-chart__svg')
    svg.selectAll('*').remove()

    const iw = size.w - MARGIN.left - MARGIN.right
    const ih = size.h - MARGIN.top - MARGIN.bottom
    if (iw < 60 || ih < 60) return

    const startIndex = Math.max(0, Math.floor(range.start * Math.max(pointCount - 1, 0)))
    const endIndex = Math.min(
      pointCount - 1,
      Math.max(startIndex, Math.ceil(range.end * Math.max(pointCount - 1, 0))),
    )
    const viewLabels = labels.slice(startIndex, endIndex + 1)
    const viewCount = viewLabels.length
    if (viewCount === 0) return

    const root = svg
      .attr('width', size.w)
      .attr('height', size.h)
      .attr('viewBox', `0 0 ${size.w} ${size.h}`)
      .append('g')
      .attr('transform', `translate(${MARGIN.left},${MARGIN.top})`)

    const defs = svg.append('defs')
    const clipId = `cap-d3-clip-${Math.random().toString(36).slice(2, 9)}`
    defs
      .append('clipPath')
      .attr('id', clipId)
      .append('rect')
      .attr('width', iw)
      .attr('height', ih)

    const x = d3
      .scaleBand<string>()
      .domain(viewLabels)
      .range([0, iw])
      .paddingInner(viewCount > 40 ? 0.12 : 0.22)
      .paddingOuter(0.06)

    const visibleSeries = series.filter((item) => visibleIds.has(item.id))
    const yValues = finiteValues(visibleSeries, visibleIds)
    const yMin = yValues.length ? Math.min(0, d3.min(yValues) ?? 0) : 0
    const yMax = yValues.length ? (d3.max(yValues) ?? 1) : 1
    const pad = yMax === yMin ? Math.abs(yMax || 1) * 0.15 : (yMax - yMin) * 0.08
    const y = d3
      .scaleLinear()
      .domain([yMin - (yMin < 0 ? pad : 0), yMax + pad])
      .nice()
      .range([ih, 0])

    // Grid
    root
      .append('g')
      .attr('class', 'cap-d3-chart__grid')
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickSize(-iw)
          .tickFormat(() => ''),
      )
      .call((g) => g.select('.domain').remove())
      .call((g) =>
        g.selectAll('line').attr('stroke', COLORS.grid).attr('stroke-width', 1),
      )

    // Future shade
    if (
      futureStartIndex != null &&
      futureStartIndex >= 0 &&
      futureStartIndex < pointCount &&
      futureStartIndex <= endIndex &&
      futureStartIndex >= startIndex
    ) {
      const local = futureStartIndex - startIndex
      const x0 = x(viewLabels[local]!) ?? 0
      root
        .append('rect')
        .attr('x', x0)
        .attr('y', 0)
        .attr('width', Math.max(0, iw - x0))
        .attr('height', ih)
        .attr('fill', COLORS.future)
        .attr('pointer-events', 'none')
    }

    const plot = root.append('g').attr('clip-path', `url(#${clipId})`)

    const barSeries = visibleSeries.filter((item) => item.type === 'bar')
    const barWidth =
      barSeries.length > 0
        ? Math.max(3, (x.bandwidth() * 0.78) / Math.max(barSeries.length, 1))
        : x.bandwidth()

    barSeries.forEach((item, barIndex) => {
      const offset =
        (x.bandwidth() - barWidth * barSeries.length) / 2 + barIndex * barWidth
      const zeros = y(0)
      plot
        .append('g')
        .selectAll('rect')
        .data(viewLabels.map((label, i) => ({ label, value: item.values[startIndex + i] ?? null, index: startIndex + i })))
        .join('rect')
        .attr('x', (d) => (x(d.label) ?? 0) + offset)
        .attr('width', Math.max(2, barWidth * 0.92))
        .attr('y', (d) => {
          if (d.value == null || !Number.isFinite(d.value)) return zeros
          return d.value >= 0 ? y(d.value) : zeros
        })
        .attr('height', (d) => {
          if (d.value == null || !Number.isFinite(d.value)) return 0
          return Math.max(0, Math.abs(y(d.value) - zeros))
        })
        .attr('rx', 0)
        .attr('fill', (d) =>
          d.value == null
            ? item.color
            : item.barColor
              ? item.barColor(d.value, d.index)
              : item.color,
        )
        .attr('opacity', 0.88)
        .attr('cursor', onPointClick ? 'pointer' : 'crosshair')
        .on('click', (_event, d) => onPointClick?.(d.index))
    })

    // Band series (confidence interval)
    visibleSeries
      .filter((item) => item.type === 'band')
      .forEach((item) => {
        const area = d3
          .area<{ label: string; lower: number; upper: number }>()
          .x((d) => (x(d.label) ?? 0) + x.bandwidth() / 2)
          .y0((d) => y(d.lower))
          .y1((d) => y(d.upper))
          .curve(d3.curveMonotoneX)
        const bandData = viewLabels
          .map((label, i) => {
            const lower = item.values[startIndex + i]
            const upper = item.upperValues?.[startIndex + i]
            if (lower == null || upper == null || !Number.isFinite(lower) || !Number.isFinite(upper)) {
              return null
            }
            return { label, lower, upper }
          })
          .filter((d): d is { label: string; lower: number; upper: number } => d != null)
        if (bandData.length < 2) return
        plot
          .append('path')
          .datum(bandData)
          .attr('fill', item.color)
          .attr('opacity', 0.22)
          .attr('d', area)
          .attr('pointer-events', 'none')
      })

    // Line / area / dash
    visibleSeries
      .filter((item) => item.type === 'line' || item.type === 'area' || item.type === 'dash')
      .forEach((item) => {
        type Pt = { label: string; value: number; index: number }
        const points: Pt[] = []
        viewLabels.forEach((label, i) => {
          const value = item.values[startIndex + i]
          if (value == null || !Number.isFinite(value)) return
          points.push({ label, value, index: startIndex + i })
        })

        const line = d3
          .line<Pt>()
          .x((d) => (x(d.label) ?? 0) + x.bandwidth() / 2)
          .y((d) => y(d.value))
          .curve(d3.curveMonotoneX)

        if (item.type === 'area' && points.length >= 2) {
          const area = d3
            .area<Pt>()
            .x((d) => (x(d.label) ?? 0) + x.bandwidth() / 2)
            .y0(ih)
            .y1((d) => y(d.value))
            .curve(d3.curveMonotoneX)
          const gradId = `cap-d3-area-${item.id}-${clipId}`
          const grad = defs
            .append('linearGradient')
            .attr('id', gradId)
            .attr('x1', '0')
            .attr('x2', '0')
            .attr('y1', '0')
            .attr('y2', '1')
          grad.append('stop').attr('offset', '0%').attr('stop-color', item.color).attr('stop-opacity', 0.28)
          grad.append('stop').attr('offset', '100%').attr('stop-color', item.color).attr('stop-opacity', 0.02)
          plot
            .append('path')
            .datum(points)
            .attr('fill', `url(#${gradId})`)
            .attr('d', area)
            .attr('pointer-events', 'none')
        }

        if (points.length >= 2) {
          const path = plot
            .append('path')
            .datum(points)
            .attr('fill', 'none')
            .attr('stroke', item.color)
            .attr('stroke-width', item.type === 'dash' ? 1.25 : 1.5)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round')
            .attr('stroke-dasharray', item.type === 'dash' ? '7 5' : null)
            .attr('d', line)
            .attr('pointer-events', 'none')

          const total = path.node()?.getTotalLength() ?? 0
          if (total > 0 && viewCount <= 120) {
            path
              .attr('stroke-dasharray', `${total} ${total}`)
              .attr('stroke-dashoffset', total)
              .transition()
              .duration(650)
              .ease(d3.easeCubicOut)
              .attr('stroke-dashoffset', 0)
              .on('end', function onDrawEnd() {
                if (item.type === 'dash') {
                  d3.select(this).attr('stroke-dasharray', '7 5')
                } else {
                  d3.select(this).attr('stroke-dasharray', null)
                }
              })
          }
        }

        const showDots = singlePoint || points.length <= 28 || highlightIndex != null
        if (showDots || points.length === 1) {
          plot
            .append('g')
            .selectAll('circle')
            .data(points)
            .join('circle')
            .attr('cx', (d) => (x(d.label) ?? 0) + x.bandwidth() / 2)
            .attr('cy', (d) => y(d.value))
            .attr('r', (d) => (highlightIndex === d.index ? 4.5 : singlePoint ? 5 : 2.75))
            .attr('fill', item.color)
            .attr('stroke', COLORS.paper)
            .attr('stroke-width', 1)
            .attr('pointer-events', 'none')
        }
      })

    // Scatter
    visibleSeries
      .filter((item) => item.type === 'scatter')
      .forEach((item) => {
        const points = viewLabels
          .map((label, i) => {
            const value = item.values[startIndex + i]
            if (value == null || !Number.isFinite(value)) return null
            return { label, value, index: startIndex + i }
          })
          .filter((d): d is { label: string; value: number; index: number } => d != null)
        plot
          .append('g')
          .selectAll('circle')
          .data(points)
          .join('circle')
          .attr('cx', (d) => (x(d.label) ?? 0) + x.bandwidth() / 2)
          .attr('cy', (d) => y(d.value))
          .attr('r', 4)
          .attr('fill', item.color)
          .attr('stroke', COLORS.paper)
          .attr('stroke-width', 1)
          .attr('pointer-events', 'none')
      })

    // Highlight guide
    if (highlightIndex != null && highlightIndex >= startIndex && highlightIndex <= endIndex) {
      const label = labels[highlightIndex]!
      const cx = (x(label) ?? 0) + x.bandwidth() / 2
      root
        .append('line')
        .attr('x1', cx)
        .attr('x2', cx)
        .attr('y1', 0)
        .attr('y2', ih)
        .attr('stroke', COLORS.ink)
        .attr('stroke-opacity', 0.18)
        .attr('stroke-dasharray', '4 4')
        .attr('pointer-events', 'none')
    }

    // Axes
    const tickStep = viewCount > 24 ? Math.ceil(viewCount / 10) : viewCount > 14 ? 2 : 1
    const xAxis = root
      .append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(viewLabels.filter((_, i) => i % tickStep === 0))
          .tickSizeOuter(0),
      )
    xAxis.select('.domain').attr('stroke', COLORS.ink)
    xAxis.selectAll('line').attr('stroke', COLORS.ink)
    xAxis
      .selectAll('text')
      .attr('font-size', '10px')
      .attr('font-weight', '400')
      .attr('fill', COLORS.axis)
      .style('font-family', 'IBM Plex Sans, sans-serif')
      .attr('transform', viewCount > 16 ? 'rotate(-28)' : null)
      .style('text-anchor', viewCount > 16 ? 'end' : 'middle')

    const yAxis = root.append('g').call(
      d3
        .axisLeft(y)
        .ticks(5)
        .tickFormat((v) => formatValue(Number(v))),
    )
    yAxis.select('.domain').attr('stroke', COLORS.ink)
    yAxis.selectAll('line').attr('stroke', COLORS.ink)
    yAxis.selectAll('text').attr('font-size', '11px').attr('fill', COLORS.axis).style('font-family', 'IBM Plex Sans, sans-serif')

    if (yLabel) {
      root
        .append('text')
        .attr('transform', 'rotate(-90)')
        .attr('x', -ih / 2)
        .attr('y', -44)
        .attr('text-anchor', 'middle')
        .attr('font-size', '10px')
        .attr('font-weight', '700')
        .attr('fill', COLORS.axis)
        .text(yLabel)
    }

    // Hover overlay
    const hoverLine = root
      .append('line')
      .attr('y1', 0)
      .attr('y2', ih)
      .attr('stroke', COLORS.ink)
      .attr('stroke-opacity', 0)
      .attr('stroke-width', 1)
      .attr('pointer-events', 'none')

    const nearestIndex = (mx: number) => {
      let best = 0
      let bestDist = Infinity
      viewLabels.forEach((label, i) => {
        const cx = (x(label) ?? 0) + x.bandwidth() / 2
        const dist = Math.abs(cx - mx)
        if (dist < bestDist) {
          bestDist = dist
          best = i
        }
      })
      return best
    }

    const hit = root
      .append('rect')
      .attr('width', iw)
      .attr('height', ih)
      .attr('fill', 'transparent')
      .attr('cursor', 'crosshair')
      .on('mousemove', (event: MouseEvent) => {
        const [mx] = d3.pointer(event)
        const best = nearestIndex(mx)
        const index = startIndex + best
        const cx = (x(viewLabels[best]!) ?? 0) + x.bandwidth() / 2
        hoverLine.attr('x1', cx).attr('x2', cx).attr('stroke-opacity', 0.35)
        setTip({
          visible: true,
          x: event.clientX + 14,
          y: event.clientY + 14,
          index,
        })
      })
      .on('mouseleave', () => {
        hoverLine.attr('stroke-opacity', 0)
        setTip((prev) => ({ ...prev, visible: false }))
      })
      .on('click', (event: MouseEvent) => {
        if (!onPointClick) return
        const [mx] = d3.pointer(event)
        onPointClick(startIndex + nearestIndex(mx))
      })

    // Wheel zoom needs a non-passive listener so preventDefault works in Chrome.
    const hitNode = hit.node()
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const [mx] = d3.pointer(event, hitNode)
      setRange((prev) => {
        const span = Math.max(0.04, prev.end - prev.start)
        const delta = event.deltaY > 0 ? 1.12 : 0.88
        const nextSpan = Math.min(1, Math.max(0.04, span * delta))
        const center = prev.start + (Math.max(0, Math.min(iw, mx)) / Math.max(iw, 1)) * span
        let start = center - nextSpan / 2
        let end = center + nextSpan / 2
        if (start < 0) {
          end -= start
          start = 0
        }
        if (end > 1) {
          start -= end - 1
          end = 1
        }
        return { start: Math.max(0, start), end: Math.min(1, end) }
      })
    }
    if (hitNode) hitNode.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      if (hitNode) hitNode.removeEventListener('wheel', onWheel)
    }
  }, [
    empty,
    formatValue,
    futureStartIndex,
    highlightIndex,
    labels,
    onPointClick,
    pointCount,
    range.end,
    range.start,
    series,
    singlePoint,
    size.h,
    size.w,
    visibleIds,
    yLabel,
  ])

  const tipRows = useMemo(() => {
    if (!tip.visible || tip.index < 0 || tip.index >= labels.length) return []
    return series
      .filter((item) => visibleIds.has(item.id) && !item.hideFromTooltip)
      .map((item) => {
        if (item.type === 'band') {
          const lower = item.values[tip.index]
          const upper = item.upperValues?.[tip.index]
          if (lower == null || upper == null) return null
          return {
            id: item.id,
            label: item.label,
            color: item.color,
            text: `${formatValue(lower)} – ${formatValue(upper)}`,
          }
        }
        const value = item.values[tip.index]
        if (value == null || !Number.isFinite(value)) return null
        return {
          id: item.id,
          label: item.label,
          color: item.color,
          text: formatValue(value),
        }
      })
      .filter((row): row is { id: string; label: string; color: string; text: string } => row != null)
  }, [formatValue, labels.length, series, tip.index, tip.visible, visibleIds])

  const onSliderChange = (edge: 'start' | 'end', raw: number) => {
    const value = Math.max(0, Math.min(1, raw / 100))
    setRange((prev) => {
      if (edge === 'start') {
        return { start: Math.min(value, prev.end - 0.04), end: prev.end }
      }
      return { start: prev.start, end: Math.max(value, prev.start + 0.04) }
    })
  }

  return (
    <div className="cap-d3-chart" aria-label={ariaLabel}>
      <div className="cap-d3-chart__legend" role="group" aria-label="Series legend">
        {series.map((item) => {
          const active = visibleIds.has(item.id)
          return (
            <button
              key={item.id}
              type="button"
              className={`cap-d3-chart__legend-btn${active ? ' is-active' : ''}`}
              aria-pressed={active}
              onClick={() => toggleSeries(item.id)}
              title={active ? `Hide ${item.label}` : `Show ${item.label}`}
            >
              <span className="cap-d3-chart__swatch" style={{ background: item.color }} />
              {item.label}
            </button>
          )
        })}
        <button type="button" className="cap-d3-chart__reset" onClick={resetZoom} title="Reset zoom">
          Reset zoom
        </button>
      </div>

      <div ref={wrapRef} className="cap-d3-chart__body">
        {empty ? (
          <p className="cap-d3-chart__empty">{emptyMessage}</p>
        ) : (
          <svg className="cap-d3-chart__svg" role="img" aria-label={ariaLabel} />
        )}
        {tip.visible && tipRows.length > 0 ? (
          <div className="cap-d3-chart__tooltip" style={{ left: tip.x, top: tip.y }} role="status">
            <strong>{labels[tip.index]}</strong>
            {tipRows.map((row) => (
              <div key={row.id} className="cap-d3-chart__tooltip-row">
                <span className="cap-d3-chart__swatch" style={{ background: row.color }} />
                <span>{row.label}</span>
                <em>{row.text}</em>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {!empty && pointCount > 8 ? (
        <div className="cap-d3-chart__zoom" aria-label="Zoom window">
          <label>
            <span>From</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(range.start * 100)}
              onChange={(event) => onSliderChange('start', Number(event.target.value))}
            />
          </label>
          <label>
            <span>To</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(range.end * 100)}
              onChange={(event) => onSliderChange('end', Number(event.target.value))}
            />
          </label>
          <span className="cap-d3-chart__zoom-hint">Scroll to zoom · drag sliders to pan window</span>
        </div>
      ) : null}
    </div>
  )
}

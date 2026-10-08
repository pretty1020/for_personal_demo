import type { Selection } from 'd3-selection'

/** Movate brand palette for charts and UI accents. */
export const MOVATE = {
  indigo: '#4B0082',
  violet: '#9333EA',
  magenta: '#DB2777',
  orange: '#EA580C',
  gold: '#FFA500',
  red: '#FF0033',
} as const

/** Banner gradient: warm coral (left) → deep magenta (right). */
export const MOVATE_BRAND = {
  coral: '#FF6B8B',
  rose: '#F472B6',
  pink: '#EC4899',
  magenta: '#E91E63',
  hotPink: '#FF1493',
  deep: '#BE185D',
  blush: '#FBCFE8',
} as const

export const MOVATE_CHART_SERIES = [
  MOVATE_BRAND.coral,
  MOVATE_BRAND.rose,
  MOVATE_BRAND.pink,
  MOVATE_BRAND.magenta,
  MOVATE_BRAND.hotPink,
] as const

/** Favorable / positive variance bars */
export const MOVATE_POSITIVE = MOVATE_BRAND.magenta

/** Unfavorable / negative variance bars */
export const MOVATE_NEGATIVE = MOVATE_BRAND.deep

export const MOVATE_AXIS = {
  label: '#5b21b6',
  line: '#c4b5fd',
  split: 'rgba(147, 51, 234, 0.15)',
} as const

/** Axis styling for coral–magenta chart sections. */
export const MOVATE_AXIS_PINK = {
  label: '#9D174D',
  line: '#f9a8d4',
  split: 'rgba(233, 30, 99, 0.14)',
} as const

const GRAD_POS_ID = 'movate-var-pos'
const GRAD_NEG_ID = 'movate-var-neg'
const GRAD_BAR_ID = 'movate-bar-fill'

/** Vertical bar gradient (coral → magenta → deep) for ECharts. */
export function movateEchartsBarGradient() {
  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: MOVATE_BRAND.coral },
      { offset: 0.5, color: MOVATE_BRAND.magenta },
      { offset: 1, color: MOVATE_BRAND.deep },
    ],
  }
}

/** Area fill under line charts (coral fade). */
export function movateEchartsAreaGradient() {
  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: MOVATE_BRAND.coral },
      { offset: 1, color: 'rgba(233, 30, 99, 0.06)' },
    ],
  }
}

/** Per-driver leakage bar colors across the brand spectrum. */
export const MOVATE_LEAKAGE_DRIVER_COLORS = [
  MOVATE_BRAND.coral,
  MOVATE_BRAND.rose,
  MOVATE_BRAND.pink,
  MOVATE_BRAND.magenta,
  MOVATE_BRAND.deep,
] as const

type SvgSelection = Selection<SVGSVGElement, unknown, null, undefined>

/** SVG defs for positive / negative variance bars (D3). */
export function ensureMovateVarianceGradients(svg: SvgSelection): void {
  let defs = svg.select<SVGDefsElement>('defs')
  if (defs.empty()) defs = svg.append('defs')

  const pos = defs.select<SVGLinearGradientElement>(`#${GRAD_POS_ID}`)
  if (pos.empty()) {
    const g = defs
      .append('linearGradient')
      .attr('id', GRAD_POS_ID)
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%')
    g.append('stop').attr('offset', '0%').attr('stop-color', MOVATE_BRAND.coral)
    g.append('stop').attr('offset', '100%').attr('stop-color', MOVATE_BRAND.magenta)
  }

  const neg = defs.select<SVGLinearGradientElement>(`#${GRAD_NEG_ID}`)
  if (neg.empty()) {
    const g = defs
      .append('linearGradient')
      .attr('id', GRAD_NEG_ID)
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%')
    g.append('stop').attr('offset', '0%').attr('stop-color', MOVATE_BRAND.pink)
    g.append('stop').attr('offset', '100%').attr('stop-color', MOVATE_BRAND.deep)
  }
}

export function movateVarianceFillPositive(): string {
  return `url(#${GRAD_POS_ID})`
}

export function movateVarianceFillNegative(): string {
  return `url(#${GRAD_NEG_ID})`
}

/** Single bar gradient for waterfall totals / neutral steps. */
export function ensureMovateBarGradient(svg: SvgSelection): void {
  let defs = svg.select<SVGDefsElement>('defs')
  if (defs.empty()) defs = svg.append('defs')

  const bar = defs.select<SVGLinearGradientElement>(`#${GRAD_BAR_ID}`)
  if (bar.empty()) {
    const g = defs
      .append('linearGradient')
      .attr('id', GRAD_BAR_ID)
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%')
    g.append('stop').attr('offset', '0%').attr('stop-color', MOVATE_BRAND.coral)
    g.append('stop').attr('offset', '55%').attr('stop-color', MOVATE_BRAND.magenta)
    g.append('stop').attr('offset', '100%').attr('stop-color', MOVATE_BRAND.deep)
  }
}

export function movateBarFill(): string {
  return `url(#${GRAD_BAR_ID})`
}

/** Waterfall / bridge segment fill by kind. */
export function movateBridgeSegmentFill(d: { kind: string; label: string }): string {
  if (d.kind === 'negative') return MOVATE_BRAND.deep
  if (d.kind === 'positive') return MOVATE_BRAND.magenta
  if (d.label === 'GM' || d.label.includes('GM')) return MOVATE_BRAND.hotPink
  return MOVATE_BRAND.coral
}

export function styleMovateD3Axis(g: Selection<SVGGElement, unknown, null, undefined>): void {
  g.selectAll('text').attr('fill', MOVATE_AXIS_PINK.label)
  g.selectAll('.domain, .tick line').attr('stroke', MOVATE_AXIS_PINK.line)
}

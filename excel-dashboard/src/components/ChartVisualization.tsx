import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import type { ChartDraft, SheetSnapshot } from '../types/dashboard'
import { buildChartSeries } from '../utils/aggregateChart'

const PALETTE = [
  '#818cf8',
  '#38bdf8',
  '#a78bfa',
  '#34d399',
  '#f472b6',
  '#60a5fa',
  '#c084fc',
  '#2dd4bf',
  '#fb923c',
  '#fbbf24',
]

const AXIS = '#94a3b8'
const SPLIT = 'rgba(148, 163, 184, 0.2)'

type ChartLike = Pick<
  ChartDraft,
  | 'chartType'
  | 'xColumn'
  | 'yColumn'
  | 'categoryColumn'
  | 'sizeColumn'
  | 'aggregation'
  | 'filters'
  | 'showDataLabels'
  | 'includePivotTotalRows'
>

function buildEChartsOption(
  snapshot: SheetSnapshot,
  draft: ChartLike,
  externalFilters?: ChartDraft['filters'],
  title?: string,
): { option: EChartsOption | null; error?: string; empty?: boolean } {
  const mergedFilters = { ...(externalFilters ?? {}), ...(draft.filters ?? {}) }
  const series = buildChartSeries({
    snapshot,
    filters: mergedFilters,
    chartType: draft.chartType,
    xKey: draft.xColumn,
    yKey: draft.yColumn,
    categoryKey: draft.categoryColumn || undefined,
    sizeKey:
      draft.chartType === 'bubble' ? draft.sizeColumn || undefined : undefined,
    aggregation: draft.aggregation,
    includePivotTotalRows: draft.includePivotTotalRows ?? false,
  })

  if (series.error) return { option: null, error: series.error }
  if (series.data.length === 0) return { option: null, empty: true }

  const baseTitle = title
    ? {
        text: title,
        left: 'center',
        top: 8,
        textStyle: { color: '#e2e8f0', fontSize: 14, fontWeight: 700 },
      }
    : undefined

  const tooltipDark = {
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    borderColor: 'rgba(148, 163, 184, 0.35)',
    textStyle: { color: '#e2e8f0' },
  }

  const scatterLike = draft.chartType === 'scatter' || draft.chartType === 'bubble'
  if (scatterLike) {
    const bubble = draft.chartType === 'bubble'
    const data = series.data.map((d) => {
      const x = d.x as number
      const y = d.y as number
      const z = (d.z as number) ?? 12
      return bubble ? ([x, y, z] as [number, number, number]) : ([x, y] as [number, number])
    })
    return {
      option: {
        ...(baseTitle ? { title: baseTitle } : {}),
        color: PALETTE,
        tooltip: {
          ...tooltipDark,
          trigger: 'item',
        },
        grid: { left: 52, right: 28, top: title ? 48 : 28, bottom: 40 },
        xAxis: {
          type: 'value',
          name: draft.xColumn,
          nameTextStyle: { color: AXIS },
          axisLabel: { color: AXIS },
          splitLine: { lineStyle: { color: SPLIT } },
        },
        yAxis: {
          type: 'value',
          name: draft.yColumn,
          nameTextStyle: { color: AXIS },
          axisLabel: { color: AXIS },
          splitLine: { lineStyle: { color: SPLIT } },
        },
        series: [
          {
            type: 'scatter',
            symbolSize: bubble
              ? (val: number[]) => Math.min(64, 12 + Math.sqrt(Math.max(val[2] ?? 8, 0)) * 3.2)
              : 10,
            data,
            itemStyle: { color: PALETTE[0] },
            emphasis: { focus: 'series' as const },
            label: {
              show: draft.showDataLabels,
              color: '#e2e8f0',
              fontSize: 10,
              formatter: bubble
                ? (p: { value?: unknown }) => {
                    const arr = Array.isArray(p.value) ? p.value : []
                    return `${arr[0] ?? ''}, ${arr[1] ?? ''}`
                  }
                : undefined,
            },
          },
        ],
      },
    }
  }

  if (draft.chartType === 'pie' || draft.chartType === 'donut') {
    const outer = '72%'
    return {
      option: {
        ...(baseTitle ? { title: baseTitle } : {}),
        color: PALETTE,
        tooltip: { ...tooltipDark, trigger: 'item' },
        legend: {
          bottom: 4,
          textStyle: { color: AXIS },
          type: 'scroll',
        },
        series: [
          {
            type: 'pie',
            radius: draft.chartType === 'donut' ? ['42%', `${outer}`] : `${outer}`,
            avoidLabelOverlap: true,
            itemStyle: { borderRadius: 0, borderColor: '#1c1915', borderWidth: 1 },
            label: { color: '#cbd5e1', show: draft.showDataLabels },
            data: series.data.map((d, i) => ({
              name: String(d.name),
              value: d.value,
              itemStyle: { color: PALETTE[i % PALETTE.length] },
            })),
          },
        ],
      },
    }
  }

  const categories = series.data.map((d) => String(d.name))
  const keys: string[] =
    draft.categoryColumn && series.seriesKeys?.length
      ? series.seriesKeys.map(String)
      : ['value']

  const isBar = draft.chartType === 'bar'
  const isArea = draft.chartType === 'area'
  const isLine = draft.chartType === 'line'

  const ecType = isBar ? 'bar' : 'line'

  const multi = Boolean(draft.categoryColumn && series.seriesKeys?.length)

  const seriesList = multi
    ? keys.map((k, i) => ({
        name: k,
        type: ecType as 'bar' | 'line',
        stack: isArea ? 'total' : undefined,
        data: series.data.map((row) => Number(row[k] ?? 0)),
        itemStyle: { color: PALETTE[i % PALETTE.length] },
        lineStyle: {
          width: isLine || isArea ? 2.5 : undefined,
        },
        smooth: isLine || isArea,
        label: { show: draft.showDataLabels, color: '#e2e8f0', fontSize: 10 },
        areaStyle: isArea
          ? {
              opacity: 0.18,
              color: PALETTE[i % PALETTE.length],
            }
          : undefined,
      }))
    : [
        {
          name: draft.yColumn,
          type: ecType as 'bar' | 'line',
          data: series.data.map((d) => d.value),
          itemStyle: { color: PALETTE[0] },
          lineStyle: { width: isLine || isArea ? 3 : undefined },
          smooth: isLine || isArea,
          label: { show: draft.showDataLabels, color: '#e2e8f0', fontSize: 10 },
          areaStyle: isArea ? { opacity: 0.15, color: PALETTE[0] } : undefined,
        },
      ]

  return {
    option: {
      ...(baseTitle ? { title: baseTitle } : {}),
      color: PALETTE,
      tooltip: {
        ...tooltipDark,
        trigger: 'axis',
      },
      legend:
        multi && keys.length > 0
          ? { data: keys, bottom: 0, textStyle: { color: AXIS }, type: 'scroll' }
          : { show: false },
      grid: {
        left: 48,
        right: 24,
        top: title ? 44 : 28,
        bottom: multi && keys.length > 1 ? 56 : 36,
      },
      xAxis: {
        type: 'category',
        data: categories,
        axisLabel: { color: AXIS, rotate: categories.length > 14 ? 35 : 0 },
        axisLine: { lineStyle: { color: SPLIT } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: AXIS },
        splitLine: { lineStyle: { color: SPLIT } },
      },
      series: seriesList as EChartsOption['series'],
    },
  }
}

export function ChartVisualization(props: {
  snapshot: SheetSnapshot
  draft: ChartLike
  externalFilters?: ChartDraft['filters']
  /** Optional taller charts on dashboard tiles */
  height?: number
  title?: string
}) {
  const { snapshot, draft, externalFilters, height = 340, title } = props

  const built = useMemo(() => buildEChartsOption(snapshot, draft, externalFilters, title), [
    snapshot,
    draft.aggregation,
    draft.categoryColumn,
    draft.chartType,
    draft.filters,
    externalFilters,
    draft.sizeColumn,
    draft.xColumn,
    draft.yColumn,
    draft,
    title,
  ])

  if (built.error) {
    return (
      <div className="chart-fallback">
        <p className="chart-fallback-title">{title ?? 'Chart'}</p>
        <p className="muted">{built.error}</p>
      </div>
    )
  }

  if (built.empty || !built.option) {
    return (
      <div className="chart-fallback">
        <p className="chart-fallback-title">{title ?? 'Chart'}</p>
        <p className="muted">Not enough structured data yet for this configuration.</p>
      </div>
    )
  }

  return (
    <div className="chart-shell">
      <div className="chart-body" style={{ minHeight: height }}>
        <ReactECharts theme="ledger"
          option={built.option}
          style={{ height, width: '100%' }}
          notMerge
          lazyUpdate
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </div>
  )
}

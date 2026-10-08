import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import {
  formatFiscalMonthLabel,
  sumCostLinesWeekly,
  type RevenueProjectionClientCombinedMonth,
  type RevenueProjectionLobLine,
} from '../../planner/revenueProjections/revenueProjectionPersistence'
import { fmtCurrency } from '../../planner/format'
import { withModernChartLook } from '../../utils/echartsCompact'

const COLORS = {
  revenue: '#1c1915',
  cost: '#9a6b2f',
  margin: '#2c5648',
  gmPct: '#8c7348',
  salary: '#4d6b5e',
  opex: '#6e675f',
  labor: '#1c1915',
  axis: '#6e675f',
  grid: '#e3dbd0',
} as const

function compactMoney(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}k`
  return `$${Math.round(value)}`
}

type Props = {
  months: string[]
  combined: RevenueProjectionClientCombinedMonth[]
  lines: RevenueProjectionLobLine[]
}

/** Monthly revenue / cost / GM charts for the Revenue Projections page. */
export function RevenueProjectionCharts({ months, combined, lines }: Props) {
  const [view, setView] = useState<'trend' | 'gm' | 'costMix'>('trend')

  const hasData = combined.some((row) => row.totalRevenue !== 0 || row.totalCost !== 0)

  const costMix = useMemo(() => {
    const bucket = new Map<string, number>()
    for (const line of lines) {
      const weekly = sumCostLinesWeekly(line.costLines)
      for (const row of weekly.byCategory) {
        bucket.set(row.category, (bucket.get(row.category) ?? 0) + row.amountUsd)
      }
      const support = Math.max(0, line.defaults.supportSalaryUsd)
      const other = Math.max(0, line.defaults.otherCostUsd)
      if (support > 0) bucket.set('Support', (bucket.get('Support') ?? 0) + support)
      if (other > 0) bucket.set('Other cost', (bucket.get('Other cost') ?? 0) + other)
    }
    const slices = [...bucket.entries()]
      .map(([name, value]) => ({ name, value }))
      .filter((slice) => slice.value > 0)
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    const total = slices.reduce((sum, slice) => sum + slice.value, 0)
    return { slices, total }
  }, [lines])

  const trendOption: EChartsOption = useMemo(() => {
    const labels = months.map((month) => formatFiscalMonthLabel(month))
    const revenue = combined.map((row) => row.totalRevenue)
    const cost = combined.map((row) => row.totalCost)
    const margin = combined.map((row) => row.grossMargin)

    return {
      animationDuration: 700,
      animationEasing: 'cubicOut',
      color: [COLORS.revenue, COLORS.cost, COLORS.margin],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', crossStyle: { color: 'rgba(11,42,74,0.25)' } },
        backgroundColor: 'rgba(28, 25, 21, 0.94)',
        borderWidth: 0,
        padding: [12, 14],
        textStyle: { color: '#f8fafc', fontSize: 12 },
        extraCssText: 'border-radius:12px;box-shadow:0 16px 40px rgba(11,42,74,0.28);',
        formatter: (params: unknown) => {
          const rows = (Array.isArray(params) ? params : [params]) as Array<{
            axisValue?: string
            seriesName?: string
            value?: number
            marker?: string
          }>
          const period = rows[0]?.axisValue ?? ''
          const linesHtml = rows
            .filter((row) => row.value != null && Number.isFinite(Number(row.value)))
            .map((row) => `${row.marker ?? ''} ${row.seriesName}: <b>${fmtCurrency(Number(row.value))}</b>`)
          return `<div style="font-weight:700;margin-bottom:8px">${period}</div>${linesHtml.join('<br/>')}`
        },
      },
      legend: {
        top: 4,
        left: 'center',
        itemWidth: 16,
        itemHeight: 8,
        textStyle: { color: COLORS.axis, fontSize: 11, fontWeight: 600 },
      },
      grid: { left: 52, right: 18, top: 44, bottom: 36 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: COLORS.axis, fontSize: 10, fontWeight: 600, hideOverlap: true },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: COLORS.axis, fontSize: 11, formatter: compactMoney },
        splitLine: { lineStyle: { color: COLORS.grid, type: 'solid' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          name: 'Revenue',
          type: 'bar',
          barMaxWidth: 22,
          itemStyle: {
            borderRadius: 0,
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: '#4d6b5e' },
                { offset: 1, color: '#1c1915' },
              ],
            },
          },
          data: revenue,
        },
        {
          name: 'Cost',
          type: 'bar',
          barMaxWidth: 22,
          itemStyle: {
            borderRadius: 0,
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: '#fb923c' },
                { offset: 1, color: '#c2410c' },
              ],
            },
          },
          data: cost,
        },
        {
          name: 'Gross margin',
          type: 'line',
          smooth: 0.35,
          symbol: 'circle',
          symbolSize: 7,
          lineStyle: { width: 3, color: COLORS.margin },
          itemStyle: { color: COLORS.margin, borderColor: '#fff', borderWidth: 2 },
          data: margin,
        },
      ],
    } as EChartsOption
  }, [combined, months])

  const gmOption: EChartsOption = useMemo(() => {
    const labels = months.map((month) => formatFiscalMonthLabel(month))
    const gmPct = combined.map((row) => (row.gmPct == null ? null : Math.round(row.gmPct * 10) / 10))
    const margin = combined.map((row) => row.grossMargin)

    return {
      animationDuration: 700,
      color: [COLORS.margin, COLORS.gmPct],
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(28, 25, 21, 0.94)',
        borderWidth: 0,
        textStyle: { color: '#f8fafc' },
        extraCssText: 'border-radius:12px;box-shadow:0 16px 40px rgba(11,42,74,0.28);',
      },
      legend: {
        top: 4,
        left: 'center',
        textStyle: { color: COLORS.axis, fontSize: 11, fontWeight: 600 },
      },
      grid: { left: 52, right: 48, top: 44, bottom: 36 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: COLORS.axis, fontSize: 10, fontWeight: 600, hideOverlap: true },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: 'GM $',
          axisLabel: { color: COLORS.axis, formatter: compactMoney },
          splitLine: { lineStyle: { color: COLORS.grid, type: 'solid' } },
        },
        {
          type: 'value',
          name: 'GM %',
          axisLabel: { color: COLORS.axis, formatter: (v: number) => `${v}%` },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Gross margin $',
          type: 'bar',
          barMaxWidth: 26,
          itemStyle: {
            borderRadius: 0,
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(143, 198, 61, 0.95)' },
                { offset: 1, color: 'rgba(143, 198, 61, 0.35)' },
              ],
            },
          },
          data: margin,
        },
        {
          name: 'GM %',
          type: 'line',
          yAxisIndex: 1,
          smooth: 0.4,
          symbolSize: 8,
          lineStyle: { width: 3, color: COLORS.gmPct },
          itemStyle: { color: COLORS.gmPct },
          data: gmPct,
        },
      ],
    } as EChartsOption
  }, [combined, months])

  const costMixOption: EChartsOption = useMemo(() => {
    const slices = costMix.slices

    if (slices.length === 0) {
      return {
        title: {
          text: 'Add cost lines (any category) to see the mix',
          left: 'center',
          top: 'middle',
          textStyle: { color: COLORS.axis, fontSize: 13, fontWeight: 500 },
        },
      } as EChartsOption
    }

    const palette = [
      COLORS.salary,
      COLORS.opex,
      COLORS.gmPct,
      COLORS.margin,
      COLORS.labor,
      '#9a6b2f',
      '#6e675f',
      '#3d4f46',
    ]

    return {
      color: palette,
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(28, 25, 21, 0.94)',
        borderWidth: 0,
        textStyle: { color: '#f8fafc' },
        formatter: (params: unknown) => {
          const row = params as { name?: string; value?: number; percent?: number }
          return `${row.name}<br/><b>${fmtCurrency(Number(row.value ?? 0))}</b> / week (${row.percent ?? 0}%)`
        },
      },
      legend: {
        bottom: 8,
        type: 'scroll',
        textStyle: { color: COLORS.axis, fontSize: 11, fontWeight: 600 },
      },
      series: [
        {
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['50%', '46%'],
          padAngle: 2,
          itemStyle: { borderRadius: 0, borderColor: '#f7f3ec', borderWidth: 1 },
          label: {
            color: COLORS.axis,
            formatter: '{b}\n{d}%',
            fontSize: 11,
            fontWeight: 600,
          },
          data: slices,
        },
      ],
    } as EChartsOption
  }, [costMix])

  if (!hasData && costMix.total <= 0) return null

  const option = view === 'trend' ? trendOption : view === 'gm' ? gmOption : costMixOption

  return (
    <section className="cap-revproj-charts" aria-label="Revenue projection charts">
      <header className="cap-revproj-charts__head">
        <div>
          <p className="cap-revproj-charts__eyebrow">Charts</p>
          <h3 className="cap-revproj-charts__title">Revenue, cost &amp; margin</h3>
        </div>
        <div className="cap-revproj-charts__tabs" role="tablist" aria-label="Chart view">
          {(
            [
              ['trend', 'Monthly trend'],
              ['gm', 'Gross margin'],
              ['costMix', 'Cost mix'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              className={
                view === id
                  ? 'cap-revproj-charts__tab cap-revproj-charts__tab--active'
                  : 'cap-revproj-charts__tab'
              }
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </header>
      <div className="cap-revproj-charts__body">
        <ReactECharts theme="ledger"
          option={withModernChartLook(option)}
          style={{ height: 340, width: '100%' }}
          notMerge
          lazyUpdate
          opts={{ renderer: 'canvas' }}
        />
      </div>
      {view === 'costMix' && costMix.total > 0 ? (
        <p className="cap-revproj-charts__note">
          Weekly cost mix by category (custom labels allowed) — rolled into monthly total cost and GM
          for every LOB in scope. Total {fmtCurrency(costMix.total)} / week.
        </p>
      ) : (
        <p className="cap-revproj-charts__note">
          Charts use the same combined months as the projection sheet (filters apply).
        </p>
      )}
    </section>
  )
}

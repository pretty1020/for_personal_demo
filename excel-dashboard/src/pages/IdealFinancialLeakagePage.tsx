import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { useIdealFinancial } from '../context/IdealFinancialContext'
import { useCapacityFinancial } from '../context/CapacityFinancialContext'
import {
  CAPACITY_LEAKAGE_DRIVERS,
  type CapacityWeeklyLeakageRow,
} from '../planner/capacityLeakageDisplay'
import { fmtCurrency } from '../planner/format'
import {
  IDEAL_STAFFING_PLAN_PATH,
  IDEAL_STAFFING_SAMPLE_QUERY,
  markIdealStaffingSampleForLoad,
} from '../utils/idealStaffingNavigation'
import { dominantMonthKeyFromWeekStart } from '../utils/staffingCapacity/calendarWeek'
import { withModernChartLook } from '../utils/echartsCompact'
import { granularityLabel, type TrendGranularity } from '../utils/idealFinancialTrending'

const DRIVER_COLORS = ['#9a3b2f', '#9a6b2f', '#8c7348', '#1c1915', '#2c5648', '#6e675f'] as const
const TREND_OPTIONS: TrendGranularity[] = ['week', 'month', 'quarter']

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return fmtCurrency(n)
}

function isMeaningfulAmount(n: number | null | undefined): boolean {
  return n != null && Number.isFinite(n) && Math.abs(n) >= 0.5
}

function LeakageKpi({ label, amount }: { label: string; amount: number }) {
  if (!isMeaningfulAmount(amount)) return null
  return (
    <div className="ideal-leakage-kpi">
      <span className="ideal-leakage-kpi__label">{label}</span>
      <span className="ideal-leakage-kpi__value">{fmtMoney(amount)}</span>
    </div>
  )
}

function LeakageChartPanel({
  title,
  visible,
  onToggle,
  tools,
  children,
}: {
  title: string
  visible: boolean
  onToggle: () => void
  tools?: ReactNode
  children: ReactNode
}) {
  return (
    <article className={`ideal-leakage-chart${visible ? '' : ' ideal-leakage-chart--hidden'}`}>
      <header className="ideal-leakage-chart__head">
        <h3 className="ideal-leakage-chart__title">{title}</h3>
        <div className="ideal-leakage-chart__tools">
          {tools}
          <button type="button" className="exec-chart-card__btn" onClick={onToggle} aria-expanded={visible}>
            {visible ? 'Hide chart' : 'Show chart'}
          </button>
        </div>
      </header>
      {visible ? <div className="ideal-leakage-chart__plot">{children}</div> : null}
    </article>
  )
}

function periodBucketKey(week: string, granularity: TrendGranularity): string {
  if (granularity === 'week') return week
  const monthKey = dominantMonthKeyFromWeekStart(week)
  if (granularity === 'month') return monthKey.slice(0, 7)
  const [year, month] = monthKey.split('-').map(Number)
  const q = Math.floor(((month || 1) - 1) / 3) + 1
  return `${year}-Q${q}`
}

function periodBucketLabel(key: string, granularity: TrendGranularity): string {
  if (granularity === 'week') return key
  if (granularity === 'month') {
    const date = new Date(`${key}-01T12:00:00`)
    if (Number.isNaN(date.getTime())) return key
    return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  }
  return key.replace('-', ' ')
}

type TrendPoint = {
  key: string
  label: string
  total: number
  momDelta: number | null
  momPct: number | null
}

function aggregateLeakageTrend(
  weekly: CapacityWeeklyLeakageRow[],
  granularity: TrendGranularity,
): TrendPoint[] {
  const base =
    granularity === 'week'
      ? weekly.map((row) => ({ key: row.week, label: row.week, total: row.total }))
      : (() => {
          const map = new Map<string, number>()
          for (const row of weekly) {
            const key = periodBucketKey(row.week, granularity)
            map.set(key, (map.get(key) ?? 0) + row.total)
          }
          return [...map.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, total]) => ({ key, label: periodBucketLabel(key, granularity), total }))
        })()

  return base.map((point, index) => {
    if (index === 0) return { ...point, momDelta: null, momPct: null }
    const prior = base[index - 1]!.total
    const momDelta = point.total - prior
    const momPct = Math.abs(prior) >= 0.5 ? (momDelta / Math.abs(prior)) * 100 : null
    return { ...point, momDelta, momPct }
  })
}

function trendChartTitle(mode: TrendGranularity): string {
  if (mode === 'month') return 'Month on month leakage'
  if (mode === 'quarter') return 'Quarter on quarter leakage'
  return 'Week on week leakage'
}

export function IdealFinancialLeakagePage() {
  const { periodLabel, client, lobId, location, trendGranularity, financialLobOptions } = useIdealFinancial()
  const model = useCapacityFinancial()
  const [showDriverChart, setShowDriverChart] = useState(true)
  const [showTrendChart, setShowTrendChart] = useState(true)
  const [showTable, setShowTable] = useState(true)
  const [trendMode, setTrendMode] = useState<TrendGranularity>(
    () => (trendGranularity === 'week' ? 'month' : trendGranularity),
  )

  const leakages = model.hasScope ? model.leakages : null
  const lobLabel = financialLobOptions.find((item) => item.id === lobId)?.lob ?? ''

  const driverValues = useMemo(() => {
    if (!leakages) return CAPACITY_LEAKAGE_DRIVERS.map(() => 0)
    return CAPACITY_LEAKAGE_DRIVERS.map((driver) => leakages[driver.key])
  }, [leakages])

  const bucketChartOption = useMemo(
    () =>
      ({
        tooltip: {
          trigger: 'axis',
          valueFormatter: (value) => fmtMoney(Number(value)),
        },
        grid: { left: 56, right: 16, top: 24, bottom: 56 },
        xAxis: {
          type: 'category',
          data: CAPACITY_LEAKAGE_DRIVERS.map((driver) => driver.label),
          axisLabel: { color: '#6e675f', fontSize: 10, interval: 28, hideOverlap: true },
          axisLine: { lineStyle: { color: '#1c1915' } },
          axisTick: { show: true, lineStyle: { color: '#1c1915' } },
        },
        yAxis: {
          type: 'value',
          axisLabel: { color: '#6e675f', formatter: (v: number) => `$${(v / 1000).toFixed(0)}k` },
          splitLine: { lineStyle: { color: '#e3dbd0' } },
        },
        series: [
          {
            type: 'bar',
            data: driverValues.map((value, index) => ({
              value,
              itemStyle: {
                borderRadius: 0,
                color: DRIVER_COLORS[index] ?? '#1c1915',
              },
            })),
          },
        ],
      }) as EChartsOption,
    [driverValues],
  )

  const trendPoints = useMemo(
    () => aggregateLeakageTrend(model.weeklyLeakages, trendMode),
    [model.weeklyLeakages, trendMode],
  )

  const periodTrendOption = useMemo(() => {
    if (!trendPoints.length) {
      return {
        title: {
          text: 'No leakage in current filter',
          left: 'center',
          top: 'middle',
          textStyle: { color: '#64748b', fontSize: 13 },
        },
      } as EChartsOption
    }

    const showMom = trendMode !== 'week'
    return {
      legend: showMom
        ? {
            top: 0,
            right: 8,
            textStyle: { color: '#6e675f', fontSize: 11 },
            data: ['Lost revenue', 'Change vs prior'],
          }
        : undefined,
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const items = (Array.isArray(params) ? params : [params]) as Array<{
            axisValue?: string | number
            name?: string
          }>
          const axis = String(items[0]?.axisValue ?? items[0]?.name ?? '')
          const point = trendPoints.find((row) => row.label === axis)
          const lines = [`<strong>${axis}</strong>`]
          if (point) {
            lines.push(`Lost revenue: ${fmtMoney(point.total)}`)
            if (point.momDelta != null) {
              const sign = point.momDelta > 0 ? '+' : ''
              const pct =
                point.momPct != null ? ` (${sign}${point.momPct.toFixed(1)}%)` : ''
              lines.push(`Change vs prior: ${sign}${fmtMoney(point.momDelta)}${pct}`)
            }
          }
          return lines.join('<br/>')
        },
      },
      grid: { left: 56, right: showMom ? 52 : 16, top: showMom ? 36 : 28, bottom: 52 },
      xAxis: {
        type: 'category',
        data: trendPoints.map((point) => point.label),
        axisLabel: {
          color: '#6e675f',
          fontSize: 10,
          rotate: trendPoints.length > 6 ? 32 : 0,
        },
        axisLine: { lineStyle: { color: '#d7e3ef' } },
      },
      yAxis: [
        {
          type: 'value',
          name: showMom ? 'Revenue' : undefined,
          nameTextStyle: { color: '#6e675f', fontSize: 10 },
          axisLabel: { color: '#6e675f', formatter: (v: number) => `$${(v / 1000).toFixed(0)}k` },
          splitLine: { lineStyle: { color: '#e3dbd0' } },
        },
        ...(showMom
          ? [
              {
                type: 'value' as const,
                name: 'Δ',
                nameTextStyle: { color: '#6e675f', fontSize: 10 },
                axisLabel: {
                  color: '#6e675f',
                  formatter: (v: number) => `$${(v / 1000).toFixed(0)}k`,
                },
                splitLine: { show: false },
              },
            ]
          : []),
      ],
      series: showMom
        ? [
            {
              name: 'Lost revenue',
              type: 'bar',
              data: trendPoints.map((point) => point.total),
              barMaxWidth: 28,
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
            },
            {
              name: 'Change vs prior',
              type: 'line',
              yAxisIndex: 1,
              smooth: true,
              data: trendPoints.map((point) => point.momDelta),
              connectNulls: false,
              lineStyle: { color: '#8c7348', width: 1.5 },
              itemStyle: { color: '#8c7348' },
              areaStyle: { opacity: 0.08, color: '#8c7348' },
            },
          ]
        : [
            {
              name: 'Lost revenue',
              type: 'line',
              smooth: true,
              data: trendPoints.map((point) => point.total),
              lineStyle: { color: '#1c1915', width: 1.5 },
              itemStyle: { color: '#1c1915' },
              areaStyle: { opacity: 0.08, color: '#2c5648' },
            },
          ],
    } as EChartsOption
  }, [trendMode, trendPoints])

  const filterSummary = [
    client || 'All clients',
    lobLabel || (lobId ? 'Selected LOB' : 'All LOBs'),
    location || null,
    periodLabel,
    leakages ? fmtMoney(leakages.total) : '—',
  ]
    .filter(Boolean)
    .join(' · ')

  const trendTools = (
    <div className="ideal-leakage-trend-pills" role="group" aria-label="Leakage trend granularity">
      {TREND_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          className={`exec-pill-btn${trendMode === option ? ' exec-pill-btn--on' : ''}`}
          onClick={() => setTrendMode(option)}
        >
          {granularityLabel(option)}
        </button>
      ))}
    </div>
  )

  return (
    <div className="ideal-leakage-page">
      <div className="ideal-leakage-page__accent" aria-hidden />

      <section className="ideal-leakage-panel" aria-label="Revenue leakages">
        <header className="ideal-leakage-panel__hero">
          <h2 className="ideal-leakage-panel__title">Revenue leakages</h2>
          <p className="ideal-leakage-panel__summary">{filterSummary}</p>
          <div className="ideal-leakage-panel__actions mt-4">
            <Link
              to={`${IDEAL_STAFFING_PLAN_PATH}?sample=${IDEAL_STAFFING_SAMPLE_QUERY}`}
              className="ideal-leakage-staffing-btn"
              onClick={() => markIdealStaffingSampleForLoad()}
            >
              Open Capacity Plan
            </Link>
          </div>
        </header>

        {!model.hasScope ? (
          <p className="ideal-leakage-alert ideal-leakage-alert--warn ideal-leakage-alert--block">
            Select a client or LOB to view leakages.
          </p>
        ) : null}

        {model.hasScope && leakages ? (
          <div className="ideal-leakage-kpi-grid">
            <LeakageKpi label="Total lost revenue" amount={leakages.total} />
            {CAPACITY_LEAKAGE_DRIVERS.map((driver) => (
              <LeakageKpi key={driver.key} label={driver.label} amount={leakages[driver.key]} />
            ))}
          </div>
        ) : null}

        <div className="ideal-leakage-charts-grid">
          <LeakageChartPanel
            title="Leakage by driver"
            visible={showDriverChart}
            onToggle={() => setShowDriverChart((value) => !value)}
          >
            <ReactECharts theme="ledger"
              option={withModernChartLook(bucketChartOption)}
              style={{ height: 300 }}
              notMerge
              lazyUpdate
              opts={{ renderer: 'canvas' }}
            />
          </LeakageChartPanel>
          <LeakageChartPanel
            title={trendChartTitle(trendMode)}
            visible={showTrendChart}
            onToggle={() => setShowTrendChart((value) => !value)}
            tools={trendTools}
          >
            <ReactECharts theme="ledger"
              option={withModernChartLook(periodTrendOption)}
              style={{ height: 300 }}
              notMerge
              lazyUpdate
              opts={{ renderer: 'canvas' }}
            />
          </LeakageChartPanel>
        </div>

        <article className={`ideal-leakage-table-panel${showTable ? '' : ' ideal-leakage-table-panel--hidden'}`}>
          <header className="ideal-leakage-chart__head">
            <h3 className="ideal-leakage-chart__title">Program-week detail</h3>
            <button
              type="button"
              className="exec-chart-card__btn"
              onClick={() => setShowTable((value) => !value)}
              aria-expanded={showTable}
            >
              {showTable ? 'Hide table' : 'Show table'}
            </button>
          </header>
          {showTable ? (
            <div className="ideal-leakage-table-wrap exec-table-wrap max-h-[520px] overflow-auto">
              <table className="exec-data-table exec-data-table--leakage">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>Client</th>
                    <th>LOB</th>
                    <th>Understaffing</th>
                    <th>Overstaffing</th>
                    <th>Shrinkages</th>
                    <th>AHT</th>
                    <th>Attrition</th>
                    <th>Volume</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {!model.leakageDetailRows.length ? (
                    <tr>
                      <td colSpan={10} className="text-center text-sm text-slate-500">
                        No leakage rows for the selected filters.
                      </td>
                    </tr>
                  ) : (
                    model.leakageDetailRows.slice(0, 150).map((row) => (
                      <tr key={`${row.client}-${row.lob}-${row.week}-${row.projectCode}`}>
                        <td>{row.week}</td>
                        <td>{row.client}</td>
                        <td>{row.lob || row.projectCode || '—'}</td>
                        <td>{fmtMoney(row.headcount)}</td>
                        <td>{fmtMoney(row.overstaffing)}</td>
                        <td>{fmtMoney(row.shrinkage)}</td>
                        <td>{fmtMoney(row.aht)}</td>
                        <td>{fmtMoney(row.attrition)}</td>
                        <td>{fmtMoney(row.volume)}</td>
                        <td>{fmtMoney(row.total)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>
      </section>
    </div>
  )
}

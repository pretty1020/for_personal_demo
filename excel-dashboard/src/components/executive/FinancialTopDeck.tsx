import { useCallback, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { useCapacityFinancial } from '../../context/CapacityFinancialContext'
import {
  CAPACITY_LEAKAGE_DRIVERS,
  CAPACITY_LEAKAGE_TOTAL_DETAIL,
  type CapacityLeakageDriverKey,
} from '../../planner/capacityLeakageDisplay'
import { fmtCurrency } from '../../planner/format'
import { withModernChartLook } from '../../utils/echartsCompact'
import { CapacityFinancialKpiDeck } from './CapacityFinancialKpiDeck'

const LEAKAGE_BLUE = {
  deep: '#1c1915',
  primary: '#2c5648',
  mid: '#4d6b5e',
  light: '#8c7348',
  pale: '#d9cbb8',
  axis: '#6e675f',
  grid: '#e3dbd0',
  negative: '#a39a90',
} as const

const LEAKAGE_BAR_COLORS = [
  '#9a3b2f',
  '#9a6b2f',
  '#8c7348',
  '#1c1915',
  '#2c5648',
  '#6e675f',
] as const

const DRIVER_LABELS = CAPACITY_LEAKAGE_DRIVERS

type DriverKey = CapacityLeakageDriverKey | 'total'

const TOTAL_DETAIL = CAPACITY_LEAKAGE_TOTAL_DETAIL

type Props = {
  periodLabel: string
  dateRangeActive: boolean
}

export function FinancialTopDeck({ periodLabel, dateRangeActive }: Props) {
  const [open, setOpen] = useState(true)
  const [activeDriver, setActiveDriver] = useState<DriverKey | null>(null)
  const model = useCapacityFinancial()
  const leakages = model.hasScope ? model.leakages : null

  const chartOption: EChartsOption = useMemo(() => {
    if (!leakages) {
      return {
        title: {
          text: 'No revenue gaps in this view yet',
          left: 'center',
          top: 'middle',
          textStyle: { color: '#64748b', fontSize: 13 },
        },
      } as EChartsOption
    }

    const values = DRIVER_LABELS.map((driver) => leakages[driver.key])
    const totalAbs = values.reduce((sum, value) => sum + Math.abs(value), 0) || 1
    const showAll = activeDriver === null || activeDriver === 'total'

    return {
      animationDuration: 750,
      animationEasing: 'cubicOut',
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(28, 25, 21, 0.94)',
        borderWidth: 0,
        textStyle: { color: '#f8fafc', fontSize: 12 },
        formatter: (params: unknown) => {
          const row = params as { name?: string; value?: number; dataIndex?: number; seriesType?: string; percent?: number }
          const value = row.value ?? 0
          const share = ((Math.abs(value) / totalAbs) * 100).toFixed(1)
          const detail = DRIVER_LABELS[row.dataIndex ?? -1]?.detail ?? ''
          const pct =
            row.seriesType === 'pie' && row.percent != null ? `${row.percent.toFixed(1)}% of chart` : `${share}% of drivers`
          return `<strong>${row.name ?? ''}</strong><br/>${fmtCurrency(value)}<br/><span style="opacity:0.75">${pct}</span>${
            detail ? `<br/><span style="opacity:0.8">${detail}</span>` : ''
          }`
        },
      },
      legend: {
        show: false,
      },
      toolbox: {
        right: 8,
        top: 0,
        feature: {
          saveAsImage: { name: 'revenue-leakages', pixelRatio: 2 },
        },
        iconStyle: { borderColor: LEAKAGE_BLUE.axis },
      },
      grid: { left: 56, right: '38%', top: 36, bottom: 56 },
      xAxis: {
        type: 'category',
        data: DRIVER_LABELS.map((d) => d.label),
        axisLabel: { color: LEAKAGE_BLUE.axis, fontSize: 11, fontWeight: 600, interval: 0, rotate: 18 },
        axisLine: { lineStyle: { color: LEAKAGE_BLUE.grid } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: LEAKAGE_BLUE.axis, formatter: (v: number) => `$${(v / 1000).toFixed(0)}k` },
        splitLine: { lineStyle: { color: LEAKAGE_BLUE.grid, type: 'solid' } },
      },
      series: [
        {
          name: 'Leakage',
          type: 'bar',
          barMaxWidth: 48,
          cursor: 'pointer',
          data: values.map((value, index) => {
            const driverKey = DRIVER_LABELS[index]?.key
            const isActive = showAll || activeDriver === driverKey
            const barColor = value < 0 ? LEAKAGE_BLUE.negative : (LEAKAGE_BAR_COLORS[index] ?? LEAKAGE_BLUE.primary)
            return {
              value,
              itemStyle: {
                opacity: isActive ? 1 : 0.28,
                borderRadius: 0,
                color: {
                  type: 'linear',
                  x: 0,
                  y: value >= 0 ? 0 : 1,
                  x2: 0,
                  y2: value >= 0 ? 1 : 0,
                  colorStops: [
                    { offset: 0, color: barColor },
                    { offset: 1, color: LEAKAGE_BLUE.deep },
                  ],
                },
                shadowBlur: isActive ? 12 : 0,
                shadowColor: 'rgba(28, 25, 21, 0.18)',
              },
            }
          }),
          emphasis: {
            focus: 'self',
            itemStyle: {
              shadowBlur: 18,
              shadowColor: 'rgba(26, 111, 181, 0.45)',
              opacity: 1,
            },
          },
          label: {
            show: true,
            position: 'top',
            color: LEAKAGE_BLUE.axis,
            fontSize: 10,
            fontWeight: 700,
            formatter: (params: { value?: unknown }) => {
              const value = Number(params.value ?? 0)
              if (!Number.isFinite(value) || Math.abs(value) < 500) return ''
              return value >= 1000 ? `$${(value / 1000).toFixed(0)}k` : fmtCurrency(value)
            },
          },
        },
        {
          name: 'Share',
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['82%', '48%'],
          avoidLabelOverlap: true,
          cursor: 'pointer',
          label: {
            show: true,
            formatter: '{b}\n{d}%',
            fontSize: 10,
            color: LEAKAGE_BLUE.axis,
          },
          labelLine: { length: 8, length2: 6 },
          data: DRIVER_LABELS.map((driver, index) => {
            const value = Math.abs(leakages[driver.key])
            const isActive = showAll || activeDriver === driver.key
            return {
              name: driver.label,
              value,
              itemStyle: {
                color: LEAKAGE_BAR_COLORS[index],
                opacity: isActive ? 1 : 0.28,
                borderColor: '#fff',
                borderWidth: 2,
              },
            }
          }),
          emphasis: {
            scale: true,
            scaleSize: 6,
            itemStyle: { shadowBlur: 16, shadowColor: 'rgba(28, 25, 21, 0.22)' },
          },
        },
      ],
    } as EChartsOption
  }, [activeDriver, leakages])

  const onChartClick = useCallback((params: { dataIndex?: number; seriesType?: string; name?: string }) => {
    if (params.seriesType === 'pie') {
      const driver = DRIVER_LABELS.find((item) => item.label === params.name)?.key
      if (!driver) return
      setActiveDriver((current) => (current === driver ? null : driver))
      return
    }
    const driver = DRIVER_LABELS[params.dataIndex ?? -1]?.key
    if (!driver) return
    setActiveDriver((current) => (current === driver ? null : driver))
  }, [])

  const onTotalClick = useCallback(() => {
    setActiveDriver((current) => (current === 'total' ? null : 'total'))
  }, [])

  const selectedDriver = activeDriver && activeDriver !== 'total'
    ? DRIVER_LABELS.find((driver) => driver.key === activeDriver)
    : null
  const selected = activeDriver === 'total'
    ? { label: 'Total lost revenue', detail: TOTAL_DETAIL, amount: leakages?.total ?? 0 }
    : selectedDriver
      ? {
          label: selectedDriver.label,
          detail: selectedDriver.detail,
          amount: leakages ? leakages[selectedDriver.key] : 0,
        }
      : null

  const totalAbs = leakages
    ? DRIVER_LABELS.reduce((sum, driver) => sum + Math.abs(leakages[driver.key]), 0)
    : 0

  return (
    <section className="ideal-fin-top-deck mb-6" aria-label="Financial summary">
      <div className="ideal-fin-top-deck__grid">
        <CapacityFinancialKpiDeck />
        <button
          type="button"
          className={`cap-fin-leakage-panel__trigger cap-fin-leakage-panel__trigger--highlight${
            open ? ' cap-fin-leakage-panel__trigger--open' : ''
          }`}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? 'Hide revenue leakages' : 'View revenue leakages'}
        </button>

        {open ? (
          <div className="cap-fin-leakage-panel__body saas-card ideal-fin-top-deck__leakage-body cap-fin-leakage-panel--blue">
            <div className="ideal-fin-leakage-panel__head">
              <div>
                <h3 className="m-0 text-base font-bold text-slate-900">Revenue leakages</h3>
                <p className="saas-muted m-0 mt-1 text-sm">
                  {dateRangeActive ? periodLabel : 'Selected period'}
                </p>
              </div>
              {leakages ? (
                <div className="ideal-fin-leakage-panel__total-chip" aria-hidden>
                  <span>Total</span>
                  <strong>{fmtCurrency(leakages.total)}</strong>
                </div>
              ) : null}
            </div>

            {!leakages ? (
              <p className="saas-muted m-0 mt-3 text-sm">Select a client or LOB to view leakages.</p>
            ) : (
              <>
                <div className="ideal-fin-leakage-panel__chart ideal-fin-leakage-panel__chart--blue mt-3">
                  <ReactECharts theme="ledger"
                    option={withModernChartLook(chartOption)}
                    style={{ height: 320, width: '100%' }}
                    notMerge
                    lazyUpdate
                    opts={{ renderer: 'canvas' }}
                    onEvents={{ click: onChartClick }}
                  />
                </div>
                {selected ? (
                  <p className="cap-fin-leakage-insight mt-3 mb-0" role="status">
                    <strong>{selected.label}</strong>
                    {' · '}
                    {fmtCurrency(selected.amount)}
                    {leakages.total > 0
                      ? ` (${((Math.abs(selected.amount) / Math.abs(leakages.total)) * 100).toFixed(1)}% of total)`
                      : ''}
                    {' — '}
                    {selected.detail}
                  </p>
                ) : null}
                <div className="exec-kpi-grid exec-kpi-grid--leakage-drivers mt-3">
                  <button
                    type="button"
                    className={`exec-kpi-tile exec-kpi-tile--leakage exec-kpi-tile--leakage-blue exec-kpi-tile--leakage-total${
                      activeDriver === 'total' ? ' exec-kpi-tile--leakage-active' : ''
                    }`}
                    onClick={onTotalClick}
                  >
                    <span className="exec-kpi-tile__label">Total lost revenue</span>
                    <span className="exec-kpi-tile__value">{fmtCurrency(leakages.total)}</span>
                  </button>
                  {DRIVER_LABELS.map((driver) => {
                    const dimmed = Boolean(activeDriver && activeDriver !== 'total' && activeDriver !== driver.key)
                    const share = totalAbs > 0 ? (Math.abs(leakages[driver.key]) / totalAbs) * 100 : 0
                    return (
                      <button
                        key={driver.key}
                        type="button"
                        className={`exec-kpi-tile exec-kpi-tile--leakage exec-kpi-tile--leakage-blue${
                          activeDriver === driver.key ? ' exec-kpi-tile--leakage-active' : ''
                        }${dimmed ? ' exec-kpi-tile--leakage-dim' : ''}`}
                        onClick={() => setActiveDriver((current) => (current === driver.key ? null : driver.key))}
                      >
                        <span className="exec-kpi-tile__label">{driver.label}</span>
                        <span className="exec-kpi-tile__value">{fmtCurrency(leakages[driver.key])}</span>
                        <span className="exec-kpi-tile__hint">{share.toFixed(1)}% of drivers</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    </section>
  )
}

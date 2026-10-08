import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { useIdealFinancial } from '../../context/IdealFinancialContext'
import { useCapacityFinancial } from '../../context/CapacityFinancialContext'
import { CAPACITY_LEAKAGE_DRIVERS } from '../../planner/capacityLeakageDisplay'
import { fmtCurrency } from '../../planner/format'
import { withModernChartLook } from '../../utils/echartsCompact'

const DRIVER_COLORS = ['#9a3b2f', '#9a6b2f', '#8c7348', '#1c1915', '#2c5648', '#6e675f'] as const

function LeakageKpi({ label, amount, impact }: { label: string; amount: number; impact?: 'bad' | 'neutral' }) {
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.5) return null
  return (
    <div className={`exec-kpi-tile exec-kpi-tile--leakage${impact === 'bad' ? ' exec-kpi-tile--warn' : ''}`}>
      <span className="exec-kpi-tile__label">{label}</span>
      <span className="exec-kpi-tile__value">{fmtCurrency(amount)}</span>
    </div>
  )
}

/** Revenue leakage summary — same CapacityFinancial drivers as Overview / Leakages. */
export function FinancialLeakageSection() {
  const { periodLabel } = useIdealFinancial()
  const model = useCapacityFinancial()
  const [chartOpen, setChartOpen] = useState(false)
  const leakages = model.hasScope ? model.leakages : null

  const chartOption = useMemo(() => {
    if (!leakages) {
      return {
        title: {
          text: 'Select a client or LOB',
          left: 'center',
          top: 'middle',
          textStyle: { color: '#64748b', fontSize: 13 },
        },
      } as EChartsOption
    }
    return {
      tooltip: { trigger: 'axis', valueFormatter: (value) => fmtCurrency(Number(value)) },
      grid: { left: 48, right: 16, top: 16, bottom: 48 },
      xAxis: {
        type: 'category',
        data: CAPACITY_LEAKAGE_DRIVERS.map((driver) => driver.label),
        axisLabel: { color: '#64748b', fontSize: 10, interval: 24, hideOverlap: true },
        axisLine: { lineStyle: { color: '#cbd5e1' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#64748b', formatter: (v: number) => `$${(v / 1000).toFixed(0)}k` },
        splitLine: { lineStyle: { color: '#e2e8f0' } },
      },
      series: [
        {
          type: 'bar',
          data: CAPACITY_LEAKAGE_DRIVERS.map((driver, index) => ({
            value: leakages[driver.key],
            itemStyle: { borderRadius: 0, color: DRIVER_COLORS[index] ?? '#1c1915' },
          })),
        },
      ],
    } as EChartsOption
  }, [leakages])

  return (
    <section className="exec-leakage-section saas-card mb-6" aria-label="Revenue leakages">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="m-0 text-base font-bold text-slate-900">Revenue leakages</h3>
          <p className="saas-muted m-0 mt-1 text-sm">{periodLabel}</p>
        </div>
        <button type="button" className="exec-chart-card__btn" onClick={() => setChartOpen((v) => !v)}>
          {chartOpen ? 'Hide chart' : 'Show chart'}
        </button>
      </header>

      {!leakages ? (
        <p className="saas-muted m-0 mt-3 text-sm">Select a client or LOB to view leakages.</p>
      ) : (
        <div className="exec-kpi-grid exec-kpi-grid--dense mt-4">
          <LeakageKpi label="Total lost revenue" amount={leakages.total} impact="bad" />
          {CAPACITY_LEAKAGE_DRIVERS.map((driver) => (
            <LeakageKpi key={driver.key} label={driver.label} amount={leakages[driver.key]} impact="bad" />
          ))}
        </div>
      )}

      {chartOpen ? (
        <div className="mt-4">
          <ReactECharts theme="ledger"
            option={withModernChartLook(chartOption)}
            style={{ height: 280 }}
            notMerge
            lazyUpdate
            opts={{ renderer: 'canvas' }}
          />
        </div>
      ) : null}
    </section>
  )
}

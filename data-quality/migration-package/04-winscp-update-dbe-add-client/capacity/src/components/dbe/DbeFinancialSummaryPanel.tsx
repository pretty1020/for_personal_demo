import { useMemo } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import type { CapacityPeriodState } from '../../planner/capacityPeriod'
import type { DbeClientCombinedMonth } from '../../planner/dbe/dbePersistence'
import {
  buildDbeFinancialChartSeries,
  dbePeriodSummaryLabel,
} from '../../planner/dbe/dbePeriodFilter'
import type { DbeRevenueComparisonRow } from '../../planner/dbe/dbeRevenueComparison'
import { summarizeDbeRevenueComparison } from '../../planner/dbe/dbeRevenueComparison'
import {
  fmtVarianceDelta,
  fmtVarianceDeltaPct,
  varianceToneHigherBetter,
} from '../../planner/varianceDisplay'

const currency = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const pct = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
})

const headcount = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1,
  minimumFractionDigits: 0,
})

type Props = {
  combinedMonths: DbeClientCombinedMonth[]
  period: CapacityPeriodState
  fiscalStartYear: number
  clientLabel: string
  /** Month rollup comparison rows */
  revenueComparisonMonths: DbeRevenueComparisonRow[]
  /** Optional LOB × month detail */
  revenueComparisonDetail: DbeRevenueComparisonRow[]
}

function fmtPctOrDash(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${pct.format(value)}%`
}

function fmtMoneyOrDash(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return currency.format(value)
}

function fmtHeadcountOrDash(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return headcount.format(value)
}

function VarianceCell({
  value,
  pctValue,
  decimals = 0,
}: {
  value: number | null
  pctValue: number | null
  decimals?: number
}) {
  const tone = varianceToneHigherBetter(value)
  return (
    <td className={`cap-dbe-financial__var cap-dbe-financial__var--${tone}`}>
      <div>{fmtVarianceDelta(value, decimals)}</div>
      <div className="cap-dbe-financial__var-pct">{fmtVarianceDeltaPct(pctValue, 1)}</div>
    </td>
  )
}

export function DbeFinancialSummaryPanel({
  combinedMonths,
  period,
  fiscalStartYear,
  clientLabel,
  revenueComparisonMonths,
  revenueComparisonDetail,
}: Props) {
  const series = useMemo(
    () => buildDbeFinancialChartSeries(combinedMonths, period),
    [combinedMonths, period],
  )

  const totals = useMemo(() => {
    const totalRevenue = combinedMonths.reduce((sum, row) => sum + row.totalRevenue, 0)
    const totalCost = combinedMonths.reduce((sum, row) => sum + row.totalCost, 0)
    const gm = combinedMonths.reduce((sum, row) => sum + row.gm, 0)
    const gmPct = totalRevenue > 0 ? (gm / totalRevenue) * 100 : 0
    return { totalRevenue, totalCost, gm, gmPct }
  }, [combinedMonths])

  const comparisonSummary = useMemo(
    () => summarizeDbeRevenueComparison(revenueComparisonDetail),
    [revenueComparisonDetail],
  )

  const showLobDetail = revenueComparisonDetail.length > revenueComparisonMonths.length

  const revenueCostOption = useMemo((): EChartsOption => {
    const labels = series.map((point) => point.label)
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['Revenue', 'Cost', 'GM'], bottom: 0 },
      grid: { left: 48, right: 24, top: 24, bottom: 48 },
      xAxis: { type: 'category', data: labels, axisLabel: { rotate: labels.length > 6 ? 35 : 0 } },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: (value: number) =>
            value >= 1_000_000 ? `$${(value / 1_000_000).toFixed(1)}M` : `$${Math.round(value / 1000)}k`,
        },
      },
      series: [
        {
          name: 'Revenue',
          type: 'bar',
          data: series.map((point) => point.totalRevenue),
          itemStyle: { color: '#db2777' },
        },
        {
          name: 'Cost',
          type: 'bar',
          data: series.map((point) => point.totalCost),
          itemStyle: { color: '#64748b' },
        },
        {
          name: 'GM',
          type: 'line',
          smooth: true,
          data: series.map((point) => point.gm),
          itemStyle: { color: '#059669' },
          lineStyle: { width: 3 },
        },
      ],
    }
  }, [series])

  const gmPctOption = useMemo((): EChartsOption => {
    const labels = series.map((point) => point.label)
    return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => {
          const items = Array.isArray(params) ? params : [params]
          const first = items[0] as { dataIndex?: number }
          const idx = first?.dataIndex ?? 0
          const point = series[idx]
          if (!point) return ''
          return `${point.label}<br/>GM %: ${point.gmPct.toFixed(2)}%`
        },
      },
      grid: { left: 48, right: 24, top: 24, bottom: 40 },
      xAxis: { type: 'category', data: labels, axisLabel: { rotate: labels.length > 6 ? 35 : 0 } },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (value: number) => `${value}%` },
      },
      series: [
        {
          name: 'GM %',
          type: 'line',
          smooth: true,
          areaStyle: { opacity: 0.12, color: '#db2777' },
          data: series.map((point) => Math.round(point.gmPct * 100) / 100),
          itemStyle: { color: '#be185d' },
          lineStyle: { width: 3 },
        },
      ],
    }
  }, [series])

  if (!combinedMonths.length) {
    return (
      <section className="cap-panel cap-dbe-financial">
        <p className="cap-panel__desc">No DBE data for the current filters and period.</p>
      </section>
    )
  }

  return (
    <section className="cap-dbe-financial">
      <div className="cap-dbe-financial__head">
        <div>
          <h3 className="cap-panel__title">Financial summary — {clientLabel}</h3>
          <p className="cap-panel__desc">
            {dbePeriodSummaryLabel(period, fiscalStartYear)} · Revenue, cost, and gross margin from DBE combined
            metrics.
          </p>
        </div>
      </div>

      <div className="cap-dbe-financial__kpis">
        <article className="cap-dbe-financial__kpi">
          <span>Revenue</span>
          <strong>{currency.format(totals.totalRevenue)}</strong>
        </article>
        <article className="cap-dbe-financial__kpi">
          <span>Cost</span>
          <strong>{currency.format(totals.totalCost)}</strong>
        </article>
        <article className="cap-dbe-financial__kpi cap-dbe-financial__kpi--accent">
          <span>Gross margin</span>
          <strong>{currency.format(totals.gm)}</strong>
        </article>
        <article className="cap-dbe-financial__kpi">
          <span>GM %</span>
          <strong>{totals.gmPct.toFixed(2)}%</strong>
        </article>
      </div>

      <div className="cap-dbe-financial__charts">
        <article className="cap-panel cap-dbe-financial__chart-card">
          <h4 className="cap-dbe-financial__chart-title">Revenue vs cost vs GM</h4>
          <ReactECharts option={revenueCostOption} style={{ height: 320 }} notMerge lazyUpdate />
        </article>
        <article className="cap-panel cap-dbe-financial__chart-card">
          <h4 className="cap-dbe-financial__chart-title">GM % trend</h4>
          <ReactECharts option={gmPctOption} style={{ height: 320 }} notMerge lazyUpdate />
        </article>
      </div>

      <div className="cap-panel cap-dbe-financial__table-wrap">
        <h4 className="cap-dbe-financial__chart-title">Period breakdown</h4>
        <table className="cap-dbe-sheet cap-dbe-financial__table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Revenue</th>
              <th>Cost</th>
              <th>GM</th>
              <th>GM %</th>
            </tr>
          </thead>
          <tbody>
            {series.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{currency.format(row.totalRevenue)}</td>
                <td>{currency.format(row.totalCost)}</td>
                <td>{currency.format(row.gm)}</td>
                <td>{row.gmPct.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cap-panel cap-dbe-financial__table-wrap cap-dbe-financial__comparison">
        <div className="cap-dbe-financial__comparison-head">
          <div>
            <h4 className="cap-dbe-financial__chart-title">Revenue comparison</h4>
            <p className="cap-panel__desc">
              Revenue from your DBE Absenteeism &amp; Shrinkage, next to revenue from the Staffing Plan&apos;s
              planned figures for the same Client / LOB / Location / Project Code. FTE compares DBE FTE with
              Planned Production Headcount from that matched plan. A positive variance means the Staffing
              Plan is higher.
            </p>
            <p className="cap-panel__desc">
              Revenue totals add up the period. FTE and Production HC are headcounts, so the Total row shows
              the average month.
            </p>
          </div>
          <div className="cap-dbe-financial__comparison-kpis">
            <article>
              <span>Manual Abs/Shrink revenue</span>
              <strong>{currency.format(comparisonSummary.manualRevenue)}</strong>
            </article>
            <article>
              <span>Planned Abs/Shrink revenue</span>
              <strong>{fmtMoneyOrDash(comparisonSummary.plannedRevenue)}</strong>
            </article>
            <article
              className={`cap-dbe-financial__comparison-kpi-var cap-dbe-financial__var--${varianceToneHigherBetter(comparisonSummary.variance)}`}
            >
              <span>Variance</span>
              <strong>{fmtVarianceDelta(comparisonSummary.variance, 0)}</strong>
              <small>{fmtVarianceDeltaPct(comparisonSummary.variancePct, 1)}</small>
            </article>
            <article>
              <span>DBE FTE (avg month)</span>
              <strong>{fmtHeadcountOrDash(comparisonSummary.manualFte)}</strong>
            </article>
            <article>
              <span>Planned Production HC (avg month)</span>
              <strong>{fmtHeadcountOrDash(comparisonSummary.plannedProductionHc)}</strong>
            </article>
            <article
              className={`cap-dbe-financial__comparison-kpi-var cap-dbe-financial__var--${varianceToneHigherBetter(comparisonSummary.fteVariance)}`}
            >
              <span>FTE variance</span>
              <strong>{fmtVarianceDelta(comparisonSummary.fteVariance, 1)}</strong>
              <small>{fmtVarianceDeltaPct(comparisonSummary.fteVariancePct, 1)}</small>
            </article>
          </div>
        </div>

        {!comparisonSummary.plannedAvailable && !comparisonSummary.fteComparable ? (
          <p className="cap-panel__desc cap-dbe-financial__comparison-empty">
            No Staffing Plan matches these filters. Match on Client, LOB, Location, and Project
            Code (when set), then add planned Absenteeism / Shrinkage and Production HC on that
            plan.
          </p>
        ) : null}

        {!comparisonSummary.plannedAvailable && comparisonSummary.fteComparable ? (
          <p className="cap-panel__desc cap-dbe-financial__comparison-empty">
            FTE is comparing, but the matching Staffing Plan has no planned Absenteeism or Shrinkage yet,
            so the revenue columns stay blank.
          </p>
        ) : null}

        {comparisonSummary.plannedAvailable && !comparisonSummary.fteComparable ? (
          <p className="cap-panel__desc cap-dbe-financial__comparison-empty">
            The matching Staffing Plan has no Production HC for these months, so the FTE columns stay
            blank.
          </p>
        ) : null}

        <div className="cap-dbe-financial__table-scroll">
          <table className="cap-dbe-sheet cap-dbe-financial__table cap-dbe-financial__table--comparison">
            <thead>
              <tr>
                <th rowSpan={2}>Period</th>
                <th colSpan={4} className="cap-dbe-financial__group-manual">
                  DBE Data (manual Abs / Shrink / FTE)
                </th>
                <th colSpan={4} className="cap-dbe-financial__group-planned">
                  Capacity Plan (planned Abs / Shrink / Production HC)
                </th>
                <th rowSpan={2}>Revenue variance</th>
                <th rowSpan={2}>FTE variance</th>
              </tr>
              <tr>
                <th>Abs %</th>
                <th>Shrink %</th>
                <th>FTE</th>
                <th>Total Revenue</th>
                <th>Abs %</th>
                <th>Shrink %</th>
                <th>Planned Production HC</th>
                <th>Total Revenue</th>
              </tr>
            </thead>
            <tbody>
              {revenueComparisonMonths.map((row) => (
                <tr key={row.key}>
                  <td>{row.label}</td>
                  <td>{fmtPctOrDash(row.manualAbsenteeismPct)}</td>
                  <td>{fmtPctOrDash(row.manualShrinkagePct)}</td>
                  <td>{fmtHeadcountOrDash(row.manualFte)}</td>
                  <td>{currency.format(row.manualRevenue)}</td>
                  <td>{fmtPctOrDash(row.plannedAbsenteeismPct)}</td>
                  <td>{fmtPctOrDash(row.plannedShrinkagePct)}</td>
                  <td>{fmtHeadcountOrDash(row.plannedProductionHc)}</td>
                  <td>{fmtMoneyOrDash(row.plannedRevenue)}</td>
                  <VarianceCell value={row.variance} pctValue={row.variancePct} />
                  <VarianceCell value={row.fteVariance} pctValue={row.fteVariancePct} decimals={1} />
                </tr>
              ))}
              <tr className="cap-dbe-sheet__total">
                <td>Total</td>
                <td>—</td>
                <td>—</td>
                <td>{fmtHeadcountOrDash(comparisonSummary.manualFte)}</td>
                <td>{currency.format(comparisonSummary.manualRevenue)}</td>
                <td>—</td>
                <td>—</td>
                <td>{fmtHeadcountOrDash(comparisonSummary.plannedProductionHc)}</td>
                <td>{fmtMoneyOrDash(comparisonSummary.plannedRevenue)}</td>
                <VarianceCell
                  value={comparisonSummary.variance}
                  pctValue={comparisonSummary.variancePct}
                />
                <VarianceCell
                  value={comparisonSummary.fteVariance}
                  pctValue={comparisonSummary.fteVariancePct}
                  decimals={1}
                />
              </tr>
            </tbody>
          </table>
        </div>

        {showLobDetail ? (
          <>
            <h4 className="cap-dbe-financial__chart-title cap-dbe-financial__detail-title">
              By Client / LOB
            </h4>
            <div className="cap-dbe-financial__table-scroll">
              <table className="cap-dbe-sheet cap-dbe-financial__table cap-dbe-financial__table--comparison">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Client</th>
                    <th>LOB / Project</th>
                    <th>Location</th>
                    <th>Project Code</th>
                    <th>Manual Abs %</th>
                    <th>Manual Shrink %</th>
                    <th>DBE FTE</th>
                    <th>Manual Revenue</th>
                    <th>Planned Abs %</th>
                    <th>Planned Shrink %</th>
                    <th>Planned Production HC</th>
                    <th>Planned Revenue</th>
                    <th>Revenue variance</th>
                    <th>FTE variance</th>
                  </tr>
                </thead>
                <tbody>
                  {revenueComparisonDetail.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>{row.clientName ?? '—'}</td>
                      <td>{row.lobProjectName ?? '—'}</td>
                      <td>{row.location ?? '—'}</td>
                      <td>{row.projectCode?.trim() ? row.projectCode : '—'}</td>
                      <td>{fmtPctOrDash(row.manualAbsenteeismPct)}</td>
                      <td>{fmtPctOrDash(row.manualShrinkagePct)}</td>
                      <td>{fmtHeadcountOrDash(row.manualFte)}</td>
                      <td>{currency.format(row.manualRevenue)}</td>
                      <td>{fmtPctOrDash(row.plannedAbsenteeismPct)}</td>
                      <td>{fmtPctOrDash(row.plannedShrinkagePct)}</td>
                      <td>{fmtHeadcountOrDash(row.plannedProductionHc)}</td>
                      <td>{fmtMoneyOrDash(row.plannedRevenue)}</td>
                      <VarianceCell value={row.variance} pctValue={row.variancePct} />
                      <VarianceCell
                        value={row.fteVariance}
                        pctValue={row.fteVariancePct}
                        decimals={1}
                      />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </section>
  )
}

import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { ModulePageHeader } from '../components/shell/ModulePageHeader'
import { usePlanner } from '../context/PlannerContext'
import { loadDbeLines, listDbeClients, listDbeLocations } from '../planner/dbe/dbePersistence'
import { downloadLeakageCsv, downloadLeakageWorkbook } from '../planner/dbe/dbeExport'
import { buildStaffingDbeLeakage, LEAKAGE_DRIVERS } from '../planner/dbe/staffingDbeLeakage'
import { resolvePlanLocation } from '../planner/planIdentity'

const currency = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const hours = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })

export function LeakagePage() {
  const {
    scenarios,
    getScenarioLedger,
    getScenarioForecast,
    getScenarioCapacityPlanOverrides,
  } = usePlanner()

  const [dbeLines, setDbeLines] = useState(() => loadDbeLines())
  useEffect(() => {
    setDbeLines(loadDbeLines())
  }, [])

  const [fiscalStartYear, setFiscalStartYear] = useState(() => {
    const now = new Date()
    return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  })
  const [clientFilter, setClientFilter] = useState('all')
  const [locationFilter, setLocationFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')

  const clients = useMemo(() => {
    const fromDbe = listDbeClients(dbeLines)
    const fromStaff = [
      ...new Set(scenarios.filter((s) => !s.isBaseline).map((s) => s.plan.client.trim()).filter(Boolean)),
    ]
    return [...new Set([...fromDbe, ...fromStaff])].sort((a, b) => a.localeCompare(b))
  }, [dbeLines, scenarios])

  const locations = useMemo(() => {
    const fromDbe = listDbeLocations(dbeLines)
    const fromStaff = scenarios
      .filter((s) => !s.isBaseline)
      .map((s) => resolvePlanLocation(s.plan) || s.plan.location || '')
      .map((s) => s.trim())
      .filter(Boolean)
    return [...new Set([...fromDbe, ...fromStaff])].sort((a, b) => a.localeCompare(b))
  }, [dbeLines, scenarios])

  const projectCodes = useMemo(() => {
    const fromDbe = dbeLines.map((line) => line.projectCode.trim()).filter(Boolean)
    const fromStaff = scenarios
      .filter((s) => !s.isBaseline)
      .map((s) => (s.plan.projectCode ?? '').trim())
      .filter(Boolean)
    return [...new Set([...fromDbe, ...fromStaff])].sort((a, b) => a.localeCompare(b))
  }, [dbeLines, scenarios])

  const portfolio = useMemo(
    () =>
      buildStaffingDbeLeakage(
        scenarios,
        dbeLines,
        {
          getScenarioLedger,
          getScenarioForecast,
          getScenarioCapacityPlanOverrides,
        },
        fiscalStartYear,
        {
          client: clientFilter === 'all' ? undefined : clientFilter,
          location: locationFilter === 'all' ? undefined : locationFilter,
          projectCode: projectFilter === 'all' ? undefined : projectFilter,
        },
      ),
    [
      scenarios,
      dbeLines,
      getScenarioLedger,
      getScenarioForecast,
      getScenarioCapacityPlanOverrides,
      fiscalStartYear,
      clientFilter,
      locationFilter,
      projectFilter,
    ],
  )

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear()
    return [current - 2, current - 1, current, current + 1]
  }, [])

  const staffingChartOption = useMemo<EChartsOption>(() => {
    const months = portfolio.byMonth
    return {
      color: ['#be185d', '#0f766e', '#b91c1c', '#d97706'],
      tooltip: { trigger: 'axis' },
      legend: { data: ['Production FTE', 'Required FTE', 'Understaff $', 'Overstaff $'], bottom: 0 },
      grid: { left: 56, right: 48, top: 24, bottom: 48 },
      xAxis: { type: 'category', data: months.map((m) => m.monthLabel), axisLabel: { color: '#64748b' } },
      yAxis: [
        {
          type: 'value',
          name: 'FTE',
          axisLabel: { color: '#64748b' },
          splitLine: { lineStyle: { color: '#e2e8f0' } },
        },
        {
          type: 'value',
          name: 'USD',
          axisLabel: {
            color: '#64748b',
            formatter: (value: number) => (Math.abs(value) >= 1000 ? `$${(value / 1000).toFixed(0)}k` : `$${value}`),
          },
          splitLine: { show: false },
        },
      ],
      series: [
        { name: 'Production FTE', type: 'bar', data: months.map((m) => m.staffingFte), barMaxWidth: 14 },
        { name: 'Required FTE', type: 'bar', data: months.map((m) => m.requiredFte), barMaxWidth: 14 },
        { name: 'Understaff $', type: 'line', yAxisIndex: 1, data: months.map((m) => m.understaff), smooth: true },
        { name: 'Overstaff $', type: 'line', yAxisIndex: 1, data: months.map((m) => m.overstaff), smooth: true },
      ],
    }
  }, [portfolio.byMonth])

  const driverTrendOption = useMemo<EChartsOption>(() => {
    const months = portfolio.byMonth
    return {
      color: LEAKAGE_DRIVERS.map((driver) => driver.color),
      tooltip: { trigger: 'axis' },
      legend: {
        data: LEAKAGE_DRIVERS.map((driver) => driver.short),
        bottom: 0,
        type: 'scroll',
      },
      grid: { left: 56, right: 24, top: 24, bottom: 56 },
      xAxis: { type: 'category', data: months.map((m) => m.monthLabel), axisLabel: { color: '#64748b' } },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#64748b',
          formatter: (value: number) => (Math.abs(value) >= 1000 ? `$${(value / 1000).toFixed(0)}k` : `$${value}`),
        },
        splitLine: { lineStyle: { color: '#e2e8f0' } },
      },
      series: LEAKAGE_DRIVERS.map((driver) => ({
        name: driver.short,
        type: 'bar' as const,
        stack: 'leak',
        data: months.map((m) => m[driver.id]),
        barMaxWidth: 22,
      })),
    }
  }, [portfolio.byMonth])

  const driverPieOption = useMemo(() => {
    const items = LEAKAGE_DRIVERS.map((driver) => ({
      name: driver.label,
      value: portfolio.drivers[driver.id],
    })).filter((item) => item.value > 0)
    const option: EChartsOption = {
      color: LEAKAGE_DRIVERS.map((driver) => driver.color),
      tooltip: {
        trigger: 'item',
        formatter: (params) => {
          const p = params as { name?: string; value?: number; percent?: number }
          return `${p.name}: ${currency.format(p.value ?? 0)} (${p.percent?.toFixed(1) ?? 0}%)`
        },
      },
      legend: { bottom: 0, type: 'scroll' },
      series: [
        {
          type: 'pie',
          radius: ['40%', '66%'],
          center: ['50%', '44%'],
          data: items.length ? items : [{ name: 'No leakage', value: 1 }],
          label: { formatter: '{b}\n{d}%' },
        },
      ],
    }
    return option
  }, [portfolio.drivers])

  const totalTrendOption = useMemo<EChartsOption>(() => {
    const months = portfolio.byMonth
    return {
      color: ['#9f1239', '#be185d'],
      tooltip: { trigger: 'axis' },
      legend: { data: ['Total leakage', 'DBE projected revenue'], bottom: 0 },
      grid: { left: 56, right: 24, top: 24, bottom: 48 },
      xAxis: { type: 'category', data: months.map((m) => m.monthLabel), axisLabel: { color: '#64748b' } },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: '#64748b',
          formatter: (value: number) => (Math.abs(value) >= 1000 ? `$${(value / 1000).toFixed(0)}k` : `$${value}`),
        },
        splitLine: { lineStyle: { color: '#e2e8f0' } },
      },
      series: [
        {
          name: 'Total leakage',
          type: 'line',
          areaStyle: { opacity: 0.12 },
          data: months.map((m) => m.totalLeakage),
          smooth: true,
        },
        {
          name: 'DBE projected revenue',
          type: 'line',
          data: months.map((m) => m.dbeRevenue),
          smooth: true,
        },
      ],
    }
  }, [portfolio.byMonth])

  const exportTitle = useMemo(() => {
    const parts = ['Leakage']
    if (clientFilter !== 'all') parts.push(clientFilter)
    return parts.join('_').replace(/[^\w.-]+/g, '_')
  }, [clientFilter])

  return (
    <div className="cap-leakage saas-page">
      <ModulePageHeader
        title="Leakage"
        description="Staffing Plan gaps valued with DBE rates. Mapped by Client Name + Location + Project Code. Drivers: under/overstaff, attrition, absenteeism, in-office shrinkage, AHT, and call volume — each measuring actual against plan."
        actions={
          <div className="cap-dbe__toolbar">
            <label className="cap-dbe__year">
              <span>Fiscal year</span>
              <select value={fiscalStartYear} onChange={(event) => setFiscalStartYear(Number(event.target.value))}>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    FY {y}–{String(y + 1).slice(2)}
                  </option>
                ))}
              </select>
            </label>
            <label className="cap-dbe__year">
              <span>Client Name</span>
              <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
                <option value="all">All clients</option>
                {clients.map((client) => (
                  <option key={client} value={client}>
                    {client}
                  </option>
                ))}
              </select>
            </label>
            <label className="cap-dbe__year">
              <span>Location</span>
              <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
                <option value="all">All locations</option>
                {locations.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </label>
            <label className="cap-dbe__year">
              <span>Project Code</span>
              <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                <option value="all">All project codes</option>
                {projectCodes.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
            <details className="cap-capacity-download-menu">
              <summary className="saas-btn saas-btn--secondary cap-capacity-download-menu__trigger">Download</summary>
              <div className="cap-capacity-download-menu__panel">
                <button
                  type="button"
                  className="cap-capacity-download-menu__item"
                  onClick={() => downloadLeakageWorkbook(portfolio, exportTitle)}
                >
                  Excel report
                </button>
                <button
                  type="button"
                  className="cap-capacity-download-menu__item"
                  onClick={() => downloadLeakageCsv(portfolio, exportTitle)}
                >
                  Data (CSV)
                </button>
              </div>
            </details>
          </div>
        }
      />

      <section className="cap-leakage__kpis">
        <article className="cap-leakage__kpi cap-leakage__kpi--warn">
          <span>Total leakage</span>
          <strong>{currency.format(portfolio.totals.totalLeakage)}</strong>
        </article>
        {LEAKAGE_DRIVERS.map((driver) => (
          <article key={driver.id} className="cap-leakage__kpi">
            <span>{driver.short}</span>
            <strong>{currency.format(portfolio.totals[driver.id])}</strong>
            {driver.id === 'aht' && portfolio.totals.ahtLeakHours > 0 ? (
              <small>{hours.format(portfolio.totals.ahtLeakHours)} hrs over plan</small>
            ) : null}
          </article>
        ))}
      </section>

      <p className="cap-leakage__match">
        {portfolio.pairs.length} mapped line{portfolio.pairs.length === 1 ? '' : 's'} · Client + Location + Project
        Code
        {portfolio.unmatchedStaffing ? ` · ${portfolio.unmatchedStaffing} staffing without DBE rates` : ''}
        {portfolio.unmatchedDbe ? ` · ${portfolio.unmatchedDbe} DBE-only` : ''}
        . $ rates come from the matched DBE bill rate method.
      </p>

      <div className="cap-leakage__charts">
        <article className="cap-panel cap-leakage__chart-card">
          <h3 className="cap-panel__title">Staffing FTE vs under/overstaff $</h3>
          <ReactECharts option={staffingChartOption} style={{ height: 300 }} notMerge lazyUpdate />
        </article>
        <article className="cap-panel cap-leakage__chart-card">
          <h3 className="cap-panel__title">Leakage drivers by month</h3>
          <ReactECharts option={driverTrendOption} style={{ height: 300 }} notMerge lazyUpdate />
        </article>
        <article className="cap-panel cap-leakage__chart-card">
          <h3 className="cap-panel__title">Leakage mix</h3>
          <ReactECharts option={driverPieOption} style={{ height: 300 }} notMerge lazyUpdate />
        </article>
        <article className="cap-panel cap-leakage__chart-card">
          <h3 className="cap-panel__title">Total leakage vs DBE revenue</h3>
          <ReactECharts option={totalTrendOption} style={{ height: 300 }} notMerge lazyUpdate />
        </article>
      </div>

      <section className="cap-panel">
        <h3 className="cap-panel__title">Mapped Client · Location · Project Code</h3>
        <p className="cap-panel__desc">
          Each Staffing Plan LOB is valued with DBE rates when Client Name, Location, and Project Code match.
          Absenteeism and in-office shrinkage are the out-of-office and in-office overruns shown apart from each
          other, with Break excluded. AHT values the hours lost to handling above plan, at the DBE hourly rate.
        </p>
        {portfolio.pairs.length === 0 ? (
          <p className="cap-dbe__empty">No Staffing Plan or DBE data yet.</p>
        ) : (
          <div className="cap-dbe__scroll">
            <table className="cap-dbe__table">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Location</th>
                  <th>Project Code</th>
                  <th>Link</th>
                  {LEAKAGE_DRIVERS.map((driver) => (
                    <th key={driver.id} className="cap-dbe__num">
                      {driver.short}
                    </th>
                  ))}
                  <th className="cap-dbe__num">Total</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.pairs.map((pair) => {
                  const byDriver = LEAKAGE_DRIVERS.map((driver) => ({
                    id: driver.id,
                    value: pair.months.reduce((sum, m) => sum + m.drivers[driver.id], 0),
                  }))
                  const pairTotal = byDriver.reduce((sum, entry) => sum + entry.value, 0)
                  return (
                    <tr key={pair.key}>
                      <td>
                        <strong>{pair.clientName}</strong>
                        <span className="cap-dbe__sub">{pair.lobName || '—'}</span>
                      </td>
                      <td>{pair.location || '—'}</td>
                      <td>{pair.projectCode || '—'}</td>
                      <td>
                        <span className="cap-dbe__pill">
                          {pair.scenarioId && pair.dbeLineId
                            ? 'Staffing + DBE rates'
                            : pair.dbeLineId
                              ? 'DBE only'
                              : 'No DBE rates'}
                        </span>
                      </td>
                      {byDriver.map((entry) => (
                        <td key={entry.id} className="cap-dbe__num">
                          {currency.format(entry.value)}
                        </td>
                      ))}
                      <td className="cap-dbe__num cap-dbe__year-rev">{currency.format(pairTotal)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

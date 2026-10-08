import { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { ModulePageHeader } from '../components/shell/ModulePageHeader'
import { useDemoSession } from '../context/DemoSessionContext'
import { usePlanner } from '../context/PlannerContext'
import {
  derivePortfolioForecast,
  derivePortfolioLedger,
  loadCapacityPortfolio,
  loadDbePortfolio,
  portfolioPlanOverrides,
  type DbePortfolioOwner,
  type PortfolioOwner,
} from '../data/capacityPortfolio'
import { subscribeCacheReloaded } from '../data/capacityDocuments'
import { loadDbeLines, listDbeClients, listDbeLocations, type DbeLobLine } from '../planner/dbe/dbePersistence'
import { downloadLeakageCsv, downloadLeakageWorkbook } from '../planner/dbe/dbeExport'
import { buildStaffingDbeLeakage, LEAKAGE_DRIVERS } from '../planner/dbe/staffingDbeLeakage'
import type { WeekCapacityPlanOverride } from '../planner/capacityPlanOverridePersistence'
import type { ScenarioForecastPackage } from '../planner/forecasting'
import { resolvePlanLocation } from '../planner/planIdentity'
import type { PlannerScenario } from '../planner/types'
import type { WeeklyLedgerRow } from '../planner/weeklyLedger'
import { isManagerOrAbove } from '../utils/accessLevel'

const currency = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const hours = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 })
const FORECAST_HORIZON = 52

export function LeakagePage() {
  const {
    scenarios,
    getScenarioLedger,
    getScenarioForecast,
    getScenarioCapacityPlanOverrides,
  } = usePlanner()
  const { accessLevel, user } = useDemoSession()

  // Manager+ see every planner's staffing plans (same portfolio as Summary), not only their own.
  const seesEveryPlanner = isManagerOrAbove(accessLevel)
  const ownEmail = user?.email ?? ''

  const [dbeLines, setDbeLines] = useState(() => loadDbeLines())
  useEffect(() => {
    setDbeLines(loadDbeLines())
  }, [])

  const [foreignOwners, setForeignOwners] = useState<PortfolioOwner[]>([])
  const [foreignDbeOwners, setForeignDbeOwners] = useState<DbePortfolioOwner[]>([])
  const [portfolioError, setPortfolioError] = useState('')
  const [portfolioLoading, setPortfolioLoading] = useState(seesEveryPlanner)

  useEffect(() => {
    if (!seesEveryPlanner) {
      setForeignOwners([])
      setForeignDbeOwners([])
      setPortfolioError('')
      setPortfolioLoading(false)
      return
    }
    let cancelled = false
    const load = () => {
      setPortfolioLoading(true)
      Promise.all([loadCapacityPortfolio(ownEmail), loadDbePortfolio(ownEmail)])
        .then(([owners, dbeOwners]) => {
          if (cancelled) return
          setForeignOwners(owners)
          setForeignDbeOwners(dbeOwners)
          setPortfolioError('')
          setPortfolioLoading(false)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          console.error('Could not load other planners’ plans for Leakage:', error)
          setForeignOwners([])
          setForeignDbeOwners([])
          setPortfolioError('Showing your plans only — other planners’ data could not be loaded.')
          setPortfolioLoading(false)
        })
    }
    load()
    const unsubscribe = subscribeCacheReloaded(() => {
      setDbeLines(loadDbeLines())
      load()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [ownEmail, seesEveryPlanner])

  const foreignDerived = useMemo(() => {
    const derived = new Map<
      string,
      {
        scenario: PlannerScenario
        ledger: WeeklyLedgerRow[]
        forecast: ScenarioForecastPackage | null
        overrides: Record<string, WeekCapacityPlanOverride>
      }
    >()
    for (const owner of foreignOwners) {
      for (const scenario of owner.scenarios) {
        if (scenario.isBaseline) continue
        if (derived.has(scenario.id) || scenarios.some((own) => own.id === scenario.id)) continue
        const ledger = derivePortfolioLedger(owner, scenario)
        derived.set(scenario.id, {
          scenario,
          ledger,
          forecast: derivePortfolioForecast(owner, scenario, ledger, FORECAST_HORIZON),
          overrides: portfolioPlanOverrides(owner, scenario),
        })
      }
    }
    return derived
  }, [foreignOwners, scenarios])

  const allScenarios = useMemo(
    () => [...scenarios, ...[...foreignDerived.values()].map((entry) => entry.scenario)],
    [foreignDerived, scenarios],
  )

  const allDbeLines = useMemo(
    (): DbeLobLine[] => [...dbeLines, ...foreignDbeOwners.flatMap((owner) => owner.lines)],
    [dbeLines, foreignDbeOwners],
  )

  const leakageDeps = useMemo(
    () => ({
      getScenarioLedger: (scenarioId: string) =>
        foreignDerived.get(scenarioId)?.ledger ?? getScenarioLedger(scenarioId),
      getScenarioForecast: (scenarioId: string, horizon = FORECAST_HORIZON) =>
        foreignDerived.get(scenarioId)?.forecast ?? getScenarioForecast(scenarioId, horizon),
      getScenarioCapacityPlanOverrides: (scenarioId: string) =>
        foreignDerived.get(scenarioId)?.overrides ?? getScenarioCapacityPlanOverrides(scenarioId),
    }),
    [foreignDerived, getScenarioLedger, getScenarioForecast, getScenarioCapacityPlanOverrides],
  )

  const [fiscalStartYear, setFiscalStartYear] = useState(() => {
    const now = new Date()
    return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  })
  /** Multi-select clients. Empty array = all clients. */
  const [selectedClients, setSelectedClients] = useState<string[]>([])
  const [locationFilter, setLocationFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')

  const clients = useMemo(() => {
    // Manager+: every staffing-plan client from every planner (plus DBE clients).
    const fromStaff = [
      ...new Set(
        allScenarios.filter((s) => !s.isBaseline).map((s) => s.plan.client.trim()).filter(Boolean),
      ),
    ]
    const fromDbe = seesEveryPlanner ? listDbeClients(allDbeLines) : listDbeClients(dbeLines)
    return [...new Set([...fromStaff, ...fromDbe])].sort((a, b) => a.localeCompare(b))
  }, [allDbeLines, allScenarios, dbeLines, seesEveryPlanner])

  const clientFilterActive = selectedClients.length > 0

  const locations = useMemo(() => {
    const scopedScenarios = allScenarios.filter((s) => {
      if (s.isBaseline) return false
      if (!clientFilterActive) return true
      return selectedClients.some(
        (client) => s.plan.client.trim().toLowerCase() === client.trim().toLowerCase(),
      )
    })
    const scopedDbe = !clientFilterActive
      ? allDbeLines
      : allDbeLines.filter((line) =>
          selectedClients.some(
            (client) => line.clientName.trim().toLowerCase() === client.trim().toLowerCase(),
          ),
        )
    const fromDbe = listDbeLocations(scopedDbe)
    const fromStaff = scopedScenarios
      .map((s) => resolvePlanLocation(s.plan) || s.plan.location || '')
      .map((s) => s.trim())
      .filter(Boolean)
    return [...new Set([...fromDbe, ...fromStaff])].sort((a, b) => a.localeCompare(b))
  }, [allDbeLines, allScenarios, clientFilterActive, selectedClients])

  const projectCodes = useMemo(() => {
    const scopedScenarios = allScenarios.filter((s) => {
      if (s.isBaseline) return false
      if (
        clientFilterActive &&
        !selectedClients.some(
          (client) => s.plan.client.trim().toLowerCase() === client.trim().toLowerCase(),
        )
      ) {
        return false
      }
      if (locationFilter !== 'all') {
        const loc = (resolvePlanLocation(s.plan) || s.plan.location || '').trim().toLowerCase()
        if (loc !== locationFilter.trim().toLowerCase()) return false
      }
      return true
    })
    const scopedDbe = allDbeLines.filter((line) => {
      if (
        clientFilterActive &&
        !selectedClients.some(
          (client) => line.clientName.trim().toLowerCase() === client.trim().toLowerCase(),
        )
      ) {
        return false
      }
      if (
        locationFilter !== 'all' &&
        line.location.trim().toLowerCase() !== locationFilter.trim().toLowerCase()
      ) {
        return false
      }
      return true
    })
    const fromDbe = scopedDbe.map((line) => line.projectCode.trim()).filter(Boolean)
    const fromStaff = scopedScenarios.map((s) => (s.plan.projectCode ?? '').trim()).filter(Boolean)
    return [...new Set([...fromDbe, ...fromStaff])].sort((a, b) => a.localeCompare(b))
  }, [allDbeLines, allScenarios, clientFilterActive, locationFilter, selectedClients])

  useEffect(() => {
    setSelectedClients((prev) => prev.filter((client) => clients.includes(client)))
  }, [clients])

  useEffect(() => {
    if (locationFilter !== 'all' && !locations.some((loc) => loc === locationFilter)) {
      setLocationFilter('all')
    }
  }, [locations, locationFilter])

  useEffect(() => {
    if (projectFilter !== 'all' && !projectCodes.some((code) => code === projectFilter)) {
      setProjectFilter('all')
    }
  }, [projectCodes, projectFilter])

  const portfolio = useMemo(
    () =>
      buildStaffingDbeLeakage(allScenarios, allDbeLines, leakageDeps, fiscalStartYear, {
        clients: selectedClients.length ? selectedClients : undefined,
        location: locationFilter === 'all' ? undefined : locationFilter,
        projectCode: projectFilter === 'all' ? undefined : projectFilter,
      }),
    [
      allScenarios,
      allDbeLines,
      leakageDeps,
      fiscalStartYear,
      selectedClients,
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
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => {
          const list = Array.isArray(params) ? params : [params]
          const axis = String((list[0] as { axisValue?: string })?.axisValue ?? '')
          const month = months.find((item) => item.monthLabel === axis)
          const lines = [`<strong>${axis}</strong>`]
          for (const item of list as Array<{ seriesName?: string; marker?: string; data?: number | null }>) {
            const value = item.data
            const display =
              value == null || (typeof value === 'number' && Number.isNaN(value))
                ? 'Not available'
                : typeof value === 'number' && item.seriesName?.includes('$')
                  ? currency.format(value)
                  : hours.format(Number(value))
            lines.push(`${item.marker ?? ''}${item.seriesName}: ${display}`)
          }
          if (month?.requiredFteMissingLabels.length) {
            lines.push(
              `<em>Required Production FTE missing: ${month.requiredFteMissingLabels.join('; ')}</em>`,
            )
          }
          return lines.join('<br/>')
        },
      },
      legend: {
        data: ['Production FTE', 'Required Production FTE', 'Understaff $', 'Overstaff $'],
        bottom: 0,
      },
      grid: { left: 56, right: 56, top: 28, bottom: 56 },
      xAxis: {
        type: 'category',
        data: months.map((m) => m.monthLabel),
        axisLabel: { color: '#64748b', hideOverlap: true },
        name: 'Month',
        nameLocation: 'middle',
        nameGap: 28,
      },
      yAxis: [
        {
          type: 'value',
          name: 'FTE (sum)',
          axisLabel: { color: '#64748b' },
          splitLine: { lineStyle: { color: '#e2e8f0' } },
        },
        {
          type: 'value',
          name: 'USD',
          axisLabel: {
            color: '#64748b',
            formatter: (value: number) =>
              Math.abs(value) >= 1000 ? `$${(value / 1000).toFixed(0)}k` : `$${value}`,
          },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Production FTE',
          type: 'bar',
          data: months.map((m) => m.staffingFte),
          barMaxWidth: 14,
        },
        {
          name: 'Required Production FTE',
          type: 'bar',
          data: months.map((m) => m.requiredFte),
          barMaxWidth: 14,
        },
        {
          name: 'Understaff $',
          type: 'line',
          yAxisIndex: 1,
          data: months.map((m) => m.understaff),
          smooth: true,
        },
        {
          name: 'Overstaff $',
          type: 'line',
          yAxisIndex: 1,
          data: months.map((m) => m.overstaff),
          smooth: true,
        },
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
    if (selectedClients.length === 1) parts.push(selectedClients[0]!)
    else if (selectedClients.length > 1) parts.push(`${selectedClients.length}clients`)
    return parts.join('_').replace(/[^\w.-]+/g, '_')
  }, [selectedClients])

  function toggleClient(client: string) {
    setSelectedClients((prev) => {
      const next = prev.includes(client) ? prev.filter((item) => item !== client) : [...prev, client]
      setLocationFilter('all')
      setProjectFilter('all')
      return next
    })
  }

  return (
    <div className="cap-leakage saas-page">
      <ModulePageHeader
        title="Leakage"
        description={
          seesEveryPlanner
            ? 'Staffing Plan gaps valued with DBE rates across every planner’s plans. Mapped by Client · Location · Project Code.'
            : 'Staffing Plan gaps valued with DBE rates. Mapped by Client · Location · Project Code.'
        }
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
            <label className="cap-dbe__year cap-leakage__clients">
              <span>Client Name (multi-select)</span>
              <div className="cap-leakage__client-multi" role="group" aria-label="Clients">
                <button
                  type="button"
                  className={`cap-period-filter__chip${!selectedClients.length ? ' is-active' : ''}`}
                  onClick={() => {
                    setSelectedClients([])
                    setLocationFilter('all')
                    setProjectFilter('all')
                  }}
                >
                  All clients
                </button>
                {clients.map((client) => (
                  <button
                    key={client}
                    type="button"
                    className={`cap-period-filter__chip${selectedClients.includes(client) ? ' is-active' : ''}`}
                    aria-pressed={selectedClients.includes(client)}
                    onClick={() => toggleClient(client)}
                  >
                    {client}
                  </button>
                ))}
              </div>
            </label>
            <label className="cap-dbe__year">
              <span>Location</span>
              <select
                value={locationFilter}
                onChange={(event) => {
                  setLocationFilter(event.target.value)
                  setProjectFilter('all')
                }}
              >
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

      {seesEveryPlanner ? (
        <p className="cap-leakage__match saas-muted">
          {portfolioLoading
            ? 'Loading every planner’s staffing plans…'
            : portfolioError
              ? portfolioError
              : `Client filter includes ${clients.length} client${clients.length === 1 ? '' : 's'} from ${foreignOwners.length + 1} planner${foreignOwners.length + 1 === 1 ? '' : 's'}${foreignOwners.length ? '' : ' (no other planners have saved a plan yet)'}.`}
        </p>
      ) : null}

      <p className="cap-leakage__match">
        {portfolio.pairs.length} mapped line{portfolio.pairs.length === 1 ? '' : 's'} · Client + Location + Project
        Code
        {portfolio.unmatchedStaffing ? ` · ${portfolio.unmatchedStaffing} staffing without DBE rates` : ''}
        {portfolio.unmatchedDbe ? ` · ${portfolio.unmatchedDbe} DBE-only` : ''}
        . $ rates come from the matched DBE bill rate method.
        {selectedClients.length
          ? ` · Combined chart sums Production FTE and Required Production FTE across ${selectedClients.length} selected client${selectedClients.length === 1 ? '' : 's'}.`
          : ' · Combined chart sums Production FTE and Required Production FTE across all clients in scope.'}
      </p>

      {portfolio.missingRequiredFteLabels.length ? (
        <p className="cap-leakage__missing-required" role="status">
          Required Production FTE is missing on Staffing Plan for:{' '}
          {portfolio.missingRequiredFteLabels.join('; ')}. Those series are shown as blank on the
          FTE chart — not zero.
        </p>
      ) : null}

      <div className="cap-leakage__charts">
        <article className="cap-panel cap-leakage__chart-card">
          <h3 className="cap-panel__title">Production FTE vs Required Production FTE (combined sum)</h3>
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
          Attrition is Actual vs Planned production HC attrition. Absenteeism and in-office shrinkage are
          category overruns (Actual − Planned). In-office leakage includes Not Billable
          categories only (Break included when Not Billable; billable time is excluded).
          AHT values the hours lost to handling above plan, at the DBE hourly rate.
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

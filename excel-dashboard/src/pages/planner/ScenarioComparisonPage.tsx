import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import { useDemoSession } from '../../context/DemoSessionContext'
import { usePlanner } from '../../context/PlannerContext'
import { runSimulation } from '../../planner/engine'
import { fmtCurrency, fmtNum, fmtPct } from '../../planner/format'
import { METRIC_LABELS } from '../../planner/metricLabels'
import { APP_THEME } from '../../utils/appTheme'
import {
  CHART_HEIGHT_COMPACT,
  compactAxisTooltip,
  compactCategoryAxis,
  compactGrid,
  compactLegend,
  compactValueAxis,
} from '../../utils/echartsCompact'

function planMetaLabel(plan: { client: string; location: string; billingType: string }) {
  return `${plan.client} · ${plan.location} · ${plan.billingType}`
}

export function ScenarioComparisonPage() {
  const navigate = useNavigate()
  const {
    scenarios,
    comparisonIds,
    setComparisonIds,
    comparisonTable,
    comparisonResults,
    capacityPlanView,
    granularity,
    publishScenarioToCapacity,
    resetToPreviousCapacityPlan,
    hasPreviousCapacityPlan,
    selectScenario,
  } = usePlanner()
  const { canViewFinancials } = useDemoSession()
  const [publishNotice, setPublishNotice] = useState<string | null>(null)

  const scenarioRows = useMemo(
    () =>
      scenarios.map((scenario) => {
        const result = runSimulation(scenario, granularity)
        const lastPeriod = result.periods[result.periods.length - 1]
        return {
          scenario,
          result,
          lastPeriod,
          isPublished: capacityPlanView?.scenarioId === scenario.id,
        }
      }),
    [capacityPlanView?.scenarioId, granularity, scenarios],
  )

  const visibleComparisonRows = useMemo(
    () => scenarioRows.filter((row) => comparisonIds.includes(row.scenario.id)),
    [comparisonIds, scenarioRows],
  )

  const toggle = (id: string) => {
    setComparisonIds(comparisonIds.includes(id) ? comparisonIds.filter((x) => x !== id) : [...comparisonIds, id])
  }

  const openScenarioToCapacity = (scenarioId: string) => {
    const scenario = scenarios.find((item) => item.id === scenarioId)
    if (!scenario) return
    publishScenarioToCapacity(scenarioId)
    selectScenario(scenarioId)
    setPublishNotice(`Opened ${scenario.name} in Capacity. Use Publish there for further updates.`)
    window.setTimeout(() => setPublishNotice(null), 3000)
    navigate('/capacity-plan')
  }

  const resetPreviousCapacity = () => {
    const restored = resetToPreviousCapacityPlan()
    if (!restored) return
    setPublishNotice('Previous capacity plan restored and republished.')
    window.setTimeout(() => setPublishNotice(null), 3000)
    navigate('/capacity-plan')
  }

  const chartOption =
    comparisonResults.length > 0
      ? {
          tooltip: compactAxisTooltip(),
          legend: compactLegend(['Revenue', 'Cost', 'Profitability']),
          grid: compactGrid(),
          xAxis: compactCategoryAxis(comparisonResults.map((r) => r.scenarioName)),
          yAxis: compactValueAxis({ currency: true }),
          color: APP_THEME.chart,
          series: [
            { name: 'Revenue', type: 'bar', barMaxWidth: 28, data: comparisonResults.map((r) => Math.round(r.summary.revenueProjection)) },
            { name: 'Cost', type: 'bar', barMaxWidth: 28, data: comparisonResults.map((r) => Math.round(r.summary.costProjection)) },
            {
              name: 'Profitability',
              type: 'bar',
              barMaxWidth: 28,
              data: comparisonResults.map((r) => Math.round(r.summary.profitability)),
            },
          ],
        }
      : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="m-0 text-lg font-bold text-slate-900">Scenario comparison</h2>
          <p className="mt-1 text-sm text-slate-600">
            Compare each scenario side by side. Use <strong>Open</strong> to open the Capacity view with Publish, or{' '}
            <strong>Reset</strong> to republish the previous capacity plan.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasPreviousCapacityPlan() ? (
            <button type="button" className="saas-btn saas-btn--secondary text-sm" onClick={resetPreviousCapacity}>
              Reset previous capacity
            </button>
          ) : null}
          <button
            type="button"
            className="saas-btn saas-btn--secondary text-sm"
            onClick={() => setComparisonIds(scenarios.map((s) => s.id))}
          >
            Select all scenarios
          </button>
        </div>
      </div>

      {publishNotice ? (
        <div className="roster-alert" role="status">
          <span className="roster-alert__icon" aria-hidden>
            ✓
          </span>
          <span>
            {publishNotice}{' '}
            <Link to="/capacity-plan" className="roster-sync__link">
              View Capacity matrix
            </Link>
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {scenarios.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
              comparisonIds.includes(s.id)
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
            onClick={() => toggle(s.id)}
          >
            {s.name}
            {capacityPlanView?.scenarioId === s.id ? ' · Published' : ''}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="wfp-table w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-bold uppercase text-slate-600">
            <tr>
              <th className="px-4 py-3">Scenario</th>
              <th className="px-4 py-3">Client / LOB</th>
              <th className="px-4 py-3">{METRIC_LABELS.requiredHeadcount}</th>
              <th className="px-4 py-3">{METRIC_LABELS.productionFte}</th>
              <th className="px-4 py-3">{METRIC_LABELS.productionHeadcount}</th>
              <th className="px-4 py-3">Hiring (horizon)</th>
              <th className="px-4 py-3">{METRIC_LABELS.staffingPct}</th>
              {canViewFinancials ? <th className="px-4 py-3">Revenue (horizon)</th> : null}
              <th className="px-4 py-3">Capacity</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {scenarioRows.map(({ scenario, result, lastPeriod, isPublished }) => (
              <tr
                key={scenario.id}
                className={`border-t border-slate-100${comparisonIds.includes(scenario.id) ? ' bg-slate-50/80' : ''}`}
              >
                <td className="px-4 py-3 font-medium">
                  {scenario.name}
                  {scenario.isBaseline ? <span className="saas-badge saas-badge--muted ml-2">Reference</span> : null}
                </td>
                <td className="px-4 py-3 text-slate-600">{planMetaLabel(scenario.plan)}</td>
                <td className="px-4 py-3">{fmtNum(result.summary.requiredFte, 1)}</td>
                <td className="px-4 py-3">{fmtNum(result.summary.productionFte, 1)}</td>
                <td className="px-4 py-3">{fmtNum(result.summary.workforceFte, 1)}</td>
                <td className="px-4 py-3">{fmtNum(result.summary.hiringTotal, 0)}</td>
                <td className="px-4 py-3">
                  {lastPeriod?.staffingPct == null ? '—' : fmtPct(lastPeriod.staffingPct)}
                </td>
                {canViewFinancials ? (
                  <td className="px-4 py-3">{fmtCurrency(result.summary.revenueProjection)}</td>
                ) : null}
                <td className="px-4 py-3">
                  {isPublished ? <span className="saas-badge">Published</span> : <span className="saas-muted">—</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="saas-btn saas-btn--secondary text-xs" onClick={() => openScenarioToCapacity(scenario.id)}>
                      {isPublished ? 'Republish' : 'Open'}
                    </button>
                    {isPublished && hasPreviousCapacityPlan() ? (
                      <button type="button" className="saas-btn saas-btn--secondary text-xs" onClick={resetPreviousCapacity}>
                        Reset
                      </button>
                    ) : null}
                    <button type="button" className="cap-link cap-link--muted" onClick={() => selectScenario(scenario.id)}>
                      Edit assumptions
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {comparisonTable.length ? (
        <>
          <section className="cap-published-comparison">
            <h3 className="cap-published-comparison__title">Delta vs comparison baseline</h3>
            <p className="cap-published-comparison__meta m-0">
              Showing {visibleComparisonRows.length} selected scenario{visibleComparisonRows.length === 1 ? '' : 's'} relative to the first selected plan.
            </p>
            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="wfp-table w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs font-bold uppercase text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Scenario</th>
                    <th className="px-4 py-3">Staffing Δ</th>
                    {canViewFinancials ? (
                      <>
                        <th className="px-4 py-3">Revenue Δ</th>
                        <th className="px-4 py-3">Cost Δ</th>
                        <th className="px-4 py-3">Margin Δ</th>
                        <th className="px-4 py-3">Leakage Δ</th>
                      </>
                    ) : null}
                    <th className="px-4 py-3">Hiring Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonTable.map((row) => (
                    <tr key={row.scenarioId} className="border-t border-slate-100">
                      <td className="px-4 py-3 font-medium">{row.scenarioName}</td>
                      <td className="px-4 py-3">{fmtNum(row.staffingDelta, 1)}</td>
                      {canViewFinancials ? (
                        <>
                          <td className="px-4 py-3">{fmtCurrency(row.revenueDelta)}</td>
                          <td className="px-4 py-3">{fmtCurrency(row.costDelta)}</td>
                          <td className="px-4 py-3">{fmtCurrency(row.marginDelta)}</td>
                          <td className="px-4 py-3">{fmtCurrency(row.leakageDelta)}</td>
                        </>
                      ) : null}
                      <td className="px-4 py-3">{fmtNum(row.hiringDelta, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {canViewFinancials && chartOption ? (
            <div className="exec-chart-card">
              <h3 className="exec-chart-card__title">Financial impact by scenario</h3>
              <ReactECharts theme="ledger" option={chartOption} style={{ height: CHART_HEIGHT_COMPACT }} notMerge />
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-slate-600">Select at least one scenario above to see delta comparison.</p>
      )}
    </div>
  )
}

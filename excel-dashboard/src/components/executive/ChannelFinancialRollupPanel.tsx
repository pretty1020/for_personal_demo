import { useMemo } from 'react'
import { usePlanner } from '../../context/PlannerContext'
import { useCapacityFinancial } from '../../context/CapacityFinancialContext'
import { aggregateClientChannelFinancials } from '../../planner/channelPlanning'
import { runSimulation } from '../../planner/engine'
import { fmtCurrency, fmtNum, fmtPct } from '../../planner/format'
import { resolveCapacityFinancialScope } from '../../planner/capacityFinancialScope'
import { CHANNEL_LABELS } from '../../planner/types'

export function ChannelFinancialRollupPanel() {
  const { scenarios } = usePlanner()
  const { scopeId } = useCapacityFinancial()
  const scope = resolveCapacityFinancialScope(scenarios, { scopeId })

  const rollup = useMemo(() => {
    if (!scope) return null
    const targetScenarios = scope.isCombined ? scope.clientScenarios : scope.linkedScenario ? [scope.linkedScenario] : []
    if (!targetScenarios.length) return null

    const financialsByScenario = new Map(
      targetScenarios.map((scenario) => {
        const result = runSimulation(scenario, 'weekly')
        const last = result.periods[result.periods.length - 1]
        return [scenario.id, last?.channelFinancials ?? []] as const
      }),
    )

    return aggregateClientChannelFinancials(targetScenarios, financialsByScenario)
  }, [scope, scenarios])

  if (!rollup?.channels.length) return null

  const { totals } = rollup

  return (
    <section className="cap-panel mt-4">
      <h3 className="cap-panel__title">Channel financial rollup — {rollup.scopeLabel}</h3>
      <p className="cap-panel__desc m-0 mt-1">
        Per-channel financial metrics aggregated at {rollup.scopeType} level. Drill down by channel below.
      </p>

      <div className="exec-kpi-grid mt-4">
        <div className="exec-kpi-card">
          <span className="exec-kpi-card__label">Total Revenue</span>
          <strong className="exec-kpi-card__value">{fmtCurrency(totals.revenue)}</strong>
        </div>
        <div className="exec-kpi-card">
          <span className="exec-kpi-card__label">Total Labor Cost</span>
          <strong className="exec-kpi-card__value">{fmtCurrency(totals.laborCost)}</strong>
        </div>
        <div className="exec-kpi-card">
          <span className="exec-kpi-card__label">Gross Margin</span>
          <strong className="exec-kpi-card__value">{fmtCurrency(totals.grossMargin)}</strong>
        </div>
        <div className="exec-kpi-card">
          <span className="exec-kpi-card__label">Staffing Gap</span>
          <strong className="exec-kpi-card__value">{fmtNum(totals.staffingGap, 1)}</strong>
        </div>
        <div className="exec-kpi-card">
          <span className="exec-kpi-card__label">Capacity Utilization</span>
          <strong className="exec-kpi-card__value">{fmtPct(totals.capacityUtilization)}</strong>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
        <table className="wfp-table w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-bold uppercase text-slate-600">
            <tr>
              <th className="px-4 py-3">Channel</th>
              <th className="px-4 py-3">Required FTE</th>
              <th className="px-4 py-3">Production FTE</th>
              <th className="px-4 py-3">Staffing Gap</th>
              <th className="px-4 py-3">Revenue</th>
              <th className="px-4 py-3">Labor Cost</th>
              <th className="px-4 py-3">Gross Margin</th>
              <th className="px-4 py-3">GM %</th>
              <th className="px-4 py-3">Cost / Contact</th>
            </tr>
          </thead>
          <tbody>
            {rollup.channels.map((row) => (
              <tr key={row.channel} className="border-t border-slate-100">
                <td className="px-4 py-3 font-medium">{CHANNEL_LABELS[row.channel]}</td>
                <td className="px-4 py-3">{fmtNum(row.requiredFte, 2)}</td>
                <td className="px-4 py-3">{fmtNum(row.productionFte, 2)}</td>
                <td className="px-4 py-3">{fmtNum(row.staffingGap, 2)}</td>
                <td className="px-4 py-3">{fmtCurrency(row.revenue)}</td>
                <td className="px-4 py-3">{fmtCurrency(row.laborCost)}</td>
                <td className="px-4 py-3">{fmtCurrency(row.grossMargin)}</td>
                <td className="px-4 py-3">{fmtPct(row.grossMarginPct)}</td>
                <td className="px-4 py-3">{fmtCurrency(row.costPerContact)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

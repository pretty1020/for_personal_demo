import { usePlanner } from '../../context/PlannerContext'
import { plannerSnapshotLabel } from '../../planner/displayKpis'

/** Compact scenario + publish status for Planning Simulator header. */
export function PlannerScenarioStatus() {
  const { activeScenario, capacityPlanView, activeResult, granularity } = usePlanner()
  if (!activeScenario) return null

  const published = capacityPlanView?.scenarioId === activeScenario.id
  const snapshot =
    activeResult && activeResult.scenarioId === activeScenario.id
      ? plannerSnapshotLabel(activeResult, granularity)
      : null

  return (
    <div className="planner-scenario-status">
      <span className="planner-scenario-status__name">{activeScenario.name}</span>
      <span className="planner-scenario-status__period">
        {activeScenario.plan.client} · {activeScenario.plan.location} LOB · {activeScenario.plan.billingType} ·{' '}
        {activeScenario.plan.weekStart === 'monday' ? 'Mon start' : 'Sun start'}
      </span>
      {activeScenario.isBaseline ? <span className="saas-badge saas-badge--muted">Reference</span> : null}
      {published ? <span className="saas-badge">Published</span> : null}
      {snapshot ? <span className="planner-scenario-status__period">{snapshot}</span> : null}
    </div>
  )
}

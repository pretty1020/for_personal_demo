import { useState } from 'react'
import { ExecutiveSummaryPage } from './planner/ExecutiveSummaryPage'
import { PlannedVsActualPage } from './planner/PlannedVsActualPage'
import { ScenarioComparisonPage } from './planner/ScenarioComparisonPage'
import { ScenariosAssumptionsPage } from './planner/ScenariosAssumptionsPage'
import { PlannerScenarioStatus } from '../components/planner/PlannerScenarioStatus'
import { ModulePageHeader } from '../components/shell/ModulePageHeader'
import { usePlanner } from '../context/PlannerContext'

const TABS = [
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'comparison', label: 'Compare scenarios' },
  { id: 'overview', label: 'Overview' },
  { id: 'planned-vs-actual', label: 'Scenario View - Capacity' },
] as const

type TabId = (typeof TABS)[number]['id']

export function PlanningSimulatorPage() {
  const [tab, setTab] = useState<TabId>('scenarios')
  const { granularity, setGranularity } = usePlanner()

  return (
    <div className="saas-page cap-module-page cap-planning-workspace">
      <ModulePageHeader
        title="Planning Scenario"
        actions={
          <label className="cap-module-field">
            <span className="cap-module-field__label">Period</span>
            <select
              className="cap-module-field__select"
              value={granularity}
              onChange={(e) => setGranularity(e.target.value as typeof granularity)}
            >
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="quarterly">Quarterly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
        }
      />

      <section className="cap-workspace-toolbar saas-card">
        <PlannerScenarioStatus />

        <div className="saas-tabs" role="tablist" aria-label="Planning Scenario sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`saas-tabs__btn${tab === t.id ? ' saas-tabs__btn--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      <div className="saas-tab-panel" role="tabpanel">
        {tab === 'scenarios' ? <ScenariosAssumptionsPage /> : null}
        {tab === 'comparison' ? <ScenarioComparisonPage /> : null}
        {tab === 'overview' ? <ExecutiveSummaryPage /> : null}
        {tab === 'planned-vs-actual' ? <PlannedVsActualPage /> : null}
      </div>
    </div>
  )
}

import { useMemo } from 'react'
import { usePlanner } from '../../context/PlannerContext'
import { runSimulation } from '../../planner/engine'
import { formatScenarioLabel } from '../../planner/scenarioDisplay'
import type { SimulationResult } from '../../planner/types'
import { HelpTip } from './HelpTip'

type ScenarioPickerProps = {
  value: string
  onChange: (scenarioId: string) => void
  label?: string
  help?: string
}

export function ScenarioPicker({ value, onChange, label = 'Scenario', help }: ScenarioPickerProps) {
  const { scenarios, capacityPlanView } = usePlanner()
  const ordered = useMemo(() => {
    const capacityId = capacityPlanView?.scenarioId
    if (!capacityId) return scenarios
    const current = scenarios.find((scenario) => scenario.id === capacityId)
    if (!current) return scenarios
    return [current, ...scenarios.filter((scenario) => scenario.id !== capacityId)]
  }, [capacityPlanView?.scenarioId, scenarios])

  return (
    <label className="cap-scenario-picker">
      <span className="cap-scenario-picker__label-row">
        <span className="cap-field__label">{label}</span>
        {help ? <HelpTip text={help} /> : null}
      </span>
      <select className="cap-field__input cap-scenario-picker__select" value={value} onChange={(e) => onChange(e.target.value)}>
        {ordered.map((s) => (
          <option key={s.id} value={s.id}>
            {s.id === capacityPlanView?.scenarioId ? `${formatScenarioLabel(s)} · Capacity` : formatScenarioLabel(s)}
          </option>
        ))}
      </select>
    </label>
  )
}

export function useScenarioResult(scenarioId: string): SimulationResult | null {
  const { scenarios, granularity } = usePlanner()
  return useMemo(() => {
    const scenario = scenarios.find((s) => s.id === scenarioId)
    if (!scenario) return null
    return runSimulation(scenario, granularity)
  }, [scenarios, granularity, scenarioId])
}

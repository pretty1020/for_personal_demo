import { resolvePlanLob, resolvePlanLocation } from './planIdentity'
import type { PlannerScenario } from './types'

/** Single readable label for scenario pickers and headers (no repeated client/LOB). */
export function formatScenarioLabel(scenario: PlannerScenario): string {
  const client = scenario.plan.client?.trim() || 'Unassigned client'
  const lob = resolvePlanLob(scenario.plan) || 'Unassigned LOB'
  const location = resolvePlanLocation(scenario.plan)
  const code = scenario.plan.projectCode?.trim()
  const billing = scenario.plan.billingType?.trim()
  const parts = [client, lob]
  if (location) parts.push(location)
  if (code) parts.push(code)
  if (billing) parts.push(billing)
  let label = parts.join(' · ')
  if (scenario.isBaseline) label += ' (Reference)'
  return label
}

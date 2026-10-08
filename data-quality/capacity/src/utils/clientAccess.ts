import type { PlannerScenario } from '../planner/types'
import { canAccessAssignedClient, type AccessLevel } from './accessLevel'

/** Filter plans to those the current role may open. Managers: assigned clients only (no fallback). */
export function filterScenariosByClientAccess<T extends PlannerScenario>(
  scenarios: readonly T[],
  accessLevel: AccessLevel | null | undefined,
  allowedClients: readonly string[] | null | undefined,
): T[] {
  if (accessLevel !== 'manager') return [...scenarios]
  return scenarios.filter((scenario) =>
    canAccessAssignedClient(accessLevel, scenario.plan.client, allowedClients),
  )
}

export function filterClientNamesByAccess(
  clients: readonly string[],
  accessLevel: AccessLevel | null | undefined,
  allowedClients: readonly string[] | null | undefined,
): string[] {
  if (accessLevel !== 'manager') return [...clients]
  return clients.filter((client) => canAccessAssignedClient(accessLevel, client, allowedClients))
}

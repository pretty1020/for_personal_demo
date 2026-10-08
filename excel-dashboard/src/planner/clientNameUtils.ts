import type { ScenarioRosterSyncMeta } from './rosterPersistence'
import { resolvePlanLob } from './planIdentity'
import type { PlannerScenario } from './types'

/** True when a label looks like an account id (e.g. ACC-001, Account ACC-001). */
export function isAccountIdLike(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/^acc-\d+$/i.test(trimmed)) return true
  if (/^account\s+acc-/i.test(trimmed)) return true
  return /^[A-Z]{2,5}-\d{2,}$/.test(trimmed)
}

export function resolveRosterClientName(
  account: { id: string; name: string; client?: string } | null | undefined,
): string {
  if (!account) return ''
  const name = account.name.trim()
  const client = (account.client ?? '').trim()
  const id = account.id.trim()
  if (name && name !== id && !isAccountIdLike(name)) return name
  if (client && client !== id && !isAccountIdLike(client)) return client
  return name || client || id
}

export function resolveRosterLobName(
  account: { programType?: string } | null | undefined,
  fallback = '',
): string {
  return account?.programType?.trim() || fallback.trim()
}

export function findScenarioForClientAndLob(
  scenarios: PlannerScenario[],
  clientName: string,
  lob: string,
): PlannerScenario | null {
  const clientKey = clientName.trim().toLowerCase()
  const lobKey = lob.trim().toLowerCase()
  if (!clientKey) return null

  return (
    scenarios.find(
      (scenario) =>
        !scenario.isBaseline &&
        scenario.plan.client.trim().toLowerCase() === clientKey &&
        resolvePlanLob(scenario.plan).trim().toLowerCase() === lobKey,
    ) ??
    scenarios.find(
      (scenario) => !scenario.isBaseline && scenario.plan.client.trim().toLowerCase() === clientKey,
    ) ??
    null
  )
}

export function findScenarioForAccount(
  scenarios: PlannerScenario[],
  account: { id: string; name: string; client?: string; programType?: string },
  getSyncMeta: (scenarioId: string) => ScenarioRosterSyncMeta | null | undefined,
): PlannerScenario | null {
  const bySync = scenarios.find(
    (scenario) => !scenario.isBaseline && getSyncMeta(scenario.id)?.accountId === account.id,
  )
  if (bySync) return bySync

  const clientName = resolveRosterClientName(account)
  const lob = resolveRosterLobName(account)
  if (clientName && lob) {
    const match = findScenarioForClientAndLob(scenarios, clientName, lob)
    if (match) return match
  }
  if (clientName) {
    return findScenarioForClientAndLob(scenarios, clientName, '')
  }
  return null
}

export function scenarioLabelForClientLob(clientName: string, lobName: string): string {
  return `${clientName.trim()} · ${lobName.trim()}`
}

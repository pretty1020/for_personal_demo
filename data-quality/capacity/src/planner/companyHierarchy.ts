import { findClientById } from './clientRegistry'
import { normalizeProjectCode, resolvePlanLob, resolvePlanProjectCode } from './planIdentity'
import type { PlannerScenario } from './types'

export type LobHierarchyNode = {
  type: 'lob'
  scenarioId: string
  label: string
  client: string
  billingType: string
  projectCode: string
}

export type ClientHierarchyNode = {
  type: 'client'
  clientId: string | null
  label: string
  lobs: LobHierarchyNode[]
  combinedScopeId: string
}

export type ProjectCodeHierarchyNode = {
  type: 'projectCode'
  /** Display label (first seen casing). */
  label: string
  /** Normalized key used for matching / combined scope. */
  codeKey: string
  combinedScopeId: string
  scenarioIds: string[]
  clients: string[]
  teamCount: number
}

export type CompanyHierarchy = {
  clients: ClientHierarchyNode[]
  /** Project codes shared by 2+ teams (eligible for combined view). */
  sharedProjectCodes: ProjectCodeHierarchyNode[]
  executiveScopeLabel: string
}

export function buildSharedProjectCodeGroups(scenarios: PlannerScenario[]): ProjectCodeHierarchyNode[] {
  const byCode = new Map<string, PlannerScenario[]>()
  for (const scenario of scenarios.filter((item) => !item.isBaseline)) {
    const code = resolvePlanProjectCode(scenario.plan)
    if (!code) continue
    const key = normalizeProjectCode(code)
    byCode.set(key, [...(byCode.get(key) ?? []), scenario])
  }

  return [...byCode.entries()]
    .filter(([, group]) => group.length >= 2)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([codeKey, group]) => {
      const label = resolvePlanProjectCode(group[0]!.plan) || codeKey
      const clients = [...new Set(group.map((item) => item.plan.client.trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
      )
      return {
        type: 'projectCode' as const,
        label,
        codeKey,
        combinedScopeId: `combined-project:${codeKey}`,
        scenarioIds: group.map((item) => item.id),
        clients,
        teamCount: group.length,
      }
    })
}

export function buildCompanyHierarchy(scenarios: PlannerScenario[]): CompanyHierarchy {
  const active = scenarios.filter((item) => !item.isBaseline)
  const byClient = new Map<string, PlannerScenario[]>()
  for (const scenario of active) {
    const client = scenario.plan.client.trim() || 'Unassigned'
    byClient.set(client, [...(byClient.get(client) ?? []), scenario])
  }

  const clients: ClientHierarchyNode[] = [...byClient.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([clientName, clientScenarios]) => {
      const profile = clientScenarios.find((item) => item.plan.clientId)?.plan.clientId
        ? findClientById(clientScenarios.find((item) => item.plan.clientId)!.plan.clientId!)
        : null
      const lobs = [...clientScenarios]
        .sort((a, b) => resolvePlanLob(a.plan).localeCompare(resolvePlanLob(b.plan)))
        .map((scenario) => ({
          type: 'lob' as const,
          scenarioId: scenario.id,
          label: resolvePlanLob(scenario.plan),
          client: scenario.plan.client,
          billingType: scenario.plan.billingType,
          projectCode: resolvePlanProjectCode(scenario.plan),
        }))
      return {
        type: 'client' as const,
        clientId: profile?.id ?? clientScenarios[0]?.plan.clientId ?? null,
        label: clientName,
        lobs,
        combinedScopeId: `combined:${clientName}`,
      }
    })

  return {
    clients,
    sharedProjectCodes: buildSharedProjectCodeGroups(active),
    executiveScopeLabel: 'Executive Summary',
  }
}

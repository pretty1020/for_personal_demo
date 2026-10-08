import { findClientById, findClientByName } from './clientRegistry'
import { resolvePlanLob } from './planIdentity'
import type { PlannerScenario } from './types'

export type LobHierarchyNode = {
  type: 'lob'
  scenarioId: string
  label: string
  client: string
  billingType: string
}

export type ClientHierarchyNode = {
  type: 'client'
  clientId: string | null
  label: string
  industry: string
  lobs: LobHierarchyNode[]
  combinedScopeId: string
}

export type CompanyHierarchy = {
  clients: ClientHierarchyNode[]
  executiveScopeLabel: string
}

export function buildCompanyHierarchy(scenarios: PlannerScenario[]): CompanyHierarchy {
  const byClient = new Map<string, PlannerScenario[]>()
  for (const scenario of scenarios.filter((item) => !item.isBaseline)) {
    const client = scenario.plan.client.trim() || 'Unassigned'
    byClient.set(client, [...(byClient.get(client) ?? []), scenario])
  }

  const clients: ClientHierarchyNode[] = [...byClient.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([clientName, clientScenarios]) => {
      const profile =
        (clientScenarios.find((item) => item.plan.clientId)?.plan.clientId
          ? findClientById(clientScenarios.find((item) => item.plan.clientId)!.plan.clientId!)
          : null) ?? findClientByName(clientName)
      const lobs = [...clientScenarios]
        .sort((a, b) => resolvePlanLob(a.plan).localeCompare(resolvePlanLob(b.plan)))
        .map((scenario) => ({
          type: 'lob' as const,
          scenarioId: scenario.id,
          label: resolvePlanLob(scenario.plan),
          client: scenario.plan.client,
          billingType: scenario.plan.billingType,
        }))
      return {
        type: 'client' as const,
        clientId: profile?.id ?? clientScenarios[0]?.plan.clientId ?? null,
        label: clientName,
        industry: profile?.industry ?? '',
        lobs,
        combinedScopeId: `combined:${clientName}`,
      }
    })

  return {
    clients,
    executiveScopeLabel: 'Executive Summary',
  }
}

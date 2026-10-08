import { uniqueSupervisors } from '../rosterHistory'
import type { RosterEmployee } from '../rosterPersistence'
import { isActiveRosterEmployee, isAgentRole } from '../rosterRoleUtils'
import type { SchedulingAgent } from './types'

export function eligibleRosterAgentsForScheduling(roster: RosterEmployee[]): RosterEmployee[] {
  return roster.filter((employee) => {
    if (!isActiveRosterEmployee(employee) || !isAgentRole(employee)) return false
    const stage = employee.pipelineStage
    return !stage || stage === 'production'
  })
}

export function schedulingAgentsFromRoster(
  roster: RosterEmployee[],
  teamSupervisor?: string,
): SchedulingAgent[] {
  const eligible = eligibleRosterAgentsForScheduling(roster)
  const filtered = teamSupervisor?.trim()
    ? eligible.filter((employee) => (employee.supervisor ?? '').trim() === teamSupervisor.trim())
    : eligible
  return filtered.map((employee, index) => ({
    index,
    name: employee.name,
    supervisor: employee.supervisor?.trim() || undefined,
    manager: employee.manager?.trim() || undefined,
    employeeId: employee.employeeId,
  }))
}

export function agentNamesFromSchedulingAgents(agents: SchedulingAgent[]): Record<string, string> {
  return Object.fromEntries(agents.map((agent) => [String(agent.index), agent.name]))
}

export function isGenericAgentName(name: string | undefined | null): boolean {
  if (!name?.trim()) return true
  return /^(additional|agent|extra)\s+\d+$/i.test(name.trim())
}

export function defaultAgentName(index: number): string {
  return `Agent ${index + 1}`
}

export function mergeAgentNames(
  generated: Record<string, string>,
  existing: Record<string, string>,
): Record<string, string> {
  const next = { ...generated }
  for (const [key, value] of Object.entries(existing)) {
    if (!isGenericAgentName(value)) next[key] = value.trim()
  }
  return next
}

export function resolvedAgentNames(names: Record<string, string>, headcount: number): Record<string, string> {
  const generated = Object.fromEntries(
    Array.from({ length: Math.max(0, Math.floor(headcount)) }, (_, index) => [String(index), defaultAgentName(index)]),
  )
  return mergeAgentNames(generated, names)
}

export function padSchedulingAgents(agents: SchedulingAgent[], headcount: number): SchedulingAgent[] {
  const hc = Math.max(0, Math.floor(headcount))
  const next: SchedulingAgent[] = []
  for (let index = 0; index < hc; index += 1) {
    const existing = agents[index]
    const keepName = existing?.name?.trim() && !isGenericAgentName(existing.name)
    next.push({
      index,
      name: keepName ? existing!.name.trim() : defaultAgentName(index),
      supervisor: existing?.supervisor,
      manager: existing?.manager,
      employeeId: existing?.employeeId,
    })
  }
  return next
}

export function rosterSupervisors(roster: RosterEmployee[]): string[] {
  return uniqueSupervisors(eligibleRosterAgentsForScheduling(roster))
}

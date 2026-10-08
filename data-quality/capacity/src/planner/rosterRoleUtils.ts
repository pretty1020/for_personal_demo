import type { RosterEmployee } from './rosterPersistence'
import { dedupeRosterEntries } from './rosterImport'

export function isAgentRole(employee: RosterEmployee): boolean {
  const role = (employee.role || employee.position || '').trim().toLowerCase()
  return role === 'agent' || /\bagent\b/.test(role)
}

export function isActiveRosterEmployee(employee: RosterEmployee): boolean {
  if (employee.status !== 'active') return false
  const employment = (employee.employmentStatus ?? '').trim().toLowerCase()
  return !employment || employment === 'active'
}

export function countActiveAgents(roster: RosterEmployee[], fallbackClient = ''): number {
  const unique = dedupeRosterEntries(roster, fallbackClient)
  return unique.filter((employee) => isActiveRosterEmployee(employee) && isAgentRole(employee)).length
}

export function pipelineLabelForEmployee(employee: RosterEmployee): string {
  switch (employee.pipelineStage) {
    case 'pending':
      return 'Pending'
    case 'training':
      return 'Training'
    case 'nesting':
      return 'Nesting'
    case 'production':
      return 'Production'
    default:
      return employee.status === 'inactive_loa' ? 'LOA' : 'Inactive'
  }
}

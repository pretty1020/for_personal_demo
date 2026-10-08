import type { DerivedCapacityRow } from './capacityPlanDerived'
import { dedupeRosterEntries } from './rosterImport'
import type { RosterEmployee } from './rosterPersistence'
import { countActiveAgents, isActiveRosterEmployee, isAgentRole } from './rosterRoleUtils'

export type RosterCapacityMetrics = {
  activeHeadcount: number
  trainingHc: number
  nestingHc: number
  productionHc: number
  agentProductionHc: number
  supportHc: number
  offRosterLoaHc: number
  productionFte: number | null
  requiredFte: number | null
  staffingGap: number | null
  staffingPct: number | null
}
function weeklyPipelineStage(employee: RosterEmployee, week: string | null): RosterEmployee['pipelineStage'] {
  if (!week) return employee.pipelineStage ?? 'inactive'
  if (employee.status === 'terminated' || employee.status === 'inactive_pending_termed') return 'inactive'
  if (employee.status === 'inactive_loa') return 'inactive'
  if (employee.pipelineStage) return employee.pipelineStage
  if (!employee.startTrainingDate || week < employee.startTrainingDate) return 'pending'
  if (!employee.startNestingDate || week < employee.startNestingDate) return 'training'
  if (!employee.productionDate || week < employee.productionDate) return 'nesting'
  return 'production'
}

export function computeRosterCapacityMetrics(
  roster: RosterEmployee[],
  planningWeek: string | null,
  capacityRow?: DerivedCapacityRow | null,
  fallbackClient = '',
): RosterCapacityMetrics {
  const uniqueRoster = dedupeRosterEntries(roster, fallbackClient)
  const activeHeadcount = uniqueRoster.filter((employee) => employee.status === 'active').length
  const trainingHc = uniqueRoster.filter((employee) => weeklyPipelineStage(employee, planningWeek) === 'training').length
  const nestingHc = uniqueRoster.filter((employee) => weeklyPipelineStage(employee, planningWeek) === 'nesting').length
  const productionHc = uniqueRoster.filter((employee) => weeklyPipelineStage(employee, planningWeek) === 'production').length
  const activeSupport = uniqueRoster.filter((employee) => isActiveRosterEmployee(employee) && !isAgentRole(employee))
  const agentProductionHc = countActiveAgents(uniqueRoster, fallbackClient)
  const supportHc = activeSupport.length
  const offRosterLoaHc = uniqueRoster.filter((employee) => employee.status === 'inactive_loa').length
  const productionFte = capacityRow?.planned.productionFte ?? capacityRow?.actual.productionFte ?? null
  const requiredFte = capacityRow?.planned.requiredFte ?? capacityRow?.actual.requiredFte ?? null
  const staffingGap = productionFte != null && requiredFte != null ? productionFte - requiredFte : null
  const staffingPct = productionFte != null && requiredFte != null && requiredFte > 0 ? productionFte / requiredFte : null

  return {
    activeHeadcount,
    trainingHc,
    nestingHc,
    productionHc,
    agentProductionHc,
    supportHc,
    offRosterLoaHc,
    productionFte,
    requiredFte,
    staffingGap,
    staffingPct,
  }
}

export function rosterHeadcountOverrides(
  roster: RosterEmployee[],
  planningWeek: string | null,
  fallbackClient = '',
): {
  productionHc: number
  trainingHc: number
  nestingHc: number
  offRosterLoaHc: number
  supportHc: number
} {
  const metrics = computeRosterCapacityMetrics(roster, planningWeek, null, fallbackClient)
  return {
    productionHc: metrics.agentProductionHc,
    trainingHc: metrics.trainingHc,
    nestingHc: metrics.nestingHc,
    offRosterLoaHc: metrics.offRosterLoaHc,
    supportHc: metrics.supportHc,
  }
}
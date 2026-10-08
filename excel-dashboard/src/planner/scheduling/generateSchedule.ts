import type { BlockSchedule } from './blockSchedulePersistence'
import { requestPythonCoverageOptimize, type PythonDayAssignment } from './pythonOptimizeClient'
import { buildScheduleDiagnostics, type ScheduleRuleViolation } from './scheduleDiagnostics'
import { validateScheduleGeneration } from './scheduleValidation'
import { buildSchedulingPackage, type BuildSchedulingPackageOptions } from './schedulingEngine'
import type { RosterEmployee } from '../rosterPersistence'
import type {
  GeneratedSchedulingPackage,
  IntervalPatternRow,
  SchedulingAgent,
  SchedulingQualityInputs,
  SchedulingRules,
  WeekIntervalPattern,
} from './types'
import type { DailyFteTargets } from './requirementGeneration'

export type GenerateScheduleInput = {
  settingsConfirmed: boolean
  patternRows: IntervalPatternRow[]
  weeklyFte: number
  productionHc: number
  rosterAgents: RosterEmployee[]
  useRoster: boolean
  teamSupervisor?: string
  pattern: WeekIntervalPattern
  weekDates: string[]
  dailyFteTargets: DailyFteTargets
  rules: SchedulingRules
  qualityInputs: SchedulingQualityInputs
  agentNames: Record<string, string>
  agents: SchedulingAgent[]
  blockSchedules: BlockSchedule[]
  vlHc?: number
  applyShrinkage?: import('./applyShrinkage').BuildSchedulingResultShrinkageOptions
}

export type GenerateScheduleResult =
  | { ok: false; errors: string[] }
  | { ok: true; pkg: GeneratedSchedulingPackage; engineNote: string }

function lockedStartsFromBlocks(
  agents: SchedulingAgent[],
  blocks: BlockSchedule[],
  applyBlocks: boolean,
): PythonDayAssignment[] {
  if (!applyBlocks) return []
  const locks: PythonDayAssignment[] = []
  for (const agent of agents) {
    const block = blocks.find((item) => item.supervisor.trim() === (agent.supervisor ?? '').trim())
    if (block) locks.push({ agentIndex: agent.index, startMinutes: block.startMinutes })
  }
  return locks
}

export async function generateSchedulingPackage(
  input: GenerateScheduleInput,
): Promise<GenerateScheduleResult> {
  const errors = validateScheduleGeneration({
    settingsConfirmed: input.settingsConfirmed,
    patternRows: input.patternRows,
    weeklyFte: input.weeklyFte,
    productionHc: input.productionHc,
    rosterAgents: input.rosterAgents,
    useRoster: input.useRoster,
    settings: input.rules.settings,
    teamSupervisor: input.teamSupervisor,
  })
  if (errors.length) return { ok: false, errors }

  const applyBlocks = Boolean(input.rules.settings.constraints.useTeamBlockSchedules)
  const options: BuildSchedulingPackageOptions = {
    agents: input.agents,
    blockSchedules: applyBlocks ? input.blockSchedules : [],
    teamSupervisor: input.teamSupervisor,
    engine: 'typescript',
    vlHc: input.vlHc,
    applyShrinkage: input.applyShrinkage,
  }

  const first = buildSchedulingPackage(
    input.pattern,
    input.weekDates,
    input.dailyFteTargets,
    input.weeklyFte,
    input.productionHc,
    input.rules,
    input.patternRows,
    input.qualityInputs,
    input.agentNames,
    options,
  )

  const python = await requestPythonCoverageOptimize({
    days: first.requirementTable.days.map((day) => ({
      day: day.day,
      required: day.intervals,
      agents: first.weeklyAgentGrid.rows
        .filter((row) => {
          const cell = (row.days[day.day] ?? 'OFF').toUpperCase()
          return cell !== 'OFF' && cell !== 'VL'
        })
        .map((row) => row.agentIndex),
    })),
    allowedStarts: input.rules.shiftTemplates.map((template) => template.startMinutes),
    shiftLengthMinutes: input.rules.settings.shiftLengthHours * 60,
    lockedStarts: lockedStartsFromBlocks(input.agents, input.blockSchedules, applyBlocks),
  })

  const pkg =
    python?.assignments && Object.keys(python.assignments).length
      ? buildSchedulingPackage(
          input.pattern,
          input.weekDates,
          input.dailyFteTargets,
          input.weeklyFte,
          input.productionHc,
          input.rules,
          input.patternRows,
          input.qualityInputs,
          input.agentNames,
          {
            ...options,
            pythonAssignments: python.assignments,
            engine: python.engine === 'python-pulp' ? 'python-pulp' : 'python',
          },
        )
      : first

  const engine = pkg.engine ?? 'typescript'
  const extra: ScheduleRuleViolation[] = []
  const unassigned = pkg.weeklyAgentGrid.rows.filter((row) =>
    input.weekDates.every((day) => (row.days[day] ?? 'OFF') === 'OFF'),
  ).length
  if (unassigned > 0) {
    extra.push({
      code: 'unassigned_agents',
      message: `${unassigned} agent(s) have no working shift this week after rest days and coverage optimization. They were not given placeholder schedules.`,
    })
  }

  const diagnostics = buildScheduleDiagnostics(pkg.requirementTable, pkg.schedulingResult, engine, extra)
  const engineNote =
    engine === 'typescript'
      ? 'TypeScript interval optimizer (Python unavailable on this host)'
      : engine === 'python-pulp'
        ? 'Python PuLP coverage optimizer'
        : 'Python greedy coverage optimizer'

  return {
    ok: true,
    engineNote,
    pkg: {
      ...pkg,
      diagnostics,
      status: 'draft',
      teamSupervisor: input.teamSupervisor,
      engine,
    },
  }
}

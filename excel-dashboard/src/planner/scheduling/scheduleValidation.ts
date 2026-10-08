import type { RosterEmployee } from '../rosterPersistence'
import type { SchedulingSettings } from './schedulingSettingsTypes'
import type { IntervalPatternRow } from './types'
import { buildShiftTemplatesFromSettings } from './defaultSchedulingSettings'

export type ScheduleGenerationInput = {
  settingsConfirmed: boolean
  patternRows: IntervalPatternRow[]
  weeklyFte: number
  productionHc: number
  rosterAgents: RosterEmployee[]
  useRoster: boolean
  settings: SchedulingSettings
  teamSupervisor?: string
}

export function validateScheduleGeneration(input: ScheduleGenerationInput): string[] {
  const errors: string[] = []
  if (!input.settingsConfirmed) {
    errors.push('Confirm Scheduling Settings before generating. Open Settings, review rules, then return here.')
  }
  if (!input.patternRows.some((row) => row.value > 0)) {
    errors.push('Upload an interval pattern with required values. Schedules are not generated without requirements.')
  }
  if (!(input.weeklyFte > 0)) {
    errors.push('Weekly FTE requirement is missing or zero. Check Capacity Plan or enter a manual weekly FTE.')
  }
  if (input.useRoster) {
    if (!input.rosterAgents.length) {
      errors.push('Roster has no production agents for this LOB. Add active agents on the Roster page before generating.')
    } else if (input.teamSupervisor?.trim()) {
      const teamCount = input.rosterAgents.filter(
        (employee) => (employee.supervisor ?? '').trim() === input.teamSupervisor!.trim(),
      ).length
      if (!teamCount) {
        errors.push(
          `No roster agents are assigned to supervisor "${input.teamSupervisor.trim()}". Assign a supervisor on the Roster page or choose All teams.`,
        )
      }
    }
  } else if (!(input.productionHc > 0)) {
    errors.push('Production HC is missing or zero. Use roster headcount, Capacity Plan HC, or a manual HC.')
  }
  const templates = buildShiftTemplatesFromSettings(input.settings)
  if (!templates.length) {
    errors.push('No valid shift start times. Check earliest/latest start, allowed intervals, and shift length in Settings.')
  }
  if (!input.settings.workingDays.length && input.settings.workingDayCount === 'custom') {
    errors.push('Custom working days are empty. Select at least one working day in Settings.')
  }
  return errors
}

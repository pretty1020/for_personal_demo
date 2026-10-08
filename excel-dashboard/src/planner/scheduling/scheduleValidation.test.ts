import { describe, expect, it } from 'vitest'
import { createDefaultSchedulingSettings } from './defaultSchedulingSettings'
import { validateScheduleGeneration } from './scheduleValidation'
import type { RosterEmployee } from '../rosterPersistence'

const settings = createDefaultSchedulingSettings()

function agent(): RosterEmployee {
  return {
    id: 'a1',
    name: 'Alex Agent',
    position: 'Agent',
    employeeId: 'E1',
    hiringDate: '2026-01-01',
    waveNumber: '1',
    startTrainingDate: '2026-01-06',
    startNestingDate: '2026-01-20',
    productionDate: '2026-02-01',
    status: 'active',
    client: 'Apex Retail',
    lob: 'Voice',
    supervisor: 'Supervisor A',
    role: 'Agent',
    pipelineStage: 'production',
  }
}

describe('validateScheduleGeneration', () => {
  it('blocks generation when settings are not confirmed', () => {
    const errors = validateScheduleGeneration({
      settingsConfirmed: false,
      patternRows: [{ day: '2026-08-16', interval: '08:00', value: 1 }],
      weeklyFte: 10,
      productionHc: 8,
      rosterAgents: [agent()],
      useRoster: false,
      settings,
    })
    expect(errors.some((error) => /Confirm Scheduling Settings/i.test(error))).toBe(true)
  })

  it('blocks generation without interval requirements', () => {
    const errors = validateScheduleGeneration({
      settingsConfirmed: true,
      patternRows: [{ day: '2026-08-16', interval: '08:00', value: 0 }],
      weeklyFte: 10,
      productionHc: 8,
      rosterAgents: [agent()],
      useRoster: false,
      settings,
    })
    expect(errors.some((error) => /interval pattern/i.test(error))).toBe(true)
  })

  it('requires roster agents when using roster headcount', () => {
    const errors = validateScheduleGeneration({
      settingsConfirmed: true,
      patternRows: [{ day: '2026-08-16', interval: '08:00', value: 1 }],
      weeklyFte: 10,
      productionHc: 0,
      rosterAgents: [],
      useRoster: true,
      settings,
    })
    expect(errors.some((error) => /Roster has no production agents/i.test(error))).toBe(true)
  })

  it('requires a matching supervisor when generating by team', () => {
    const errors = validateScheduleGeneration({
      settingsConfirmed: true,
      patternRows: [{ day: '2026-08-16', interval: '08:00', value: 1 }],
      weeklyFte: 10,
      productionHc: 1,
      rosterAgents: [agent()],
      useRoster: true,
      settings,
      teamSupervisor: 'Supervisor Z',
    })
    expect(errors.some((error) => /Supervisor Z/i.test(error))).toBe(true)
  })

  it('allows a valid roster-backed generation request', () => {
    const errors = validateScheduleGeneration({
      settingsConfirmed: true,
      patternRows: [{ day: '2026-08-16', interval: '08:00', value: 1 }],
      weeklyFte: 10,
      productionHc: 1,
      rosterAgents: [agent()],
      useRoster: true,
      settings,
      teamSupervisor: 'Supervisor A',
    })
    expect(errors).toEqual([])
  })
})

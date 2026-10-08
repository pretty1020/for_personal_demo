import { describe, expect, it } from 'vitest'
import { extraAgentsToHitServiceLevel } from './serviceLevelOptimization'
import { createDefaultSchedulingSettings } from './defaultSchedulingSettings'
import { buildCoverageOptimizedSettings } from './scheduleAdvisor'
import { formatSlackRangeLabel } from './breakSlackWindows'
import { padSchedulingAgents } from './scheduleRosterAgents'

describe('service level extra staffing', () => {
  it('returns 0 when projected SL already meets the goal', () => {
    const extra = extraAgentsToHitServiceLevel(10, 12, 30, 80, 30, 80, null)
    expect(extra).toBe(0)
  })

  it('finds a finite extra agent count when scheduled is below required', () => {
    const extra = extraAgentsToHitServiceLevel(10, 6, 30, 80, 30, 80, null)
    expect(extra).toBeGreaterThan(0)
    expect(extra).toBeLessThanOrEqual(20)
  })
})

describe('coverage-optimized settings', () => {
  it('does not change shift length or working days', () => {
    const base = createDefaultSchedulingSettings()
    base.shiftLengthHours = 9
    base.workingDayCount = 5
    base.shiftStartMode = 'fixed'
    base.breakSlackMinutes = 0
    const { settings, changes } = buildCoverageOptimizedSettings(base)
    expect(settings.shiftLengthHours).toBe(9)
    expect(settings.workingDayCount).toBe(5)
    expect(settings.shiftStartMode).toBe('flexible')
    expect(settings.breakSlackMinutes).toBe(30)
    expect(changes.length).toBeGreaterThan(0)
  })
})

describe('slack labels', () => {
  it('describes a 2 hour target with 30 minute slack', () => {
    expect(formatSlackRangeLabel(120, 30)).toBe('1.5 hours – 2.5 hours')
  })
})

describe('padSchedulingAgents', () => {
  it('adds named extra schedules without renaming existing agents', () => {
    const padded = padSchedulingAgents(
      [
        { index: 0, name: 'Ana' },
        { index: 1, name: 'Ben' },
      ],
      4,
    )
    expect(padded.map((agent) => agent.name)).toEqual(['Ana', 'Ben', 'Agent 3', 'Agent 4'])
    expect(padded.map((agent) => agent.index)).toEqual([0, 1, 2, 3])
  })

  it('numbers an empty roster as Agent 1 through Agent N', () => {
    const padded = padSchedulingAgents([], 3)
    expect(padded.map((agent) => agent.name)).toEqual(['Agent 1', 'Agent 2', 'Agent 3'])
  })

  it('replaces leftover Additional labels with sequential Agent names', () => {
    const padded = padSchedulingAgents(
      [
        { index: 0, name: 'Additional 1' },
        { index: 1, name: 'Additional 2' },
      ],
      5,
    )
    expect(padded.map((agent) => agent.name)).toEqual(['Agent 1', 'Agent 2', 'Agent 3', 'Agent 4', 'Agent 5'])
  })
})

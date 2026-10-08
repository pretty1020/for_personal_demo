import { describe, expect, it } from 'vitest'
import { createDefaultSchedulingSettings } from './defaultSchedulingSettings'
import { firstBreakStartWindow, formatSlackRangeLabel, lunchStartWindow } from './breakSlackWindows'
import { listLunchCandidates, resolveBreakSlots } from './breakScheduleCandidates'

describe('break and lunch slack', () => {
  it('lets first break start 1.5–2.5 hours after shift when slack is 30 minutes', () => {
    const settings = createDefaultSchedulingSettings()
    settings.minMinutesBeforeFirstBreak = 120
    settings.breakSlackMinutes = 30
    const shiftStart = 7 * 60
    const window = firstBreakStartWindow(settings, shiftStart)
    expect(window.earliest - shiftStart).toBe(90)
    expect(window.latest - shiftStart).toBe(150)
    expect(formatSlackRangeLabel(120, 30)).toBe('1.5 hours – 2.5 hours')
  })

  it('lets lunch start 1.5–2.5 hours after shift when slack is 30 minutes', () => {
    const settings = createDefaultSchedulingSettings()
    settings.minMinutesBeforeLunch = 120
    settings.lunchSlackMinutes = 30
    const shiftStart = 7 * 60
    const window = lunchStartWindow(settings, shiftStart)
    expect(window.earliest - shiftStart).toBe(90)
    expect(window.latest - shiftStart).toBe(150)
    const lunches = listLunchCandidates(settings, shiftStart)
    expect(lunches).toContain(shiftStart + 90)
    expect(lunches).toContain(shiftStart + 150)
  })

  it('does not lock the first break to exactly 2 hours', () => {
    const settings = createDefaultSchedulingSettings()
    settings.minMinutesBeforeFirstBreak = 120
    settings.breakSlackMinutes = 30
    settings.constraints.followBreakLunchPattern = false
    const shiftStart = 8 * 60
    const slots = resolveBreakSlots(settings, shiftStart, shiftStart + 240, shiftStart + 270)
    expect(slots).toContain(shiftStart + 90)
    expect(slots).toContain(shiftStart + 150)
  })

  it('with no slack, the window is the target time', () => {
    const settings = createDefaultSchedulingSettings()
    settings.minMinutesBeforeFirstBreak = 120
    settings.breakSlackMinutes = 0
    const window = firstBreakStartWindow(settings, 8 * 60)
    expect(window.earliest).toBe(window.latest)
    expect(window.earliest - 8 * 60).toBe(120)
  })
})

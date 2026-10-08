import type { PlannerScenario } from '../types'
import type { SchedulingRuleTemplate, SchedulingSettings } from './schedulingSettingsTypes'
import { templateScopeKey } from './schedulingSettingsTypes'
import type { SchedulingRules, ShiftTemplate } from './types'
import { generateShiftStartOptions } from './schedulingTimeUtils'

import { buildConsecutiveWorkingDays } from './workingDaysUtils'

export function createDefaultSchedulingSettings(scenario?: PlannerScenario | null): SchedulingSettings {
  const weekStartDay = scenario?.plan.weekStart ?? 'sunday'
  const workingWeekStartDay = weekStartDay === 'sunday' ? 'sun' : 'mon'
  return {
    weekStartDay,
    planningWeeks: scenario?.plan.planningWeeks ?? 1,
    workingDayCount: 5,
    workingWeekStartDay,
    workingDays: buildConsecutiveWorkingDays(workingWeekStartDay, 5),
    restDayLayout: 'scattered',
    shiftLengthHours: 9,
    paidHours: 40,
    fteDailyDivisorHours: 7.5,
    fteRequiredDailyDivisorHours: 8,
    fteWeeklyDivisorHours: 45,
    unpaidLunchMinutes: 30,
    breakCount: 2,
    breakDurationMinutes: 15,
    breakWindowStart: '09:00',
    breakWindowEnd: '16:00',
    lunchWindowStart: '11:30',
    lunchWindowEnd: '14:00',
    minMinutesBeforeFirstBreak: 120,
    minMinutesBeforeLunch: 120,
    breakSlackMinutes: 30,
    lunchSlackMinutes: 30,
    minMinutesBetweenBreaksAndLunch: 60,
    maxConsecutiveWorkingMinutes: 240,
    scheduleIntervalMinutes: 30,
    earliestShiftStart: '07:00',
    latestShiftStart: '13:00',
    allowedStartIntervals: [0, 15, 30, 45],
    shiftStartMode: 'fixed',
    maxEmployeesPerShiftTemplate: 50,
    minStaffingCoverage: 0.85,
    constraints: {
      followUploadedPattern: true,
      minimizeOverUnder: true,
      evenlyDistributeLunches: true,
      evenlyDistributeBreaks: true,
      preventBreakLunchOverlapShortages: true,
      enforceMinLunchBreakGap: true,
      followBreakLunchPattern: true,
      breakLunchPattern: 'break_lunch_break',
      useTeamBlockSchedules: true,
    },
    optimizeShiftStarts: true,
    maxShiftStartAdjustMinutes: 120,
  }
}

export function buildShiftTemplatesFromSettings(settings: SchedulingSettings): ShiftTemplate[] {
  const starts = generateShiftStartOptions(settings)
  const durationMinutes = settings.shiftLengthHours * 60
  const totalBreakMinutes = settings.breakCount * settings.breakDurationMinutes
  return starts.map((startMinutes) => ({
    id: `shift-${startMinutes}`,
    label: `${formatShiftLabel(startMinutes)} · ${settings.shiftLengthHours}h`,
    startMinutes,
    durationMinutes,
    lunchMinutes: settings.unpaidLunchMinutes,
    breakMinutes: totalBreakMinutes,
  }))
}

function formatShiftLabel(startMinutes: number): string {
  const hours = Math.floor(startMinutes / 60)
  const mins = startMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

export function settingsToSchedulingRules(settings: SchedulingSettings): SchedulingRules {
  return {
    shiftTemplates: buildShiftTemplatesFromSettings(settings),
    maxShiftStartAdjustMinutes: settings.maxShiftStartAdjustMinutes,
    optimizeShiftStarts: Boolean(settings.constraints?.minimizeOverUnder) && settings.optimizeShiftStarts,
    settings,
  }
}

export function createSchedulingRuleTemplate(
  scenario: PlannerScenario,
  name: string,
  settings?: SchedulingSettings,
): SchedulingRuleTemplate {
  const now = new Date().toISOString()
  return {
    id: `sched-tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    clientId: scenario.plan.clientId ?? scenario.id,
    clientName: scenario.plan.client,
    lobName: scenario.plan.location,
    scenarioId: scenario.id,
    isDefault: false,
    settings: settings ?? createDefaultSchedulingSettings(scenario),
    createdAt: now,
    updatedAt: now,
  }
}

export function duplicateTemplate(template: SchedulingRuleTemplate, name: string): SchedulingRuleTemplate {
  const now = new Date().toISOString()
  return {
    ...template,
    id: `sched-tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  }
}

export function templateMatchesScenario(template: SchedulingRuleTemplate, scenario: PlannerScenario): boolean {
  const scope = templateScopeKey(scenario.plan.clientId ?? scenario.id, scenario.plan.location)
  const templateScope = templateScopeKey(template.clientId, template.lobName)
  return scope === templateScope || template.scenarioId === scenario.id
}

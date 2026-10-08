import type { PlannerScenario, WeekStart } from '../types'
import type {
  IntervalPatternRow,
  FteSourceMode,
  ScheduleHcSourceMode,
  SchedulingRules,
  SchedulingWorkspace,
} from './types'
import type { SchedulingSettings, WeekDayKey } from './schedulingSettingsTypes'
import { defaultSchedulingRules } from './scheduleOptimization'
import { createDefaultSchedulingSettings, settingsToSchedulingRules } from './defaultSchedulingSettings'
import {
  defaultCapacityPlanStartWeek,
  resolveCapacityPlanStartWeek,
  snapToWeekStart,
} from '../capacityWeekUtils'
import { getDefaultTemplateForScenario } from './schedulingTemplatePersistence'
import { migrateSchedulingSettings } from './workingDaysUtils'
import { buildWeekDateKeys } from './intervalSlots'
import { buildWeekIntervalPattern, reconcilePatternRowsToWeekDates } from './intervalPattern'

export const SCHEDULING_STORAGE_KEY = 'wfp-scheduling-v1'

function migrateFteSource(value: string | undefined): FteSourceMode {
  if (value === 'manual') return 'manual'
  return 'capacity'
}

function migrateHcSource(value: string | undefined): ScheduleHcSourceMode {
  if (value === 'manual') return 'manual'
  if (value === 'roster') return 'roster'
  return 'capacity'
}

/**
 * Calendar week boundary for Generated requirements columns.
 * First working day Sunday/Monday takes priority (user-facing setting), then weekStartDay / LOB plan.
 */
export function resolveSchedulingWeekStart(
  scenario?: PlannerScenario | null,
  settings?: Pick<SchedulingSettings, 'weekStartDay' | 'workingWeekStartDay'> | null,
): WeekStart {
  const firstWorking = settings?.workingWeekStartDay
  if (firstWorking === 'sun') return 'sunday'
  if (firstWorking === 'mon') return 'monday'
  return settings?.weekStartDay ?? scenario?.plan.weekStart ?? 'sunday'
}

export function syncWeekStartDayFromFirstWorkingDay(settings: SchedulingSettings): SchedulingSettings {
  const first = settings.workingWeekStartDay
  if (first === 'sun' && settings.weekStartDay !== 'sunday') {
    return { ...settings, weekStartDay: 'sunday' }
  }
  if (first === 'mon' && settings.weekStartDay !== 'monday') {
    return { ...settings, weekStartDay: 'monday' }
  }
  return settings
}

/** Remap uploaded pattern ISO days onto a new week by weekday (Sun↔Sun, Mon↔Mon, …). */
export function remapPatternRowsToWeek(
  rows: IntervalPatternRow[],
  fromWeekStartIso: string,
  toWeekStartIso: string,
): IntervalPatternRow[] {
  if (!rows.length || fromWeekStartIso === toWeekStartIso) return rows
  return reconcilePatternRowsToWeekDates(rows, buildWeekDateKeys(toWeekStartIso))
}

/** Keep planning week ISO aligned to Sunday/Monday week boundary from First working day. */
export function alignWorkspaceWeekStart(
  workspace: SchedulingWorkspace,
  scenario?: PlannerScenario | null,
): SchedulingWorkspace {
  const settings = workspace.rules?.settings
    ? syncWeekStartDayFromFirstWorkingDay(migrateSchedulingSettings(workspace.rules.settings))
    : null
  const rules =
    settings && workspace.rules
      ? { ...workspace.rules, settings }
      : workspace.rules
  const weekStart = resolveSchedulingWeekStart(scenario, settings)
  const prevIso = workspace.weekStartIso
  const weekStartIso = snapToWeekStart(
    prevIso || resolveCapacityPlanStartWeek(scenario?.plan ?? { weekStart }),
    weekStart,
  )
  if (weekStartIso === prevIso && settings === workspace.rules?.settings) {
    return workspace
  }

  const rawPattern =
    weekStartIso !== prevIso && workspace.rawPattern.length
      ? remapPatternRowsToWeek(workspace.rawPattern, prevIso, weekStartIso)
      : workspace.rawPattern
  const normalizedPattern =
    weekStartIso !== prevIso && rawPattern.length
      ? buildWeekIntervalPattern(rawPattern, buildWeekDateKeys(weekStartIso))
      : workspace.normalizedPattern

  return {
    ...workspace,
    rules,
    weekStartIso,
    rawPattern,
    normalizedPattern,
    lastGeneratedAt: weekStartIso !== prevIso ? null : workspace.lastGeneratedAt,
  }
}

export function rulesFromScenario(scenario: PlannerScenario | null): SchedulingRules {
  if (!scenario) return defaultSchedulingRules()
  const template = getDefaultTemplateForScenario(scenario)
  if (template) return settingsToSchedulingRules(template.settings)
  return settingsToSchedulingRules(createDefaultSchedulingSettings(scenario))
}

export function createDefaultSchedulingWorkspace(
  scenarioId: string,
  weekStartIso?: string,
  scenario?: PlannerScenario | null,
): SchedulingWorkspace {
  const template = scenario ? getDefaultTemplateForScenario(scenario) : null
  const rules = template
    ? settingsToSchedulingRules(migrateSchedulingSettings(template.settings))
    : settingsToSchedulingRules(createDefaultSchedulingSettings(scenario))
  const weekBoundary = resolveSchedulingWeekStart(scenario, rules.settings)
  const planTimeZone = scenario?.plan.timezone
  const weekStart = weekStartIso
    ? snapToWeekStart(weekStartIso, weekBoundary)
    : scenario
      ? snapToWeekStart(resolveCapacityPlanStartWeek(scenario.plan), weekBoundary)
      : defaultCapacityPlanStartWeek(weekBoundary, planTimeZone)

  return {
    scenarioId,
    weekStartIso: weekStart,
    patternLabel: '',
    patternUploadedAt: null,
    rawPattern: [],
    normalizedPattern: {},
    fteSource: 'capacity',
    manualWeeklyFte: 0,
    manualDailyFteByDay: {},
    scheduleHcSource: 'roster',
    manualProductionHc: 0,
    rules,
    activeTemplateId: template?.id ?? null,
    settingsConfirmedAt: null,
    lastGeneratedAt: null,
    slaPercent: 80,
    slaSeconds: 30,
    shrinkagePct: 0,
    volumeAhtLabel: '',
    volumeAhtUploadedAt: null,
    volumeAhtRows: [],
    teamSupervisor: '',
    applyShrinkageMode: 'flat',
    applyAbsenteeismPct: 0,
    applyInOfficePct: 0,
    intervalApplyShrinkagePct: {},
    vlHcOverride: null,
    schedulesLocked: true,
  }
}

export function loadSchedulingWorkspace(): SchedulingWorkspace | null {
  try {
    const raw = localStorage.getItem(SCHEDULING_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SchedulingWorkspace
    if (!parsed.rules?.settings) {
      parsed.rules = defaultSchedulingRules()
    } else {
      parsed.rules = {
        ...parsed.rules,
        settings: migrateSchedulingSettings(parsed.rules.settings),
      }
    }
    if (parsed.activeTemplateId === undefined) parsed.activeTemplateId = null
    if (parsed.settingsConfirmedAt === undefined) parsed.settingsConfirmedAt = null
    if (parsed.slaPercent == null) parsed.slaPercent = 80
    if (parsed.slaSeconds == null) parsed.slaSeconds = 30
    if (parsed.shrinkagePct == null) parsed.shrinkagePct = 0
    if (parsed.volumeAhtLabel == null) parsed.volumeAhtLabel = ''
    if (parsed.volumeAhtUploadedAt === undefined) parsed.volumeAhtUploadedAt = null
    if (!parsed.volumeAhtRows) parsed.volumeAhtRows = []
    parsed.fteSource = migrateFteSource(parsed.fteSource)
    parsed.scheduleHcSource = migrateHcSource(parsed.scheduleHcSource)
    if (parsed.teamSupervisor == null) parsed.teamSupervisor = ''
    if (parsed.applyShrinkageMode !== 'flat' && parsed.applyShrinkageMode !== 'per_interval') {
      parsed.applyShrinkageMode = 'flat'
    }
    if (parsed.applyAbsenteeismPct == null || !Number.isFinite(parsed.applyAbsenteeismPct)) {
      parsed.applyAbsenteeismPct = 0
    }
    if (parsed.applyInOfficePct == null || !Number.isFinite(parsed.applyInOfficePct)) {
      parsed.applyInOfficePct = 0
    }
    if (!parsed.intervalApplyShrinkagePct || typeof parsed.intervalApplyShrinkagePct !== 'object') {
      parsed.intervalApplyShrinkagePct = {}
    }
    if (parsed.vlHcOverride === undefined) parsed.vlHcOverride = null
    if (parsed.schedulesLocked == null) parsed.schedulesLocked = true
    return parsed
  } catch {
    return null
  }
}

export function saveSchedulingWorkspace(workspace: SchedulingWorkspace): void {
  localStorage.setItem(SCHEDULING_STORAGE_KEY, JSON.stringify(workspace))
}

export function applyTemplateToWorkspace(
  workspace: SchedulingWorkspace,
  templateId: string,
  rules: SchedulingRules,
  confirmed: boolean,
): SchedulingWorkspace {
  const settings = syncWeekStartDayFromFirstWorkingDay(migrateSchedulingSettings(rules.settings))
  const nextRules = { ...rules, settings }
  const withRules: SchedulingWorkspace = {
    ...workspace,
    rules: nextRules,
    activeTemplateId: templateId,
    settingsConfirmedAt: confirmed ? new Date().toISOString() : null,
  }
  const weekStart = resolveSchedulingWeekStart(null, settings)
  return {
    ...withRules,
    weekStartIso: snapToWeekStart(withRules.weekStartIso, weekStart),
  }
}

export function weekStartFromFirstWorkingDay(day: WeekDayKey): WeekStart | null {
  if (day === 'sun') return 'sunday'
  if (day === 'mon') return 'monday'
  return null
}

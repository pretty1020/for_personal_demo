import { addWeeks, isoDate } from '../capacityWeekUtils'
import type { PlannerScenario } from '../types'
import type { RosterEmployee } from '../rosterPersistence'
import type { SampleLobDefinition } from '../sampleWorkspace'
import { buildSampleIntervalPatternRows } from './sampleIntervalPattern'
import { buildWeekDateKeys, normalizeDayKey, normalizeIntervalLabel } from './intervalSlots'
import { buildWeekIntervalPattern } from './intervalPattern'
import { buildSchedulingPackage } from './schedulingEngine'
import {
  buildDayVolumeWeights,
  resolveDailyFteTargets,
} from './requirementGeneration'
import { paidWorkingDaysFromSettings } from './workingDaysUtils'
import {
  createDefaultSchedulingWorkspace,
  saveSchedulingWorkspace,
} from './persistence'
import {
  persistGeneratedDraft,
  upsertSavedRequirement,
  draftScheduleId,
  type SavedSchedulingSchedule,
} from './schedulingArtifactPersistence'
import {
  agentNamesFromSchedulingAgents,
  padSchedulingAgents,
  schedulingAgentsFromRoster,
} from './scheduleRosterAgents'
import { analyzeUploadedPattern } from './patternAnalysis'
import type { IntervalPatternRow, SchedulingQualityInputs } from './types'

const SAMPLE_SCHEDULING_STORE_KEY = 'wfp-sample-scheduling-v1'

export type SampleSchedulingBundle = {
  workspace: ReturnType<typeof createDefaultSchedulingWorkspace>
  draft: SavedSchedulingSchedule
}

export type SampleSchedulingStore = Record<string, SampleSchedulingBundle>

function patternRowsForWeek(weekStartIso: string): IntervalPatternRow[] {
  const aoa = buildSampleIntervalPatternRows(weekStartIso)
  const weekDates = buildWeekDateKeys(weekStartIso)
  const rows: IntervalPatternRow[] = []
  for (const row of aoa.slice(1)) {
    const day = normalizeDayKey(String(row[0] ?? ''), weekDates)
    const interval = normalizeIntervalLabel(String(row[1] ?? ''))
    const value = Number(row[2])
    if (!day || !interval || !Number.isFinite(value) || value < 0) continue
    rows.push({ day, interval, value })
  }
  return rows
}

function futureWeekKeys(planStartWeek: string, count: number): string[] {
  const start = new Date(`${planStartWeek}T12:00:00`)
  return Array.from({ length: count }, (_, index) => isoDate(addWeeks(start, index)))
}

function buildBundleForScenario(
  scenario: PlannerScenario,
  lob: SampleLobDefinition,
  roster: RosterEmployee[],
): SampleSchedulingBundle | null {
  const planWeek = scenario.plan.capacityPlanStartWeek?.trim()
  if (!planWeek) return null
  const workspace = createDefaultSchedulingWorkspace(scenario.id, planWeek, scenario)
  const rows = patternRowsForWeek(workspace.weekStartIso)
  if (!rows.length) return null

  const weekDates = buildWeekDateKeys(workspace.weekStartIso)
  const pattern = buildWeekIntervalPattern(rows, weekDates)
  const now = new Date().toISOString()
  const confirmed = {
    ...workspace,
    patternLabel: `Optimized pattern · ${lob.lob}`,
    patternUploadedAt: now,
    settingsConfirmedAt: now,
    rawPattern: rows,
    normalizedPattern: pattern,
    scheduleHcSource: 'roster' as const,
    fteSource: 'capacity' as const,
    lastGeneratedAt: now,
    shrinkagePct: 25,
    applyAbsenteeismPct: 6,
    applyInOfficePct: 8,
    slaPercent: 80,
    slaSeconds: 30,
  }

  const weeklyFte = Math.max(1, lob.productionHc)
  const productionHc = lob.productionHc
  const schedulingAgents = schedulingAgentsFromRoster(roster)
  const agents = padSchedulingAgents(schedulingAgents, productionHc)
  const names = agentNamesFromSchedulingAgents(agents)
  const dayWeights = buildDayVolumeWeights(rows, weekDates)
  const patternMeta = analyzeUploadedPattern(rows, weekDates)
  const workingDayIsos =
    patternMeta.workingDays.length > 0
      ? patternMeta.workingDays
      : weekDates.filter((day) => (dayWeights[day] ?? 0) > 0)
  const paidWorkingDays = paidWorkingDaysFromSettings(confirmed.rules.settings)
  const dailyFteTargets = resolveDailyFteTargets(
    weekDates,
    weeklyFte,
    dayWeights,
    {},
    workingDayIsos,
    paidWorkingDays,
  )
  const qualityInputs: SchedulingQualityInputs = {
    slaPercent: confirmed.slaPercent,
    slaSeconds: confirmed.slaSeconds,
    shrinkagePct: 25,
    volumeAhtRows: [],
  }

  const pkg = buildSchedulingPackage(
    pattern,
    weekDates,
    dailyFteTargets,
    weeklyFte,
    productionHc,
    confirmed.rules,
    rows,
    qualityInputs,
    names,
    {
      agents,
      blockSchedules: [],
      engine: 'typescript',
      applyShrinkage: {
        flatApplyShrinkagePct: 14,
      },
    },
  )

  const generatedAt = new Date().toISOString()
  const draft: SavedSchedulingSchedule = {
    id: draftScheduleId(scenario.id, confirmed.weekStartIso, ''),
    name: `Optimized · ${scenario.plan.client} · ${lob.lob}`,
    status: 'draft',
    scenarioId: scenario.id,
    weekStartIso: confirmed.weekStartIso,
    clientName: scenario.plan.client,
    lobName: lob.lob,
    package: { ...pkg, generatedAt, status: 'draft' },
    agentNames: names,
    engine: 'typescript',
    savedAt: generatedAt,
    generatedAt,
  }

  return {
    workspace: { ...confirmed, lastGeneratedAt: generatedAt },
    draft,
  }
}

export function saveSampleSchedulingStore(store: SampleSchedulingStore): void {
  localStorage.setItem(SAMPLE_SCHEDULING_STORE_KEY, JSON.stringify(store))
}

export function loadSampleSchedulingStore(): SampleSchedulingStore {
  try {
    const raw = localStorage.getItem(SAMPLE_SCHEDULING_STORE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as SampleSchedulingStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function loadSampleSchedulingBundle(scenarioId: string): SampleSchedulingBundle | null {
  return loadSampleSchedulingStore()[scenarioId] ?? null
}

/**
 * Build optimized requirements + schedules for sample LOBs and activate the preferred one.
 */
export function seedSampleScheduling(input: {
  scenarios: PlannerScenario[]
  rosterStore: Record<string, RosterEmployee[]>
  lobs: readonly SampleLobDefinition[]
  preferredScenarioId?: string
}): void {
  const store: SampleSchedulingStore = {}
  const lobById = new Map(input.lobs.map((lob) => [lob.id, lob]))

  for (const scenario of input.scenarios) {
    const lob = lobById.get(scenario.id)
    if (!lob) continue
    const roster = input.rosterStore[scenario.id] ?? []
    try {
      const bundle = buildBundleForScenario(scenario, lob, roster)
      if (!bundle) continue
      store[scenario.id] = bundle
      upsertSavedRequirement({
        id: `req:${scenario.id}:${bundle.workspace.weekStartIso}`,
        name: `Requirements · ${lob.lob}`,
        scenarioId: scenario.id,
        weekStartIso: bundle.workspace.weekStartIso,
        requirementTable: bundle.draft.package.requirementTable,
        savedAt: bundle.draft.savedAt,
      })
      persistGeneratedDraft(bundle.draft)
    } catch {
      /* keep seeding other LOBs */
    }
  }

  saveSampleSchedulingStore(store)

  const preferredId =
    input.preferredScenarioId && store[input.preferredScenarioId]
      ? input.preferredScenarioId
      : Object.keys(store).find((id) => id.startsWith('scenario-telco-')) ?? Object.keys(store)[0]
  const preferred = preferredId ? store[preferredId] : null
  if (preferred) {
    saveSchedulingWorkspace(preferred.workspace)
  }
}

/** Exported for Forecasting seed week lists. */
export function samplePlanWeekKeys(planStartWeek: string, count = 26): string[] {
  return futureWeekKeys(planStartWeek, count)
}

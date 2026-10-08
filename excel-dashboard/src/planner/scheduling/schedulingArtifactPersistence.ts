import type { GeneratedRequirementTable } from './requirementGeneration'
import type {
  GeneratedSchedulingPackage,
  SchedulingMetricsMatrix,
  SchedulingQualityInputs,
  SchedulingResult,
} from './types'
import type { SchedulingSettings } from './schedulingSettingsTypes'

export type SavedSchedulingRequirement = {
  id: string
  name: string
  scenarioId: string
  weekStartIso: string
  requirementTable: GeneratedRequirementTable
  savedAt: string
}

export type SavedSchedulingSchedule = {
  id: string
  name: string
  status: 'draft' | 'saved'
  scenarioId: string
  weekStartIso: string
  clientName?: string
  lobName?: string
  teamSupervisor?: string
  coverageStart?: string
  coverageEnd?: string
  createdBy?: string
  engine?: string
  settingsSnapshot?: SchedulingSettings
  package: GeneratedSchedulingPackage
  agentNames: Record<string, string>
  savedAt: string
  generatedAt?: string
}

export type SavedIntervalComparison = {
  id: string
  name: string
  scenarioId: string
  weekStartIso: string
  schedulingResult: SchedulingResult
  metricsMatrix: SchedulingMetricsMatrix
  qualityInputs: SchedulingQualityInputs
  agentNames: Record<string, string>
  savedAt: string
}

export type SchedulingArtifactStore = {
  requirements: SavedSchedulingRequirement[]
  schedules: SavedSchedulingSchedule[]
  comparisons: SavedIntervalComparison[]
}

export const SCHEDULING_ARTIFACTS_STORAGE_KEY = 'wfp-scheduling-artifacts-v1'

const EMPTY_STORE: SchedulingArtifactStore = { requirements: [], schedules: [], comparisons: [] }

function migrateSavedSchedule(entry: SavedSchedulingSchedule): SavedSchedulingSchedule {
  return {
    ...entry,
    status: entry.status ?? 'saved',
    generatedAt: entry.generatedAt ?? entry.package?.generatedAt ?? entry.savedAt,
  }
}

export function loadSchedulingArtifactStore(): SchedulingArtifactStore {
  try {
    const raw = localStorage.getItem(SCHEDULING_ARTIFACTS_STORAGE_KEY)
    if (!raw) return { ...EMPTY_STORE }
    const parsed = JSON.parse(raw) as SchedulingArtifactStore
    return {
      requirements: parsed.requirements ?? [],
      schedules: (parsed.schedules ?? []).map(migrateSavedSchedule),
      comparisons: parsed.comparisons ?? [],
    }
  } catch {
    return { ...EMPTY_STORE }
  }
}

export function saveSchedulingArtifactStore(store: SchedulingArtifactStore): void {
  localStorage.setItem(SCHEDULING_ARTIFACTS_STORAGE_KEY, JSON.stringify(store))
}

export function createArtifactId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function draftScheduleId(scenarioId: string, weekStartIso: string, teamSupervisor = ''): string {
  return `draft:${scenarioId}:${weekStartIso}:${teamSupervisor.trim() || 'all'}`
}

export function upsertSavedRequirement(entry: SavedSchedulingRequirement): SavedSchedulingRequirement {
  const store = loadSchedulingArtifactStore()
  const index = store.requirements.findIndex((item) => item.id === entry.id)
  const next = { ...entry, savedAt: new Date().toISOString() }
  if (index >= 0) store.requirements[index] = next
  else store.requirements.push(next)
  saveSchedulingArtifactStore(store)
  return next
}

export function deleteSavedRequirement(id: string): void {
  const store = loadSchedulingArtifactStore()
  store.requirements = store.requirements.filter((item) => item.id !== id)
  saveSchedulingArtifactStore(store)
}

export function upsertSavedSchedule(entry: SavedSchedulingSchedule): SavedSchedulingSchedule {
  const store = loadSchedulingArtifactStore()
  const index = store.schedules.findIndex((item) => item.id === entry.id)
  const next = migrateSavedSchedule({ ...entry, savedAt: new Date().toISOString() })
  if (index >= 0) store.schedules[index] = next
  else store.schedules.push(next)
  saveSchedulingArtifactStore(store)
  return next
}

export function persistGeneratedDraft(
  entry: Omit<SavedSchedulingSchedule, 'id' | 'status' | 'savedAt'> & { id?: string },
): SavedSchedulingSchedule {
  return upsertSavedSchedule({
    ...entry,
    id: entry.id ?? draftScheduleId(entry.scenarioId, entry.weekStartIso, entry.teamSupervisor),
    status: 'draft',
    savedAt: new Date().toISOString(),
  })
}

export function renameSavedSchedule(id: string, name: string): SavedSchedulingSchedule | null {
  const trimmed = name.trim()
  if (!trimmed) return null
  const store = loadSchedulingArtifactStore()
  const index = store.schedules.findIndex((item) => item.id === id)
  if (index < 0) return null
  const next = { ...store.schedules[index]!, name: trimmed, savedAt: new Date().toISOString() }
  store.schedules[index] = next
  saveSchedulingArtifactStore(store)
  return next
}

export function deleteSavedSchedule(id: string): void {
  const store = loadSchedulingArtifactStore()
  store.schedules = store.schedules.filter((item) => item.id !== id)
  saveSchedulingArtifactStore(store)
}

export function upsertSavedComparison(entry: SavedIntervalComparison): SavedIntervalComparison {
  const store = loadSchedulingArtifactStore()
  const index = store.comparisons.findIndex((item) => item.id === entry.id)
  const next = { ...entry, savedAt: new Date().toISOString() }
  if (index >= 0) store.comparisons[index] = next
  else store.comparisons.push(next)
  saveSchedulingArtifactStore(store)
  return next
}

export function deleteSavedComparison(id: string): void {
  const store = loadSchedulingArtifactStore()
  store.comparisons = store.comparisons.filter((item) => item.id !== id)
  saveSchedulingArtifactStore(store)
}

export function listSavedComparisons(scenarioId: string, weekStartIso: string): SavedIntervalComparison[] {
  return loadSchedulingArtifactStore().comparisons.filter(
    (item) => item.scenarioId === scenarioId && item.weekStartIso === weekStartIso,
  )
}

export function listSavedRequirements(scenarioId: string, weekStartIso: string): SavedSchedulingRequirement[] {
  return loadSchedulingArtifactStore().requirements.filter(
    (item) => item.scenarioId === scenarioId && item.weekStartIso === weekStartIso,
  )
}

export function listSavedSchedules(scenarioId: string, weekStartIso: string): SavedSchedulingSchedule[] {
  return loadSchedulingArtifactStore().schedules.filter(
    (item) => item.scenarioId === scenarioId && item.weekStartIso === weekStartIso,
  )
}

export function listAllSavedSchedules(): SavedSchedulingSchedule[] {
  return [...loadSchedulingArtifactStore().schedules].sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

export function loadPersistedGeneratedPackage(
  scenarioId: string,
  weekStartIso: string,
): GeneratedSchedulingPackage | null {
  const store = loadSchedulingArtifactStore()
  const matching = store.schedules.filter(
    (item) => item.scenarioId === scenarioId && item.weekStartIso === weekStartIso,
  )
  const draft = matching.find((item) => item.status === 'draft')
  const latest = [...matching].sort((a, b) => b.savedAt.localeCompare(a.savedAt))[0]
  return (draft ?? latest)?.package ?? null
}

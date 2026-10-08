import { newId } from '../utils/newId'

export type RosterEmployeeStatus = 'active' | 'inactive_pending_termed' | 'inactive_loa' | 'terminated'

export type RosterEmployeeSource = 'manual' | 'api'

export type RosterPipelineStage = 'pending' | 'training' | 'nesting' | 'production' | 'inactive'

export type RosterEmployee = {
  id: string
  name: string
  position: string
  employeeId: string
  hiringDate: string
  waveNumber: string
  startTrainingDate: string
  startNestingDate: string
  productionDate: string
  status: RosterEmployeeStatus
  source?: RosterEmployeeSource
  accountId?: string
  accountName?: string
  client?: string
  lob?: string
  employmentStatus?: string
  role?: string
  pipelineStage?: RosterPipelineStage
  syncedAt?: string
  email?: string
  department?: string
  siteLocation?: string
  shift?: string
  seniorityLevel?: string
}

export type ScenarioRosterStore = Record<string, RosterEmployee[]>

export type ScenarioRosterSyncMeta = {
  scenarioId: string
  accountId: string
  accountName?: string
  client: string
  lob: string
  lastSyncedAt: string
  staffCount: number
  activeCount: number
}

export type ScenarioRosterSyncMetaStore = Record<string, ScenarioRosterSyncMeta>

const STORAGE_KEY = 'wfp-roster-store-v1'
const SYNC_META_KEY = 'wfp-roster-sync-meta-v1'

export function loadRosterStore(): ScenarioRosterStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ScenarioRosterStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveRosterStore(store: ScenarioRosterStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
}

export function loadRosterSyncMetaStore(): ScenarioRosterSyncMetaStore {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ScenarioRosterSyncMetaStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function saveRosterSyncMetaStore(store: ScenarioRosterSyncMetaStore): void {
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(store))
}

export function createEmptyRosterEmployee(): RosterEmployee {
  return {
    id: newId(),
    name: '',
    position: '',
    employeeId: '',
    hiringDate: '',
    waveNumber: '',
    startTrainingDate: '',
    startNestingDate: '',
    productionDate: '',
    status: 'active',
    source: 'manual',
  }
}

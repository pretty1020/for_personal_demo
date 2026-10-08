import type { ChannelType } from './types'

export type RosterEmployeeStatus =
  | 'active'
  | 'inactive_pending_termed'
  | 'inactive_loa'
  | 'terminated'
  | 'transfer_out'

export type RosterEmployeeSource = 'manual' | 'api'

export type RosterPipelineStage = 'pending' | 'training' | 'nesting' | 'production' | 'inactive'

export type RosterTransferType = 'internal' | 'external'

export type RosterStatusEvent = {
  status: RosterEmployeeStatus
  startDate: string
  endedDate?: string
  pipelineStage?: RosterPipelineStage
  /** Present when status is transfer_out (optional for older records). */
  transferType?: RosterTransferType
  transferDestinationClient?: string
  transferDestinationLob?: string
}

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
  /** Start date of the current status (required for LOA, pending termed, terminated, transfer out). */
  statusStartDate?: string
  /** Chronological status changes for this employee. */
  statusHistory?: RosterStatusEvent[]
  source?: RosterEmployeeSource
  accountId?: string
  accountName?: string
  client?: string
  lob?: string
  channel?: ChannelType
  employmentStatus?: string
  role?: string
  pipelineStage?: RosterPipelineStage
  syncedAt?: string
  email?: string
  department?: string
  siteLocation?: string
  shift?: string
  seniorityLevel?: string
  supervisor?: string
  manager?: string
  /** Required when status is transfer_out (internal vs external move). */
  transferType?: RosterTransferType
  /** Destination client from company portfolio (scenarios / client registry). */
  transferDestinationClient?: string
  /** Destination LOB when transferType is internal. */
  transferDestinationLob?: string
  /** Audit trail of client/LOB, supervisor, manager, and pipeline date changes. Never overwritten. */
  assignmentHistory?: import('./rosterHistory').RosterHistoryEvent[]
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

export function createEmptyRosterEmployee(defaults?: {
  client?: string
  lob?: string
  channel?: ChannelType
  siteLocation?: string
}): RosterEmployee {
  return {
    id: crypto.randomUUID(),
    name: '',
    position: 'Agent',
    role: 'Agent',
    employeeId: '',
    hiringDate: '',
    waveNumber: '',
    startTrainingDate: '',
    startNestingDate: '',
    productionDate: '',
    status: 'active',
    source: 'manual',
    client: defaults?.client ?? '',
    lob: defaults?.lob ?? '',
    channel: defaults?.channel,
    siteLocation: defaults?.siteLocation ?? '',
    supervisor: '',
    manager: '',
    assignmentHistory: [],
  }
}

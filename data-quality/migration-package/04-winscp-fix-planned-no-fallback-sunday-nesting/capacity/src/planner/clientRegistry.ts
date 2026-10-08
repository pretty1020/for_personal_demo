import { newId } from '../utils/newId'
import {
  apiCreateClient,
  apiDeleteClient,
  apiListClients,
  apiSeedClients,
  apiUpdateClient,
  isRemoteBackend,
  type ApiClientRecord,
} from '../data/apiClient'
import { clearExternalSaveError, reportExternalSaveError } from '../data/capacityDocuments'
import type { CapacityBuildMethod, WeekStart } from './types'

export type ClientProfile = {
  id: string
  name: string
  weekStart: WeekStart
  capacityPlanStartWeek: string
  planningWeeks: number
  buildMethod: CapacityBuildMethod
  defaultPaidHours: number
  defaultShrinkagePct: number
  createdAt: string
  updatedAt: string
}

/**
 * MariaDB (capacity_clients) is the source of truth when a backend is configured.
 * This key is only a local mirror so the synchronous planner callers keep working
 * between hydrations; it is deliberately NOT part of the workspace snapshot.
 */
const STORAGE_KEY = 'wfp-client-registry-v1'

/** Ids known to exist server-side, so writes pick UPDATE over INSERT. */
const remoteIds = new Set<string>()

function toClientProfile(record: ApiClientRecord): ClientProfile {
  return {
    id: record.id,
    name: record.name,
    weekStart: 'sunday',
    capacityPlanStartWeek: record.capacityPlanStartWeek,
    planningWeeks: record.planningWeeks,
    buildMethod: record.buildMethod === 'import' ? 'import' : 'forward',
    defaultPaidHours: record.defaultPaidHours,
    defaultShrinkagePct: record.defaultShrinkagePct,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export function loadClientRegistry(): ClientProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ClientProfile[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveClientRegistry(clients: ClientProfile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clients))
}

const CLIENT_SAVE_SOURCE = 'capacity-clients'

/**
 * Clients that did not reach capacity_clients, kept so Retry has something to resend.
 * A profile sitting in here exists only in this browser: it must not be mistaken for
 * saved work, which is why it also raises the shared save-status badge.
 */
const unsynced = new Map<string, ClientProfile>()

function reportClientSyncFailure(action: string, error: unknown): void {
  console.error(`Client ${action} did not reach the database:`, error)

  const names = [...unsynced.values()].map((client) => client.name).filter(Boolean)
  const detail =
    names.length === 1
      ? `“${names[0]}” is saved in this browser only.`
      : names.length > 1
        ? `${names.length} clients are saved in this browser only.`
        : 'The change is saved in this browser only.'

  reportExternalSaveError(
    CLIENT_SAVE_SOURCE,
    `Client ${action} did not reach the database. ${detail}`,
    retryClientWrites,
  )
}

function clearClientSyncFailureIfSettled(): void {
  if (unsynced.size === 0) clearExternalSaveError(CLIENT_SAVE_SOURCE)
}

/**
 * Writes one client through to MariaDB.
 *
 * A create can lose a race with another session that already inserted the same row, so
 * a failed create is retried as an update before it is treated as a real failure.
 */
async function pushClient(profile: ClientProfile): Promise<void> {
  const isKnownRemote = remoteIds.has(profile.id)

  try {
    if (isKnownRemote) await apiUpdateClient(profile.id, profile)
    else await apiCreateClient(profile)
    remoteIds.add(profile.id)
    unsynced.delete(profile.id)
    clearClientSyncFailureIfSettled()
  } catch (error) {
    if (!isKnownRemote) {
      try {
        await apiUpdateClient(profile.id, profile)
        remoteIds.add(profile.id)
        unsynced.delete(profile.id)
        clearClientSyncFailureIfSettled()
        return
      } catch {
        // Fall through and report the original failure.
      }
    }
    unsynced.set(profile.id, profile)
    reportClientSyncFailure('save', error)
  }
}

/** Resends everything still held locally. Wired into the save badge's Retry button. */
export function retryClientWrites(): void {
  if (!isRemoteBackend()) return
  for (const profile of [...unsynced.values()]) void pushClient(profile)
}

/** True when a client is in this browser but not in the database. */
export function hasUnsyncedClients(): boolean {
  return unsynced.size > 0
}

export function upsertClientProfile(profile: ClientProfile): ClientProfile[] {
  const clients = loadClientRegistry()
  const index = clients.findIndex((item) => item.id === profile.id)
  const next = [...clients]
  if (index >= 0) next[index] = profile
  else next.push(profile)
  saveClientRegistry(next)

  if (isRemoteBackend()) void pushClient(profile)

  return next
}

export function deleteClientProfile(id: string): ClientProfile[] {
  const next = loadClientRegistry().filter((item) => item.id !== id)
  saveClientRegistry(next)

  if (isRemoteBackend()) {
    apiDeleteClient(id)
      .then(() => {
        unsynced.delete(id)
        clearClientSyncFailureIfSettled()
      })
      .catch((error) => reportClientSyncFailure('delete', error))
      .finally(() => {
        remoteIds.delete(id)
      })
  }

  return next
}

export function findClientById(id: string): ClientProfile | null {
  return loadClientRegistry().find((item) => item.id === id) ?? null
}

export function findClientByName(name: string): ClientProfile | null {
  const normalized = name.trim().toLowerCase()
  return loadClientRegistry().find((item) => item.name.trim().toLowerCase() === normalized) ?? null
}

export function createClientProfile(input: {
  name: string
  weekStart: WeekStart
  capacityPlanStartWeek: string
  planningWeeks?: number
  buildMethod?: CapacityBuildMethod
  defaultPaidHours?: number
  defaultShrinkagePct?: number
}): ClientProfile {
  const now = new Date().toISOString()
  return {
    id: newId(),
    name: input.name.trim(),
    weekStart: input.weekStart,
    capacityPlanStartWeek: input.capacityPlanStartWeek,
    planningWeeks: input.planningWeeks ?? 52,
    buildMethod: input.buildMethod ?? 'forward',
    defaultPaidHours: input.defaultPaidHours ?? 40,
    defaultShrinkagePct: input.defaultShrinkagePct ?? 0.25,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Pulls the shared client list from MariaDB into the local mirror. On the first
 * run against an empty table, any clients left over from the old localStorage
 * storage are uploaded once so nothing is lost during the migration.
 */
export async function hydrateClientRegistry(): Promise<ClientProfile[]> {
  if (!isRemoteBackend()) return loadClientRegistry()

  try {
    let records = await apiListClients()

    if (records.length === 0) {
      const legacy = loadClientRegistry()
      if (legacy.length > 0) {
        records = await apiSeedClients(legacy)
      }
    }

    const clients = records.map(toClientProfile)
    remoteIds.clear()
    for (const client of clients) remoteIds.add(client.id)
    saveClientRegistry(clients)
    return clients
  } catch (error) {
    // A failed read is not unsaved work, so it does not raise the save badge: the
    // mirror below is the last known good copy and nothing of the user's is at risk.
    console.error('Client list could not be read from the database:', error)
    return loadClientRegistry()
  }
}

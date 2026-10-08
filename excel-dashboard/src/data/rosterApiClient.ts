import { resolveRosterClientName, resolveRosterLobName } from '../planner/clientNameUtils'
import { getApiBaseUrl, getAuthToken } from './apiClient'
import type { RosterEmployee, ScenarioRosterSyncMeta } from '../planner/rosterPersistence'

export type RosterApiAccount = {
  id: string
  name: string
  client?: string
  status?: string
  accountCode?: string
  industry?: string
  region?: string
  programType?: string
  seatCapacity?: number
  accountManager?: string
  timezoneCoverage?: string
}

export type RosterApiErrorBody = {
  error: string
  code?: string
}

export type RosterSyncResponse = {
  ok: boolean
  account: RosterApiAccount
  client: string
  lob: string
  syncedAt: string
  employees: RosterEmployee[]
  stats: {
    fetched: number
    imported: number
    duplicates: number
    manualRetained: number
    active: number
  }
  warnings: Array<{ code: string; message: string }>
}

async function rosterFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = getApiBaseUrl()
  if (!base) {
    throw new Error('Roster sync requires the server API. Run with VITE_API_BASE_URL=/api and npx vercel dev.')
  }
  const token = getAuthToken()
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type') && init?.body) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${base}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })
  const data = (await response.json()) as T & RosterApiErrorBody
  if (!response.ok) {
    throw new Error(data.error || `Roster API error (${response.status})`)
  }
  return data
}

export function isRosterApiAvailable(): boolean {
  return getApiBaseUrl().length > 0
}

/** Prefer account_name (client) and program_type (LOB) from the external JSON. */
export function mappingFromAccount(account: RosterApiAccount | undefined | null): { client: string; lob: string } {
  if (!account) return { client: '', lob: '' }
  return {
    client: resolveRosterClientName(account),
    lob: resolveRosterLobName(account),
  }
}

export async function fetchRosterAccounts(): Promise<RosterApiAccount[]> {
  const data = await rosterFetch<{ accounts: RosterApiAccount[] }>('/roster/accounts')
  return data.accounts
}

export async function fetchRosterAccount(accountId: string): Promise<RosterApiAccount> {
  const data = await rosterFetch<{ account: RosterApiAccount }>(`/roster/accounts?id=${encodeURIComponent(accountId)}`)
  return data.account
}

export async function fetchActiveRosterStaff(): Promise<number> {
  const data = await rosterFetch<{ count: number }>('/roster/staff?employment_status=Active')
  return data.count
}

export async function syncRosterStaff(options: {
  accountId: string
  client: string
  lob: string
  activeOnly: boolean
  existingEmployees: RosterEmployee[]
  mergeWithExisting: boolean
}): Promise<RosterSyncResponse> {
  return rosterFetch<RosterSyncResponse>('/roster/sync', {
    method: 'POST',
    body: JSON.stringify({
      accountId: options.accountId,
      client: options.client,
      lob: options.lob,
      activeOnly: options.activeOnly,
      mergeWithExisting: options.mergeWithExisting,
      existingEmployees: options.existingEmployees,
    }),
  })
}

export function toSyncMeta(scenarioId: string, response: RosterSyncResponse): ScenarioRosterSyncMeta {
  return {
    scenarioId,
    accountId: response.account.id,
    accountName: response.account.name,
    client: response.client,
    lob: response.lob,
    lastSyncedAt: response.syncedAt,
    staffCount: response.stats.imported + response.stats.manualRetained,
    activeCount: response.stats.active,
  }
}

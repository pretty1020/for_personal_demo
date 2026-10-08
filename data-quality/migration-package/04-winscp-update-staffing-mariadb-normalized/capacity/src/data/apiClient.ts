export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (configured === 'false' || configured === 'local') return ''
  if (configured?.trim()) return configured.replace(/\/$/, '')
  if (import.meta.env.PROD) return '/api'
  return ''
}

export function isRemoteBackend(): boolean {
  return getApiBaseUrl().length > 0
}

export type ApiUser = {
  id: string
  email: string
  name: string
  accessLevel: string
}

const AUTH_TOKEN_KEY = 'wfp-auth-token'

export function getAuthToken(): string | null {
  try {
    return sessionStorage.getItem(AUTH_TOKEN_KEY)
  } catch {
    return null
  }
}

export function setAuthToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(AUTH_TOKEN_KEY, token)
    else sessionStorage.removeItem(AUTH_TOKEN_KEY)
  } catch {
    // ignore storage failures
  }
}

const API_TIMEOUT_MS = 15_000

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = getApiBaseUrl()
  const token = getAuthToken()
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  if (init.signal) {
    init.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  try {
    return await fetch(`${base}${path}`, {
      ...init,
      headers,
      credentials: 'include',
      signal: controller.signal,
    })
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export async function checkApiHealth(): Promise<boolean> {
  try {
    const res = await apiFetch('/health')
    if (!res.ok) return false
    const data = (await res.json()) as { database?: string }
    return data.database === 'connected'
  } catch {
    return false
  }
}

export async function apiLogin(
  email: string,
  password: string,
): Promise<{ user: ApiUser; token: string } | null> {
  try {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    if (res.status === 503) {
      throw new Error('Database is not configured on the server.')
    }
    if (res.status >= 500) {
      throw new Error('Login service is unavailable. Try again shortly.')
    }
    if (!res.ok) return null
    const data = (await res.json()) as { user?: ApiUser; token?: string }
    if (!data.user) return null
    if (data.token) setAuthToken(data.token)
    return { user: data.user, token: data.token ?? '' }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Login timed out. Check that the server and database are reachable.')
    }
    if (error instanceof Error) throw error
    return null
  }
}

export async function apiLogout(): Promise<void> {
  try {
    await apiFetch('/auth/logout', { method: 'POST' })
  } finally {
    setAuthToken(null)
  }
}

export async function apiGetSession(): Promise<ApiUser | null> {
  const res = await apiFetch('/auth/me')
  if (!res.ok) return null
  const data = (await res.json()) as { user: ApiUser }
  return data.user
}

/**
 * Reads the retired workspace_state blob. Planning data now lives in capacity_documents;
 * this is kept only so an account that last saved before the move can be migrated once.
 */
export async function apiGetWorkspace(): Promise<{ snapshot: Record<string, string | null>; empty: boolean } | null> {
  const res = await apiFetch('/workspace')
  if (!res.ok) return null
  return (await res.json()) as { snapshot: Record<string, string | null>; empty: boolean }
}

export type ManagedApiUser = {
  id: string
  email: string
  name: string
  accessLevel: string
  active: boolean
  createdAt: string
}

async function readApiError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string }
    if (data.error) return data.error
  } catch {
    // ignore
  }
  return `Request failed (${res.status}).`
}

/** Carries the status and error code so callers can react to a specific failure. */
export class ApiError extends Error {
  status: number
  code: string

  constructor(status: number, message: string, code: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function apiError(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status}).`
  let code = ''
  try {
    const data = (await res.json()) as { error?: string; code?: string }
    if (data.error) message = data.error
    if (data.code) code = data.code
  } catch {
    // Non-JSON body (a proxy error page, say) — keep the status-based message.
  }
  return new ApiError(res.status, message, code)
}

export async function apiListUsers(): Promise<ManagedApiUser[]> {
  const res = await apiFetch('/users')
  if (!res.ok) throw new Error(await readApiError(res))
  const data = (await res.json()) as { users?: ManagedApiUser[] }
  return data.users ?? []
}

export async function apiCreateUser(input: {
  name: string
  email: string
  password: string
  accessLevel: string
  active?: boolean
}): Promise<ManagedApiUser> {
  const res = await apiFetch('/users', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(await readApiError(res))
  const data = (await res.json()) as { user: ManagedApiUser }
  return data.user
}

export async function apiUpdateUser(
  id: string,
  input: {
    name: string
    email: string
    password?: string
    accessLevel: string
    active?: boolean
  },
): Promise<ManagedApiUser> {
  const res = await apiFetch(`/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(await readApiError(res))
  const data = (await res.json()) as { user: ManagedApiUser }
  return data.user
}

export async function apiSetUserActive(id: string, active: boolean): Promise<ManagedApiUser> {
  const res = await apiFetch(`/users/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ active }),
  })
  if (!res.ok) throw new Error(await readApiError(res))
  const data = (await res.json()) as { user: ManagedApiUser }
  return data.user
}

export async function apiDeleteUser(id: string): Promise<void> {
  const res = await apiFetch(`/users/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(await readApiError(res))
}

export type ApiClientRecord = {
  id: string
  name: string
  weekStart: string
  capacityPlanStartWeek: string
  planningWeeks: number
  buildMethod: string
  defaultPaidHours: number
  defaultShrinkagePct: number
  createdAt: string
  updatedAt: string
}

export async function apiListClients(): Promise<ApiClientRecord[]> {
  const res = await apiFetch('/clients')
  if (!res.ok) throw new Error(await readApiError(res))
  const data = (await res.json()) as { clients?: ApiClientRecord[] }
  return data.clients ?? []
}

export async function apiCreateClient(input: Partial<ApiClientRecord>): Promise<ApiClientRecord> {
  const res = await apiFetch('/clients', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(await readApiError(res))
  const data = (await res.json()) as { client: ApiClientRecord }
  return data.client
}

export async function apiUpdateClient(
  id: string,
  input: Partial<ApiClientRecord>,
): Promise<ApiClientRecord> {
  const res = await apiFetch(`/clients/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
  if (!res.ok) throw new Error(await readApiError(res))
  const data = (await res.json()) as { client: ApiClientRecord }
  return data.client
}

export async function apiDeleteClient(id: string): Promise<void> {
  const res = await apiFetch(`/clients/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(await readApiError(res))
}

/** Uploads legacy localStorage clients once, when the shared table is still empty. */
export async function apiSeedClients(
  clients: Partial<ApiClientRecord>[],
): Promise<ApiClientRecord[]> {
  const res = await apiFetch('/clients', {
    method: 'POST',
    body: JSON.stringify({ seed: clients }),
  })
  if (!res.ok) throw new Error(await readApiError(res))
  const data = (await res.json()) as { clients?: ApiClientRecord[] }
  return data.clients ?? []
}

export type ApiDocument = {
  key: string
  payload: unknown
  revision: number
  ownerUserId: string
  ownerName: string
  ownerEmail: string
  updatedAt: string
}

/** The signed-in user's planning documents (capacity_documents rows they own). */
export async function apiListDocuments(): Promise<ApiDocument[]> {
  const res = await apiFetch('/documents')
  if (!res.ok) throw new Error(await readApiError(res))
  const data = (await res.json()) as { documents?: ApiDocument[] }
  return data.documents ?? []
}

/**
 * Every planner's copy of the given keys, for the combined Summary.
 * Manager and above only — the server returns 403 for planners and analysts.
 */
export async function apiListAllDocuments(keys: string[]): Promise<ApiDocument[]> {
  const query = new URLSearchParams({ scope: 'all', keys: keys.join(',') })
  const res = await apiFetch(`/documents?${query.toString()}`)
  if (!res.ok) throw new Error(await readApiError(res))
  const data = (await res.json()) as { documents?: ApiDocument[] }
  return data.documents ?? []
}

/**
 * One planner's full set of documents. Manager and above only.
 *
 * Used when a manager opens someone else's plans: asking for every key of every planner
 * and filtering here would move megabytes to read one person's work.
 */
export async function apiListUserDocuments(userId: string): Promise<ApiDocument[]> {
  const query = new URLSearchParams({ scope: 'user', userId })
  const res = await apiFetch(`/documents?${query.toString()}`)
  if (!res.ok) throw new Error(await readApiError(res))
  const data = (await res.json()) as { documents?: ApiDocument[] }
  return data.documents ?? []
}

/**
 * `targetUserId` writes to that planner's row instead of the caller's own. The server
 * checks the caller is a manager or above and records them as the actor in the audit
 * log; ownership of the row never moves.
 */
export async function apiSaveDocument(
  key: string,
  payload: unknown,
  revision?: number,
  targetUserId?: string | null,
): Promise<ApiDocument> {
  const res = await apiFetch('/documents', {
    method: 'PUT',
    body: JSON.stringify({ key, payload, revision, targetUserId: targetUserId ?? undefined }),
  })
  // Throws ApiError so a revision conflict can be told apart from a network failure.
  if (!res.ok) throw await apiError(res)
  const data = (await res.json()) as { document: ApiDocument }
  return data.document
}

export async function apiDeleteDocument(key: string, targetUserId?: string | null): Promise<void> {
  const query = new URLSearchParams({ key })
  if (targetUserId) query.set('targetUserId', targetUserId)
  const res = await apiFetch(`/documents?${query.toString()}`, { method: 'DELETE' })
  if (!res.ok) throw await apiError(res)
}

/** One-time handover of the old workspace blob; existing rows are left untouched. */
export async function apiBackfillDocuments(
  entries: { key: string; payload: unknown }[],
): Promise<ApiDocument[]> {
  const res = await apiFetch('/documents', {
    method: 'PUT',
    body: JSON.stringify({ backfill: entries }),
  })
  if (!res.ok) throw new Error(await readApiError(res))
  const data = (await res.json()) as { documents?: ApiDocument[] }
  return data.documents ?? []
}

export type ApiStaffingPlanShrinkage = {
  categoryId: string
  categoryName: string
  categoryGroup: string
  plannedPct: number | null
  actualPct: number | null
}

export type ApiStaffingPlanWeek = {
  id?: string
  scenarioId: string
  weekStart: string
  requiredProductionFte: number | null
  productionFte: number | null
  /** @deprecated legacy alias — prefer requiredProductionFte */
  requiredHc?: number | null
  /** @deprecated legacy alias — prefer productionFte */
  productionHc?: number | null
  ownerUserId: string
  updatedAt: string
  shrinkage?: ApiStaffingPlanShrinkage[]
}

function normalizeStaffingPlanWeek(row: ApiStaffingPlanWeek): ApiStaffingPlanWeek {
  const requiredProductionFte =
    row.requiredProductionFte ?? row.requiredHc ?? null
  const productionFte = row.productionFte ?? row.productionHc ?? null
  return {
    ...row,
    requiredProductionFte,
    productionFte,
    shrinkage: row.shrinkage ?? [],
  }
}

/** Required Production FTE + Shrinkage Breakdown from MariaDB staffing_plan*. */
export async function apiListStaffingPlan(
  userId?: string | null,
  options?: { scopeAll?: boolean },
): Promise<ApiStaffingPlanWeek[]> {
  const query = new URLSearchParams()
  if (options?.scopeAll) query.set('scope', 'all')
  else if (userId) query.set('userId', userId)
  const suffix = query.toString() ? `?${query.toString()}` : ''
  const res = await apiFetch(`/staffing-plan${suffix}`)
  if (!res.ok) throw new Error(await readApiError(res))
  const data = (await res.json()) as { weeks?: ApiStaffingPlanWeek[] }
  return (data.weeks ?? []).map(normalizeStaffingPlanWeek)
}

/** Upsert Required Production FTE, Production FTE, and Shrinkage Breakdown into MariaDB. */
export async function apiSaveStaffingPlanWeeks(
  weeks: {
    scenarioId: string
    weekStart: string
    requiredProductionFte?: number | null
    productionFte?: number | null
    shrinkage?: ApiStaffingPlanShrinkage[]
  }[],
  options?: { ownerUserId?: string | null; replaceScenarioId?: string | null },
): Promise<ApiStaffingPlanWeek[]> {
  const res = await apiFetch('/staffing-plan', {
    method: 'PUT',
    body: JSON.stringify({
      weeks,
      ownerUserId: options?.ownerUserId ?? undefined,
      replaceScenarioId: options?.replaceScenarioId ?? undefined,
    }),
  })
  if (!res.ok) throw await apiError(res)
  const data = (await res.json()) as { weeks?: ApiStaffingPlanWeek[] }
  return (data.weeks ?? []).map(normalizeStaffingPlanWeek)
}

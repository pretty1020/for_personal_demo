export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (configured === 'false' || configured === 'local') return ''
  if (configured?.trim()) return configured.replace(/\/$/, '')
  if (import.meta.env.PROD) return '/api'
  return ''
}

export function getAssistantApiBase(): string {
  const configured = getApiBaseUrl()
  return configured || '/api'
}

export function isRemoteBackend(): boolean {
  return getApiBaseUrl().length > 0
}

export type ApiUser = {
  id: string
  email: string
  name: string
  accessLevel: string
  aiAssistantApproved?: boolean
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

const API_TIMEOUT_MS = 5_000

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

export async function apiLogin(email: string, password: string): Promise<{ user: ApiUser; token: string } | null> {
  try {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { user?: ApiUser; token?: string }
    if (!data.user) return null
    if (data.token) setAuthToken(data.token)
    return { user: data.user, token: data.token ?? '' }
  } catch {
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

export async function apiGetWorkspace(): Promise<{ snapshot: Record<string, string | null>; empty: boolean } | null> {
  const res = await apiFetch('/workspace')
  if (!res.ok) return null
  return (await res.json()) as { snapshot: Record<string, string | null>; empty: boolean }
}

export async function apiSaveWorkspace(snapshot: Record<string, string | null>): Promise<boolean> {
  const res = await apiFetch('/workspace', {
    method: 'PUT',
    body: JSON.stringify({ snapshot }),
  })
  return res.ok
}

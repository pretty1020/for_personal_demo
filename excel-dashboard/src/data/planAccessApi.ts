import { getApiBaseUrl, getAuthToken } from './apiClient'
import type { PlanAccessGrant } from '../planner/planAccess'

async function parseJson(response: Response): Promise<{ error?: string; grants?: PlanAccessGrant[] }> {
  try {
    return (await response.json()) as { error?: string; grants?: PlanAccessGrant[] }
  } catch {
    return {}
  }
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getAuthToken()
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

export async function apiListPlanAccess(scenarioId?: string): Promise<PlanAccessGrant[]> {
  const base = getApiBaseUrl()
  if (!base) return []
  const query = scenarioId ? `?scenarioId=${encodeURIComponent(scenarioId)}` : ''
  const response = await fetch(`${base}/plan-access${query}`, {
    method: 'GET',
    credentials: 'include',
    headers: authHeaders(),
  })
  const data = await parseJson(response)
  if (!response.ok) throw new Error(data.error || 'Failed to load plan access.')
  return data.grants ?? []
}

export async function apiGrantPlanAccess(scenarioId: string, granteeEmail: string): Promise<void> {
  const base = getApiBaseUrl()
  if (!base) return
  const response = await fetch(`${base}/plan-access`, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders(),
    body: JSON.stringify({ scenarioId, granteeEmail }),
  })
  const data = await parseJson(response)
  if (!response.ok) throw new Error(data.error || 'Failed to grant plan access.')
}

export async function apiRevokePlanAccess(scenarioId: string, granteeEmail: string): Promise<void> {
  const base = getApiBaseUrl()
  if (!base) return
  const response = await fetch(`${base}/plan-access`, {
    method: 'DELETE',
    credentials: 'include',
    headers: authHeaders(),
    body: JSON.stringify({ scenarioId, granteeEmail }),
  })
  const data = await parseJson(response)
  if (!response.ok) throw new Error(data.error || 'Failed to revoke plan access.')
}

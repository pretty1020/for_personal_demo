import type { CapacityBuildMethod, WeekStart } from './types'
import type { PlannerPlanMetadata } from './types'
import { DEFAULT_CLIENT_TIMEZONE, normalizeTimeZone } from './clientTimezones'
import { normalizeIndustryLabel, rememberIndustryOption } from './clientIndustries'

export type ClientProfile = {
  id: string
  name: string
  /** Call-center / BPO industry sector (customizable). */
  industry: string
  weekStart: WeekStart
  /** IANA timezone for capacity week boundaries (e.g. Asia/Manila). */
  timezone: string
  capacityPlanStartWeek: string
  planningWeeks: number
  buildMethod: CapacityBuildMethod
  defaultPaidHours: number
  defaultShrinkagePct: number
  /** Default site captured when the client is created (for example Manila). */
  site: string
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = 'wfp-client-registry-v1'

function normalizeClientProfile(raw: Partial<ClientProfile> & { name?: string }): ClientProfile {
  const now = new Date().toISOString()
  const industry = normalizeIndustryLabel(raw.industry)
  return {
    id: raw.id?.trim() || crypto.randomUUID(),
    name: (raw.name ?? '').trim(),
    industry,
    weekStart: raw.weekStart === 'monday' ? 'monday' : 'sunday',
    timezone: normalizeTimeZone(raw.timezone),
    capacityPlanStartWeek: raw.capacityPlanStartWeek ?? '',
    planningWeeks: raw.planningWeeks ?? 52,
    buildMethod: raw.buildMethod === 'import' ? 'import' : 'forward',
    defaultPaidHours: raw.defaultPaidHours ?? 40,
    defaultShrinkagePct: raw.defaultShrinkagePct ?? 0.25,
    site: (raw.site ?? '').trim(),
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? now,
  }
}

export function loadClientRegistry(): ClientProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Array<Partial<ClientProfile>>
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => normalizeClientProfile(item))
  } catch {
    return []
  }
}

export function saveClientRegistry(clients: ClientProfile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(clients.map((item) => normalizeClientProfile(item))))
}

export function upsertClientProfile(profile: ClientProfile): ClientProfile[] {
  const clients = loadClientRegistry()
  const normalized = normalizeClientProfile(profile)
  const index = clients.findIndex((item) => item.id === normalized.id)
  const next = [...clients]
  if (index >= 0) next[index] = normalized
  else next.push(normalized)
  saveClientRegistry(next)
  return next
}

export function deleteClientProfile(id: string): ClientProfile[] {
  const next = loadClientRegistry().filter((item) => item.id !== id)
  saveClientRegistry(next)
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
  industry?: string
  weekStart: WeekStart
  timezone?: string
  capacityPlanStartWeek: string
  planningWeeks?: number
  buildMethod?: CapacityBuildMethod
  defaultPaidHours?: number
  defaultShrinkagePct?: number
  site?: string
}): ClientProfile {
  const now = new Date().toISOString()
  const industry = normalizeIndustryLabel(input.industry)
  if (industry) rememberIndustryOption(industry)
  return normalizeClientProfile({
    id: crypto.randomUUID(),
    name: input.name.trim(),
    industry,
    weekStart: input.weekStart,
    timezone: input.timezone ?? DEFAULT_CLIENT_TIMEZONE,
    capacityPlanStartWeek: input.capacityPlanStartWeek,
    planningWeeks: input.planningWeeks ?? 52,
    buildMethod: input.buildMethod ?? 'forward',
    defaultPaidHours: input.defaultPaidHours ?? 40,
    defaultShrinkagePct: input.defaultShrinkagePct ?? 0.25,
    site: input.site?.trim() ?? '',
    createdAt: now,
    updatedAt: now,
  })
}

/** Resolve industry for a client name or id from the registry. */
export function resolveClientIndustry(clientNameOrId: string | null | undefined): string {
  const key = (clientNameOrId ?? '').trim()
  if (!key) return ''
  const byId = findClientById(key)
  if (byId?.industry) return byId.industry
  const byName = findClientByName(key)
  return byName?.industry ?? ''
}

/** Distinct industries currently used by registered clients (plus defaults already loaded separately). */
export function listUsedIndustries(): string[] {
  const seen = new Set<string>()
  for (const client of loadClientRegistry()) {
    const industry = normalizeIndustryLabel(client.industry)
    if (industry) seen.add(industry)
  }
  return [...seen].sort((a, b) => a.localeCompare(b))
}

/** Keep the client registry aligned when plan identity fields change in Capacity Settings. */
export function syncClientProfileFromPlan(
  plan: PlannerPlanMetadata,
  previousClientName?: string,
): PlannerPlanMetadata {
  let clientId = plan.clientId
  if (!clientId && previousClientName?.trim()) {
    clientId = findClientByName(previousClientName)?.id
  }
  if (!clientId) {
    clientId = findClientByName(plan.client)?.id
  }
  if (!clientId) return { ...plan, timezone: normalizeTimeZone(plan.timezone) }

  const profile = findClientById(clientId)
  if (!profile) return { ...plan, clientId, timezone: normalizeTimeZone(plan.timezone) }

  const timezone = normalizeTimeZone(plan.timezone ?? profile.timezone)
  upsertClientProfile({
    ...profile,
    name: plan.client.trim(),
    weekStart: plan.weekStart,
    timezone,
    capacityPlanStartWeek: plan.capacityPlanStartWeek ?? profile.capacityPlanStartWeek,
    planningWeeks: plan.planningWeeks ?? profile.planningWeeks,
    buildMethod: plan.buildMethod ?? profile.buildMethod,
    updatedAt: new Date().toISOString(),
  })
  return { ...plan, clientId, timezone }
}

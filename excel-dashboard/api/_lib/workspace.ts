import {
  canViewFinancials,
  filterAccessibleScenarioIds,
  type PlanAccessGrant,
  type PlanAccessSubject,
  type PlanAccessTarget,
  FINANCIAL_WORKSPACE_KEYS,
} from './rbac.js'

export const WORKSPACE_KEYS = [
  'wfp-planner-scenarios-v1',
  'wfp-planner-active-v1',
  'wfp-planner-granularity-v1',
  'wfp-roster-store-v1',
  'wfp-roster-sync-meta-v1',
  'wfp-ledger-actual-overrides-v1',
  'wfp-forecast-overrides-v1',
  'wfp-capacity-plan-overrides-v1',
  'wfp-capacity-plan-view-v1',
  'wfp-capacity-matrix-view-v2',
  'wfp-aht-analysis-overrides-v1',
  'wfp-capacity-metric-order-v1',
  'wfp-scheduling-v1',
  'wfp-scheduling-templates-v1',
  'wfp-plan-access-grants-v1',
  'wfp-revenue-projection-lines-v1',
] as const

export type WorkspaceSnapshot = Record<string, string | null>

export function normalizeWorkspaceSnapshot(input: unknown): WorkspaceSnapshot {
  if (!input || typeof input !== 'object') return {}
  const snapshot: WorkspaceSnapshot = {}
  for (const key of WORKSPACE_KEYS) {
    const value = (input as Record<string, unknown>)[key]
    snapshot[key] = typeof value === 'string' ? value : null
  }
  return snapshot
}

export function isEmptyWorkspace(snapshot: WorkspaceSnapshot): boolean {
  return WORKSPACE_KEYS.every((key) => !snapshot[key])
}

type StoredScenario = PlanAccessTarget & {
  name?: string
  assumptions?: unknown
  plan?: unknown
  [key: string]: unknown
}

function parseScenarios(raw: string | null): StoredScenario[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as StoredScenario[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseGrants(raw: string | null): PlanAccessGrant[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as { grants?: PlanAccessGrant[] }
    return Array.isArray(parsed.grants) ? parsed.grants : []
  } catch {
    return []
  }
}

function filterKeyedStore(raw: string | null, allowedIds: Set<string>): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return raw
    const next: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (allowedIds.has(key)) next[key] = value
    }
    return JSON.stringify(next)
  } catch {
    return raw
  }
}

/**
 * Enforce RBAC on workspace payloads before returning to the client:
 * - Keep only capacity plans the user can access
 * - Strip financial / revenue keys for capacity planners
 */
export function applyWorkspaceRbac(
  snapshot: WorkspaceSnapshot,
  subject: PlanAccessSubject,
): WorkspaceSnapshot {
  const grants = parseGrants(snapshot['wfp-plan-access-grants-v1'])
  const scenarios = parseScenarios(snapshot['wfp-planner-scenarios-v1'])
  const allowedIds = filterAccessibleScenarioIds(scenarios, subject, grants)
  const filteredScenarios = scenarios.filter((scenario) => allowedIds.has(scenario.id))

  const next: WorkspaceSnapshot = { ...snapshot }
  next['wfp-planner-scenarios-v1'] = JSON.stringify(filteredScenarios)

  const activeId = snapshot['wfp-planner-active-v1']
  if (activeId && !allowedIds.has(activeId)) {
    next['wfp-planner-active-v1'] = filteredScenarios[0]?.id ?? null
  }

  for (const key of [
    'wfp-roster-store-v1',
    'wfp-roster-sync-meta-v1',
    'wfp-ledger-actual-overrides-v1',
    'wfp-forecast-overrides-v1',
    'wfp-capacity-plan-overrides-v1',
  ] as const) {
    next[key] = filterKeyedStore(snapshot[key], allowedIds)
  }

  if (!canViewFinancials(subject.accessLevel)) {
    for (const key of FINANCIAL_WORKSPACE_KEYS) {
      next[key] = null
    }
  }

  // Non-admins only receive their own grants list (prevents privilege discovery).
  if (subject.accessLevel !== 'admin') {
    next['wfp-plan-access-grants-v1'] = JSON.stringify({
      grants: grants.filter((item) => item.granteeEmail === subject.email.trim().toLowerCase()),
    })
  }

  return next
}

/**
 * Reject PUT attempts that try to mutate scenarios the user cannot access,
 * or that inject financial keys for capacity planners.
 */
export function assertWorkspaceWriteAllowed(
  incoming: WorkspaceSnapshot,
  existing: WorkspaceSnapshot,
  subject: PlanAccessSubject,
): void {
  if (!canViewFinancials(subject.accessLevel)) {
    for (const key of FINANCIAL_WORKSPACE_KEYS) {
      if (incoming[key] && incoming[key] !== existing[key]) {
        const error = new Error('Capacity planners cannot write financial workspace data.')
        ;(error as Error & { status: number }).status = 403
        throw error
      }
    }
  }

  const grants = parseGrants(existing['wfp-plan-access-grants-v1'] ?? incoming['wfp-plan-access-grants-v1'])
  const existingScenarios = parseScenarios(existing['wfp-planner-scenarios-v1'])
  const incomingScenarios = parseScenarios(incoming['wfp-planner-scenarios-v1'])
  const allowedIds = filterAccessibleScenarioIds(existingScenarios, subject, grants)

  for (const scenario of incomingScenarios) {
    const wasExisting = existingScenarios.some((item) => item.id === scenario.id)
    if (!wasExisting) {
      // New plans must be owned by the creator (unless admin).
      const owner = (scenario.ownerEmail ?? '').trim().toLowerCase()
      if (subject.accessLevel !== 'admin' && owner && owner !== subject.email.trim().toLowerCase()) {
        const error = new Error('Cannot create capacity plans owned by another user.')
        ;(error as Error & { status: number }).status = 403
        throw error
      }
      continue
    }
    if (!allowedIds.has(scenario.id) && subject.accessLevel !== 'admin') {
      const error = new Error('Cannot modify a capacity plan you do not have access to.')
      ;(error as Error & { status: number }).status = 403
      throw error
    }
  }
}

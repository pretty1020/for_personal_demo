import {
  canManagePlanAccess,
  canViewFinancials,
  normalizeAccessLevel,
  type AccessLevel,
} from '../utils/accessLevel'
import { rewriteLegacyBrandEmail } from './userDirectory'

const STORAGE_KEY = 'wfp-plan-access-grants-v1'

export type PlanAccessGrant = {
  scenarioId: string
  granteeEmail: string
  /** Granted users may view and edit the plan (same as owner for capacity work). */
  grantedByEmail: string
  grantedAt: string
}

export type PlanAccessStore = {
  grants: PlanAccessGrant[]
}

export type PlanAccessSubject = {
  email: string
  accessLevel: AccessLevel
}

export type PlanAccessTarget = {
  id: string
  ownerEmail?: string | null
  isBaseline?: boolean
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

export function loadPlanAccessStore(): PlanAccessStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { grants: [] }
    const parsed = JSON.parse(raw) as PlanAccessStore
    if (!parsed || !Array.isArray(parsed.grants)) return { grants: [] }
    let changed = false
    const grants = parsed.grants
      .filter((item) => item?.scenarioId && item?.granteeEmail)
      .map((item) => {
        const granteeEmail = rewriteLegacyBrandEmail(item.granteeEmail)
        const grantedByEmail = rewriteLegacyBrandEmail(item.grantedByEmail)
        if (
          granteeEmail !== normalizeEmail(item.granteeEmail) ||
          grantedByEmail !== normalizeEmail(item.grantedByEmail)
        ) {
          changed = true
        }
        return {
          scenarioId: String(item.scenarioId),
          granteeEmail,
          grantedByEmail,
          grantedAt: item.grantedAt || new Date().toISOString(),
        }
      })
    if (changed) savePlanAccessStore({ grants })
    return { grants }
  } catch {
    return { grants: [] }
  }
}

export function savePlanAccessStore(store: PlanAccessStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ grants: store.grants }))
}

export function listPlanAccessGrants(scenarioId?: string): PlanAccessGrant[] {
  const { grants } = loadPlanAccessStore()
  if (!scenarioId) return grants
  return grants.filter((item) => item.scenarioId === scenarioId)
}

export function hasPlanAccessGrant(scenarioId: string, email: string): boolean {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  return listPlanAccessGrants(scenarioId).some((item) => item.granteeEmail === normalized)
}

export function isPlanOwner(plan: PlanAccessTarget, email: string): boolean {
  const owner = normalizeEmail(plan.ownerEmail)
  const user = normalizeEmail(email)
  return Boolean(owner && user && owner === user)
}

/**
 * Who may open a capacity plan:
 * - Admin: all plans
 * - Owner: own plans
 * - Grantee: plans admin granted
 * - Baseline reference: visible to authenticated capacity users (handled by caller role)
 */
export function canAccessCapacityPlan(
  plan: PlanAccessTarget,
  subject: PlanAccessSubject | null | undefined,
): boolean {
  if (!subject?.email) return false
  if (normalizeAccessLevel(subject.accessLevel) === 'admin') return true
  if (plan.isBaseline) return true
  if (isPlanOwner(plan, subject.email)) return true
  return hasPlanAccessGrant(plan.id, subject.email)
}

export function canEditCapacityPlan(
  plan: PlanAccessTarget,
  subject: PlanAccessSubject | null | undefined,
): boolean {
  if (!subject?.email) return false
  if (plan.isBaseline && normalizeAccessLevel(subject.accessLevel) !== 'admin') return false
  return canAccessCapacityPlan(plan, subject)
}

/** Admin may delete any plan; others may delete only plans they own. */
export function canDeleteCapacityPlan(
  plan: PlanAccessTarget,
  subject: PlanAccessSubject | null | undefined,
): boolean {
  if (!subject?.email) return false
  if (plan.isBaseline && normalizeAccessLevel(subject.accessLevel) !== 'admin') return false
  if (normalizeAccessLevel(subject.accessLevel) === 'admin') return true
  return isPlanOwner(plan, subject.email)
}

/** Financial / executive / revenue / margin data for a specific plan. */
export function canViewPlanFinancials(
  plan: PlanAccessTarget,
  subject: PlanAccessSubject | null | undefined,
): boolean {
  if (!subject) return false
  if (!canViewFinancials(subject.accessLevel)) return false
  return canAccessCapacityPlan(plan, subject)
}

export function grantPlanAccess(input: {
  scenarioId: string
  granteeEmail: string
  grantedByEmail: string
}): PlanAccessGrant {
  const scenarioId = input.scenarioId.trim()
  const granteeEmail = normalizeEmail(input.granteeEmail)
  const grantedByEmail = normalizeEmail(input.grantedByEmail)
  if (!scenarioId || !granteeEmail) {
    throw new Error('Scenario and grantee email are required.')
  }
  const store = loadPlanAccessStore()
  const existing = store.grants.find(
    (item) => item.scenarioId === scenarioId && item.granteeEmail === granteeEmail,
  )
  if (existing) return existing
  const grant: PlanAccessGrant = {
    scenarioId,
    granteeEmail,
    grantedByEmail,
    grantedAt: new Date().toISOString(),
  }
  savePlanAccessStore({ grants: [...store.grants, grant] })
  return grant
}

export function revokePlanAccess(scenarioId: string, granteeEmail: string): boolean {
  const normalized = normalizeEmail(granteeEmail)
  const store = loadPlanAccessStore()
  const next = store.grants.filter(
    (item) => !(item.scenarioId === scenarioId && item.granteeEmail === normalized),
  )
  if (next.length === store.grants.length) return false
  savePlanAccessStore({ grants: next })
  return true
}

export function revokeAllPlanAccessForScenario(scenarioId: string): void {
  const store = loadPlanAccessStore()
  savePlanAccessStore({
    grants: store.grants.filter((item) => item.scenarioId !== scenarioId),
  })
}

export function filterAccessiblePlans<T extends PlanAccessTarget>(
  plans: T[],
  subject: PlanAccessSubject | null | undefined,
): T[] {
  return plans.filter((plan) => canAccessCapacityPlan(plan, subject))
}

export function assertCanManagePlanAccess(subject: PlanAccessSubject | null | undefined): void {
  if (!subject || !canManagePlanAccess(subject.accessLevel)) {
    throw new Error('Only admins can manage capacity plan access.')
  }
}

export { STORAGE_KEY as PLAN_ACCESS_STORAGE_KEY }

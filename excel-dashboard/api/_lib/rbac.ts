import type { AccessLevel } from './accessLevel.js'

export type { AccessLevel }

export function normalizeAccessLevel(raw: string | null | undefined): AccessLevel {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === 'admin') return 'admin'
  if (value === 'cap_planner' || value === 'scheduler') return 'cap_planner'
  if (value === 'manager') return 'manager'
  if (value === 'director') return 'director'
  if (value === 'vp' || value === 'executive') return 'vp'
  return 'manager'
}

export function canManageUsers(level: AccessLevel | null | undefined): boolean {
  return level === 'admin'
}

export function canManagePlanAccess(level: AccessLevel | null | undefined): boolean {
  return level === 'admin'
}

export function canCreatePlans(level: AccessLevel | null | undefined): boolean {
  return (
    level === 'admin' ||
    level === 'cap_planner' ||
    level === 'manager' ||
    level === 'director' ||
    level === 'vp'
  )
}

export function canViewFinancials(level: AccessLevel | null | undefined): boolean {
  return level === 'admin' || level === 'manager' || level === 'director' || level === 'vp'
}

export function canViewExecutiveDashboard(level: AccessLevel | null | undefined): boolean {
  return canViewFinancials(level)
}

export type PlanAccessGrant = {
  scenarioId: string
  granteeEmail: string
  grantedByEmail: string
  grantedAt: string
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

export function isPlanOwner(plan: PlanAccessTarget, email: string): boolean {
  const owner = normalizeEmail(plan.ownerEmail)
  const user = normalizeEmail(email)
  return Boolean(owner && user && owner === user)
}

export function hasPlanAccessGrant(
  grants: PlanAccessGrant[],
  scenarioId: string,
  email: string,
): boolean {
  const normalized = normalizeEmail(email)
  return grants.some(
    (item) => item.scenarioId === scenarioId && item.granteeEmail === normalized,
  )
}

export function canAccessCapacityPlan(
  plan: PlanAccessTarget,
  subject: PlanAccessSubject | null | undefined,
  grants: PlanAccessGrant[],
): boolean {
  if (!subject?.email) return false
  if (normalizeAccessLevel(subject.accessLevel) === 'admin') return true
  if (plan.isBaseline) return true
  if (isPlanOwner(plan, subject.email)) return true
  return hasPlanAccessGrant(grants, plan.id, subject.email)
}

export function canViewPlanFinancials(
  plan: PlanAccessTarget,
  subject: PlanAccessSubject | null | undefined,
  grants: PlanAccessGrant[],
): boolean {
  if (!subject || !canViewFinancials(subject.accessLevel)) return false
  return canAccessCapacityPlan(plan, subject, grants)
}

export function filterAccessibleScenarioIds(
  scenarios: PlanAccessTarget[],
  subject: PlanAccessSubject,
  grants: PlanAccessGrant[],
): Set<string> {
  return new Set(
    scenarios.filter((plan) => canAccessCapacityPlan(plan, subject, grants)).map((plan) => plan.id),
  )
}

/** Keys that hold financial / revenue / margin data and must be withheld from cap_planner. */
export const FINANCIAL_WORKSPACE_KEYS = [
  'wfp-revenue-projection-lines-v1',
] as const

export function assertAdminPlanAccess(subject: PlanAccessSubject | null | undefined): void {
  if (!subject || !canManagePlanAccess(subject.accessLevel)) {
    const error = new Error('Only admins can manage capacity plan access.')
    ;(error as Error & { status: number }).status = 403
    throw error
  }
}

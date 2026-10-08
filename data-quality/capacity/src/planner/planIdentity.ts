import type { PlannerPlanMetadata } from './types'

/** Line of business label. Legacy plans stored LOB in `location`. */
export function resolvePlanLob(plan: Pick<PlannerPlanMetadata, 'lob' | 'location'>): string {
  const lob = plan.lob?.trim()
  if (lob) return lob
  return plan.location?.trim() || ''
}

/**
 * Geographic / site location.
 * When `lob` is unset, `location` was historically the LOB name — treat site as empty.
 */
export function resolvePlanLocation(plan: Pick<PlannerPlanMetadata, 'lob' | 'location'>): string {
  if (plan.lob?.trim()) return plan.location?.trim() || ''
  return ''
}

export function resolvePlanProjectCode(plan: Pick<PlannerPlanMetadata, 'projectCode'>): string {
  return plan.projectCode?.trim() || ''
}

/** Case-insensitive match key for shared project-code roll-ups. */
export function normalizeProjectCode(code: string | null | undefined): string {
  return (code ?? '').trim().toUpperCase()
}

export function planScopeLabel(plan: Pick<PlannerPlanMetadata, 'client' | 'lob' | 'location'>): string {
  const lob = resolvePlanLob(plan)
  const location = resolvePlanLocation(plan)
  if (lob && location) return `${plan.client} · ${lob} · ${location}`
  if (lob) return `${plan.client} · ${lob}`
  return plan.client
}

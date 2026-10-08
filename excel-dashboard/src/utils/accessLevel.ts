export type AccessLevel = 'admin' | 'cap_planner' | 'manager' | 'director' | 'vp'

/** Legacy values that may still exist in stored sessions or API responses. */
type LegacyAccessLevel = AccessLevel | 'executive' | 'scheduler'

export const ACCESS_LEVEL_OPTIONS: { value: AccessLevel; label: string; blurb: string }[] = [
  {
    value: 'admin',
    label: 'Admin',
    blurb: 'Manage users and capacity plan access; full visibility',
  },
  {
    value: 'cap_planner',
    label: 'Capacity planner / Scheduler',
    blurb: 'Create and edit own capacity plans only; no financials or executive data',
  },
  {
    value: 'manager',
    label: 'Manager',
    blurb: 'Create and edit own plans; financials and executive for accessible plans',
  },
  {
    value: 'director',
    label: 'Director',
    blurb: 'Create and edit own plans; financials and executive for accessible plans',
  },
  {
    value: 'vp',
    label: 'VP',
    blurb: 'Create and edit own plans; financials and executive for accessible plans',
  },
]

export function accessLevelLabel(level: AccessLevel | null | undefined): string {
  return ACCESS_LEVEL_OPTIONS.find((item) => item.value === level)?.label ?? 'Manager'
}

export function normalizeAccessLevel(raw: string | null | undefined): AccessLevel {
  const value = (raw ?? '').trim().toLowerCase() as LegacyAccessLevel | ''
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

/** Admin only — grant/revoke capacity plan access for any user. */
export function canManagePlanAccess(level: AccessLevel | null | undefined): boolean {
  return level === 'admin'
}

/** Cap planner, manager+, and admin may create capacity plans. */
export function canCreatePlans(level: AccessLevel | null | undefined): boolean {
  return (
    level === 'admin' ||
    level === 'cap_planner' ||
    level === 'manager' ||
    level === 'director' ||
    level === 'vp'
  )
}

/** Role may edit capacity matrices when they also have plan access. */
export function canEditCapacity(level: AccessLevel | null | undefined): boolean {
  return canCreatePlans(level)
}

/**
 * Manager and above (plus admin) may see Financials, Revenue, Margin, and Executive.
 * Capacity planners cannot — even for plans they own.
 */
export function canViewFinancials(level: AccessLevel | null | undefined): boolean {
  return level === 'admin' || level === 'manager' || level === 'director' || level === 'vp'
}

export function canViewExecutiveDashboard(level: AccessLevel | null | undefined): boolean {
  return canViewFinancials(level)
}

/** Admin may edit capacity formula overrides used by the matrix. */
export function canEditFormulas(level: AccessLevel | null | undefined): boolean {
  return level === 'admin'
}

/** Legacy name used by older panels — prefer canViewFinancials. */
export function isExecutiveAccess(level: AccessLevel | undefined | null): boolean {
  return canViewFinancials(level)
}

/** Map app roles to the coarser API assistant/session contract. */
export function toApiAccessLevel(level: AccessLevel | null | undefined): 'executive' | 'manager' {
  if (level === 'manager' || level === 'cap_planner') return 'manager'
  return 'executive'
}

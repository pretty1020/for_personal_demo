export type AccessLevel = 'admin' | 'cap_planner' | 'analyst' | 'manager' | 'director' | 'vp'

/** Legacy values that may still exist in stored sessions or API responses. */
type LegacyAccessLevel = AccessLevel | 'executive' | 'scheduler'

export const ACCESS_LEVEL_OPTIONS: { value: AccessLevel; label: string; blurb: string }[] = [
  { value: 'admin', label: 'Admin', blurb: 'Full access including user management, formula edits, and Manager client grants' },
  {
    value: 'manager',
    label: 'Manager',
    blurb: 'View and edit Staffing Plans for Admin-assigned clients only — no DBE or Leakage',
  },
  {
    value: 'director',
    label: 'Director',
    blurb: 'Full Capacity pages including DBE and Leakage; can create and edit capacity plans',
  },
  {
    value: 'vp',
    label: 'VP',
    blurb: 'Full Capacity pages including DBE and Leakage; executive portfolio visibility',
  },
  {
    value: 'cap_planner',
    label: 'Capacity planner / Scheduler',
    blurb: 'Create and edit capacity plans and Summary — no DBE or Leakage',
  },
  {
    value: 'analyst',
    label: 'Analyst',
    blurb: 'View and edit staffing plans and Summary — no DBE or Leakage',
  },
]

export function accessLevelLabel(level: AccessLevel | null | undefined): string {
  return ACCESS_LEVEL_OPTIONS.find((item) => item.value === level)?.label ?? 'Manager'
}

export function normalizeAccessLevel(raw: string | null | undefined): AccessLevel {
  const value = (raw ?? '').trim().toLowerCase() as LegacyAccessLevel | ''
  if (value === 'admin') return 'admin'
  if (value === 'cap_planner' || value === 'scheduler') return 'cap_planner'
  if (value === 'analyst') return 'analyst'
  if (value === 'manager') return 'manager'
  if (value === 'director') return 'director'
  if (value === 'vp' || value === 'executive') return 'vp'
  return 'manager'
}

/** Manager, Director, VP, Admin — portfolio / multi-planner Staffing visibility (client-scoped for Manager). */
export function isManagerOrAbove(level: AccessLevel | null | undefined): boolean {
  return level === 'manager' || level === 'director' || level === 'vp' || level === 'admin'
}

/** Director, VP, Admin — DBE and Leakage (Managers are excluded). */
export function isDirectorOrAbove(level: AccessLevel | null | undefined): boolean {
  return level === 'director' || level === 'vp' || level === 'admin'
}

export function canManageUsers(level: AccessLevel | null | undefined): boolean {
  return level === 'admin'
}

export function canCreatePlans(level: AccessLevel | null | undefined): boolean {
  return level === 'admin' || level === 'cap_planner' || level === 'director'
}

export function canEditCapacity(level: AccessLevel | null | undefined): boolean {
  return (
    level === 'admin' ||
    level === 'cap_planner' ||
    level === 'analyst' ||
    level === 'manager' ||
    level === 'director'
  )
}

/** Portfolio Summary + combined grids — Manager+ plus planner and analyst. */
export function canViewPortfolioSummary(level: AccessLevel | null | undefined): boolean {
  return (
    level === 'manager' ||
    level === 'director' ||
    level === 'vp' ||
    level === 'admin' ||
    level === 'cap_planner' ||
    level === 'analyst'
  )
}

/** Alias: same roles can open combined all-plans staffing grids. */
export function canViewAllCapacityPlans(level: AccessLevel | null | undefined): boolean {
  return canViewPortfolioSummary(level)
}

/** DBE and Leakage — Director and above only (not Manager, Analyst, or Capacity planner). */
export function canViewDbeLeakage(level: AccessLevel | null | undefined): boolean {
  return isDirectorOrAbove(level)
}

/**
 * Whether a Manager may work on this client.
 * Directors+ ignore grants (full portfolio). Non-managers ignore grants.
 * Empty grant list for a Manager means no clients — no fallback to “all”.
 */
export function canAccessAssignedClient(
  level: AccessLevel | null | undefined,
  clientName: string,
  allowedClients: readonly string[] | null | undefined,
): boolean {
  if (isDirectorOrAbove(level) || level === 'admin') return true
  if (level !== 'manager') return true
  const needle = clientName.trim().toLowerCase()
  if (!needle) return false
  const grants = (allowedClients ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean)
  if (!grants.length) return false
  return grants.includes(needle)
}

/** Admin-only: edit capacity formula reference text shown in-app. */
export function canEditFormulas(level: AccessLevel | null | undefined): boolean {
  return level === 'admin'
}

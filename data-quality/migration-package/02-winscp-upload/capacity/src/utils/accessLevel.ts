export type AccessLevel = 'admin' | 'cap_planner' | 'analyst' | 'manager' | 'director' | 'vp'

/** Legacy values that may still exist in stored sessions or API responses. */
type LegacyAccessLevel = AccessLevel | 'executive' | 'scheduler'

export const ACCESS_LEVEL_OPTIONS: { value: AccessLevel; label: string; blurb: string }[] = [
  { value: 'admin', label: 'Admin', blurb: 'Full access including user management and formula edits' },
  {
    value: 'manager',
    label: 'Manager',
    blurb: 'Full Capacity pages including DBE and Leakage; edit staffing plans and portfolio Summary',
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

/** Manager, Director, VP, Admin — full app pages including DBE and Leakage. */
export function isManagerOrAbove(level: AccessLevel | null | undefined): boolean {
  return level === 'manager' || level === 'director' || level === 'vp' || level === 'admin'
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

/** DBE and Leakage — Manager and above only (not Analyst or Capacity planner). */
export function canViewDbeLeakage(level: AccessLevel | null | undefined): boolean {
  return isManagerOrAbove(level)
}

/** Admin-only: edit capacity formula reference text shown in-app. */
export function canEditFormulas(level: AccessLevel | null | undefined): boolean {
  return level === 'admin'
}

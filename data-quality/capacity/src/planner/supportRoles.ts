export type SupportRoleTemplate = {
  id: string
  name: string
}

export const PRESET_SUPPORT_ROLES: SupportRoleTemplate[] = [
  { id: 'team_lead', name: 'Team Lead' },
  { id: 'manager', name: 'Manager' },
  { id: 'qa', name: 'QA' },
  { id: 'trainer', name: 'Trainer' },
  { id: 'wfm', name: 'WFM' },
]

export const DEFAULT_VISIBLE_SUPPORT_ROLE_IDS: string[] = PRESET_SUPPORT_ROLES.map((role) => role.id)

export function isCustomSupportRoleId(roleId: string): boolean {
  return roleId.startsWith('custom_support_')
}

export function mergeSupportRoleTemplates(customRoles: SupportRoleTemplate[] = []): SupportRoleTemplate[] {
  const merged = [...PRESET_SUPPORT_ROLES]
  const seen = new Set(PRESET_SUPPORT_ROLES.map((role) => role.id))
  for (const role of customRoles) {
    if (seen.has(role.id)) continue
    merged.push(role)
    seen.add(role.id)
  }
  return merged
}

export function supportRoleLabel(id: string, templates: SupportRoleTemplate[] = []): string {
  return templates.find((item) => item.id === id)?.name ?? id
}

export function createCustomSupportRole(name: string): SupportRoleTemplate {
  const normalized = name.trim() || 'Support role'
  const slug =
    normalized
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'role'
  return {
    id: `custom_support_${slug}_${Math.random().toString(36).slice(2, 8)}`,
    name: normalized,
  }
}

export function resolveActiveSupportRoleIds(
  visibleRoleIds: readonly string[],
  scenarioRoleIds: readonly string[] = [],
  overrideRoleIds: readonly string[] = [],
): string[] {
  const active = new Set<string>()
  for (const id of visibleRoleIds) active.add(id)
  for (const id of scenarioRoleIds) {
    if (isCustomSupportRoleId(id)) active.add(id)
  }
  for (const id of overrideRoleIds) active.add(id)
  return [...active]
}

export function sumSupportRoleValues(roles: Record<string, number> | undefined): number {
  if (!roles) return 0
  return Object.values(roles).reduce(
    (sum, value) => sum + (Number.isFinite(value) ? Math.round(value) : 0),
    0,
  )
}

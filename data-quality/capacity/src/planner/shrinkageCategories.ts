export type ShrinkageCategoryTemplate = {
  id: string
  name: string
  group: 'out_of_office' | 'in_office'
  billable: boolean
  share: number
}

/**
 * Default Out of Office breakdown — always available on every plan.
 * Shares split the Out of Office portion of total planned shrinkage when auto-allocating.
 */
export const BASE_OUT_OF_OFFICE_SHRINKAGE_CATEGORIES: ShrinkageCategoryTemplate[] = [
  { id: 'absenteeism', name: 'Absenteeism', group: 'out_of_office', billable: false, share: 0.5 },
  { id: 'vacation_leave', name: 'Vacation Leave', group: 'out_of_office', billable: false, share: 0.5 },
]

/** Optional in-office presets retained for import/migration compatibility only. */
export const BASE_IN_OFFICE_SHRINKAGE_CATEGORIES: ShrinkageCategoryTemplate[] = [
  { id: 'aux_default', name: 'Default', group: 'in_office', billable: true, share: 0.15 },
  { id: 'meeting', name: 'Meetings', group: 'in_office', billable: false, share: 0.12 },
  { id: 'coaching', name: 'Coaching', group: 'in_office', billable: false, share: 0.1 },
  { id: 'training', name: 'Training', group: 'in_office', billable: false, share: 0.13 },
  { id: 'nesting', name: 'Nesting', group: 'in_office', billable: false, share: 0.12 },
  { id: 'calibration', name: 'Calibration', group: 'in_office', billable: false, share: 0.1 },
  { id: 'offline', name: 'Offline', group: 'in_office', billable: false, share: 0.13 },
  { id: 'aux_other', name: 'Others', group: 'in_office', billable: false, share: 0.15 },
]

export const SHRINKAGE_CATEGORY_TEMPLATES: ShrinkageCategoryTemplate[] = [
  ...BASE_OUT_OF_OFFICE_SHRINKAGE_CATEGORIES,
  ...BASE_IN_OFFICE_SHRINKAGE_CATEGORIES,
]

/** Capacity matrix shows Absenteeism + Vacation Leave breakdown by default. */
export const DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS: string[] = BASE_OUT_OF_OFFICE_SHRINKAGE_CATEGORIES.map(
  (category) => category.id,
)

export function isCustomShrinkageCategoryId(categoryId: string): boolean {
  return categoryId.startsWith('custom_')
}

export function isDefaultOutOfOfficeShrinkageCategoryId(categoryId: string): boolean {
  return BASE_OUT_OF_OFFICE_SHRINKAGE_CATEGORIES.some((category) => category.id === categoryId)
}

/**
 * Always includes default Out of Office categories (Absenteeism, Vacation Leave),
 * then scenario custom categories. In-office presets are not auto-added.
 */
export function mergeShrinkageCategoryTemplates(
  customCategories: ShrinkageCategoryTemplate[] = [],
): ShrinkageCategoryTemplate[] {
  const merged: ShrinkageCategoryTemplate[] = []
  const seen = new Set<string>()
  for (const category of BASE_OUT_OF_OFFICE_SHRINKAGE_CATEGORIES) {
    if (seen.has(category.id)) continue
    merged.push(category)
    seen.add(category.id)
  }
  for (const category of customCategories) {
    if (seen.has(category.id)) continue
    // Prefer the canonical default definition when a scenario re-stores Absenteeism / Vacation Leave.
    if (isDefaultOutOfOfficeShrinkageCategoryId(category.id)) continue
    merged.push(category)
    seen.add(category.id)
  }
  return merged
}

export function splitShrinkageCategoriesByGroup(categories: ShrinkageCategoryTemplate[]): {
  outOfOffice: ShrinkageCategoryTemplate[]
  inOffice: ShrinkageCategoryTemplate[]
} {
  return {
    outOfOffice: categories.filter((category) => category.group === 'out_of_office'),
    inOffice: categories.filter((category) => category.group === 'in_office'),
  }
}

export function shrinkageCategoryLabel(id: string, templates: ShrinkageCategoryTemplate[] = []): string {
  return templates.find((item) => item.id === id)?.name ?? id
}

export function splitPlannedShrinkageTotal(
  totalPct: number,
  inOfficeShare: number,
): { outOfOffice: number; inOffice: number } {
  const bounded = Math.max(0, totalPct)
  const inOffice = bounded * inOfficeShare
  return { outOfOffice: bounded - inOffice, inOffice }
}

export function defaultCategoryPlannedPct(
  categoryId: string,
  totalPct: number,
  inOfficeShare: number,
  templates: ShrinkageCategoryTemplate[] = [],
): number {
  const template = templates.find((item) => item.id === categoryId)
  if (!template) return 0
  if (template.share <= 0) return 0
  const { outOfOffice, inOffice } = splitPlannedShrinkageTotal(totalPct, inOfficeShare)
  const groupTotal = template.group === 'out_of_office' ? outOfOffice : inOffice
  return groupTotal * template.share
}

export function createCustomShrinkageCategory(
  name: string,
  group: 'out_of_office' | 'in_office',
  billable = false,
): ShrinkageCategoryTemplate {
  const normalized = name.trim() || `${group === 'in_office' ? 'Aux' : 'Category'}`
  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'custom'
  return {
    id: `custom_${group}_${slug}_${Math.random().toString(36).slice(2, 8)}`,
    name: normalized,
    group,
    billable,
    share: 0,
  }
}

export function isShrinkageCategoryVisible(categoryId: string, visibleCategoryIds: readonly string[]): boolean {
  return visibleCategoryIds.includes(categoryId)
}

/** Categories that contribute to planned shrinkage totals and Production FTE. */
export function resolveActiveShrinkageCategoryIds(
  visibleCategoryIds: readonly string[],
  scenarioCategoryIds: readonly string[] = [],
  overrideCategoryIds: readonly string[] = [],
): string[] {
  const active = new Set<string>()
  for (const id of visibleCategoryIds) active.add(id)
  for (const id of scenarioCategoryIds) {
    if (isCustomShrinkageCategoryId(id)) active.add(id)
  }
  for (const id of overrideCategoryIds) active.add(id)
  return [...active]
}

export function sumCategoryPlannedValues(
  categories: Record<string, { planned: number; group?: string }>,
  visibleCategoryIds: readonly string[],
): number {
  return Object.entries(categories)
    .filter(([id]) => isShrinkageCategoryVisible(id, visibleCategoryIds))
    .reduce((sum, [, item]) => sum + item.planned, 0)
}

export function sumCategoryActualValues(
  categories: Array<{ id: string; actualPct: number | null; group?: string }>,
  visibleCategoryIds: readonly string[],
): number {
  return categories
    .filter((item) => isShrinkageCategoryVisible(item.id, visibleCategoryIds))
    .reduce((sum, item) => sum + (item.actualPct ?? 0), 0)
}

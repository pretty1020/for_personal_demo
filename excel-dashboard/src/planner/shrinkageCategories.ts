export type ShrinkageCategoryTemplate = {
  id: string
  name: string
  group: 'out_of_office' | 'in_office'
  billable: boolean
  share: number
}

/** Built-in Out-of-Office categories — always merged into capacity shrinkage templates. */
export const BASE_OUT_OF_OFFICE_SHRINKAGE_CATEGORIES: ShrinkageCategoryTemplate[] = [
  { id: 'absenteeism', name: 'Absenteeism', group: 'out_of_office', billable: false, share: 1 },
  { id: 'vacation_leave', name: 'Vacation Leave', group: 'out_of_office', billable: false, share: 0 },
]

export const BASE_IN_OFFICE_SHRINKAGE_CATEGORIES: ShrinkageCategoryTemplate[] = []

export const SHRINKAGE_CATEGORY_TEMPLATES: ShrinkageCategoryTemplate[] = [
  ...BASE_OUT_OF_OFFICE_SHRINKAGE_CATEGORIES,
  ...BASE_IN_OFFICE_SHRINKAGE_CATEGORIES,
]

/** Default visible category rows for new capacity views (Absenteeism + Vacation Leave). */
export const DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS: string[] = ['absenteeism', 'vacation_leave']

const BASE_SHRINKAGE_CATEGORY_IDS = new Set(SHRINKAGE_CATEGORY_TEMPLATES.map((item) => item.id))

export function isCustomShrinkageCategoryId(categoryId: string): boolean {
  return categoryId.startsWith('custom_')
}

/** Base templates or user custom categories — safe to keep in saved visible lists. */
export function isPersistedVisibleShrinkageCategoryId(categoryId: string): boolean {
  return isCustomShrinkageCategoryId(categoryId) || BASE_SHRINKAGE_CATEGORY_IDS.has(categoryId)
}

/** Ensure Absenteeism + Vacation Leave remain visible as default OOO rows. */
export function withDefaultOooShrinkageCategoryIds(visibleIds: readonly string[] = []): string[] {
  const result = [...DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS]
  for (const id of visibleIds) {
    if (!result.includes(id)) result.push(id)
  }
  return result
}

/**
 * Always include BASE out-of-office + in-office templates first, then custom categories
 * (skip duplicates by id). Ensures Absenteeism / Vacation Leave appear in ShrinkagePlanningPanel.
 */
export function mergeShrinkageCategoryTemplates(
  customCategories: ShrinkageCategoryTemplate[] = [],
): ShrinkageCategoryTemplate[] {
  const merged: ShrinkageCategoryTemplate[] = []
  const seen = new Set<string>()
  for (const category of [
    ...BASE_OUT_OF_OFFICE_SHRINKAGE_CATEGORIES,
    ...BASE_IN_OFFICE_SHRINKAGE_CATEGORIES,
    ...customCategories,
  ]) {
    if (seen.has(category.id)) continue
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

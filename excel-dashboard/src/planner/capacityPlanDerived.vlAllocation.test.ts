import { describe, expect, it } from 'vitest'
import {
  computeVlAllocationHc,
  plannedVacationLeavePctFromCategories,
} from './capacityPlanDerived'
import {
  BASE_OUT_OF_OFFICE_SHRINKAGE_CATEGORIES,
  DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS,
  mergeShrinkageCategoryTemplates,
} from './shrinkageCategories'

describe('computeVlAllocationHc', () => {
  it('computes (VL% × Production HC × 40) / 5 rounded to whole number', () => {
    // 5% × 100 HC × 40 / 5 = 40
    expect(computeVlAllocationHc(0.05, 100)).toBe(40)
  })

  it('clamps percent to 0–1 and rounds', () => {
    expect(computeVlAllocationHc(-0.1, 100)).toBe(0)
    expect(computeVlAllocationHc(1.5, 100)).toBe(800)
    expect(computeVlAllocationHc(0.033, 100)).toBe(26)
  })

  it('treats non-finite percent as 0', () => {
    expect(computeVlAllocationHc(Number.NaN, 100)).toBe(0)
  })
})

describe('plannedVacationLeavePctFromCategories', () => {
  it('reads vacation_leave plannedPct', () => {
    expect(
      plannedVacationLeavePctFromCategories([
        { id: 'absenteeism', plannedPct: 0.08 },
        { id: 'vacation_leave', plannedPct: 0.05 },
      ]),
    ).toBe(0.05)
  })

  it('defaults to 0 when missing', () => {
    expect(plannedVacationLeavePctFromCategories([{ id: 'absenteeism', plannedPct: 0.08 }])).toBe(0)
  })
})

describe('shrinkage category templates', () => {
  it('includes Absenteeism and Vacation Leave in BASE out-of-office', () => {
    expect(BASE_OUT_OF_OFFICE_SHRINKAGE_CATEGORIES.map((item) => item.id)).toEqual([
      'absenteeism',
      'vacation_leave',
    ])
    expect(DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS).toEqual(['absenteeism', 'vacation_leave'])
  })

  it('always merges BASE templates before custom categories', () => {
    const merged = mergeShrinkageCategoryTemplates([
      {
        id: 'custom_out_of_office_pto_abc123',
        name: 'PTO other',
        group: 'out_of_office',
        billable: false,
        share: 0,
      },
      { id: 'absenteeism', name: 'Dup Absenteeism', group: 'out_of_office', billable: false, share: 1 },
    ])
    expect(merged.map((item) => item.id)).toEqual([
      'absenteeism',
      'vacation_leave',
      'custom_out_of_office_pto_abc123',
    ])
    expect(merged[0]?.name).toBe('Absenteeism')
  })
})

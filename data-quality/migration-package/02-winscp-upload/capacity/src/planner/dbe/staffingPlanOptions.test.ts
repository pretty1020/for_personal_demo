import { describe, expect, it } from 'vitest'
import type { PlannerScenario } from '../types'
import {
  findStaffingPlanOption,
  listStaffingClients,
  listStaffingLobs,
  listStaffingLocations,
  listStaffingPlanOptions,
  mergeOptions,
} from './staffingPlanOptions'

function scenario(
  name: string,
  plan: { client: string; lob?: string; location: string; projectCode?: string },
  isBaseline = false,
): PlannerScenario {
  return {
    id: name,
    name,
    description: '',
    plan: { billingType: 'Prod hours', weekStart: 'monday', ...plan },
    assumptions: {} as PlannerScenario['assumptions'],
    isBaseline,
    createdAt: '',
    updatedAt: '',
  }
}

const scenarios: PlannerScenario[] = [
  scenario('Contoso Voice', { client: 'Contoso', lob: 'Voice · Tier 1', location: 'Manila', projectCode: 'PRJ-1' }),
  scenario('Contoso Chat', { client: 'Contoso', lob: 'Chat', location: 'Cebu', projectCode: 'PRJ-2' }),
  scenario('Fabrikam Voice', { client: 'Fabrikam', lob: 'Voice', location: 'Taguig' }),
  scenario('Baseline', { client: 'Ignored', lob: 'Ignored', location: 'Ignored' }, true),
]

describe('Staffing Plan choices for the DBE form', () => {
  it('lists plan clients and excludes baselines', () => {
    const options = listStaffingPlanOptions(scenarios)

    expect(listStaffingClients(options)).toEqual(['Contoso', 'Fabrikam'])
    expect(options.some((option) => option.client === 'Ignored')).toBe(false)
  })

  it('narrows LOB choices to the selected client', () => {
    const options = listStaffingPlanOptions(scenarios)

    expect(listStaffingLobs(options, 'Contoso')).toEqual(['Chat', 'Voice · Tier 1'])
    expect(listStaffingLocations(options, 'Contoso')).toEqual(['Cebu', 'Manila'])
  })

  it('matches the client case-insensitively', () => {
    const options = listStaffingPlanOptions(scenarios)

    expect(listStaffingLobs(options, '  contoso ')).toEqual(['Chat', 'Voice · Tier 1'])
  })

  it('falls back to every LOB when the client is blank or has no plan', () => {
    const options = listStaffingPlanOptions(scenarios)
    const all = ['Chat', 'Voice', 'Voice · Tier 1']

    expect(listStaffingLobs(options, '')).toEqual(all)
    // A client being typed for the first time should still see suggestions.
    expect(listStaffingLobs(options, 'Northwind')).toEqual(all)
  })

  it('treats a legacy plan that stored the LOB in location as a LOB', () => {
    const legacy = [scenario('Legacy', { client: 'Northwind', location: 'Back Office' })]
    const options = listStaffingPlanOptions(legacy)

    expect(options[0]!.lob).toBe('Back Office')
    // The site is not known in that case, so it must not be offered as a location.
    expect(options[0]!.location).toBe('')
    expect(listStaffingLocations(options, 'Northwind')).toEqual([])
  })

  it('resolves Client + LOB to a single plan for auto-fill', () => {
    const options = listStaffingPlanOptions(scenarios)
    const match = findStaffingPlanOption(options, 'Contoso', 'Chat')

    expect(match?.location).toBe('Cebu')
    expect(match?.projectCode).toBe('PRJ-2')
    expect(match?.scenarioName).toBe('Contoso Chat')
  })

  it('returns no match when the pair is ambiguous or unknown', () => {
    const duplicated = [
      scenario('A', { client: 'Contoso', lob: 'Voice', location: 'Manila' }),
      scenario('B', { client: 'Contoso', lob: 'Voice', location: 'Cebu' }),
    ]

    // Two plans share Client + LOB, so auto-fill must not guess a location.
    expect(findStaffingPlanOption(listStaffingPlanOptions(duplicated), 'Contoso', 'Voice')).toBeNull()
    expect(findStaffingPlanOption(listStaffingPlanOptions(scenarios), 'Contoso', 'Nope')).toBeNull()
    expect(findStaffingPlanOption(listStaffingPlanOptions(scenarios), '', 'Chat')).toBeNull()
  })

  it('keeps DBE-only values that have no Staffing Plan, without duplicating', () => {
    expect(mergeOptions(['Contoso', 'Fabrikam'], ['contoso', 'Northwind'])).toEqual([
      'Contoso',
      'Fabrikam',
      'Northwind',
    ])
  })
})

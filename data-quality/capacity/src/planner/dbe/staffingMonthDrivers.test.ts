import { describe, expect, it } from 'vitest'
import type { DerivedCapacityRow } from '../capacityPlanDerived'
import type { PlannerScenario } from '../types'
import type { WeeklyLedgerRow } from '../weeklyLedger'
import type { DbeLobLine } from './dbePersistence'
import {
  findMatchingStaffingScenario,
  resolveStaffingMonthDrivers,
  type StaffingDriverLookup,
} from './staffingMonthDrivers'

const scenario = {
  id: 'sc-1',
  name: 'Acme Voice',
  isBaseline: false,
  plan: {
    client: 'Acme',
    location: 'Manila',
    lob: 'Voice',
    projectCode: 'PC-1',
  },
} as unknown as PlannerScenario

const line = {
  id: 'dbe-1',
  clientName: 'Acme',
  location: 'Manila',
  lobProjectName: 'Voice',
  projectCode: 'PC-1',
} as unknown as DbeLobLine

/** The raw ledger carries the simulation's scheduledFte under planned.productionHc. */
function ledgerWeek(week: string, productionHc: number): WeeklyLedgerRow {
  return { week, planned: { productionHc }, actual: null, shrinkage: [] } as unknown as WeeklyLedgerRow
}

/** A derived row carries the Production HC the Staffing Plan screen actually shows. */
function derivedWeek(week: string, productionHc: number): DerivedCapacityRow {
  return {
    week,
    timeline: 'forward_plan',
    statusLabel: 'Planned',
    planned: { productionHc },
    actual: { productionHc: null },
  } as unknown as DerivedCapacityRow
}

function lookup(parts: Partial<StaffingDriverLookup> = {}): StaffingDriverLookup {
  return {
    scenarios: [scenario],
    getLedger: () => [ledgerWeek('2026-04-06', 80), ledgerWeek('2026-04-13', 80)],
    getOverrides: () => ({}),
    ...parts,
  }
}

describe('Planned Production HC for the DBE comparison', () => {
  it('reads the derived plan rows, not the raw ledger', () => {
    // The ledger still holds the simulation's 80. The plan the user sees, after the
    // roster start headcount and the roll-forward of graduates and attrition, is 95.
    const drivers = resolveStaffingMonthDrivers(line, '2026-04', lookup({
      getDerivedRows: () => [derivedWeek('2026-04-06', 95), derivedWeek('2026-04-13', 95)],
    }))

    expect(drivers.productionHc).toBe(95)
  })

  it('uses the last week of the month (Summary monthly rule), not a week average', () => {
    const drivers = resolveStaffingMonthDrivers(line, '2026-04', lookup({
      getDerivedRows: () => [derivedWeek('2026-04-06', 90), derivedWeek('2026-04-13', 100)],
    }))

    expect(drivers.productionHc).toBe(100)
  })

  it('ignores weeks outside the month', () => {
    const drivers = resolveStaffingMonthDrivers(line, '2026-04', lookup({
      getDerivedRows: () => [derivedWeek('2026-04-06', 90), derivedWeek('2026-05-04', 200)],
    }))

    expect(drivers.productionHc).toBe(90)
  })

  it('falls back to the ledger when no derived rows are supplied', () => {
    const drivers = resolveStaffingMonthDrivers(line, '2026-04', lookup())

    expect(drivers.productionHc).toBe(80)
  })

  it('reports null when the month has no planned headcount at all', () => {
    const drivers = resolveStaffingMonthDrivers(line, '2026-09', lookup({
      getDerivedRows: () => [derivedWeek('2026-04-06', 95)],
    }))

    expect(drivers.productionHc).toBeNull()
  })

  it('reports null when no Staffing Plan matches the DBE line', () => {
    const drivers = resolveStaffingMonthDrivers(line, '2026-04', lookup({ scenarios: [] }))

    expect(drivers.productionHc).toBeNull()
    expect(drivers.matchedScenarioId).toBeNull()
  })
})

describe('findMatchingStaffingScenario — project code', () => {
  function plan(
    id: string,
    parts: { client: string; lob: string; location: string; projectCode?: string },
  ): PlannerScenario {
    return {
      id,
      name: id,
      isBaseline: false,
      plan: {
        client: parts.client,
        lob: parts.lob,
        location: parts.location,
        projectCode: parts.projectCode ?? '',
        billingType: 'Prod hours',
        weekStart: 'monday',
      },
    } as unknown as PlannerScenario
  }

  function dbe(parts: {
    clientName: string
    lobProjectName: string
    location: string
    projectCode?: string
  }): DbeLobLine {
    return {
      id: 'dbe',
      clientName: parts.clientName,
      lobProjectName: parts.lobProjectName,
      location: parts.location,
      projectCode: parts.projectCode ?? '',
    } as unknown as DbeLobLine
  }

  it('requires project code match when the DBE line has one', () => {
    const scenarios = [
      plan('voice-a', { client: 'Acme', lob: 'Voice', location: 'Manila', projectCode: 'PC-1' }),
      plan('voice-b', { client: 'Acme', lob: 'Voice', location: 'Manila', projectCode: 'PC-2' }),
    ]
    const matched = findMatchingStaffingScenario(
      dbe({ clientName: 'Acme', lobProjectName: 'Voice', location: 'Manila', projectCode: 'PC-2' }),
      scenarios,
    )
    expect(matched?.id).toBe('voice-b')
  })

  it('does not fall back to another project under the same client/LOB', () => {
    const scenarios = [
      plan('voice-a', { client: 'Acme', lob: 'Voice', location: 'Manila', projectCode: 'PC-1' }),
    ]
    const matched = findMatchingStaffingScenario(
      dbe({ clientName: 'Acme', lobProjectName: 'Voice', location: 'Manila', projectCode: 'PC-9' }),
      scenarios,
    )
    expect(matched).toBeNull()
  })
})

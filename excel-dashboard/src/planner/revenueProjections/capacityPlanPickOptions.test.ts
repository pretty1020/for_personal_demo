import { describe, expect, it } from 'vitest'
import type { PlannerPlanMetadata, PlannerScenario } from '../types'
import {
  driverSnapshotFromScenario,
  filterCapacityPlanPicks,
  findCapacityPlanPickForLine,
  listCapacityPlanPickOptions,
  uniquePickChannels,
  uniquePickClients,
  uniquePickLobs,
  uniquePickLocations,
} from './capacityPlanPickOptions'

function scenario(
  partial: Omit<Partial<PlannerScenario>, 'plan'> & {
    id: string
    plan?: Partial<PlannerPlanMetadata>
  },
): PlannerScenario {
  const plan = {
    client: 'Apex Retail',
    lob: 'ABC Voice',
    location: 'Manila',
    projectCode: '1234',
    billingType: 'Production Hours',
    weekStart: 'sunday' as const,
    supportedChannels: ['voice' as const],
    ...(partial.plan ?? {}),
  }
  return {
    name: partial.name ?? partial.id,
    description: '',
    isBaseline: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    assumptions: {
      channels: {
        voice: {
          ahtSeconds: 285,
          paidHoursPerFte: 40,
          occupancyTarget: 0.85,
          shrinkagePct: 0.25,
        },
      },
      tenured: {
        attendanceRate: 0.96,
        occupancyTarget: 0.85,
        shrinkageRate: 0.25,
        ahtSeconds: 285,
        standardScheduledHoursPerWeek: 40,
      },
    },
    ...partial,
    plan,
  } as PlannerScenario
}

describe('listCapacityPlanPickOptions', () => {
  it('lists non-baseline capacity plans with Create a new client plan identity', () => {
    const picks = listCapacityPlanPickOptions([
      scenario({ id: 'voice', plan: {
        client: 'Apex Retail',
        lob: 'ABC Voice',
        location: 'Manila',
        projectCode: '1234',
        billingType: 'Production Hours',
        supportedChannels: ['voice'],
      } }),
      scenario({
        id: 'chat',
        plan: {
          client: 'Apex Retail',
          lob: 'EFG Chat',
          location: 'Manila',
          projectCode: '5678',
          billingType: 'Transactional',
          supportedChannels: ['chat'],
        },
      }),
      scenario({ id: 'baseline', isBaseline: true }),
    ])
    expect(picks.map((pick) => pick.scenarioId)).toEqual(['voice', 'chat'])
    expect(picks[0]).toMatchObject({
      client: 'Apex Retail',
      lob: 'ABC Voice',
      location: 'Manila',
      projectCode: '1234',
      billingType: 'Production Hours',
      channels: ['voice'],
    })
    expect(picks[0]?.label).toContain('Apex Retail')
    expect(picks[0]?.label).toContain('ABC Voice')
  })

  it('filters cascading client / location / LOB / channel', () => {
    const picks = listCapacityPlanPickOptions([
      scenario({ id: 'voice' }),
      scenario({
        id: 'chat',
        plan: {
          client: 'Apex Retail',
          lob: 'EFG Chat',
          location: 'Cebu',
          billingType: 'Transactional',
          supportedChannels: ['chat'],
        },
      }),
    ])
    expect(uniquePickClients(picks)).toEqual(['Apex Retail'])
    expect(uniquePickLocations(picks)).toEqual(['Cebu', 'Manila'])
    expect(uniquePickLobs(filterCapacityPlanPicks(picks, { location: 'Manila' }))).toEqual(['ABC Voice'])
    expect(uniquePickChannels(filterCapacityPlanPicks(picks, { lob: 'EFG Chat' }))).toEqual(['chat'])
  })

  it('matches an existing revenue line to the closest capacity plan', () => {
    const picks = listCapacityPlanPickOptions([
      scenario({ id: 'voice' }),
      scenario({
        id: 'chat',
        plan: {
          client: 'Apex Retail',
          lob: 'EFG Chat',
          location: 'Manila',
          supportedChannels: ['chat'],
        },
      }),
    ])
    expect(
      findCapacityPlanPickForLine(picks, {
        clientName: 'Apex Retail',
        lobProjectName: 'ABC Voice',
        location: 'Manila',
        projectCode: '1234',
        channel: 'voice',
      })?.scenarioId,
    ).toBe('voice')
  })

  it('copies staffing drivers from the selected capacity plan channel', () => {
    const snapshot = driverSnapshotFromScenario(scenario({ id: 'voice' }), 'voice')
    expect(snapshot).toMatchObject({
      aht: '285',
      loginHours: '40',
      occupancyPct: '85',
      shrinkagePct: '25',
      absenteeismPct: '4',
    })
  })
})

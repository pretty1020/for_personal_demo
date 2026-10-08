import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiDocument } from './apiClient'

const apiListAllDocuments = vi.fn<(keys: string[]) => Promise<ApiDocument[]>>()
const isRemoteBackend = vi.fn<() => boolean>(() => true)

vi.mock('./apiClient', () => ({
  apiListAllDocuments: (keys: string[]) => apiListAllDocuments(keys),
  isRemoteBackend: () => isRemoteBackend(),
}))

const { loadCapacityPortfolio, loadDbePortfolio } = await import('./capacityPortfolio')
const { parseScenariosPayload } = await import('../planner/persistence')
const { parseDbeLinesPayload } = await import('../planner/dbe/dbePersistence')
const { createScenario, DEFAULT_ASSUMPTIONS, DEFAULT_PLAN_METADATA } = await import(
  '../planner/defaults'
)

function scenario(client: string, lob: string) {
  return createScenario(`${client} ${lob}`, '', DEFAULT_ASSUMPTIONS, {
    ...DEFAULT_PLAN_METADATA,
    client,
    lob,
    location: 'Manila',
  })
}

function doc(overrides: Partial<ApiDocument>): ApiDocument {
  return {
    key: 'wfp-planner-scenarios-v2',
    payload: [],
    revision: 1,
    ownerUserId: 'user-1',
    ownerName: 'Ana Planner',
    ownerEmail: 'ana@movate.com',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('parseScenariosPayload', () => {
  it('reads an array of scenarios', () => {
    const parsed = parseScenariosPayload([scenario('Acme', 'Support')])
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.plan.client).toBe('Acme')
  })

  it('reads a payload that arrived as a JSON string', () => {
    const raw = JSON.stringify([scenario('Acme', 'Support')])
    expect(parseScenariosPayload(raw)).toHaveLength(1)
  })

  it('rejects anything that is not a list of scenarios', () => {
    for (const value of [null, undefined, 42, 'not json', '{}', {}, true]) {
      expect(parseScenariosPayload(value)).toEqual([])
    }
  })

  it('skips rows with no plan or assumptions instead of throwing', () => {
    const good = scenario('Acme', 'Support')
    const parsed = parseScenariosPayload([{ id: 'x' }, { id: 'y', plan: {} }, good])
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.id).toBe(good.id)
  })

  it('drops the seeded demo plans, matching what the owner sees', () => {
    expect(parseScenariosPayload([scenario('WFM Commons', 'Support')])).toEqual([])
    expect(parseScenariosPayload([scenario('Default Client', 'Support')])).toEqual([])
  })

  /**
   * The guard that matters most: Capacity mirrors localStorage writes into the reader's
   * own database rows, so parsing a colleague's plan must not write anything. The test
   * environment has no localStorage, so any write would throw rather than pass silently.
   */
  it('never writes storage while reading someone else\u2019s plans', () => {
    expect(typeof globalThis.localStorage).toBe('undefined')
    expect(() => parseScenariosPayload([scenario('Acme', 'Support')])).not.toThrow()
  })
})

describe('loadCapacityPortfolio', () => {
  beforeEach(() => {
    apiListAllDocuments.mockReset()
    isRemoteBackend.mockReturnValue(true)
  })

  it('groups every document under its owner', async () => {
    const plans = [scenario('Acme', 'Support'), scenario('Acme', 'Billing')]
    apiListAllDocuments.mockResolvedValue([
      doc({ payload: plans }),
      doc({ key: 'wfp-capacity-plan-overrides-v1', payload: { [plans[0]!.id]: { '2026-01-05': {} } } }),
    ])

    const owners = await loadCapacityPortfolio('manager@movate.com')

    expect(owners).toHaveLength(1)
    expect(owners[0]!.name).toBe('Ana Planner')
    expect(owners[0]!.scenarios).toHaveLength(2)
    expect(owners[0]!.capacityPlanOverrides[plans[0]!.id]).toBeDefined()
  })

  it('leaves out the reader, whose live copy the page already holds', async () => {
    apiListAllDocuments.mockResolvedValue([
      doc({ ownerUserId: 'me', ownerEmail: 'Manager@Movate.com', payload: [scenario('Mine', 'A')] }),
      doc({ ownerUserId: 'other', ownerEmail: 'ana@movate.com', payload: [scenario('Theirs', 'B')] }),
    ])

    const owners = await loadCapacityPortfolio('manager@movate.com')

    expect(owners.map((owner) => owner.userId)).toEqual(['other'])
  })

  it('skips accounts that have signed in but saved no plans', async () => {
    apiListAllDocuments.mockResolvedValue([
      doc({ ownerUserId: 'empty', ownerEmail: 'empty@movate.com', payload: [] }),
      doc({
        ownerUserId: 'busy',
        ownerEmail: 'busy@movate.com',
        ownerName: 'Busy',
        payload: [scenario('Acme', 'Support')],
      }),
    ])

    const owners = await loadCapacityPortfolio('manager@movate.com')

    expect(owners.map((owner) => owner.userId)).toEqual(['busy'])
  })

  it('falls back to the email when an account has no display name', async () => {
    apiListAllDocuments.mockResolvedValue([
      doc({ ownerName: '', ownerEmail: 'ana@movate.com', payload: [scenario('Acme', 'Support')] }),
    ])

    const owners = await loadCapacityPortfolio('manager@movate.com')

    expect(owners[0]!.name).toBe('ana@movate.com')
  })

  it('tolerates an overrides blob that is not an object', async () => {
    apiListAllDocuments.mockResolvedValue([
      doc({ payload: [scenario('Acme', 'Support')] }),
      doc({ key: 'wfp-capacity-plan-overrides-v1', payload: 'corrupted' }),
      doc({ key: 'wfp-ledger-actual-overrides-v1', payload: [1, 2, 3] }),
    ])

    const owners = await loadCapacityPortfolio('manager@movate.com')

    expect(owners[0]!.capacityPlanOverrides).toEqual({})
    expect(owners[0]!.ledgerOverrides).toEqual({})
  })

  it('asks for nothing when the app is running without a backend', async () => {
    isRemoteBackend.mockReturnValue(false)

    await expect(loadCapacityPortfolio('manager@movate.com')).resolves.toEqual([])
    expect(apiListAllDocuments).not.toHaveBeenCalled()
  })

  it('requests only the keys the summary aggregates', async () => {
    apiListAllDocuments.mockResolvedValue([])

    await loadCapacityPortfolio('manager@movate.com')

    const requested = apiListAllDocuments.mock.calls[0]![0]
    expect(requested).toContain('wfp-planner-scenarios-v2')
    expect(requested).toContain('wfp-capacity-plan-overrides-v1')
    expect(requested).toContain('wfp-ledger-actual-overrides-v1')
    expect(requested).not.toContain('wfp-roster-store-v1')
  })
})

function dbeLine(clientName: string, lobProjectName: string, id = `dbe-${clientName}-${lobProjectName}`) {
  return {
    id,
    clientName,
    lobProjectName,
    location: 'Manila',
    projectCode: '',
    billingType: 'FTE',
    agentGroup: '',
    billRateMethod: 'monthlyFteRate',
    defaults: {},
    useStaffingAbsenteeismShrinkage: false,
    months: {},
    revenueAdjustments: [],
    costItems: [],
    rowRemarks: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('parseDbeLinesPayload', () => {
  it('reads lines from an array and from a JSON string', () => {
    const lines = [dbeLine('Acme', 'Support')]
    expect(parseDbeLinesPayload(lines)).toHaveLength(1)
    expect(parseDbeLinesPayload(JSON.stringify(lines))).toHaveLength(1)
  })

  it('rejects anything that is not a list of lines', () => {
    for (const value of [null, undefined, 42, 'not json', '{}', {}, true]) {
      expect(parseDbeLinesPayload(value)).toEqual([])
    }
  })

  it('skips empty entries rather than throwing on them', () => {
    const parsed = parseDbeLinesPayload([null, dbeLine('Acme', 'Support'), 'nonsense'])
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.clientName).toBe('Acme')
  })

  /** Same guard as the scenario reader: a colleague's lines must not touch storage. */
  it('never writes storage while reading someone else\u2019s DBE lines', () => {
    expect(typeof globalThis.localStorage).toBe('undefined')
    expect(() => parseDbeLinesPayload([dbeLine('Acme', 'Support')])).not.toThrow()
  })
})

describe('loadDbePortfolio', () => {
  beforeEach(() => {
    apiListAllDocuments.mockReset()
    isRemoteBackend.mockReturnValue(true)
  })

  const dbeDoc = (overrides: Partial<ApiDocument>) =>
    doc({ key: 'wfp-dbe-lines-v3', ...overrides })

  it('asks only for the DBE key, not the whole summary set', async () => {
    apiListAllDocuments.mockResolvedValue([])

    await loadDbePortfolio('manager@movate.com')

    expect(apiListAllDocuments.mock.calls[0]![0]).toEqual(['wfp-dbe-lines-v3'])
  })

  it('returns every other planner\u2019s clients, sorted by owner name', async () => {
    apiListAllDocuments.mockResolvedValue([
      dbeDoc({ ownerUserId: 'z', ownerName: 'Zoe', ownerEmail: 'zoe@movate.com', payload: [dbeLine('Zeta', 'Chat')] }),
      dbeDoc({ ownerUserId: 'a', ownerName: 'Ana', ownerEmail: 'ana@movate.com', payload: [dbeLine('Acme', 'Support')] }),
    ])

    const owners = await loadDbePortfolio('manager@movate.com')

    expect(owners.map((owner) => owner.name)).toEqual(['Ana', 'Zoe'])
    expect(owners[0]!.lines[0]!.clientName).toBe('Acme')
  })

  it('leaves out the reader, whose own lines the page already holds and keeps editable', async () => {
    apiListAllDocuments.mockResolvedValue([
      dbeDoc({ ownerUserId: 'me', ownerEmail: 'Manager@Movate.com', payload: [dbeLine('Mine', 'A')] }),
      dbeDoc({ ownerUserId: 'other', ownerEmail: 'ana@movate.com', payload: [dbeLine('Theirs', 'B')] }),
    ])

    const owners = await loadDbePortfolio('manager@movate.com')

    expect(owners.map((owner) => owner.userId)).toEqual(['other'])
  })

  it('skips accounts that opened DBE but never added a LOB', async () => {
    apiListAllDocuments.mockResolvedValue([
      dbeDoc({ ownerUserId: 'empty', ownerEmail: 'empty@movate.com', payload: [] }),
      dbeDoc({ ownerUserId: 'busy', ownerEmail: 'busy@movate.com', payload: [dbeLine('Acme', 'Support')] }),
    ])

    const owners = await loadDbePortfolio('manager@movate.com')

    expect(owners.map((owner) => owner.userId)).toEqual(['busy'])
  })

  it('asks for nothing when the app is running without a backend', async () => {
    isRemoteBackend.mockReturnValue(false)

    await expect(loadDbePortfolio('manager@movate.com')).resolves.toEqual([])
    expect(apiListAllDocuments).not.toHaveBeenCalled()
  })
})

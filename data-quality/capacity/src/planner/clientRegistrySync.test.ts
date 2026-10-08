import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A client that does not reach capacity_clients must never look saved.
 *
 * The old code fired the write and sent any failure to console.error, so the client
 * appeared in the list, survived until the next hydrate, and then vanished — with the
 * only evidence in a console nobody had open. These tests pin the replacement: a failed
 * write raises the save badge, keeps the client for a retry, and clears once it lands.
 */

const apiCreateClient = vi.fn()
const apiUpdateClient = vi.fn()
const apiDeleteClient = vi.fn()

vi.mock('../data/apiClient', () => ({
  apiCreateClient: (profile: unknown) => apiCreateClient(profile),
  apiUpdateClient: (id: string, profile: unknown) => apiUpdateClient(id, profile),
  apiDeleteClient: (id: string) => apiDeleteClient(id),
  apiListClients: vi.fn(async () => []),
  apiSeedClients: vi.fn(async () => []),
  isRemoteBackend: () => true,
}))

function installLocalStorage(): void {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
    },
  })
}

async function loadModules() {
  vi.resetModules()
  const documents = await import('../data/capacityDocuments')
  const registry = await import('./clientRegistry')
  return { documents, registry }
}

function makeClient(name: string) {
  return {
    id: `client-${name.toLowerCase()}`,
    name,
    weekStart: 'monday' as const,
    capacityPlanStartWeek: '2026-01-05',
    planningWeeks: 52,
    buildMethod: 'forward' as const,
    defaultPaidHours: 40,
    defaultShrinkagePct: 0.25,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** Lets the promise chain inside upsertClientProfile settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('client writes reaching the database', () => {
  beforeEach(() => {
    installLocalStorage()
    apiCreateClient.mockReset()
    apiUpdateClient.mockReset()
    apiDeleteClient.mockReset()
  })

  it('sends a new client straight to the database', async () => {
    const { registry } = await loadModules()
    apiCreateClient.mockResolvedValue({})

    registry.upsertClientProfile(makeClient('THDS'))
    await settle()

    expect(apiCreateClient).toHaveBeenCalledTimes(1)
    expect(registry.hasUnsyncedClients()).toBe(false)
  })

  it('raises the save badge when the write fails, naming the client', async () => {
    const { documents, registry } = await loadModules()
    apiCreateClient.mockRejectedValue(new Error('503'))
    apiUpdateClient.mockRejectedValue(new Error('503'))

    registry.upsertClientProfile(makeClient('THDS'))
    await settle()

    const status = documents.getSaveStatus()
    expect(status.state).toBe('error')
    expect(status.message).toContain('THDS')
    expect(registry.hasUnsyncedClients()).toBe(true)
  })

  it('falls back to update when a create loses a race with another session', async () => {
    const { documents, registry } = await loadModules()
    apiCreateClient.mockRejectedValue(new Error('duplicate'))
    apiUpdateClient.mockResolvedValue({})

    registry.upsertClientProfile(makeClient('THDS'))
    await settle()

    expect(apiUpdateClient).toHaveBeenCalledTimes(1)
    expect(registry.hasUnsyncedClients()).toBe(false)
    expect(documents.getSaveStatus().state).not.toBe('error')
  })

  it('clears the error once a retry lands', async () => {
    const { documents, registry } = await loadModules()
    apiCreateClient.mockRejectedValue(new Error('503'))
    apiUpdateClient.mockRejectedValue(new Error('503'))

    registry.upsertClientProfile(makeClient('THDS'))
    await settle()
    expect(documents.getSaveStatus().state).toBe('error')

    apiCreateClient.mockResolvedValue({})
    apiUpdateClient.mockResolvedValue({})
    registry.retryClientWrites()
    await settle()

    expect(registry.hasUnsyncedClients()).toBe(false)
    expect(documents.getSaveStatus().state).not.toBe('error')
  })

  it('keeps the client locally so a retry has something to resend', async () => {
    const { registry } = await loadModules()
    apiCreateClient.mockRejectedValue(new Error('503'))
    apiUpdateClient.mockRejectedValue(new Error('503'))

    const list = registry.upsertClientProfile(makeClient('THDS'))
    await settle()

    // Still on screen: losing the typing would be worse than showing it unsaved.
    expect(list.map((client) => client.name)).toContain('THDS')
    expect(registry.hasUnsyncedClients()).toBe(true)
  })
})

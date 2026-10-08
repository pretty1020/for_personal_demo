/**
 * Data access layer — swap `localDataProvider` for an API-backed provider when connecting to a database.
 */
import type { PlannerScenario } from '../planner/types'
import { loadScenarios, saveScenarios, loadActiveScenarioId, saveActiveScenarioId } from '../planner/persistence'

export type DataProviderConfig = {
  apiBaseUrl?: string
  apiKey?: string
}

export interface DataProvider {
  readonly mode: 'local' | 'remote'
  getScenarios(): Promise<PlannerScenario[]>
  saveScenarios(scenarios: PlannerScenario[]): Promise<void>
  getActiveScenarioId(): Promise<string | null>
  setActiveScenarioId(id: string): Promise<void>
}

class LocalDataProvider implements DataProvider {
  readonly mode = 'local' as const

  async getScenarios(): Promise<PlannerScenario[]> {
    return loadScenarios()
  }

  async saveScenarios(scenarios: PlannerScenario[]): Promise<void> {
    saveScenarios(scenarios)
  }

  async getActiveScenarioId(): Promise<string | null> {
    return loadActiveScenarioId()
  }

  async setActiveScenarioId(id: string): Promise<void> {
    saveActiveScenarioId(id)
  }
}

/** Remote stub — implement REST/GraphQL calls against your API when ready. */
class RemoteDataProvider implements DataProvider {
  readonly mode = 'remote' as const

  constructor(private readonly config: DataProviderConfig) {}

  async getScenarios(): Promise<PlannerScenario[]> {
    const base = this.config.apiBaseUrl
    if (!base) throw new Error('apiBaseUrl is required for remote data provider.')
    const res = await fetch(`${base}/scenarios`, {
      headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {},
    })
    if (!res.ok) throw new Error(`Failed to load scenarios (${res.status})`)
    const data = (await res.json()) as { scenarios: PlannerScenario[] }
    return data.scenarios
  }

  async saveScenarios(scenarios: PlannerScenario[]): Promise<void> {
    const base = this.config.apiBaseUrl
    if (!base) throw new Error('apiBaseUrl is required for remote data provider.')
    await fetch(`${base}/scenarios`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({ scenarios }),
    })
  }

  async getActiveScenarioId(): Promise<string | null> {
    const base = this.config.apiBaseUrl
    if (!base) return null
    const res = await fetch(`${base}/scenarios/active`)
    if (!res.ok) return null
    const data = (await res.json()) as { id: string | null }
    return data.id
  }

  async setActiveScenarioId(id: string): Promise<void> {
    const base = this.config.apiBaseUrl
    if (!base) return
    await fetch(`${base}/scenarios/active`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      body: JSON.stringify({ id }),
    })
  }
}

const envApiBase = typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_BASE_URL : undefined

export function createDataProvider(config: DataProviderConfig = {}): DataProvider {
  const apiBaseUrl = config.apiBaseUrl ?? envApiBase
  if (apiBaseUrl) return new RemoteDataProvider({ ...config, apiBaseUrl })
  return new LocalDataProvider()
}

/** Singleton used by contexts — replace via `setDataProvider` in tests or bootstrap. */
let activeProvider: DataProvider = createDataProvider()

export function getDataProvider(): DataProvider {
  return activeProvider
}

export function setDataProvider(provider: DataProvider): void {
  activeProvider = provider
}

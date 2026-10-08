import type { ScenarioPairId } from './idealFinancialTrending'

export type InsightTone = 'neutral' | 'good' | 'warn'

export type InsightCard = {
  id: string
  title: string
  body: string
  tone: InsightTone
}

export type BusinessInsightsScenario = ScenarioPairId | 'overview'

export type StoredBusinessInsights = {
  cards: InsightCard[]
  freeformNotes: string
  updatedAt: string
}

const STORAGE_KEY = 'ideal-financial-business-insights-v1'

function storageKey(scenario: BusinessInsightsScenario): string {
  return `${STORAGE_KEY}:${scenario}`
}

export function loadCustomBusinessInsights(
  scenario: BusinessInsightsScenario,
): StoredBusinessInsights | null {
  try {
    const raw = localStorage.getItem(storageKey(scenario))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredBusinessInsights
    if (!parsed || !Array.isArray(parsed.cards)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveCustomBusinessInsights(
  scenario: BusinessInsightsScenario,
  data: Omit<StoredBusinessInsights, 'updatedAt'>,
): void {
  const payload: StoredBusinessInsights = {
    ...data,
    updatedAt: new Date().toISOString(),
  }
  localStorage.setItem(storageKey(scenario), JSON.stringify(payload))
}

export function clearCustomBusinessInsights(scenario: BusinessInsightsScenario): void {
  localStorage.removeItem(storageKey(scenario))
}

export function insightCardId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

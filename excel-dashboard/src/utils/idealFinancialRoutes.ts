import type { ScenarioPairId } from './idealFinancialTrending'
import { SCENARIO_PAIR_META } from './idealFinancialTrending'

export type IdealScenarioSlug = 'actuals-vs-projections' | 'budget-vs-projections' | 'commit-vs-actuals'

export const IDEAL_SCENARIO_PAGES: {
  slug: IdealScenarioSlug
  pairId: ScenarioPairId
}[] = [
  { slug: 'actuals-vs-projections', pairId: 'projection_vs_actual' },
  { slug: 'budget-vs-projections', pairId: 'budget_vs_projection' },
  { slug: 'commit-vs-actuals', pairId: 'commit_vs_actual' },
]

export function pairIdFromSlug(slug: string | undefined): ScenarioPairId | null {
  if (!slug || slug === 'budget-vs-actuals') return null
  const hit = IDEAL_SCENARIO_PAGES.find((p) => p.slug === slug)
  return hit?.pairId ?? null
}

export function slugFromPairId(pairId: ScenarioPairId): IdealScenarioSlug {
  return IDEAL_SCENARIO_PAGES.find((p) => p.pairId === pairId)!.slug
}

export function scenarioPageTitle(pairId: ScenarioPairId): string {
  return SCENARIO_PAIR_META[pairId].title
}

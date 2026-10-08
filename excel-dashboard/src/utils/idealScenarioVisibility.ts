import type { ScenarioPairId } from './idealFinancialTrending'
import { IDEAL_SCENARIO_PAGES } from './idealFinancialRoutes'

/** Scenario nav/hub entries hidden while viewing a given scenario page. */
const HIDDEN_WHEN_ACTIVE: Record<ScenarioPairId, ScenarioPairId[]> = {
  projection_vs_actual: ['budget_vs_projection', 'commit_vs_actual'],
  commit_vs_actual: ['budget_vs_projection', 'projection_vs_actual'],
  budget_vs_projection: ['projection_vs_actual', 'commit_vs_actual'],
}

export function visibleScenarioPairIds(active: ScenarioPairId | 'overview'): ScenarioPairId[] {
  if (active === 'overview') return IDEAL_SCENARIO_PAGES.map((p) => p.pairId)
  const hidden = new Set(HIDDEN_WHEN_ACTIVE[active])
  return IDEAL_SCENARIO_PAGES.filter((p) => !hidden.has(p.pairId)).map((p) => p.pairId)
}

export function visibleScenarioPages(active: ScenarioPairId | 'overview') {
  const allowed = new Set(visibleScenarioPairIds(active))
  return IDEAL_SCENARIO_PAGES.filter((p) => allowed.has(p.pairId))
}

export function activeScenarioFromPath(pathname: string): ScenarioPairId | 'overview' {
  const rest = pathname.replace(/^\/(?:ideal-)?financial\/?/, '')
  const slug = rest.split('/')[0] ?? ''
  if (!slug || slug === 'leakage' || slug === 'budget-vs-actual' || slug === 'budget-vs-actuals') return 'overview'
  const hit = IDEAL_SCENARIO_PAGES.find((p) => p.slug === slug)
  return hit?.pairId ?? 'overview'
}

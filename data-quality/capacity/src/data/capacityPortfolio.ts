/**
 * Every planner's saved work, read once for the manager-and-above combined Summary.
 *
 * The data here belongs to other people. It is held in React state and handed straight
 * to the aggregation helpers, and it must never be written to localStorage: Capacity
 * mirrors localStorage writes into the *reader's* own capacity_documents rows, so
 * caching a colleague's plan locally would republish it under the reader's name.
 *
 * The server is the real gate. It returns 403 below manager, so a planner who calls
 * this gets an error rather than a portfolio.
 */
import { apiListAllDocuments, apiListStaffingPlan, isRemoteBackend } from './apiClient'
import { SUMMARY_DOCUMENT_KEYS } from './capacityDocumentKeys'
import { parseScenariosPayload } from '../planner/persistence'
import { parseDbeLinesPayload, type DbeLobLine } from '../planner/dbe/dbePersistence'
import { runSimulation } from '../planner/engine'
import { buildWeeklyPlanLedger, type WeeklyLedgerRow } from '../planner/weeklyLedger'
import { buildScenarioForecast, type ScenarioForecastPackage } from '../planner/forecasting'
import type { PlannerScenario } from '../planner/types'
import type {
  ScenarioCapacityPlanOverrideStore,
  WeekCapacityPlanOverride,
} from '../planner/capacityPlanOverridePersistence'
import type { ForecastOverrideStore } from '../planner/forecastPersistence'
import type { LedgerOverrideStore } from '../planner/ledgerPersistence'
import type { ScenarioShrinkageCategoryStore } from '../planner/capacityShrinkageCategoryPersistence'

/** One planner's plans plus the overrides needed to reproduce their own numbers. */
export type PortfolioOwner = {
  userId: string
  /** Display name, falling back to email for accounts that never set one. */
  name: string
  email: string
  scenarios: PlannerScenario[]
  capacityPlanOverrides: ScenarioCapacityPlanOverrideStore
  ledgerOverrides: LedgerOverrideStore
  forecastOverrides: ForecastOverrideStore
  shrinkageCategories: ScenarioShrinkageCategoryStore
}

function parseObject<T extends object>(payload: unknown): T {
  let value = payload
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      return {} as T
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {} as T
  return value as T
}

/**
 * Overlay staffing_plan.required_production_fte / production_fte / shrinkage onto
 * document overrides so Manager+ portfolio views match MariaDB after refresh.
 */
async function mergeStaffingPlanRowsIntoOwners(owners: PortfolioOwner[]): Promise<void> {
  if (!owners.length) return
  try {
    const weeks = await apiListStaffingPlan(null, { scopeAll: true })
    if (!weeks.length) return
    const byOwner = new Map(owners.map((owner) => [owner.userId, owner]))
    for (const row of weeks) {
      const owner = byOwner.get(row.ownerUserId)
      if (!owner) continue
      const byScenario = owner.capacityPlanOverrides[row.scenarioId] ?? {}
      const week = { ...(byScenario[row.weekStart] ?? {}) }
      let touched = false
      if (row.requiredProductionFte != null && Number.isFinite(row.requiredProductionFte)) {
        week.requiredFte = row.requiredProductionFte
        touched = true
      }
      if (row.productionFte != null && Number.isFinite(row.productionFte) && week.productionFte == null) {
        week.productionFte = row.productionFte
        touched = true
      }
      if ((row.shrinkage ?? []).length) {
        const shrinkageById = { ...(week.shrinkageById ?? {}) }
        for (const item of row.shrinkage ?? []) {
          if (item.plannedPct != null && Number.isFinite(item.plannedPct)) {
            shrinkageById[item.categoryId] = item.plannedPct
            touched = true
          }
        }
        if (Object.keys(shrinkageById).length) week.shrinkageById = shrinkageById
      }
      if (!touched) continue
      byScenario[row.weekStart] = week
      owner.capacityPlanOverrides = {
        ...owner.capacityPlanOverrides,
        [row.scenarioId]: byScenario,
      }
    }
  } catch (error) {
    // Documents still drive the portfolio; FTE merge is best-effort.
    console.warn('Could not merge staffing_plan into portfolio:', error)
  }
}

/**
 * Other planners' portfolios, newest owner data included, sorted by name.
 *
 * `excludeEmail` drops the reader's own rows: the caller already holds their live,
 * possibly-unsaved copy in PlannerContext, and counting both would double every team
 * the reader owns.
 */
export async function loadCapacityPortfolio(excludeEmail: string): Promise<PortfolioOwner[]> {
  if (!isRemoteBackend()) return []

  const documents = await apiListAllDocuments([...SUMMARY_DOCUMENT_KEYS])
  const skip = excludeEmail.trim().toLowerCase()

  const grouped = new Map<string, Map<string, unknown>>()
  const identity = new Map<string, { name: string; email: string }>()

  for (const document of documents) {
    const email = (document.ownerEmail ?? '').trim().toLowerCase()
    if (!document.ownerUserId || (skip && email === skip)) continue

    const payloads = grouped.get(document.ownerUserId) ?? new Map<string, unknown>()
    payloads.set(document.key, document.payload)
    grouped.set(document.ownerUserId, payloads)

    if (!identity.has(document.ownerUserId)) {
      identity.set(document.ownerUserId, {
        name: (document.ownerName ?? '').trim() || email || 'Unknown planner',
        email,
      })
    }
  }

  const owners: PortfolioOwner[] = []
  for (const [userId, payloads] of grouped) {
    const scenarios = parseScenariosPayload(payloads.get('wfp-planner-scenarios-v2'))
    // An account with no plans contributes nothing and would only pad the owner list.
    if (!scenarios.length) continue

    const who = identity.get(userId)!
    owners.push({
      userId,
      name: who.name,
      email: who.email,
      scenarios,
      capacityPlanOverrides: parseObject(payloads.get('wfp-capacity-plan-overrides-v1')),
      ledgerOverrides: parseObject(payloads.get('wfp-ledger-actual-overrides-v1')),
      forecastOverrides: parseObject(payloads.get('wfp-forecast-overrides-v1')),
      shrinkageCategories: parseObject(payloads.get('wfp-capacity-shrinkage-categories-v1')),
    })
  }

  await mergeStaffingPlanRowsIntoOwners(owners)

  owners.sort((a, b) => a.name.localeCompare(b.name))
  return owners
}

/** One planner's DBE lines, tagged with who owns them. */
export type DbePortfolioOwner = {
  userId: string
  name: string
  email: string
  lines: DbeLobLine[]
}

/**
 * Every other planner's DBE lines, so Manager and above see the whole book of clients
 * rather than only the ones they entered themselves.
 *
 * Separate from loadCapacityPortfolio because DBE needs just the one key and none of
 * the scenario derivation, and the DBE page opens far more often than Summary.
 *
 * `excludeEmail` drops the reader's own row, which the page already holds locally and
 * keeps editable; including it here would show every client twice.
 */
export async function loadDbePortfolio(excludeEmail: string): Promise<DbePortfolioOwner[]> {
  if (!isRemoteBackend()) return []

  const documents = await apiListAllDocuments(['wfp-dbe-lines-v3'])
  const skip = excludeEmail.trim().toLowerCase()

  const owners: DbePortfolioOwner[] = []
  for (const document of documents) {
    const email = (document.ownerEmail ?? '').trim().toLowerCase()
    if (!document.ownerUserId || (skip && email === skip)) continue

    const lines = parseDbeLinesPayload(document.payload)
    // An account that has opened DBE but never added a LOB contributes nothing.
    if (!lines.length) continue

    owners.push({
      userId: document.ownerUserId,
      name: (document.ownerName ?? '').trim() || email || 'Unknown planner',
      email,
      lines,
    })
  }

  owners.sort((a, b) => a.name.localeCompare(b.name))
  return owners
}

/**
 * The same derivation PlannerContext runs for the signed-in user, applied to a scenario
 * owned by someone else. Kept here rather than in the context because the context
 * resolves scenarios by id against the local list, which a foreign scenario is not in.
 */
export function derivePortfolioLedger(
  owner: PortfolioOwner,
  scenario: PlannerScenario,
): WeeklyLedgerRow[] {
  const result = runSimulation(scenario, 'weekly', 52)
  return buildWeeklyPlanLedger(
    scenario,
    result,
    owner.ledgerOverrides[scenario.id] ?? [],
    owner.shrinkageCategories[scenario.id] ?? [],
  )
}

export function derivePortfolioForecast(
  owner: PortfolioOwner,
  scenario: PlannerScenario,
  ledger: WeeklyLedgerRow[],
  horizonWeeks: number,
): ScenarioForecastPackage | null {
  if (!ledger.length) return null
  return buildScenarioForecast(ledger, owner.forecastOverrides[scenario.id], horizonWeeks)
}

export function portfolioPlanOverrides(
  owner: PortfolioOwner,
  scenario: PlannerScenario,
): Record<string, WeekCapacityPlanOverride> {
  return owner.capacityPlanOverrides[scenario.id] ?? {}
}

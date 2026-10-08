import type { DerivedCapacityRow } from '../capacityPlanDerived'
import type { WeekCapacityPlanOverride } from '../capacityPlanOverridePersistence'
import { resolvePlanLob, resolvePlanLocation, resolvePlanProjectCode } from '../planIdentity'
import type { ShrinkageCategoryTemplate } from '../shrinkageCategories'
import { mergeShrinkageCategoryTemplates } from '../shrinkageCategories'
import type { PlannerScenario } from '../types'
import type { WeeklyLedgerRow } from '../weeklyLedger'
import { dbeLineMapKey, scenarioMapKey } from './staffingDbeLeakage'
import type { DbeLobLine } from './dbePersistence'

function weekMonthKey(weekIso: string): string {
  return weekIso.length >= 7 ? weekIso.slice(0, 7) : weekIso
}

function avg(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function normToken(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase().replace(/[_\s-]+/g, '')
}

function isAbsenteeismCategory(id: string, name?: string | null): boolean {
  const hay = `${id} ${name ?? ''}`.trim().toLowerCase()
  return hay.includes('absenteeism')
}

function isBreakCategory(id: string, name?: string | null): boolean {
  const hay = `${id} ${name ?? ''}`.trim().toLowerCase()
  return /\bbreak\b/.test(hay) || hay.includes('break%') || hay.includes('break_')
}

export type StaffingMonthDrivers = {
  /** 0–100 scale for DBE */
  absenteeismPct: number
  /** 0–100 scale for DBE — Planned in-office shrinkage only (Break excluded) */
  shrinkagePct: number
  /** True when a matching Staffing Plan exists and this month has planned driver data. */
  hasData: boolean
  /**
   * Average weekly Production HC across the month, for comparison against DBE FTE.
   * Null when the matched plan has no Production HC for the month. Tracked apart
   * from hasData because a plan can staff a month without planned shrinkage
   * categories, and the FTE comparison should still show in that case.
   */
  productionHc: number | null
  matchedScenarioId: string | null
  matchedScenarioName: string | null
}

export type StaffingDriverLookup = {
  scenarios: PlannerScenario[]
  getLedger: (scenarioId: string) => WeeklyLedgerRow[]
  getOverrides: (scenarioId: string) => Record<string, WeekCapacityPlanOverride>
  getShrinkageCategories?: (scenarioId: string) => ShrinkageCategoryTemplate[]
  /**
   * The derived capacity rows the Staffing Plan screen itself renders, which is where
   * Planned Production HC actually comes from. The raw ledger only carries the
   * simulation's `scheduledFte`, before week overrides, the roster start headcount and
   * the week-by-week roll-forward of graduates, transfers and attrition are applied — so
   * reading the ledger gives a number the planner never sees on their own screen.
   *
   * Deriving rows is expensive, so the caller supplies this and memoises per scenario.
   * When it is absent the ledger is used, which keeps older callers working.
   */
  getDerivedRows?: (scenarioId: string) => DerivedCapacityRow[]
}

type CategoryWeekValue = {
  id: string
  name: string
  group: 'out_of_office' | 'in_office'
  planned: number
}

function planProjectToken(scenario: PlannerScenario): string {
  return normToken(resolvePlanProjectCode(scenario.plan) || scenario.plan.projectCode)
}

/**
 * Match a DBE LOB line to a Staffing Plan for Absenteeism / Shrinkage / FTE comparison.
 *
 * Project Code is a hard filter when the DBE line has one — Financial Summary must not
 * pull drivers from a different project under the same Client/LOB.
 */
export function findMatchingStaffingScenario(
  line: DbeLobLine,
  scenarios: PlannerScenario[],
): PlannerScenario | null {
  const active = scenarios.filter((scenario) => !scenario.isBaseline)
  if (!active.length) return null

  const key = dbeLineMapKey(line)
  const exact = active.find((scenario) => scenarioMapKey(scenario) === key)
  if (exact) return exact

  const client = normToken(line.clientName)
  const location = normToken(line.location)
  const lob = normToken(line.lobProjectName)
  const projectCode = normToken(line.projectCode)

  // Hard constraint: when DBE carries a project code, only that project's plan may compare.
  const pool = projectCode
    ? active.filter((scenario) => planProjectToken(scenario) === projectCode)
    : active
  if (!pool.length) return null

  const scored = pool
    .map((scenario) => {
      const planClient = normToken(scenario.plan.client)
      if (planClient !== client) return null

      const planLob = normToken(resolvePlanLob(scenario.plan))
      const planLocation = normToken(resolvePlanLocation(scenario.plan))
      // Legacy plans often stored LOB in `location` with empty `lob`.
      const legacyLocationAsLob = !scenario.plan.lob?.trim()
        ? normToken(scenario.plan.location)
        : ''
      const effectiveLob = planLob || legacyLocationAsLob
      const planProject = planProjectToken(scenario)

      let score = 10 // client already matched
      if (lob && effectiveLob && lob === effectiveLob) score += 40
      if (location && planLocation && location === planLocation) score += 25
      if (location && !planLocation && legacyLocationAsLob && location === legacyLocationAsLob) {
        // DBE site won't match legacy LOB-in-location; don't penalize.
      }
      if (projectCode && planProject && projectCode === planProject) score += 30
      // Empty DBE project code: prefer plans that also have no code so we don't steal a coded plan.
      if (!projectCode && planProject) score -= 15
      if (lob && effectiveLob && lob !== effectiveLob) score -= 30

      return { scenario, score }
    })
    .filter((item): item is { scenario: PlannerScenario; score: number } => item != null)
    .sort((a, b) => b.score - a.score)

  if (scored[0] && scored[0].score >= 40) return scored[0].scenario

  // Unique client fallback within the (already project-filtered) pool.
  const sameClient = pool.filter((scenario) => normToken(scenario.plan.client) === client)
  if (sameClient.length === 1) return sameClient[0]!

  return null
}

function resolveWeeklyCategoryPlans(
  ledger: WeeklyLedgerRow[],
  overrides: Record<string, WeekCapacityPlanOverride>,
  categoryTemplates: ShrinkageCategoryTemplate[],
): Map<string, CategoryWeekValue[]> {
  const templates = mergeShrinkageCategoryTemplates(categoryTemplates)
  const templateById = new Map(templates.map((item) => [item.id, item]))
  const byWeek = new Map<string, CategoryWeekValue[]>()
  let previous: Record<string, number> = {}

  const weekSet = new Set<string>([
    ...ledger.map((row) => row.week),
    ...Object.keys(overrides),
  ])
  const weeks = [...weekSet].sort((a, b) => a.localeCompare(b))
  const ledgerByWeek = new Map(ledger.map((row) => [row.week, row]))

  for (const week of weeks) {
    const row = ledgerByWeek.get(week)
    const weekOverride = overrides[week]?.shrinkageById ?? {}
    const categoryIds = [
      ...new Set([
        ...(row?.shrinkage.map((item) => item.id) ?? []),
        ...Object.keys(weekOverride),
        ...templates.map((item) => item.id),
      ]),
    ].filter((id) => {
      // Keep categories that exist on the week row, were overridden, or are known templates
      // that already appear in overrides somewhere / on this week.
      return (
        Boolean(row?.shrinkage.some((item) => item.id === id)) ||
        weekOverride[id] != null ||
        Object.values(overrides).some((entry) => entry.shrinkageById?.[id] != null)
      )
    })

    const isForward = row?.timeline !== 'historical_actual'
    const resolved: CategoryWeekValue[] = categoryIds.map((id) => {
      const meta = row?.shrinkage.find((item) => item.id === id)
      const template = templateById.get(id)
      const name = meta?.name ?? template?.name ?? id
      const group = meta?.group ?? template?.group ?? 'out_of_office'
      const explicit = weekOverride[id]
      const planned =
        explicit != null && Number.isFinite(explicit)
          ? Math.max(0, explicit)
          : isForward && previous[id] != null
            ? previous[id]!
            : 0
      return { id, name, group, planned }
    })

    byWeek.set(week, resolved)
    if (isForward || !row) {
      previous = Object.fromEntries(resolved.map((item) => [item.id, item.planned]))
    }
  }

  return byWeek
}

/**
 * Planned Production HC for the month — same rule as Summary / monthly Staffing matrix:
 * use the **last week** in the month (not a week average), from derived plan rows when available.
 */
function resolveMonthProductionHc(
  scenarioId: string,
  monthKey: string,
  lookup: StaffingDriverLookup,
): number | null {
  const derived = lookup.getDerivedRows?.(scenarioId) ?? []

  if (derived.length) {
    const monthRows = derived
      .filter((row) => weekMonthKey(row.week) === monthKey)
      .sort((a, b) => a.week.localeCompare(b.week))
    if (!monthRows.length) return null
    const last = monthRows[monthRows.length - 1]!
    const raw = last.planned.productionHc ?? last.actual.productionHc
    return raw != null && Number.isFinite(raw) ? Math.max(0, Math.round(raw)) : null
  }

  const ledgerRows = lookup
    .getLedger(scenarioId)
    .filter((row) => weekMonthKey(row.week) === monthKey)
    .sort((a, b) => a.week.localeCompare(b.week))
  if (!ledgerRows.length) return null
  const last = ledgerRows[ledgerRows.length - 1]!
  const value = last.planned.productionHc
  return value != null && Number.isFinite(value) ? Math.max(0, Math.round(value)) : null
}

function scenarioHasAnyPlannedDrivers(
  overrides: Record<string, WeekCapacityPlanOverride>,
  weeklyPlans: Map<string, CategoryWeekValue[]>,
): boolean {
  if (Object.values(overrides).some((week) => Object.keys(week.shrinkageById ?? {}).length > 0)) {
    return true
  }
  for (const categories of weeklyPlans.values()) {
    if (
      categories.some(
        (item) =>
          item.planned > 0 &&
          (isAbsenteeismCategory(item.id, item.name) ||
            (item.group === 'in_office' && !isBreakCategory(item.id, item.name))),
      )
    ) {
      return true
    }
  }
  return false
}

/**
 * Resolve monthly Planned Absenteeism % and Planned in-office Shrinkage % from Staffing Plan.
 * Shrinkage excludes Break categories.
 */
export function resolveStaffingMonthDrivers(
  line: DbeLobLine,
  monthKey: string,
  lookup: StaffingDriverLookup,
): StaffingMonthDrivers {
  const empty: StaffingMonthDrivers = {
    absenteeismPct: 0,
    shrinkagePct: 0,
    hasData: false,
    productionHc: null,
    matchedScenarioId: null,
    matchedScenarioName: null,
  }

  const scenario = findMatchingStaffingScenario(line, lookup.scenarios)
  if (!scenario) return empty

  const overrides = lookup.getOverrides(scenario.id)
  const ledger = lookup.getLedger(scenario.id)
  const categoryTemplates = lookup.getShrinkageCategories?.(scenario.id) ?? []
  const weeklyPlans = resolveWeeklyCategoryPlans(ledger, overrides, categoryTemplates)
  const hasAnyDrivers = scenarioHasAnyPlannedDrivers(overrides, weeklyPlans)
  const productionHc = resolveMonthProductionHc(scenario.id, monthKey, lookup)

  const monthWeeks = [
    ...new Set([
      ...ledger.filter((row) => weekMonthKey(row.week) === monthKey).map((row) => row.week),
      ...Object.keys(overrides).filter((week) => weekMonthKey(week) === monthKey),
      ...[...weeklyPlans.keys()].filter((week) => weekMonthKey(week) === monthKey),
    ]),
  ].sort((a, b) => a.localeCompare(b))

  if (!monthWeeks.length) {
    return {
      absenteeismPct: 0,
      shrinkagePct: 0,
      hasData: false,
      productionHc,
      matchedScenarioId: scenario.id,
      matchedScenarioName: scenario.name || scenario.plan.client,
    }
  }

  const absenteeism01: number[] = []
  const shrinkage01: number[] = []
  let monthHasData = false

  for (const week of monthWeeks) {
    const categories = weeklyPlans.get(week) ?? []
    const weekOverride = overrides[week]?.shrinkageById
    if (weekOverride && Object.keys(weekOverride).length > 0) monthHasData = true
    if (categories.some((item) => item.planned > 0)) monthHasData = true

    const abs01 = categories
      .filter((item) => isAbsenteeismCategory(item.id, item.name))
      .reduce((sum, item) => sum + item.planned, 0)

    // DBE Shrinkage = Planned in-office only, excluding Break.
    const inOffice01 = categories
      .filter(
        (item) =>
          item.group === 'in_office' &&
          !isBreakCategory(item.id, item.name) &&
          !isAbsenteeismCategory(item.id, item.name),
      )
      .reduce((sum, item) => sum + item.planned, 0)

    absenteeism01.push(abs01)
    shrinkage01.push(inOffice01)
  }

  return {
    absenteeismPct: Math.round(avg(absenteeism01) * 10000) / 100,
    shrinkagePct: Math.round(avg(shrinkage01) * 10000) / 100,
    hasData: hasAnyDrivers && monthHasData,
    productionHc,
    matchedScenarioId: scenario.id,
    matchedScenarioName: scenario.name || scenario.plan.client,
  }
}

export function findStaffingScenarioForDbeLine(
  line: DbeLobLine,
  lookup: StaffingDriverLookup,
): PlannerScenario | null {
  return findMatchingStaffingScenario(line, lookup.scenarios)
}

export function staffingScenarioHasDriverData(
  line: DbeLobLine,
  lookup: StaffingDriverLookup,
): boolean {
  const scenario = findMatchingStaffingScenario(line, lookup.scenarios)
  if (!scenario) return false
  const overrides = lookup.getOverrides(scenario.id)
  const ledger = lookup.getLedger(scenario.id)
  const categoryTemplates = lookup.getShrinkageCategories?.(scenario.id) ?? []
  const weeklyPlans = resolveWeeklyCategoryPlans(ledger, overrides, categoryTemplates)
  return scenarioHasAnyPlannedDrivers(overrides, weeklyPlans)
}

export function lineHasAnyStaffingDriverData(
  line: DbeLobLine,
  months: string[],
  lookup: StaffingDriverLookup,
): boolean {
  if (!staffingScenarioHasDriverData(line, lookup)) return false
  return months.some((month) => resolveStaffingMonthDrivers(line, month, lookup).hasData)
}

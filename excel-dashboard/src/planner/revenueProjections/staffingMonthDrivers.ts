import type { WeekCapacityPlanOverride } from '../capacityPlanOverridePersistence'
import type { ShrinkageCategoryTemplate } from '../shrinkageCategories'
import { mergeShrinkageCategoryTemplates } from '../shrinkageCategories'
import type { ChannelType, PlannerPlanMetadata, PlannerScenario } from '../types'
import { CHANNEL_TYPES } from '../types'
import { explicitPlanChannels } from '../planIdentity'
import type { WeeklyLedgerRow } from '../weeklyLedger'
import type { RevenueProjectionLobLine } from './revenueProjectionPersistence'
import { dominantMonthKeyFromWeekStart } from '../../utils/staffingCapacity/calendarWeek'

function weekMonthKey(weekIso: string): string {
  return dominantMonthKeyFromWeekStart(weekIso)
}

function avg(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function normToken(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase().replace(/[_\s-]+/g, '')
}

/** Line of business label. Legacy plans stored LOB in `location`. */
function resolvePlanLob(plan: Pick<PlannerPlanMetadata, 'lob' | 'location'>): string {
  const lob = plan.lob?.trim()
  if (lob) return lob
  return plan.location?.trim() || ''
}

/**
 * Geographic / site location.
 * When `lob` is unset, `location` was historically the LOB name — treat site as empty.
 */
function resolvePlanLocation(plan: Pick<PlannerPlanMetadata, 'lob' | 'location'>): string {
  if (plan.lob?.trim()) return plan.location?.trim() || ''
  return ''
}

function staffingMapKey(client: string, location: string, projectCode: string): string {
  return `${normToken(client)}|${normToken(location)}|${normToken(projectCode)}`
}

function scenarioMapKey(scenario: PlannerScenario): string {
  return staffingMapKey(
    scenario.plan.client,
    resolvePlanLocation(scenario.plan) || scenario.plan.location || '',
    scenario.plan.projectCode || '',
  )
}

function revProjLineMapKey(line: RevenueProjectionLobLine): string {
  return staffingMapKey(line.clientName, line.location, line.projectCode)
}

function isAbsenteeismCategory(id: string, name?: string | null): boolean {
  const hay = `${id} ${name ?? ''}`.trim().toLowerCase()
  return hay.includes('absenteeism')
}

function isInOfficeCategory(item: { group: string; id: string; name: string }): boolean {
  return item.group === 'in_office' && !isAbsenteeismCategory(item.id, item.name)
}

/** Planned shrinkage is stored 0–1; imported / legacy cells may already be 0–100. */
export function plannedValueToRate(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  const rate = value > 1 ? value / 100 : value
  return Math.min(1, rate)
}

export function rateToPctPoints(rate: number): number {
  if (!Number.isFinite(rate) || rate < 0) return 0
  return Math.round(Math.min(1, rate) * 10000) / 100
}

export type StaffingWeekCapacity = {
  week: string
  productionFte: number
  volume: number
}

export type StaffingMonthDrivers = {
  /** 0–100 scale for revenue projections */
  absenteeismPct: number
  /** 0–100 scale — Total planned in-office shrinkage, including Break */
  shrinkagePct: number
  /** Average Production FTE of weeks assigned to this month. */
  fte: number
  /** Sum of weekly capacity / transactions for weeks assigned to this month. */
  capacity: number
  weekCount: number
  /** True when a matching Staffing Plan exists and this month has planned driver data. */
  hasData: boolean
  /** True when included weeks have Production FTE or volume from the Capacity Plan. */
  hasVolumeData: boolean
  matchedScenarioId: string | null
  matchedScenarioName: string | null
}

export type StaffingDriverLookup = {
  scenarios: PlannerScenario[]
  getLedger: (scenarioId: string) => WeeklyLedgerRow[]
  getOverrides: (scenarioId: string) => Record<string, WeekCapacityPlanOverride>
  getShrinkageCategories?: (scenarioId: string) => ShrinkageCategoryTemplate[]
  getCapacityRows?: (scenarioId: string) => StaffingWeekCapacity[]
}

type CategoryWeekValue = {
  id: string
  name: string
  group: 'out_of_office' | 'in_office'
  planned: number
}

export function findMatchingStaffingScenario(
  line: RevenueProjectionLobLine,
  scenarios: PlannerScenario[],
): PlannerScenario | null {
  const active = scenarios.filter((scenario) => !scenario.isBaseline)
  if (!active.length) return null

  const key = revProjLineMapKey(line)
  const exact = active.find((scenario) => scenarioMapKey(scenario) === key)
  if (exact) return exact

  const client = normToken(line.clientName)
  const location = normToken(line.location)
  const lob = normToken(line.lobProjectName)
  const projectCode = normToken(line.projectCode)

  const scored = active
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
      const planProject = normToken(scenario.plan.projectCode)

      let score = 10 // client already matched
      if (lob && effectiveLob && lob === effectiveLob) score += 40
      if (location && planLocation && location === planLocation) score += 25
      // When lob is unset and location holds the LOB name, match projection location to plan.location.
      if (location && !planLocation && legacyLocationAsLob && location === legacyLocationAsLob) {
        score += 20
      }
      if (!line.lobProjectName.trim() && location && effectiveLob && location === effectiveLob) {
        score += 25
      }
      if (projectCode && planProject && projectCode === planProject) score += 30
      if (projectCode && planProject && projectCode !== planProject) score -= 20
      if (lob && effectiveLob && lob !== effectiveLob) score -= 30

      return { scenario, score }
    })
    .filter((item): item is { scenario: PlannerScenario; score: number } => item != null)
    .sort((a, b) => b.score - a.score)

  if (scored[0] && scored[0].score >= 40) return scored[0].scenario

  // Unique client fallback — common when LOB/location naming differs slightly.
  const sameClient = active.filter((scenario) => normToken(scenario.plan.client) === client)
  if (sameClient.length === 1) return sameClient[0]!

  // Client + location (or LOB-in-location) unique match.
  const sameClientLocation = sameClient.filter((scenario) => {
    const planLocation = normToken(resolvePlanLocation(scenario.plan))
    const legacyLob = !scenario.plan.lob?.trim() ? normToken(scenario.plan.location) : ''
    const effectiveLocation = planLocation || legacyLob
    return location && effectiveLocation && location === effectiveLocation
  })
  if (sameClientLocation.length === 1) return sameClientLocation[0]!
  return null
}

export function resolveRevenueProjectionChannel(
  line: RevenueProjectionLobLine,
  scenarios: PlannerScenario[] = [],
): ChannelType | '' {
  if (CHANNEL_TYPES.includes(line.channel as ChannelType)) return line.channel as ChannelType
  const matched = findMatchingStaffingScenario(line, scenarios)
  return explicitPlanChannels(matched?.plan ?? { supportedChannels: [] })[0] ?? ''
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
      const plannedRaw =
        explicit != null && Number.isFinite(explicit)
          ? explicit
          : isForward && previous[id] != null
            ? previous[id]!
            : 0
      const planned = plannedValueToRate(plannedRaw)
      return { id, name, group, planned }
    })

    byWeek.set(week, resolved)
    if (isForward || !row) {
      previous = Object.fromEntries(resolved.map((item) => [item.id, item.planned]))
    }
  }

  return byWeek
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
          (isAbsenteeismCategory(item.id, item.name) || isInOfficeCategory(item)),
      )
    ) {
      return true
    }
  }
  return false
}

function emptyDrivers(partial?: Partial<StaffingMonthDrivers>): StaffingMonthDrivers {
  return {
    absenteeismPct: 0,
    shrinkagePct: 0,
    fte: 0,
    capacity: 0,
    weekCount: 0,
    hasData: false,
    hasVolumeData: false,
    matchedScenarioId: null,
    matchedScenarioName: null,
    ...partial,
  }
}

function roundFte(value: number): number {
  return Math.round(value * 100) / 100
}

function monthCapacityFromWeeks(weeks: StaffingWeekCapacity[]): { fte: number; capacity: number; weekCount: number } {
  if (!weeks.length) return { fte: 0, capacity: 0, weekCount: 0 }
  const fte = roundFte(avg(weeks.map((week) => Math.max(0, week.productionFte))))
  const capacity = Math.round(weeks.reduce((sum, week) => sum + Math.max(0, week.volume), 0))
  return { fte, capacity, weekCount: weeks.length }
}

function capacityWeeksFromLedger(
  ledger: WeeklyLedgerRow[],
  overrides: Record<string, WeekCapacityPlanOverride>,
  monthKey: string,
): StaffingWeekCapacity[] {
  const weeks = [
    ...new Set([
      ...ledger.filter((row) => weekMonthKey(row.week) === monthKey).map((row) => row.week),
      ...Object.keys(overrides).filter((week) => weekMonthKey(week) === monthKey),
    ]),
  ].sort((a, b) => a.localeCompare(b))
  return weeks.map((week) => {
    const override = overrides[week]
    const row = ledger.find((item) => item.week === week)
    const productionFte = override?.productionFte ?? row?.planned.productionFte ?? 0
    const volume = override?.callVolume ?? row?.planned.callVolume ?? 0
    return {
      week,
      productionFte: Number.isFinite(productionFte) ? productionFte : 0,
      volume: Number.isFinite(volume) ? volume : 0,
    }
  })
}

/**
 * Resolve monthly Planned Absenteeism % and Total in-office Shrinkage % from Staffing Plan.
 * In-office shrinkage includes Break and every other in-office category.
 * FTE is the average Production FTE of weeks owned by this month; Capacity / Transactions is the sum of weekly volume.
 */
export function resolveStaffingMonthDrivers(
  line: RevenueProjectionLobLine,
  monthKey: string,
  lookup: StaffingDriverLookup,
): StaffingMonthDrivers {
  const scenario = findMatchingStaffingScenario(line, lookup.scenarios)
  if (!scenario) return emptyDrivers()

  const matched = {
    matchedScenarioId: scenario.id,
    matchedScenarioName: scenario.name || scenario.plan.client,
  }
  const overrides = lookup.getOverrides(scenario.id)
  const ledger = lookup.getLedger(scenario.id)
  const categoryTemplates = lookup.getShrinkageCategories?.(scenario.id) ?? []
  const weeklyPlans = resolveWeeklyCategoryPlans(ledger, overrides, categoryTemplates)
  const hasAnyDrivers = scenarioHasAnyPlannedDrivers(overrides, weeklyPlans)

  const capacityWeeks = (lookup.getCapacityRows?.(scenario.id) ?? [])
    .filter((row) => weekMonthKey(row.week) === monthKey)
    .map((row) => ({
      week: row.week,
      productionFte: Math.max(0, Number.isFinite(row.productionFte) ? row.productionFte : 0),
      volume: Math.max(0, Number.isFinite(row.volume) ? row.volume : 0),
    }))
  const volumeWeeks = capacityWeeks.length ? capacityWeeks : capacityWeeksFromLedger(ledger, overrides, monthKey)
  const volume = monthCapacityFromWeeks(volumeWeeks)
  const hasVolumeData = volume.weekCount > 0

  const monthWeeks = [
    ...new Set([
      ...ledger.filter((row) => weekMonthKey(row.week) === monthKey).map((row) => row.week),
      ...Object.keys(overrides).filter((week) => weekMonthKey(week) === monthKey),
      ...[...weeklyPlans.keys()].filter((week) => weekMonthKey(week) === monthKey),
      ...volumeWeeks.map((row) => row.week),
    ]),
  ].sort((a, b) => a.localeCompare(b))

  if (!monthWeeks.length) {
    return emptyDrivers(matched)
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
      .reduce((sum, item) => sum + plannedValueToRate(item.planned), 0)

    const inOffice01 = categories
      .filter((item) => isInOfficeCategory(item))
      .reduce((sum, item) => sum + plannedValueToRate(item.planned), 0)

    absenteeism01.push(abs01)
    shrinkage01.push(inOffice01)
  }

  return {
    absenteeismPct: rateToPctPoints(avg(absenteeism01)),
    shrinkagePct: rateToPctPoints(avg(shrinkage01)),
    fte: volume.fte,
    capacity: volume.capacity,
    weekCount: volume.weekCount,
    hasData: hasAnyDrivers && monthHasData,
    hasVolumeData,
    ...matched,
  }
}

export function filterRevenueLinesForAccessiblePlans(
  lines: RevenueProjectionLobLine[],
  scenarios: PlannerScenario[],
): RevenueProjectionLobLine[] {
  return lines.filter((line) => findMatchingStaffingScenario(line, scenarios) != null)
}

export function findStaffingScenarioForRevenueProjectionLine(
  line: RevenueProjectionLobLine,
  lookup: StaffingDriverLookup,
): PlannerScenario | null {
  return findMatchingStaffingScenario(line, lookup.scenarios)
}

export function findRevenueProjectionLineForScenario(
  scenario: PlannerScenario,
  lines: RevenueProjectionLobLine[],
): RevenueProjectionLobLine | null {
  if (!lines.length) return null
  const matched = lines.filter((line) => findMatchingStaffingScenario(line, [scenario])?.id === scenario.id)
  if (!matched.length) return null
  if (matched.length === 1) return matched[0]!
  const lob = resolvePlanLob(scenario.plan)
  const exactLob = matched.find((line) => normToken(line.lobProjectName) === normToken(lob))
  return exactLob ?? matched[0]!
}

export function staffingScenarioHasDriverData(
  line: RevenueProjectionLobLine,
  lookup: StaffingDriverLookup,
): boolean {
  const scenario = findMatchingStaffingScenario(line, lookup.scenarios)
  if (!scenario) return false
  const overrides = lookup.getOverrides(scenario.id)
  const ledger = lookup.getLedger(scenario.id)
  const categoryTemplates = lookup.getShrinkageCategories?.(scenario.id) ?? []
  const weeklyPlans = resolveWeeklyCategoryPlans(ledger, overrides, categoryTemplates)
  if (scenarioHasAnyPlannedDrivers(overrides, weeklyPlans)) return true
  const capacityRows = lookup.getCapacityRows?.(scenario.id) ?? []
  return capacityRows.some((row) => row.productionFte > 0 || row.volume > 0)
}

export function lineHasAnyStaffingDriverData(
  line: RevenueProjectionLobLine,
  months: string[],
  lookup: StaffingDriverLookup,
): boolean {
  if (!staffingScenarioHasDriverData(line, lookup)) return false
  return months.some((month) => resolveStaffingMonthDrivers(line, month, lookup).hasData)
}

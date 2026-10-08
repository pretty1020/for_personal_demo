import type { ChannelAssumptions, PlannerAssumptions, PlannerScenario, PeriodGranularity, ChannelType } from './types'
import { createCleanAssumptions, createScenario, DEFAULT_ASSUMPTIONS, DEFAULT_PLAN_METADATA } from './defaults'
import { emptyChannelAssumptions } from './channelPlanning'
import { syncDerivedTenuredFields } from './assumptionDerivation'
import { defaultChannelAssumptions } from './channelPlanning'
import { defaultCapacityPlanStartWeek, snapToWeekStart } from './capacityWeekUtils'
import { DEFAULT_REFERENCE_SCENARIO_NAME, isLegacyReferenceName, toReferenceScenarioName } from './scenarioNames'
import { PORTFOLIO_MONTHLY_CONTACT_VOLUME, PORTFOLIO_REVENUE_PER_CONTACT } from '../utils/portfolioConstants'
import { DEFAULT_ADMIN_EMAIL, rewriteLegacyBrandEmail } from './userDirectory'
import { saveCapacityPlanView } from './capacityPlanView'
import { CHANNEL_TYPES } from './types'

const STORAGE_KEY = 'wfp-planner-scenarios-v1'
const ACTIVE_KEY = 'wfp-planner-active-v1'
const GRANULARITY_KEY = 'wfp-planner-granularity-v1'

function isCapacityWorkspacePlan(plan: Partial<PlannerScenario['plan']> | undefined): boolean {
  return Boolean(plan?.clientId) || plan?.buildMethod === 'forward'
}

function inferSupportedChannels(
  plan: Partial<PlannerScenario['plan']> | undefined,
  assumptions: PlannerAssumptions,
): ChannelType[] {
  const explicit = (plan?.supportedChannels ?? []).filter(
    (channel): channel is ChannelType => CHANNEL_TYPES.includes(channel),
  )
  const defined = CHANNEL_TYPES.filter((channel) => assumptions.channels?.[channel] != null)
  const meaningful = defined.filter((channel) => {
    const config = assumptions.channels?.[channel]
    if (!config) return false
    return (
      config.forecastVolume > 0 ||
      config.ahtSeconds > 0 ||
      config.occupancyTarget > 0 ||
      config.productivityPct > 0 ||
      config.paidHoursPerFte > 0 ||
      (channel === 'chat' && config.chatConcurrency > 0)
    )
  })
  if (explicit.length) {
    const explicitIsFallbackVoice =
      explicit.length === 1 &&
      explicit[0] === 'voice' &&
      meaningful.some((channel) => channel !== 'voice') &&
      !meaningful.includes('voice')
    if (!explicitIsFallbackVoice) return explicit
  }
  if (meaningful.length) return meaningful
  if (defined.length) return defined
  return ['voice']
}

function normalizeAssumptions(
  raw: PlannerAssumptions,
  plan?: Partial<PlannerScenario['plan']>,
): PlannerAssumptions {
  const capacityWorkspace = isCapacityWorkspacePlan(plan)
  const legacyDefaults = capacityWorkspace ? createCleanAssumptions() : DEFAULT_ASSUMPTIONS
  const tenured = { ...legacyDefaults.tenured, ...raw.tenured }
  const business = { ...legacyDefaults.business, ...raw.business }
  const newHire = { ...legacyDefaults.newHire, ...raw.newHire }

  if (!capacityWorkspace) {
    if (tenured.occupancyTarget < 0.75) tenured.occupancyTarget = 0.75
    if (business.requiredOccupancy < 0.75) business.requiredOccupancy = 0.75
    if (business.baseForecastVolume < 100_000 && business.revenuePerContact <= PORTFOLIO_REVENUE_PER_CONTACT) {
      business.baseForecastVolume = PORTFOLIO_MONTHLY_CONTACT_VOLUME
      business.revenueTargetMonthly = DEFAULT_ASSUMPTIONS.business.revenueTargetMonthly
      business.budgetConstraintMonthly = DEFAULT_ASSUMPTIONS.business.budgetConstraintMonthly
    }
    if (business.slaPenaltyPerMissedPoint > 500) {
      business.slaPenaltyPerMissedPoint = DEFAULT_ASSUMPTIONS.business.slaPenaltyPerMissedPoint
    }
    if (!Number.isFinite(business.billingRate) || business.billingRate <= 0) {
      business.billingRate = DEFAULT_ASSUMPTIONS.business.billingRate
    }
    if (!Number.isFinite(business.hourlySalaryUsd) || business.hourlySalaryUsd <= 0) {
      business.hourlySalaryUsd = DEFAULT_ASSUMPTIONS.business.hourlySalaryUsd
    }
    if (!Number.isFinite(business.supportSalaryUsd) || business.supportSalaryUsd < 0) {
      business.supportSalaryUsd = DEFAULT_ASSUMPTIONS.business.supportSalaryUsd
    }
    if (!Number.isFinite(business.trainingSalaryRateUsd) || business.trainingSalaryRateUsd <= 0) {
      business.trainingSalaryRateUsd = DEFAULT_ASSUMPTIONS.business.trainingSalaryRateUsd
    }
    if (!Number.isFinite(business.otherCostUsd) || business.otherCostUsd < 0) {
      business.otherCostUsd = DEFAULT_ASSUMPTIONS.business.otherCostUsd
    }
    if (tenured.laborCostPerFteMonthly > 3_000) {
      tenured.laborCostPerFteMonthly = DEFAULT_ASSUMPTIONS.tenured.laborCostPerFteMonthly
    }
  }

  const channels = capacityWorkspace
    ? ({} as Partial<Record<ChannelType, ChannelAssumptions>>)
    : { ...DEFAULT_ASSUMPTIONS.channels }
  for (const key of Object.keys(raw.channels ?? {}) as ChannelType[]) {
    if (raw.channels?.[key]) {
      channels[key] = capacityWorkspace
        ? { ...emptyChannelAssumptions(key), ...raw.channels[key] }
        : { ...defaultChannelAssumptions(key), ...raw.channels[key] }
    }
  }
  if (capacityWorkspace) {
    const channelVolume = Object.values(channels).reduce((sum, channel) => sum + (channel?.forecastVolume ?? 0), 0)
    if (channelVolume > 0) {
      business.baseForecastVolume = channelVolume
    }
  }
  return syncDerivedTenuredFields({ newHire, tenured, business, channels })
}

function normalizePlan(
  raw: Partial<PlannerScenario['plan']> | undefined,
  assumptions?: PlannerAssumptions,
): PlannerScenario['plan'] {
  const weekStart = raw?.weekStart === 'monday' ? 'monday' : 'sunday'
  return {
    ...DEFAULT_PLAN_METADATA,
    ...raw,
    weekStart,
    supportedChannels: assumptions ? inferSupportedChannels(raw, assumptions) : DEFAULT_PLAN_METADATA.supportedChannels,
    capacityPlanStartWeek: raw?.capacityPlanStartWeek
      ? snapToWeekStart(raw.capacityPlanStartWeek, weekStart)
      : defaultCapacityPlanStartWeek(weekStart),
    capacityImportedWeeks: raw?.capacityImportedWeeks?.length ? raw.capacityImportedWeeks : undefined,
  }
}

function normalizeScenario(s: PlannerScenario): PlannerScenario {
  const ownerEmail = rewriteLegacyBrandEmail(
    s.ownerEmail?.trim().toLowerCase() || (!s.isBaseline ? DEFAULT_ADMIN_EMAIL : ''),
  )
  return {
    ...s,
    name: toReferenceScenarioName(s.name),
    ownerEmail: ownerEmail || undefined,
    plan: normalizePlan(s.plan, s.assumptions),
    assumptions: normalizeAssumptions(s.assumptions, s.plan),
  }
}

function migrateScenarios(scenarios: PlannerScenario[]): PlannerScenario[] {
  const normalized = scenarios.map(normalizeScenario)
  const hasReference = normalized.some((s) => s.name === DEFAULT_REFERENCE_SCENARIO_NAME)
  if (!hasReference && normalized.length) {
    const first = normalized[0]!
    first.name = DEFAULT_REFERENCE_SCENARIO_NAME
    first.isBaseline = true
    first.description = 'Default workforce planning reference.'
  }
  const reference = normalized.find((s) => s.name === DEFAULT_REFERENCE_SCENARIO_NAME || s.isBaseline) ?? normalized[0]
  if (reference) {
    for (const s of normalized) s.isBaseline = s.id === reference.id
    if (isLegacyReferenceName(reference.name)) reference.name = DEFAULT_REFERENCE_SCENARIO_NAME
  }
  return normalized
}

export function loadScenarios(): PlannerScenario[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return seedScenarios()
    const parsed = JSON.parse(raw) as PlannerScenario[]
    if (!Array.isArray(parsed) || !parsed.length) return seedScenarios()
    const migrated = migrateScenarios(parsed)
    saveScenarios(migrated)
    return migrated
  } catch {
    return seedScenarios()
  }
}

export function saveScenarios(scenarios: PlannerScenario[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios))
}

export function loadActiveScenarioId(): string | null {
  return localStorage.getItem(ACTIVE_KEY)
}

export function saveActiveScenarioId(id: string): void {
  localStorage.setItem(ACTIVE_KEY, id)
}

export function loadGranularity(): PeriodGranularity {
  try {
    const raw = localStorage.getItem(GRANULARITY_KEY)
    if (raw === 'weekly' || raw === 'monthly' || raw === 'quarterly' || raw === 'yearly' || raw === 'daily') {
      return raw
    }
  } catch {
    /* ignore */
  }
  return 'weekly'
}

export function saveGranularity(g: PeriodGranularity): void {
  localStorage.setItem(GRANULARITY_KEY, g)
}

function seedScenarios(): PlannerScenario[] {
  const baseline = createScenario(
    DEFAULT_REFERENCE_SCENARIO_NAME,
    'Default workforce planning reference.',
    DEFAULT_ASSUMPTIONS,
  )
  baseline.isBaseline = true
  const scenarios = [baseline]
  saveScenarios(scenarios)
  saveActiveScenarioId(baseline.id)
  saveCapacityPlanView({
    scenarioId: baseline.id,
    scenarioName: baseline.name,
    savedAt: new Date().toISOString(),
    granularity: 'weekly',
  })
  return scenarios
}

export function exportScenariosJson(scenarios: PlannerScenario[]): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), scenarios }, null, 2)
}

export function importScenariosJson(json: string): PlannerScenario[] {
  const data = JSON.parse(json) as { scenarios?: PlannerScenario[] }
  if (!data.scenarios?.length) throw new Error('Invalid scenario file.')
  return data.scenarios
}

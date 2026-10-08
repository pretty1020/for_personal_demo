import { loadCapacityMatrixView } from './capacityViewPersistence'
import { loadCapacityPlanView } from './capacityPlanView'
import { explicitPlanChannels, planScopeLabel, resolvePlanLob, resolvePlanLocation } from './planIdentity'
import { CHANNEL_LABELS, CHANNEL_TYPES, type ChannelType, type PlannerScenario } from './types'

export const PORTFOLIO_FINANCIAL_SCOPE_ID = 'portfolio:all'

export type CapacityFinancialScope = {
  scopeId: string
  isCombined: boolean
  /** True when rolling up every client / LOB in the company portfolio. */
  isPortfolio: boolean
  clientName: string
  displayLabel: string
  linkedScenario: PlannerScenario | null
  clientScenarios: PlannerScenario[]
}

function visibleScenarios(scenarios: PlannerScenario[]): PlannerScenario[] {
  return scenarios.filter((scenario) => !scenario.isBaseline)
}

function portfolioScope(scenarios: PlannerScenario[]): CapacityFinancialScope | null {
  const all = visibleScenarios(scenarios)
  if (!all.length) return null
  const clientCount = new Set(all.map((scenario) => scenario.plan.client)).size
  return {
    scopeId: PORTFOLIO_FINANCIAL_SCOPE_ID,
    isCombined: true,
    isPortfolio: true,
    clientName: '',
    displayLabel:
      clientCount > 1
        ? `All clients · ${all.length} LOB${all.length === 1 ? '' : 's'}`
        : `${all[0]!.plan.client} · Combined (${all.length} LOB${all.length === 1 ? '' : 's'})`,
    linkedScenario: all[0]!,
    clientScenarios: all,
  }
}

function scopeFromId(scenarios: PlannerScenario[], scopeId: string): CapacityFinancialScope | null {
  const all = visibleScenarios(scenarios)
  if (!all.length || !scopeId) return null

  if (scopeId === PORTFOLIO_FINANCIAL_SCOPE_ID || scopeId === 'combined:all') {
    return portfolioScope(all)
  }

  const isCombined = scopeId.startsWith('combined:')
  const selectedClient = isCombined ? scopeId.replace('combined:', '') : null
  const linkedScenario = isCombined
    ? all.find((scenario) => scenario.plan.client === selectedClient) ?? null
    : all.find((scenario) => `lob:${scenario.id}` === scopeId) ?? null

  if (!linkedScenario) return null

  const clientScenarios = all.filter((scenario) => scenario.plan.client === linkedScenario.plan.client)
  const displayLabel = isCombined
    ? `${linkedScenario.plan.client} · Combined`
    : `${planScopeLabel(linkedScenario.plan)} · ${linkedScenario.plan.billingType}`

  return {
    scopeId,
    isCombined,
    isPortfolio: false,
    clientName: linkedScenario.plan.client,
    displayLabel,
    linkedScenario,
    clientScenarios,
  }
}

export type FinancialLobOption = {
  id: string
  client: string
  lob: string
  scopeId: string
}

export function listFinancialClientNames(scenarios: PlannerScenario[]): string[] {
  return [...new Set(visibleScenarios(scenarios).map((scenario) => scenario.plan.client).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  )
}

export function listFinancialLocationNames(scenarios: PlannerScenario[], clientName = ''): string[] {
  return [
    ...new Set(
      visibleScenarios(scenarios)
        .filter((scenario) => !clientName || scenario.plan.client === clientName)
        .map((scenario) => resolvePlanLocation(scenario.plan))
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b))
}

export function listFinancialChannelOptions(
  scenarios: PlannerScenario[],
  clientName = '',
  location = '',
): ChannelType[] {
  const present = new Set<ChannelType>()
  visibleScenarios(scenarios)
    .filter((scenario) => !clientName || scenario.plan.client === clientName)
    .filter((scenario) => !location || resolvePlanLocation(scenario.plan) === location)
    .forEach((scenario) => {
      explicitPlanChannels(scenario.plan).forEach((channel) => present.add(channel))
    })
  return CHANNEL_TYPES.filter((channel) => present.has(channel))
}

export function listFinancialLobOptions(
  scenarios: PlannerScenario[],
  clientName = '',
  location = '',
  channel: ChannelType | '' = '',
): FinancialLobOption[] {
  return visibleScenarios(scenarios)
    .filter((scenario) => !clientName || scenario.plan.client === clientName)
    .filter((scenario) => !location || resolvePlanLocation(scenario.plan) === location)
    .filter((scenario) => !channel || explicitPlanChannels(scenario.plan).includes(channel))
    .map((scenario) => ({
      id: scenario.id,
      client: scenario.plan.client,
      lob: resolvePlanLob(scenario.plan) || scenario.name,
      scopeId: `lob:${scenario.id}`,
    }))
}

export type FinancialCardFilters = {
  clientName: string
  location: string
  lobId: string
  channel: ChannelType | ''
}

export function financialScopeIdFromFilters(clientName: string, lobId: string): string {
  if (!clientName) return PORTFOLIO_FINANCIAL_SCOPE_ID
  if (!lobId) return `combined:${clientName}`
  return `lob:${lobId}`
}

function matchesCardFilters(scenario: PlannerScenario, filters: FinancialCardFilters): boolean {
  if (filters.clientName && scenario.plan.client !== filters.clientName) return false
  if (filters.lobId && scenario.id !== filters.lobId) return false
  if (filters.location && resolvePlanLocation(scenario.plan) !== filters.location) return false
  if (filters.channel && !explicitPlanChannels(scenario.plan).includes(filters.channel)) return false
  return true
}

export function scopeFromCardFilters(
  scenarios: PlannerScenario[],
  filters: FinancialCardFilters,
): CapacityFinancialScope | null {
  const matched = visibleScenarios(scenarios).filter((scenario) => matchesCardFilters(scenario, filters))
  if (!matched.length) return null
  if (matched.length === 1) {
    const linked = matched[0]!
    const channelLabel = filters.channel ? CHANNEL_LABELS[filters.channel] : formatChannels(linked)
    return {
      scopeId: `lob:${linked.id}`,
      isCombined: false,
      isPortfolio: false,
      clientName: linked.plan.client,
      displayLabel: `${planScopeLabel(linked.plan)}${channelLabel ? ` · ${channelLabel}` : ''} · ${linked.plan.billingType}`,
      linkedScenario: linked,
      clientScenarios: matched,
    }
  }
  const clientName = filters.clientName || (new Set(matched.map((item) => item.plan.client)).size === 1 ? matched[0]!.plan.client : '')
  const channelLabel = filters.channel ? CHANNEL_LABELS[filters.channel] : ''
  const locationLabel = filters.location
  const bits = [
    clientName || 'All clients',
    locationLabel,
    channelLabel,
    `${matched.length} LOB${matched.length === 1 ? '' : 's'}`,
  ].filter(Boolean)
  return {
    scopeId: clientName ? `combined:${clientName}` : PORTFOLIO_FINANCIAL_SCOPE_ID,
    isCombined: true,
    isPortfolio: !clientName,
    clientName,
    displayLabel: bits.join(' · '),
    linkedScenario: matched[0]!,
    clientScenarios: matched,
  }
}

function formatChannels(scenario: PlannerScenario): string {
  return explicitPlanChannels(scenario.plan)
    .map((channel) => CHANNEL_LABELS[channel])
    .join(', ')
}

export type ResolveCapacityFinancialScopeOptions = {
  /**
   * When true (Financial page default), roll up every client/LOB instead of
   * following the Capacity matrix’s last single-LOB selection.
   */
  preferPortfolio?: boolean
  /** Explicit Financial Overview (or other) filter; wins over preferPortfolio. */
  scopeId?: string
  cardFilters?: FinancialCardFilters
}

/**
 * Resolves which Capacity LOBs feed Financial Summary.
 * Capacity matrix scope is used only when preferPortfolio is false and no scopeId is set.
 */
export function resolveCapacityFinancialScope(
  scenarios: PlannerScenario[],
  options: ResolveCapacityFinancialScopeOptions = {},
): CapacityFinancialScope | null {
  const all = visibleScenarios(scenarios)
  if (!all.length) return null

  if (options.cardFilters) {
    const scoped = scopeFromCardFilters(all, options.cardFilters)
    if (scoped) return scoped
    return {
      scopeId: PORTFOLIO_FINANCIAL_SCOPE_ID,
      isCombined: true,
      isPortfolio: !options.cardFilters.clientName,
      clientName: options.cardFilters.clientName,
      displayLabel: 'No LOBs match these filters',
      linkedScenario: null,
      clientScenarios: [],
    }
  }

  if (options.scopeId) {
    return scopeFromId(all, options.scopeId) ?? portfolioScope(all)
  }

  if (options.preferPortfolio !== false) {
    return portfolioScope(all)
  }

  const matrixView = loadCapacityMatrixView()
  const planView = loadCapacityPlanView()
  const scopeId =
    matrixView?.scopeId ??
    (planView?.scenarioId ? `lob:${planView.scenarioId}` : all[0] ? `lob:${all[0].id}` : '')

  return scopeFromId(all, scopeId) ?? portfolioScope(all)
}

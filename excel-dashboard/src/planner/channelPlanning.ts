import { resolveRequiredProductionFteForPlan } from './requiredProductionFte'
import type {
  ChannelAssumptions,
  ChannelFinancialResult,
  ChannelFinancialRollup,
  ChannelStaffingPlan,
  ChannelStaffingResult,
  ChannelType,
  ConsolidatedChannelStaffing,
  PlannerAssumptions,
  PlannerPlanMetadata,
  PlannerScenario,
} from './types'
import { CHANNEL_TYPES, CHANNEL_VOLUME_LABELS } from './types'
import { isFteBillingPlan } from '../utils/staffingCapacity/billingModel'

/** Required Production FTE uses occupancy for every channel. */
const OCCUPANCY_CHANNELS = new Set<ChannelType>(CHANNEL_TYPES)

/** Processing-time label only (back office). Occupancy still drives FTE. */
const PRODUCTIVITY_CHANNELS = new Set<ChannelType>(['backOffice'])

export function isOccupancyChannel(channel: ChannelType): boolean {
  return OCCUPANCY_CHANNELS.has(channel)
}

export function isProductivityChannel(channel: ChannelType): boolean {
  return PRODUCTIVITY_CHANNELS.has(channel)
}

export function getSupportedChannels(plan: PlannerPlanMetadata): ChannelType[] {
  const raw = plan.supportedChannels
  if (raw == null) return ['voice']
  return raw.filter((channel): channel is ChannelType => CHANNEL_TYPES.includes(channel))
}

function isCapacityWorkspacePlan(plan: PlannerPlanMetadata): boolean {
  return Boolean(plan.clientId) || plan.buildMethod === 'forward'
}

export function defaultChannelAssumptions(
  channel: ChannelType,
  base?: Partial<ChannelAssumptions>,
): ChannelAssumptions {
  const defaults: ChannelAssumptions = {
    forecastVolume: channel === 'voice' ? 45_000 : 8_000,
    ahtSeconds: channel === 'voice' ? 285 : channel === 'chat' ? 420 : 180,
    paidHoursPerFte: 40,
    occupancyTarget: 0.85,
    shrinkagePct: 0.25,
    productivityPct: 0.94,
    chatConcurrency: channel === 'chat' ? 2.5 : 1,
    channelMixPct: channel === 'voice' ? 1 : 0,
    revenuePerContact: 4.25,
    startingProductionHc: 0,
    trainingWeeks: 4,
    nestingWeeks: 2,
    classSize: 18,
    trainingAttritionRate: 0.08,
    nestingAttritionRate: 0.04,
    graduationRate: 0.9,
    nestingPhoneTimePct: 0.5,
    ...base,
  }
  return defaults
}

export function emptyChannelAssumptions(
  channel: ChannelType,
  base?: Partial<ChannelAssumptions>,
): ChannelAssumptions {
  return defaultChannelAssumptions(channel, {
    forecastVolume: 0,
    ahtSeconds: 0,
    paidHoursPerFte: 0,
    occupancyTarget: 0,
    shrinkagePct: 0,
    productivityPct: 0,
    chatConcurrency: channel === 'chat' ? 0 : 1,
    channelMixPct: 0,
    revenuePerContact: 0,
    startingProductionHc: 0,
    trainingWeeks: 1,
    nestingWeeks: 1,
    classSize: 1,
    trainingAttritionRate: 0,
    nestingAttritionRate: 0,
    graduationRate: 1,
    nestingPhoneTimePct: 0,
    ...base,
  })
}

/** Total starting production HC across all channels (week 0 baseline). */
export function getTotalStartingProductionHc(
  assumptions: PlannerAssumptions,
  plan: PlannerPlanMetadata,
): number {
  const channelAssumptions = resolveChannelAssumptions(assumptions, plan)
  const supported = getSupportedChannels(plan)
  const channelTotal = supported.reduce(
    (sum, ch) => sum + (channelAssumptions[ch]?.startingProductionHc ?? 0),
    0,
  )
  if (supported.length > 0) return channelTotal
  return assumptions.tenured.beginningProductionHeadcount
}

/** Net production yield per hire after training pipeline attrition. */
export function netGraduateYield(assumptions: ChannelAssumptions): number {
  const trainingSurvival = 1 - Math.min(Math.max(assumptions.trainingAttritionRate, 0), 0.99)
  const nestingSurvival = 1 - Math.min(Math.max(assumptions.nestingAttritionRate, 0), 0.99)
  return trainingSurvival * nestingSurvival * Math.min(Math.max(assumptions.graduationRate, 0), 1)
}

/** Suggest weekly class starts to close staffing gap for one channel. */
export function suggestChannelWeeklyClasses(
  channel: ChannelType,
  assumptions: ChannelAssumptions,
  staffing: ChannelStaffingResult,
  options?: { allowHiringSuggestions?: boolean },
): ChannelStaffingPlan {
  const startingProductionHc = assumptions.startingProductionHc ?? 0
  const requiredHeadcount = staffing.requiredHeadcount
  const staffingGap = Math.max(0, requiredHeadcount - startingProductionHc)
  const yieldPerStart = netGraduateYield(assumptions)
  const weeksToProductive = Math.max(1, assumptions.trainingWeeks + assumptions.nestingWeeks)
  const netPerClass = assumptions.classSize * yieldPerStart

  let suggestedWeeklyStarts = 0
  let weeksToFullStaffing = 0

  const allowHiringSuggestions = options?.allowHiringSuggestions ?? true
  if (allowHiringSuggestions && staffingGap > 0 && netPerClass > 0) {
    suggestedWeeklyStarts = Math.max(1, Math.ceil(staffingGap / netPerClass))
    const graduatesPerWeek = suggestedWeeklyStarts * yieldPerStart
    weeksToFullStaffing = graduatesPerWeek > 0 ? Math.ceil(staffingGap / graduatesPerWeek) + weeksToProductive : 0
  }

  return {
    channel,
    startingProductionHc,
    requiredHeadcount,
    requiredFte: staffing.requiredFte,
    staffingGap,
    staffingPct: requiredHeadcount > 0 ? startingProductionHc / requiredHeadcount : null,
    trainingWeeks: assumptions.trainingWeeks,
    nestingWeeks: assumptions.nestingWeeks,
    classSize: assumptions.classSize,
    suggestedWeeklyStarts,
    weeksToFullStaffing,
  }
}

export function buildChannelStaffingPlans(
  assumptions: PlannerAssumptions,
  plan: PlannerPlanMetadata,
  volumeScale = 1,
): ChannelStaffingPlan[] {
  const consolidated = calculateConsolidatedStaffing(assumptions, plan, volumeScale)
  const channelAssumptions = resolveChannelAssumptions(assumptions, plan)
  const allowHiringSuggestions = assumptions.newHire.hiringPlanPerPeriod > 0
  return consolidated.byChannel.map((staffing) =>
    suggestChannelWeeklyClasses(staffing.channel, channelAssumptions[staffing.channel], staffing, {
      allowHiringSuggestions,
    }),
  )
}

/** Build channel assumptions from legacy single-queue fields when channels are missing. */
export function resolveChannelAssumptions(
  assumptions: PlannerAssumptions,
  plan: PlannerPlanMetadata,
): Record<ChannelType, ChannelAssumptions> {
  const supported = getSupportedChannels(plan)
  const resolved = {} as Record<ChannelType, ChannelAssumptions>
  const legacyVolume = assumptions.business.baseForecastVolume
  const legacyAht = assumptions.tenured.ahtSeconds
  const legacyPaidHours = assumptions.tenured.standardScheduledHoursPerWeek
  const legacyOccupancy = assumptions.tenured.occupancyTarget
  const legacyShrinkage = assumptions.tenured.shrinkageRate
  const legacyProductivity = assumptions.tenured.productivityFactor
  const legacyRevenue = assumptions.business.revenuePerContact

  const equalMix = supported.length > 0 ? 1 / supported.length : 1

  for (const channel of supported) {
    const existing = assumptions.channels?.[channel]
    if (existing) {
      resolved[channel] = { ...existing }
      continue
    }
    resolved[channel] = isCapacityWorkspacePlan(plan)
      ? emptyChannelAssumptions(channel, {
          paidHoursPerFte: legacyPaidHours,
          shrinkagePct: legacyShrinkage,
          trainingWeeks: assumptions.newHire.trainingWeeks,
          nestingWeeks: assumptions.newHire.nestingWeeks,
          classSize: assumptions.newHire.classSize,
          trainingAttritionRate: assumptions.newHire.trainingAttritionRate,
          nestingAttritionRate: assumptions.newHire.nestingAttritionRate,
          graduationRate: assumptions.newHire.graduationRate,
          nestingPhoneTimePct: assumptions.newHire.nestingPhoneTimePct,
        })
      : defaultChannelAssumptions(channel, {
          forecastVolume: Math.round(legacyVolume * equalMix),
          ahtSeconds: legacyAht,
          paidHoursPerFte: legacyPaidHours,
          occupancyTarget: legacyOccupancy,
          shrinkagePct: legacyShrinkage,
          productivityPct: legacyProductivity,
          channelMixPct: equalMix,
          revenuePerContact: legacyRevenue,
          startingProductionHc: 0,
          trainingWeeks: assumptions.newHire.trainingWeeks,
          nestingWeeks: assumptions.newHire.nestingWeeks,
          classSize: assumptions.newHire.classSize,
          trainingAttritionRate: assumptions.newHire.trainingAttritionRate,
          nestingAttritionRate: assumptions.newHire.nestingAttritionRate,
          graduationRate: assumptions.newHire.graduationRate,
          nestingPhoneTimePct: assumptions.newHire.nestingPhoneTimePct,
        })
  }
  return resolved
}

/** Step 1: Total workload hours = (Forecast Volume × AHT) ÷ 3600 */
export function calculateWorkloadHours(forecastVolume: number, ahtSeconds: number): number {
  if (forecastVolume <= 0 || ahtSeconds <= 0) return 0
  return (forecastVolume * ahtSeconds) / 3600
}

/** Step 2: Productive hours per FTE (channel-specific). */
export function calculateProductiveHoursPerFte(channel: ChannelType, assumptions: ChannelAssumptions): number {
  const paidHours = assumptions.paidHoursPerFte
  if (paidHours <= 0) return 0

  if (channel === 'chat' || channel === 'sms') {
    const concurrency = Math.max(1, assumptions.chatConcurrency || 1)
    return paidHours * assumptions.occupancyTarget * concurrency
  }
  if (channel === 'social' && (assumptions.socialWorkloadMode ?? 'direct_messages') === 'direct_messages') {
    const concurrency = Math.max(1, assumptions.chatConcurrency || 1)
    return paidHours * assumptions.occupancyTarget * concurrency
  }
  if (isOccupancyChannel(channel)) {
    return paidHours * assumptions.occupancyTarget
  }
  return paidHours * assumptions.productivityPct
}

/** Step 3 & 4: Required FTE and headcount (shrinkage applied once per channel). */
export function calculateChannelStaffing(
  channel: ChannelType,
  assumptions: ChannelAssumptions,
  forecastVolumeOverride?: number,
): ChannelStaffingResult {
  const forecastVolume = forecastVolumeOverride ?? assumptions.forecastVolume
  const workloadHours = calculateWorkloadHours(forecastVolume, assumptions.ahtSeconds)
  const productiveHoursPerFte = calculateProductiveHoursPerFte(channel, assumptions)
  const requiredFte =
    productiveHoursPerFte > 0 ? workloadHours / productiveHoursPerFte : 0
  const shrinkage = Math.min(Math.max(assumptions.shrinkagePct, 0), 0.99)
  const requiredHeadcount = shrinkage < 1 ? requiredFte / (1 - shrinkage) : requiredFte

  return {
    channel,
    forecastVolume,
    workloadHours,
    productiveHoursPerFte,
    requiredFte,
    requiredHeadcount,
    channelMixPct: assumptions.channelMixPct,
  }
}

/** Consolidate channel staffing by summing (never averaging). */
export function consolidateChannelStaffing(
  results: ChannelStaffingResult[],
): ConsolidatedChannelStaffing {
  const totalWorkloadHours = results.reduce((s, r) => s + r.workloadHours, 0)
  const totalRequiredFte = results.reduce((s, r) => s + r.requiredFte, 0)
  const totalRequiredHeadcount = results.reduce((s, r) => s + r.requiredHeadcount, 0)
  const totalForecastVolume = results.reduce((s, r) => s + r.forecastVolume, 0)
  const weightedAhtSeconds =
    totalForecastVolume > 0
      ? results.reduce((s, r) => s + r.forecastVolume * (r.workloadHours > 0 ? (r.workloadHours * 3600) / r.forecastVolume : 0), 0) /
        totalForecastVolume
      : 0

  return {
    byChannel: results,
    totalWorkloadHours,
    totalRequiredFte,
    totalRequiredHeadcount,
    totalForecastVolume,
    weightedAhtSeconds,
  }
}

export function calculateConsolidatedStaffing(
  assumptions: PlannerAssumptions,
  plan: PlannerPlanMetadata,
  volumeScale = 1,
): ConsolidatedChannelStaffing {
  const channelAssumptions = resolveChannelAssumptions(assumptions, plan)
  const supported = getSupportedChannels(plan)
  const results = supported.map((channel) => {
    const channelAssumption = channelAssumptions[channel]
    const scaledVolume = Math.round(channelAssumption.forecastVolume * volumeScale)
    return calculateChannelStaffing(channel, channelAssumption, scaledVolume)
  })
  return consolidateChannelStaffing(results)
}

export function calculateChannelFinancialsWithRevenue(
  staffing: ChannelStaffingResult,
  assumptions: ChannelAssumptions,
  totalProductionFte: number,
  totalRequiredFte: number,
  hourlySalaryUsd: number,
  weeksPerPeriod = 1,
): ChannelFinancialResult {
  const productionShare = totalRequiredFte > 0 ? staffing.requiredFte / totalRequiredFte : 1 / Math.max(1, staffing.channelMixPct)
  const productionFte = totalProductionFte * productionShare
  const laborCost = productionFte * staffing.productiveHoursPerFte * hourlySalaryUsd * weeksPerPeriod
  const revenue = staffing.forecastVolume * assumptions.revenuePerContact
  const grossMargin = revenue - laborCost

  return {
    channel: staffing.channel,
    requiredFte: staffing.requiredFte,
    requiredHeadcount: staffing.requiredHeadcount,
    productionFte,
    staffingGap: Math.max(0, staffing.requiredHeadcount - productionFte),
    laborCost,
    revenue,
    costPerContact: staffing.forecastVolume > 0 ? laborCost / staffing.forecastVolume : 0,
    grossMargin,
    grossMarginPct: revenue > 0 ? grossMargin / revenue : 0,
    staffingRatio: staffing.requiredFte > 0 ? productionFte / staffing.requiredFte : null,
    capacityUtilization:
      staffing.requiredFte > 0 ? Math.min(1.5, productionFte / staffing.requiredFte) : 0,
    channelMixPct: staffing.channelMixPct,
  }
}

export function calculatePeriodChannelFinancials(
  assumptions: PlannerAssumptions,
  plan: PlannerPlanMetadata,
  consolidated: ConsolidatedChannelStaffing,
  totalProductionFte: number,
  weeksPerPeriod = 1,
): ChannelFinancialResult[] {
  const channelAssumptions = resolveChannelAssumptions(assumptions, plan)
  return consolidated.byChannel.map((staffing) =>
    calculateChannelFinancialsWithRevenue(
      staffing,
      channelAssumptions[staffing.channel],
      totalProductionFte,
      consolidated.totalRequiredFte,
      assumptions.business.hourlySalaryUsd,
      weeksPerPeriod,
    ),
  )
}

export function rollupChannelFinancials(
  items: ChannelFinancialResult[],
  scopeLabel: string,
  scopeType: ChannelFinancialRollup['scopeType'],
): ChannelFinancialRollup {
  const totals = items.reduce(
    (acc, item) => ({
      requiredFte: acc.requiredFte + item.requiredFte,
      requiredHeadcount: acc.requiredHeadcount + item.requiredHeadcount,
      productionFte: acc.productionFte + item.productionFte,
      staffingGap: acc.staffingGap + item.staffingGap,
      laborCost: acc.laborCost + item.laborCost,
      revenue: acc.revenue + item.revenue,
      costPerContact: 0,
      grossMargin: acc.grossMargin + item.grossMargin,
      grossMarginPct: 0,
      staffingRatio: null as number | null,
      capacityUtilization: 0,
      channelMixPct: 1,
    }),
    {
      requiredFte: 0,
      requiredHeadcount: 0,
      productionFte: 0,
      staffingGap: 0,
      laborCost: 0,
      revenue: 0,
      costPerContact: 0,
      grossMargin: 0,
      grossMarginPct: 0,
      staffingRatio: null as number | null,
      capacityUtilization: 0,
      channelMixPct: 1,
    },
  )
  const totalVolume = items.reduce((s, i) => s + (i.revenue > 0 && i.costPerContact > 0 ? i.revenue / (i.costPerContact || 1) : 0), 0)
  totals.costPerContact = totalVolume > 0 ? totals.laborCost / totalVolume : 0
  totals.grossMarginPct = totals.revenue > 0 ? totals.grossMargin / totals.revenue : 0
  totals.staffingRatio = totals.requiredFte > 0 ? totals.productionFte / totals.requiredFte : null
  totals.capacityUtilization = totals.requiredFte > 0 ? totals.productionFte / totals.requiredFte : 0

  return { scopeLabel, scopeType, channels: items, totals }
}

/** Aggregate channel financials across scenarios at client level. */
export function aggregateClientChannelFinancials(
  scenarios: PlannerScenario[],
  channelFinancialsByScenario: Map<string, ChannelFinancialResult[]>,
): ChannelFinancialRollup {
  const byChannel = new Map<ChannelType, ChannelFinancialResult>()

  for (const scenario of scenarios) {
    const financials = channelFinancialsByScenario.get(scenario.id) ?? []
    for (const item of financials) {
      const existing = byChannel.get(item.channel)
      if (!existing) {
        byChannel.set(item.channel, { ...item })
        continue
      }
      byChannel.set(item.channel, {
        channel: item.channel,
        requiredFte: existing.requiredFte + item.requiredFte,
        requiredHeadcount: existing.requiredHeadcount + item.requiredHeadcount,
        productionFte: existing.productionFte + item.productionFte,
        staffingGap: existing.staffingGap + item.staffingGap,
        laborCost: existing.laborCost + item.laborCost,
        revenue: existing.revenue + item.revenue,
        costPerContact: 0,
        grossMargin: existing.grossMargin + item.grossMargin,
        grossMarginPct: 0,
        staffingRatio: null,
        capacityUtilization: 0,
        channelMixPct: 0,
      })
    }
  }

  const channels = CHANNEL_TYPES.filter((c) => byChannel.has(c)).map((c) => byChannel.get(c)!)
  const clientName = scenarios[0]?.plan.client ?? 'Client'
  return rollupChannelFinancials(channels, clientName, 'client')
}

/** Normalize channel mix percentages to sum to 1 across selected channels. */
export function normalizeChannelMix(
  channels: Partial<Record<ChannelType, ChannelAssumptions>>,
  supported: ChannelType[],
): Partial<Record<ChannelType, ChannelAssumptions>> {
  const totalMix = supported.reduce((s, ch) => s + (channels[ch]?.channelMixPct ?? 0), 0)
  if (totalMix <= 0) {
    const equal = 1 / Math.max(supported.length, 1)
    const next = { ...channels }
    for (const ch of supported) {
      next[ch] = { ...(next[ch] ?? defaultChannelAssumptions(ch)), channelMixPct: equal }
    }
    return next
  }
  const next = { ...channels }
  for (const ch of supported) {
    if (next[ch]) {
      next[ch] = { ...next[ch]!, channelMixPct: next[ch]!.channelMixPct / totalMix }
    }
  }
  return next
}

export type ChannelDriverField = {
  field: keyof ChannelAssumptions
  label: string
}

export type ChannelDriverValidationIssue = {
  channel: ChannelType
  field: keyof ChannelAssumptions
  label: string
}

function ahtFieldLabel(channel: ChannelType): string {
  if (channel === 'video') return 'Average Session Time (sec)'
  if (channel === 'backOffice') return 'Average Processing Time (sec)'
  if (channel === 'email') return 'Email AHT (sec)'
  return 'Average Handle Time (sec)'
}

/** Required workload drivers per channel type for FTE calculation. */
export function getChannelRequiredDriverFields(channel: ChannelType): ChannelDriverField[] {
  if (channel === 'video') {
    return [
      { field: 'forecastVolume', label: 'Sessions' },
      { field: 'ahtSeconds', label: 'Average Session Time (sec)' },
      { field: 'occupancyTarget', label: 'Utilization' },
    ]
  }
  const fields: ChannelDriverField[] = [
    { field: 'forecastVolume', label: CHANNEL_VOLUME_LABELS[channel] },
    { field: 'ahtSeconds', label: ahtFieldLabel(channel) },
  ]
  if (channel === 'chat' || channel === 'sms') {
    fields.push(
      { field: 'occupancyTarget', label: 'Occupancy / Utilization Target' },
      { field: 'chatConcurrency', label: channel === 'sms' ? 'Messaging Concurrency' : 'Chat Concurrency' },
    )
    return fields
  }
  if (isOccupancyChannel(channel)) {
    fields.push({ field: 'occupancyTarget', label: 'Occupancy / Utilization Target' })
    return fields
  }
  fields.push({ field: 'productivityPct', label: 'Productivity %' })
  return fields
}

function isValidDriverValue(channel: ChannelType, field: keyof ChannelAssumptions, value: number | undefined): boolean {
  if (value == null || !Number.isFinite(value)) return false
  switch (field) {
    case 'forecastVolume':
      return value > 0
    case 'ahtSeconds':
      return value > 0
    case 'occupancyTarget':
      return value > 0 && value <= 1
    case 'productivityPct':
      return value > 0 && value <= 1.2
    case 'chatConcurrency':
      return (channel === 'chat' || channel === 'sms') && value >= 1
    default:
      return true
  }
}

export function validateChannelCapacityDrivers(
  channels: Partial<Record<ChannelType, ChannelAssumptions>>,
  supported: ChannelType[],
  options?: { billingType?: string },
): ChannelDriverValidationIssue[] {
  const fteBilling = options?.billingType ? isFteBillingPlan(options.billingType) : false
  // Per FTE billing only needs Week 1 Required Production FTE — skip channel volume/AHT/etc.
  if (fteBilling) return []
  const issues: ChannelDriverValidationIssue[] = []
  for (const channel of supported) {
    const assumptions = channels[channel]
    for (const driver of getChannelRequiredDriverFields(channel)) {
      const value = assumptions?.[driver.field]
      if (!isValidDriverValue(channel, driver.field, typeof value === 'number' ? value : undefined)) {
        issues.push({ channel, field: driver.field, label: driver.label })
      }
    }
  }
  return issues
}

export function initChannelsForSupported(
  current: Partial<Record<ChannelType, ChannelAssumptions>>,
  supported: ChannelType[],
  options?: {
    trainingWeeks?: number
    nestingWeeks?: number
    requireUserEntry?: boolean
    defaultPaidHours?: number
    defaultShrinkagePct?: number
  },
): Partial<Record<ChannelType, ChannelAssumptions>> {
  const next = { ...current }
  for (const channel of supported) {
    if (!next[channel]) {
      next[channel] = options?.requireUserEntry
        ? emptyChannelAssumptions(channel, {
            paidHoursPerFte: options.defaultPaidHours ?? 0,
            shrinkagePct: options.defaultShrinkagePct ?? 0,
            trainingWeeks: options?.trainingWeeks ?? 1,
            nestingWeeks: options?.nestingWeeks ?? 1,
            startingProductionHc: 0,
            classSize: 1,
          })
        : defaultChannelAssumptions(channel, {
            trainingWeeks: options?.trainingWeeks,
            nestingWeeks: options?.nestingWeeks,
            startingProductionHc: 0,
          })
    }
  }
  for (const key of Object.keys(next) as ChannelType[]) {
    if (!supported.includes(key)) delete next[key]
  }
  return normalizeChannelMix(next, supported)
}

export function shouldUseChannelRequiredFte(
  plan: PlannerPlanMetadata,
  assumptions: PlannerAssumptions,
): boolean {
  const supported = getSupportedChannels(plan)
  if (!supported.length) return false
  if (supported.length > 1) return true
  return Boolean(assumptions.channels?.[supported[0]!])
}

/** Sum per-channel required FTE, scaling volumes when weekly volume differs from channel forecast total. */
export function resolveChannelRequiredFte(
  assumptions: PlannerAssumptions,
  plan: PlannerPlanMetadata,
  weeklyVolume?: number | null,
): number | null {
  return resolveRequiredProductionFteForPlan(assumptions, plan, weeklyVolume)
}

export const CHANNEL_FORMULA_TOOLTIPS: Record<string, string> = {
  workloadHours: 'Workload Hours = (Forecast Volume × AHT) ÷ 3600',
  productiveVoice: 'Productive Hours = Paid Hours × Occupancy',
  productiveChat: 'Productive Hours = Paid Hours × Occupancy × Concurrency (Chat / SMS / social DMs)',
  productiveAsync: 'Productive Hours = Paid Hours × Productivity',
  requiredFte: 'Required Production FTE = (Volume × AHT or Processing Time) ÷ (Productive Seconds × Occupancy [× Concurrency])',
  requiredHeadcount: 'Paid / Required Headcount = Required Production FTE ÷ (1 − Shrinkage). Shrinkage is applied once per channel.',
  consolidated: 'Total Required Production FTE = Sum of channel Required Production FTE (not averaged). Shrinkage is not applied twice.',
}

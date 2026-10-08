import {
  getSupportedChannels,
  resolveChannelAssumptions,
  shouldUseChannelRequiredFte,
  type ChannelDriverField,
  type ChannelDriverValidationIssue,
} from './channelPlanning'
import type {
  ChannelAssumptions,
  ChannelStaffingResult,
  ChannelType,
  PlannerAssumptions,
  PlannerPlanMetadata,
  RequiredProductionHandlingModel,
} from './types'
import { CHANNEL_LABELS, CHANNEL_VOLUME_LABELS } from './types'
import { isFteBillingPlan } from '../utils/staffingCapacity/billingModel'
import { evaluateFormulaOrFallback, formulaScopeFromPlan, type FormulaScope } from './formulas/formulaRegistry'

export type { RequiredProductionHandlingModel }

export const REQUIRED_PRODUCTION_HANDLING_LABELS: Record<RequiredProductionHandlingModel, string> = {
  dedicated_agents: 'Dedicated Agents',
  dedicated_time_blocks: 'Dedicated Time Blocks',
  blended_agents: 'Blended Agents (one channel at a time)',
  simultaneous_handling: 'Simultaneous Handling (Shared Capacity)',
}

export type RequiredProductionDriverField = ChannelDriverField & {
  optional?: boolean
  /** Percent-like field that accepts 85 or 0.85. */
  percent?: boolean
}

export type RequiredProductionFteChannelResult = ChannelStaffingResult & {
  formulaLabel: string
  methodSummary: string
  /** Required Production FTE before shrinkage (productive staffing). */
  requiredProductionFte: number | null
  /** Paid FTE = Required Production FTE / (1 − Shrinkage). */
  paidFte: number | null
  /** Whole-agent ceiling of Required Production FTE. */
  requiredAgentsCeiling: number | null
  incomplete: boolean
  incompleteMessage: string | null
}

export type RequiredProductionFteBreakdown = {
  byChannel: RequiredProductionFteChannelResult[]
  totalRequiredFte: number | null
  totalPaidFte: number | null
  totalRequiredAgentsCeiling: number | null
  handlingModel: RequiredProductionHandlingModel
  handlingModelLabel: string
  combinationFormula: string
  validationIssues: ChannelDriverValidationIssue[]
  incomplete: boolean
  incompleteMessage: string | null
  isVoiceOnly: boolean
}

/** Accept `85` or `0.85` and normalize to a 0–1 rate. Values in (1, 100] are treated as percents. */
export function normalizePercentInput(value: number): number {
  if (!Number.isFinite(value)) return value
  if (value > 1 && value <= 100) return value / 100
  return value
}

export function ceilingAgents(requiredFte: number | null | undefined): number | null {
  if (requiredFte == null || !Number.isFinite(requiredFte) || requiredFte < 0) return null
  return Math.ceil(requiredFte)
}

export function paidFteFromRequired(
  requiredProductionFte: number,
  shrinkagePct: number,
  scope?: FormulaScope,
): number | null {
  if (!Number.isFinite(requiredProductionFte) || requiredProductionFte < 0) return null
  const shrink = normalizePercentInput(shrinkagePct)
  if (!Number.isFinite(shrink) || shrink < 0 || shrink >= 1) return null
  const fallback = requiredProductionFte / (1 - shrink)
  const paid = evaluateFormulaOrFallback(
    'capacity.paidFte',
    { requiredProductionFte, shrinkage: shrink },
    fallback,
    scope,
  )
  return Number.isFinite(paid) && paid >= 0 ? paid : null
}

function safeDivide(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null
  if (denominator <= 0) return null
  if (numerator < 0) return null
  const result = numerator / denominator
  if (!Number.isFinite(result) || result < 0) return null
  return result
}

function ahtLabel(channel: ChannelType): string {
  if (channel === 'backOffice') return 'Processing Time (sec)'
  if (channel === 'video') return 'Video AHT / Session Duration (sec)'
  if (channel === 'email' || channel === 'sms' || channel === 'social') {
    return `${CHANNEL_LABELS[channel]} AHT (sec)`
  }
  if (channel === 'chat') return 'Chat AHT (sec)'
  return 'Average Handle Time (sec)'
}

function usesConcurrency(channel: ChannelType, assumptions: ChannelAssumptions): boolean {
  if (channel === 'chat' || channel === 'sms') return true
  if (channel === 'social') return (assumptions.socialWorkloadMode ?? 'direct_messages') === 'direct_messages'
  return false
}

/** Available productive seconds: interval length, or weekly paid hours × 3600. */
export function availableProductiveSeconds(assumptions: ChannelAssumptions): number | null {
  const interval = assumptions.intervalSeconds
  if (interval != null && Number.isFinite(interval) && interval > 0) return interval
  const paid = assumptions.paidHoursPerFte
  if (paid != null && Number.isFinite(paid) && paid > 0) return paid * 3600
  return null
}

export function adjustedEmailVolume(assumptions: ChannelAssumptions, baseVolume: number): number {
  const opening = Math.max(0, assumptions.backlogVolume ?? 0)
  const reduction = Math.max(0, assumptions.targetBacklogReduction ?? 0)
  return Math.max(0, baseVolume) + opening + reduction
}

export function adjustedBackOfficeVolume(assumptions: ChannelAssumptions, baseVolume: number): number {
  const opening = Math.max(0, assumptions.backlogVolume ?? 0)
  const reduction = Math.max(0, assumptions.targetBacklogReduction ?? 0)
  const rework = normalizePercentInput(assumptions.reworkPct ?? 0)
  const safeRework = Number.isFinite(rework) && rework >= 0 ? Math.min(rework, 5) : 0
  const core = Math.max(0, baseVolume) + opening + reduction
  return core * (1 + safeRework)
}

export function adjustedMessagingVolume(assumptions: ChannelAssumptions, baseVolume: number): number {
  const reopen = normalizePercentInput(assumptions.reopenRate ?? 0)
  const safeReopen = Number.isFinite(reopen) && reopen >= 0 ? Math.min(reopen, 5) : 0
  const carryover = Math.max(0, assumptions.carryoverWorkload ?? 0)
  return Math.max(0, baseVolume) * (1 + safeReopen) + carryover
}

function occupancyRate(assumptions: ChannelAssumptions): number | null {
  const raw = assumptions.occupancyTarget
  if (raw == null || !Number.isFinite(raw)) return null
  const occ = normalizePercentInput(raw)
  if (occ <= 0 || occ > 1) return null
  return occ
}

function concurrencyRate(assumptions: ChannelAssumptions): number | null {
  const raw = assumptions.chatConcurrency
  if (raw == null || !Number.isFinite(raw) || raw < 1) return null
  return raw
}

/**
 * Core Required Production FTE (productive staffing, before shrinkage).
 * Weekly: (Volume × AHT) / (Productive Seconds × Occupancy [× Concurrency])
 * Interval: (Volume × AHT) / (Interval Seconds × Occupancy [× Concurrency])
 */
export function calculateWorkloadRequiredProductionFte(options: {
  volume: number
  ahtSeconds: number
  productiveSeconds: number
  occupancy: number
  concurrency?: number
}): number | null {
  const { volume, ahtSeconds, productiveSeconds, occupancy } = options
  const concurrency = options.concurrency ?? 1
  if (volume < 0 || ahtSeconds <= 0 || productiveSeconds <= 0 || occupancy <= 0 || occupancy > 1 || concurrency < 1) {
    return null
  }
  if (!Number.isFinite(volume) || !Number.isFinite(ahtSeconds)) return null
  return safeDivide(volume * ahtSeconds, productiveSeconds * occupancy * concurrency)
}

function incompleteResult(
  channel: ChannelType,
  forecastVolume: number,
  message: string,
  formulaLabel: string,
  methodSummary: string,
): RequiredProductionFteChannelResult {
  return {
    channel,
    forecastVolume,
    workloadHours: 0,
    productiveHoursPerFte: 0,
    requiredFte: 0,
    requiredHeadcount: 0,
    channelMixPct: 0,
    formulaLabel,
    methodSummary,
    requiredProductionFte: null,
    paidFte: null,
    requiredAgentsCeiling: null,
    incomplete: true,
    incompleteMessage: message,
  }
}

function completeResult(
  channel: ChannelType,
  assumptions: ChannelAssumptions,
  forecastVolume: number,
  requiredProductionFte: number,
  formulaLabel: string,
  methodSummary: string,
  productiveSeconds: number,
  scope?: FormulaScope,
): RequiredProductionFteChannelResult {
  const workloadHours = (forecastVolume * assumptions.ahtSeconds) / 3600
  const productiveHoursPerFte = productiveSeconds / 3600
  const paidFte = paidFteFromRequired(requiredProductionFte, assumptions.shrinkagePct, scope)
  return {
    channel,
    forecastVolume,
    workloadHours,
    productiveHoursPerFte,
    requiredFte: requiredProductionFte,
    requiredHeadcount: paidFte ?? requiredProductionFte,
    channelMixPct: assumptions.channelMixPct,
    formulaLabel,
    methodSummary,
    requiredProductionFte,
    paidFte,
    requiredAgentsCeiling: ceilingAgents(requiredProductionFte),
    incomplete: false,
    incompleteMessage: null,
  }
}

/** Required + optional driver fields for Required Production FTE (Capacity page). */
export function getRequiredProductionDriverFields(channel: ChannelType): RequiredProductionDriverField[] {
  if (channel === 'voice') {
    return [
      { field: 'forecastVolume', label: CHANNEL_VOLUME_LABELS.voice },
      { field: 'ahtSeconds', label: ahtLabel('voice') },
      { field: 'occupancyTarget', label: 'Occupancy', percent: true },
      { field: 'paidHoursPerFte', label: 'Productive Hours per FTE' },
      { field: 'intervalSeconds', label: 'Interval Length (sec)', optional: true },
      { field: 'shrinkagePct', label: 'Shrinkage (for Paid FTE)', percent: true, optional: true },
    ]
  }
  if (channel === 'chat') {
    return [
      { field: 'forecastVolume', label: 'Chat Volume' },
      { field: 'ahtSeconds', label: 'Chat AHT (sec)' },
      { field: 'chatConcurrency', label: 'Average Concurrency' },
      { field: 'occupancyTarget', label: 'Chat Occupancy', percent: true },
      { field: 'paidHoursPerFte', label: 'Productive Hours per FTE' },
      { field: 'intervalSeconds', label: 'Interval Length (sec)', optional: true },
      { field: 'shrinkagePct', label: 'Shrinkage (for Paid FTE)', percent: true, optional: true },
    ]
  }
  if (channel === 'sms') {
    return [
      { field: 'forecastVolume', label: 'Message Volume' },
      { field: 'ahtSeconds', label: 'Message AHT (sec)' },
      { field: 'chatConcurrency', label: 'Messaging Concurrency' },
      { field: 'occupancyTarget', label: 'Occupancy', percent: true },
      { field: 'paidHoursPerFte', label: 'Productive Hours per FTE' },
      { field: 'intervalSeconds', label: 'Interval Length (sec)', optional: true },
      { field: 'reopenRate', label: 'Reopen Rate', percent: true, optional: true },
      { field: 'carryoverWorkload', label: 'Carryover Workload', optional: true },
      { field: 'responseTimeTargetSeconds', label: 'Response-Time Target (sec)', optional: true },
      { field: 'shrinkagePct', label: 'Shrinkage (for Paid FTE)', percent: true, optional: true },
    ]
  }
  if (channel === 'email') {
    return [
      { field: 'forecastVolume', label: 'Email Volume (new incoming)' },
      { field: 'ahtSeconds', label: 'Email AHT (sec)' },
      { field: 'occupancyTarget', label: 'Occupancy', percent: true },
      { field: 'paidHoursPerFte', label: 'Productive Hours per FTE' },
      { field: 'backlogVolume', label: 'Opening Backlog', optional: true },
      { field: 'targetBacklogReduction', label: 'Target Backlog Reduction', optional: true },
      { field: 'responseTimeTargetSeconds', label: 'Response-Time Target (sec)', optional: true },
      { field: 'completionWindowSeconds', label: 'Completion Window (sec)', optional: true },
      { field: 'shrinkagePct', label: 'Shrinkage (for Paid FTE)', percent: true, optional: true },
    ]
  }
  if (channel === 'backOffice') {
    return [
      { field: 'forecastVolume', label: 'Transaction Volume' },
      { field: 'ahtSeconds', label: 'Processing Time (sec)' },
      { field: 'occupancyTarget', label: 'Occupancy', percent: true },
      { field: 'paidHoursPerFte', label: 'Productive Hours per FTE' },
      { field: 'backlogVolume', label: 'Opening Backlog', optional: true },
      { field: 'targetBacklogReduction', label: 'Target Backlog Reduction', optional: true },
      { field: 'reworkPct', label: 'Rework %', percent: true, optional: true },
      { field: 'turnaroundTimeTargetSeconds', label: 'Turnaround-Time Target (sec)', optional: true },
      { field: 'completionWindowSeconds', label: 'Due-Date Window (sec)', optional: true },
      { field: 'shrinkagePct', label: 'Shrinkage (for Paid FTE)', percent: true, optional: true },
    ]
  }
  if (channel === 'social') {
    return [
      { field: 'forecastVolume', label: 'Social Volume' },
      { field: 'ahtSeconds', label: 'Handling Time (sec)' },
      { field: 'occupancyTarget', label: 'Occupancy', percent: true },
      { field: 'paidHoursPerFte', label: 'Productive Hours per FTE' },
      { field: 'intervalSeconds', label: 'Interval Length (sec)', optional: true },
      { field: 'chatConcurrency', label: 'Concurrency (Direct Messages)' },
      { field: 'shrinkagePct', label: 'Shrinkage (for Paid FTE)', percent: true, optional: true },
    ]
  }
  if (channel === 'video') {
    return [
      { field: 'forecastVolume', label: 'Video Volume' },
      { field: 'ahtSeconds', label: 'Video AHT / Session Duration (sec)' },
      { field: 'occupancyTarget', label: 'Occupancy', percent: true },
      { field: 'paidHoursPerFte', label: 'Productive Hours per FTE' },
      { field: 'intervalSeconds', label: 'Interval Length (sec)', optional: true },
      { field: 'appointmentMode', label: 'Appointment Mode (1 = yes)', optional: true },
      { field: 'peakConcurrentAppointments', label: 'Peak Concurrent Appointments', optional: true },
      { field: 'bufferFte', label: 'Buffer FTE', optional: true },
      { field: 'bufferPct', label: 'Buffer %', percent: true, optional: true },
      { field: 'shrinkagePct', label: 'Shrinkage (for Paid FTE)', percent: true, optional: true },
    ]
  }
  return [
    { field: 'forecastVolume', label: CHANNEL_VOLUME_LABELS[channel] },
    { field: 'ahtSeconds', label: ahtLabel(channel) },
    { field: 'occupancyTarget', label: 'Occupancy', percent: true },
    { field: 'paidHoursPerFte', label: 'Productive Hours per FTE' },
    { field: 'shrinkagePct', label: 'Shrinkage (for Paid FTE)', percent: true, optional: true },
  ]
}

export function getRequiredProductionFormula(channel: ChannelType, assumptions?: ChannelAssumptions): string {
  if (channel === 'voice') {
    return assumptions?.intervalSeconds && assumptions.intervalSeconds > 0
      ? 'Required Production FTE = (Interval Volume × AHT) ÷ (Interval Seconds × Occupancy)'
      : 'Required Production FTE = (Volume × AHT) ÷ (3600 × Productive Hours per FTE × Occupancy)'
  }
  if (channel === 'chat') {
    return assumptions?.intervalSeconds && assumptions.intervalSeconds > 0
      ? 'Required Production FTE = (Chat Volume × Chat AHT) ÷ (Interval Seconds × Concurrency × Occupancy)'
      : 'Required Production FTE = (Chat Volume × Chat AHT) ÷ (3600 × Productive Hours × Concurrency × Occupancy)'
  }
  if (channel === 'sms') {
    return 'Required Production FTE = (Message Volume × Message AHT) ÷ (Productive Seconds × Concurrency × Occupancy)'
  }
  if (channel === 'email') {
    return 'Required Production FTE = (Adjusted Email Volume × Email AHT) ÷ (Productive Seconds × Occupancy) · Adjusted = Opening Backlog + New Volume + Target Backlog Reduction'
  }
  if (channel === 'backOffice') {
    return 'Required Production FTE = (Adjusted Transactions × Processing Time) ÷ (Productive Seconds × Occupancy) · Adjusted = New + Backlog + Rework'
  }
  if (channel === 'social') {
    const mode = assumptions?.socialWorkloadMode ?? 'direct_messages'
    return mode === 'posts_comments_reviews'
      ? 'Required Production FTE = (Volume × Handling Time) ÷ (Productive Seconds × Occupancy)'
      : 'Required Production FTE = (Volume × AHT) ÷ (Interval/Productive Seconds × Concurrency × Occupancy)'
  }
  if (channel === 'video') {
    if (assumptions?.appointmentMode === 1) {
      return 'Required Production FTE = Peak Concurrent Appointments + Buffer FTE (or Peak × Buffer %)'
    }
    return 'Required Production FTE = (Video Volume × Video AHT) ÷ (Productive Seconds × Occupancy)'
  }
  return 'Required Production FTE = (Volume × AHT) ÷ (Productive Seconds × Occupancy)'
}

function validateChannelDriversForCalc(
  channel: ChannelType,
  assumptions: ChannelAssumptions,
): string | null {
  if (assumptions.forecastVolume == null || !Number.isFinite(assumptions.forecastVolume) || assumptions.forecastVolume < 0) {
    return 'Volume must be zero or greater.'
  }
  if (channel === 'video' && assumptions.appointmentMode === 1) {
    if (
      assumptions.peakConcurrentAppointments == null ||
      !Number.isFinite(assumptions.peakConcurrentAppointments) ||
      assumptions.peakConcurrentAppointments < 0
    ) {
      return 'Peak concurrent appointments is required for appointment mode.'
    }
    return null
  }
  if (assumptions.ahtSeconds == null || !Number.isFinite(assumptions.ahtSeconds) || assumptions.ahtSeconds <= 0) {
    return `${ahtLabel(channel)} must be greater than zero.`
  }
  const occ = occupancyRate(assumptions)
  if (occ == null) {
    return 'Occupancy must be greater than 0% and no more than 100%.'
  }
  if (usesConcurrency(channel, assumptions)) {
    if (concurrencyRate(assumptions) == null) {
      return 'Concurrency must be at least 1.'
    }
  }
  if (availableProductiveSeconds(assumptions) == null) {
    return 'Productive hours per FTE or interval seconds must be greater than zero.'
  }
  const shrink = assumptions.shrinkagePct
  if (shrink != null && Number.isFinite(shrink)) {
    const normalized = normalizePercentInput(shrink)
    if (normalized < 0 || normalized >= 1) {
      return 'Shrinkage must be at least 0% and less than 100%.'
    }
  }
  return null
}

export function calculateRequiredProductionFteForChannel(
  channel: ChannelType,
  assumptions: ChannelAssumptions,
  forecastVolumeOverride?: number,
  scope?: FormulaScope,
): RequiredProductionFteChannelResult {
  const formulaLabel = getRequiredProductionFormula(channel, assumptions)
  const methodSummary = `${CHANNEL_LABELS[channel]} required production methodology`
  const baseVolume = forecastVolumeOverride ?? assumptions.forecastVolume

  const validationMessage = validateChannelDriversForCalc(channel, {
    ...assumptions,
    forecastVolume: baseVolume,
  })
  if (validationMessage) {
    return incompleteResult(channel, Math.max(0, baseVolume || 0), validationMessage, formulaLabel, methodSummary)
  }

  // Video appointment mode: Peak Concurrent + Buffer (no shrinkage inside Required Production).
  if (channel === 'video' && assumptions.appointmentMode === 1) {
    const peak = Math.max(0, assumptions.peakConcurrentAppointments ?? 0)
    const bufferAbs = Math.max(0, assumptions.bufferFte ?? 0)
    const bufferPct = normalizePercentInput(assumptions.bufferPct ?? 0)
    const bufferFromPct = Number.isFinite(bufferPct) && bufferPct > 0 ? peak * bufferPct : 0
    const required = peak + (bufferAbs > 0 ? bufferAbs : bufferFromPct)
    if (!Number.isFinite(required) || required < 0) {
      return incompleteResult(channel, baseVolume, 'Unable to calculate appointment Required Production FTE.', formulaLabel, methodSummary)
    }
    return completeResult(
      channel,
      assumptions,
      baseVolume,
      required,
      formulaLabel,
      'Video appointment staffing (peak + buffer)',
      availableProductiveSeconds(assumptions) ?? assumptions.paidHoursPerFte * 3600,
      scope,
    )
  }

  let volume = Math.max(0, baseVolume)
  if (channel === 'email') volume = adjustedEmailVolume(assumptions, volume)
  else if (channel === 'backOffice') volume = adjustedBackOfficeVolume(assumptions, volume)
  else if (channel === 'sms') volume = adjustedMessagingVolume(assumptions, volume)

  if (volume === 0) {
    return completeResult(
      channel,
      assumptions,
      0,
      0,
      formulaLabel,
      methodSummary,
      availableProductiveSeconds(assumptions)!,
      scope,
    )
  }

  const productiveSeconds = availableProductiveSeconds(assumptions)!
  const occupancy = occupancyRate(assumptions)!
  const concurrency = usesConcurrency(channel, assumptions) ? concurrencyRate(assumptions)! : 1

  const required = calculateWorkloadRequiredProductionFte({
    volume,
    ahtSeconds: assumptions.ahtSeconds,
    productiveSeconds,
    occupancy,
    concurrency,
  })

  if (required == null) {
    return incompleteResult(
      channel,
      volume,
      'Unable to calculate Required Production FTE from the current inputs.',
      formulaLabel,
      methodSummary,
    )
  }

  return completeResult(channel, assumptions, volume, required, formulaLabel, methodSummary, productiveSeconds, scope)
}

function isValidRequiredProductionValue(
  field: keyof ChannelAssumptions,
  value: number | undefined,
  optional: boolean,
  channel: ChannelType,
  assumptions?: ChannelAssumptions,
): boolean {
  if (optional) {
    if (value == null || !Number.isFinite(value)) return true
  }
  if (value == null || !Number.isFinite(value)) return false
  switch (field) {
    case 'forecastVolume':
    case 'backlogVolume':
    case 'targetBacklogReduction':
    case 'carryoverWorkload':
    case 'peakConcurrentAppointments':
    case 'bufferFte':
      return value >= 0
    case 'ahtSeconds':
    case 'paidHoursPerFte':
    case 'intervalSeconds':
    case 'targetAnswerSeconds':
    case 'responseTimeTargetSeconds':
    case 'turnaroundTimeTargetSeconds':
    case 'completionWindowSeconds':
      return value > 0
    case 'occupancyTarget':
    case 'slaTargetPct': {
      const occ = normalizePercentInput(value)
      return occ > 0 && occ <= 1
    }
    case 'shrinkagePct':
    case 'reopenRate':
    case 'reworkPct':
    case 'bufferPct': {
      const rate = normalizePercentInput(value)
      return rate >= 0 && rate < 1
    }
    case 'chatConcurrency':
      if (channel === 'social' && assumptions?.socialWorkloadMode === 'posts_comments_reviews') return true
      return value >= 1
    case 'appointmentMode':
      return value === 0 || value === 1
    default:
      return true
  }
}

export function validateRequiredProductionDrivers(
  channels: Partial<Record<ChannelType, ChannelAssumptions>>,
  supported: ChannelType[],
  options?: { billingType?: string },
): ChannelDriverValidationIssue[] {
  const fteBilling = options?.billingType ? isFteBillingPlan(options.billingType) : false
  const issues: ChannelDriverValidationIssue[] = []
  for (const channel of supported) {
    const assumptions = channels[channel]
    for (const driver of getRequiredProductionDriverFields(channel)) {
      if (fteBilling && (driver.field === 'forecastVolume' || driver.field === 'ahtSeconds')) continue
      if (fteBilling && (driver.field === 'occupancyTarget' || driver.field === 'productivityPct')) continue
      if (driver.field === 'chatConcurrency' && channel === 'social' && assumptions?.socialWorkloadMode === 'posts_comments_reviews') {
        continue
      }
      if (driver.field === 'peakConcurrentAppointments' && assumptions?.appointmentMode !== 1) continue
      if ((driver.field === 'bufferFte' || driver.field === 'bufferPct') && assumptions?.appointmentMode !== 1) continue
      const raw = assumptions?.[driver.field]
      const value = typeof raw === 'number' ? raw : undefined
      if (!isValidRequiredProductionValue(driver.field, value, Boolean(driver.optional), channel, assumptions)) {
        issues.push({ channel, field: driver.field, label: driver.label })
      }
    }
  }
  return issues
}

export function getRequiredProductionHandlingModel(
  plan: PlannerPlanMetadata,
): RequiredProductionHandlingModel {
  return plan.requiredProductionHandlingModel ?? 'dedicated_agents'
}

export function combineRequiredProductionFteTotal(
  byChannel: RequiredProductionFteChannelResult[],
  model: RequiredProductionHandlingModel,
  plan: PlannerPlanMetadata,
): { total: number | null; incompleteMessage: string | null } {
  if (byChannel.some((row) => row.incomplete || row.requiredProductionFte == null)) {
    return { total: null, incompleteMessage: 'Complete all channel inputs before combining Required Production FTE.' }
  }

  const values = byChannel.map((row) => row.requiredProductionFte!)
  const sum = values.reduce((total, value) => total + value, 0)

  if (model === 'dedicated_agents' || model === 'dedicated_time_blocks' || byChannel.length <= 1) {
    return { total: sum, incompleteMessage: null }
  }

  if (model === 'blended_agents') {
    const efficiencyRaw = plan.blendingEfficiency
    if (efficiencyRaw == null || !Number.isFinite(efficiencyRaw)) {
      return {
        total: null,
        incompleteMessage: 'Enter blending efficiency for blended agents (do not leave blank — no default is applied).',
      }
    }
    const efficiency = normalizePercentInput(efficiencyRaw)
    if (efficiency < 0 || efficiency >= 1) {
      return { total: null, incompleteMessage: 'Blending efficiency must be at least 0% and less than 100%.' }
    }
    const combined = sum * (1 - efficiency)
    return Number.isFinite(combined) && combined >= 0
      ? { total: combined, incompleteMessage: null }
      : { total: null, incompleteMessage: 'Invalid blended Required Production FTE result.' }
  }

  // simultaneous_handling
  const primaryId = plan.requiredProductionPrimaryChannel ?? byChannel[0]?.channel
  const primary = byChannel.find((row) => row.channel === primaryId) ?? byChannel[0]
  const secondary = byChannel.filter((row) => row.channel !== primary.channel)
  if (!primary || primary.requiredProductionFte == null) {
    return { total: null, incompleteMessage: 'Select a primary channel for simultaneous handling.' }
  }

  const idleRaw = plan.idleCapacityPct
  const shareRaw = plan.sharedCapacityFactor
  if (idleRaw == null || !Number.isFinite(idleRaw) || shareRaw == null || !Number.isFinite(shareRaw)) {
    return {
      total: null,
      incompleteMessage: 'Enter idle capacity % and shared capacity factor for simultaneous handling (no silent defaults).',
    }
  }
  const idle = normalizePercentInput(idleRaw)
  const share = normalizePercentInput(shareRaw)
  if (idle < 0 || idle > 1 || share < 0 || share > 1) {
    return { total: null, incompleteMessage: 'Idle capacity % and shared capacity factor must be between 0% and 100%.' }
  }

  const usableShared = primary.requiredProductionFte * idle * share
  const secondaryTotal = secondary.reduce((total, row) => total + (row.requiredProductionFte ?? 0), 0)
  const combined = primary.requiredProductionFte + Math.max(0, secondaryTotal - usableShared)
  return Number.isFinite(combined) && combined >= 0
    ? { total: combined, incompleteMessage: null }
    : { total: null, incompleteMessage: 'Invalid simultaneous Required Production FTE result.' }
}

export function getCombinationFormula(model: RequiredProductionHandlingModel): string {
  if (model === 'simultaneous_handling') {
    return 'Combined = Primary Channel FTE + MAX(0, Secondary FTE − (Primary FTE × Idle Capacity % × Shared Capacity Factor))'
  }
  if (model === 'blended_agents') {
    return 'Combined = Σ(Channel Required Production FTE) × (1 − Blending Efficiency) — efficiency must be entered'
  }
  if (model === 'dedicated_time_blocks') {
    return 'Combined = Σ(Channel Required Production FTE) — non-overlapping dedicated time blocks'
  }
  return 'Combined = Σ(Channel Required Production FTE) — dedicated agents per channel'
}

export function buildRequiredProductionFteBreakdown(
  assumptions: PlannerAssumptions,
  plan: PlannerPlanMetadata,
  volumeScale = 1,
): RequiredProductionFteBreakdown {
  const supported = getSupportedChannels(plan)
  const channelAssumptions = resolveChannelAssumptions(assumptions, plan)
  const handlingModel = getRequiredProductionHandlingModel(plan)
  const formulaScope = formulaScopeFromPlan(plan)
  const validationIssues = validateRequiredProductionDrivers(
    assumptions.channels ?? channelAssumptions,
    supported,
    { billingType: plan.billingType },
  )
  const isVoiceOnly = supported.length === 1 && supported[0] === 'voice'

  const byChannel = supported.map((channel) => {
    const channelAssumption = channelAssumptions[channel]
    const scaledVolume = Math.round(channelAssumption.forecastVolume * volumeScale)
    return calculateRequiredProductionFteForChannel(channel, channelAssumption, scaledVolume, formulaScope)
  })

  const combined = combineRequiredProductionFteTotal(byChannel, handlingModel, plan)
  const incomplete =
    Boolean(combined.incompleteMessage) || byChannel.some((row) => row.incomplete) || validationIssues.length > 0

  const totalRequiredFte = incomplete ? null : combined.total
  let totalPaidFte: number | null = null
  if (totalRequiredFte != null && supported.length === 1) {
    totalPaidFte = byChannel[0]?.paidFte ?? null
  } else if (totalRequiredFte != null && supported.length > 1) {
    // Weighted shrinkage across channels for combined paid FTE display.
    const shrinkValues = supported.map((channel) => normalizePercentInput(channelAssumptions[channel].shrinkagePct ?? 0))
    const avgShrink =
      shrinkValues.length > 0 ? shrinkValues.reduce((sum, value) => sum + value, 0) / shrinkValues.length : 0
    totalPaidFte = paidFteFromRequired(totalRequiredFte, avgShrink, formulaScope)
  }

  return {
    byChannel,
    totalRequiredFte,
    totalPaidFte,
    totalRequiredAgentsCeiling: ceilingAgents(totalRequiredFte),
    handlingModel,
    handlingModelLabel: REQUIRED_PRODUCTION_HANDLING_LABELS[handlingModel],
    combinationFormula: getCombinationFormula(handlingModel),
    validationIssues,
    incomplete,
    incompleteMessage:
      combined.incompleteMessage ??
      (validationIssues.length
        ? 'Complete all required inputs to calculate Required Production FTE.'
        : byChannel.find((row) => row.incompleteMessage)?.incompleteMessage ?? null),
    isVoiceOnly,
  }
}

/** Weekly matrix drivers that override channel setup for that week’s Required Production FTE. */
export type WeeklyRequiredProductionDrivers = {
  volume?: number | null
  ahtSeconds?: number | null
  occupancy?: number | null
  cappedAhtSeconds?: number | null
}

function effectiveWeeklyAhtSeconds(drivers?: WeeklyRequiredProductionDrivers): number | null {
  if (!drivers) return null
  const aht = drivers.ahtSeconds
  if (aht == null || !Number.isFinite(aht) || aht <= 0) return null
  const cap = drivers.cappedAhtSeconds
  if (cap != null && Number.isFinite(cap) && cap > 0) return Math.min(aht, cap)
  return aht
}

function effectiveWeeklyOccupancy(drivers?: WeeklyRequiredProductionDrivers): number | null {
  if (drivers?.occupancy == null || !Number.isFinite(drivers.occupancy)) return null
  const occ = normalizePercentInput(drivers.occupancy)
  if (occ <= 0 || occ > 1) return null
  return occ
}

/**
 * Overlay capacity-matrix week drivers onto channel assumptions so Required Production FTE
 * follows that week’s Volume, AHT/processing time, and Occupancy (concurrency stays channel-configured).
 */
export function assumptionsWithWeeklyRequiredProductionDrivers(
  assumptions: PlannerAssumptions,
  plan: PlannerPlanMetadata,
  weeklyDrivers?: WeeklyRequiredProductionDrivers,
): PlannerAssumptions {
  const supported = getSupportedChannels(plan)
  if (!supported.length) return assumptions

  const channelAssumptions = resolveChannelAssumptions(assumptions, plan)
  const weeklyAht = effectiveWeeklyAhtSeconds(weeklyDrivers)
  const weeklyOcc = effectiveWeeklyOccupancy(weeklyDrivers)
  const paidFallback =
    assumptions.tenured.productiveHoursPerFtePerWeek > 0
      ? assumptions.tenured.productiveHoursPerFtePerWeek
      : assumptions.tenured.standardScheduledHoursPerWeek > 0
        ? assumptions.tenured.standardScheduledHoursPerWeek
        : 40
  const ahtFallback = assumptions.tenured.ahtSeconds > 0 ? assumptions.tenured.ahtSeconds : null
  const occFallback =
    assumptions.tenured.occupancyTarget > 0 ? normalizePercentInput(assumptions.tenured.occupancyTarget) : null

  const nextChannels: Partial<Record<ChannelType, ChannelAssumptions>> = { ...(assumptions.channels ?? {}) }
  for (const channel of supported) {
    const base = channelAssumptions[channel]
    const concurrency =
      usesConcurrency(channel, base) && !(base.chatConcurrency >= 1)
        ? channel === 'chat'
          ? 2.5
          : 1
        : base.chatConcurrency
    const resolvedAht = weeklyAht ?? (base.ahtSeconds > 0 ? base.ahtSeconds : ahtFallback)
    const resolvedOcc = weeklyOcc ?? (base.occupancyTarget > 0 ? base.occupancyTarget : occFallback)
    nextChannels[channel] = {
      ...base,
      ahtSeconds: resolvedAht != null && resolvedAht > 0 ? resolvedAht : base.ahtSeconds,
      occupancyTarget: resolvedOcc != null && resolvedOcc > 0 ? resolvedOcc : base.occupancyTarget,
      paidHoursPerFte: base.paidHoursPerFte > 0 ? base.paidHoursPerFte : paidFallback,
      chatConcurrency: concurrency,
    }
  }

  return {
    ...assumptions,
    channels: nextChannels,
  }
}

/**
 * Resolve weekly Required Production FTE for the capacity matrix.
 * Uses channel formulas (Voice / Chat concurrency / Processing Time / backlog) with that week’s
 * Volume, AHT, and Occupancy from the matrix when provided.
 */
export function resolveRequiredProductionFteForPlan(
  assumptions: PlannerAssumptions,
  plan: PlannerPlanMetadata,
  weeklyVolume?: number | null,
  weeklyDrivers?: WeeklyRequiredProductionDrivers,
): number | null {
  if (!shouldUseChannelRequiredFte(plan, assumptions)) return null
  if (isFteBillingPlan(plan.billingType)) return null

  const volume = weeklyDrivers?.volume ?? weeklyVolume
  if (volume != null && volume <= 0) return 0

  const patched = assumptionsWithWeeklyRequiredProductionDrivers(assumptions, plan, {
    ...weeklyDrivers,
    volume,
  })
  const supported = getSupportedChannels(plan)
  if (!supported.length) return null
  const channelAssumptions = resolveChannelAssumptions(patched, plan)
  const totalForecast = supported.reduce((sum, channel) => sum + Math.max(0, channelAssumptions[channel].forecastVolume), 0)

  // Always map this week’s matrix volume onto channels so Required FTE follows the Capacity grid.
  let workingAssumptions = patched
  if (volume != null && volume > 0) {
    const mixTotal = supported.reduce(
      (sum, channel) => sum + Math.max(0, channelAssumptions[channel].channelMixPct),
      0,
    )
    const nextChannels: NonNullable<PlannerAssumptions['channels']> = {
      ...(patched.channels ?? {}),
    }
    for (const channel of supported) {
      const share =
        totalForecast > 0
          ? Math.max(0, channelAssumptions[channel].forecastVolume) / totalForecast
          : mixTotal > 0
            ? Math.max(0, channelAssumptions[channel].channelMixPct) / mixTotal
            : 1 / supported.length
      nextChannels[channel] = {
        ...channelAssumptions[channel],
        forecastVolume: volume * share,
      }
    }
    workingAssumptions = { ...patched, channels: nextChannels }
  }

  const breakdown = buildRequiredProductionFteBreakdown(workingAssumptions, plan, 1)
  if (breakdown.incomplete || breakdown.totalRequiredFte == null) return null
  return breakdown.totalRequiredFte
}

/** Concurrency applied in the simple matrix fallback (Chat / SMS / social DMs). */
export function resolveMatrixConcurrencyFactor(
  plan: PlannerPlanMetadata,
  assumptions: PlannerAssumptions,
): number {
  const supported = getSupportedChannels(plan)
  if (!supported.length) return 1
  const channelAssumptions = resolveChannelAssumptions(assumptions, plan)
  if (supported.length === 1) {
    const channel = supported[0]!
    const row = channelAssumptions[channel]
    if (!usesConcurrency(channel, row)) return 1
    return concurrencyRate(row) ?? 1
  }
  // Multi-channel: volume-weighted concurrency for channels that use it; others contribute 1.
  let weighted = 0
  let weight = 0
  for (const channel of supported) {
    const row = channelAssumptions[channel]
    const vol = Math.max(0, row.forecastVolume)
    const factor = usesConcurrency(channel, row) ? concurrencyRate(row) ?? 1 : 1
    weighted += factor * Math.max(vol, 1)
    weight += Math.max(vol, 1)
  }
  return weight > 0 ? weighted / weight : 1
}

/** True when matrix should skip the simple voice-style volume/AHT/occ fallback. */
export function shouldPreferChannelRequiredFte(
  plan: PlannerPlanMetadata,
  assumptions: PlannerAssumptions,
): boolean {
  if (isFteBillingPlan(plan.billingType)) return false
  return shouldUseChannelRequiredFte(plan, assumptions)
}

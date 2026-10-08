import type { ChannelType, PlannerPlanMetadata } from './types'
import { CHANNEL_LABELS, CHANNEL_TYPES } from './types'

/** Channels stored on the plan — never invent Voice when none are set. */
export function explicitPlanChannels(
  plan: Pick<PlannerPlanMetadata, 'supportedChannels'>,
): ChannelType[] {
  return (plan.supportedChannels ?? []).filter((channel): channel is ChannelType =>
    CHANNEL_TYPES.includes(channel),
  )
}

export function formatPlanChannels(plan: Pick<PlannerPlanMetadata, 'supportedChannels'>): string {
  return explicitPlanChannels(plan)
    .map((channel) => CHANNEL_LABELS[channel])
    .join(' + ')
}

/** Line of business label. Legacy plans stored LOB in `location`. */
export function resolvePlanLob(plan: Pick<PlannerPlanMetadata, 'lob' | 'location'>): string {
  const lob = plan.lob?.trim()
  if (lob) return lob
  return plan.location?.trim() || ''
}

/**
 * Geographic / site location.
 * When `lob` is unset, `location` was historically the LOB name — treat site as empty.
 */
export function resolvePlanLocation(plan: Pick<PlannerPlanMetadata, 'lob' | 'location'>): string {
  if (plan.lob?.trim()) return plan.location?.trim() || ''
  return ''
}

export function planScopeLabel(
  plan: Pick<PlannerPlanMetadata, 'client' | 'lob' | 'location' | 'projectCode' | 'supportedChannels'>,
): string {
  const lob = resolvePlanLob(plan)
  const channel = formatPlanChannels(plan)
  const location = resolvePlanLocation(plan)
  const code = plan.projectCode?.trim()
  const parts = [plan.client, lob, channel, location, code].filter(Boolean)
  return parts.join(' · ')
}

/** Default scenario display name when saving Capacity Settings. */
export function planSettingsScenarioName(
  plan: Pick<PlannerPlanMetadata, 'client' | 'lob' | 'location'>,
): string {
  const client = plan.client?.trim() || 'Unassigned client'
  const lob = resolvePlanLob(plan) || 'Unassigned LOB'
  return `${client} · ${lob}`
}

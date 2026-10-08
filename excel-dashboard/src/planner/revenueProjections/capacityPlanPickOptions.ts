import { explicitPlanChannels, formatPlanChannels, resolvePlanLob, resolvePlanLocation } from '../planIdentity'
import { CHANNEL_TYPES, type ChannelType, type PlannerScenario } from '../types'
import { canonicalBillingType, type CanonicalBillingType } from '../../utils/staffingCapacity/billingModel'
import { rateToPctPoints } from './staffingMonthDrivers'

export type CapacityPlanPickOption = {
  scenarioId: string
  client: string
  lob: string
  location: string
  projectCode: string
  projectName: string
  billingType: CanonicalBillingType
  channels: ChannelType[]
  label: string
}

export type CapacityPlanDriverSnapshot = {
  aht: string
  loginHours: string
  occupancyPct: string
  shrinkagePct: string
  absenteeismPct: string
}

export type CapacityPlanPickFilters = {
  client?: string
  location?: string
  lob?: string
  channel?: ChannelType | ''
}

function norm(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase()
}

function uniquePreserve(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out.sort((a, b) => a.localeCompare(b))
}

export function listCapacityPlanPickOptions(scenarios: PlannerScenario[]): CapacityPlanPickOption[] {
  return scenarios
    .filter((scenario) => !scenario.isBaseline)
    .map((scenario) => {
      const lob = resolvePlanLob(scenario.plan)
      const location = resolvePlanLocation(scenario.plan)
      const channels = explicitPlanChannels(scenario.plan)
      const projectCode = scenario.plan.projectCode?.trim() ?? ''
      const projectName = scenario.plan.projectName?.trim() ?? ''
      const client = scenario.plan.client?.trim() ?? ''
      const parts = [client, lob, formatPlanChannels(scenario.plan), location, projectCode].filter(Boolean)
      return {
        scenarioId: scenario.id,
        client,
        lob,
        location,
        projectCode,
        projectName,
        billingType: canonicalBillingType(scenario.plan.billingType ?? ''),
        channels,
        label: parts.join(' · '),
      }
    })
    .filter((pick) => pick.client && pick.lob)
    .sort((a, b) => a.label.localeCompare(b.label))
}

export function filterCapacityPlanPicks(
  picks: CapacityPlanPickOption[],
  filters: CapacityPlanPickFilters = {},
): CapacityPlanPickOption[] {
  const client = norm(filters.client)
  const location = norm(filters.location)
  const lob = norm(filters.lob)
  const channel = filters.channel
  return picks.filter((pick) => {
    if (client && norm(pick.client) !== client) return false
    if (location && norm(pick.location) !== location) return false
    if (lob && norm(pick.lob) !== lob) return false
    if (channel && !pick.channels.includes(channel)) return false
    return true
  })
}

export function uniquePickClients(picks: CapacityPlanPickOption[]): string[] {
  return uniquePreserve(picks.map((pick) => pick.client))
}

export function uniquePickLocations(picks: CapacityPlanPickOption[]): string[] {
  return uniquePreserve(picks.map((pick) => pick.location))
}

export function uniquePickLobs(picks: CapacityPlanPickOption[]): string[] {
  return uniquePreserve(picks.map((pick) => pick.lob))
}

export function uniquePickChannels(picks: CapacityPlanPickOption[]): ChannelType[] {
  const present = new Set<ChannelType>()
  picks.forEach((pick) => pick.channels.forEach((channel) => present.add(channel)))
  return CHANNEL_TYPES.filter((channel) => present.has(channel))
}

export function findCapacityPlanPickForLine(
  picks: CapacityPlanPickOption[],
  line: {
    clientName: string
    lobProjectName: string
    location: string
    projectCode?: string
    channel?: string
  },
): CapacityPlanPickOption | null {
  const client = norm(line.clientName)
  const lob = norm(line.lobProjectName)
  const location = norm(line.location)
  const projectCode = norm(line.projectCode)
  const channel = CHANNEL_TYPES.includes(line.channel as ChannelType) ? (line.channel as ChannelType) : ''

  const scored = picks
    .map((pick) => {
      if (norm(pick.client) !== client) return null
      let score = 10
      if (lob && norm(pick.lob) === lob) score += 40
      if (location && norm(pick.location) === location) score += 25
      if (projectCode && norm(pick.projectCode) === projectCode) score += 20
      if (channel && pick.channels.includes(channel)) score += 15
      if (lob && norm(pick.lob) && norm(pick.lob) !== lob) score -= 30
      return { pick, score }
    })
    .filter((item): item is { pick: CapacityPlanPickOption; score: number } => item != null)
    .sort((a, b) => b.score - a.score)

  if (scored[0] && scored[0].score >= 50) return scored[0].pick
  if (picks.filter((pick) => norm(pick.client) === client).length === 1) {
    return picks.find((pick) => norm(pick.client) === client) ?? null
  }
  return null
}

export function driverSnapshotFromScenario(
  scenario: PlannerScenario,
  channel: ChannelType | '',
): CapacityPlanDriverSnapshot | null {
  const assumptions = channel ? scenario.assumptions?.channels?.[channel] : undefined
  const tenured = scenario.assumptions?.tenured
  if (!assumptions && !tenured) return null

  const occupancyRate = assumptions?.occupancyTarget || tenured?.occupancyTarget || 0
  const shrinkageRate = assumptions?.shrinkagePct || tenured?.shrinkageRate || 0
  const attendance = tenured?.attendanceRate ?? 0
  const aht = assumptions?.ahtSeconds || tenured?.ahtSeconds || 0
  const loginHours = assumptions?.paidHoursPerFte || tenured?.standardScheduledHoursPerWeek || 0

  return {
    aht: aht > 0 ? String(aht) : '',
    loginHours: loginHours > 0 ? String(loginHours) : '',
    occupancyPct: occupancyRate > 0 ? String(rateToPctPoints(occupancyRate <= 1 ? occupancyRate : occupancyRate / 100)) : '',
    shrinkagePct: shrinkageRate > 0 ? String(rateToPctPoints(shrinkageRate <= 1 ? shrinkageRate : shrinkageRate / 100)) : '',
    absenteeismPct:
      attendance > 0 && attendance <= 1 ? String(rateToPctPoints(Math.max(0, 1 - attendance))) : '',
  }
}

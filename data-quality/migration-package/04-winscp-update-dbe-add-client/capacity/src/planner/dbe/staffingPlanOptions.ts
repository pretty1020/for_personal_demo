import { resolvePlanLob, resolvePlanLocation, resolvePlanProjectCode } from '../planIdentity'
import type { PlannerScenario } from '../types'

/**
 * A Client / LOB / Location / Project Code scope that exists on a Staffing Plan.
 *
 * DBE lines are matched back to Staffing Plans by these fields (project code when
 * present), so offering the plan's own spellings as choices is what makes the
 * Absenteeism / Shrinkage / FTE comparison line up instead of silently failing.
 */
export type StaffingPlanOption = {
  client: string
  lob: string
  location: string
  projectCode: string
  scenarioName: string
}

function sameToken(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** Case-insensitive de-dupe that keeps the first spelling seen. */
function dedupe(values: string[]): string[] {
  const seen = new Map<string, string>()
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (!seen.has(key)) seen.set(key, trimmed)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/** Staffing Plan values first, then any DBE-only values, de-duped across both. */
export function mergeOptions(fromPlans: string[], fromDbe: string[]): string[] {
  return dedupe([...fromPlans, ...fromDbe])
}

export function listStaffingPlanOptions(scenarios: PlannerScenario[]): StaffingPlanOption[] {
  return (
    scenarios
      // Baselines are excluded from scenario matching, so they must not be offered here either.
      .filter((scenario) => !scenario.isBaseline)
      .map((scenario) => ({
        client: scenario.plan.client?.trim() ?? '',
        lob: resolvePlanLob(scenario.plan),
        location: resolvePlanLocation(scenario.plan),
        projectCode: resolvePlanProjectCode(scenario.plan),
        scenarioName: scenario.name?.trim() || scenario.plan.client?.trim() || '',
      }))
      .filter((option) => option.client !== '')
  )
}

export function listStaffingClients(options: StaffingPlanOption[]): string[] {
  return dedupe(options.map((option) => option.client))
}

/** Options for the given client; every option when the client is blank or unknown. */
function scopeToClient(options: StaffingPlanOption[], client: string): StaffingPlanOption[] {
  const trimmed = client.trim()
  if (!trimmed) return options
  const scoped = options.filter((option) => sameToken(option.client, trimmed))
  return scoped.length ? scoped : options
}

export function listStaffingLobs(options: StaffingPlanOption[], client: string): string[] {
  return dedupe(scopeToClient(options, client).map((option) => option.lob))
}

export function listStaffingLocations(options: StaffingPlanOption[], client: string): string[] {
  return dedupe(scopeToClient(options, client).map((option) => option.location))
}

/**
 * The single Staffing Plan matching this Client + LOB (+ optional Project Code),
 * or null when there is no match or the pair is ambiguous across several plans.
 */
export function findStaffingPlanOption(
  options: StaffingPlanOption[],
  client: string,
  lob: string,
  projectCode?: string,
): StaffingPlanOption | null {
  if (!client.trim() || !lob.trim()) return null
  let matches = options.filter(
    (option) => sameToken(option.client, client) && sameToken(option.lob, lob),
  )
  const code = projectCode?.trim() ?? ''
  if (code) {
    matches = matches.filter((option) => sameToken(option.projectCode, code))
  }
  return matches.length === 1 ? matches[0]! : null
}

export function listStaffingProjectCodes(
  options: StaffingPlanOption[],
  client: string,
  lob?: string,
): string[] {
  let scoped = scopeToClient(options, client)
  const lobTrim = lob?.trim() ?? ''
  if (lobTrim) {
    scoped = scoped.filter((option) => sameToken(option.lob, lobTrim))
  }
  return dedupe(scoped.map((option) => option.projectCode).filter(Boolean))
}

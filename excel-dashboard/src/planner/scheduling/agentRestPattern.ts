import type { PatternScheduleMeta } from './patternAnalysis'
import type { GeneratedRequirementDay } from './requirementGeneration'
import { allocateDailyProductionHc } from './dailyHcAllocation'
import type { SchedulingRules } from './types'
import type { RestDayLayout } from './schedulingSettingsTypes'
import { restDayCountFromSettings } from './workingDaysUtils'

export type AgentRestDayMap = Map<number, Set<string>>

function restDaysRequired(rules: SchedulingRules): number {
  return Math.max(0, restDayCountFromSettings(rules.settings))
}

function openDaysForRest(
  weekDates: string[],
  patternMeta: PatternScheduleMeta,
): string[] {
  const open = new Set(
    patternMeta.workingDays.length > 0 ? patternMeta.workingDays : weekDates,
  )
  return weekDates.filter((day) => open.has(day))
}

/** All consecutive rest windows of length `restCount` on the open-day ring (calendar order). */
function consecutiveRestWindows(openDays: string[], restCount: number): string[][] {
  if (restCount <= 0 || !openDays.length) return []
  if (restCount >= openDays.length) return [[...openDays]]
  const windows: string[][] = []
  for (let start = 0; start < openDays.length; start += 1) {
    const window: string[] = []
    for (let offset = 0; offset < restCount; offset += 1) {
      window.push(openDays[(start + offset) % openDays.length]!)
    }
    windows.push(window)
  }
  return windows
}

function assignConsecutiveRestForAgent(
  agentIndex: number,
  restCount: number,
  openDays: string[],
): Set<string> {
  const windows = consecutiveRestWindows(openDays, restCount)
  if (!windows.length) return new Set()
  return new Set(windows[agentIndex % windows.length]!)
}

function assignScatteredRestForAgent(
  agentIndex: number,
  restCount: number,
  openDays: string[],
  dayWeights: Record<string, number>,
): Set<string> {
  if (restCount <= 0 || !openDays.length) return new Set()

  const ranked = [...openDays].sort((a, b) => {
    const weightDiff = (dayWeights[a] ?? 0) - (dayWeights[b] ?? 0)
    if (weightDiff !== 0) return weightDiff
    return (
      ((openDays.indexOf(a) + agentIndex) % openDays.length) -
      ((openDays.indexOf(b) + agentIndex) % openDays.length)
    )
  })

  const rest = new Set<string>()
  for (const day of ranked) {
    if (rest.size >= restCount) break
    rest.add(day)
  }
  return rest
}

/** Scattered rest balanced so daily working HC tracks requirement-shaped targets. */
function balanceScatteredRestToDailyTargets(
  productionHc: number,
  openDays: string[],
  targets: Record<string, number>,
  restCount: number,
): AgentRestDayMap {
  const map: AgentRestDayMap = new Map()
  const working: Record<string, number> = Object.fromEntries(openDays.map((day) => [day, productionHc]))

  for (let agentIndex = 0; agentIndex < productionHc; agentIndex += 1) {
    const rest = new Set<string>()
    for (let slot = 0; slot < restCount; slot += 1) {
      let bestDay = openDays[0]!
      let bestSurplus = Number.NEGATIVE_INFINITY
      for (const day of openDays) {
        if (rest.has(day)) continue
        const surplus = (working[day] ?? 0) - (targets[day] ?? 0)
        const tieBreak = (openDays.indexOf(day) + agentIndex) % openDays.length
        const bestTie = (openDays.indexOf(bestDay) + agentIndex) % openDays.length
        if (surplus > bestSurplus + 0.001 || (Math.abs(surplus - bestSurplus) < 0.001 && tieBreak < bestTie)) {
          bestSurplus = surplus
          bestDay = day
        }
      }
      rest.add(bestDay)
      working[bestDay] = (working[bestDay] ?? 0) - 1
    }
    map.set(agentIndex, rest)
  }

  return map
}

/**
 * Consecutive rest blocks, choosing each agent's window to keep daily HC near targets.
 * Rest days always form one contiguous block on the open-day ring (e.g. Fri–Sat, Sat–Sun).
 */
function balanceConsecutiveRestToDailyTargets(
  productionHc: number,
  openDays: string[],
  targets: Record<string, number>,
  restCount: number,
): AgentRestDayMap {
  const map: AgentRestDayMap = new Map()
  const windows = consecutiveRestWindows(openDays, restCount)
  if (!windows.length) return map

  const working: Record<string, number> = Object.fromEntries(openDays.map((day) => [day, productionHc]))

  for (let agentIndex = 0; agentIndex < productionHc; agentIndex += 1) {
    let bestWindow = windows[agentIndex % windows.length]!
    let bestScore = Number.NEGATIVE_INFINITY
    for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
      const window = windows[windowIndex]!
      let score = 0
      for (const day of window) {
        score += (working[day] ?? 0) - (targets[day] ?? 0)
      }
      // Rotate preference so agents spread across different consecutive blocks.
      score -= ((windowIndex + agentIndex) % windows.length) * 0.001
      if (score > bestScore) {
        bestScore = score
        bestWindow = window
      }
    }
    const rest = new Set(bestWindow)
    for (const day of rest) {
      working[day] = (working[day] ?? 0) - 1
    }
    map.set(agentIndex, rest)
  }

  return map
}

/**
 * Per-agent rest days on open/working days only — capped by settings (default max 2 OFF).
 * Pattern closure days (zero volume) are site-wide; they are not counted as agent rest here.
 */
export function buildAgentRestDayMap(
  productionHc: number,
  weekDates: string[],
  dayWeights: Record<string, number>,
  rules: SchedulingRules,
  patternMeta: PatternScheduleMeta,
  requirementDays?: GeneratedRequirementDay[],
): AgentRestDayMap {
  const restCount = restDaysRequired(rules)
  const openDays = openDaysForRest(weekDates, patternMeta)
  if (restCount <= 0 || !openDays.length) return new Map()

  const layout: RestDayLayout = rules.settings.restDayLayout ?? 'scattered'

  if (requirementDays?.length) {
    const openRequirementDays = requirementDays.filter((day) => openDays.includes(day.day))
    if (openRequirementDays.length) {
      const targets = allocateDailyProductionHc(
        productionHc,
        openRequirementDays,
        rules.settings.fteRequiredDailyDivisorHours,
        rules.settings.scheduleIntervalMinutes,
      )
      const normalizedTargets: Record<string, number> = {}
      for (const day of openDays) normalizedTargets[day] = targets[day] ?? 0
      return layout === 'consecutive'
        ? balanceConsecutiveRestToDailyTargets(productionHc, openDays, normalizedTargets, restCount)
        : balanceScatteredRestToDailyTargets(productionHc, openDays, normalizedTargets, restCount)
    }
  }

  const map: AgentRestDayMap = new Map()

  for (let agentIndex = 0; agentIndex < productionHc; agentIndex += 1) {
    const agentRest =
      layout === 'scattered'
        ? assignScatteredRestForAgent(agentIndex, restCount, openDays, dayWeights)
        : assignConsecutiveRestForAgent(agentIndex, restCount, openDays)
    map.set(agentIndex, agentRest)
  }

  return map
}

export function isAgentScheduledOnDay(restMap: AgentRestDayMap, agentIndex: number, dayIso: string): boolean {
  return !restMap.get(agentIndex)?.has(dayIso)
}

export function agentsWorkingOnDay(
  productionHc: number,
  dayIso: string,
  restMap: AgentRestDayMap,
  cap: number,
): number[] {
  const indices: number[] = []
  for (let agentIndex = 0; agentIndex < productionHc; agentIndex += 1) {
    if (isAgentScheduledOnDay(restMap, agentIndex, dayIso)) {
      indices.push(agentIndex)
    }
  }
  return indices.slice(0, cap)
}

/** All agents available on an open day (respects per-agent rest cap only). */
export function pickAgentsForWorkingDay(
  productionHc: number,
  dayIso: string,
  restMap: AgentRestDayMap,
): number[] {
  return agentsWorkingOnDay(productionHc, dayIso, restMap, productionHc)
}

/** @deprecated Use pickAgentsForWorkingDay — pattern cap caused extra OFF days beyond rest rules. */
export function pickAgentsForDayFromPattern(
  productionHc: number,
  dayIso: string,
  _dayIndex: number,
  restMap: AgentRestDayMap,
  templateCap: number,
  _dayWeight: number,
  _totalWeight: number,
  _restCount: number,
): number[] {
  return agentsWorkingOnDay(productionHc, dayIso, restMap, templateCap)
}

export function countAgentOffDays(restMap: AgentRestDayMap, agentIndex: number): number {
  return restMap.get(agentIndex)?.size ?? 0
}

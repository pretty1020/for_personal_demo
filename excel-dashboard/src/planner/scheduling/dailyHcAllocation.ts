import type { GeneratedRequirementDay } from './requirementGeneration'
import { dailyFteFromAllIntervalHeadcounts } from './fteMetrics'

function dailyWeight(
  day: GeneratedRequirementDay,
  fteDailyDivisorHours: number,
  intervalMinutes: number,
): number {
  return dailyFteFromAllIntervalHeadcounts(day.intervals, fteDailyDivisorHours, intervalMinutes)
}

/** Distribute weekly production HC across days proportional to daily requirement (pattern-shaped). */
export function allocateDailyProductionHc(
  productionHc: number,
  requirementDays: GeneratedRequirementDay[],
  fteDailyDivisorHours = 7.5,
  intervalMinutes = 30,
): Record<string, number> {
  if (!requirementDays.length || productionHc <= 0) return {}

  const weights = requirementDays.map((day) => ({
    day: day.day,
    weight: dailyWeight(day, fteDailyDivisorHours, intervalMinutes),
  }))
  const totalWeight = weights.reduce((sum, row) => sum + row.weight, 0)

  if (totalWeight <= 0) {
    const even = Math.max(1, Math.round(productionHc / weights.length))
    return Object.fromEntries(weights.map((row) => [row.day, even]))
  }

  const exact = weights.map((row) => ({
    day: row.day,
    value: (productionHc * row.weight) / totalWeight,
    floor: Math.floor((productionHc * row.weight) / totalWeight),
  }))

  const allocation: Record<string, number> = {}
  let assigned = 0
  for (const row of exact) {
    allocation[row.day] = row.floor
    assigned += row.floor
  }

  const remainders = exact
    .map((row) => ({ day: row.day, remainder: row.value - row.floor }))
    .sort((a, b) => b.remainder - a.remainder)

  let index = 0
  while (assigned < productionHc && index < remainders.length) {
    allocation[remainders[index]!.day] += 1
    assigned += 1
    index += 1
  }

  while (assigned > productionHc) {
    const richest = Object.entries(allocation).sort((a, b) => b[1] - a[1])[0]
    if (!richest || richest[1] <= 0) break
    allocation[richest[0]] -= 1
    assigned -= 1
  }

  return allocation
}

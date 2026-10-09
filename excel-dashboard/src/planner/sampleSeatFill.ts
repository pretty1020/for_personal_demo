import { scenarioSeatDemand } from './seatScenario'

export type SampleSeatInputs = {
  onsiteHc: number
  wahHc: number
  peakRatioPct: number
  supportHc: number
  seatCount: number
  demand: number
}

/**
 * Sample capacity seats inputs.
 * The seat count is one number for every week, sized for the onsite team
 * after four weeks of attrition. Onsite HC starts higher and falls by one
 * person each week, so the early weeks need more seats. Pass null for the
 * opening week.
 */
export function sampleSeatWeek(productionHc: number, weekIndex: number | null): SampleSeatInputs | null {
  const hc = Math.round(productionHc)
  if (!Number.isFinite(hc) || hc <= 0) return null
  const onsiteStart = Math.round(hc * 0.85)
  const elapsed = weekIndex == null ? 0 : Math.max(0, weekIndex)
  const onsiteHc = Math.max(0, onsiteStart - elapsed)
  const wahHc = Math.max(0, hc - onsiteStart)
  const peakRatioPct = 0.6
  const supportHc = hc >= 20 ? 2 : 1
  const demand = scenarioSeatDemand(hc, peakRatioPct, supportHc, onsiteHc)
  const sizedOnsite = Math.max(0, onsiteStart - 4)
  const sized = scenarioSeatDemand(hc, peakRatioPct, supportHc, sizedOnsite)
  if (demand == null || sized == null) return null
  return { onsiteHc, wahHc, peakRatioPct, supportHc, seatCount: Math.max(1, Math.ceil(sized)), demand }
}

/** Seat counts written by the earlier sample that changed desks week to week, plus the constant count. */
export function legacyVaryingSeatCounts(productionHc: number): number[] {
  const opening = sampleSeatWeek(productionHc, 0)
  if (!opening) return []
  const onsiteStart = Math.round(Math.round(productionHc) * 0.85)
  const openingDemand = scenarioSeatDemand(Math.round(productionHc), opening.peakRatioPct, opening.supportHc, onsiteStart)
  if (openingDemand == null) return [opening.seatCount]
  return [Math.max(1, Math.floor(openingDemand) - 4), Math.ceil(openingDemand) + 2, opening.seatCount]
}

/** True when this onsite figure is still the sample, including the old flat value before attrition. */
export function onsiteIsSampleValue(
  productionHc: number,
  weekIndex: number | null,
  onsiteHc: number | null | undefined,
  seatCount: number | null | undefined,
): boolean {
  const opening = sampleSeatWeek(productionHc, 0)
  const sample = sampleSeatWeek(productionHc, weekIndex)
  if (!opening || !sample) return false
  if (onsiteHc == null || onsiteHc === sample.onsiteHc) return true
  const oldSeats = legacyVaryingSeatCounts(productionHc).filter((count) => count !== opening.seatCount)
  return onsiteHc === opening.onsiteHc && (seatCount == null || oldSeats.includes(seatCount))
}

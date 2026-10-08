export type ScenarioShiftModel = '24x7' | 'two-shift' | 'single-shift'

const HOURS_PER_FTE_WEEK = 40
const OPEN_HOURS: Record<ScenarioShiftModel, { hoursPerDay: number; daysOpen: number }> = {
  '24x7': { hoursPerDay: 24, daysOpen: 7 },
  'two-shift': { hoursPerDay: 16, daysOpen: 5 },
  'single-shift': { hoursPerDay: 8, daysOpen: 5 },
}

/**
 * Physical seat demand.
 * Seat demand = (Peak ratio × Onsite HC) + Planned Support HC.
 * Blank peak ratio or blank Onsite HC stays blank. WAH HC is not used.
 */
export function scenarioSeatDemand(
  _productionHc: number,
  peakRatioPct: number | null | undefined,
  supportHc: number | null | undefined,
  onsiteHc?: number | null,
): number | null {
  if (peakRatioPct == null || !Number.isFinite(peakRatioPct)) return null
  if (onsiteHc == null || !Number.isFinite(onsiteHc)) return null
  const support = supportHc != null && Number.isFinite(supportHc) ? Math.max(0, supportHc) : 0
  return peakRatioPct * Math.max(0, onsiteHc) + support
}

/** Entered onsite and WAH only. A blank side stays blank. */
export function scenarioOnsiteWah(
  productionHc: number,
  onsiteHc: number | null | undefined,
  wahHc: number | null | undefined,
): { onsiteHc: number | null; wahHc: number | null; onsitePct: number | null; wahPct: number | null } {
  const hc = Number.isFinite(productionHc) ? Math.max(0, productionHc) : 0
  const hasOnsite = onsiteHc != null && Number.isFinite(onsiteHc)
  const hasWah = wahHc != null && Number.isFinite(wahHc)
  const onsite = hasOnsite ? Math.max(0, onsiteHc) : null
  const wah = hasWah ? Math.max(0, wahHc) : null
  return {
    onsiteHc: onsite,
    wahHc: wah,
    onsitePct: onsite != null && hc > 0 ? onsite / hc : null,
    wahPct: wah != null && hc > 0 ? wah / hc : null,
  }
}

/** Occupied onsite hours ÷ hours the seat inventory is open. Null when onsite HC, shrinkage, or seats are blank. */
export function scenarioSeatUtilization(
  onsiteHc: number | null | undefined,
  shrinkagePct: number | null | undefined,
  seatCount: number | null | undefined,
  shiftModel: ScenarioShiftModel,
): number | null {
  if (onsiteHc == null || !Number.isFinite(onsiteHc)) return null
  if (shrinkagePct == null || !Number.isFinite(shrinkagePct)) return null
  if (seatCount == null || !Number.isFinite(seatCount) || seatCount <= 0) return null
  const shrink = Math.min(1, Math.max(0, shrinkagePct))
  const occupied = Math.max(0, onsiteHc) * HOURS_PER_FTE_WEEK * (1 - shrink)
  const open = OPEN_HOURS[shiftModel]
  const operating = Math.max(0, seatCount) * open.hoursPerDay * open.daysOpen
  if (operating <= 0) return null
  return occupied / operating
}

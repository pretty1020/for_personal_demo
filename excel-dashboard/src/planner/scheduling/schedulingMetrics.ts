import type {
  IntervalMetricRow,
  SchedulingMetricsMatrix,
  SchedulingQualityInputs,
  SchedulingResult,
  VolumeAhtRow,
} from './types'
import { staffingNetFteFromRow } from './applyShrinkage'
import { dailyFteFromHooppHeadcounts } from './fteMetrics'
import { hoopIntervalsForDay } from './patternAnalysis'
import type { PatternScheduleMeta } from './patternAnalysis'
import type { SchedulingRules } from './types'

export const SCHED_CHART_COLORS = {
  required: '#1c1915',
  scheduled: '#2c5648',
  adherence: '#4d6b5e',
  occupancy: '#8c7348',
  staffing: '#9a6b2f',
  netFte: '#3d4f46',
  serviceLevel: '#6e675f',
  reqLine: '#1c1915',
  staffArea: '#2c5648',
} as const

function shrinkageFactor(shrinkagePct: number): number {
  const clamped = Math.max(0, Math.min(100, shrinkagePct))
  return 1 - clamped / 100
}

export function netFteFromGross(grossFte: number, shrinkagePct: number): number {
  return grossFte * shrinkageFactor(shrinkagePct)
}

export function clampOccupancyPct(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.min(100, Math.max(0, value))
}

export function lineAdherencePct(scheduled: number, required: number): number | null {
  if (required <= 0) return null
  return (scheduled / required) * 100
}

export function occupancyFromWorkload(
  volume: number,
  ahtSeconds: number,
  scheduledFte: number,
  intervalMinutes: number,
): number | null {
  if (scheduledFte <= 0 || volume <= 0 || ahtSeconds <= 0) return null
  const workloadSeconds = volume * ahtSeconds
  const capacitySeconds = scheduledFte * intervalMinutes * 60
  if (capacitySeconds <= 0) return null
  return clampOccupancyPct((workloadSeconds / capacitySeconds) * 100)
}

export function occupancyProxy(required: number, scheduled: number): number | null {
  if (scheduled <= 0) return null
  return clampOccupancyPct((required / scheduled) * 100)
}

function factorial(n: number): number {
  let result = 1
  for (let index = 2; index <= n; index += 1) result *= index
  return result
}

function erlangCProbability(traffic: number, agents: number): number {
  const agentCount = Math.max(1, Math.ceil(agents))
  if (agentCount <= 0 || traffic <= 0) return 0
  if (traffic >= agentCount) return 1

  let sum = 0
  for (let k = 0; k < agentCount; k += 1) {
    sum += traffic ** k / factorial(k)
  }
  const lastTerm = (traffic ** agentCount / factorial(agentCount)) * (agentCount / (agentCount - traffic))
  return lastTerm / (sum + lastTerm)
}

/** Approximate Erlang C service level (% answered within target seconds). */
export function projectedServiceLevelPct(
  volume: number,
  ahtSeconds: number,
  scheduledAgents: number,
  intervalMinutes: number,
  slaSeconds: number,
): number | null {
  if (volume <= 0 || ahtSeconds <= 0 || scheduledAgents <= 0) return null

  const intervalSeconds = intervalMinutes * 60
  const traffic = (volume * ahtSeconds) / intervalSeconds
  const agents = Math.max(1, Math.ceil(scheduledAgents))

  if (traffic <= 0) return 100
  if (agents <= traffic) return 0

  const erlangC = erlangCProbability(traffic, agents)
  const expTerm = Math.exp(-(agents - traffic) * (slaSeconds / ahtSeconds))
  return Math.max(0, Math.min(100, (1 - erlangC * expTerm) * 100))
}

/** Erlang C SL using traffic intensity (required FTE) as workload proxy when volume is unavailable. */
export function projectedServiceLevelFromTraffic(
  requiredFte: number,
  netFte: number,
  ahtSeconds: number,
  slaSeconds: number,
): number | null {
  if (requiredFte <= 0 || netFte <= 0 || ahtSeconds <= 0 || slaSeconds <= 0) return null
  const traffic = requiredFte
  const agents = Math.max(1, Math.ceil(netFte))
  if (agents <= traffic) return 0
  const erlangC = erlangCProbability(traffic, agents)
  const expTerm = Math.exp(-(agents - traffic) * (slaSeconds / ahtSeconds))
  return Math.max(0, Math.min(100, (1 - erlangC * expTerm) * 100))
}

/**
 * Default projected SL — uses the higher of normal staffing SL and Erlang C (when available).
 */
export function projectedServiceLevelDefault(
  netFte: number,
  requiredFte: number,
  intervalMinutes: number,
  slaPercent: number,
  slaSeconds: number,
  volumeRow?: { volume: number; ahtSeconds: number } | null,
): number | null {
  if (requiredFte <= 0) return null

  const target = Math.max(0, Math.min(100, slaPercent))
  const ratio = netFte / requiredFte

  // Normal SL (staffing anchor): target at requirement, up to 100% when overstaffed
  let slFromPercent: number
  if (ratio >= 1) {
    slFromPercent = Math.min(100, target + (100 - target) * Math.min(1, ratio - 1))
  } else {
    slFromPercent = Math.max(0, ratio * target)
  }

  const defaultAht = 180
  const aht = volumeRow?.ahtSeconds && volumeRow.ahtSeconds > 0 ? volumeRow.ahtSeconds : defaultAht

  // Erlang C SL (% answered within slaSeconds)
  let slFromErlang: number | null = null
  if (netFte > 0 && slaSeconds > 0) {
    if (volumeRow?.volume && volumeRow.volume > 0) {
      slFromErlang = projectedServiceLevelPct(
        volumeRow.volume,
        aht,
        netFte,
        intervalMinutes,
        slaSeconds,
      )
    } else {
      slFromErlang = projectedServiceLevelFromTraffic(requiredFte, netFte, aht, slaSeconds)
    }
  }

  if (slFromErlang != null) {
    return Math.min(100, Math.max(slFromPercent, slFromErlang))
  }

  return Math.min(100, slFromPercent)
}

/** @deprecated Use projectedServiceLevelDefault */
export function projectedServiceLevelFromStaffing(
  netFte: number,
  requiredFte: number,
  slaPercent: number,
  slaSeconds = 30,
  intervalMinutes = 30,
  volumeRow?: { volume: number; ahtSeconds: number } | null,
): number | null {
  return projectedServiceLevelDefault(netFte, requiredFte, intervalMinutes, slaPercent, slaSeconds, volumeRow)
}

function buildVolumeAhtLookup(rows: VolumeAhtRow[]): Map<string, { volume: number; ahtSeconds: number }> {
  const map = new Map<string, { volume: number; ahtSeconds: number }>()
  for (const row of rows) {
    map.set(`${row.day}|${row.interval}`, { volume: row.volume, ahtSeconds: row.ahtSeconds })
  }
  return map
}

export function enrichIntervalMetrics(
  row: IntervalMetricRow,
  day: string,
  inputs: SchedulingQualityInputs,
  intervalMinutes: number,
  volumeLookup?: Map<string, { volume: number; ahtSeconds: number }>,
): IntervalMetricRow {
  const staffingNet = staffingNetFteFromRow(row)
  const adherence = lineAdherencePct(staffingNet, row.requiredFte)
  const lookup = volumeLookup ?? buildVolumeAhtLookup(inputs.volumeAhtRows)
  const volumeRow = lookup.get(`${day}|${row.interval}`)

  let occupancyPct: number | null = null
  let projectedSlErlangPct: number | null = null
  let projectedSlPct = projectedServiceLevelDefault(
    staffingNet,
    row.requiredFte,
    intervalMinutes,
    inputs.slaPercent,
    inputs.slaSeconds,
    volumeRow ?? null,
  )

  if (volumeRow && staffingNet > 0) {
    occupancyPct = occupancyFromWorkload(
      volumeRow.volume,
      volumeRow.ahtSeconds,
      staffingNet,
      intervalMinutes,
    )
    projectedSlErlangPct = projectedServiceLevelPct(
      volumeRow.volume,
      volumeRow.ahtSeconds,
      staffingNet,
      intervalMinutes,
      inputs.slaSeconds,
    )
  } else if (row.requiredFte > 0 && staffingNet > 0) {
    occupancyPct = occupancyProxy(row.requiredFte, staffingNet)
    projectedSlErlangPct = projectedServiceLevelFromTraffic(
      row.requiredFte,
      staffingNet,
      180,
      inputs.slaSeconds,
    )
  }

  // Projected SL = highest of normal staffing SL and Erlang C
  if (projectedSlPct != null && projectedSlErlangPct != null) {
    projectedSlPct = Math.max(projectedSlPct, projectedSlErlangPct)
  } else if (projectedSlPct == null && projectedSlErlangPct != null) {
    projectedSlPct = projectedSlErlangPct
  }

  return {
    ...row,
    lineAdherencePct: adherence,
    staffingPct: adherence,
    occupancyPct: clampOccupancyPct(occupancyPct),
    netFte: row.netFte ?? 0,
    netFteAfterShrinkage: staffingNet,
    projectedSlPct,
    projectedSlErlangPct,
  }
}

export function enrichSchedulingResult(
  result: SchedulingResult,
  inputs: SchedulingQualityInputs,
  intervalMinutes: number,
): SchedulingResult {
  const volumeLookup = buildVolumeAhtLookup(inputs.volumeAhtRows)
  const days = result.days.map((day) => ({
    ...day,
    intervals: day.intervals
      .filter((row) => row.requiredFte > 0.01)
      .map((row) => enrichIntervalMetrics(row, day.day, inputs, intervalMinutes, volumeLookup)),
  }))

  return { ...result, days }
}

export function buildSchedulingMetricsMatrix(
  result: SchedulingResult,
  inputs: SchedulingQualityInputs,
  rules: SchedulingRules,
  patternMeta: PatternScheduleMeta,
): SchedulingMetricsMatrix {
  const intervalMinutes = rules.settings.scheduleIntervalMinutes
  const shiftLengthHours = rules.settings.shiftLengthHours
  const hasVolumeAht = inputs.volumeAhtRows.length > 0
  const volumeLookup = buildVolumeAhtLookup(inputs.volumeAhtRows)

  let occupancyWeightedSum = 0
  let occupancyWeight = 0
  let slWeightedSum = 0
  let slWeight = 0
  let normalSlWeightedSum = 0
  let normalSlWeight = 0

  for (const day of result.days) {
    if (day.isClosed) continue
    for (const row of day.intervals) {
      if (row.requiredFte <= 0.01) continue
      const enriched =
        row.projectedSlPct != null
          ? row
          : enrichIntervalMetrics(row, day.day, inputs, intervalMinutes, volumeLookup)

      if (enriched.occupancyPct != null) {
        const weight = row.requiredFte > 0 ? row.requiredFte : 1
        occupancyWeightedSum += enriched.occupancyPct * weight
        occupancyWeight += weight
      }
      if (enriched.projectedSlPct != null) {
        const weight = row.requiredFte > 0 ? row.requiredFte : 1
        normalSlWeightedSum += enriched.projectedSlPct * weight
        normalSlWeight += weight
      }
      if (enriched.projectedSlErlangPct != null && hasVolumeAht) {
        const vol = volumeLookup.get(`${day.day}|${row.interval}`)?.volume ?? 1
        slWeightedSum += enriched.projectedSlErlangPct * vol
        slWeight += vol
      }
    }
  }

  const pureFteReq = result.totals.weeklySumRequired ?? result.totals.requiredFte
  const pureFteStaff = result.totals.weeklySumScheduled ?? result.totals.scheduledFte
  const scheduledHeadcount = result.totals.rosterAgentsWithShifts ?? result.totals.rosterPoolHc ?? 0

  const workingDays = result.days.filter((day) => !day.isClosed && day.intervals.length > 0)
  let sumNetDaily = 0
  for (const day of workingDays) {
    const hoop = hoopIntervalsForDay(patternMeta, day.day)
    const netByInterval: Record<string, number> = {}
    for (const row of day.intervals) {
      // Staffing Net FTE after shrinkage (equals Net FTE when shrinkage is 0%).
      netByInterval[row.interval] = staffingNetFteFromRow(row)
    }
    sumNetDaily += dailyFteFromHooppHeadcounts(netByInterval, hoop, shiftLengthHours, intervalMinutes)
  }
  const openDayCount = Math.max(workingDays.length, 1)
  const netFteFromIntervals = sumNetDaily / openDayCount
  const appliedShrinkage = Math.max(0, inputs.shrinkagePct)

  return {
    slaPercent: inputs.slaPercent,
    slaSeconds: inputs.slaSeconds,
    occupancyPct: occupancyWeight > 0 ? clampOccupancyPct(occupancyWeightedSum / occupancyWeight) : null,
    pureFteReq,
    scheduledHeadcount,
    pureFteStaffTotals: pureFteStaff,
    /** Week Net FTE from interval comparison (already shrink-applied once). */
    netFteTotal: netFteFromIntervals,
    shrinkagePct: appliedShrinkage > 0 ? appliedShrinkage : null,
    scfPct: lineAdherencePct(pureFteStaff, pureFteReq),
    projectedServiceLevelPct: normalSlWeight > 0 ? normalSlWeightedSum / normalSlWeight : null,
    projectedServiceLevelErlangPct: hasVolumeAht && slWeight > 0 ? slWeightedSum / slWeight : null,
    hasVolumeAht,
  }
}

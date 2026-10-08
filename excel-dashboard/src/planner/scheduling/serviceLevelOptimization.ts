import { projectedServiceLevelDefault } from './schedulingMetrics'
import { staffingNetFteFromRow } from './applyShrinkage'
import type { GeneratedSchedulingPackage, VolumeAhtRow } from './types'

export type ServiceLevelBlocker = {
  day: string
  interval: string
  required: number
  scheduled: number
  projectedSl: number
  extraAgents: number
  extraStaffingPct: number
}

export type ServiceLevelInsight = {
  targetPct: number
  weekProjectedSl: number | null
  meetsTarget: boolean
  hasVolumeAht: boolean
  blockers: ServiceLevelBlocker[]
  minExtraStaffingPct: number
  recommendedExtraAgents: number
  recommendedHc: number
  recommendedWeekFte: number
  constraintNote: string | null
}

function volumeFor(
  rows: VolumeAhtRow[],
  day: string,
  interval: string,
): { volume: number; ahtSeconds: number } | null {
  const match = rows.find((row) => row.day === day && row.interval === interval)
  if (!match || match.volume <= 0) return null
  return { volume: match.volume, ahtSeconds: match.ahtSeconds > 0 ? match.ahtSeconds : 180 }
}

export function extraAgentsToHitServiceLevel(
  required: number,
  scheduledNet: number,
  intervalMinutes: number,
  slaPercent: number,
  slaSeconds: number,
  targetSl: number,
  volumeRow: { volume: number; ahtSeconds: number } | null,
): number {
  if (required <= 0) return 0
  const current = projectedServiceLevelDefault(
    scheduledNet,
    required,
    intervalMinutes,
    slaPercent,
    slaSeconds,
    volumeRow,
  )
  if (current != null && current + 0.05 >= targetSl) return 0

  const maxExtra = Math.max(8, Math.ceil(required * 2))
  for (let extra = 0.25; extra <= maxExtra + 0.001; extra += 0.25) {
    const next = projectedServiceLevelDefault(
      scheduledNet + extra,
      required,
      intervalMinutes,
      slaPercent,
      slaSeconds,
      volumeRow,
    )
    if (next != null && next + 0.05 >= targetSl) return extra
  }
  return maxExtra
}

export function analyzeServiceLevel(
  pkg: GeneratedSchedulingPackage,
  slaPercent: number,
  slaSeconds: number,
  intervalMinutes: number,
  volumeRows: VolumeAhtRow[],
): ServiceLevelInsight {
  const targetPct = slaPercent
  const weekProjectedSl = pkg.metricsMatrix?.projectedServiceLevelPct ?? null
  const meetsTarget = weekProjectedSl != null && weekProjectedSl + 0.05 >= targetPct
  const blockers: ServiceLevelBlocker[] = []

  for (const day of pkg.schedulingResult.days) {
    if (day.isClosed) continue
    for (const row of day.intervals) {
      if (row.requiredFte <= 0.01) continue
      const scheduled = staffingNetFteFromRow(row)
      const projectedSl = row.projectedSlPct
      if (projectedSl == null || projectedSl + 0.05 >= targetPct) continue
      const extraAgents = extraAgentsToHitServiceLevel(
        row.requiredFte,
        scheduled,
        intervalMinutes,
        slaPercent,
        slaSeconds,
        targetPct,
        volumeFor(volumeRows, day.day, row.interval),
      )
      blockers.push({
        day: day.day,
        interval: row.interval,
        required: row.requiredFte,
        scheduled,
        projectedSl,
        extraAgents,
        extraStaffingPct: row.requiredFte > 0 ? (extraAgents / row.requiredFte) * 100 : 0,
      })
    }
  }

  blockers.sort((a, b) => a.projectedSl - b.projectedSl || b.extraAgents - a.extraAgents)
  const worst = blockers[0]
  const coveragePeakGap = pkg.schedulingResult.days.reduce((max, day) => {
    if (day.isClosed) return max
    for (const row of day.intervals) {
      if (row.requiredFte <= 0.01) continue
      const gap = row.requiredFte - staffingNetFteFromRow(row)
      if (gap > max) return gap
    }
    return max
  }, 0)

  const slExtra = worst ? Math.ceil(worst.extraAgents - 1e-6) : 0
  const coverageExtra = coveragePeakGap > 0.01 ? Math.ceil(coveragePeakGap - 1e-6) : 0
  const recommendedExtraAgents = Math.max(slExtra, coverageExtra)
  const currentHc = pkg.productionHc
  const requiredWeekFte = pkg.schedulingResult.totals.weeklySumRequired ?? pkg.requirementTable.weeklyFteTarget
  const minExtraStaffingPct =
    worst?.extraStaffingPct ??
    (requiredWeekFte > 0 && coveragePeakGap > 0 ? (coveragePeakGap / Math.max(pkg.schedulingResult.totals.requiredFte, 0.01)) * 100 : 0)

  let constraintNote: string | null = null
  if (!meetsTarget && recommendedExtraAgents > 0) {
    constraintNote = `Service level ${weekProjectedSl?.toFixed(1) ?? '—'}% is below the ${targetPct}% goal. Adding about ${recommendedExtraAgents} schedule${recommendedExtraAgents === 1 ? '' : 's'} (${minExtraStaffingPct.toFixed(0)}% extra staffing on the weakest interval) is the smallest HC change that can close the gap without overstaffing every interval.`
  } else if (!meetsTarget && recommendedExtraAgents === 0) {
    constraintNote =
      'Service level is below target, but adding headcount on the current rules may not help. Restrictive start windows, rest days, or shift length are likely blocking coverage of the peak intervals.'
  }

  const peakRequired = Math.max(
    ...pkg.schedulingResult.days.flatMap((day) =>
      day.isClosed ? [0] : day.intervals.map((row) => row.requiredFte),
    ),
    0,
  )
  if (currentHc < peakRequired - 0.01 && recommendedExtraAgents > 0) {
    constraintNote = `${constraintNote ?? ''} Roster/HC is ${currentHc} vs a peak requirement of ${peakRequired.toFixed(1)}.`.trim()
  }

  return {
    targetPct,
    weekProjectedSl,
    meetsTarget,
    hasVolumeAht: Boolean(pkg.metricsMatrix?.hasVolumeAht),
    blockers: blockers.slice(0, 8),
    minExtraStaffingPct,
    recommendedExtraAgents,
    recommendedHc: currentHc + recommendedExtraAgents,
    recommendedWeekFte: requiredWeekFte + recommendedExtraAgents * (intervalMinutes / 60),
    constraintNote,
  }
}

import type { GeneratedSchedulingPackage } from './types'

export type SchedulingOutcomeSummary = {
  staffingPct: number | null
  projectedServiceLevelPct: number | null
  projectedServiceLevelErlangPct: number | null
  lineAdherencePct: number | null
  understaffedIntervals: number
  hasVolumeAht: boolean
}

export function summarizeSchedulingPackage(pkg: GeneratedSchedulingPackage): SchedulingOutcomeSummary {
  const matrix = pkg.metricsMatrix
  const totals = pkg.schedulingResult.totals
  return {
    staffingPct: totals.staffingPct,
    projectedServiceLevelPct: matrix?.projectedServiceLevelPct ?? null,
    projectedServiceLevelErlangPct: matrix?.projectedServiceLevelErlangPct ?? null,
    lineAdherencePct: matrix?.scfPct ?? null,
    understaffedIntervals: totals.understaffedIntervals,
    hasVolumeAht: matrix?.hasVolumeAht ?? false,
  }
}

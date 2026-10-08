import type { GeneratedRequirementTable } from './requirementGeneration'
import type { SchedulingResult } from './types'
import { staffingNetFteFromRow } from './applyShrinkage'

export type UnfulfilledRequirement = {
  day: string
  interval: string
  required: number
  scheduled: number
  gap: number
}

export type ScheduleRuleViolation = {
  code: string
  message: string
}

export type ScheduleEngineKind = 'python' | 'python-pulp' | 'typescript'

export type ScheduleDiagnostics = {
  engine: ScheduleEngineKind
  understaffedIntervals: number
  overstaffedIntervals: number
  unfulfilled: UnfulfilledRequirement[]
  violations: ScheduleRuleViolation[]
  coverageNote: string
}

export function buildScheduleDiagnostics(
  _requirementTable: GeneratedRequirementTable,
  result: SchedulingResult,
  engine: ScheduleEngineKind,
  extraViolations: ScheduleRuleViolation[] = [],
): ScheduleDiagnostics {
  const unfulfilled: UnfulfilledRequirement[] = []
  for (const day of result.days) {
    if (day.isClosed) continue
    for (const row of day.intervals) {
      if (row.variance < -0.01) {
        unfulfilled.push({
          day: day.day,
          interval: row.interval,
          required: row.requiredFte,
          scheduled: staffingNetFteFromRow(row),
          gap: Math.abs(row.variance),
        })
      }
    }
  }
  const violations = [...extraViolations]
  if (unfulfilled.length) {
    violations.push({
      code: 'understaffed_intervals',
      message: `${unfulfilled.length} interval(s) remain understaffed after optimization. Peak gaps are listed below.`,
    })
  }
  if (result.totals.overstaffedIntervals > 0) {
    violations.push({
      code: 'overstaffed_intervals',
      message: `${result.totals.overstaffedIntervals} interval(s) are overstaffed relative to required headcount.`,
    })
  }
  const coverageNote =
    unfulfilled.length === 0
      ? 'All required intervals have scheduled coverage at or above the requirement.'
      : `${unfulfilled.length} required interval(s) could not be fully staffed with the current roster, rest days, and shift rules.`
  return {
    engine,
    understaffedIntervals: result.totals.understaffedIntervals,
    overstaffedIntervals: result.totals.overstaffedIntervals,
    unfulfilled: unfulfilled.slice(0, 40),
    violations,
    coverageNote,
  }
}

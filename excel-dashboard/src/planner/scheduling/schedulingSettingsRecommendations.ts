import type { PatternScheduleMeta } from './patternAnalysis'
import type { SchedulingMetricsMatrix, SchedulingResult } from './types'
import type { SchedulingSettings } from './schedulingSettingsTypes'

export type SchedulingSettingsSuggestion = {
  id: string
  title: string
  detail: string
  benefit: string
  highlighted: boolean
  apply: (settings: SchedulingSettings) => SchedulingSettings
}

function averageLineAdherence(result: SchedulingResult | null): number | null {
  if (!result) return null
  let sum = 0
  let weight = 0
  for (const day of result.days) {
    for (const row of day.intervals) {
      if (row.requiredFte <= 0) continue
      const adherence = row.lineAdherencePct ?? (row.scheduledFte / row.requiredFte) * 100
      sum += adherence * row.requiredFte
      weight += row.requiredFte
    }
  }
  return weight > 0 ? sum / weight : null
}

export function buildSchedulingSettingsSuggestions(
  settings: SchedulingSettings,
  result: SchedulingResult | null,
  metrics: SchedulingMetricsMatrix | null,
  _patternMeta: PatternScheduleMeta | null,
): SchedulingSettingsSuggestion[] {
  const suggestions: SchedulingSettingsSuggestion[] = []
  const adherence = averageLineAdherence(result) ?? metrics?.scfPct ?? null
  const understaffed = result?.totals.understaffedIntervals ?? 0

  if (!settings.constraints?.minimizeOverUnder || !settings.optimizeShiftStarts) {
    suggestions.push({
      id: 'enable-optimization',
      title: 'Enable interval optimization',
      detail: 'Turn on minimize over/under staffing and flexible shift-start optimization.',
      benefit: 'Improves line adherence by aligning shifts and breaks to the requirement pattern.',
      highlighted: true,
      apply: (current) => ({
        ...current,
        optimizeShiftStarts: true,
        shiftStartMode: 'flexible',
        constraints: { ...(current.constraints ?? {}), minimizeOverUnder: true },
      }),
    })
  }

  if (!settings.constraints?.followUploadedPattern) {
    suggestions.push({
      id: 'follow-pattern',
      title: 'Follow uploaded interval pattern',
      detail: 'Shape interval requirements from your uploaded file weights instead of flat distribution.',
      benefit: 'Requirements match the intraday pattern in your upload.',
      highlighted: true,
      apply: (current) => ({
        ...current,
        constraints: { ...(current.constraints ?? {}), followUploadedPattern: true },
      }),
    })
  }

  if ((settings.minMinutesBeforeLunch ?? 0) < 60) {
    suggestions.push({
      id: 'min-before-lunch',
      title: 'Set lunch after shift start',
      detail: 'Lunch should not start at punch-in. Use a lunch target of at least 1.5 hours, then slack to move it for coverage.',
      benefit: 'Protects early intervals and still lets lunch slide when demand is high.',
      highlighted: true,
      apply: (current) => ({
        ...current,
        minMinutesBeforeLunch: Math.max(current.minMinutesBeforeLunch ?? 0, 120),
        lunchSlackMinutes: current.lunchSlackMinutes ?? 30,
      }),
    })
  }

  if ((settings.breakSlackMinutes ?? 0) === 0 && (settings.lunchSlackMinutes ?? 0) === 0) {
    suggestions.push({
      id: 'enable-slack',
      title: 'Allow break and lunch slack',
      detail: 'With slack, first break and lunch can start 30 minutes earlier or later than the target to protect busy intervals.',
      benefit: 'Fewer coverage gaps during peaks without locking relief to a single time.',
      highlighted: true,
      apply: (current) => ({
        ...current,
        breakSlackMinutes: 30,
        lunchSlackMinutes: 30,
      }),
    })
  }

  if (settings.minStaffingCoverage > 0.9) {
    suggestions.push({
      id: 'staffing-coverage',
      title: 'Relax minimum staffing coverage',
      detail: `Current target ${(settings.minStaffingCoverage * 100).toFixed(0)}% may over-constrain roster sizing.`,
      benefit: 'Allows more agents on shift to improve interval coverage.',
      highlighted: adherence != null && adherence < 92,
      apply: (current) => ({
        ...current,
        minStaffingCoverage: 0.85,
      }),
    })
  }

  if (
    settings.shiftStartMode === 'fixed' &&
    result &&
    ((adherence != null && adherence < 95) || understaffed > 5)
  ) {
    suggestions.push({
      id: 'flexible-starts',
      title: 'Use flexible shift starts',
      detail: 'Allow shift starts to move within the configured window to match requirements.',
      benefit: 'Higher line adherence when interval demand varies through the day.',
      highlighted: true,
      apply: (current) => ({
        ...current,
        shiftStartMode: 'flexible',
        optimizeShiftStarts: true,
      }),
    })
  }

  if (metrics?.hasVolumeAht && (metrics.projectedServiceLevelPct ?? 100) < (metrics.slaPercent ?? 80)) {
    suggestions.push({
      id: 'increase-roster-coverage',
      title: 'Increase interval staffing for SLA',
      detail: `Projected service level ${metrics.projectedServiceLevelPct?.toFixed(1) ?? '—'}% is below SLA ${metrics.slaPercent ?? 80}%.`,
      benefit: 'Lower min staffing coverage adds agents to improve projected service level.',
      highlighted: true,
      apply: (current) => ({
        ...current,
        minStaffingCoverage: Math.max(0.75, current.minStaffingCoverage - 0.05),
        constraints: { ...(current.constraints ?? {}), minimizeOverUnder: true },
      }),
    })
  }

  return suggestions.slice(0, 6)
}

export function applySchedulingSettingsSuggestion(
  settings: SchedulingSettings,
  suggestion: SchedulingSettingsSuggestion,
): SchedulingSettings {
  return suggestion.apply(settings)
}

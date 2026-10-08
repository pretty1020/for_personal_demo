import type { ScheduleDemandAnalytics } from './scheduleDemandAnalytics'
import type { ServiceLevelInsight } from './serviceLevelOptimization'
import type { SchedulingSettings } from './schedulingSettingsTypes'
import { parseTimeToMinutes } from './schedulingTimeUtils'
import type { GeneratedSchedulingPackage } from './types'

export type ScheduleRecommendation = {
  id: string
  category: 'starts' | 'fte' | 'relief' | 'settings' | 'staffing' | 'sla'
  title: string
  why: string
  impact: string
  highlighted: boolean
  extraAgents?: number
  applySettings?: (settings: SchedulingSettings) => SchedulingSettings
}

export type ScheduleScenarioSnapshot = {
  id: 'current' | 'optimized' | 'staffing'
  label: string
  note: string
  requiredFte: number
  scheduledFte: number
  staffingPct: number | null
  overUnderPct: number | null
  understaffedIntervals: number
  overstaffedIntervals: number
  projectedSl: number | null
  hc: number
  extraAgents?: number
}

export function buildCoverageOptimizedSettings(settings: SchedulingSettings): {
  settings: SchedulingSettings
  changes: string[]
} {
  const changes: string[] = []
  let next = { ...settings, constraints: { ...settings.constraints } }

  if (!next.constraints.minimizeOverUnder) {
    next.constraints.minimizeOverUnder = true
    changes.push('Minimize over/under staffing')
  }
  if (!next.constraints.followUploadedPattern) {
    next.constraints.followUploadedPattern = true
    changes.push('Follow uploaded interval pattern')
  }
  if (!next.optimizeShiftStarts || next.shiftStartMode !== 'flexible') {
    next.optimizeShiftStarts = true
    next.shiftStartMode = 'flexible'
    changes.push('Flexible shift starts within the allowed window')
  }
  if ((next.breakSlackMinutes ?? 0) < 30) {
    next.breakSlackMinutes = 30
    changes.push('Break slack ±30 min')
  }
  if ((next.lunchSlackMinutes ?? 0) < 30) {
    next.lunchSlackMinutes = 30
    changes.push('Lunch slack ±30 min')
  }
  if (!next.constraints.evenlyDistributeBreaks || !next.constraints.evenlyDistributeLunches) {
    next.constraints.evenlyDistributeBreaks = true
    next.constraints.evenlyDistributeLunches = true
    changes.push('Stagger breaks and lunches')
  }
  if (!next.constraints.preventBreakLunchOverlapShortages) {
    next.constraints.preventBreakLunchOverlapShortages = true
    changes.push('Avoid overlapping relief shortages')
  }
  return { settings: next, changes }
}

export function buildScheduleRecommendations(
  settings: SchedulingSettings,
  demand: ScheduleDemandAnalytics,
  sl: ServiceLevelInsight,
): ScheduleRecommendation[] {
  const items: ScheduleRecommendation[] = []

  if (demand.peak && demand.peak.gap > 0.25) {
    items.push({
      id: 'peak-staffing',
      category: 'staffing',
      title: `Add coverage at ${demand.peak.interval} on ${demand.peak.day}`,
      why: `Peak required headcount is ${demand.peak.required.toFixed(1)} vs ${demand.peak.scheduled.toFixed(1)} scheduled. That interval is the largest staffing gap.`,
      impact: `Closing this peak reduces understaffing without adding agents to low-demand valleys.`,
      highlighted: true,
      extraAgents: Math.max(1, Math.ceil(demand.peak.gap - 1e-6)),
    })
  }

  const dominantStart = demand.startDistribution.reduce(
    (best, row) => (!best || row.sharePct > best.sharePct ? row : best),
    null as (typeof demand.startDistribution)[0] | null,
  )
  if (dominantStart && dominantStart.sharePct >= 55 && demand.startDistribution.length <= 3 && demand.demandSpan) {
    items.push({
      id: 'spread-starts',
      category: 'starts',
      title: 'Spread shift start times',
      why: `${dominantStart.sharePct.toFixed(0)}% of assigned shifts start at ${dominantStart.start}, while demand runs ${demand.demandSpan.earliest}–${demand.demandSpan.latest}.`,
      impact: 'More start times inside your allowed window cover peaks and cut idle time in valleys, without changing shift length.',
      highlighted: true,
      applySettings: (current) => ({
        ...current,
        shiftStartMode: 'flexible',
        optimizeShiftStarts: true,
        constraints: { ...current.constraints, minimizeOverUnder: true },
      }),
    })
  }

  if (demand.demandSpan) {
    const earliestAllowed = parseTimeToMinutes(settings.earliestShiftStart)
    const peakMinutes = demand.peak ? parseTimeToMinutes(demand.peak.interval) : earliestAllowed
    if (peakMinutes + 15 < earliestAllowed) {
      items.push({
        id: 'earlier-window',
        category: 'starts',
        title: 'Open an earlier start window',
        why: `Demand starts at ${demand.demandSpan.earliest} but the earliest allowed shift start is ${settings.earliestShiftStart}. Agents cannot cover that peak under current rules.`,
        impact: `Moving earliest start to ${demand.demandSpan.earliest} is the minimum window change required. Shift length and rest rules stay the same.`,
        highlighted: true,
        applySettings: (current) => ({
          ...current,
          earliestShiftStart: demand.demandSpan!.earliest,
        }),
      })
    }
  }

  if ((settings.breakSlackMinutes ?? 0) === 0 || (settings.lunchSlackMinutes ?? 0) === 0) {
    items.push({
      id: 'relief-slack',
      category: 'relief',
      title: 'Use break and lunch slack on peaks',
      why: 'Relief is locked to a single offset from shift start, so many agents leave the phones at the same busy intervals.',
      impact: '±30 minutes of slack lets the optimizer slide breaks/lunches off peak demand while still honoring gap and order rules.',
      highlighted: demand.understaffedIntervals > 0,
      applySettings: (current) => ({
        ...current,
        breakSlackMinutes: Math.max(current.breakSlackMinutes ?? 0, 30),
        lunchSlackMinutes: Math.max(current.lunchSlackMinutes ?? 0, 30),
      }),
    })
  }

  if (!sl.meetsTarget && sl.recommendedExtraAgents > 0) {
    items.push({
      id: 'sla-extra-hc',
      category: 'sla',
      title: `Add ${sl.recommendedExtraAgents} schedule${sl.recommendedExtraAgents === 1 ? '' : 's'} for the SLA goal`,
      why:
        sl.blockers[0] != null
          ? `${sl.blockers[0].interval} on ${sl.blockers[0].day} projects ${sl.blockers[0].projectedSl.toFixed(1)}% SL vs a ${sl.targetPct}% goal (${sl.blockers[0].scheduled.toFixed(1)} vs ${sl.blockers[0].required.toFixed(1)} required).`
          : `Week projected SL ${sl.weekProjectedSl?.toFixed(1) ?? '—'}% is below ${sl.targetPct}%.`,
      impact: `${sl.minExtraStaffingPct.toFixed(0)}% extra staffing on the weakest interval — not a full extra roster on every hour. Recommended HC ${sl.recommendedHc}.`,
      highlighted: true,
      extraAgents: sl.recommendedExtraAgents,
    })
  }

  if (demand.overUnderPct != null && demand.overUnderPct > 8 && demand.understaffedIntervals > 3) {
    items.push({
      id: 'over-and-under',
      category: 'settings',
      title: 'Rebalance overstaffing into understaffed intervals',
      why: `The week is ${demand.overUnderPct.toFixed(1)}% over required FTE overall, yet ${demand.understaffedIntervals} intervals are still short. Extra hours are sitting in valleys.`,
      impact: 'Flexible starts and staggered relief move existing HC onto peaks instead of adding more agents.',
      highlighted: true,
      applySettings: (current) => buildCoverageOptimizedSettings(current).settings,
    })
  }

  if (demand.rosterHc + 0.01 < demand.peakRequiredHc) {
    items.push({
      id: 'hc-below-peak',
      category: 'fte',
      title: `Plan ${Math.ceil(demand.peakRequiredHc)} schedules for the peak`,
      why: `Available HC is ${demand.rosterHc} but the highest interval needs ${demand.peakRequiredHc.toFixed(1)} people. Rules cannot invent coverage that the roster does not have.`,
      impact: `Minimum recommended schedules: ${Math.ceil(demand.peakRequiredHc)}. Adding fewer than the peak gap cannot hit both coverage and SLA on that interval.`,
      highlighted: true,
      extraAgents: Math.max(0, Math.ceil(demand.peakRequiredHc) - demand.rosterHc),
    })
  }

  if (!settings.constraints.minimizeOverUnder) {
    items.push({
      id: 'enable-min-gap',
      category: 'settings',
      title: 'Turn on over/under minimization',
      why: 'The optimizer is not currently scoring interval gaps as a primary objective.',
      impact: 'Enabling this rule keeps shift length, rest days, and relief constraints, and only rearranges starts and breaks.',
      highlighted: true,
      applySettings: (current) => ({
        ...current,
        optimizeShiftStarts: true,
        constraints: { ...current.constraints, minimizeOverUnder: true },
      }),
    })
  }

  return items.slice(0, 6)
}

export function scenarioSnapshotFromPackage(
  id: ScheduleScenarioSnapshot['id'],
  label: string,
  note: string,
  pkg: GeneratedSchedulingPackage,
  extraAgents = 0,
): ScheduleScenarioSnapshot {
  const requiredFte = pkg.schedulingResult.totals.weeklySumRequired ?? pkg.requirementTable.weeklyFteTarget
  const scheduledFte = pkg.schedulingResult.totals.weeklySumScheduled ?? 0
  const staffingPct = pkg.schedulingResult.totals.staffingPct
  const overUnderPct = requiredFte > 0 ? ((scheduledFte - requiredFte) / requiredFte) * 100 : null
  return {
    id,
    label,
    note,
    requiredFte,
    scheduledFte,
    staffingPct,
    overUnderPct,
    understaffedIntervals: pkg.schedulingResult.totals.understaffedIntervals,
    overstaffedIntervals: pkg.schedulingResult.totals.overstaffedIntervals,
    projectedSl: pkg.metricsMatrix?.projectedServiceLevelPct ?? null,
    hc: pkg.productionHc,
    extraAgents,
  }
}

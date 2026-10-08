import type { BreakLunchSchedulePattern, SchedulingSettings } from './schedulingSettingsTypes'
import { snapToQuarterHour } from './schedulingTimeUtils'
import {
  clockWindowMinutes,
  firstBreakStartWindow,
  iterateWindowStarts,
  lunchStartWindow,
  orderStartsPreferringClock,
} from './breakSlackWindows'

/** Effective lunch↔break gap — 0 when the constraint is unchecked, otherwise ≥ 60 minutes. */
export function lunchBreakGapMinutes(settings: SchedulingSettings): number {
  if (settings.constraints?.enforceMinLunchBreakGap === false) return 0
  return Math.max(60, settings.minMinutesBetweenBreaksAndLunch || 60)
}

export function resolvedBreakLunchPattern(settings: SchedulingSettings): BreakLunchSchedulePattern | null {
  if (!settings.constraints?.followBreakLunchPattern) return null
  return settings.constraints.breakLunchPattern ?? 'break_lunch_break'
}

export type BreakSchedulePlan = {
  lunchStart: number
  lunchEnd: number
  breaks: Array<[number, number]>
}

/** Lunch starts within the slack window (target ± slack). Clock windows are preferred, not required. */
export function listLunchCandidates(settings: SchedulingSettings, shiftStartMinutes: number): number[] {
  const shiftEnd = shiftStartMinutes + settings.shiftLengthHours * 60
  const lunchDuration = settings.unpaidLunchMinutes
  const window = lunchStartWindow(settings, shiftStartMinutes)
  const clock = clockWindowMinutes(settings.lunchWindowStart, settings.lunchWindowEnd)
  const candidates: number[] = []

  for (const snapped of iterateWindowStarts(window)) {
    if (snapped < shiftStartMinutes) continue
    if (snapped + lunchDuration > shiftEnd) continue
    candidates.push(snapped)
  }
  if (!candidates.length) return []
  return orderStartsPreferringClock(candidates, clock.start, clock.end)
}

/** Lunch relative to shift when slack-window listing is empty. */
export function listShiftRelativeLunchCandidates(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
): number[] {
  return listLunchCandidates(settings, shiftStartMinutes)
}

export function resolveLunchCandidates(settings: SchedulingSettings, shiftStartMinutes: number): number[] {
  const fromWindow = listLunchCandidates(settings, shiftStartMinutes)
  if (fromWindow.length) return fromWindow
  const relative = listShiftRelativeLunchCandidates(settings, shiftStartMinutes)
  if (relative.length) return relative

  const shiftEnd = shiftStartMinutes + settings.shiftLengthHours * 60
  const window = lunchStartWindow(settings, shiftStartMinutes)
  const lunchDuration = settings.unpaidLunchMinutes
  let fallback = window.target
  if (fallback + lunchDuration > shiftEnd) {
    fallback = snapToQuarterHour(Math.max(window.earliest, shiftEnd - lunchDuration))
  }
  if (fallback < shiftStartMinutes || fallback + lunchDuration > shiftEnd) {
    fallback = Math.max(shiftStartMinutes, shiftEnd - lunchDuration)
  }
  return [fallback]
}

function isOutsideLunch(minute: number, lunchStart: number, lunchEnd: number, gapMinutes: number): boolean {
  if (minute >= lunchStart && minute < lunchEnd) return false
  if (gapMinutes > 0) {
  if (Math.abs(minute - lunchStart) < gapMinutes) return false
  if (Math.abs(minute - lunchEnd) < gapMinutes) return false
  }
  return true
}

/** Break slots: first break uses slack; later breaks may continue through the shift. */
export function listBreakWindowSlots(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
  lunchStart: number,
  lunchEnd: number,
): number[] {
  const shiftEnd = shiftStartMinutes + settings.shiftLengthHours * 60
  const breakDuration = settings.breakDurationMinutes
  const gap = lunchBreakGapMinutes(settings)
  const first = firstBreakStartWindow(settings, shiftStartMinutes)
  const clock = clockWindowMinutes(settings.breakWindowStart, settings.breakWindowEnd)
  const slots: number[] = []

  for (let minute = first.earliest; minute + breakDuration <= shiftEnd; minute += 15) {
    const snapped = snapToQuarterHour(minute)
    if (snapped + breakDuration > shiftEnd) continue
    if (!isOutsideLunch(snapped, lunchStart, lunchEnd, gap)) continue
    slots.push(snapped)
  }
  return orderStartsPreferringClock([...new Set(slots)], clock.start, clock.end)
}

/** Break slots anywhere in the shift (15-min grid) excluding lunch buffer. */
export function listShiftRelativeBreakSlots(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
  lunchStart: number,
  lunchEnd: number,
): number[] {
  const shiftEnd = shiftStartMinutes + settings.shiftLengthHours * 60
  const breakDuration = settings.breakDurationMinutes
  const gap = lunchBreakGapMinutes(settings)
  const first = firstBreakStartWindow(settings, shiftStartMinutes)
  const slots: number[] = []

  for (let minute = first.earliest; minute + breakDuration <= shiftEnd; minute += 15) {
    const snapped = snapToQuarterHour(minute)
    if (!isOutsideLunch(snapped, lunchStart, lunchEnd, gap)) continue
    slots.push(snapped)
  }
  return [...new Set(slots)]
}

export function resolveBreakSlots(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
  lunchStart: number,
  lunchEnd: number,
): number[] {
  const fromWindow = listBreakWindowSlots(settings, shiftStartMinutes, lunchStart, lunchEnd)
  const relative = listShiftRelativeBreakSlots(settings, shiftStartMinutes, lunchStart, lunchEnd)
  return [...new Set([...fromWindow, ...relative])].sort((a, b) => a - b)
}

function minBreakGapMinutes(settings: SchedulingSettings): number {
  return Math.max(60, settings.minMinutesBetweenBreaksAndLunch || 60)
}

function breaksAreValid(breaks: Array<[number, number]>, minGapMinutes: number): boolean {
  if (breaks.length < 2) return true
  const starts = breaks.map(([start]) => start).sort((a, b) => a - b)
  const first = starts[0]!
  const second = starts[1]!
  return first !== second && second - first >= minGapMinutes
}

export function planMatchesBreakLunchPattern(
  plan: BreakSchedulePlan,
  pattern: BreakLunchSchedulePattern,
  breakDuration: number,
): boolean {
  const sorted = [...plan.breaks].sort((a, b) => a[0] - b[0])
  if (sorted.length < 2) return true
  const firstStart = sorted[0]![0]
  const firstEnd = sorted[0]![1] ?? firstStart + breakDuration
  const secondStart = sorted[1]![0]
  const secondEnd = sorted[1]![1] ?? secondStart + breakDuration
  const lunchStart = plan.lunchStart
  const lunchEnd = plan.lunchEnd

  if (pattern === 'break_break_lunch') return secondEnd <= lunchStart
  if (pattern === 'lunch_break_break') return firstStart >= lunchEnd
  return firstEnd <= lunchStart && secondStart >= lunchEnd
}

function pickBreakPairs(
  slots: number[],
  breakCount: number,
  breakDuration: number,
  agentIndex: number,
  minGapMinutes: number,
  shiftEndMinutes?: number,
): Array<[number, number]> {
  const needed = Math.min(Math.max(breakCount, 0), 2)
  if (!slots.length || needed <= 0) return []

  const sorted = [...new Set(slots)]
    .filter((slot) => shiftEndMinutes == null || slot + breakDuration <= shiftEndMinutes)
    .sort((a, b) => a - b)
  if (!sorted.length) return []

  if (needed === 1) {
    const slot = sorted[agentIndex % sorted.length]!
    return [[slot, slot + breakDuration]]
  }

  for (let offset = 0; offset < sorted.length; offset += 1) {
    const firstIndex = (agentIndex + offset) % sorted.length
    const first = sorted[firstIndex]!
    for (let gap = 0; gap < sorted.length; gap += 1) {
      const secondIndex = (firstIndex + 1 + gap) % sorted.length
      const second = sorted[secondIndex]!
      if (second >= first + minGapMinutes && (shiftEndMinutes == null || second + breakDuration <= shiftEndMinutes)) {
        return [
          [first, first + breakDuration],
          [second, second + breakDuration],
        ]
      }
    }
  }

  for (let firstIndex = 0; firstIndex < sorted.length; firstIndex += 1) {
    const first = sorted[firstIndex]!
    for (let secondIndex = firstIndex + 1; secondIndex < sorted.length; secondIndex += 1) {
      const second = sorted[secondIndex]!
      if (second >= first + minGapMinutes) {
        return [
          [first, first + breakDuration],
          [second, second + breakDuration],
        ]
      }
    }
  }

  if (sorted.length >= 2) {
    const first = sorted[0]!
    const last = sorted[sorted.length - 1]!
    if (last >= first + minGapMinutes) {
      return [
        [first, first + breakDuration],
        [last, last + breakDuration],
      ]
    }
  }

  if (sorted.length >= 1 && needed >= 2) {
    const first = sorted[agentIndex % sorted.length]!
    const second = first + minGapMinutes
    if (shiftEndMinutes == null || second + breakDuration <= shiftEndMinutes) {
      return [
        [first, first + breakDuration],
        [second, second + breakDuration],
      ]
    }
    if (sorted.length >= 2) {
      return [
        [sorted[0]!, sorted[0]! + breakDuration],
        [sorted[sorted.length - 1]!, sorted[sorted.length - 1]! + breakDuration],
      ]
    }
  }

  const slot = sorted[agentIndex % sorted.length]!
  return [[slot, slot + breakDuration]]
}

function pickBreaksForPattern(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
  lunchStart: number,
  lunchEnd: number,
  agentIndex: number,
  pattern: BreakLunchSchedulePattern | null,
): Array<[number, number]> {
  const breakDuration = settings.breakDurationMinutes
  const needed = Math.min(Math.max(settings.breakCount, 0), 2)
  const minGap = minBreakGapMinutes(settings)
  const gap = lunchBreakGapMinutes(settings)
  const shiftEnd = shiftStartMinutes + settings.shiftLengthHours * 60
  const allSlots = resolveBreakSlots(settings, shiftStartMinutes, lunchStart, lunchEnd)
  if (!pattern || needed <= 0) {
    const firstWin = firstBreakStartWindow(settings, shiftStartMinutes)
    const firstSlots = allSlots.filter((slot) => slot >= firstWin.earliest && slot <= firstWin.latest)
    if (needed === 1 && firstSlots.length) {
      return pickBreakPairs(firstSlots, 1, breakDuration, agentIndex, minGap, shiftEnd)
    }
    if (needed >= 2 && firstSlots.length) {
      const first = firstSlots[agentIndex % firstSlots.length]!
      const later = allSlots.filter((slot) => slot >= first + minGap)
      if (later.length) {
        const second = later[(agentIndex + 1) % later.length]!
        return [
          [first, first + breakDuration],
          [second, second + breakDuration],
        ]
      }
    }
    return pickBreakPairs(allSlots, needed, breakDuration, agentIndex, minGap, shiftEnd)
  }

  const before = allSlots.filter((slot) =>
    gap > 0 ? slot + breakDuration + gap <= lunchStart : slot + breakDuration <= lunchStart,
  )
  const after = allSlots.filter((slot) => (gap > 0 ? slot >= lunchEnd + gap : slot >= lunchEnd))

  const firstWin = firstBreakStartWindow(settings, shiftStartMinutes)
  const beforePreferred = before.filter((slot) => slot >= firstWin.earliest && slot <= firstWin.latest)
  const beforeForPick = beforePreferred.length ? beforePreferred : before

  if (pattern === 'break_break_lunch') {
    if (beforeForPick.length >= needed) {
      return pickBreakPairs(beforeForPick, needed, breakDuration, agentIndex, minGap, lunchStart)
    }
    if (before.length >= needed) {
      return pickBreakPairs(before, needed, breakDuration, agentIndex, minGap, lunchStart)
    }
    return [] // caller must rebuild lunch / use forceConstructPattern
  }

  if (pattern === 'lunch_break_break') {
    if (after.length >= needed) {
      return pickBreakPairs(after, needed, breakDuration, agentIndex, minGap, shiftEnd)
    }
    return []
  }

  // break_lunch_break
  if (needed === 1) {
    const pool = beforeForPick.length ? beforeForPick : before
    const slot = pool[agentIndex % Math.max(pool.length, 1)] ?? after[0]
    return slot != null ? [[slot, slot + breakDuration]] : []
  }
  if ((beforeForPick.length || before.length) && after.length) {
    const firstPool = beforeForPick.length ? beforeForPick : before
    const first = firstPool[agentIndex % firstPool.length]!
    const second = after[(agentIndex + 1) % after.length]!
    return [
      [first, first + breakDuration],
      [second, second + breakDuration],
    ]
  }
  return []
}

/**
 * Hard-build a pattern-compliant lunch/break plan when the constraint is on.
 * Never returns Lunch→Break→Break when Break→Lunch→Break is selected.
 */
function repairPatternPlan(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
  plan: BreakSchedulePlan,
  pattern: BreakLunchSchedulePattern,
): BreakSchedulePlan {
  const shiftEnd = shiftStartMinutes + settings.shiftLengthHours * 60
  const lunchDur = settings.unpaidLunchMinutes
  const breakDur = settings.breakDurationMinutes
  const gap = lunchBreakGapMinutes(settings)
  const breakGap = minBreakGapMinutes(settings)
  const breakWin = firstBreakStartWindow(settings, shiftStartMinutes)
  const lunchWin = lunchStartWindow(settings, shiftStartMinutes)
  const minBreak = breakWin.earliest
  const minLunch = lunchWin.earliest

  let lunchStart = snapToQuarterHour(Math.max(minLunch, Math.min(plan.lunchStart, shiftEnd - lunchDur)))
  let lunchEnd = lunchStart + lunchDur
  let breaks = [...plan.breaks]
    .map(([from]) => {
      const start = Math.max(minBreak, Math.min(snapToQuarterHour(from), shiftEnd - breakDur))
      return [start, start + breakDur] as [number, number]
    })
    .sort((a, b) => a[0] - b[0])
  while (breaks.length < 2) {
    const start = Math.max(minBreak, (breaks[breaks.length - 1]?.[0] ?? minBreak) + breakGap)
    breaks.push([start, start + breakDur])
  }

  if (pattern === 'break_lunch_break') {
    // Place first break inside slack, then lunch inside lunch slack when gap allows.
    const b1 = Math.min(breakWin.latest, Math.max(breakWin.earliest, snapToQuarterHour(plan.breaks[0]?.[0] ?? breakWin.target)))
    const lunchStartLocal = Math.min(
      lunchWin.latest,
      Math.max(lunchWin.earliest, Math.max(minLunch, b1 + breakDur + gap)),
    )
    const lunchEndLocal = lunchStartLocal + lunchDur
    const b2 = Math.min(shiftEnd - breakDur, Math.max(lunchEndLocal + gap, lunchEndLocal + gap))
    if (b1 + breakDur + gap <= lunchStartLocal && lunchEndLocal + gap <= b2 && b2 + breakDur <= shiftEnd) {
      return {
        lunchStart: snapToQuarterHour(lunchStartLocal),
        lunchEnd: snapToQuarterHour(lunchStartLocal) + lunchDur,
        breaks: [
          [snapToQuarterHour(b1), snapToQuarterHour(b1) + breakDur],
          [snapToQuarterHour(b2), snapToQuarterHour(b2) + breakDur],
        ],
      }
    }
    // Compact pack when the preferred spacing does not fit
    const packedB1 = minBreak
    const packedLunch = snapToQuarterHour(Math.max(minLunch, packedB1 + breakDur + gap))
    const packedLunchEnd = packedLunch + lunchDur
    const packedB2 = snapToQuarterHour(Math.min(shiftEnd - breakDur, packedLunchEnd + gap))
    return {
      lunchStart: packedLunch,
      lunchEnd: packedLunchEnd,
      breaks: [
        [packedB1, packedB1 + breakDur],
        [Math.max(packedB2, packedLunchEnd + Math.min(gap, 15)), Math.max(packedB2, packedLunchEnd + Math.min(gap, 15)) + breakDur],
      ],
    }
  }

  if (pattern === 'break_break_lunch') {
    let b1 = Math.max(minBreak, breaks[0]![0])
    let b2 = Math.max(b1 + breakGap, breaks[1]![0])
    lunchStart = Math.max(lunchStart, b2 + breakDur + gap)
    lunchStart = Math.min(lunchStart, shiftEnd - lunchDur)
    lunchEnd = lunchStart + lunchDur
    if (b2 + breakDur + gap > lunchStart) {
      b2 = Math.max(b1 + breakGap, lunchStart - gap - breakDur)
      b1 = Math.max(minBreak, Math.min(b1, b2 - breakGap))
    }
    return {
      lunchStart,
      lunchEnd,
      breaks: [
        [b1, b1 + breakDur],
        [b2, b2 + breakDur],
      ],
    }
  }

  // lunch_break_break
  lunchStart = Math.min(lunchStart, shiftEnd - lunchDur - gap - breakDur - breakGap - breakDur)
  lunchStart = Math.max(minLunch, lunchStart)
  lunchEnd = lunchStart + lunchDur
  let b1 = Math.max(lunchEnd + gap, breaks[0]![0])
  let b2 = Math.max(b1 + breakGap, breaks[1]![0])
  if (b2 + breakDur > shiftEnd) {
    b2 = shiftEnd - breakDur
    b1 = Math.max(lunchEnd + gap, b2 - breakGap)
  }
  return {
    lunchStart,
    lunchEnd,
    breaks: [
      [b1, b1 + breakDur],
      [b2, b2 + breakDur],
    ],
  }
}

export function forceConstructPatternPlan(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
  agentIndex: number,
  pattern: BreakLunchSchedulePattern,
): BreakSchedulePlan {
  const shiftEnd = shiftStartMinutes + settings.shiftLengthHours * 60
  const lunchDur = settings.unpaidLunchMinutes
  const breakDur = settings.breakDurationMinutes
  const gap = lunchBreakGapMinutes(settings)
  const breakGap = minBreakGapMinutes(settings)
  const breakWin = firstBreakStartWindow(settings, shiftStartMinutes)
  const lunchWin = lunchStartWindow(settings, shiftStartMinutes)
  const minLunch = lunchWin.earliest
  const minBreak = breakWin.earliest
  const firstStarts = iterateWindowStarts(breakWin)
  const lunchStarts = iterateWindowStarts(lunchWin)
  const stagger = (agentIndex % Math.max(firstStarts.length, 1))
  const lunchStagger = (agentIndex % Math.max(lunchStarts.length, 1))

  const clampBreak = (start: number): [number, number] => {
    let s = snapToQuarterHour(start)
    s = Math.max(minBreak, Math.min(s, shiftEnd - breakDur))
    return [s, s + breakDur]
  }

  if (pattern === 'break_lunch_break') {
    let b1 = firstStarts[stagger] ?? breakWin.target
    let lunchStart = lunchStarts[lunchStagger] ?? lunchWin.target
    lunchStart = Math.max(lunchStart, b1 + breakDur + gap)
    if (lunchStart > lunchWin.latest) {
      lunchStart = Math.max(lunchWin.earliest, b1 + breakDur + gap)
    }
    const lunchLatest = shiftEnd - lunchDur - gap - breakDur
    lunchStart = snapToQuarterHour(Math.min(Math.max(lunchStart, minLunch), lunchLatest))
    if (b1 + breakDur + gap > lunchStart) {
      b1 = snapToQuarterHour(Math.max(minBreak, Math.min(breakWin.latest, lunchStart - gap - breakDur)))
    }
    const lunchEnd = lunchStart + lunchDur
    let b2 = snapToQuarterHour(lunchEnd + gap + ((agentIndex * 15) % 45))
    if (b2 + breakDur > shiftEnd) b2 = shiftEnd - breakDur
    if (b2 < lunchEnd + gap) b2 = lunchEnd + gap
    return repairPatternPlan(
      settings,
      shiftStartMinutes,
      {
        lunchStart,
        lunchEnd,
        breaks: [clampBreak(b1), clampBreak(b2)].sort((a, b) => a[0] - b[0]),
      },
      pattern,
    )
  }

  if (pattern === 'break_break_lunch') {
    // B1 — breakGap — B2 — gap — Lunch
    const lunchLatest = shiftEnd - lunchDur
    let lunchStart = lunchStarts[lunchStagger] ?? lunchWin.target
    lunchStart = Math.min(lunchStart, lunchLatest)
    lunchStart = Math.max(lunchStart, minLunch)
    const lunchEnd = lunchStart + lunchDur

    let b1 = firstStarts[stagger] ?? breakWin.target
    let b2 = snapToQuarterHour(b1 + breakGap)
    if (b2 + breakDur + gap > lunchStart) {
      b2 = snapToQuarterHour(lunchStart - gap - breakDur)
      b1 = snapToQuarterHour(Math.max(minBreak, b2 - breakGap))
    }
    if (b1 < minBreak) b1 = minBreak
    if (b2 <= b1) b2 = b1 + breakGap
    return repairPatternPlan(
      settings,
      shiftStartMinutes,
      {
        lunchStart,
        lunchEnd,
        breaks: [clampBreak(b1), clampBreak(b2)].sort((a, b) => a[0] - b[0]),
      },
      pattern,
    )
  }

  // lunch_break_break — Lunch — gap — B1 — breakGap — B2
  let lunchStart = snapToQuarterHour((lunchStarts[lunchStagger] ?? lunchWin.target) + 0)
  const lunchLatestForLBB = shiftEnd - lunchDur - gap - breakDur - breakGap - breakDur
  if (lunchStart > lunchLatestForLBB) lunchStart = snapToQuarterHour(Math.max(minLunch, lunchLatestForLBB))
  const lunchEnd = lunchStart + lunchDur
  let b1 = snapToQuarterHour(lunchEnd + gap + ((agentIndex * 15) % 30))
  let b2 = snapToQuarterHour(b1 + breakGap)
  if (b2 + breakDur > shiftEnd) {
    b2 = shiftEnd - breakDur
    b1 = Math.max(lunchEnd + gap, b2 - breakGap)
  }
  return repairPatternPlan(
    settings,
    shiftStartMinutes,
    { lunchStart, lunchEnd, breaks: [clampBreak(b1), clampBreak(b2)].sort((a, b) => a[0] - b[0]) },
    pattern,
  )
}

function finalizePatternPlan(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
  agentIndex: number,
  plan: BreakSchedulePlan,
): BreakSchedulePlan {
  const pattern = resolvedBreakLunchPattern(settings)
  const needed = Math.min(Math.max(settings.breakCount, 0), 2)
  if (!pattern || needed < 2) {
    return clampPlanWithinShiftLoose(settings, shiftStartMinutes, plan)
  }
  const breakDuration = settings.breakDurationMinutes
  if (planMatchesBreakLunchPattern(plan, pattern, breakDuration) && gapsSatisfyConstraint(settings, plan)) {
    return {
      lunchStart: plan.lunchStart,
      lunchEnd: plan.lunchEnd,
      breaks: [...plan.breaks].sort((a, b) => a[0] - b[0]).slice(0, needed),
    }
  }
  return forceConstructPatternPlan(settings, shiftStartMinutes, agentIndex, pattern)
}

function gapsSatisfyConstraint(settings: SchedulingSettings, plan: BreakSchedulePlan): boolean {
  const gap = lunchBreakGapMinutes(settings)
  if (gap <= 0) return true
  for (const [from, to] of plan.breaks) {
    // break ends before lunch start with gap, or starts after lunch end with gap
    const beforeOk = to + gap <= plan.lunchStart
    const afterOk = from >= plan.lunchEnd + gap
    if (!beforeOk && !afterOk) return false
    // must not overlap lunch
    if (from < plan.lunchEnd && to > plan.lunchStart) return false
  }
  return true
}

/** Soft clamp used when pattern constraint is off. */
function clampPlanWithinShiftLoose(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
  plan: BreakSchedulePlan,
): BreakSchedulePlan {
  const shiftEnd = shiftStartMinutes + settings.shiftLengthHours * 60
  const lunchDuration = settings.unpaidLunchMinutes
  const breakDuration = settings.breakDurationMinutes
  const lunchWin = lunchStartWindow(settings, shiftStartMinutes)
  const breakWin = firstBreakStartWindow(settings, shiftStartMinutes)
  const minLunch = lunchWin.earliest
  const minBreak = breakWin.earliest
  const minGap = minBreakGapMinutes(settings)
  const gap = lunchBreakGapMinutes(settings)
  const needed = Math.min(Math.max(settings.breakCount, 0), 2)

  let lunchStart = snapToQuarterHour(plan.lunchStart)
  lunchStart = Math.max(minLunch, Math.min(lunchStart, lunchWin.latest))
  if (lunchStart + lunchDuration > shiftEnd) {
    lunchStart = snapToQuarterHour(Math.max(minLunch, shiftEnd - lunchDuration))
  }
  lunchStart = Math.max(shiftStartMinutes, Math.min(lunchStart, Math.max(shiftStartMinutes, shiftEnd - lunchDuration)))
  const lunchEnd = lunchStart + lunchDuration

  const uniqueSlots: number[] = []
  for (let minute = minBreak; minute + breakDuration <= shiftEnd; minute += 15) {
    const snapped = snapToQuarterHour(minute)
    if (snapped >= lunchStart && snapped < lunchEnd) continue
    if (gap > 0 && (Math.abs(snapped - lunchStart) < gap || Math.abs(snapped - lunchEnd) < gap)) continue
    uniqueSlots.push(snapped)
  }
  let breaks = pickBreakPairs([...new Set(uniqueSlots)].sort((a, b) => a - b), needed, breakDuration, 0, minGap, shiftEnd)
  if (breaks.length < needed && plan.breaks.length) {
    breaks = plan.breaks.slice(0, needed)
  }
  return { lunchStart, lunchEnd, breaks: breaks.slice(0, needed) }
}

/** Keep lunch and breaks fully inside [shiftStart, shiftEnd], honoring checked pattern constraint. */
export function clampPlanWithinShift(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
  plan: BreakSchedulePlan,
): BreakSchedulePlan {
  const pattern = resolvedBreakLunchPattern(settings)
  if (pattern && settings.breakCount >= 2) {
    return finalizePatternPlan(settings, shiftStartMinutes, 0, plan)
  }
  return clampPlanWithinShiftLoose(settings, shiftStartMinutes, plan)
}

function forceBreakCount(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
  lunchStart: number,
  lunchEnd: number,
  breaks: Array<[number, number]>,
  agentIndex = 0,
): Array<[number, number]> {
  const needed = Math.min(Math.max(settings.breakCount, 0), 2)
  if (needed <= 0) return []
  const pattern = resolvedBreakLunchPattern(settings)
  const breakDuration = settings.breakDurationMinutes
  if (pattern && needed >= 2) {
    const trial = { lunchStart, lunchEnd, breaks }
    if (planMatchesBreakLunchPattern(trial, pattern, breakDuration) && gapsSatisfyConstraint(settings, trial)) {
      return [...breaks].sort((a, b) => a[0] - b[0]).slice(0, needed)
    }
    return forceConstructPatternPlan(settings, shiftStartMinutes, agentIndex, pattern).breaks
  }

  const minGap = minBreakGapMinutes(settings)
  const shiftEnd = shiftStartMinutes + settings.shiftLengthHours * 60
  const slots = resolveBreakSlots(settings, shiftStartMinutes, lunchStart, lunchEnd)
  const picked = pickBreakPairs(slots, needed, breakDuration, 0, minGap, shiftEnd)
  return picked.slice(0, needed)
}

/** Build a complete lunch + break plan on the 15-min grid (:00/:15/:30/:45). */
export function buildCompleteBreakPlan(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
  agentIndex: number,
): BreakSchedulePlan {
  const pattern = resolvedBreakLunchPattern(settings)
  if (pattern && settings.breakCount >= 2) {
    return forceConstructPatternPlan(settings, shiftStartMinutes, agentIndex, pattern)
  }

  const lunchDuration = settings.unpaidLunchMinutes
  const breakDuration = settings.breakDurationMinutes
  const shiftEnd = shiftStartMinutes + settings.shiftLengthHours * 60
  const lunches = resolveLunchCandidates(settings, shiftStartMinutes)
  const lunchStart = lunches[agentIndex % lunches.length]!
  const lunchEnd = lunchStart + lunchDuration
  const minGap = minBreakGapMinutes(settings)

  let breaks = pickBreaksForPattern(settings, shiftStartMinutes, lunchStart, lunchEnd, agentIndex, null)
  if (!breaksAreValid(breaks, minGap)) {
    breaks = pickBreakPairs(
      resolveBreakSlots(settings, shiftStartMinutes, lunchStart, lunchEnd),
      settings.breakCount,
      breakDuration,
      agentIndex,
      minGap,
      shiftEnd,
    )
  }
  breaks = forceBreakCount(settings, shiftStartMinutes, lunchStart, lunchEnd, breaks, agentIndex)
  return clampPlanWithinShiftLoose(settings, shiftStartMinutes, { lunchStart, lunchEnd, breaks })
}

/** Candidate lunch/break plans per agent — staggered and rule-compliant. */
export function enumerateBreakSchedules(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
  agentIndex: number,
  agentCount: number,
): BreakSchedulePlan[] {
  const pattern = resolvedBreakLunchPattern(settings)
  if (pattern && settings.breakCount >= 2) {
    const plans: BreakSchedulePlan[] = []
    const firstStarts = iterateWindowStarts(firstBreakStartWindow(settings, shiftStartMinutes))
    const lunchStarts = iterateWindowStarts(lunchStartWindow(settings, shiftStartMinutes))
    const sample = Math.max(firstStarts.length, lunchStarts.length, 3)
    for (let offset = 0; offset < Math.min(10, sample); offset += 1) {
      const plan = forceConstructPatternPlan(settings, shiftStartMinutes, agentIndex + offset, pattern)
      if (planMatchesBreakLunchPattern(plan, pattern, settings.breakDurationMinutes)) {
        plans.push(plan)
      }
    }
    return plans.length ? plans : [forceConstructPatternPlan(settings, shiftStartMinutes, agentIndex, pattern)]
  }

  const lunchDuration = settings.unpaidLunchMinutes
  const lunches = resolveLunchCandidates(settings, shiftStartMinutes)
  const plans: BreakSchedulePlan[] = []
  const maxLunchTries = Math.min(6, lunches.length)
  const minGap = minBreakGapMinutes(settings)
  const shiftEnd = shiftStartMinutes + settings.shiftLengthHours * 60

  for (let lunchIndex = 0; lunchIndex < maxLunchTries; lunchIndex += 1) {
    const lunchStart = lunches[(agentIndex + lunchIndex) % lunches.length]!
    const lunchEnd = lunchStart + lunchDuration
    if (lunchStart < shiftStartMinutes || lunchEnd > shiftEnd) continue
    for (const agentOffset of [0, Math.max(1, Math.floor(agentCount / 3))]) {
      const breaks = pickBreaksForPattern(settings, shiftStartMinutes, lunchStart, lunchEnd, agentIndex + agentOffset, null)
      if (breaksAreValid(breaks, minGap)) {
        plans.push(clampPlanWithinShiftLoose(settings, shiftStartMinutes, { lunchStart, lunchEnd, breaks }))
      }
    }
  }

  const complete = buildCompleteBreakPlan(settings, shiftStartMinutes, agentIndex)
  plans.push(complete)

  const unique = new Map<string, BreakSchedulePlan>()
  for (const plan of plans) {
    const normalized = ensurePlanHasBreaks(settings, shiftStartMinutes, agentIndex, plan)
    const key = `${normalized.lunchStart}|${normalized.breaks.map((b) => b[0]).join(',')}`
    unique.set(key, normalized)
  }
  return unique.size ? [...unique.values()].slice(0, 16) : [complete]
}

export function ensurePlanHasBreaks(
  settings: SchedulingSettings,
  shiftStartMinutes: number,
  agentIndex: number,
  plan: BreakSchedulePlan,
): BreakSchedulePlan {
  const pattern = resolvedBreakLunchPattern(settings)
  if (pattern && settings.breakCount >= 2) {
    return finalizePatternPlan(settings, shiftStartMinutes, agentIndex, plan)
  }

  const needed = Math.min(settings.breakCount, 2)
  const minGap = minBreakGapMinutes(settings)
  const shiftEnd = shiftStartMinutes + settings.shiftLengthHours * 60
  const minLunch = lunchStartWindow(settings, shiftStartMinutes).earliest
  const lunchCandidates = resolveLunchCandidates(settings, shiftStartMinutes)
  const lunchStart =
    plan.lunchStart >= minLunch && plan.lunchStart + settings.unpaidLunchMinutes <= shiftEnd
      ? plan.lunchStart
      : lunchCandidates[agentIndex % lunchCandidates.length]!
  const lunchEnd = lunchStart + settings.unpaidLunchMinutes
  const inShiftBreaks = plan.breaks.filter(
    ([from, to]) => from >= shiftStartMinutes && to <= shiftEnd && !(from >= lunchStart && from < lunchEnd),
  )

  if (inShiftBreaks.length >= needed && breaksAreValid(inShiftBreaks, minGap)) {
    return clampPlanWithinShiftLoose(settings, shiftStartMinutes, {
      lunchStart,
      lunchEnd,
      breaks: forceBreakCount(settings, shiftStartMinutes, lunchStart, lunchEnd, inShiftBreaks, agentIndex),
    })
  }

  return buildCompleteBreakPlan(settings, shiftStartMinutes, agentIndex)
}

export function applyBreakPlan(
  assignment: {
    lunchStart: number
    lunchEnd: number
    breaks: Array<[number, number]>
  },
  plan: BreakSchedulePlan,
) {
  assignment.lunchStart = plan.lunchStart
  assignment.lunchEnd = plan.lunchEnd
  assignment.breaks = plan.breaks.map(([from, to]) => [from, to] as [number, number])
}

export function enforceBreakConstraintsOnAssignments(
  assignments: Array<{
    agentIndex: number
    startMinutes: number
    lunchStart: number
    lunchEnd: number
    breaks: Array<[number, number]>
  }>,
  settings: SchedulingSettings,
): void {
  for (const assignment of assignments) {
    const plan = ensurePlanHasBreaks(settings, assignment.startMinutes, assignment.agentIndex, {
      lunchStart: assignment.lunchStart,
      lunchEnd: assignment.lunchEnd,
      breaks: assignment.breaks,
    })
    applyBreakPlan(assignment, plan)
  }
}

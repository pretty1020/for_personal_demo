import type { WeeklyRollupPoint } from './advancedForecastPersistence'

/**
 * Forecaster judgment applied on top of a model.
 *
 * A model only knows what happened before. It cannot know that a client is
 * running a Black Friday campaign, that a new product ships in week 12, or that
 * a competitor's outage sent volume somewhere else last month. Real forecasting
 * is the model plus what the forecaster knows, and a tool that offers no way to
 * say so forces people back into spreadsheets.
 *
 * Two levers, deliberately different:
 *
 * An **event** is a reason — named, with a percentage uplift, covering a range
 * of weeks. It survives a re-run, because the reason is still true when the
 * model is refitted.
 *
 * An **override** is a number — this week is 8,000, whatever the model says.
 * It is absolute and also survives a re-run, since the planner asserted it
 * deliberately.
 *
 * Both are recorded rather than baked in, so the model's own output stays
 * visible underneath and the adjustment can be explained, audited or removed.
 */

export type ForecastEvent = {
  id: string
  name: string
  /** First plan week affected, inclusive. */
  fromWeek: string
  /** Last plan week affected, inclusive. */
  toWeek: string
  /** Percentage change applied to the model's value. +40 means 40% higher. */
  upliftPct: number
  note?: string
}

/** Week -> absolute value the planner has asserted. */
export type ForecastOverrides = Record<string, number>

export type AdjustedPoint = WeeklyRollupPoint & {
  /** The model's own value before any adjustment. */
  modelValue: number
  /** Events applied to this week, for explaining the difference. */
  appliedEvents: string[]
  /** True when a planner set this week's number directly. */
  overridden: boolean
}

function combinedUplift(events: ForecastEvent[], week: string): { factor: number; names: string[] } {
  let factor = 1
  const names: string[] = []
  for (const event of events) {
    if (week < event.fromWeek || week > event.toWeek) continue
    // Overlapping events compound rather than add: a 20% campaign during a 10%
    // seasonal push is 32% up, not 30%. Adding them would understate the peak
    // that staffing has to cover.
    factor *= 1 + event.upliftPct / 100
    names.push(event.name)
  }
  return { factor, names }
}

/**
 * Apply events and overrides to a model's weekly forecast.
 *
 * Order matters: events scale the model's value, then an override replaces it
 * outright. A planner who types a number means that number, not that number
 * adjusted by something else.
 */
export function applyAdjustments(
  weekly: WeeklyRollupPoint[],
  events: ForecastEvent[],
  overrides: ForecastOverrides,
  unit: 'number' | 'percent' | 'seconds' = 'number',
): AdjustedPoint[] {
  return weekly.map((point) => {
    const { factor, names } = combinedUplift(events, point.week)
    const scaled = point.value * factor
    const override = overrides[point.week]
    const hasOverride = override != null && Number.isFinite(override)

    const value = hasOverride ? override : scaled
    // Percentages cannot exceed 1, and nothing here can go negative.
    const clamped = unit === 'percent' ? Math.min(1, Math.max(0, value)) : Math.max(0, value)

    return {
      ...point,
      value: clamped,
      // The interval moves with the forecast, but an asserted number carries no
      // model uncertainty — the planner has replaced the estimate, not widened it.
      lower: hasOverride ? undefined : point.lower != null ? point.lower * factor : undefined,
      upper: hasOverride ? undefined : point.upper != null ? point.upper * factor : undefined,
      modelValue: point.value,
      appliedEvents: names,
      overridden: hasOverride,
    }
  })
}

/** Weeks an event covers, given the plan's week list. */
export function weeksInEvent(event: ForecastEvent, planWeeks: string[]): string[] {
  return planWeeks.filter((week) => week >= event.fromWeek && week <= event.toWeek)
}

/**
 * Summarise what judgment has been applied, for the run header.
 *
 * Worth stating plainly: a plan carrying adjustments is no longer the model's
 * forecast, and anyone reading the numbers should know that before they act.
 */
export function describeAdjustments(
  events: ForecastEvent[],
  overrides: ForecastOverrides,
): string | null {
  const overrideCount = Object.keys(overrides).length
  const parts: string[] = []
  if (events.length) parts.push(`${events.length} event${events.length === 1 ? '' : 's'}`)
  if (overrideCount) parts.push(`${overrideCount} manual week${overrideCount === 1 ? '' : 's'}`)
  return parts.length ? parts.join(' and ') : null
}

export function newEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

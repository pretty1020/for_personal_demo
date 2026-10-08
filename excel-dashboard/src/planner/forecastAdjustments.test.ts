import { describe, expect, it } from 'vitest'
import {
  applyAdjustments,
  describeAdjustments,
  weeksInEvent,
  type ForecastEvent,
} from './forecastAdjustments'
import type { WeeklyRollupPoint } from './advancedForecastPersistence'

/**
 * Forecaster judgment on top of a model.
 *
 * These adjustments change the numbers a plan staffs to, so the tests pin the
 * rules a planner would assume: that an override means exactly what was typed,
 * that overlapping events compound, and that the model's own figure survives
 * underneath so the difference can be explained.
 */

const WEEKS = ['2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29']

function weekly(values: number[] = [1000, 1000, 1000, 1000]): WeeklyRollupPoint[] {
  return WEEKS.map((week, i) => ({ week, value: values[i]!, days: 7, lower: values[i]! * 0.9, upper: values[i]! * 1.1 }))
}

const campaign: ForecastEvent = {
  id: 'e1',
  name: 'Black Friday',
  fromWeek: '2026-11-22',
  toWeek: '2026-11-29',
  upliftPct: 40,
}

describe('applyAdjustments', () => {
  it('leaves untouched weeks exactly as the model had them', () => {
    const result = applyAdjustments(weekly(), [campaign], {})
    expect(result[0]!.value).toBe(1000)
    expect(result[0]!.appliedEvents).toEqual([])
    expect(result[0]!.overridden).toBe(false)
  })

  it('applies an event only across the weeks it covers', () => {
    const result = applyAdjustments(weekly(), [campaign], {})
    expect(result.map((p) => Math.round(p.value))).toEqual([1000, 1000, 1400, 1400])
    expect(result[2]!.appliedEvents).toEqual(['Black Friday'])
  })

  it('keeps the model value visible beside the adjusted one', () => {
    // The difference has to be explainable to whoever signs off the plan.
    const result = applyAdjustments(weekly(), [campaign], {})
    expect(result[2]!.modelValue).toBe(1000)
    expect(result[2]!.value).toBeCloseTo(1400)
  })

  it('compounds overlapping events rather than adding them', () => {
    // A 20% campaign during a 10% seasonal push is 32% up, not 30% — adding
    // them would understate the peak staffing has to cover.
    const seasonal: ForecastEvent = { id: 'e2', name: 'Peak', fromWeek: WEEKS[2]!, toWeek: WEEKS[3]!, upliftPct: 10 }
    const promo: ForecastEvent = { id: 'e3', name: 'Promo', fromWeek: WEEKS[2]!, toWeek: WEEKS[2]!, upliftPct: 20 }
    const result = applyAdjustments(weekly(), [seasonal, promo], {})
    expect(result[2]!.value).toBeCloseTo(1000 * 1.1 * 1.2)
    expect(result[2]!.appliedEvents).toEqual(['Peak', 'Promo'])
  })

  it('handles a reduction as readily as an uplift', () => {
    const outage: ForecastEvent = { ...campaign, upliftPct: -30 }
    const result = applyAdjustments(weekly(), [outage], {})
    expect(result[2]!.value).toBeCloseTo(700)
  })

  it('takes an override literally, ignoring events on that week', () => {
    // A planner who types a number means that number, not that number adjusted.
    const result = applyAdjustments(weekly(), [campaign], { [WEEKS[2]!]: 8000 })
    expect(result[2]!.value).toBe(8000)
    expect(result[2]!.overridden).toBe(true)
    // The neighbouring event week is still scaled.
    expect(result[3]!.value).toBeCloseTo(1400)
  })

  it('drops the interval on an overridden week', () => {
    // An asserted number carries no model uncertainty to report.
    const result = applyAdjustments(weekly(), [], { [WEEKS[0]!]: 5000 })
    expect(result[0]!.lower).toBeUndefined()
    expect(result[0]!.upper).toBeUndefined()
  })

  it('moves the interval with an event', () => {
    const result = applyAdjustments(weekly(), [campaign], {})
    expect(result[2]!.lower).toBeCloseTo(900 * 1.4)
    expect(result[2]!.upper).toBeCloseTo(1100 * 1.4)
  })

  it('keeps a rate inside 0-1 however it is adjusted', () => {
    const huge: ForecastEvent = { ...campaign, upliftPct: 900 }
    const result = applyAdjustments(weekly([0.5, 0.5, 0.5, 0.5]), [huge], {}, 'percent')
    expect(result[2]!.value).toBeLessThanOrEqual(1)
  })

  it('never lets an adjustment drive a value negative', () => {
    const collapse: ForecastEvent = { ...campaign, upliftPct: -150 }
    const result = applyAdjustments(weekly(), [collapse], {})
    expect(result[2]!.value).toBe(0)
  })
})

describe('weeksInEvent', () => {
  it('lists the plan weeks an event covers', () => {
    expect(weeksInEvent(campaign, WEEKS)).toEqual([WEEKS[2], WEEKS[3]])
  })
})

describe('describeAdjustments', () => {
  it('says nothing when the forecast is purely modelled', () => {
    expect(describeAdjustments([], {})).toBeNull()
  })

  it('names both kinds of judgment', () => {
    expect(describeAdjustments([campaign], { [WEEKS[0]!]: 1 })).toBe('1 event and 1 manual week')
  })
})

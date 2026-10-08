import { describe, expect, it } from 'vitest'
import { generateSampleSeries, sampleGrainFor, sampleWeeksForPlan } from './sampleDriverData'

/**
 * Generated sample history.
 *
 * These series exist to exercise the forecasting models before real actuals
 * exist, so they must be well-formed enough to fit — inside each driver's valid
 * range, ending flush against the plan, and reproducible.
 */

const PLAN_START = '2026-08-16'

describe('sampleGrainFor', () => {
  it('is weekly for every driver', () => {
    // Forecasting is weekly throughout, because the capacity plan is. Daily
    // sample data would only be aggregated straight back to weeks.
    for (const metric of ['callVolume', 'ahtSeconds', 'attritionHc', 'absenteeism']) {
      expect(sampleGrainFor(metric)).toBe('weekly')
    }
  })
})

describe('generateSampleSeries', () => {
  it('ends on the week before the plan starts, so no gap needs bridging', () => {
    const { points } = generateSampleSeries({ metricId: 'callVolume', planStart: PLAN_START })
    expect(points[points.length - 1]!.date).toBe('2026-08-09')
  })

  it('produces one point per requested week', () => {
    const { points, grain } = generateSampleSeries({ metricId: 'callVolume', planStart: PLAN_START })
    expect(grain).toBe('weekly')
    expect(points).toHaveLength(104)
    expect(
      generateSampleSeries({ metricId: 'callVolume', planStart: PLAN_START, weeks: 60 }).points,
    ).toHaveLength(60)
  })

  it('lands weekly points on the plan’s own week starts', () => {
    // PLAN_START is a Sunday, so every weekly point must also be a Sunday.
    // Ending the day *before* the plan would put them all on Saturdays, and each
    // value would be bucketed into the week before the one it belongs to.
    const { points } = generateSampleSeries({ metricId: 'attritionHc', planStart: PLAN_START })
    const planDay = new Date(`${PLAN_START}T12:00:00`).getDay()
    for (const point of points) {
      expect(new Date(`${point.date}T12:00:00`).getDay()).toBe(planDay)
    }
    // The last week sits immediately before the plan starts.
    expect(points[points.length - 1]!.date).toBe('2026-08-09')
  })

  it('produces one point per week for weekly drivers', () => {
    const { points, grain } = generateSampleSeries({ metricId: 'attritionHc', planStart: PLAN_START })
    expect(grain).toBe('weekly')
    expect(points).toHaveLength(104)
    const first = new Date(`${points[0]!.date}T12:00:00`).getTime()
    const second = new Date(`${points[1]!.date}T12:00:00`).getTime()
    expect((second - first) / 86_400_000).toBe(7)
  })

  it('is deterministic, so a forecast does not change on reload', () => {
    const a = generateSampleSeries({ metricId: 'callVolume', planStart: PLAN_START })
    const b = generateSampleSeries({ metricId: 'callVolume', planStart: PLAN_START })
    expect(a.points).toEqual(b.points)
  })

  it('gives each driver a different series', () => {
    const volume = generateSampleSeries({ metricId: 'callVolume', planStart: PLAN_START })
    const aht = generateSampleSeries({ metricId: 'ahtSeconds', planStart: PLAN_START })
    expect(volume.points[0]!.value).not.toBe(aht.points[0]!.value)
  })

  it('keeps rate drivers inside 0–1', () => {
    // A percentage driver above 1 would be written into the plan as >100%.
    const { points } = generateSampleSeries({ metricId: 'absenteeism', planStart: PLAN_START })
    for (const point of points) {
      expect(point.value).toBeGreaterThan(0)
      expect(point.value).toBeLessThanOrEqual(1)
    }
  })

  it('keeps counts non-negative and whole', () => {
    const { points } = generateSampleSeries({ metricId: 'attritionHc', planStart: PLAN_START })
    for (const point of points) {
      expect(point.value).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(point.value)).toBe(true)
    }
  })

  it('keeps AHT in a plausible range', () => {
    const { points } = generateSampleSeries({ metricId: 'ahtSeconds', planStart: PLAN_START })
    const values = points.map((p) => p.value)
    expect(Math.min(...values)).toBeGreaterThan(150)
    expect(Math.max(...values)).toBeLessThan(600)
  })

  it('produces every value finite and dated', () => {
    for (const metricId of ['callVolume', 'ahtSeconds', 'attritionHc', 'absenteeism']) {
      const { points } = generateSampleSeries({ metricId, planStart: PLAN_START })
      expect(points.every((p) => Number.isFinite(p.value))).toBe(true)
      expect(points.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date))).toBe(true)
    }
  })

  it('carries a yearly swing for the seasonal models to find', () => {
    // Weekly volume has no weekday shape left, so the annual cycle is what the
    // seasonal models have to work with. Compare the same months a year apart.
    const { points } = generateSampleSeries({ metricId: 'callVolume', planStart: PLAN_START })
    const monthOf = (iso: string) => Number(iso.slice(5, 7))
    const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length
    const byMonth = new Map<number, number[]>()
    for (const point of points) {
      const m = monthOf(point.date)
      byMonth.set(m, [...(byMonth.get(m) ?? []), point.value])
    }
    const monthly = [...byMonth.values()].map(mean)
    // A real annual cycle means the best month clearly beats the worst.
    expect(Math.max(...monthly)).toBeGreaterThan(Math.min(...monthly) * 1.15)
  })

  it('rises over the window, so a trend is present to detect', () => {
    const { points } = generateSampleSeries({ metricId: 'callVolume', planStart: PLAN_START })
    const mean = (slice: typeof points) => slice.reduce((s, p) => s + p.value, 0) / slice.length
    expect(mean(points.slice(-90))).toBeGreaterThan(mean(points.slice(0, 90)))
  })
})


describe('sampleWeeksForPlan', () => {
  it('mirrors the plan history when that is long enough', () => {
    expect(sampleWeeksForPlan({ planHistoryWeeks: 130, horizonWeeks: 52 })).toBe(130)
  })

  it('stretches a short plan history so the models have something to fit', () => {
    // 26 weeks of history against a 52-week horizon leaves nothing to train on.
    expect(sampleWeeksForPlan({ planHistoryWeeks: 26, horizonWeeks: 52 })).toBe(104)
  })

  it('keeps at least a year even for a short horizon', () => {
    expect(sampleWeeksForPlan({ planHistoryWeeks: 4, horizonWeeks: 4 })).toBe(52)
  })

  it('caps the span so a daily series stays manageable', () => {
    expect(sampleWeeksForPlan({ planHistoryWeeks: 900, horizonWeeks: 52 })).toBe(208)
  })

  it('scales with the horizon', () => {
    expect(sampleWeeksForPlan({ planHistoryWeeks: 10, horizonWeeks: 26 })).toBe(52)
    expect(sampleWeeksForPlan({ planHistoryWeeks: 10, horizonWeeks: 40 })).toBe(80)
  })
})

import type { DatedPoint } from './forecastDataSource'

/**
 * Generated sample history for drivers a plan has no actuals for.
 *
 * This exists so the forecasting models can be exercised end to end before real
 * history is loaded. It is **not** real data, and everything that displays it
 * says so — a forecast fitted on this measures whether the pipeline works, not
 * what the business will do.
 *
 * The shapes are drawn from how contact-centre drivers actually behave, so the
 * models have something meaningful to find: weekday seasonality, a yearly cycle,
 * a slow trend, holiday-season suppression, and occasional shocks.
 */

export type SampleGrain = 'daily' | 'weekly'

export type SampleSeriesResult = {
  points: DatedPoint[]
  grain: SampleGrain
  /** Human-readable description of the shape, shown next to the data. */
  profile: string
}

/**
 * Deterministic PRNG (mulberry32), so regenerating a driver's sample gives the
 * same series. A forecast that changed every time the page reloaded would be
 * impossible to reason about.
 */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box–Muller, for noise that looks like measurement noise rather than a rash of outliers. */
function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-9)
  const v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function isoOf(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Monday-first weekday multipliers: heavy Monday, quiet weekend. */
const WEEKDAY_VOLUME = [1.18, 1.09, 1.02, 0.98, 0.94, 0.52, 0.42]

/** Rough stand-in for the western holiday season, which suppresses most queues. */
function holidayFactor(date: Date): number {
  const month = date.getMonth()
  const day = date.getDate()
  if (month === 11 && day >= 22) return 0.55
  if (month === 0 && day <= 2) return 0.6
  // Easter moves; a mild spring dip is close enough for sample data.
  if (month === 3 && day >= 1 && day <= 7) return 0.85
  return 1
}

/** Day of the year, for the annual cycle. */
function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0)
  return Math.floor((date.getTime() - start.getTime()) / 86_400_000)
}

/**
 * How much sample history to generate for a given plan.
 *
 * Mirrors the plan's own historical span so the sample looks like the data that
 * plan would really hold, then extends it where that is too short to fit
 * anything useful: the models need a couple of yearly cycles to find seasonality,
 * and the held-back test window has to be long enough to mean something against
 * the horizon being forecast.
 */
export function sampleWeeksForPlan(options: {
  planHistoryWeeks: number
  horizonWeeks: number
  minWeeks?: number
  maxWeeks?: number
}): number {
  const { planHistoryWeeks, horizonWeeks, minWeeks = 52, maxWeeks = 208 } = options
  // Twice the horizon so the test split still leaves a real training window.
  const wanted = Math.max(planHistoryWeeks, horizonWeeks * 2, minWeeks)
  return Math.min(maxWeeks, Math.max(minWeeks, wanted))
}

/**
 * Sample history is weekly for every driver.
 *
 * Forecasting is weekly throughout, because the capacity plan is. Generating
 * daily data would only be aggregated straight back to weeks before any model
 * saw it, so the weekday shape it carried would be averaged away — the sample
 * would look richer than the thing it stands in for.
 */
export function sampleGrainFor(_metricId: string): SampleGrain {
  return 'weekly'
}

/**
 * Build a sample series ending the day before `planStart`.
 *
 * Ending flush against the plan matters: a series that stops months earlier
 * forces the models to extrapolate across the gap before they reach any plan
 * week, which tests the bridging logic rather than the models.
 */
export function generateSampleSeries(options: {
  metricId: string
  /** The plan's first forward week; the sample ends immediately before it. */
  planStart: string
  weeks?: number
  seed?: number
}): SampleSeriesResult {
  const { metricId, planStart, weeks = 104, seed = 1337 } = options
  const grain = sampleGrainFor(metricId)
  const random = makeRandom(seed + metricId.length * 7919)

  const stepDays = grain === 'daily' ? 1 : 7
  const count = grain === 'daily' ? weeks * 7 : weeks

  // A weekly series must sit on the plan's own week-start dates. Stepping back
  // from the day before the plan starts would put every point on the last day of
  // a week instead, so each value would be bucketed into the week before the one
  // it belongs to. Daily data has no such constraint and simply runs up to the
  // day before the plan.
  const end = new Date(`${planStart}T12:00:00`)
  end.setDate(end.getDate() - (grain === 'weekly' ? 7 : 1))

  const start = new Date(end)
  start.setDate(start.getDate() - (count - 1) * stepDays)

  const points: DatedPoint[] = []
  for (let index = 0; index < count; index++) {
    const date = new Date(start)
    date.setDate(date.getDate() + index * stepDays)
    points.push({ date: isoOf(date), value: valueFor(metricId, date, index, count, random) })
  }

  return { points, grain, profile: profileFor(metricId) }
}

function valueFor(
  metricId: string,
  date: Date,
  index: number,
  count: number,
  random: () => number,
): number {
  const progress = index / Math.max(1, count - 1)
  const yearly = Math.sin((2 * Math.PI * dayOfYear(date)) / 365)
  const weekday = WEEKDAY_VOLUME[(date.getDay() + 6) % 7]!

  switch (metricId) {
    case 'callVolume': {
      // ~1,200/day, 12% annual growth, a clear yearly cycle, weekday shape,
      // holiday suppression, and the occasional demand shock.
      const base = 1200 * (1 + 0.12 * progress)
      const seasonal = 1 + 0.14 * yearly
      const shock = random() < 0.012 ? 1.5 + random() * 0.8 : 1
      const noise = 1 + gaussian(random) * 0.06
      const value = base * seasonal * weekday * holidayFactor(date) * shock * noise
      return Math.max(1, Math.round(value))
    }

    case 'ahtSeconds': {
      // ~300s drifting up slightly, longer on the quiet days when the simple
      // contacts are absent, with rare handling-time excursions.
      const base = 295 * (1 + 0.05 * progress)
      const dayEffect = weekday < 0.6 ? 1.08 : 1 - 0.02 * (weekday - 1)
      const excursion = random() < 0.02 ? 1.12 + random() * 0.1 : 1
      const noise = 1 + gaussian(random) * 0.035
      return Math.max(60, Math.round(base * dayEffect * excursion * noise * 10) / 10)
    }

    case 'attritionHc': {
      // Weekly leaver counts: a small number, seasonal (post-bonus spikes),
      // never negative and always whole people.
      const base = 2.6 * (1 + 0.2 * progress)
      const seasonal = 1 + 0.35 * Math.sin((2 * Math.PI * (dayOfYear(date) - 30)) / 365)
      const spike = random() < 0.04 ? 2.2 : 1
      const value = base * seasonal * spike * (1 + gaussian(random) * 0.3)
      return Math.max(0, Math.round(value))
    }

    case 'absenteeism':
    case 'totalShrinkagePct':
    default: {
      // Rates live in 0–1. Absenteeism sits near 6%, worse in winter and around
      // holidays, with occasional bad weeks.
      const centre = metricId === 'totalShrinkagePct' ? 0.28 : 0.06
      const seasonal = 1 + 0.25 * Math.sin((2 * Math.PI * (dayOfYear(date) - 200)) / 365)
      const holiday = holidayFactor(date) < 1 ? 1.3 : 1
      const spike = random() < 0.03 ? 1.7 : 1
      const value = centre * seasonal * holiday * spike * (1 + gaussian(random) * 0.18)
      // Clamp inside the range the driver can physically take.
      return Math.min(0.95, Math.max(0.005, Math.round(value * 10_000) / 10_000))
    }
  }
}

function profileFor(metricId: string): string {
  switch (metricId) {
    case 'callVolume':
      return 'Daily volume: weekday shape, yearly cycle, 12% growth, holiday-season dips, occasional demand shocks'
    case 'ahtSeconds':
      return 'Daily AHT near 300s: slow upward drift, longer on quiet days, rare handling excursions'
    case 'attritionHc':
      return 'Weekly leavers: small counts, seasonal peaks, occasional spikes'
    case 'totalShrinkagePct':
      return 'Weekly shrinkage near 28%: seasonal swing and bad weeks'
    default:
      return 'Weekly absenteeism near 6%: seasonal swing, worse around holidays, occasional bad weeks'
  }
}

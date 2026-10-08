import type { WfmModelId } from './advancedForecastPersistence'

/**
 * What shape is this series, and which models suit that shape?
 *
 * Accuracy scores say which model *did* best on the weeks tested. They do not
 * say whether that result is likely to hold, and on a short series the winner
 * is often decided by a handful of points. Describing the series itself gives
 * the other half of the decision: a strongly seasonal series with two years of
 * history genuinely suits Holt-Winters, and a noisy twelve-week series suits
 * nothing complicated no matter what the scoreboard says.
 *
 * The measures follow the standard additive decomposition — level, trend,
 * season, remainder — and the strength definitions used in the forecasting
 * literature: how much of the variation each component explains.
 */

export type SeriesDiagnostics = {
  weeks: number
  /** Mean of the series, for context on the amplitude figures. */
  level: number
  /** 0–1. How much of the variation a repeating annual shape explains. */
  seasonalStrength: number
  /** 0–1. How much of the variation a trend explains. */
  trendStrength: number
  /** Seasonal peak-to-trough swing, as a percentage of the level. */
  amplitudePct: number
  /** Residual spread after trend and season, as a percentage of the level. */
  volatilityPct: number
  /** Percentage change per week implied by the fitted trend. */
  trendPerWeekPct: number
  /** Share of weeks more than three residual deviations from the fit. */
  outlierPct: number
  /** Whether an annual cycle is both long enough to see and actually repeating. */
  hasSeasonalEvidence: boolean
  /**
   * Why there is no seasonal reading, when there is none.
   *
   * 'too_short' is fixable by importing history; 'not_repeating' is not, and
   * telling a planner to go and find more weeks would send them after data that
   * will not change the answer.
   */
  seasonalEvidence: 'present' | 'too_short' | 'not_repeating'
  /** How closely successive years resemble each other, -1 to 1. */
  cycleAgreement: number | null
}

export type ModelSuggestion = {
  modelId: WfmModelId
  /** Why this model suits this series, in a planner's terms. */
  reason: string
}

export type DiagnosticsVerdict = {
  diagnostics: SeriesDiagnostics
  /** Plain description of the series shape. */
  summary: string
  suggested: ModelSuggestion[]
  /** Things that should temper confidence in any forecast from this series. */
  cautions: string[]
}

/** A repeating annual cycle needs a year and a half of weeks to be visible. */
const SEASONAL_MIN_WEEKS = 78
const PERIOD = 52

/**
 * How much successive years must agree before the shape counts as seasonal.
 *
 * Length alone is not evidence. With two years of history each weekly index is
 * the average of two observations, so one outage or one campaign lands in the
 * seasonal profile and the series is reported as seasonal on the strength of
 * something that happened once. Seasonality means it repeats — so the test is
 * whether the years look like each other, not whether one year has a shape.
 */
const MIN_CYCLE_AGREEMENT = 0.25

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function variance(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  return values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1)
}

/** Ordinary least squares slope and intercept against the index. */
function linearFit(y: number[]): { slope: number; intercept: number } {
  const n = y.length
  if (n < 2) return { slope: 0, intercept: y[0] ?? 0 }
  const meanX = (n - 1) / 2
  const meanY = mean(y)
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (y[i]! - meanY)
    den += (i - meanX) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  return { slope, intercept: meanY - slope * meanX }
}

/**
 * Additive decomposition into trend, season and remainder.
 *
 * The trend is a straight line rather than a moving average: capacity plans
 * rarely hold enough weeks for a smoother to behave, and a line is what the
 * strength measure is comparing against anyway.
 */
function decompose(y: number[]): { trend: number[]; season: number[]; remainder: number[] } {
  const { slope, intercept } = linearFit(y)
  const trend = y.map((_, i) => intercept + slope * i)
  const detrended = y.map((value, i) => value - trend[i]!)

  const season = new Array(y.length).fill(0)
  if (y.length >= SEASONAL_MIN_WEEKS) {
    const sums = new Array(PERIOD).fill(0)
    const counts = new Array(PERIOD).fill(0)
    for (let i = 0; i < detrended.length; i++) {
      sums[i % PERIOD] += detrended[i]!
      counts[i % PERIOD] += 1
    }
    const raw = sums.map((sum, i) => (counts[i] ? sum / counts[i] : 0))
    // Centre the indices so they shift nothing overall.
    const offset = mean(raw)
    for (let i = 0; i < y.length; i++) season[i] = raw[i % PERIOD]! - offset
  }

  const remainder = y.map((value, i) => value - trend[i]! - season[i]!)
  return { trend, season, remainder }
}

/**
 * Strength of a component: how much of the variation it explains once the
 * remainder is accounted for. Zero means the component adds nothing.
 */
function strength(component: number[], remainder: number[]): number {
  const combined = component.map((value, i) => value + remainder[i]!)
  const denominator = variance(combined)
  if (denominator <= 1e-12) return 0
  return Math.max(0, Math.min(1, 1 - variance(remainder) / denominator))
}

/** Pearson correlation, or null when either side never moves. */
function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length)
  if (n < 4) return null
  const meanA = mean(a.slice(0, n))
  const meanB = mean(b.slice(0, n))
  let cov = 0
  let varA = 0
  let varB = 0
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA
    const db = b[i]! - meanB
    cov += da * db
    varA += da * da
    varB += db * db
  }
  if (varA <= 1e-12 || varB <= 1e-12) return null
  return cov / Math.sqrt(varA * varB)
}

/**
 * How closely one year of the detrended series resembles the next.
 *
 * A trailing part-year counts only when it covers at least half a cycle, and is
 * compared against the matching part of the earlier years — a January is
 * compared with a January, never with a July.
 */
function cycleAgreement(detrended: number[]): number | null {
  const cycles: number[][] = []
  for (let start = 0; start + PERIOD <= detrended.length; start += PERIOD) {
    cycles.push(detrended.slice(start, start + PERIOD))
  }
  const trailing = detrended.length % PERIOD
  if (cycles.length >= 1 && trailing >= PERIOD / 2) {
    cycles.push(detrended.slice(detrended.length - trailing))
  }
  if (cycles.length < 2) return null

  const scores: number[] = []
  for (let i = 0; i < cycles.length; i++) {
    for (let j = i + 1; j < cycles.length; j++) {
      const r = correlation(cycles[i]!, cycles[j]!)
      if (r != null) scores.push(r)
    }
  }
  return scores.length ? mean(scores) : null
}

export function diagnoseSeries(values: number[]): SeriesDiagnostics {
  const y = values.filter((value) => Number.isFinite(value))
  const level = mean(y)
  const safeLevel = Math.abs(level) > 1e-9 ? Math.abs(level) : 1

  if (y.length < 4) {
    return {
      weeks: y.length,
      level,
      seasonalStrength: 0,
      trendStrength: 0,
      amplitudePct: 0,
      volatilityPct: 0,
      trendPerWeekPct: 0,
      outlierPct: 0,
      hasSeasonalEvidence: false,
      seasonalEvidence: 'too_short',
      cycleAgreement: null,
    }
  }

  const { trend, season, remainder } = decompose(y)
  const agreement = cycleAgreement(y.map((value, i) => value - trend[i]!))
  const longEnough = y.length >= SEASONAL_MIN_WEEKS
  const repeats = agreement != null && agreement >= MIN_CYCLE_AGREEMENT
  const hasSeasonalEvidence = longEnough && repeats
  const seasonalEvidence: SeriesDiagnostics['seasonalEvidence'] = hasSeasonalEvidence
    ? 'present'
    : longEnough
      ? 'not_repeating'
      : 'too_short'

  const residualSd = Math.sqrt(variance(remainder))
  const outliers = remainder.filter((value) => Math.abs(value) > 3 * residualSd).length

  const seasonalSwing = hasSeasonalEvidence ? Math.max(...season) - Math.min(...season) : 0
  const { slope } = linearFit(y)

  return {
    weeks: y.length,
    level,
    seasonalStrength: hasSeasonalEvidence ? strength(season, remainder) : 0,
    trendStrength: strength(trend, remainder),
    // Without a year of data the swing that can be measured is overall spread,
    // not a seasonal amplitude — labelled as such by hasSeasonalEvidence.
    amplitudePct: hasSeasonalEvidence
      ? (seasonalSwing / safeLevel) * 100
      : ((Math.max(...y) - Math.min(...y)) / safeLevel) * 100,
    volatilityPct: (residualSd / safeLevel) * 100,
    trendPerWeekPct: (slope / safeLevel) * 100,
    outlierPct: (outliers / y.length) * 100,
    hasSeasonalEvidence,
    seasonalEvidence,
    cycleAgreement: agreement,
  }
}

function describe(d: SeriesDiagnostics): string {
  const parts: string[] = []

  if (d.seasonalEvidence === 'too_short') {
    parts.push(`${d.weeks} weeks — too short to show an annual cycle`)
  } else if (d.seasonalEvidence === 'not_repeating') {
    parts.push(`no repeating annual pattern — the years do not resemble each other`)
  } else if (d.seasonalStrength > 0.6) {
    parts.push(`strongly seasonal, swinging ${d.amplitudePct.toFixed(0)}% peak to trough`)
  } else if (d.seasonalStrength > 0.3) {
    parts.push(`mildly seasonal (${d.amplitudePct.toFixed(0)}% swing)`)
  } else {
    parts.push('little repeating seasonal shape')
  }

  const perWeek = d.trendPerWeekPct
  if (Math.abs(perWeek) < 0.05) parts.push('flat')
  else parts.push(`trending ${perWeek > 0 ? 'up' : 'down'} ${Math.abs(perWeek * 52).toFixed(0)}% a year`)

  if (d.volatilityPct > 20) parts.push(`very noisy (±${d.volatilityPct.toFixed(0)}%)`)
  else if (d.volatilityPct > 10) parts.push(`noisy (±${d.volatilityPct.toFixed(0)}%)`)
  else parts.push(`steady (±${d.volatilityPct.toFixed(0)}%)`)

  return parts.join(', ')
}

/**
 * Which models suit this shape, and why.
 *
 * Deliberately rule-based and offline: a planner needs the reasoning to be
 * inspectable and available whether or not an AI service is reachable. The
 * optional AI layer explains and challenges this, it does not replace it.
 */
export function suggestModels(d: SeriesDiagnostics): ModelSuggestion[] {
  const out: ModelSuggestion[] = []

  if (d.hasSeasonalEvidence && d.seasonalStrength > 0.4) {
    out.push({
      modelId: 'holt-winters',
      reason: `A repeating annual shape explains ${(d.seasonalStrength * 100).toFixed(0)}% of the variation, and this model tracks level, trend and season separately.`,
    })
    out.push({
      modelId: 'fourier-holidays',
      reason: 'Seasonal, and the only model that can also learn what named holidays do to volume.',
    })
  }

  if (d.trendStrength > 0.4 && (!d.hasSeasonalEvidence || d.seasonalStrength <= 0.4)) {
    out.push({
      modelId: 'theta',
      reason: `A clear trend explains ${(d.trendStrength * 100).toFixed(0)}% of the variation, and Theta extends half of it rather than all — which is why it beats straight extrapolation.`,
    })
  }

  if (!d.hasSeasonalEvidence) {
    out.push({
      modelId: 'theta',
      reason:
        d.seasonalEvidence === 'not_repeating'
          ? 'Nothing here repeats annually, so a smoothed trend describes the series without inventing a cycle for it.'
          : `${d.weeks} weeks cannot evidence an annual cycle, so a smoothed trend is the honest choice until there is more history.`,
    })
    out.push({
      modelId: 'holt-winters',
      reason: 'Falls back to level and trend when no cycle is visible, so it stays usable on short history.',
    })
  }

  if (d.volatilityPct > 20) {
    out.push({
      modelId: 'simple-moving-average',
      reason: `At ±${d.volatilityPct.toFixed(0)}% week to week, a flexible model will chase noise. Include a moving average as the floor any other model must beat.`,
    })
  }

  // De-duplicate, keeping the first reason given for each model.
  const seen = new Set<string>()
  return out.filter((item) => (seen.has(item.modelId) ? false : (seen.add(item.modelId), true)))
}

function cautionsFor(d: SeriesDiagnostics): string[] {
  const out: string[] = []
  if (d.weeks < 26) {
    out.push(
      `Only ${d.weeks} weeks of history. Any model here is extrapolating well beyond what it has seen — treat a 52-week horizon as indicative.`,
    )
  }
  if (d.seasonalEvidence === 'too_short' && d.weeks >= 26) {
    out.push(
      `An annual cycle needs about ${SEASONAL_MIN_WEEKS} weeks to become visible; with ${d.weeks} the seasonal models are fitting level and trend only.`,
    )
  }
  if (d.seasonalEvidence === 'not_repeating') {
    out.push(
      `There are ${d.weeks} weeks of history, but one year does not resemble the next, so nothing here repeats annually. The seasonal models are fitting level and trend only — more history will not change that, though a genuinely seasonal account should show agreement within two years.`,
    )
  }
  if (d.volatilityPct > 20) {
    out.push(
      `Week-to-week noise is ±${d.volatilityPct.toFixed(0)}% of the average. Expect wide forecast ranges, and do not read small accuracy differences between models as meaningful.`,
    )
  }
  if (d.outlierPct > 5) {
    out.push(
      `${d.outlierPct.toFixed(0)}% of weeks sit far outside the pattern. If those were one-off events, the models are treating them as normal variation.`,
    )
  }
  if (Math.abs(d.trendPerWeekPct * 52) > 40) {
    out.push(
      `The trend implies ${Math.abs(d.trendPerWeekPct * 52).toFixed(0)}% change a year. Extrapolated over a full plan that compounds sharply — worth sanity-checking against what the account is actually contracted to do.`,
    )
  }
  return out
}

export function diagnose(values: number[]): DiagnosticsVerdict {
  const diagnostics = diagnoseSeries(values)
  return {
    diagnostics,
    summary: describe(diagnostics),
    suggested: suggestModels(diagnostics),
    cautions: cautionsFor(diagnostics),
  }
}

/**
 * Lightweight forecasting for scenario analysis: naive, moving average, OLS trend, simple exponential smoothing.
 * Error metrics on one-step-ahead fitted values vs actual (last in-sample point uses prior fit).
 */

export interface ForecastModelResult {
  id: string
  label: string
  /** In-sample one-step predictions (length n; first value mirrors naive or y[0]) */
  fitted: number[]
  /** h-step ahead point forecasts from end of series */
  horizon: number[]
  mae: number
  rmse: number
  mapePct: number
}

function maeRmseMape(actual: number[], pred: number[]): { mae: number; rmse: number; mapePct: number } {
  const pairs: { a: number; p: number }[] = []
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i]!
    const p = pred[i]!
    if (!Number.isFinite(a) || !Number.isFinite(p)) continue
    pairs.push({ a, p })
  }
  if (!pairs.length) return { mae: NaN, rmse: NaN, mapePct: NaN }
  let sAbs = 0
  let sSq = 0
  let sApe = 0
  let nApe = 0
  for (const { a, p } of pairs) {
    sAbs += Math.abs(a - p)
    sSq += (a - p) ** 2
    if (Math.abs(a) > 1e-9) {
      sApe += Math.abs((a - p) / a)
      nApe++
    }
  }
  const n = pairs.length
  return {
    mae: sAbs / n,
    rmse: Math.sqrt(sSq / n),
    mapePct: nApe ? (sApe / nApe) * 100 : NaN,
  }
}

function olsSlopeIntercept(y: number[]): { a: number; b: number } {
  const n = y.length
  if (n < 2) return { a: y[0] ?? 0, b: 0 }
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    const x = i
    const yi = y[i]!
    sx += x
    sy += yi
    sxx += x * x
    sxy += x * yi
  }
  const denom = n * sxx - sx * sx
  if (Math.abs(denom) < 1e-12) return { a: sy / n, b: 0 }
  const b = (n * sxy - sx * sy) / denom
  const a = (sy - b * sx) / n
  return { a, b }
}

/** One-step-ahead fitted series + h-step forecasts */
export function runForecastModels(y: number[], horizonSteps: number): ForecastModelResult[] {
  const n = y.length
  if (n < 3) return []

  const h = Math.max(1, horizonSteps)
  const results: ForecastModelResult[] = []

  // Naive: predict y[t] with y[t-1]
  const naiveFitted: number[] = [y[0]!]
  for (let t = 1; t < n; t++) naiveFitted.push(y[t - 1]!)
  const naiveHorizon = Array.from({ length: h }, () => y[n - 1]!)
  const naiveErr = maeRmseMape(y, naiveFitted)
  results.push({
    id: 'naive',
    label: 'Naïve (random walk)',
    fitted: naiveFitted,
    horizon: naiveHorizon,
    ...naiveErr,
  })

  const k = Math.min(4, Math.max(2, Math.floor(n / 3)))
  const maFitted: number[] = []
  for (let t = 0; t < n; t++) {
    if (t < k) maFitted.push(y[t]!)
    else {
      let s = 0
      for (let j = 1; j <= k; j++) s += y[t - j]!
      maFitted.push(s / k)
    }
  }
  const lastMa = maFitted[n - 1]!
  results.push({
    id: 'ma',
    label: `Moving average (k=${k})`,
    fitted: maFitted,
    horizon: Array.from({ length: h }, () => lastMa),
    ...maeRmseMape(y, maFitted),
  })

  const { a, b } = olsSlopeIntercept(y)
  const trendFitted = y.map((_, i) => a + b * i)
  const trendHorizon = Array.from({ length: h }, (_, i) => a + b * (n + i))
  results.push({
    id: 'trend',
    label: 'Linear trend (OLS)',
    fitted: trendFitted,
    horizon: trendHorizon,
    ...maeRmseMape(y, trendFitted),
  })

  const alpha = 0.35
  const ses: number[] = [y[0]!]
  for (let t = 1; t < n; t++) ses.push(alpha * y[t - 1]! + (1 - alpha) * ses[t - 1]!)
  const lastLevel = ses[n - 1]!
  const sesHorizon = Array.from({ length: h }, () => lastLevel)
  results.push({
    id: 'ses',
    label: `Simple exponential smoothing (α=${alpha})`,
    fitted: ses,
    horizon: sesHorizon,
    ...maeRmseMape(y, ses),
  })

  // Every caller works on weekly series, so the repeating cycle is the year,
  // not seven steps. A hardcoded 7 meant "one week" when this ran on daily
  // data; read weekly it claims a seven-week season, which nothing in a
  // contact centre has. Skipped rather than approximated when there is not a
  // year of history plus a little to score against.
  const SEASONAL_PERIOD_WEEKS = 52
  if (n >= SEASONAL_PERIOD_WEEKS + 4) {
    const period = SEASONAL_PERIOD_WEEKS
    const snFitted: number[] = []
    for (let t = 0; t < n; t++) {
      if (t < period) snFitted.push(y[t]!)
      else snFitted.push(y[t - period]!)
    }
    const snHorizon = Array.from({ length: h }, (_, i) => y[n - period + (i % period)]!)
    results.push({
      id: 'seasonal_naive',
      label: `Seasonal naïve (period=${period})`,
      fitted: snFitted,
      horizon: snHorizon,
      ...maeRmseMape(y, snFitted),
    })
  }

  // Holt's linear trend (double exponential smoothing) — good for AHT with drift.
  if (n >= 4) {
    const alphaH = 0.35
    const betaH = 0.15
    const level: number[] = [y[0]!]
    const trend: number[] = [y[1]! - y[0]!]
    const holtFitted: number[] = [y[0]!]
    for (let t = 1; t < n; t++) {
      const prevLevel = level[t - 1]!
      const prevTrend = trend[t - 1]!
      const nextLevel = alphaH * y[t]! + (1 - alphaH) * (prevLevel + prevTrend)
      const nextTrend = betaH * (nextLevel - prevLevel) + (1 - betaH) * prevTrend
      level.push(nextLevel)
      trend.push(nextTrend)
      holtFitted.push(prevLevel + prevTrend)
    }
    const lastLevel = level[n - 1]!
    const lastTrend = trend[n - 1]!
    const holtHorizon = Array.from({ length: h }, (_, i) => Math.max(1, lastLevel + (i + 1) * lastTrend))
    results.push({
      id: 'holt',
      label: `Holt linear trend (α=${alphaH}, β=${betaH})`,
      fitted: holtFitted,
      horizon: holtHorizon,
      ...maeRmseMape(y, holtFitted),
    })
  }

  return results
}

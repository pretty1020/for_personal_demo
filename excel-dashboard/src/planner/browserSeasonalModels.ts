/**
 * Seasonal forecasting that runs in the browser.
 *
 * The Python models could not ship on Vercel — numpy, pandas and scipy alone
 * exceed the 250MB function limit, on every plan. These two are pure arithmetic
 * and run in milliseconds, but they model real seasonality rather than assuming
 * it away, which is what the existing seasonal-naive and linear-trend models do.
 *
 * Holt-Winters is the standard triple exponential smoothing: level, trend and a
 * seasonal cycle, each with its own smoothing rate.
 *
 * Theta won the M3 forecasting competition and still holds up: deseasonalise,
 * forecast with simple exponential smoothing plus half the linear drift, then put
 * the seasonality back. Its accuracy per line of code is hard to beat.
 */

export type SeriesModelResult = {
  /** One-step-ahead in-sample predictions, aligned to the input. */
  fitted: number[]
  /** h-step-ahead forecasts from the end of the series. */
  horizon: number[]
  /** Human-readable description of what was actually fitted. */
  label: string
}

/**
 * Seasonal cycle length for a series grain.
 *
 * Daily data repeats weekly; weekly data repeats annually; monthly data repeats
 * over twelve. A cycle needs two full repetitions before it can be estimated at
 * all, so this returns 0 when the series is too short and callers fall back to a
 * non-seasonal fit.
 */
export function seasonalPeriodFor(grain: 'daily' | 'weekly' | 'monthly', n: number): number {
  const period = grain === 'daily' ? 7 : grain === 'weekly' ? 52 : 12
  return n >= period * 2 ? period : 0
}

function finite(values: number[]): boolean {
  return values.every((value) => Number.isFinite(value))
}

/**
 * Average seasonal indices by position in the cycle.
 *
 * Multiplicative indices are ratios to the series mean and average 1.0; additive
 * indices are offsets and average 0.
 */
function seasonalIndices(y: number[], period: number, multiplicative: boolean): number[] {
  const mean = y.reduce((sum, value) => sum + value, 0) / y.length
  if (multiplicative && Math.abs(mean) < 1e-9) return new Array(period).fill(1)

  const sums = new Array(period).fill(0)
  const counts = new Array(period).fill(0)
  for (let i = 0; i < y.length; i++) {
    const slot = i % period
    sums[slot] += multiplicative ? y[i]! / mean : y[i]! - mean
    counts[slot] += 1
  }
  const raw = sums.map((sum, i) => (counts[i] ? sum / counts[i] : multiplicative ? 1 : 0))

  // Normalise so the indices do not shift the overall level.
  const avg = raw.reduce((sum, value) => sum + value, 0) / period
  if (multiplicative) {
    return Math.abs(avg) < 1e-9 ? new Array(period).fill(1) : raw.map((value) => value / avg)
  }
  return raw.map((value) => value - avg)
}

/** Ordinary least squares slope and intercept of y against its index. */
function linearFit(y: number[]): { slope: number; intercept: number } {
  const n = y.length
  if (n < 2) return { slope: 0, intercept: y[0] ?? 0 }
  const meanX = (n - 1) / 2
  const meanY = y.reduce((sum, value) => sum + value, 0) / n
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (y[i]! - meanY)
    den += (i - meanX) ** 2
  }
  const slope = den === 0 ? 0 : num / den
  return { slope, intercept: meanY - slope * meanX }
}

type HoltWintersFit = {
  fitted: number[]
  horizon: number[]
  sse: number
}

/**
 * One Holt-Winters pass at fixed smoothing rates.
 *
 * Returns null when the parameters produce a non-finite path — multiplicative
 * seasonality diverges if a seasonal index approaches zero, and a diverged fit
 * must not be scored against the others.
 */
function holtWintersPass(
  y: number[],
  period: number,
  alpha: number,
  beta: number,
  gamma: number,
  multiplicative: boolean,
  horizon: number,
): HoltWintersFit | null {
  const seasonal = period > 0 ? seasonalIndices(y.slice(0, period * 2), period, multiplicative) : []

  // Seed level and trend from whole-cycle averages, not from a line through the
  // first cycle. Fitting a line across one seasonal cycle measures the season's
  // own rise, not the underlying trend, which seeds the trend badly wrong and
  // biases every forecast that follows — the in-sample fit still looks fine,
  // because smoothing recovers, but the extrapolation starts from a bad slope.
  let level: number
  let trend: number
  if (period > 0 && y.length >= period * 2) {
    const meanOf = (from: number, to: number) =>
      y.slice(from, to).reduce((sum, value) => sum + value, 0) / (to - from)
    const first = meanOf(0, period)
    const second = meanOf(period, period * 2)
    level = first
    trend = (second - first) / period
  } else {
    const initial = linearFit(y.slice(0, Math.max(2, Math.min(y.length, 4))))
    level = initial.intercept
    trend = initial.slope
  }
  const season = [...seasonal]

  const fitted: number[] = []
  let sse = 0

  for (let i = 0; i < y.length; i++) {
    const slot = period > 0 ? i % period : 0
    const s = period > 0 ? season[slot]! : multiplicative ? 1 : 0

    const prediction = multiplicative ? (level + trend) * s : level + trend + s
    if (!Number.isFinite(prediction)) return null
    fitted.push(prediction)
    sse += (y[i]! - prediction) ** 2

    const observed = y[i]!
    const previousLevel = level
    if (multiplicative) {
      if (Math.abs(s) < 1e-9) return null
      level = alpha * (observed / s) + (1 - alpha) * (level + trend)
    } else {
      level = alpha * (observed - s) + (1 - alpha) * (level + trend)
    }
    trend = beta * (level - previousLevel) + (1 - beta) * trend

    if (period > 0) {
      season[slot] = multiplicative
        ? Math.abs(level) < 1e-9
          ? s
          : gamma * (observed / level) + (1 - gamma) * s
        : gamma * (observed - level) + (1 - gamma) * s
    }
    if (!Number.isFinite(level) || !Number.isFinite(trend)) return null
  }

  const out: number[] = []
  for (let h = 1; h <= horizon; h++) {
    const slot = period > 0 ? (y.length + h - 1) % period : 0
    const s = period > 0 ? season[slot]! : multiplicative ? 1 : 0
    const value = multiplicative ? (level + h * trend) * s : level + h * trend + s
    out.push(value)
  }
  if (!finite(out) || !finite(fitted)) return null
  return { fitted, horizon: out, sse }
}

// Coarse grids. Holt-Winters is cheap enough to search exhaustively at this
// resolution, and finer steps buy nothing on series this short.
const ALPHAS = [0.1, 0.2, 0.3, 0.5, 0.7, 0.9]
const BETAS = [0.02, 0.05, 0.1, 0.2, 0.4]
const GAMMAS = [0.05, 0.1, 0.2, 0.4]

/**
 * Holt-Winters triple exponential smoothing, with the smoothing rates and the
 * seasonal form chosen by in-sample error.
 *
 * Multiplicative seasonality suits demand that swings proportionally with the
 * level — a busy December is 40% up, not "+800 calls" — which is the usual shape
 * for contact volume. Additive suits rates. Rather than guess, both are fitted
 * and the better one wins, unless the series has non-positive values, where
 * multiplicative is undefined.
 */
export function holtWinters(
  y: number[],
  period: number,
  horizon: number,
): SeriesModelResult | null {
  if (y.length < 6 || horizon < 1 || !finite(y)) return null

  const forms: boolean[] = y.every((value) => value > 0) ? [true, false] : [false]

  let best: (HoltWintersFit & { label: string }) | null = null
  for (const multiplicative of forms) {
    for (const alpha of ALPHAS) {
      for (const beta of BETAS) {
        for (const gamma of period > 0 ? GAMMAS : [0]) {
          const fit = holtWintersPass(y, period, alpha, beta, gamma, multiplicative, horizon)
          if (!fit) continue
          if (!best || fit.sse < best.sse) {
            const shape = period > 0 ? (multiplicative ? 'multiplicative' : 'additive') : 'no season'
            best = {
              ...fit,
              label:
                period > 0
                  ? `Holt-Winters (${shape}, m=${period}, α=${alpha}, β=${beta}, γ=${gamma})`
                  : `Holt-Winters (trend only, α=${alpha}, β=${beta})`,
            }
          }
        }
      }
    }
  }

  if (!best) return null
  return { fitted: best.fitted, horizon: best.horizon, label: best.label }
}

/** Simple exponential smoothing, returning the fitted path and final level. */
function ses(y: number[], alpha: number): { fitted: number[]; level: number; sse: number } {
  let level = y[0]!
  const fitted: number[] = []
  let sse = 0
  for (let i = 0; i < y.length; i++) {
    fitted.push(level)
    sse += (y[i]! - level) ** 2
    level = alpha * y[i]! + (1 - alpha) * level
  }
  return { fitted, level, sse }
}

/**
 * The Theta method.
 *
 * Deseasonalise, forecast the remainder, then reseasonalise. The forecast itself
 * uses the Hyndman-Billah equivalence: Theta(2) is simple exponential smoothing
 * plus half the drift of a linear trend fitted to the whole series. Half, because
 * Theta averages a flat line against a doubled-trend line, and the average of the
 * two slopes is half of one.
 *
 * That "half a trend" is the whole trick, and it is why Theta beats naive
 * extrapolation so consistently: it extends the trend without believing all of it.
 */
export function theta(y: number[], period: number, horizon: number): SeriesModelResult | null {
  if (y.length < 5 || horizon < 1 || !finite(y)) return null

  const multiplicative = period > 0 && y.every((value) => value > 0)
  const indices = period > 0 ? seasonalIndices(y, period, multiplicative) : []

  const deseasonalised =
    period > 0
      ? y.map((value, i) =>
          multiplicative ? value / (indices[i % period]! || 1) : value - indices[i % period]!,
        )
      : [...y]

  if (!finite(deseasonalised)) return null

  // Pick alpha on in-sample error, as the standard implementation does.
  let bestAlpha = 0.3
  let bestSse = Infinity
  for (const alpha of ALPHAS) {
    const { sse } = ses(deseasonalised, alpha)
    if (sse < bestSse) {
      bestSse = sse
      bestAlpha = alpha
    }
  }

  const { fitted: sesFitted, level } = ses(deseasonalised, bestAlpha)
  const { slope } = linearFit(deseasonalised)
  const drift = slope / 2

  const reseason = (value: number, index: number): number => {
    if (period === 0) return value
    const s = indices[index % period]!
    return multiplicative ? value * s : value + s
  }

  const fitted = sesFitted.map((value, i) => reseason(value, i))

  const out: number[] = []
  for (let h = 1; h <= horizon; h++) {
    // SES is flat, so the drift term supplies the whole trend.
    const base = level + drift * (h - 1 + 1 / bestAlpha)
    out.push(reseason(base, y.length + h - 1))
  }

  if (!finite(out) || !finite(fitted)) return null

  const shape = period > 0 ? (multiplicative ? 'multiplicative' : 'additive') : 'no season'
  return {
    fitted,
    horizon: out,
    label:
      period > 0
        ? `Theta (${shape} m=${period}, α=${bestAlpha})`
        : `Theta (α=${bestAlpha}, drift ${drift >= 0 ? '+' : ''}${drift.toFixed(2)})`,
  }
}

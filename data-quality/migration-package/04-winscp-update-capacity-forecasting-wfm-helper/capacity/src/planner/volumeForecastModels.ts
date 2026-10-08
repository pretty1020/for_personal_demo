/**
 * Extended volume forecasting models for Staffing Plan Forecasting panel.
 * Builds on the lightweight suite (naive / MA / trend / SES / seasonal naïve)
 * with Holt-Winters, a differenced AR(1) (“ARIMA-like”), and additive seasonal
 * regression (“Prophet-like”) — all client-side, no extra npm packages.
 */

import {
  runForecastModels,
  type ForecastModelResult,
} from '../utils/staffingCapacity/forecastModels'

export type { ForecastModelResult }

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

function clampNonNeg(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, value)
}

/** Additive Holt-Winters with weekly-style seasonality (period 4 or 7). */
function holtWintersAdditive(y: number[], horizonSteps: number, period: number): ForecastModelResult | null {
  const n = y.length
  if (n < period * 2) return null
  const alpha = 0.35
  const beta = 0.15
  const gamma = 0.25
  let level = y.slice(0, period).reduce((s, v) => s + v, 0) / period
  let trend = (y.slice(period, period * 2).reduce((s, v) => s + v, 0) / period - level) / period
  const season = y.slice(0, period).map((v) => v - level)
  const fitted: number[] = []
  for (let t = 0; t < n; t++) {
    const s = season[t % period]!
    const pred = level + trend + s
    fitted.push(clampNonNeg(pred))
    const yt = y[t]!
    const prevLevel = level
    level = alpha * (yt - s) + (1 - alpha) * (level + trend)
    trend = beta * (level - prevLevel) + (1 - beta) * trend
    season[t % period] = gamma * (yt - level) + (1 - gamma) * s
  }
  const horizon = Array.from({ length: horizonSteps }, (_, i) => {
    const step = i + 1
    return clampNonNeg(level + step * trend + season[(n + i) % period]!)
  })
  return {
    id: 'holt_winters',
    label: `Holt-Winters additive (period=${period})`,
    fitted,
    horizon,
    ...maeRmseMape(y, fitted),
  }
}

/** Differenced AR(1) — lightweight ARIMA(1,1,0) stand-in. */
function arimaLike(y: number[], horizonSteps: number): ForecastModelResult | null {
  const n = y.length
  if (n < 4) return null
  const diffs: number[] = []
  for (let i = 1; i < n; i++) diffs.push(y[i]! - y[i - 1]!)
  let num = 0
  let den = 0
  for (let i = 1; i < diffs.length; i++) {
    num += diffs[i]! * diffs[i - 1]!
    den += diffs[i - 1]! ** 2
  }
  const phi = den > 1e-12 ? Math.max(-0.99, Math.min(0.99, num / den)) : 0
  const fitted: number[] = [y[0]!]
  let prevDiff = diffs[0] ?? 0
  for (let t = 1; t < n; t++) {
    const predDiff = phi * prevDiff
    fitted.push(clampNonNeg(y[t - 1]! + predDiff))
    prevDiff = diffs[t - 1] ?? predDiff
  }
  const horizon: number[] = []
  let last = y[n - 1]!
  let d = diffs[diffs.length - 1] ?? 0
  for (let i = 0; i < horizonSteps; i++) {
    d = phi * d
    last = clampNonNeg(last + d)
    horizon.push(last)
  }
  return {
    id: 'arima',
    label: 'ARIMA-like (ARIMA(1,1,0))',
    fitted,
    horizon,
    ...maeRmseMape(y, fitted),
  }
}

/** Additive linear trend + seasonal dummies — Prophet-style decomposition without Stan. */
function prophetLike(y: number[], horizonSteps: number, period: number): ForecastModelResult | null {
  const n = y.length
  if (n < period + 2) return null
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sx += i
    sy += y[i]!
    sxx += i * i
    sxy += i * y[i]!
  }
  const denom = n * sxx - sx * sx
  const b = Math.abs(denom) < 1e-12 ? 0 : (n * sxy - sx * sy) / denom
  const a = (sy - b * sx) / n
  const seasonal = Array.from({ length: period }, () => 0)
  const counts = Array.from({ length: period }, () => 0)
  for (let i = 0; i < n; i++) {
    const residual = y[i]! - (a + b * i)
    seasonal[i % period]! += residual
    counts[i % period]! += 1
  }
  for (let p = 0; p < period; p++) {
    seasonal[p] = counts[p]! > 0 ? seasonal[p]! / counts[p]! : 0
  }
  const meanS = seasonal.reduce((s, v) => s + v, 0) / period
  for (let p = 0; p < period; p++) seasonal[p]! -= meanS

  const fitted = y.map((_, i) => clampNonNeg(a + b * i + seasonal[i % period]!))
  const horizon = Array.from({ length: horizonSteps }, (_, i) => {
    const t = n + i
    return clampNonNeg(a + b * t + seasonal[t % period]!)
  })
  return {
    id: 'prophet',
    label: `Prophet-like (trend + seasonal p=${period})`,
    fitted,
    horizon,
    ...maeRmseMape(y, fitted),
  }
}

export function pickBestForecastModel(models: ForecastModelResult[]): ForecastModelResult | null {
  const scored = models.filter((m) => Number.isFinite(m.mapePct) || Number.isFinite(m.rmse))
  if (!scored.length) return null
  return [...scored].sort((a, b) => {
    const aMap = Number.isFinite(a.mapePct) ? a.mapePct : Number.POSITIVE_INFINITY
    const bMap = Number.isFinite(b.mapePct) ? b.mapePct : Number.POSITIVE_INFINITY
    if (aMap !== bMap) return aMap - bMap
    const aRmse = Number.isFinite(a.rmse) ? a.rmse : Number.POSITIVE_INFINITY
    const bRmse = Number.isFinite(b.rmse) ? b.rmse : Number.POSITIVE_INFINITY
    return aRmse - bRmse
  })[0] ?? null
}

/**
 * Run the full volume-forecast model suite on a weekly Offered Volume series.
 * Seasonality period prefers 7 when enough history exists (DOW-aware weekly patterns),
 * otherwise 4 (monthly-ish cadence on weekly data).
 */
export function runVolumeForecastModels(y: number[], horizonSteps: number): ForecastModelResult[] {
  const n = y.length
  if (n < 3) return []
  const h = Math.max(1, horizonSteps)
  const base = runForecastModels(y, h).map((model) => ({
    ...model,
    horizon: model.horizon.map(clampNonNeg),
    fitted: model.fitted.map(clampNonNeg),
  }))
  const period = n >= 14 ? 7 : n >= 8 ? 4 : 0
  const extras: ForecastModelResult[] = []
  if (period > 0) {
    const hw = holtWintersAdditive(y, h, period)
    if (hw) extras.push(hw)
    const prophet = prophetLike(y, h, period)
    if (prophet) extras.push(prophet)
  }
  const arima = arimaLike(y, h)
  if (arima) extras.push(arima)
  return [...base, ...extras]
}

/**
 * Accuracy measurement for weekly capacity forecasts.
 *
 * Three things a single held-back split cannot give a capacity planner:
 *
 * A *reliable* score. Twelve weeks at a 90/10 split leaves two weeks to score
 * on, and ranking models by two observations is close to a coin toss — in
 * testing the same three models came out in different orders on consecutive
 * runs. Rolling-origin backtesting refits at several cut points and averages,
 * which is the standard remedy for short series.
 *
 * The *right* error measure. WAPE (total error over total volume) is the WFM
 * convention because MAPE divides by each week individually, so a quiet holiday
 * week can dominate the score and a near-zero week can send it to infinity.
 *
 * *Bias*. A forecast running consistently 6% high is a very different problem
 * from one that is 6% out at random: the first overstaffs every single week and
 * leaks margin, and no absolute error measure can tell them apart. It is the
 * first number an experienced planner looks at.
 *
 * Error measures alone also cannot see the most common failure in a short
 * series: a model that wins by refusing to move. Predicting the average every
 * week scores respectably on WAPE while missing every peak and trough, which is
 * precisely the shape a capacity plan is built to staff. Pattern R and the
 * amplitude ratio expose that — they are the two axes of a Taylor diagram, one
 * asking whether the movement is in the right place and the other whether it is
 * the right size.
 */

export type AccuracyScore = {
  /** Weighted absolute percentage error: Σ|error| ÷ Σactual. */
  wape?: number
  /** Mean absolute percentage error, kept for continuity with the old metric. */
  mape?: number
  /** Mean signed percentage error. Positive means the forecast runs high. */
  bias?: number
  rmse?: number
  mae?: number
  /** Points the score was computed on, across all folds. */
  samples?: number
  /** Rolling-origin folds used. 1 means a single held-back split. */
  folds?: number
  /**
   * Pearson correlation between forecast and actual, -1 to 1.
   *
   * Whether the model moves when the business moves. Near zero means the shape
   * is not being tracked at all, however small the error looks.
   */
  patternR?: number
  /**
   * Spread of the forecast over spread of the actuals. 1 is the right size.
   *
   * Below ~0.5 the model is flattening real variation and will understaff peaks
   * while overstaffing troughs; above ~1.5 it is exaggerating swings.
   */
  amplitudeRatio?: number
}

export type Fold = { trainSize: number; testSize: number }

/**
 * Cut points for a rolling-origin backtest.
 *
 * Each fold trains on everything up to a point and is scored on the weeks that
 * follow, walking forward. Folds are sized so every one leaves enough history to
 * fit on — with very short series this degrades to a single split rather than
 * pretending to more evidence than exists.
 */
export function rollingFolds(
  n: number,
  testFraction: number,
  options?: { maxFolds?: number; minTrain?: number },
): Fold[] {
  const maxFolds = options?.maxFolds ?? 5
  const minTrain = options?.minTrain ?? 8

  const testSize = Math.max(1, Math.min(12, Math.round(n * testFraction)))
  if (n - minTrain < testSize) return []

  const folds: Fold[] = []
  for (let i = maxFolds - 1; i >= 0; i--) {
    const trainSize = n - testSize - i * testSize
    if (trainSize < minTrain) continue
    folds.push({ trainSize, testSize })
  }
  // Always at least the final split, so a short series still gets a score.
  if (!folds.length && n - testSize >= minTrain) folds.push({ trainSize: n - testSize, testSize })
  return folds
}

type Pair = { actual: number; predicted: number }

function pairsOf(actual: number[], predicted: number[]): Pair[] {
  return actual
    .map((value, index) => ({ actual: value, predicted: predicted[index]! }))
    .filter((pair) => Number.isFinite(pair.actual) && Number.isFinite(pair.predicted))
}

/**
 * Score a set of actual/predicted pairs gathered across folds.
 *
 * WAPE and bias are computed over the pooled totals rather than averaged per
 * fold, so a fold containing a busy week counts for more than a quiet one —
 * which is what a capacity planner cares about.
 */
export function scorePairs(pairs: Pair[], folds: number): AccuracyScore {
  if (!pairs.length) return {}

  let absError = 0
  let signedError = 0
  let actualTotal = 0
  let squared = 0
  let mapeSum = 0
  let mapeCount = 0

  for (const { actual, predicted } of pairs) {
    const error = predicted - actual
    absError += Math.abs(error)
    signedError += error
    actualTotal += Math.abs(actual)
    squared += error ** 2
    if (Math.abs(actual) > 1e-9) {
      mapeSum += Math.abs(error / actual)
      mapeCount += 1
    }
  }

  const shape = shapeAgreement(pairs)

  return {
    wape: actualTotal > 1e-9 ? (absError / actualTotal) * 100 : undefined,
    mape: mapeCount ? (mapeSum / mapeCount) * 100 : undefined,
    bias: actualTotal > 1e-9 ? (signedError / actualTotal) * 100 : undefined,
    rmse: Math.sqrt(squared / pairs.length),
    mae: absError / pairs.length,
    samples: pairs.length,
    folds,
    patternR: shape.patternR,
    amplitudeRatio: shape.amplitudeRatio,
  }
}

/**
 * Points needed before a correlation is worth showing.
 *
 * A correlation over four weeks swings between -1 and 1 on noise alone; printing
 * "R -0.97" beside a WAPE invites a planner to reject a sound model on evidence
 * that is not there. Below this the metric is withheld rather than estimated,
 * which is the same standard the rest of the scoreboard holds itself to.
 */
const MIN_PATTERN_SAMPLES = 8

/**
 * Correlation and relative spread of forecast against actual.
 *
 * Both are undefined rather than zero when they cannot be computed. A flat run
 * of actuals has no shape to agree with — reporting 0 there would read as "the
 * model failed to track the pattern" when the truth is that there was no
 * pattern to track.
 */
function shapeAgreement(pairs: Pair[]): {
  patternR?: number
  amplitudeRatio?: number
} {
  if (pairs.length < MIN_PATTERN_SAMPLES) return {}

  const n = pairs.length
  const meanActual = pairs.reduce((sum, p) => sum + p.actual, 0) / n
  const meanPredicted = pairs.reduce((sum, p) => sum + p.predicted, 0) / n

  let covariance = 0
  let actualVariance = 0
  let predictedVariance = 0
  for (const { actual, predicted } of pairs) {
    const da = actual - meanActual
    const dp = predicted - meanPredicted
    covariance += da * dp
    actualVariance += da * da
    predictedVariance += dp * dp
  }

  const actualSd = Math.sqrt(actualVariance / (n - 1))
  const predictedSd = Math.sqrt(predictedVariance / (n - 1))
  if (actualSd <= 1e-9) return {}

  const patternR =
    predictedSd <= 1e-9
      ? undefined
      : Math.max(-1, Math.min(1, covariance / Math.sqrt(actualVariance * predictedVariance)))

  return { patternR, amplitudeRatio: predictedSd / actualSd }
}

/**
 * How to read pattern agreement, in a planner's terms.
 *
 * A flat forecast is called out explicitly because it is the failure that hides
 * behind a good error score, and the one most likely to be selected by mistake.
 */
export function describePattern(
  patternR: number | undefined,
  amplitudeRatio: number | undefined,
): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  if (amplitudeRatio != null && amplitudeRatio < 0.35) {
    return { tone: 'bad', text: 'nearly flat — misses peaks and troughs' }
  }
  if (patternR == null) return { tone: 'ok', text: '—' }
  if (patternR < 0.2) return { tone: 'bad', text: 'does not track the shape' }
  if (patternR < 0.5) return { tone: 'warn', text: 'loosely tracks the shape' }
  if (amplitudeRatio != null && amplitudeRatio > 1.6) {
    return { tone: 'warn', text: 'right shape, overstated swings' }
  }
  if (amplitudeRatio != null && amplitudeRatio < 0.6) {
    return { tone: 'warn', text: 'right shape, understated swings' }
  }
  return { tone: 'ok', text: 'tracks the shape' }
}

export function collectPairs(actual: number[], predicted: number[]): Pair[] {
  return pairsOf(actual, predicted)
}

/**
 * Prediction interval half-widths, one per horizon step.
 *
 * Built from the spread of backtest errors rather than the in-sample fit, so the
 * band reflects how wrong this model actually was forecasting forward, not how
 * closely it traced history it had already seen.
 *
 * The band widens with the square root of the horizon: forecast errors compound
 * roughly as a random walk, so week 12 is genuinely less certain than week 1 and
 * a flat band would understate the risk exactly where staffing decisions get
 * expensive.
 */
export function predictionBand(
  residuals: number[],
  horizon: number,
  z = 1.28,
): number[] | undefined {
  const usable = residuals.filter((value) => Number.isFinite(value))
  if (usable.length < 2) return undefined

  const mean = usable.reduce((sum, value) => sum + value, 0) / usable.length
  const variance =
    usable.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, usable.length - 1)
  const sd = Math.sqrt(variance)
  if (!Number.isFinite(sd) || sd <= 0) return undefined

  return Array.from({ length: horizon }, (_, i) => z * sd * Math.sqrt(i + 1))
}

/**
 * How to read a bias figure, in the terms a planner would use.
 *
 * The thresholds are deliberately tight: 5% of a 200-seat account is ten agents
 * every week, which is a real cost rather than a rounding difference.
 */
export function describeBias(bias: number | undefined): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  if (bias == null || !Number.isFinite(bias)) return { tone: 'ok', text: '—' }
  const magnitude = Math.abs(bias)
  const direction = bias > 0 ? 'over' : 'under'
  if (magnitude < 2) return { tone: 'ok', text: 'balanced' }
  if (magnitude < 5) return { tone: 'warn', text: `runs ${direction} slightly` }
  return { tone: 'bad', text: `runs ${direction} consistently` }
}

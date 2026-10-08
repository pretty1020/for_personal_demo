/** Peak raw upload weight across active HoOP intervals for a day. */
export function peakPatternWeight(
  rawBucket: Record<string, number>,
  dayPattern: Record<string, number>,
  activeSlots: string[],
): number {
  if (activeSlots.length === 0) return 0
  const peakRaw = Math.max(0, ...activeSlots.map((interval) => rawBucket[interval] ?? 0))
  if (peakRaw > 0) return peakRaw
  return Math.max(0, ...activeSlots.map((interval) => dayPattern[interval] ?? 0))
}

function buildIntervalWeightMap(
  rawBucket: Record<string, number>,
  dayPattern: Record<string, number>,
  activeSlots: string[],
  followUploadedPattern: boolean,
): { weights: Record<string, number>; weightSum: number; hasRawDayData: boolean } {
  const hasRawDayData = activeSlots.some((slot) => (rawBucket[slot] ?? 0) > 0)
  const weights: Record<string, number> = {}
  let weightSum = 0
  for (const slot of activeSlots) {
    const slotRaw = Math.max(0, rawBucket[slot] ?? 0)
    const slotPct = Math.max(0, dayPattern[slot] ?? 0)
    const weight = followUploadedPattern ? (hasRawDayData ? (slotRaw > 0 ? slotRaw : 0) : slotPct) : 1
    weights[slot] = weight
    weightSum += weight
  }
  return { weights, weightSum, hasRawDayData }
}

/**
 * Interval headcount shaped from upload; interval sums convert to daily FTE via sum(HC)÷fteDailyHours÷(60÷intervalMinutes).
 * Ensures sum(active interval HC) = dailyFte × (fteDailyHours × 60 ÷ intervalMinutes).
 */
export function intervalRequiredHeadcount(
  dailyFte: number,
  interval: string,
  rawBucket: Record<string, number>,
  dayPattern: Record<string, number>,
  activeSlots: string[],
  fteDailyDivisorHours = 7.5,
  intervalMinutes = 30,
  followUploadedPattern = true,
  precomputed?: ReturnType<typeof buildIntervalWeightMap>,
): number {
  if (dailyFte <= 0 || activeSlots.length === 0) return 0
  if (!activeSlots.includes(interval)) return 0

  const rawVal = Math.max(0, rawBucket[interval] ?? 0)
  const pct = Math.max(0, dayPattern[interval] ?? 0)
  const { weights, weightSum, hasRawDayData } = precomputed ?? buildIntervalWeightMap(
    rawBucket,
    dayPattern,
    activeSlots,
    followUploadedPattern,
  )

  if (followUploadedPattern) {
    if (hasRawDayData && rawVal <= 0) return 0
    if (!hasRawDayData && pct <= 0) return 0
  }

  if (weightSum <= 0) return 0

  const headcountBudget = dailyFte * fteDailyDivisorHours * (60 / intervalMinutes)
  const weight = Math.max(0, weights[interval] ?? 0)
  if (weight <= 0) return 0
  return (headcountBudget * weight) / weightSum
}

/** Build day interval requirements from upload weights; scales to exact daily FTE budget (no lunch/break). */
export function buildRequiredIntervalsForDay(
  dailyFte: number,
  rawBucket: Record<string, number>,
  dayPattern: Record<string, number>,
  activeSlots: string[],
  fteDailyDivisorHours: number,
  intervalMinutes: number,
  followUploadedPattern: boolean,
): Record<string, number> {
  const precomputed = buildIntervalWeightMap(rawBucket, dayPattern, activeSlots, followUploadedPattern)
  const intervals: Record<string, number> = {}
  for (const slot of activeSlots) {
    intervals[slot] = intervalRequiredHeadcount(
      dailyFte,
      slot,
      rawBucket,
      dayPattern,
      activeSlots,
      fteDailyDivisorHours,
      intervalMinutes,
      followUploadedPattern,
      precomputed,
    )
  }

  const headcountBudget = dailyFte * fteDailyDivisorHours * (60 / intervalMinutes)
  let sum = Object.values(intervals).reduce((total, value) => total + value, 0)
  if (sum > 0 && headcountBudget > 0 && Math.abs(sum - headcountBudget) > 0.01) {
    const scale = headcountBudget / sum
    for (const slot of activeSlots) {
      intervals[slot] = Math.round((intervals[slot] ?? 0) * scale * 100) / 100
    }
    sum = Object.values(intervals).reduce((total, value) => total + value, 0)
    if (activeSlots.length && Math.abs(sum - headcountBudget) > 0.01) {
      const peakSlot = activeSlots.reduce((best, slot) =>
        (intervals[slot] ?? 0) > (intervals[best] ?? 0) ? slot : best,
      activeSlots[0]!)
      intervals[peakSlot] = Math.round(((intervals[peakSlot] ?? 0) + (headcountBudget - sum)) * 100) / 100
    }
  }

  return intervals
}

export function buildPatternWeightsForDay(
  rawBucket: Record<string, number>,
  dayPattern: Record<string, number>,
  activeSlots: string[],
): Record<string, number> {
  const hasRawDayData = activeSlots.some((slot) => (rawBucket[slot] ?? 0) > 0)
  const weights: Record<string, number> = {}
  for (const interval of activeSlots) {
    const rawVal = rawBucket[interval] ?? 0
    const pct = dayPattern[interval] ?? 0
    weights[interval] = hasRawDayData ? (rawVal > 0 ? rawVal : 0) : pct
  }
  return weights
}

export function peakIntervalHeadcount(intervals: Record<string, number>, hoopIntervals: string[]): number {
  if (!hoopIntervals.length) return 0
  return Math.max(0, ...hoopIntervals.map((interval) => intervals[interval] ?? 0))
}

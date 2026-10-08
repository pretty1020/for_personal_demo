import type { PlannerAssumptions } from './types'

/** Default raw-AHT lift when nesting agents share the handle-time mix. */
export const DEMO_NESTING_AHT_MULTIPLIER = 1.28
export const NESTING_MIX_AMPLIFIER = 2.2

export function demoPlannedShrinkageRate(weekIndex: number, baseRate: number): number {
  const t = weekIndex / 51
  const seasonal = Math.sin(t * Math.PI * 2) * 0.012
  const drift = Math.sin(t * Math.PI * 4 + 0.4) * 0.008
  return Math.min(0.35, Math.max(0.2, baseRate + seasonal + drift))
}

export function demoActualShrinkageRate(weekIndex: number, plannedShrink: number): number {
  const stress = weekIndex % 5 === 0
  const t = weekIndex / 51
  const drift = Math.sin(t * Math.PI * 2 + weekIndex * 0.17) * 0.014
  const bump = stress ? 0.018 : 0.009
  return Math.min(0.38, Math.max(0.22, plannedShrink + bump + drift))
}

export function demoActualAttritionHc(weekIndex: number, plannedAttritionHc: number): number {
  if (plannedAttritionHc <= 0) return 0
  const stress = (weekIndex + 2) % 7 === 0
  const wave = 0.94 + ((weekIndex * 5) % 13) * 0.008
  const factor = stress ? 1.14 : wave
  return Math.max(0, Math.round(plannedAttritionHc * factor))
}

export function demoHistoricalNestingHc(
  weekIndex: number,
  pipelineNesting: number,
  productionHc: number,
  assumptions: PlannerAssumptions,
): number {
  const wave = Math.sin((weekIndex / 7) * Math.PI) * 0.5 + 0.5
  const hiringPulse =
    weekIndex % Math.max(assumptions.newHire.trainingWeeks + assumptions.newHire.nestingWeeks, 1) <
    assumptions.newHire.nestingWeeks
  if (!hiringPulse && wave < 0.35) {
    return 0
  }
  const cohortFromMix = Math.round(productionHc * (0.03 + wave * 0.09))
  const pulseBoost = hiringPulse ? Math.round(productionHc * 0.035) : 0
  return Math.max(0, Math.round(Math.max(pipelineNesting, cohortFromMix) + pulseBoost))
}

/** Raw measured AHT — higher when nesting HC shares the production mix. */
export function demoRawAhtSeconds(
  weekIndex: number,
  baseAht: number,
  nestingHc: number,
  productionHc: number,
  nestingMultiplier = DEMO_NESTING_AHT_MULTIPLIER,
): number {
  const total = Math.max(1, nestingHc + productionHc)
  const nestingShare = nestingHc / total
  const amplifiedShare = Math.min(1, nestingShare * NESTING_MIX_AMPLIFIER)
  const mixPremium = 1 + (nestingMultiplier - 1) * amplifiedShare
  const seasonal = Math.sin((weekIndex / 52) * Math.PI * 2) * 4
  const stress = weekIndex % 6 === 0 ? 9 : 4
  return Math.round((baseAht * mixPremium + seasonal + stress) * 10) / 10
}

export function demoPlannedAhtSeconds(weekIndex: number, baseAht: number): number {
  const seasonal = Math.sin((weekIndex / 52) * Math.PI * 2) * 3
  return Math.round((baseAht + seasonal) * 10) / 10
}

/**
 * Historical ACTUAL call volume with mild trend + seasonality so forecast models
 * (trend / MA / seasonal naïve) have a usable signal across ≥8 weeks.
 */
export function demoHistoricalCallVolume(weekIndex: number, baseVolume: number): number {
  if (!(baseVolume > 0)) return 0
  const t = weekIndex / 51
  const seasonal = Math.sin(t * Math.PI * 2) * 0.06
  const trend = (weekIndex - 3.5) * 0.008
  const pulse = weekIndex % 5 === 0 ? 0.035 : weekIndex % 4 === 0 ? -0.02 : 0
  const noise = (((weekIndex * 17) % 11) - 5) * 0.004
  const factor = Math.max(0.72, Math.min(1.35, 1 + seasonal + trend + pulse + noise))
  return Math.max(0, Math.round(baseVolume * factor))
}

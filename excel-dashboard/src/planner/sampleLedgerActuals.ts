import { addWeeks, isoDate, snapToWeekStart } from './capacityWeekUtils'
import type { ChannelType, WeekStart } from './types'
import type { ImportedActualOverride } from './weeklyLedger'
import {
  sampleStaffingPctForWeek,
  sampleVolumeForStaffingPct,
} from './sampleWorkspace'

export type SampleActualLob = {
  id: string
  forecastVolume: number
  ahtSeconds: number
  occupancyTarget: number
  productionHc: number
  shrinkagePct?: number
  channel?: ChannelType
  chatConcurrency?: number
}

/** Historical actuals seeded on the sample workspace so Forecasting can run without an upload. */
export const SAMPLE_ACTUAL_HISTORY_WEEKS = 12

export function isSampleCapacityScenarioId(scenarioId: string): boolean {
  return scenarioId.startsWith('scenario-apex-') || scenarioId.startsWith('scenario-telco-')
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-9)
  const v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function seedFor(lobId: string): number {
  let hash = 2166136261
  for (let i = 0; i < lobId.length; i += 1) {
    hash ^= lobId.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Last 12 weeks of sample actuals ending the week before plan start.
 *
 * Volumes are sized so Staffing % lands in 95%–105% week on week, with mild
 * measurement noise so forecasting models still have a realistic series.
 */
export function buildSampleActualOverrides(
  lob: SampleActualLob,
  planStartWeek: string,
  weeks = SAMPLE_ACTUAL_HISTORY_WEEKS,
  weekStart: WeekStart = 'sunday',
): ImportedActualOverride[] {
  const planStartIso = snapToWeekStart(planStartWeek, weekStart)
  const planStart = new Date(`${planStartIso}T12:00:00`)
  const random = mulberry32(seedFor(lob.id))
  const overrides: ImportedActualOverride[] = []
  const shrinkageBase = lob.shrinkagePct ?? 0.25
  const channel = lob.channel ?? 'voice'
  const chatConcurrency = lob.chatConcurrency ?? (channel === 'chat' ? 2.5 : 1)

  for (let offset = weeks; offset >= 1; offset -= 1) {
    const week = isoDate(addWeeks(planStart, -offset))
    const progress = (weeks - offset) / Math.max(1, weeks - 1)
    const weekIndex = weeks - offset
    const staffingPct = sampleStaffingPctForWeek(weekIndex, seedFor(lob.id) % 7)
    const ahtNoise = 1 + gaussian(random) * 0.02
    const occupancyNoise = 1 + gaussian(random) * 0.015
    const shrinkageNoise = 1 + gaussian(random) * 0.04

    const ahtSeconds = Math.max(60, Math.round(lob.ahtSeconds * (1 + 0.015 * progress) * ahtNoise))
    const occupancy = clamp(lob.occupancyTarget * occupancyNoise, 0.55, 0.95)
    const totalShrinkagePct = clamp(shrinkageBase * shrinkageNoise, 0.18, 0.32)
    const absenteeism = clamp(
      0.055 * (1 + 0.15 * Math.sin(2 * Math.PI * (progress - 0.15))) * (1 + gaussian(random) * 0.1),
      0.03,
      0.1,
    )
    const attritionHc = 0
    const productionHc = Math.max(1, lob.productionHc)

    const callVolume = Math.max(
      1,
      Math.round(
        sampleVolumeForStaffingPct(
          {
            productionHc,
            ahtSeconds,
            occupancyTarget: occupancy,
            channel,
            chatConcurrency,
          },
          staffingPct,
          totalShrinkagePct,
        ),
      ),
    )
    const handledVolume = Math.max(1, Math.round(callVolume * (0.985 + random() * 0.012)))

    overrides.push({
      week,
      notes: 'Sample actual (last 12 weeks)',
      metrics: {
        callVolume,
        handledVolume,
        ahtSeconds,
        occupancy,
        attritionHc,
        productionHc,
        beginningProductionHc: productionHc,
        totalShrinkagePct,
      },
      shrinkageById: {
        absenteeism,
      },
    })
  }

  return overrides
}

export function buildSampleLedgerOverrideStore(
  lobs: readonly SampleActualLob[],
  planStartWeek: string,
  weekStart: WeekStart = 'sunday',
): Record<string, ImportedActualOverride[]> {
  return Object.fromEntries(
    lobs.map((lob) => [lob.id, buildSampleActualOverrides(lob, planStartWeek, SAMPLE_ACTUAL_HISTORY_WEEKS, weekStart)]),
  )
}

const SAMPLE_ACTUAL_CACHE = new Map<string, ImportedActualOverride[]>()

/** One week of sample actuals, or null when the week is outside the last-12-week window. */
export function sampleActualOverrideForWeek(
  lob: SampleActualLob,
  planStartWeek: string,
  week: string,
  weekStart: WeekStart = 'sunday',
): ImportedActualOverride | null {
  const start = snapToWeekStart(planStartWeek, weekStart)
  const target = snapToWeekStart(week, weekStart)
  const cacheKey = `${lob.id}|${start}|${weekStart}`
  let series = SAMPLE_ACTUAL_CACHE.get(cacheKey)
  if (!series) {
    series = buildSampleActualOverrides(lob, start, SAMPLE_ACTUAL_HISTORY_WEEKS, weekStart)
    SAMPLE_ACTUAL_CACHE.set(cacheKey, series)
  }
  return series.find((item) => item.week === target) ?? null
}

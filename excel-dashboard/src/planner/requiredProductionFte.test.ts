import { describe, expect, it } from 'vitest'
import { defaultChannelAssumptions } from './channelPlanning'
import {
  adjustedBackOfficeVolume,
  adjustedEmailVolume,
  buildRequiredProductionFteBreakdown,
  calculateRequiredProductionFteForChannel,
  calculateWorkloadRequiredProductionFte,
  ceilingAgents,
  combineRequiredProductionFteTotal,
  normalizePercentInput,
  paidFteFromRequired,
  resolveRequiredProductionFteForPlan,
} from './requiredProductionFte'
import type { PlannerAssumptions, PlannerPlanMetadata } from './types'

function baseAssumptions(overrides: Partial<PlannerAssumptions['channels']> = {}): PlannerAssumptions {
  return {
    newHire: {
      hiringPlanPerPeriod: 0,
      classSize: 18,
      trainingWeeks: 4,
      trainingAttritionRate: 0.08,
      graduationRate: 0.9,
      nestingWeeks: 2,
      nestingAttritionRate: 0.04,
      nestingPhoneTimePct: 0.5,
      nestingPhoneTimeRamp: [],
      graduationWeek: 6,
      timeToProficiencyWeeks: 8,
      rampCurve: [],
      hiringDelayWeeks: 0,
      trainingCostPerHire: 0,
    },
    tenured: {
      beginningProductionHeadcount: 100,
      attritionRateMonthly: 0.02,
      shrinkageRate: 0.25,
      shrinkageInOfficeShare: 0.4,
      standardScheduledHoursPerWeek: 40,
      otHoursPerFtePerWeek: 0,
      vtoHoursPerFtePerWeek: 0,
      occupancyTarget: 0.85,
      productivityFactor: 1,
      attendanceRate: 1,
      scheduleAdherence: 1,
      ahtSeconds: 285,
      utilizationTarget: 0.85,
      crossSkilledShare: 0,
      productiveHoursPerFtePerWeek: 40,
      laborCostPerFteMonthly: 0,
    },
    business: {
      baseForecastVolume: 45000,
      growthRateMonthly: 0,
      seasonalityFactors: [],
      serviceLevelTarget: 0.8,
      asaTargetSeconds: 20,
      responseTimeTargetSeconds: 0,
      budgetConstraintMonthly: 0,
      revenueTargetMonthly: 0,
      requiredOccupancy: 0.85,
      staffingBufferPct: 0,
      revenuePerContact: 0,
      billingRate: 0,
      hourlySalaryUsd: 0,
      supportSalaryUsd: 0,
      trainingSalaryRateUsd: 0,
      otherCostUsd: 0,
      slaPenaltyPerMissedPoint: 0,
      overtimeMultiplier: 1.5,
    },
    channels: overrides,
  }
}

function planMeta(channels: PlannerPlanMetadata['supportedChannels'], extra: Partial<PlannerPlanMetadata> = {}): PlannerPlanMetadata {
  return {
    client: 'Demo',
    location: 'US',
    billingType: 'Production Hours',
    weekStart: 'sunday',
    supportedChannels: channels,
    ...extra,
  }
}

describe('normalizePercentInput', () => {
  it('accepts 85 or 0.85', () => {
    expect(normalizePercentInput(85)).toBe(0.85)
    expect(normalizePercentInput(0.85)).toBe(0.85)
  })
})

describe('calculateWorkloadRequiredProductionFte', () => {
  it('calculates voice-style weekly FTE', () => {
    // (1000 * 300) / (40 * 3600 * 0.85) = 300000 / 122400 ≈ 2.45098
    const fte = calculateWorkloadRequiredProductionFte({
      volume: 1000,
      ahtSeconds: 300,
      productiveSeconds: 40 * 3600,
      occupancy: 0.85,
    })
    expect(fte).toBeCloseTo(2.45098, 4)
  })

  it('applies concurrency for chat', () => {
    const without = calculateWorkloadRequiredProductionFte({
      volume: 1000,
      ahtSeconds: 300,
      productiveSeconds: 40 * 3600,
      occupancy: 0.85,
      concurrency: 1,
    })
    const withConcurrency = calculateWorkloadRequiredProductionFte({
      volume: 1000,
      ahtSeconds: 300,
      productiveSeconds: 40 * 3600,
      occupancy: 0.85,
      concurrency: 2,
    })
    expect(withConcurrency!).toBeCloseTo(without! / 2, 6)
  })

  it('rejects invalid occupancy and concurrency', () => {
    expect(
      calculateWorkloadRequiredProductionFte({
        volume: 100,
        ahtSeconds: 200,
        productiveSeconds: 3600,
        occupancy: 0,
      }),
    ).toBeNull()
    expect(
      calculateWorkloadRequiredProductionFte({
        volume: 100,
        ahtSeconds: 200,
        productiveSeconds: 3600,
        occupancy: 0.85,
        concurrency: 0.5,
      }),
    ).toBeNull()
  })

  it('returns 0 for zero volume', () => {
    expect(
      calculateWorkloadRequiredProductionFte({
        volume: 0,
        ahtSeconds: 200,
        productiveSeconds: 3600,
        occupancy: 0.85,
      }),
    ).toBe(0)
  })
})

describe('channel Required Production FTE', () => {
  it('voice uses productive hours × occupancy (no concurrency)', () => {
    const assumptions = defaultChannelAssumptions('voice', {
      forecastVolume: 1000,
      ahtSeconds: 300,
      paidHoursPerFte: 40,
      occupancyTarget: 0.85,
      shrinkagePct: 0.3,
      chatConcurrency: 5,
    })
    const result = calculateRequiredProductionFteForChannel('voice', assumptions)
    expect(result.incomplete).toBe(false)
    expect(result.requiredProductionFte).toBeCloseTo(2.45098, 4)
    // Concurrency must not affect voice
    const withLowerConcurrency = calculateRequiredProductionFteForChannel('voice', {
      ...assumptions,
      chatConcurrency: 1,
    })
    expect(withLowerConcurrency.requiredProductionFte).toBeCloseTo(result.requiredProductionFte!, 6)
  })

  it('chat divides by concurrency', () => {
    const assumptions = defaultChannelAssumptions('chat', {
      forecastVolume: 1000,
      ahtSeconds: 300,
      paidHoursPerFte: 40,
      occupancyTarget: 0.85,
      chatConcurrency: 2,
      shrinkagePct: 0.2,
    })
    const result = calculateRequiredProductionFteForChannel('chat', assumptions)
    expect(result.incomplete).toBe(false)
    expect(result.requiredProductionFte).toBeCloseTo(1.22549, 4)
    expect(result.paidFte).toBeCloseTo(result.requiredProductionFte! / 0.8, 4)
  })

  it('sms uses messaging concurrency and optional reopen/carryover', () => {
    const assumptions = defaultChannelAssumptions('sms', {
      forecastVolume: 1000,
      ahtSeconds: 120,
      paidHoursPerFte: 40,
      occupancyTarget: 0.8,
      chatConcurrency: 3,
      reopenRate: 0.1,
      carryoverWorkload: 100,
    })
    const result = calculateRequiredProductionFteForChannel('sms', assumptions)
    // Adjusted volume = 1000*1.1 + 100 = 1200
    expect(result.incomplete).toBe(false)
    expect(result.forecastVolume).toBe(1200)
    expect(result.requiredProductionFte).toBeCloseTo((1200 * 120) / (40 * 3600 * 0.8 * 3), 6)
  })

  it('email includes backlog adjustment', () => {
    expect(adjustedEmailVolume(defaultChannelAssumptions('email', { backlogVolume: 50, targetBacklogReduction: 25 }), 100)).toBe(
      175,
    )
    const assumptions = defaultChannelAssumptions('email', {
      forecastVolume: 100,
      ahtSeconds: 360,
      paidHoursPerFte: 40,
      occupancyTarget: 0.85,
      backlogVolume: 50,
      targetBacklogReduction: 25,
      shrinkagePct: 0.25,
    })
    const result = calculateRequiredProductionFteForChannel('email', assumptions)
    expect(result.incomplete).toBe(false)
    expect(result.requiredProductionFte).toBeCloseTo((175 * 360) / (40 * 3600 * 0.85), 6)
  })

  it('back office includes rework', () => {
    expect(
      adjustedBackOfficeVolume(
        defaultChannelAssumptions('backOffice', { backlogVolume: 20, targetBacklogReduction: 10, reworkPct: 0.1 }),
        100,
      ),
    ).toBeCloseTo(143, 6)
  })

  it('social posts mode ignores concurrency', () => {
    const dm = calculateRequiredProductionFteForChannel(
      'social',
      defaultChannelAssumptions('social', {
        forecastVolume: 500,
        ahtSeconds: 180,
        paidHoursPerFte: 40,
        occupancyTarget: 0.85,
        chatConcurrency: 3,
        socialWorkloadMode: 'direct_messages',
      }),
    )
    const posts = calculateRequiredProductionFteForChannel(
      'social',
      defaultChannelAssumptions('social', {
        forecastVolume: 500,
        ahtSeconds: 180,
        paidHoursPerFte: 40,
        occupancyTarget: 0.85,
        chatConcurrency: 3,
        socialWorkloadMode: 'posts_comments_reviews',
      }),
    )
    expect(dm.requiredProductionFte!).toBeCloseTo(posts.requiredProductionFte! / 3, 6)
  })

  it('video appointment mode uses peak + buffer', () => {
    const result = calculateRequiredProductionFteForChannel(
      'video',
      defaultChannelAssumptions('video', {
        appointmentMode: 1,
        peakConcurrentAppointments: 10,
        bufferFte: 2,
        ahtSeconds: 0, // not required in appointment mode
        occupancyTarget: 0,
        paidHoursPerFte: 0,
      }),
    )
    expect(result.incomplete).toBe(false)
    expect(result.requiredProductionFte).toBe(12)
  })

  it('video live sessions use occupancy formula', () => {
    const result = calculateRequiredProductionFteForChannel(
      'video',
      defaultChannelAssumptions('video', {
        forecastVolume: 200,
        ahtSeconds: 900,
        paidHoursPerFte: 40,
        occupancyTarget: 0.8,
        appointmentMode: 0,
      }),
    )
    expect(result.incomplete).toBe(false)
    expect(result.requiredProductionFte).toBeCloseTo((200 * 900) / (40 * 3600 * 0.8), 6)
  })

  it('marks incomplete inputs instead of returning silent zero', () => {
    const result = calculateRequiredProductionFteForChannel(
      'chat',
      defaultChannelAssumptions('chat', {
        forecastVolume: 1000,
        ahtSeconds: 0,
        occupancyTarget: 0.85,
        chatConcurrency: 2,
        paidHoursPerFte: 40,
      }),
    )
    expect(result.incomplete).toBe(true)
    expect(result.requiredProductionFte).toBeNull()
    expect(result.incompleteMessage).toMatch(/greater than zero/i)
  })

  it('rejects invalid occupancy', () => {
    const zero = calculateRequiredProductionFteForChannel(
      'voice',
      defaultChannelAssumptions('voice', {
        forecastVolume: 1000,
        ahtSeconds: 300,
        paidHoursPerFte: 40,
        occupancyTarget: 0,
      }),
    )
    expect(zero.incomplete).toBe(true)

    const over = calculateRequiredProductionFteForChannel(
      'voice',
      defaultChannelAssumptions('voice', {
        forecastVolume: 1000,
        ahtSeconds: 300,
        paidHoursPerFte: 40,
        occupancyTarget: 150, // normalizes to 1.5 → invalid
      }),
    )
    expect(over.incomplete).toBe(true)
  })
})

describe('Paid FTE and ceiling', () => {
  it('converts Required Production FTE to Paid FTE after shrinkage', () => {
    expect(paidFteFromRequired(10, 0.25)).toBeCloseTo(13.3333, 3)
    expect(paidFteFromRequired(10, 85)).toBeCloseTo(10 / 0.15, 4)
    expect(paidFteFromRequired(10, 0.85)).toBeCloseTo(10 / 0.15, 4)
    expect(paidFteFromRequired(10, 1)).toBeNull()
    expect(paidFteFromRequired(-1, 0.2)).toBeNull()
  })

  it('ceilings whole agents without rounding components early', () => {
    expect(ceilingAgents(2.01)).toBe(3)
    expect(ceilingAgents(2)).toBe(2)
    expect(ceilingAgents(null)).toBeNull()
  })
})

describe('multi-channel combine', () => {
  const voice = calculateRequiredProductionFteForChannel(
    'voice',
    defaultChannelAssumptions('voice', {
      forecastVolume: 1000,
      ahtSeconds: 300,
      paidHoursPerFte: 40,
      occupancyTarget: 0.85,
    }),
  )
  const chat = calculateRequiredProductionFteForChannel(
    'chat',
    defaultChannelAssumptions('chat', {
      forecastVolume: 1000,
      ahtSeconds: 300,
      paidHoursPerFte: 40,
      occupancyTarget: 0.85,
      chatConcurrency: 2,
    }),
  )

  it('sums dedicated agents', () => {
    const combined = combineRequiredProductionFteTotal([voice, chat], 'dedicated_agents', planMeta(['voice', 'chat']))
    expect(combined.total).toBeCloseTo(voice.requiredProductionFte! + chat.requiredProductionFte!, 6)
  })

  it('requires blending efficiency for blended agents', () => {
    const missing = combineRequiredProductionFteTotal([voice, chat], 'blended_agents', planMeta(['voice', 'chat']))
    expect(missing.total).toBeNull()
    expect(missing.incompleteMessage).toMatch(/blending efficiency/i)

    const withEfficiency = combineRequiredProductionFteTotal(
      [voice, chat],
      'blended_agents',
      planMeta(['voice', 'chat'], { blendingEfficiency: 0.1 }),
    )
    expect(withEfficiency.total).toBeCloseTo((voice.requiredProductionFte! + chat.requiredProductionFte!) * 0.9, 6)
  })

  it('simultaneous handling uses idle capacity and shared factor', () => {
    const missing = combineRequiredProductionFteTotal(
      [voice, chat],
      'simultaneous_handling',
      planMeta(['voice', 'chat'], { requiredProductionPrimaryChannel: 'voice' }),
    )
    expect(missing.total).toBeNull()

    const combined = combineRequiredProductionFteTotal(
      [voice, chat],
      'simultaneous_handling',
      planMeta(['voice', 'chat'], {
        requiredProductionPrimaryChannel: 'voice',
        idleCapacityPct: 0.2,
        sharedCapacityFactor: 0.5,
      }),
    )
    const usable = voice.requiredProductionFte! * 0.2 * 0.5
    const expected = voice.requiredProductionFte! + Math.max(0, chat.requiredProductionFte! - usable)
    expect(combined.total).toBeCloseTo(expected, 6)
  })
})

describe('buildRequiredProductionFteBreakdown', () => {
  it('builds voice-only breakdown with paid FTE', () => {
    const assumptions = baseAssumptions({
      voice: defaultChannelAssumptions('voice', {
        forecastVolume: 1000,
        ahtSeconds: 300,
        paidHoursPerFte: 40,
        occupancyTarget: 0.85,
        shrinkagePct: 0.25,
      }),
    })
    const breakdown = buildRequiredProductionFteBreakdown(assumptions, planMeta(['voice']))
    expect(breakdown.incomplete).toBe(false)
    expect(breakdown.totalRequiredFte).toBeCloseTo(2.45098, 4)
    expect(breakdown.totalPaidFte).toBeCloseTo(2.45098 / 0.75, 4)
    expect(breakdown.totalRequiredAgentsCeiling).toBe(3)
  })

  it('does not invent a result when inputs are incomplete', () => {
    const assumptions = baseAssumptions({
      chat: defaultChannelAssumptions('chat', {
        forecastVolume: 1000,
        ahtSeconds: 0,
        paidHoursPerFte: 40,
        occupancyTarget: 0.85,
        chatConcurrency: 2,
      }),
    })
    const breakdown = buildRequiredProductionFteBreakdown(assumptions, planMeta(['chat']))
    expect(breakdown.incomplete).toBe(true)
    expect(breakdown.totalRequiredFte).toBeNull()
  })
})

describe('weekly matrix drivers for Required Production FTE', () => {
  it('applies week Volume, AHT, and Occupancy for voice', () => {
    const assumptions = baseAssumptions({
      voice: defaultChannelAssumptions('voice', {
        forecastVolume: 5000,
        ahtSeconds: 200,
        paidHoursPerFte: 40,
        occupancyTarget: 0.9,
      }),
    })
    // Week drivers should replace channel setup AHT/occ and scale volume.
    const fte = resolveRequiredProductionFteForPlan(assumptions, planMeta(['voice']), 1000, {
      volume: 1000,
      ahtSeconds: 300,
      occupancy: 0.85,
    })
    expect(fte).toBeCloseTo(2.45098, 4)
  })

  it('applies concurrency for chat / transactional staffing', () => {
    const assumptions = baseAssumptions({
      chat: defaultChannelAssumptions('chat', {
        forecastVolume: 2000,
        ahtSeconds: 200,
        paidHoursPerFte: 40,
        occupancyTarget: 0.9,
        chatConcurrency: 2,
      }),
    })
    const fte = resolveRequiredProductionFteForPlan(assumptions, planMeta(['chat']), 1000, {
      volume: 1000,
      ahtSeconds: 300,
      occupancy: 0.85,
    })
    // (1000 × 300) / (40 × 3600 × 0.85 × 2) ≈ 1.22549
    expect(fte).toBeCloseTo(1.22549, 4)
  })

  it('uses processing time for back office transactions', () => {
    const assumptions = baseAssumptions({
      backOffice: defaultChannelAssumptions('backOffice', {
        forecastVolume: 500,
        ahtSeconds: 120,
        paidHoursPerFte: 40,
        occupancyTarget: 0.85,
        backlogVolume: 0,
        targetBacklogReduction: 0,
        reworkPct: 0,
      }),
    })
    const fte = resolveRequiredProductionFteForPlan(assumptions, planMeta(['backOffice']), 500, {
      volume: 500,
      ahtSeconds: 180, // processing time from matrix
      occupancy: 0.8,
    })
    expect(fte).toBeCloseTo((500 * 180) / (40 * 3600 * 0.8), 6)
  })

  it('returns 0 when weekly volume is zero', () => {
    const assumptions = baseAssumptions({
      voice: defaultChannelAssumptions('voice', {
        forecastVolume: 1000,
        ahtSeconds: 300,
        paidHoursPerFte: 40,
        occupancyTarget: 0.85,
      }),
    })
    expect(resolveRequiredProductionFteForPlan(assumptions, planMeta(['voice']), 0)).toBe(0)
  })

  it('applies weekly volume across multi-channel plans when channel forecasts are 0', () => {
    const assumptions = baseAssumptions({
      voice: defaultChannelAssumptions('voice', {
        forecastVolume: 0,
        ahtSeconds: 300,
        paidHoursPerFte: 40,
        occupancyTarget: 0.85,
        channelMixPct: 0.6,
      }),
      chat: defaultChannelAssumptions('chat', {
        forecastVolume: 0,
        ahtSeconds: 300,
        paidHoursPerFte: 40,
        occupancyTarget: 0.85,
        chatConcurrency: 2,
        channelMixPct: 0.4,
      }),
    })
    const fte = resolveRequiredProductionFteForPlan(assumptions, planMeta(['voice', 'chat']), 10000, {
      volume: 10000,
      ahtSeconds: 300,
      occupancy: 0.85,
    })
    expect(fte).not.toBeNull()
    expect(fte!).toBeGreaterThan(0)
    // Voice share 6000 → (6000×300)/(40×3600×0.85) ≈ 14.7059
    // Chat share 4000 → (4000×300)/(40×3600×0.85×2) ≈ 4.9020
    expect(fte!).toBeCloseTo(14.70588 + 4.90196, 3)
  })

  it('computes voice Required FTE when channel setup AHT/occ are 0 but week drivers exist', () => {
    const assumptions = baseAssumptions({
      voice: defaultChannelAssumptions('voice', {
        forecastVolume: 0,
        ahtSeconds: 0,
        paidHoursPerFte: 40,
        occupancyTarget: 0,
        channelMixPct: 1,
      }),
    })
    assumptions.tenured.ahtSeconds = 285
    assumptions.tenured.occupancyTarget = 0.85
    const fte = resolveRequiredProductionFteForPlan(assumptions, planMeta(['voice']), 8000, {
      volume: 8000,
      ahtSeconds: 300,
      occupancy: 0.85,
    })
    expect(fte).toBeCloseTo((8000 * 300) / (40 * 3600 * 0.85), 4)
  })
})

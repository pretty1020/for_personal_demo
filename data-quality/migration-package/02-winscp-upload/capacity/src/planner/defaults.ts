import { newId } from '../utils/newId'
import type { ChannelAssumptions, ChannelType, PlannerAssumptions, PlannerPlanMetadata, PlannerScenario } from './types'
import {
  PORTFOLIO_LABOR_COST_PER_FTE_MONTHLY,
  PORTFOLIO_MONTHLY_CONTACT_VOLUME,
  PORTFOLIO_MONTHLY_COST_BUDGET,
  PORTFOLIO_MONTHLY_REVENUE_TARGET,
  PORTFOLIO_REVENUE_PER_CONTACT,
} from '../utils/portfolioConstants'
import { BILLING_RATE_BANDS } from '../utils/staffingCapacity/billingModel'
import { defaultChannelAssumptions } from './channelPlanning'
import { defaultCapacityPlanStartWeek } from './capacityWeekUtils'

export const DEFAULT_PLANNED_OCCUPANCY = 0.85

export const DEFAULT_SUPPORTED_CHANNELS: ChannelType[] = ['voice']

export function buildDefaultChannelAssumptions(): Partial<Record<ChannelType, ChannelAssumptions>> {
  return {
    voice: defaultChannelAssumptions('voice', {
      forecastVolume: PORTFOLIO_MONTHLY_CONTACT_VOLUME,
      ahtSeconds: 285,
      paidHoursPerFte: 40,
      occupancyTarget: DEFAULT_PLANNED_OCCUPANCY,
      shrinkagePct: 0.25,
      productivityPct: 0.94,
      chatConcurrency: 1,
      channelMixPct: 1,
      revenuePerContact: PORTFOLIO_REVENUE_PER_CONTACT,
      startingProductionHc: 0,
    }),
  }
}

export const DEFAULT_ASSUMPTIONS: PlannerAssumptions = {
  newHire: {
    hiringPlanPerPeriod: 4,
    classSize: 18,
    trainingWeeks: 4,
    trainingAttritionRate: 0.08,
    graduationRate: 0.9,
    nestingWeeks: 2,
    nestingAttritionRate: 0.04,
    nestingPhoneTimePct: 0.5,
    nestingPhoneTimeRamp: [0.25, 0.5, 0.75, 1],
    graduationWeek: 6,
    timeToProficiencyWeeks: 6,
    rampCurve: [0.78, 0.84, 0.88, 0.92, 0.96, 1.0],
    hiringDelayWeeks: 2,
    trainingCostPerHire: 1_800,
  },
  tenured: {
    beginningProductionHeadcount: 0,
    attritionRateMonthly: 0.032,
    shrinkageRate: 0.25,
    shrinkageInOfficeShare: 0.58,
    standardScheduledHoursPerWeek: 40,
    otHoursPerFtePerWeek: 1.5,
    vtoHoursPerFtePerWeek: 0.8,
    occupancyTarget: DEFAULT_PLANNED_OCCUPANCY,
    productivityFactor: 0.94,
    attendanceRate: 0.96,
    scheduleAdherence: 0.92,
    ahtSeconds: 285,
    utilizationTarget: 0.8,
    crossSkilledShare: 0.14,
    productiveHoursPerFtePerWeek: 23.7,
    laborCostPerFteMonthly: PORTFOLIO_LABOR_COST_PER_FTE_MONTHLY,
  },
  business: {
    baseForecastVolume: PORTFOLIO_MONTHLY_CONTACT_VOLUME,
    growthRateMonthly: 0.015,
    seasonalityFactors: [1.0, 1.01, 1.04, 1.02, 0.99, 0.97, 0.98, 1.0, 1.03, 1.05, 1.07, 1.02],
    serviceLevelTarget: 0.82,
    asaTargetSeconds: 28,
    responseTimeTargetSeconds: 120,
    budgetConstraintMonthly: PORTFOLIO_MONTHLY_COST_BUDGET,
    revenueTargetMonthly: PORTFOLIO_MONTHLY_REVENUE_TARGET,
    requiredOccupancy: 0.75,
    staffingBufferPct: 0.04,
    revenuePerContact: PORTFOLIO_REVENUE_PER_CONTACT,
    billingRate: (BILLING_RATE_BANDS['Production Hours'].min + BILLING_RATE_BANDS['Production Hours'].max) / 2,
    hourlySalaryUsd: Math.round((PORTFOLIO_LABOR_COST_PER_FTE_MONTHLY / 173.33) * 100) / 100,
    supportSalaryUsd: 2_500,
    trainingSalaryRateUsd: 450,
    otherCostUsd: 1_500,
    slaPenaltyPerMissedPoint: 180,
    overtimeMultiplier: 1.5,
  },
  channels: buildDefaultChannelAssumptions(),
}

export function createCleanAssumptions(): PlannerAssumptions {
  return {
    newHire: {
      hiringPlanPerPeriod: 0,
      classSize: 1,
      trainingWeeks: 1,
      trainingAttritionRate: 0,
      graduationRate: 1,
      nestingWeeks: 1,
      nestingAttritionRate: 0,
      nestingPhoneTimePct: 0,
      nestingPhoneTimeRamp: [0],
      graduationWeek: 2,
      timeToProficiencyWeeks: 1,
      rampCurve: [1],
      hiringDelayWeeks: 0,
      trainingCostPerHire: 0,
    },
    tenured: {
      beginningProductionHeadcount: 0,
      attritionRateMonthly: 0,
      shrinkageRate: 0,
      shrinkageInOfficeShare: 0.58,
      standardScheduledHoursPerWeek: 40,
      otHoursPerFtePerWeek: 0,
      vtoHoursPerFtePerWeek: 0,
      occupancyTarget: 0,
      productivityFactor: 0,
      attendanceRate: 1,
      scheduleAdherence: 1,
      ahtSeconds: 0,
      utilizationTarget: 0,
      crossSkilledShare: 0,
      productiveHoursPerFtePerWeek: 0,
      laborCostPerFteMonthly: 0,
    },
    business: {
      baseForecastVolume: 0,
      growthRateMonthly: 0,
      seasonalityFactors: Array.from({ length: 12 }, () => 1),
      serviceLevelTarget: 0,
      asaTargetSeconds: 0,
      responseTimeTargetSeconds: 0,
      budgetConstraintMonthly: 0,
      revenueTargetMonthly: 0,
      requiredOccupancy: 0,
      staffingBufferPct: 0,
      revenuePerContact: 0,
      billingRate: 0,
      hourlySalaryUsd: 0,
      supportSalaryUsd: 0,
      trainingSalaryRateUsd: 0,
      otherCostUsd: 0,
      slaPenaltyPerMissedPoint: 0,
      overtimeMultiplier: 1,
    },
    channels: {},
  }
}

export const DEFAULT_PLAN_METADATA: PlannerPlanMetadata = {
  client: 'New client',
  lob: 'New LOB',
  location: '',
  billingType: 'FTE',
  projectCode: '',
  projectName: '',
  weekStart: 'sunday',
  supportedChannels: DEFAULT_SUPPORTED_CHANNELS,
  capacityPlanStartWeek: defaultCapacityPlanStartWeek('sunday'),
}

export function createScenario(
  name: string,
  description = '',
  assumptions = DEFAULT_ASSUMPTIONS,
  plan: PlannerPlanMetadata = DEFAULT_PLAN_METADATA,
): PlannerScenario {
  const now = new Date().toISOString()
  return {
    id: newId(),
    name,
    description,
    plan: {
      ...plan,
      capacityPlanStartWeek: plan.capacityPlanStartWeek ?? defaultCapacityPlanStartWeek(plan.weekStart),
    },
    assumptions: structuredClone(assumptions),
    isBaseline: false,
    createdAt: now,
    updatedAt: now,
  }
}

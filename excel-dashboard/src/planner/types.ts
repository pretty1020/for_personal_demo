/** Workforce Capacity Planning & Financial Simulation — core types */

export type PeriodGranularity = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
export type WeekStart = 'sunday' | 'monday'

/** Supported omnichannel workforce planning channels. */
export type ChannelType =
  | 'voice'
  | 'chat'
  | 'email'
  | 'sms'
  | 'social'
  | 'backOffice'
  | 'video'
  | 'blended'

export const CHANNEL_TYPES: ChannelType[] = [
  'voice',
  'chat',
  'email',
  'sms',
  'social',
  'backOffice',
  'video',
  'blended',
]

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  voice: 'Voice',
  chat: 'Chat',
  email: 'Email',
  sms: 'SMS / Messaging',
  social: 'Social Media',
  backOffice: 'Back Office',
  video: 'Video Support',
  blended: 'Blended',
}

export const CHANNEL_VOLUME_LABELS: Record<ChannelType, string> = {
  voice: 'Forecast Contacts',
  chat: 'Forecast Chats',
  email: 'Forecast Emails',
  sms: 'Forecast Conversations',
  social: 'Forecast Messages',
  backOffice: 'Forecast Transactions',
  video: 'Forecast Sessions',
  blended: 'Forecast Volume',
}

/** Per-channel workload assumptions for direct staffing methodology. */
export type ChannelAssumptions = {
  forecastVolume: number
  ahtSeconds: number
  paidHoursPerFte: number
  occupancyTarget: number
  shrinkagePct: number
  productivityPct: number
  chatConcurrency: number
  channelMixPct: number
  revenuePerContact: number
  /** Starting production headcount for this channel (week 0). Defaults to 0. */
  startingProductionHc: number
  trainingWeeks: number
  nestingWeeks: number
  classSize: number
  trainingAttritionRate: number
  nestingAttritionRate: number
  graduationRate: number
  nestingPhoneTimePct: number
  /** Optional backlog volume (email, back office). */
  backlogVolume?: number
  /** Optional response-time target in seconds (email / messaging). */
  responseTimeTargetSeconds?: number
  /** Optional turnaround-time target in seconds (back office). */
  turnaroundTimeTargetSeconds?: number
  /** SLA target as decimal (video). */
  slaTargetPct?: number
  /** Target answer time in seconds (video). */
  targetAnswerSeconds?: number
  /** 1 = appointment mode enabled (video). */
  appointmentMode?: number
  /**
   * Interval length in seconds for interval-level Required Production FTE.
   * When set and > 0, interval formulas use this instead of weekly productive seconds.
   */
  intervalSeconds?: number
  /** Target backlog reduction units (email / back office). */
  targetBacklogReduction?: number
  /** Expected reopen rate as decimal (async messaging). */
  reopenRate?: number
  /** Carryover workload units (async messaging). */
  carryoverWorkload?: number
  /** Expected rework percentage as decimal (back office). */
  reworkPct?: number
  /** Social Media workload type. */
  socialWorkloadMode?: 'direct_messages' | 'posts_comments_reviews'
  /** Peak concurrent appointments (video appointment mode). */
  peakConcurrentAppointments?: number
  /** Absolute buffer FTE for video appointments. */
  bufferFte?: number
  /** Buffer as decimal of peak appointments (video). */
  bufferPct?: number
  /** Completion / due-date window in seconds (email / back office). */
  completionWindowSeconds?: number
}

/** Week-zero staffing plan with hiring recommendations per channel. */
export type ChannelStaffingPlan = {
  channel: ChannelType
  startingProductionHc: number
  requiredHeadcount: number
  requiredFte: number
  staffingGap: number
  staffingPct: number | null
  trainingWeeks: number
  nestingWeeks: number
  classSize: number
  /** Recommended new hires to start each week until gap closes. */
  suggestedWeeklyStarts: number
  /** Estimated weeks to reach 100% staffing at suggested pace. */
  weeksToFullStaffing: number
}

/** Staffing output for a single channel. */
export type ChannelStaffingResult = {
  channel: ChannelType
  forecastVolume: number
  workloadHours: number
  productiveHoursPerFte: number
  requiredFte: number
  requiredHeadcount: number
  channelMixPct: number
}

/** Consolidated staffing across all selected channels (sums, not averages). */
export type ConsolidatedChannelStaffing = {
  byChannel: ChannelStaffingResult[]
  totalWorkloadHours: number
  totalRequiredFte: number
  totalRequiredHeadcount: number
  totalForecastVolume: number
  weightedAhtSeconds: number
}

/** Per-channel financial metrics for a planning period. */
export type ChannelFinancialResult = {
  channel: ChannelType
  requiredFte: number
  requiredHeadcount: number
  productionFte: number
  staffingGap: number
  laborCost: number
  revenue: number
  costPerContact: number
  grossMargin: number
  grossMarginPct: number
  staffingRatio: number | null
  capacityUtilization: number
  channelMixPct: number
}

/** Aggregated financial rollup at LOB / Client / BU / Company level. */
export type ChannelFinancialRollup = {
  scopeLabel: string
  scopeType: 'channel' | 'lob' | 'client' | 'businessUnit' | 'company'
  channels: ChannelFinancialResult[]
  totals: Omit<ChannelFinancialResult, 'channel'>
}

export type PlannerPlanMetadata = {
  client: string
  /**
   * Geographic / site location when `lob` is set.
   * Legacy plans may only have `location` filled with the LOB name.
   */
  location: string
  billingType: string
  weekStart: WeekStart
  /**
   * IANA timezone for this client/LOB (e.g. Asia/Manila).
   * Drives “current week”, Actual vs Planned, and plan-start defaults.
   */
  timezone?: string
  /** Line of business (when set, `location` is the geographic site). */
  lob?: string
  /** Optional engagement / client code. */
  projectCode?: string
  /** Optional project display name. */
  projectName?: string
  /** Stable client profile id when created via setup wizard. */
  clientId?: string
  /** One or more supported channels for this LOB. Defaults to Voice for legacy plans. */
  supportedChannels?: ChannelType[]
  /** ISO date (week-start boundary) for the first planned capacity week. */
  capacityPlanStartWeek?: string
  /** Planning horizon in weeks (default 52). */
  planningWeeks?: number
  /** Capacity build approach for this client/LOB. */
  buildMethod?: CapacityBuildMethod
  /** When set (e.g. after template upload), capacity view shows all of these weeks. */
  capacityImportedWeeks?: string[]
  /** How multi-channel Required Production FTE is combined on the capacity plan. */
  requiredProductionHandlingModel?: RequiredProductionHandlingModel
  /**
   * Blending efficiency (0–1) for blended_agents handling.
   * Must be entered by the user — never defaulted silently.
   */
  blendingEfficiency?: number | null
  /** Primary channel for simultaneous_handling shared-capacity math. */
  requiredProductionPrimaryChannel?: ChannelType
  /** Idle capacity % (0–1) of primary scheduled FTE usable by secondary channels. */
  idleCapacityPct?: number | null
  /** Shared capacity factor (0–1) applied to idle capacity. */
  sharedCapacityFactor?: number | null
}

export type RequiredProductionHandlingModel =
  | 'dedicated_agents'
  | 'dedicated_time_blocks'
  | 'blended_agents'
  | 'simultaneous_handling'

export type CapacityBuildMethod = 'forward' | 'import'

export type NewHireAssumptions = {
  hiringPlanPerPeriod: number
  classSize: number
  trainingWeeks: number
  trainingAttritionRate: number
  graduationRate: number
  nestingWeeks: number
  nestingAttritionRate: number
  nestingPhoneTimePct: number
  nestingPhoneTimeRamp: number[]
  graduationWeek: number
  timeToProficiencyWeeks: number
  rampCurve: number[]
  hiringDelayWeeks: number
  trainingCostPerHire: number
}

export type TenuredStaffAssumptions = {
  beginningProductionHeadcount: number
  attritionRateMonthly: number
  shrinkageRate: number
  shrinkageInOfficeShare: number
  standardScheduledHoursPerWeek: number
  otHoursPerFtePerWeek: number
  vtoHoursPerFtePerWeek: number
  occupancyTarget: number
  productivityFactor: number
  attendanceRate: number
  scheduleAdherence: number
  ahtSeconds: number
  utilizationTarget: number
  crossSkilledShare: number
  productiveHoursPerFtePerWeek: number
  laborCostPerFteMonthly: number
}

export type BusinessAssumptions = {
  baseForecastVolume: number
  growthRateMonthly: number
  seasonalityFactors: number[]
  serviceLevelTarget: number
  asaTargetSeconds: number
  responseTimeTargetSeconds: number
  budgetConstraintMonthly: number
  revenueTargetMonthly: number
  requiredOccupancy: number
  staffingBufferPct: number
  revenuePerContact: number
  /** Billing rate: USD/hr for Production Hours & FTE HC models, USD/unit for Transactional */
  billingRate: number
  /** Standard production labor rate (USD / hour) */
  hourlySalaryUsd: number
  /** Weekly support salary overhead (USD) */
  supportSalaryUsd: number
  /** Training pipeline salary rate (USD / HC / week) for Training + Nesting HC */
  trainingSalaryRateUsd: number
  /** Weekly other operating cost (USD) */
  otherCostUsd: number
  slaPenaltyPerMissedPoint: number
  overtimeMultiplier: number
}

export type PlannerAssumptions = {
  newHire: NewHireAssumptions
  tenured: TenuredStaffAssumptions
  business: BusinessAssumptions
  /** Per-channel workload assumptions keyed by channel type. */
  channels: Partial<Record<ChannelType, ChannelAssumptions>>
}

export type ActualsSnapshot = {
  beginningProductionHc?: number
  forecastVolume?: number
  fte?: number
  hiring?: number
  actualTrainingStart?: number
  attrition?: number
  occupancy?: number
  productivity?: number
  utilization?: number
  serviceLevel?: number
  revenue?: number
  cost?: number
  budget?: number
  scheduledHours?: number
  payrollHours?: number
  productiveHours?: number
  shrinkageInOfficeHours?: number
  shrinkageOutOfOfficeHours?: number
  otHours?: number
  vtoHours?: number
}

export type PeriodResult = {
  periodIndex: number
  periodLabel: string
  granularity: PeriodGranularity
  /** Planned */
  forecastVolume: number
  /** Consolidated channel staffing for this period. */
  channelStaffing?: ConsolidatedChannelStaffing
  /** Per-channel financial metrics for this period. */
  channelFinancials?: ChannelFinancialResult[]
  requiredFte: number
  beginningProductionHc: number
  scheduledFte: number
  actualTrainingStart: number
  trainingHeadcount: number
  nestingHeadcount: number
  graduateHc: number
  trainingAttritionHc: number
  nestingAttritionHc: number
  totalShrinkageRate: number
  coreProductionFte: number
  nestingPhoneTimePct: number
  nestingProductiveFte: number
  productiveFte: number
  staffingPct: number | null
  availableFte: number
  netStaffing: number
  /** Production headcount − required headcount (scheduled − required). */
  headcountOverUnder: number
  hiringPlanned: number
  hiringActual: number
  attritionPlanned: number
  attritionActual: number
  backfillRequired: number
  overstaffing: number
  understaffing: number
  capacityGap: number
  occupancy: number
  productivity: number
  utilization: number
  serviceLevel: number
  revenue: number
  laborCost: number
  hiringCost: number
  trainingCost: number
  overtimeCost: number
  totalCost: number
  grossMargin: number
  profitability: number
  costPerFte: number
  revenuePerEmployee: number
  budgetVariance: number
  scheduledHours: number
  payrollHours: number
  productiveHours: number
  shrinkageInOfficeHours: number
  shrinkageOutOfOfficeHours: number
  otHours: number
  vtoHours: number
  leakages: FinancialLeakages
  actuals?: ActualsSnapshot
}

export type FinancialLeakages = {
  overstaffing: number
  understaffing: number
  overtime: number
  idleTime: number
  absenteeism: number
  shrinkage: number
  productivityLoss: number
  slaPenalties: number
  total: number
}

export type SimulationResult = {
  scenarioId: string
  scenarioName: string
  granularity: PeriodGranularity
  periods: PeriodResult[]
  summary: ExecutiveSummary
}

export type ExecutiveSummary = {
  workforceFte: number
  productionFte: number
  requiredFte: number
  capacityGap: number
  overUnderStaffing: number
  occupancy: number
  productivity: number
  revenueProjection: number
  costProjection: number
  grossMargin: number
  profitability: number
  totalLeakage: number
  hiringTotal: number
  attritionTotal: number
  /** Latest-period consolidated channel staffing. */
  channelStaffing?: ConsolidatedChannelStaffing
  /** Latest-period per-channel financial metrics. */
  channelFinancials?: ChannelFinancialResult[]
  risks: string[]
  recommendedActions: string[]
}

export type PlannerScenario = {
  id: string
  name: string
  description: string
  plan: PlannerPlanMetadata
  assumptions: PlannerAssumptions
  isBaseline: boolean
  /** Email of the user who owns this capacity plan (lowercase). */
  ownerEmail?: string
  createdAt: string
  updatedAt: string
  actualsByPeriod?: Record<number, ActualsSnapshot>
}

export type ScenarioTemplate = {
  id: string
  name: string
  description: string
  /** Plain-language explanation shown when user expands the card. */
  details?: string
  /** Merged onto the active scenario's current assumptions. */
  patch?: Partial<{
    newHire: Partial<NewHireAssumptions>
    tenured: Partial<TenuredStaffAssumptions>
    business: Partial<BusinessAssumptions>
  }>
  /** Computed from the reference scenario, then merged onto the active scenario. */
  patchFromReference?: (
    reference: PlannerAssumptions,
    target: PlannerAssumptions,
  ) => Partial<{
    newHire: Partial<NewHireAssumptions>
    tenured: Partial<TenuredStaffAssumptions>
    business: Partial<BusinessAssumptions>
  }>
}

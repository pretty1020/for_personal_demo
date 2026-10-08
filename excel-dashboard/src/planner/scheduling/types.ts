import type { GeneratedRequirementTable } from './requirementGeneration'
import type { PatternScheduleMeta } from './patternAnalysis'
import type { SchedulingSettings } from './schedulingSettingsTypes'

export type IntervalTime = string

export type SchedulingDayKey = string

export type IntervalPatternRow = {
  day: SchedulingDayKey
  interval: IntervalTime
  value: number
}

export type DayIntervalPattern = Record<IntervalTime, number>

export type WeekIntervalPattern = Record<SchedulingDayKey, DayIntervalPattern>

export type FteSourceMode = 'capacity' | 'manual'

export type ScheduleHcSourceMode = 'capacity' | 'manual' | 'roster'

export type SchedulingAgent = {
  index: number
  name: string
  supervisor?: string
  manager?: string
  employeeId?: string
}

export type ShiftTemplate = {
  id: string
  label: string
  startMinutes: number
  durationMinutes: number
  lunchMinutes: number
  breakMinutes: number
}

export type SchedulingRules = {
  shiftTemplates: ShiftTemplate[]
  maxShiftStartAdjustMinutes: number
  optimizeShiftStarts: boolean
  settings: SchedulingSettings
}

export type SchedulingWorkspace = {
  scenarioId: string
  weekStartIso: string
  patternLabel: string
  patternUploadedAt: string | null
  rawPattern: IntervalPatternRow[]
  normalizedPattern: WeekIntervalPattern
  fteSource: FteSourceMode
  manualWeeklyFte: number
  manualDailyFteByDay: Record<SchedulingDayKey, number>
  scheduleHcSource: ScheduleHcSourceMode
  manualProductionHc: number
  rules: SchedulingRules
  activeTemplateId: string | null
  settingsConfirmedAt: string | null
  lastGeneratedAt: string | null
  /** SLA target % for projected service level (default 80) */
  slaPercent: number
  /** SLA answer-time target in seconds (default 30) */
  slaSeconds: number
  /** Optional shrinkage % applied to interval requirements for Net FTE */
  shrinkagePct: number
  volumeAhtLabel: string
  volumeAhtUploadedAt: string | null
  volumeAhtRows: VolumeAhtRow[]
  /** Empty string means all teams / supervisors. */
  teamSupervisor?: string
  /** Combined interval apply-shrinkage % as 0–100. Flat or per-interval. */
  applyShrinkageMode?: 'flat' | 'per_interval'
  /** Flat Shrinkage Assumption % 0–100 (legacy abs+in-office are summed into this). */
  applyAbsenteeismPct?: number
  /** @deprecated Prefer flat Shrinkage Assumption; kept for legacy uploads / Capacity seed. */
  applyInOfficePct?: number
  /** Per-day per-interval Shrinkage Assumption % 0–100 (upload or combined) */
  intervalApplyShrinkagePct?: Record<string, Record<string, number>>
  /** VL HC override; null/undefined = use Capacity VL Allocation HC */
  vlHcOverride?: number | null
  /** Agent schedules locked until Unlock */
  schedulesLocked?: boolean
}

export type VolumeAhtRow = {
  day: SchedulingDayKey
  interval: IntervalTime
  volume: number
  ahtSeconds: number
}

export type SchedulingQualityInputs = {
  slaPercent: number
  slaSeconds: number
  shrinkagePct: number
  volumeAhtRows: VolumeAhtRow[]
}

export type SchedulingMetricsMatrix = {
  slaPercent: number
  slaSeconds: number
  occupancyPct: number | null
  pureFteReq: number
  /** Count of roster agents with assigned shifts (Scheduled HC). */
  scheduledHeadcount: number
  pureFteStaffTotals: number
  netFteTotal: number
  shrinkagePct: number | null
  scfPct: number | null
  /** Staffing-ratio projected service level (default). */
  projectedServiceLevelPct: number | null
  /** Erlang C projected service level when Volume/AHT is available. */
  projectedServiceLevelErlangPct?: number | null
  hasVolumeAht: boolean
}

export type IntervalMetricRow = {
  interval: IntervalTime
  requiredFte: number
  /** Gross on-shift headcount at interval (includes lunch/break) */
  scheduledFte: number
  /**
   * Net FTE = productive headcount after removing Break and Lunch from Scheduled.
   * This is the base for Apply Shrinkage.
   */
  netFte?: number
  /** Net FTE after shrinkage = Net FTE × (1 − Shrinkage%). Equals Net FTE when shrinkage is 0%. */
  netFteAfterShrinkage?: number
  /** (Net FTE after shrinkage) − Required */
  variance: number
  staffingPct: number | null
  /** Projected line adherence = (Net FTE after shrinkage) ÷ Required */
  lineAdherencePct?: number | null
  occupancyPct?: number | null
  /** Default projected SL from staffing ratio vs SLA target (uses Net FTE after shrinkage). */
  projectedSlPct?: number | null
  /** Optional Erlang C projected SL when Volume/AHT is uploaded (uses Net FTE after shrinkage). */
  projectedSlErlangPct?: number | null
}

export type DayScheduleSummary = {
  day: SchedulingDayKey
  dateLabel: string
  /** Avg required FTE across intervals with demand */
  dailyRequiredFte: number
  /** Avg scheduled FTE across staffed intervals */
  dailyScheduledFte: number
  /** Daily FTE = sum(interval requirements) ÷ shift hours */
  dailyRequiredTotal: number
  /** Scheduled FTE = SUM(interval Scheduled/on-shift HC) ÷ shift hours ÷ (60 ÷ interval minutes) */
  dailyScheduledTotal: number
  /** SUM(interval Net FTE) ÷ shift hours ÷ (60 ÷ interval minutes) — productive after lunch/break, before shrinkage */
  dailyNetFteBeforeShrinkage?: number
  /** SUM(interval Net FTE after shrinkage) ÷ shift hours ÷ (60 ÷ interval minutes) */
  dailyNetFteTotal?: number
  /** Sum of on-shift Scheduled HC across all intervals for the day */
  dailyScheduledIntervalSum: number
  /** Sum of productive HC across all intervals (excludes lunch/break/off), before shrinkage */
  dailyProductiveIntervalSum?: number
  /** Sum of Net FTE after shrinkage across intervals */
  dailyNetFteAfterShrinkageIntervalSum?: number
  /** Agents assigned a shift this day */
  dailyScheduledHc: number
  dailyVariance: number
  dailyStaffingPct: number | null
  overstaffedIntervals: number
  understaffedIntervals: number
  intervals: IntervalMetricRow[]
  /** True when day is outside pattern ∩ settings working days (no ops). */
  isClosed?: boolean
}

export type SchedulingResult = {
  days: DayScheduleSummary[]
  totals: {
    /** Weekly FTE = sum(daily FTE) ÷ working days */
    requiredFte: number
    scheduledFte: number
  /** Sum of Net FTE interval HC across the full week (all calendar days) */
  weeklyScheduledIntervalSum?: number
  /** Sum of on-shift Scheduled interval HC across the full week */
  weeklyScheduledGrossIntervalSum?: number
    weeklySumRequired?: number
    weeklySumScheduled?: number
    /** Production HC roster pool from Capacity */
    rosterPoolHc?: number
    /** Agents with at least one shift assignment in the week */
    rosterAgentsWithShifts?: number
    /** Mean agents with a shift on each open day */
    avgAgentsPerOpenDay?: number
    scheduledIntervalTotal?: number
    variance: number
    staffingPct: number | null
    overstaffedIntervals: number
    understaffedIntervals: number
  }
}

export type AgentIntervalStatus = 'off' | 'productive' | 'lunch' | 'break' | 'vl'

export type AgentScheduleDetail = {
  agentIndex: number
  agentLabel: string
  templateLabel: string
  shiftStart: string
  shiftEnd: string
  lunchStart: string
  lunchEnd: string
  break1Start: string
  break1End: string
  break2Start: string
  break2End: string
  workingHours: number
  intervals: Record<IntervalTime, AgentIntervalStatus>
}

export type DayAgentSchedules = {
  day: SchedulingDayKey
  dateLabel: string
  agents: AgentScheduleDetail[]
}

export type WeeklyAgentScheduleRow = {
  agentIndex: number
  agentLabel: string
  supervisor?: string
  days: Record<SchedulingDayKey, string>
  lunch: string
  break1: string
  break2: string
}

export type BreakLunchColumnKey = 'lunch' | 'break1' | 'break2'

export type WeeklyAgentScheduleGrid = {
  weekDates: string[]
  dayHeaders: string[]
  /** Ordered lunch/break columns driven by schedule pattern constraint. */
  breakColumns?: Array<{ key: BreakLunchColumnKey; label: string }>
  rows: WeeklyAgentScheduleRow[]
}

export type GeneratedSchedulingPackage = {
  requirementTable: GeneratedRequirementTable
  schedulingResult: SchedulingResult
  agentSchedules: DayAgentSchedules[]
  weeklyAgentGrid: WeeklyAgentScheduleGrid
  productionHc: number
  patternMeta: PatternScheduleMeta
  metricsMatrix: SchedulingMetricsMatrix
  generatedAt: string
  agentNames?: Record<string, string>
  diagnostics?: import('./scheduleDiagnostics').ScheduleDiagnostics
  teamSupervisor?: string
  status?: 'draft' | 'saved'
  engine?: import('./scheduleDiagnostics').ScheduleEngineKind
  /** Full shift assignments by day (for edit / apply-shrinkage rebuild). */
  assignmentsByDay?: Record<string, import('./scheduleGeneration').AgentShiftAssignment[]>
}

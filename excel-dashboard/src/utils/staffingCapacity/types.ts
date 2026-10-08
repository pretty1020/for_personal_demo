import type { SheetSnapshot } from '../../types/dashboard'

export type StaffingFieldKey =
  | 'fy'
  | 'month'
  | 'week'
  | 'weekStartDate'
  | 'projectCode'
  | 'client'
  | 'campaign'
  | 'lob'
  | 'location'
  | 'owner'
  | 'requiredHc'
  | 'activeProdHc'
  | 'activeProdFte'
  | 'forecastVolume'
  | 'actualOfferedVolume'
  | 'actualHandledVolume'
  | 'plannedShrinkPct'
  | 'actualShrinkPct'
  | 'plannedInOfficeShrinkPct'
  | 'actualInOfficeShrinkPct'
  | 'plannedOutOfficeShrinkPct'
  | 'actualOutOfficeShrinkPct'
  | 'plannedAttrition'
  | 'actualAttrition'
  | 'plannedTrainingAttrition'
  | 'actualTrainingAttrition'
  | 'cappedAht'
  | 'plannedAht'
  | 'actualAht'
  | 'billingType'
  | 'productionHours'
  | 'days'
  | 'billingRate'
  | 'plannedNewHireClassHc'
  | 'newHireCount'
  | 'trainingCount'
  | 'graduateCount'
  | 'tlCount'
  | 'opsManagerCount'
  | 'trainerCount'
  | 'qaCount'
  | 'wfmSupportCount'
  | 'trainingHc'
  | 'supportHc'
  | 'plannedPaidProductionHours'
  | 'actualPaidProductionHours'
  | 'plannedNewHireTrainingHours'
  | 'actualTrainingHours'

export interface StaffingColumnMap {
  sheetName: string
  /** source column key → canonical field */
  byField: Partial<Record<StaffingFieldKey, string>>
  missingRequired: StaffingFieldKey[]
  warnings: string[]
}

export interface ParsedRateRow {
  projectCode: string
  client: string
  campaign: string
  lob: string
  billingType: string
  rate: number | null
  currency: string
  effectiveStart: Date | null
  effectiveEnd: Date | null
  sourceSheet: string
}

export interface ParsedOwnerRow {
  client: string
  campaign: string
  lob: string
  owner: string
  operationsLeader: string
  wfmLead: string
  financePartner: string
  sourceSheet: string
}

export interface StaffingPlanRow {
  sourceSheet: string
  fy: string
  month: string
  week: string
  weekStartDate: string
  projectCode: string
  client: string
  campaign: string
  lob: string
  location: string
  owner: string
  requiredHc: number | null
  activeProdHc: number | null
  activeProdFte: number | null
  forecastVolume: number | null
  actualOfferedVolume: number | null
  actualHandledVolume: number | null
  plannedShrinkPct: number | null
  actualShrinkPct: number | null
  plannedInOfficeShrinkPct: number | null
  actualInOfficeShrinkPct: number | null
  plannedOutOfficeShrinkPct: number | null
  actualOutOfficeShrinkPct: number | null
  plannedAttrition: number | null
  actualAttrition: number | null
  /** Optional training-pipeline attrition headcounts (upload columns). */
  plannedTrainingAttrition: number | null
  actualTrainingAttrition: number | null
  cappedAht: number | null
  plannedAht: number | null
  actualAht: number | null
  billingType: string
  /** Total team productive hours OR per-agent hours — see resolveProductionHoursPerHead */
  productionHours: number | null
  days: number | null
  /** Row-level billing rate override (USD); else matched from Rates sheet */
  billingRate: number | null
  /** Matched from Rates sheet when Billing Rate column empty */
  rate: number | null
  currency: string | null
  /** Optional workforce / training pipeline counts (row-level). */
  plannedNewHireClassHc: number | null
  newHireCount: number | null
  trainingCount: number | null
  graduateCount: number | null
  /** Optional support staffing counts (row-level). */
  tlCount: number | null
  opsManagerCount: number | null
  trainerCount: number | null
  qaCount: number | null
  wfmSupportCount: number | null
  /** Heads in training — mapped only from Training HC / Training Headcount / Training FTE columns (no pipeline imputation). */
  trainingHc: number | null
  /** Support HC — mapped only from Support HC / Support Headcount / Support FTE columns (no role-sum imputation). */
  supportHc: number | null
  /** Planned paid production hours (uploaded). */
  plannedPaidProductionHours: number | null
  /** Actual paid production hours (uploaded). */
  actualPaidProductionHours: number | null
  /** Planned new-hire training hours (uploaded). */
  plannedNewHireTrainingHours: number | null
  /** Actual training hours (uploaded). */
  actualTrainingHours: number | null
}

export interface StaffingEnrichedRow extends StaffingPlanRow {
  billingModel: 'fte_monthly' | 'fte_hours' | 'per_minute' | 'transactional'
  productionHoursPerHead: number | null
  /** Active production HC × (1 − planned shrink fraction); null if either input missing. */
  availableFtePlanned: number | null
  /** Active production HC × (1 − actual shrink fraction); null if either input missing. */
  availableFteActual: number | null
  hcOu: number | null
  volumeGap: number | null
  offeredVsForecastGap: number | null
  handledVsForecastGap: number | null
  shrinkageVariance: number | null
  attritionVariance: number | null
  ahtVariance: number | null
  hcLeakage: number | null
  volumeLeakage: number | null
  shrinkageLeakage: number | null
  attritionLeakage: number | null
  ahtLeakage: number | null
  totalRevenueLeakage: number | null
}

export interface StaffingIngestResult {
  planRows: StaffingPlanRow[]
  enrichedRows: StaffingEnrichedRow[]
  rates: ParsedRateRow[]
  owners: ParsedOwnerRow[]
  staffingSheetsUsed: string[]
  ratesSheetUsed: string | null
  ownersSheetUsed: string | null
  columnMaps: StaffingColumnMap[]
  errors: string[]
  warnings: string[]
  ratesFound: boolean
  snapshots: Record<string, SheetSnapshot>
  sheetNames: string[]
  fileName: string
}

export interface StaffingWhatIfInput {
  addHc: number
  shrinkPctPointReduction: number
  ahtReductionSeconds: number
  attritionReduction: number
  handledVolumeAdd: number
  rateMultiplierPct: number
}

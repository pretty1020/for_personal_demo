import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { StickyHorizontalScrollbar } from '../components/StickyHorizontalScrollbar'
import { HelpTip } from '../components/planner/HelpTip'
import { PlanStartWeekField } from '../components/planner/PlanStartWeekField'
import { CapacityDataUploadPanel } from '../components/planner/CapacityDataUploadPanel'
import { ShrinkagePlanningPanel } from '../components/planner/ShrinkagePlanningPanel'
import { StageAttritionPanel } from '../components/planner/StageAttritionPanel'
import { ModulePageHeader } from '../components/shell/ModulePageHeader'
import { CapacityChartsPanel } from '../components/capacity/CapacityChartsPanel'
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog'
import { usePlanner } from '../context/PlannerContext'
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard'
import { useFormulaRevision } from '../hooks/useFormulaRevision'
import {
  combineCapacityRows,
  deriveCapacityPlanRows,
  actualProductionHcForDisplay,
  actualSupportHcForDisplay,
  downloadFullCapacityPlanWorkbook,
  type CapacityForecastMode,
  type CapacityMetricSnapshot,
  type DerivedCapacityRow,
} from '../planner/capacityPlanDerived'
import { getScenarioAhtOverrides } from '../planner/ahtAnalysisPersistence'
import {
  buildMatrixExportPayload,
  downloadCapacityMatrixExcel,
  downloadCapacityMatrixPdf,
} from '../planner/capacityMatrixExport'
import { ACTUAL_PRODUCTION_HC_FORMULA, PLANNED_PRODUCTION_HC_FORMULA } from '../planner/capacityMetricFormulas'
import { DEFAULT_CAPACITY_MATRIX_COLLAPSED, DEFAULT_CAPACITY_MATRIX_LAYOUT, loadCapacityMatrixView, saveCapacityMatrixView } from '../planner/capacityViewPersistence'
import { buildCohortStageMaps } from '../planner/trainingPipelineHc'
import { syncBusinessDerivedFields, syncChannelDerivedFields, syncDerivedTenuredFields } from '../planner/assumptionDerivation'
import {
  resolveCapacityPlanStartWeek,
  resolveCurrentCalendarWeek,
  snapToWeekStart,
  uniqueSortedWeeks,
} from '../planner/capacityWeekUtils'
import { fmtNum, fmtPct } from '../planner/format'
import { rosterHeadcountOverrides } from '../planner/rosterMetrics'
import { countActiveAgents } from '../planner/rosterRoleUtils'
import {
  fmtVarianceDelta,
  fmtVarianceDeltaPct,
  fmtVarianceDeltaSeconds,
  offeredToForecastTone,
  staffingPctTone,
  varianceToneHigherBetter,
  varianceToneLowerBetter,
} from '../planner/varianceDisplay'
import { ChannelSelector } from '../components/planner/ChannelSelector'
import { CHANNEL_LABELS, CHANNEL_VOLUME_LABELS, type ChannelType, type PlannerAssumptions } from '../planner/types'
import { BILLABLE_TYPE_OPTIONS, billableTypeLabel, isFteBillingPlan } from '../utils/staffingCapacity/billingModel'
import { explicitPlanChannels, formatPlanChannels, planSettingsScenarioName, resolvePlanLob, resolvePlanLocation } from '../planner/planIdentity'
import { defaultChannelAssumptions, normalizeChannelMix } from '../planner/channelPlanning'
import { formatTimeZoneLabel, normalizeTimeZone, timezoneSelectOptions } from '../planner/clientTimezones'
import { parseCapacityPlanWorkbook } from '../planner/capacityWorkbookImport'
import { patchDriverForecast } from '../planner/advancedForecastPersistence'
import { summarizeWeeklyLedgerRows, type LedgerMetricSnapshot, type WeeklyLedgerRow } from '../planner/weeklyLedger'
import { buildShrinkageLookup } from '../planner/capacityMatrixDisplay'
import {
  createCustomShrinkageCategory,
  DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS,
  isCustomShrinkageCategoryId,
  isPersistedVisibleShrinkageCategoryId,
  mergeShrinkageCategoryTemplates,
  resolveActiveShrinkageCategoryIds,
  withDefaultOooShrinkageCategoryIds,
  type ShrinkageCategoryTemplate,
} from '../planner/shrinkageCategories'
import { findClientByName } from '../planner/clientRegistry'
import { scenarioSeatDemand } from '../planner/seatScenario'
import {
  applyClipboardGridToDrafts,
  cellDraftId,
  collectInvalidDraftMessages,
  finalizeCellDrafts,
  isWholeNumberMetric,
  mergeLedgerWithActualDrafts,
  mergePlannedOverridesWithDrafts,
  metricInputBounds,
  parseCellDraftId,
  parseClipboardGrid,
  parseMetricDraft,
  sanitizeNumericDraft,
  storedValueFromDraft,
  toInputString,
  type MatrixEditKind,
} from '../planner/capacityMatrixInput'
import { flushWorkspaceSync, persistScenarioDeletion } from '../data/workspaceSync'
import { useDemoSession } from '../context/DemoSessionContext'
import { canDeleteCapacityPlan } from '../planner/planAccess'
import { NumField } from '../components/planner/NumField'

type CapacityView = 'weekly' | 'monthly' | 'quarterly'
type CapacityGroupId =
  | 'staffing'
  | 'headcount'
  | 'pipeline'
  | 'attrition'
  | 'volume'
  | 'shrinkage'
  | 'aht'
  | 'occupancy'
  | 'hours'
  | 'seats'
import {
  capacityStatusClass,
  capacityWeekCellClass,
  capacityWeekHeaderClass,
  DEFAULT_VISIBLE_FUTURE_WEEKS,
  MAX_FUTURE_WEEKS,
  VISIBLE_HISTORY_WEEKS,
  sliceCapacityWindow,
} from '../planner/capacityMatrixTheme'
const FORECAST_HORIZON_WEEKS = 52
const CAPACITY_FORECAST_MODE_METRICS = ['callVolume', 'ahtSeconds', 'occupancy', 'totalShrinkagePct', 'attritionHc'] as const
type CapacityForecastMetricId = (typeof CAPACITY_FORECAST_MODE_METRICS)[number]
import { capacityWorkspaceForecastModes } from '../planner/capacityLookup'
import {
  forecastModesEqual,
  loadScenarioForecastModes,
  saveScenarioForecastModes,
  type ScenarioForecastModes,
} from '../planner/capacityForecastModesPersistence'

const DEFAULT_CAPACITY_FORECAST_MODES: ScenarioForecastModes = {
  callVolume: 'forecast',
  ahtSeconds: 'manual',
  occupancy: 'manual',
  totalShrinkagePct: 'manual',
  attritionHc: 'forecast',
}

function resolveInitialForecastModes(scenarioId?: string | null): ScenarioForecastModes {
  const id = scenarioId || loadCapacityMatrixView()?.scenarioId
  if (!id) return DEFAULT_CAPACITY_FORECAST_MODES
  return {
    ...DEFAULT_CAPACITY_FORECAST_MODES,
    ...loadScenarioForecastModes(id),
  }
}
const METRIC_ORDER_STORAGE_KEY = 'wfp-capacity-metric-order-v1'
const METRIC_OPTIONAL_STORAGE_KEY = 'wfp-capacity-metric-optional-v1'
const METRIC_HIDDEN_STORAGE_KEY_LEGACY = 'wfp-capacity-metric-hidden-v1'
const CELL_DRAFTS_SESSION_KEY = 'wfp-capacity-cell-drafts-v1'
const DEFAULT_OPTIONAL_METRICS: Partial<Record<CapacityGroupId, string[]>> = {
  staffing: ['actual-required-production-fte'],
}

function readSessionCellDrafts(scenarioId: string | null | undefined): Record<string, string> {
  if (!scenarioId) return {}
  try {
    const raw = sessionStorage.getItem(CELL_DRAFTS_SESSION_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Record<string, string>>
    const drafts = parsed[scenarioId]
    return drafts && typeof drafts === 'object' ? drafts : {}
  } catch {
    return {}
  }
}

function writeSessionCellDrafts(scenarioId: string | null | undefined, drafts: Record<string, string>) {
  if (!scenarioId) return
  try {
    const raw = sessionStorage.getItem(CELL_DRAFTS_SESSION_KEY)
    const parsed = raw ? (JSON.parse(raw) as Record<string, Record<string, string>>) : {}
    if (Object.keys(drafts).length === 0) delete parsed[scenarioId]
    else parsed[scenarioId] = drafts
    sessionStorage.setItem(CELL_DRAFTS_SESSION_KEY, JSON.stringify(parsed))
  } catch {
    /* ignore quota / private mode */
  }
}

type MatrixRowDef = {
  id: string
  label: string
  value: (row: DerivedCapacityRow) => number | null
  futureValue?: (row: DerivedCapacityRow) => number | null
  format: (value: number | null | undefined) => string
  plannedOverrideKey?: keyof LedgerMetricSnapshot
  actualOverrideKey?: keyof LedgerMetricSnapshot
  /** Stable Metric_Id for matrix Excel export/import when the row is not inline-editable. */
  exportMetricId?: keyof LedgerMetricSnapshot
  editablePlanned?: boolean
  editableActual?: boolean
  editablePlannedCurrentWeekOnly?: boolean
  editableActualAllHistorical?: boolean
  editableActualPlanningWeek?: boolean
  shrinkageCategoryId?: string
  shrinkageEditKind?: 'planned' | 'actual'
  step?: number
  isPercentInput?: boolean
  formula?: string
  tone?: (value: number | null | undefined) => string
  /** When true, metric is optional by default until the user reveals optional metrics. */
  defaultOptional?: boolean
}

function driverMetricLabel(metricId: CapacityForecastMetricId): string {
  switch (metricId) {
    case 'callVolume':
      return 'Volume'
    case 'ahtSeconds':
      return 'AHT'
    case 'occupancy':
      return 'Occupancy'
    case 'totalShrinkagePct':
      return 'Shrinkage'
    case 'attritionHc':
      return 'Planned Attrition %'
  }
}

function driverModeLabel(mode: CapacityForecastMode): string {
  switch (mode) {
    case 'forecast':
      return 'Use forecast model'
    case 'previous_week':
      return 'Use previous week'
    default:
      return 'Use manual / baseline'
  }
}

function driverModeOptions(_metricId: CapacityForecastMetricId): CapacityForecastMode[] {
  return ['forecast', 'manual', 'previous_week']
}

function shrinkageDriverDefaultMode(metricId: string): CapacityForecastMode {
  if (metricId.startsWith('custom_')) return 'previous_week'
  return DEFAULT_CAPACITY_FORECAST_MODES[metricId] ?? 'manual'
}

function safeRatio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator == null || denominator == null || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null
  }
  return numerator / denominator
}

function loadMetricOrderStore(): Partial<Record<CapacityGroupId, string[]>> {
  try {
    const raw = localStorage.getItem(METRIC_ORDER_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<Record<CapacityGroupId, string[]>>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function loadOptionalMetricStore(): Partial<Record<CapacityGroupId, string[]>> {
  try {
    const raw = localStorage.getItem(METRIC_OPTIONAL_STORAGE_KEY) ?? localStorage.getItem(METRIC_HIDDEN_STORAGE_KEY_LEGACY)
    if (!raw) return { ...DEFAULT_OPTIONAL_METRICS }
    const parsed = JSON.parse(raw) as Partial<Record<CapacityGroupId, string[]>>
    return parsed && typeof parsed === 'object' ? parsed : { ...DEFAULT_OPTIONAL_METRICS }
  } catch {
    return { ...DEFAULT_OPTIONAL_METRICS }
  }
}

function orderMetrics(groupId: CapacityGroupId, metrics: MatrixRowDef[], storedOrder: Partial<Record<CapacityGroupId, string[]>>): MatrixRowDef[] {
  const order = storedOrder[groupId] ?? []
  if (!order.length) return metrics
  const rank = new Map(order.map((metricId, index) => [metricId, index]))
  return [...metrics].sort((a, b) => {
    const rankA = rank.get(a.id)
    const rankB = rank.get(b.id)
    if (rankA == null && rankB == null) return 0
    if (rankA == null) return 1
    if (rankB == null) return -1
    return rankA - rankB
  })
}

function filterVisibleMetrics(
  groupId: CapacityGroupId,
  metrics: MatrixRowDef[],
  optionalStore: Partial<Record<CapacityGroupId, string[]>>,
  showOptional: boolean,
): MatrixRowDef[] {
  if (showOptional) return metrics
  const optional = new Set(optionalStore[groupId] ?? [])
  return metrics.filter((metric) => !optional.has(metric.id))
}

function isMetricOptional(
  groupId: CapacityGroupId,
  metricId: string,
  optionalStore: Partial<Record<CapacityGroupId, string[]>>,
): boolean {
  return (optionalStore[groupId] ?? []).includes(metricId)
}

const GROUP_LABELS: Record<CapacityGroupId, string> = {
  staffing: '1 · Staffing',
  headcount: '2 · Headcount',
  pipeline: '3 · Training pipeline',
  attrition: '4 · Attrition',
  volume: '5 · Volume',
  shrinkage: '6 · Shrinkage',
  aht: '7 · AHT',
  occupancy: '8 · Occupancy',
  hours: '9 · Hours',
  seats: '10 · Seats',
}

const MATRIX_GROUP_ORDER: CapacityGroupId[] = [
  'staffing',
  'headcount',
  'pipeline',
  'attrition',
  'volume',
  'shrinkage',
  'aht',
  'occupancy',
  'hours',
  'seats',
]

const NEUTRAL_TONE = () => 'neutral'

function actualProductionAttritionPct(row: DerivedCapacityRow): number | null {
  if (row.statusLabel !== 'Actual') return null
  if (row.actual.attritionPct != null && Number.isFinite(row.actual.attritionPct)) {
    return row.actual.attritionPct
  }
  const attritionHc = row.actual.attritionHc
  if (!Number.isFinite(attritionHc) || attritionHc < 0) return null

  const beginning =
    row.actual.beginningProductionHc > 0
      ? row.actual.beginningProductionHc
      : row.planned.beginningProductionHc > 0
        ? row.planned.beginningProductionHc
        : 0
  const ending =
    row.actual.productionHc > 0
      ? row.actual.productionHc
      : row.planned.productionHc > 0
        ? row.planned.productionHc
        : 0
  // Prefer beginning HC; otherwise reconstruct pre-attrition base from ending + attrition.
  const denominator = beginning > 0 ? beginning : ending > 0 ? ending + attritionHc : 0
  if (denominator <= 0) return attritionHc === 0 ? 0 : null
  return attritionHc / denominator
}

function plannedProductionHcAttrition(row: DerivedCapacityRow): number | null {
  if (row.planned.attritionPct == null) return null
  return Math.round(row.planned.attritionPct * row.planned.productionHc)
}

function buildActualStageAttritionLookup(rows: DerivedCapacityRow[]) {
  const byWeek = new Map<string, { trainingActualPct: number | null; nestingActualPct: number | null }>()
  rows.forEach((row, index) => {
    const prev = rows[index - 1]
    if (!prev) {
      byWeek.set(row.week, { trainingActualPct: null, nestingActualPct: null })
      return
    }
    const prevTrainingHc = prev.actual.trainingHc
    const currentTrainingHc = row.actual.trainingHc
    const trainingActualPct =
      prevTrainingHc > 0
        ? Math.min(1, Math.max(0, (prevTrainingHc - currentTrainingHc) / prevTrainingHc))
        : null
    const prevNestingHc = prev.actual.nestingHc
    const currentNestingHc = row.actual.nestingHc
    const nestingActualPct =
      prevNestingHc > 0
        ? Math.min(1, Math.max(0, (prevNestingHc - currentNestingHc) / prevNestingHc))
        : null
    byWeek.set(row.week, { trainingActualPct, nestingActualPct })
  })
  return byWeek
}

function buildStageWeekMaps(rows: DerivedCapacityRow[], trainingWeeks: number, nestingWeeks: number, assumptions: PlannerAssumptions | null) {
  if (!assumptions || (!trainingWeeks && !nestingWeeks)) {
    return {
      training: Array.from({ length: trainingWeeks }, () => new Map<number, number>()),
      nesting: Array.from({ length: nestingWeeks }, () => new Map<number, number>()),
    }
  }
  const starts = rows.map((row) =>
    row.timeline === 'historical_actual' ? row.actual.actualTrainingStartHc : row.planned.plannedNewHires,
  )
  return buildCohortStageMaps(starts, assumptions)
}

function channelDisplayLabels(channels: readonly string[]): {
  forecastVolume: string
  actualVolume: string
  handledVolume: string
  aht: string
  occupancy: string
  concurrencyLabel: string | null
} {
  const primary = channels.length === 1 ? channels[0] : null
  if (primary === 'chat') {
    return {
      forecastVolume: 'Forecast chats',
      actualVolume: 'Actual chats',
      handledVolume: 'Handled chats',
      aht: 'Chat AHT',
      occupancy: 'Chat occupancy',
      concurrencyLabel: 'Chat concurrency',
    }
  }
  if (primary === 'video') {
    return {
      forecastVolume: 'Forecast sessions',
      actualVolume: 'Actual sessions',
      handledVolume: 'Handled sessions',
      aht: 'Average Session Time',
      occupancy: 'Utilization',
      concurrencyLabel: null,
    }
  }
  if (primary && ['email', 'sms', 'social', 'backOffice'].includes(primary)) {
    return {
      forecastVolume: CHANNEL_VOLUME_LABELS[primary as keyof typeof CHANNEL_VOLUME_LABELS],
      actualVolume: 'Actual volume',
      handledVolume: 'Handled volume',
      aht: 'Average Processing Time',
      occupancy: 'Productivity',
      concurrencyLabel: null,
    }
  }
  return {
    forecastVolume: 'Forecast volume',
    actualVolume: 'Offered volume',
    handledVolume: 'Handled volume',
    aht: 'Planned AHT',
    occupancy: 'Planned occupancy',
    concurrencyLabel: null,
  }
}

function capacityGroups(
  view: CapacityView,
  stageWeekMaps: ReturnType<typeof buildStageWeekMaps>,
  shrinkageLookup: ReturnType<typeof buildShrinkageLookup>,
  actualStageAttritionLookup: ReturnType<typeof buildActualStageAttritionLookup>,
  trainingAttritionRate: number,
  nestingAttritionRate: number,
  visibleShrinkageCategoryIds: string[] = DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS,
  labels = channelDisplayLabels([]),
  chatConcurrency: number | null = null,
  fteBilling = false,
  shrinkageCategories: ShrinkageCategoryTemplate[] = [],
): Record<CapacityGroupId, MatrixRowDef[]> {
  const requiredFteFormula = fteBilling
    ? 'Enter Required Production FTE manually for FTE billing. Volume, AHT, and occupancy are for tracking only and do not drive this value.'
    : 'Required Production FTE (productive staffing, before shrinkage). Voice: (Volume × AHT) ÷ (3600 × Productive Hours × Occupancy). Chat / Per Transaction: also ÷ Concurrency. Email/Back Office: Adjusted Volume × AHT or Processing Time ÷ (Productive Seconds × Occupancy). Paid FTE = Required ÷ (1 − Shrinkage) is separate.'
  const forecastVolumeFormula = fteBilling
    ? 'Tracking only for FTE billing — does not change Required Production FTE.'
    : 'Forecast volume can be manually entered for planning weeks.'
  const plannedAhtFormula = fteBilling
    ? 'Tracking only for FTE billing — does not change Required Production FTE.'
    : undefined
  const plannedOccupancyFormula = fteBilling
    ? 'Tracking only for FTE billing — does not change Required Production FTE.'
    : 'Planned occupancy defaults to 85% unless manually overridden.'
  const cappedAhtFormula = fteBilling
    ? 'Tracking only for FTE billing — does not change Required Production FTE.'
    : 'Upper bound applied to effective AHT in required FTE calculations.'

  return {
    staffing: [
      {
        id: 'required-production-fte',
        label: 'Required Production FTE',
        // Always from Planned Volume / AHT / Occupancy (even on ACTUAL weeks).
        value: (row) => row.planned.requiredFte,
        futureValue: (row) => row.planned.requiredFte,
        format: (value) => fmtNum(value, 2),
        formula: requiredFteFormula,
        // Always export/import Metric_Id=requiredFte so uploads stick for every billing type.
        plannedOverrideKey: 'requiredFte' as const,
        editablePlanned: true,
        step: 0.01,
      },
      {
        id: 'production-fte',
        label: 'Production FTE',
        value: (row) => row.actual.productionFte,
        futureValue: (row) => row.planned.productionFte,
        format: (value) => fmtNum(value, 1),
        exportMetricId: 'productionFte',
        formula:
          'Production FTE = (Production HC × (1 − Shrinkage %)) + Nesting productive FTE.',
      },
      {
        id: 'fte-variance',
        label: 'FTE variance',
        value: (row) =>
          row.actual.productionFte != null && row.planned.requiredFte != null
            ? row.actual.productionFte - row.planned.requiredFte
            : null,
        futureValue: (row) =>
          row.planned.productionFte != null && row.planned.requiredFte != null
            ? row.planned.productionFte - row.planned.requiredFte
            : null,
        format: (value) => fmtVarianceDelta(value, 1),
        formula: 'FTE variance = Production FTE − Required Production FTE.',
        tone: varianceToneHigherBetter,
      },
      {
        id: 'staffing-pct',
        label: 'Staffing (%)',
        value: (row) => safeRatio(row.actual.productionFte, row.planned.requiredFte),
        futureValue: (row) => safeRatio(row.planned.productionFte, row.planned.requiredFte),
        format: (value) => fmtPct(value),
        formula: 'Staffing % = Production FTE ÷ Required Production FTE.',
        tone: staffingPctTone,
      },
      {
        id: 'actual-required-production-fte',
        label: 'Actual Required Production FTE',
        value: (row) => (row.statusLabel === 'Actual' ? row.actual.requiredFte : null),
        futureValue: () => null,
        format: (value) => fmtNum(value, 2),
        defaultOptional: true,
        formula:
          'Actual Required Production FTE uses Actual Volume/Chat, AHT/processing time, Occupancy, and concurrency when present. Optional by default.',
      },
    ],
    headcount: [
      {
        id: 'planned-transfer-in',
        label: 'Planned transfer in',
        value: (row) => row.planned.transferInHc,
        format: (value) => fmtNum(value, 0),
        plannedOverrideKey: 'transferInHc',
        editablePlanned: true,
        step: 1,
        formula:
          'Adds to Planned Production HC: Prior HC + Graduates + Transfer In − Attrition − Transfer Out − Off-roster/LOA.',
      },
      {
        id: 'actual-transfer-in',
        label: 'Actual transfer in',
        value: (row) => (row.statusLabel === 'Actual' ? row.actual.transferInHc : null),
        futureValue: () => null,
        format: (value) => fmtNum(value, 0),
        actualOverrideKey: 'transferInHc',
        editableActual: true,
        editableActualAllHistorical: true,
        step: 1,
        formula:
          'Adds to Actual Production HC on Actual weeks: Beginning HC + Graduates + Transfer In − Attrition − Transfer Out − Off-roster/LOA.',
      },
      {
        id: 'planned-transfer-out',
        label: 'Planned transfer out',
        value: (row) => row.planned.transferOutHc,
        format: (value) => fmtNum(value, 0),
        plannedOverrideKey: 'transferOutHc',
        editablePlanned: true,
        step: 1,
        formula: 'Subtracts from Planned Production HC for the week.',
      },
      {
        id: 'actual-transfer-out',
        label: 'Actual transfer out',
        value: (row) => (row.statusLabel === 'Actual' ? row.actual.transferOutHc : null),
        futureValue: () => null,
        format: (value) => fmtNum(value, 0),
        actualOverrideKey: 'transferOutHc',
        editableActual: true,
        editableActualAllHistorical: true,
        step: 1,
        formula: 'Subtracts from Actual Production HC on Actual weeks.',
      },
      {
        id: 'planned-training-hc',
        label: 'Planned training HC',
        value: (row) => row.planned.trainingHc,
        format: (value) => fmtNum(value, 0),
        formula: 'Training HC equals the sum of all training stage weeks for the period.',
      },
      {
        id: 'actual-training-hc',
        label: 'Actual training HC',
        value: (row) => row.actual.trainingHc,
        futureValue: () => null,
        format: (value) => fmtNum(value, 0),
        actualOverrideKey: 'trainingHc',
        editableActual: true,
        step: 1,
        formula: 'Actual Training HC can be updated by the user for current and last week actuals.',
      },
      {
        id: 'planned-nesting-hc',
        label: 'Planned nesting HC',
        value: (row) => row.planned.nestingHc,
        format: (value) => fmtNum(value, 0),
        formula: 'Nesting HC equals the sum of all nesting stage weeks for the period.',
      },
      {
        id: 'actual-nesting-hc',
        label: 'Actual nesting HC',
        value: (row) => row.actual.nestingHc,
        futureValue: () => null,
        format: (value) => fmtNum(value, 0),
        actualOverrideKey: 'nestingHc',
        editableActual: true,
        step: 1,
        formula: 'Actual Nesting HC can be updated by the user for current and last week actuals.',
      },
      {
        id: 'planned-offroster-loa-hc',
        label: 'Planned offroster / LOA HC',
        value: (row) => row.planned.offRosterLoaHc,
        format: (value) => fmtNum(value, 0),
        plannedOverrideKey: 'offRosterLoaHc',
        editablePlanned: true,
        step: 1,
        formula: 'Employees off roster or on leave of absence, deducted from planned production HC.',
      },
      {
        id: 'actual-offroster-loa-hc',
        label: 'Actual offroster / LOA HC',
        value: (row) => row.actual.offRosterLoaHc,
        futureValue: () => null,
        format: (value) => fmtNum(value, 0),
        actualOverrideKey: 'offRosterLoaHc',
        editableActual: true,
        editableActualAllHistorical: true,
        step: 1,
        formula: 'Employees off roster or on leave of absence, deducted from actual production HC.',
      },
      {
        id: 'planned-production-hc',
        label: 'Planned production HC',
        value: (row) => row.planned.productionHc,
        format: (value) => fmtNum(value, 0),
        formula: PLANNED_PRODUCTION_HC_FORMULA,
      },
      {
        id: 'actual-production-hc',
        label: 'Actual production HC',
        value: (row) => actualProductionHcForDisplay(row),
        format: (value) => fmtNum(value, 0),
        actualOverrideKey: 'productionHc',
        editableActual: true,
        editableActualPlanningWeek: true,
        editableActualAllHistorical: true,
        step: 1,
        formula: ACTUAL_PRODUCTION_HC_FORMULA,
      },
      {
        id: 'planned-support-hc',
        label: 'Planned support HC',
        value: (row) => row.planned.supportHc,
        format: (value) => fmtNum(value, 0),
        plannedOverrideKey: 'supportHc',
        editablePlanned: true,
        step: 1,
        formula: 'Support HC counts active roster staff in non-Agent roles.',
      },
      {
        id: 'actual-support-hc',
        label: 'Actual support HC',
        value: (row) => actualSupportHcForDisplay(row),
        format: (value) => fmtNum(value, 0),
        actualOverrideKey: 'supportHc',
        editableActual: true,
        editableActualAllHistorical: true,
        step: 1,
        formula: 'Support HC counts active roster staff in non-Agent roles on actual weeks only.',
      },
    ],
    pipeline: [
      {
        id: 'planned-new-hire',
        label: 'Planned new hire',
        value: (row) => row.planned.plannedNewHires,
        format: (value) => fmtNum(value, 0),
        plannedOverrideKey: 'plannedNewHires',
        editablePlanned: true,
        step: 1,
      },
      {
        id: 'actual-start-hc',
        label: 'Actual start HC',
        value: (row) => row.actual.actualTrainingStartHc,
        futureValue: (row) => row.planned.plannedNewHires,
        format: (value) => fmtNum(value, 0),
        actualOverrideKey: 'actualTrainingStartHc',
        editableActual: true,
        step: 1,
      },
      ...(view === 'weekly'
        ? stageWeekMaps.training.map((map, index) => ({
            id: `training-week-${index + 1}`,
            label: `Training Week ${index + 1}`,
            value: (row: DerivedCapacityRow) => map.get(row.periodIndex) ?? 0,
            format: (value: number | null | undefined) => fmtNum(value, 0),
          }))
        : []),
      ...(view === 'weekly'
        ? stageWeekMaps.nesting.map((map, index) => ({
            id: `nesting-week-${index + 1}`,
            label: `Nesting Week ${index + 1}`,
            value: (row: DerivedCapacityRow) => map.get(row.periodIndex) ?? 0,
            format: (value: number | null | undefined) => fmtNum(value, 0),
          }))
        : []),
      {
        id: 'graduate-hc',
        label: 'Graduate HC',
        value: (row) => row.actual.graduateHc,
        futureValue: (row) => row.planned.graduateHc,
        format: (value) => fmtNum(value, 0),
        plannedOverrideKey: 'graduateHc',
        editablePlanned: true,
        editablePlannedCurrentWeekOnly: true,
        step: 1,
        formula:
          'Graduate HC = previous week final Nesting week HC × (1 − planned nesting attrition %). Uses the last nesting stage only, not total nesting HC.',
      },
      {
        id: 'nesting-phone-time',
        label: 'Nesting phone time %',
        value: (row) => row.actual.nestingPhoneTimePct,
        futureValue: (row) => row.planned.nestingPhoneTimePct,
        format: (value) => fmtPct(value),
        formula: 'Nesting phone time % follows the Training settings ramp configured when the capacity plan was created.',
      },
    ],
    attrition: [
      {
        id: 'planned-attrition-pct',
        label: 'Planned attrition %',
        value: (row) => row.planned.attritionPct,
        format: (value) => fmtPct(value),
        plannedOverrideKey: 'attritionPct',
        editablePlanned: true,
        step: 0.1,
        isPercentInput: true,
        formula:
          'Planned attrition % = Planned production HC attrition / Planned production HC. Enter a weekly rate to set planned attrition HC.',
      },
      {
        id: 'actual-attrition-pct',
        label: 'Actual attrition %',
        value: (row) => actualProductionAttritionPct(row),
        futureValue: (row) => actualProductionAttritionPct(row),
        format: (value) => fmtPct(value),
        formula:
          'Actual attrition % = Actual production HC attrition ÷ beginning production HC (for weeks marked Actual).',
      },
      {
        id: 'planned-production-hc-attrition',
        label: 'Planned production HC attrition',
        value: (row) => plannedProductionHcAttrition(row),
        format: (value) => fmtNum(value, 0),
        formula: 'Planned production HC attrition = Planned attrition % × Planned production HC (whole number).',
      },
      {
        id: 'actual-production-hc-attrition',
        label: 'Actual production HC attrition',
        value: (row) => (row.statusLabel === 'Actual' ? row.actual.attritionHc : null),
        futureValue: (row) => (row.statusLabel === 'Actual' ? row.actual.attritionHc : null),
        format: (value) => fmtNum(value, 0),
        actualOverrideKey: 'attritionHc',
        editableActual: true,
        editableActualAllHistorical: true,
        step: 1,
        formula:
          'Actual production HC attrition is entered for weeks marked Actual. Actual attrition % = attrition HC ÷ Beginning Production HC.',
      },
      {
        id: 'planned-training-attrition',
        label: 'Planned training attrition %',
        value: (row) => row.planned.trainingAttritionPct ?? trainingAttritionRate,
        format: (value) => fmtPct(value),
        plannedOverrideKey: 'trainingAttritionPct',
        editablePlanned: true,
        step: 0.1,
        isPercentInput: true,
        formula:
          'Weekly planned training attrition %. Editing a future week recalculates training attrition HC and downstream pipeline headcount.',
      },
      {
        id: 'actual-training-attrition',
        label: 'Actual training attrition %',
        value: (row) => actualStageAttritionLookup.get(row.week)?.trainingActualPct ?? null,
        futureValue: () => null,
        format: (value) => fmtPct(value),
        formula: 'Actual training attrition % = (Previous week training HC − Current week training HC) / Previous week training HC.',
      },
      {
        id: 'planned-training-attrition-hc',
        label: 'Planned training attrition HC',
        value: (row) => row.planned.trainingAttritionHc,
        format: (value) => fmtNum(value, 0),
        formula: 'Planned training attrition HC = Training HC × Planned training attrition % (when overridden) or pipeline attrition.',
      },
      {
        id: 'actual-training-attrition-hc',
        label: 'Actual training attrition HC',
        value: (row) => row.actual.trainingAttritionHc,
        futureValue: () => null,
        format: (value) => fmtNum(value, 0),
      },
      {
        id: 'planned-nesting-attrition',
        label: 'Planned nesting attrition %',
        value: (row) => row.planned.nestingAttritionPct ?? nestingAttritionRate,
        format: (value) => fmtPct(value),
        plannedOverrideKey: 'nestingAttritionPct',
        editablePlanned: true,
        step: 0.1,
        isPercentInput: true,
        formula:
          'Weekly planned nesting attrition %. Editing a future week recalculates nesting attrition HC, graduates, and pipeline headcount.',
      },
      {
        id: 'actual-nesting-attrition',
        label: 'Actual nesting attrition %',
        value: (row) => actualStageAttritionLookup.get(row.week)?.nestingActualPct ?? null,
        futureValue: () => null,
        format: (value) => fmtPct(value),
        formula: 'Actual nesting attrition % = (Previous week nesting HC − Current week nesting HC) / Previous week nesting HC.',
      },
      {
        id: 'planned-nesting-attrition-hc',
        label: 'Planned nesting attrition HC',
        value: (row) => row.planned.nestingAttritionHc,
        format: (value) => fmtNum(value, 0),
        formula: 'Planned nesting attrition HC from the training pipeline after planned nesting attrition.',
      },
      {
        id: 'actual-nesting-attrition-hc',
        label: 'Actual nesting attrition HC',
        value: (row) => row.actual.nestingAttritionHc,
        futureValue: () => null,
        format: (value) => fmtNum(value, 0),
      },
      {
        id: 'attrition-variance',
        label: 'Attrition rate variance (Act - Pl)',
        value: (row) => {
          const actualPct = actualProductionAttritionPct(row)
          if (actualPct == null || row.planned.attritionPct == null) return null
          return actualPct - row.planned.attritionPct
        },
        futureValue: () => null,
        format: (value) => fmtVarianceDeltaPct(value),
        formula: 'Attrition variance = Actual attrition % - Planned attrition %.',
        tone: varianceToneLowerBetter,
      },
    ],
    volume: [
      {
        id: 'forecast-volume',
        label: labels.forecastVolume,
        value: (row) => row.planned.volume,
        format: (value) => fmtNum(value, 0),
        plannedOverrideKey: 'callVolume',
        editablePlanned: true,
        step: 1,
        formula: forecastVolumeFormula,
      },
      {
        id: 'offered-volume',
        label: labels.actualVolume,
        value: (row) => row.actual.offeredVolume,
        futureValue: (row) => (row.statusLabel === 'Actual' ? row.actual.offeredVolume : null),
        format: (value) => fmtNum(value, 0),
        actualOverrideKey: 'callVolume',
        editableActual: true,
        step: 1,
        formula: 'Offered volume can be manually entered for actual weeks.',
      },
      {
        id: 'handled-volume',
        label: labels.handledVolume,
        value: (row) => row.actual.handledVolume,
        futureValue: (row) => (row.statusLabel === 'Actual' ? row.actual.handledVolume : null),
        format: (value) => fmtNum(value, 0),
        actualOverrideKey: 'handledVolume',
        editableActual: true,
        step: 1,
        formula: 'Handled volume is a whole number and can be entered for actual weeks.',
      },
      {
        id: 'offered-to-forecast-pct',
        label: 'Offered to Forecast %',
        value: (row) => {
          if (row.statusLabel !== 'Actual') return null
          if (row.planned.volume == null || row.planned.volume <= 0) return null
          // Offered defaults to 0 when blank — never invent forecast as offered.
          return safeRatio(row.actual.offeredVolume ?? 0, row.planned.volume)
        },
        futureValue: () => null,
        format: (value) => fmtPct(value),
        formula: 'Offered to Forecast % = Offered volume / Forecast volume. Blank offered volume counts as 0.',
        tone: offeredToForecastTone,
      },
      {
        id: 'handled-volume-variance',
        label: 'Handled volume variance (Hnd - Off)',
        value: (row) => {
          if (row.statusLabel !== 'Actual') return null
          if (row.actual.handledVolume == null) return null
          return row.actual.handledVolume - (row.actual.offeredVolume ?? 0)
        },
        futureValue: () => null,
        format: (value) => fmtVarianceDelta(value, 0),
        formula: 'Handled volume variance = Handled volume - Offered volume.',
        tone: varianceToneHigherBetter,
      },
    ],
    shrinkage: [
      {
        id: 'planned-shrinkage',
        label: 'Planned shrinkage',
        value: (row) => {
          const lookup = shrinkageLookup.rowsByWeek.get(row.week)
          if (!lookup) return row.planned.shrinkagePct
          return (lookup.outOfOfficePlanned ?? 0) + (lookup.inOfficePlanned ?? 0)
        },
        format: (value) => fmtPct(value),
        formula: 'Planned shrinkage = Planned out of office shrinkage + Planned in office shrinkage.',
      },
      {
        id: 'actual-shrinkage',
        label: 'Actual shrinkage',
        value: (row) => {
          const lookup = shrinkageLookup.rowsByWeek.get(row.week)
          if (lookup && row.timeline === 'historical_actual') {
            return (lookup.outOfOfficeActual ?? 0) + (lookup.inOfficeActual ?? 0)
          }
          return null
        },
        futureValue: () => null,
        format: (value) => fmtPct(value),
        formula: 'Actual shrinkage = Actual out of office shrinkage + Actual in office shrinkage.',
      },
      {
        id: 'planned-ooo-shrinkage',
        label: 'Planned out of office shrinkage',
        value: (row) => shrinkageLookup.rowsByWeek.get(row.week)?.outOfOfficePlanned ?? 0,
        format: (value) => fmtPct(value),
        formula: 'Sum of visible custom Out of office planned category percentages.',
      },
      {
        id: 'actual-ooo-shrinkage',
        label: 'Actual out of office shrinkage',
        value: (row) =>
          row.timeline === 'historical_actual'
            ? shrinkageLookup.rowsByWeek.get(row.week)?.outOfOfficeActual ?? 0
            : null,
        futureValue: () => null,
        format: (value) => fmtPct(value),
        formula: 'Sum of visible custom Out of office actual category percentages (past weeks).',
      },
      {
        id: 'planned-inoffice-shrinkage',
        label: 'Planned in office shrinkage',
        value: (row) => shrinkageLookup.rowsByWeek.get(row.week)?.inOfficePlanned ?? 0,
        format: (value) => fmtPct(value),
        formula: 'Sum of visible custom In office planned category percentages.',
      },
      {
        id: 'actual-inoffice-shrinkage',
        label: 'Actual in office shrinkage',
        value: (row) =>
          row.timeline === 'historical_actual'
            ? shrinkageLookup.rowsByWeek.get(row.week)?.inOfficeActual ?? 0
            : null,
        futureValue: () => null,
        format: (value) => fmtPct(value),
        formula: 'Sum of visible custom In office actual category percentages (past weeks).',
      },
      ...visibleShrinkageCategoryIds.flatMap((categoryId) => {
        const template = shrinkageCategories.find((item) => item.id === categoryId)
        const billableTag = template?.billable ? 'Billable' : 'Not Billable'
        const baseName = shrinkageLookup.labels[categoryId] ?? categoryId
        return [
        {
          id: `planned-${categoryId}`,
          label: `${baseName} planned (${billableTag})`,
          value: (row: DerivedCapacityRow) => shrinkageLookup.rowsByWeek.get(row.week)?.categories?.[categoryId]?.planned ?? null,
          format: (value: number | null | undefined) => fmtPct(value),
          editablePlanned: true,
          shrinkageCategoryId: categoryId,
          shrinkageEditKind: 'planned' as const,
          step: 0.1,
          isPercentInput: true,
          formula: 'Included in Planned out of office / in office totals when visible. Only Not Billable overages count toward leakages.',
        },
        {
          id: `actual-${categoryId}`,
          label: `${baseName} actual (${billableTag})`,
          value: (row: DerivedCapacityRow) =>
            row.timeline === 'historical_actual'
              ? shrinkageLookup.rowsByWeek.get(row.week)?.categories?.[categoryId]?.actual ?? null
              : null,
          futureValue: () => null,
          format: (value: number | null | undefined) => fmtPct(value),
          editableActual: true,
          shrinkageCategoryId: categoryId,
          shrinkageEditKind: 'actual' as const,
          step: 0.1,
          isPercentInput: true,
          formula: 'Editable on past weeks only. Included in Actual out of office / in office totals when visible.',
        },
      ]
      }),
      {
        id: 'shrinkage-variance',
        label: 'Shrinkage variance (Act - Pl)',
        value: (row) => {
          if (row.timeline !== 'historical_actual') return null
          const lookup = shrinkageLookup.rowsByWeek.get(row.week)
          if (!lookup) return null
          const planned = (lookup.outOfOfficePlanned ?? 0) + (lookup.inOfficePlanned ?? 0)
          const actual = (lookup.outOfOfficeActual ?? 0) + (lookup.inOfficeActual ?? 0)
          return actual - planned
        },
        futureValue: () => null,
        format: (value) => fmtVarianceDeltaPct(value),
        formula: 'Shrinkage variance = Actual shrinkage % - Planned shrinkage %.',
        tone: varianceToneLowerBetter,
      },
    ],
    aht: [
      {
        id: 'planned-aht',
        label: labels.aht,
        value: (row) => row.planned.ahtSeconds,
        format: (value) => fmtNum(value, 1),
        plannedOverrideKey: 'ahtSeconds',
        editablePlanned: true,
        step: 1,
        formula: plannedAhtFormula ?? 'Planned AHT can be manually entered for planning weeks.',
      },
      {
        id: 'capped-aht',
        label: 'Capped AHT',
        value: (row) => row.planned.cappedAhtSeconds,
        format: (value) => fmtNum(value, 1),
        plannedOverrideKey: 'cappedAhtSeconds',
        editablePlanned: true,
        step: 1,
        formula: cappedAhtFormula,
      },
      {
        id: 'actual-aht',
        label: labels.aht.replace('Planned', 'Actual'),
        value: (row) => row.actual.ahtSeconds,
        futureValue: (row) => (row.statusLabel === 'Actual' ? row.actual.ahtSeconds : null),
        format: (value) => fmtNum(value, 1),
        actualOverrideKey: 'ahtSeconds',
        editableActual: true,
        step: 1,
      },
      {
        id: 'aht-variance',
        label: 'AHT variance sec (Act - Pl)',
        value: (row) =>
          row.planned.ahtSeconds != null && row.actual.ahtSeconds != null
            ? row.actual.ahtSeconds - row.planned.ahtSeconds
            : null,
        futureValue: () => null,
        format: (value) => fmtVarianceDeltaSeconds(value),
        formula: 'AHT variance = Actual AHT - Planned AHT.',
        tone: varianceToneLowerBetter,
      },
    ],
    occupancy: [
      {
        id: 'planned-occupancy',
        label: labels.occupancy,
        value: (row) => row.planned.occupancy,
        format: (value) => fmtPct(value),
        plannedOverrideKey: 'occupancy',
        editablePlanned: true,
        step: 0.1,
        isPercentInput: true,
        formula: plannedOccupancyFormula,
      },
      {
        id: 'actual-occupancy',
        label: labels.occupancy.replace('Planned', 'Actual'),
        value: (row) => row.actual.occupancy,
        futureValue: (row) => (row.statusLabel === 'Actual' ? row.actual.occupancy : null),
        format: (value) => fmtPct(value),
        actualOverrideKey: 'occupancy',
        editableActual: true,
        step: 0.1,
        isPercentInput: true,
        formula: 'Actual occupancy is capped at 100%. Unlock past weeks to edit on past / Actual columns.',
      },
      {
        id: 'occupancy-variance',
        label: 'Occupancy variance (Act - Pl)',
        value: (row) => {
          if (row.actual.occupancy == null || row.planned.occupancy == null) return null
          return row.actual.occupancy - row.planned.occupancy
        },
        futureValue: () => null,
        format: (value) => fmtVarianceDeltaPct(value),
        formula: 'Occupancy variance = Actual occupancy % - Planned occupancy %.',
        tone: varianceToneHigherBetter,
      },
      ...(labels.concurrencyLabel
        ? [
            {
              id: 'chat-concurrency',
              label: labels.concurrencyLabel,
              value: () => chatConcurrency,
              futureValue: () => chatConcurrency,
              format: (value: number | null | undefined) => fmtNum(value, 1),
              formula: 'Chat concurrency = simultaneous chats handled per agent.',
            } satisfies MatrixRowDef,
          ]
        : []),
    ],
    hours: [
      {
        id: 'scheduled-billable-hours',
        label: 'Scheduled Billable Hours',
        value: (row) => row.planned.scheduledBillableHours,
        format: (value) => fmtNum(value, 1),
        plannedOverrideKey: 'scheduledBillableHours',
        editablePlanned: true,
        step: 0.1,
        formula: 'Manually entered scheduled billable hours for planning weeks.',
      },
      {
        id: 'actual-billable-hours',
        label: 'Actual Billable Hours',
        value: (row) => row.actual.actualBillableHours,
        futureValue: () => null,
        format: (value) => fmtNum(value, 1),
        actualOverrideKey: 'actualBillableHours',
        editableActual: true,
        editableActualAllHistorical: true,
        editableActualPlanningWeek: true,
        step: 0.1,
        formula: 'Manually entered actual billable hours for Actual / past weeks.',
      },
      {
        id: 'productive-hours',
        label: 'Productive Hours',
        value: (row) =>
          row.statusLabel === 'Actual' ? row.actual.productiveHours : row.planned.productiveHours,
        format: (value) => fmtNum(value, 1),
        plannedOverrideKey: 'productiveHours',
        actualOverrideKey: 'productiveHours',
        editablePlanned: true,
        editableActual: true,
        editableActualAllHistorical: true,
        editableActualPlanningWeek: true,
        step: 0.1,
        formula: 'Manually entered productive hours (planned on forward weeks, actual on Actual weeks).',
      },
      {
        id: 'payroll-hours',
        label: 'Payroll Hours',
        value: (row) =>
          row.statusLabel === 'Actual' ? row.actual.payrollHours : row.planned.payrollHours,
        format: (value) => fmtNum(value, 1),
        plannedOverrideKey: 'payrollHours',
        actualOverrideKey: 'payrollHours',
        editablePlanned: true,
        editableActual: true,
        editableActualAllHistorical: true,
        editableActualPlanningWeek: true,
        step: 0.1,
        formula: 'Manually entered payroll hours (planned on forward weeks, actual on Actual weeks).',
      },
      {
        id: 'switch-hours',
        label: 'Switch Hours',
        value: (row) =>
          row.statusLabel === 'Actual' ? row.actual.switchHours : row.planned.switchHours,
        format: (value) => fmtNum(value, 1),
        plannedOverrideKey: 'switchHours',
        actualOverrideKey: 'switchHours',
        editablePlanned: true,
        editableActual: true,
        editableActualAllHistorical: true,
        editableActualPlanningWeek: true,
        step: 0.1,
        formula: 'Manually entered switch hours (planned on forward weeks, actual on Actual weeks).',
      },
    ],
    seats: [
      {
        id: 'seat-count',
        label: 'Number of seats',
        value: (row) => row.planned.seatCount,
        format: (value) => fmtNum(value, 0),
        plannedOverrideKey: 'seatCount',
        editablePlanned: true,
        step: 1,
        formula: 'Manually entered seat capacity for the week.',
      },
      {
        id: 'peak-ratio',
        label: 'Peak ratio (%)',
        value: (row) => row.planned.peakRatioPct,
        format: (value) => fmtPct(value),
        plannedOverrideKey: 'peakRatioPct',
        editablePlanned: true,
        isPercentInput: true,
        step: 0.1,
        formula: 'Peak ratio applied to Onsite HC when estimating seat demand. WAH HC is not included.',
      },
      {
        id: 'onsite-hc',
        label: 'Onsite HC',
        value: (row) => row.planned.onsiteHc,
        format: (value) => fmtNum(value, 0),
        plannedOverrideKey: 'onsiteHc',
        editablePlanned: true,
        step: 1,
        formula: 'Onsite production HC entered for the week. Blank stays blank.',
      },
      {
        id: 'wah-hc',
        label: 'WAH HC',
        value: (row) => row.planned.wahHc,
        format: (value) => fmtNum(value, 0),
        plannedOverrideKey: 'wahHc',
        editablePlanned: true,
        step: 1,
        formula: 'Work-at-home production HC entered for the week. Blank stays blank.',
      },
      {
        id: 'seat-demand',
        label: 'Seat demand',
        value: (row) => scenarioSeatDemand(row.planned.productionHc, row.planned.peakRatioPct, row.planned.supportHc, row.planned.onsiteHc),
        format: (value) => fmtNum(value, 1),
        formula: 'Seat demand = (Peak ratio × Onsite HC) + Planned Support HC. Blank when Onsite HC or Peak ratio is blank.',
      },
      {
        id: 'seat-variance',
        label: 'Seat variance',
        value: (row) => {
          const seats = row.planned.seatCount
          const demand = scenarioSeatDemand(row.planned.productionHc, row.planned.peakRatioPct, row.planned.supportHc, row.planned.onsiteHc)
          if (seats == null || demand == null) return null
          return seats - demand
        },
        format: (value) => fmtVarianceDelta(value, 1),
        formula: 'Seat variance = Number of seats − Seat demand.',
        tone: varianceToneHigherBetter,
      },
    ],
  }
}

function bucketLabel(weekIso: string, view: CapacityView): string {
  const date = new Date(weekIso + 'T12:00:00')
  if (view === 'monthly') return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
  if (view === 'quarterly') return `Q${Math.floor(date.getMonth() / 3) + 1} ${String(date.getFullYear()).slice(-2)}`
  return weekIso
}

function avg(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
}

function avgNullable(values: Array<number | null>): number | null {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (!filtered.length) return null
  return avg(filtered)
}

function sumNullableHours(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter((value): value is number => value != null && Number.isFinite(value))
  if (!filtered.length) return null
  return filtered.reduce((sum, value) => sum + value, 0)
}

function aggregateSnapshot(rows: CapacityMetricSnapshot[]): CapacityMetricSnapshot {
  const first = rows[0]!
  const last = rows[rows.length - 1]!
  return {
    beginningProductionHc: first.beginningProductionHc,
    plannedNewHires: rows.reduce((sum, row) => sum + row.plannedNewHires, 0),
    actualTrainingStartHc: rows.reduce((sum, row) => sum + row.actualTrainingStartHc, 0),
    trainingHc: avg(rows.map((row) => row.trainingHc)),
    nestingHc: avg(rows.map((row) => row.nestingHc)),
    graduateHc: rows.reduce((sum, row) => sum + row.graduateHc, 0),
    trainingAttritionHc: rows.reduce((sum, row) => sum + row.trainingAttritionHc, 0),
    nestingAttritionHc: rows.reduce((sum, row) => sum + row.nestingAttritionHc, 0),
    trainingAttritionPct: avgNullable(rows.map((row) => row.trainingAttritionPct)),
    nestingAttritionPct: avgNullable(rows.map((row) => row.nestingAttritionPct)),
    attritionHc: rows.reduce((sum, row) => sum + row.attritionHc, 0),
    attritionPct: avgNullable(rows.map((row) => row.attritionPct)),
    transferInHc: rows.reduce((sum, row) => sum + row.transferInHc, 0),
    transferOutHc: rows.reduce((sum, row) => sum + row.transferOutHc, 0),
    offRosterLoaHc: rows.reduce((sum, row) => sum + row.offRosterLoaHc, 0),
    supportHc: rows.reduce((sum, row) => sum + row.supportHc, 0),
    volume: rows.reduce((sum, row) => sum + row.volume, 0),
    offeredVolume: rows.reduce((sum, row) => sum + row.offeredVolume, 0),
    handledVolume: rows.reduce((sum, row) => sum + (row.handledVolume ?? 0), 0),
    ahtSeconds: avg(rows.map((row) => row.ahtSeconds ?? 0)),
    cappedAhtSeconds: avg(rows.map((row) => row.cappedAhtSeconds ?? 0)),
    occupancy: avg(rows.map((row) => row.occupancy)),
    shrinkagePct: avg(rows.map((row) => row.shrinkagePct)),
    nestingPhoneTimePct: avg(rows.map((row) => row.nestingPhoneTimePct)),
    productionHc: last.productionHc,
    vlAllocationHc: avg(rows.map((row) => row.vlAllocationHc)),
    requiredFte: avgNullable(rows.map((row) => row.requiredFte)),
    coreProductionFte: avg(rows.map((row) => row.coreProductionFte)),
    nestingProductiveFte: avg(rows.map((row) => row.nestingProductiveFte)),
    productionFte: avg(rows.map((row) => row.productionFte)),
    staffingPct: avgNullable(rows.map((row) => row.staffingPct)),
    overUnderFte: avg(rows.map((row) => row.overUnderFte)),
    scheduledBillableHours: sumNullableHours(rows.map((row) => row.scheduledBillableHours)),
    actualBillableHours: sumNullableHours(rows.map((row) => row.actualBillableHours)),
    productiveHours: sumNullableHours(rows.map((row) => row.productiveHours)),
    payrollHours: sumNullableHours(rows.map((row) => row.payrollHours)),
    switchHours: sumNullableHours(rows.map((row) => row.switchHours)),
    seatCount: avgNullable(rows.map((row) => row.seatCount)),
    peakRatioPct: avgNullable(rows.map((row) => row.peakRatioPct)),
    onsiteHc: avgNullable(rows.map((row) => row.onsiteHc)),
    wahHc: avgNullable(rows.map((row) => row.wahHc)),
  }
}

function aggregateLedgerSnapshot(rows: LedgerMetricSnapshot[]): LedgerMetricSnapshot {
  return {
    callVolume: rows.reduce((sum, row) => sum + (row.callVolume ?? 0), 0),
    handledVolume: rows.reduce((sum, row) => sum + (row.handledVolume ?? 0), 0),
    ahtSeconds: avg(rows.map((row) => row.ahtSeconds ?? 0)),
    cappedAhtSeconds: avg(rows.map((row) => row.cappedAhtSeconds ?? 0)),
    occupancy: avg(rows.map((row) => row.occupancy ?? 0)),
    beginningProductionHc: rows.reduce((sum, row) => sum + (row.beginningProductionHc ?? 0), 0),
    plannedNewHires: rows.reduce((sum, row) => sum + (row.plannedNewHires ?? 0), 0),
    actualTrainingStartHc: rows.reduce((sum, row) => sum + (row.actualTrainingStartHc ?? 0), 0),
    trainingHc: rows.reduce((sum, row) => sum + (row.trainingHc ?? 0), 0),
    nestingHc: rows.reduce((sum, row) => sum + (row.nestingHc ?? 0), 0),
    graduateHc: rows.reduce((sum, row) => sum + (row.graduateHc ?? 0), 0),
    trainingAttritionPct: avgNullable(rows.map((row) => row.trainingAttritionPct)),
    nestingAttritionPct: avgNullable(rows.map((row) => row.nestingAttritionPct)),
    attritionHc: rows.reduce((sum, row) => sum + (row.attritionHc ?? 0), 0),
    attritionPct: avg(rows.map((row) => row.attritionPct ?? 0)),
    transferInHc: rows.reduce((sum, row) => sum + (row.transferInHc ?? 0), 0),
    transferOutHc: rows.reduce((sum, row) => sum + (row.transferOutHc ?? 0), 0),
    offRosterLoaHc: rows.reduce((sum, row) => sum + (row.offRosterLoaHc ?? 0), 0),
    supportHc: rows.reduce((sum, row) => sum + (row.supportHc ?? 0), 0),
    productionHc: rows.reduce((sum, row) => sum + (row.productionHc ?? 0), 0),
    requiredFte: rows.reduce((sum, row) => sum + (row.requiredFte ?? 0), 0),
    coreProductionFte: rows.reduce((sum, row) => sum + (row.coreProductionFte ?? 0), 0),
    nestingProductiveFte: rows.reduce((sum, row) => sum + (row.nestingProductiveFte ?? 0), 0),
    productionFte: rows.reduce((sum, row) => sum + (row.productionFte ?? 0), 0),
    staffingPct: null,
    overUnderStaffing: rows.reduce((sum, row) => sum + (row.overUnderStaffing ?? 0), 0),
    totalShrinkagePct: avg(rows.map((row) => row.totalShrinkagePct ?? 0)),
    scheduledBillableHours: sumNullableHours(rows.map((row) => row.scheduledBillableHours)),
    actualBillableHours: sumNullableHours(rows.map((row) => row.actualBillableHours)),
    productiveHours: sumNullableHours(rows.map((row) => row.productiveHours)),
    payrollHours: sumNullableHours(rows.map((row) => row.payrollHours)),
    switchHours: sumNullableHours(rows.map((row) => row.switchHours)),
    seatCount: avgNullable(rows.map((row) => row.seatCount)),
    peakRatioPct: avgNullable(rows.map((row) => row.peakRatioPct)),
    onsiteHc: avgNullable(rows.map((row) => row.onsiteHc)),
    wahHc: avgNullable(rows.map((row) => row.wahHc)),
  }
}

function combineLedgerRows(groups: WeeklyLedgerRow[][]): WeeklyLedgerRow[] {
  const buckets = new Map<string, WeeklyLedgerRow[]>()
  groups.flat().forEach((row) => {
    buckets.set(row.week, [...(buckets.get(row.week) ?? []), row])
  })
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, bucket]) => {
      const first = bucket[0]!
      const plannedSummaries = bucket.map((row) => row.planned)
      const actualSummaries = bucket.map((row) => row.actual).filter((row): row is LedgerMetricSnapshot => row != null)
      const shrinkageById = new Map<string, WeeklyLedgerRow['shrinkage'][number][]>()
      bucket.forEach((row) => {
        row.shrinkage.forEach((item) => {
          shrinkageById.set(item.id, [...(shrinkageById.get(item.id) ?? []), item])
        })
      })
      return {
        ...first,
        key: `${first.client}::combined::${week}`,
        location: 'Combined',
        week,
        planned: aggregateLedgerSnapshot(plannedSummaries),
        actual: actualSummaries.length ? aggregateLedgerSnapshot(actualSummaries) : null,
        shrinkage: [...shrinkageById.entries()].map(([id, items]) => ({
          id,
          name: items[0]!.name,
          group: items[0]!.group,
          billable: items[0]!.billable,
          plannedPct: avg(items.map((item) => item.plannedPct)),
          actualPct: avgNullable(items.map((item) => item.actualPct)),
        })),
      }
    })
}

function aggregateRows(rows: DerivedCapacityRow[], view: CapacityView): DerivedCapacityRow[] {
  if (view === 'weekly') return rows
  const buckets = new Map<string, DerivedCapacityRow[]>()
  for (const row of rows) {
    const key = bucketLabel(row.week, view)
    buckets.set(key, [...(buckets.get(key) ?? []), row])
  }
  return [...buckets.entries()].map(([label, bucket]) => {
    const first = bucket[0]!
    return {
      ...first,
      week: label,
      statusLabel: bucket.every((row) => row.statusLabel === 'Actual') ? 'Actual' : 'Planned',
      timeline: bucket.every((row) => row.timeline === 'historical_actual') ? 'historical_actual' : 'forward_plan',
      planned: aggregateSnapshot(bucket.map((row) => row.planned)),
      actual: aggregateSnapshot(bucket.map((row) => row.actual)),
      shrinkageCategories: first.shrinkageCategories,
    }
  })
}

function statusClass(status: DerivedCapacityRow['statusLabel']): string {
  return capacityStatusClass(status)
}

function weekHeaderClass(status: DerivedCapacityRow['statusLabel']): string {
  return capacityWeekHeaderClass(status === 'Actual' ? 'historical_actual' : 'forward_plan')
}

function matrixCellClasses(options: {
  tone: string
  timeline: DerivedCapacityRow['timeline']
  editable: boolean
  editKind?: 'planned' | 'actual'
  invalid?: boolean
}): string {
  const weekClass = capacityWeekCellClass(options.timeline)
  if (options.editable && options.editKind) {
    return `pva-ref-table__num pva-ref-table__num--${options.tone} cap-ledger-matrix__cell cap-ledger-matrix__cell--input cap-ledger-matrix__cell--${options.editKind}${options.invalid ? ' cap-ledger-matrix__cell--invalid' : ''} ${weekClass}`
  }
  return `pva-ref-table__num pva-ref-table__num--${options.tone} cap-ledger-matrix__cell cap-ledger-matrix__cell--locked cap-ledger-matrix__cell--calculated ${weekClass}`
}

type MatrixNumberInputProps = {
  value: string
  dirty?: boolean
  invalid?: boolean
  disabled?: boolean
  min?: number
  max?: number
  step?: number
  ariaLabel: string
  kind: MatrixEditKind
  week: string
  metricId: string
  onChange: (next: string) => void
  onClear: () => void
  onPasteGrid?: (grid: string[][]) => void
  onNotice?: (message: string) => void
}

/** Shared editable matrix cell — text entry, select-on-focus, paste, Esc resets. */
function MatrixNumberInput({
  value,
  dirty = false,
  invalid = false,
  disabled = false,
  min = 0,
  max,
  step = 1,
  ariaLabel,
  kind,
  week,
  metricId,
  onChange,
  onClear,
  onPasteGrid,
  onNotice,
}: MatrixNumberInputProps) {
  const parsed = parseMetricDraft(metricId, value)
  const title =
    parsed.status === 'invalid'
      ? parsed.message
      : parsed.status === 'ok' && parsed.clamped
        ? `Capped at ${max ?? metricInputBounds(metricId).max}`
        : 'Type a value · Enter moves to next week · Esc resets · Ctrl+V pastes · Save to keep'
  return (
    <input
      className={`cap-ledger-matrix__input${dirty ? ' cap-ledger-matrix__input--dirty' : ''}${invalid ? ' cap-ledger-matrix__input--invalid' : ''}`}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      title={title}
      data-cap-kind={kind}
      data-cap-week={week}
      data-cap-metric={metricId}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => onChange(sanitizeNumericDraft(event.target.value))}
      onPaste={(event) => {
        const text = event.clipboardData.getData('text')
        const grid = parseClipboardGrid(text)
        if (grid.length > 1 || (grid[0]?.length ?? 0) > 1) {
          event.preventDefault()
          onPasteGrid?.(grid)
          onNotice?.(`Pasted ${grid.length} row${grid.length === 1 ? '' : 's'} × ${grid[0]?.length ?? 0} week${(grid[0]?.length ?? 0) === 1 ? '' : 's'}. Save to keep.`)
          return
        }
        if (grid[0]?.[0] != null) {
          event.preventDefault()
          onChange(grid[0][0]!)
        }
      }}
      onBlur={() => {
        if (parsed.status === 'ok' && parsed.clamped) {
          onChange(String(parsed.displayValue))
          onNotice?.(`Value capped at ${max ?? metricInputBounds(metricId).max}.`)
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          onClear()
          event.currentTarget.blur()
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          const cell = event.currentTarget.closest('td')
          const sibling = event.shiftKey ? cell?.previousElementSibling : cell?.nextElementSibling
          const nextInput = sibling?.querySelector<HTMLInputElement>('input.cap-ledger-matrix__input')
          if (nextInput && !nextInput.disabled) nextInput.focus()
          else event.currentTarget.blur()
        }
      }}
    />
  )
}

export function AdvancedStaffingCapacityPlanPage({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const formulaRevision = useFormulaRevision()
  const {
    activeScenario,
    capacityPlanView,
    importActualOverrides,
    getScenarioCapacityPlanOverrides,
    getScenarioForecast,
    getScenarioAdvancedSettings,
    getScenarioLedger,
    getScenarioRoster,
    getScenarioShrinkageCategories,
    saveAsCapacityPlanView,
    scenarios,
    selectScenario,
    addScenarioShrinkageCategory,
    deleteScenarioShrinkageCategory,
    updateActualShrinkageCategory,
    updateActualOverrideMetric,
    updateAssumptions,
    updatePlannedOverrideMetric,
    applyPlannedWeekOverrides,
    updateScenarioPlan,
    applyScenarioPlanSettings,
    clearCapacityPlanData,
    deleteScenario,
    getScenarioStageAttritionOverrides,
    updatePlannedShrinkageCategory,
    updateStageAttritionRate,
    resetToPreviousCapacityPlan,
    hasPreviousCapacityPlan,
    canEditScenario,
    refreshAdvancedForecasts,
  } = usePlanner()
  const { canCreatePlans, user } = useDemoSession()
  const canEditActivePlan = canEditScenario(activeScenario?.id ?? capacityPlanView?.scenarioId ?? '')
  const [visibleShrinkageCategoryIds, setVisibleShrinkageCategoryIds] = useState<string[]>(DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS)
  const [matrixShrinkageComposer, setMatrixShrinkageComposer] = useState<{
    group: 'out_of_office' | 'in_office'
    name: string
    billable: boolean
  } | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [removeCapacityConfirmOpen, setRemoveCapacityConfirmOpen] = useState(false)
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false)
  const [view, setView] = useState<CapacityView>('weekly')
  const [scopeId, setScopeId] = useState(
    searchParams.get('scope') ??
      (capacityPlanView?.scenarioId ? `lob:${capacityPlanView.scenarioId}` : activeScenario?.id ? `lob:${activeScenario.id}` : ''),
  )
  const [clientFilter, setClientFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Record<CapacityGroupId, boolean>>(() => ({
    ...(DEFAULT_CAPACITY_MATRIX_COLLAPSED as Record<CapacityGroupId, boolean>),
  }))
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [templateImportMode, setTemplateImportMode] = useState<'overwrite' | 'append'>('overwrite')
  const [controlsOpen, setControlsOpen] = useState(DEFAULT_CAPACITY_MATRIX_LAYOUT.controlsOpen)
  const [chartsOpen, setChartsOpen] = useState(false)
  const [sidebarPanelOpen, setSidebarPanelOpen] = useState(DEFAULT_CAPACITY_MATRIX_LAYOUT.sidebarPanelOpen)
  const [shrinkageDriversOpen, setShrinkageDriversOpen] = useState(false)
  const [showFutureWeeks, setShowFutureWeeks] = useState(DEFAULT_CAPACITY_MATRIX_LAYOUT.showFutureWeeks)
  const [showPastWeeks, setShowPastWeeks] = useState(DEFAULT_CAPACITY_MATRIX_LAYOUT.showPastWeeks)
  const [expandAllFutureWeeks, setExpandAllFutureWeeks] = useState(
    DEFAULT_CAPACITY_MATRIX_LAYOUT.expandAllFutureWeeks,
  )
  const [weekPickerOpen, setWeekPickerOpen] = useState(false)
  const [unlockHistorical, setUnlockHistorical] = useState(false)
  const [hiddenWeeks, setHiddenWeeks] = useState<string[]>([])
  const [cellDrafts, setCellDrafts] = useState<Record<string, string>>({})
  const [draftUndoStack, setDraftUndoStack] = useState<Array<Record<string, string>>>([])
  const [pendingScopeId, setPendingScopeId] = useState<string | null>(null)
  const [inputNotice, setInputNotice] = useState('')
  const draftsScenarioRef = useRef<string | null>(null)
  const draftsHydratedRef = useRef(false)
  const lastUndoDraftIdRef = useRef<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'plan' | 'metrics'>('plan')
  const [settingsError, setSettingsError] = useState('')
  const [settingsDraft, setSettingsDraft] = useState({
    client: '',
    lob: '',
    location: '',
    projectCode: '',
    projectName: '',
    billingType: '',
    timezone: '',
    capacityPlanStartWeek: '',
    supportedChannels: [] as ChannelType[],
  })
  const [dataSavedAt, setDataSavedAt] = useState<string | null>(null)
  const [saveFlash, setSaveFlash] = useState(false)
  const [forecastModes, setForecastModes] = useState<ScenarioForecastModes>(() => resolveInitialForecastModes())
  const [savedForecastModes, setSavedForecastModes] = useState<ScenarioForecastModes>(() => resolveInitialForecastModes())
  const [metricOrders, setMetricOrders] = useState<Partial<Record<CapacityGroupId, string[]>>>(() => loadMetricOrderStore())
  const [optionalMetrics, setOptionalMetrics] = useState<Partial<Record<CapacityGroupId, string[]>>>(() => loadOptionalMetricStore())
  const [showOptionalMetrics, setShowOptionalMetrics] = useState(false)
  const [draggingMetric, setDraggingMetric] = useState<{ groupId: CapacityGroupId; metricId: string } | null>(null)
  const matrixRef = useRef<HTMLDivElement | null>(null)
  const matrixScrolledRef = useRef(false)
  const viewHydratedRef = useRef(false)
  const [viewSavedAt, setViewSavedAt] = useState<string | null>(null)
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [uploadBusy, setUploadBusy] = useState(false)
  const [downloadMenuOpen, setDownloadMenuOpen] = useState(false)
  const [savingAgentCount, setSavingAgentCount] = useState(false)
  const portfolioScenarios = useMemo(() => scenarios.filter((scenario) => !scenario.isBaseline), [scenarios])

  useEffect(() => {
    const scope = searchParams.get('scope')
    if (scope) setScopeId(scope)
  }, [searchParams])

  useEffect(() => {
    const saved = loadCapacityMatrixView()
    if (!saved) {
      viewHydratedRef.current = true
      return
    }
    setScopeId(saved.scopeId || (saved.scenarioId ? `lob:${saved.scenarioId}` : ''))
    setView(saved.view ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.view)
    setShowFutureWeeks(saved.showFutureWeeks ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.showFutureWeeks)
    setShowPastWeeks(saved.showPastWeeks ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.showPastWeeks)
    setExpandAllFutureWeeks(saved.expandAllFutureWeeks ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.expandAllFutureWeeks)
    setControlsOpen(saved.controlsOpen ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.controlsOpen)
    setUnlockHistorical(saved.unlockHistorical ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.unlockHistorical)
    setHiddenWeeks(saved.hiddenWeeks ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.hiddenWeeks)
    setCollapsed((prev) => ({
      ...prev,
      ...DEFAULT_CAPACITY_MATRIX_COLLAPSED,
      ...(saved.collapsed ?? {}),
    }))
    setSidebarPanelOpen({
      ...DEFAULT_CAPACITY_MATRIX_LAYOUT.sidebarPanelOpen,
      ...(saved.sidebarPanelOpen ?? {}),
    })
    setVisibleShrinkageCategoryIds(
      withDefaultOooShrinkageCategoryIds(
        (saved.visibleShrinkageCategoryIds ?? DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS).filter((id) =>
          isPersistedVisibleShrinkageCategoryId(id),
        ),
      ),
    )
    setViewSavedAt(saved.savedAt)
    viewHydratedRef.current = true
  }, [])

  useEffect(() => {
    localStorage.setItem(METRIC_ORDER_STORAGE_KEY, JSON.stringify(metricOrders))
  }, [metricOrders])

  useEffect(() => {
    localStorage.setItem(METRIC_OPTIONAL_STORAGE_KEY, JSON.stringify(optionalMetrics))
  }, [optionalMetrics])

  const capacityClientOptions = useMemo(
    () => [...new Set(portfolioScenarios.map((scenario) => scenario.plan.client).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [portfolioScenarios],
  )
  const capacitySiteOptions = useMemo(() => {
    const names = new Set<string>()
    portfolioScenarios.forEach((scenario) => {
      if (clientFilter && scenario.plan.client !== clientFilter) return
      const site = resolvePlanLocation(scenario.plan)
      if (site) names.add(site)
    })
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [clientFilter, portfolioScenarios])
  const scopedPortfolio = useMemo(
    () =>
      portfolioScenarios.filter((scenario) => {
        if (clientFilter && scenario.plan.client !== clientFilter) return false
        if (siteFilter && resolvePlanLocation(scenario.plan) !== siteFilter) return false
        return true
      }),
    [clientFilter, portfolioScenarios, siteFilter],
  )
  const scopeOptions = useMemo(() => {
    const lobOptions = scopedPortfolio.map((scenario) => {
      const lob = resolvePlanLob(scenario.plan)
      const channel = formatPlanChannels(scenario.plan)
      const code = scenario.plan.projectCode?.trim()
      const lobPart = code ? `${lob || scenario.name} (${code})` : lob || scenario.name
      const channelPart = channel || 'No channel'
      const site = resolvePlanLocation(scenario.plan)
      return {
        value: `lob:${scenario.id}`,
        label: [scenario.plan.client, site, `${lobPart} · ${channelPart}`].filter(Boolean).join(' · '),
      }
    })
    const combinedOptions = [...new Set(scopedPortfolio.map((scenario) => scenario.plan.client))]
      .map((client) => ({
        client,
        scenarios: scopedPortfolio.filter((scenario) => scenario.plan.client === client),
      }))
      .filter((group) => group.scenarios.length > 1)
      .map((group) => {
        const channels = [
          ...new Set(group.scenarios.flatMap((scenario) => explicitPlanChannels(scenario.plan).map((ch) => CHANNEL_LABELS[ch]))),
        ].join(', ')
        const siteLabel = siteFilter ? `${siteFilter} · ` : ''
        return {
          value: `combined:${group.client}`,
          label: `${group.client} · ${siteLabel}All LOBs · ${channels || 'No channel'}`,
        }
      })
    return { lobOptions, combinedOptions }
  }, [scopedPortfolio, siteFilter])

  const resolvedScopeId = scopeId || (capacityPlanView?.scenarioId ? `lob:${capacityPlanView.scenarioId}` : activeScenario?.id ? `lob:${activeScenario.id}` : portfolioScenarios[0] ? `lob:${portfolioScenarios[0].id}` : '')
  const isCombinedView = resolvedScopeId.startsWith('combined:')
  const selectedClient = isCombinedView ? resolvedScopeId.replace('combined:', '') : null
  const linkedScenario = isCombinedView
    ? portfolioScenarios.find((scenario) => scenario.plan.client === selectedClient) ?? null
    : portfolioScenarios.find((scenario) => `lob:${scenario.id}` === resolvedScopeId) ?? null
  const clientScenarios = linkedScenario
    ? portfolioScenarios.filter((scenario) => {
        if (scenario.plan.client !== linkedScenario.plan.client) return false
        if (siteFilter && resolvePlanLocation(scenario.plan) !== siteFilter) return false
        return true
      })
    : []
  const forecast = !isCombinedView && linkedScenario ? getScenarioForecast(linkedScenario.id, FORECAST_HORIZON_WEEKS) : null
  const plannedOverrides = !isCombinedView && linkedScenario ? getScenarioCapacityPlanOverrides(linkedScenario.id) : {}
  const effectivePlannedOverrides = useMemo(
    () => mergePlannedOverridesWithDrafts(plannedOverrides, cellDrafts),
    [cellDrafts, plannedOverrides],
  )
  const effectiveForecastModes = useMemo(
    () => capacityWorkspaceForecastModes(linkedScenario, forecastModes),
    [forecastModes, linkedScenario],
  )
  const stageAttritionOverrides =
    !isCombinedView && linkedScenario ? getScenarioStageAttritionOverrides(linkedScenario.id) : null
  const ledger = useMemo(() => {
    if (!linkedScenario) return []
    if (!isCombinedView) return getScenarioLedger(linkedScenario.id)
    return combineLedgerRows(clientScenarios.map((scenario) => getScenarioLedger(scenario.id)))
  }, [clientScenarios, getScenarioLedger, isCombinedView, linkedScenario])
  const effectiveLedger = useMemo(
    () => mergeLedgerWithActualDrafts(ledger, cellDrafts),
    [cellDrafts, ledger],
  )
  const planStartWeek = linkedScenario ? resolveCapacityPlanStartWeek(linkedScenario.plan) : null
  const currentPlanningWeek = linkedScenario
    ? resolveCurrentCalendarWeek(linkedScenario.plan.weekStart, linkedScenario.plan.timezone)
    : resolveCurrentCalendarWeek('sunday')
  const importedDisplayWeeks = linkedScenario?.plan.capacityImportedWeeks
  const inactiveProductionRosterCount = useMemo(() => {
    if (!currentPlanningWeek) return 0
    const countInactiveProduction = (scenarioId: string) =>
      getScenarioRoster(scenarioId).filter(
        (employee) =>
          employee.status !== 'active' &&
          employee.productionDate &&
          employee.productionDate <= currentPlanningWeek,
      ).length
    if (!isCombinedView && linkedScenario) return countInactiveProduction(linkedScenario.id)
    return clientScenarios.reduce((sum, scenario) => sum + countInactiveProduction(scenario.id), 0)
  }, [clientScenarios, currentPlanningWeek, getScenarioRoster, isCombinedView, linkedScenario])
  const ahtOverrides = linkedScenario && !isCombinedView ? getScenarioAhtOverrides(linkedScenario.id) : null
  const scenarioShrinkageCategories = useMemo(
    () => (linkedScenario ? mergeShrinkageCategoryTemplates(getScenarioShrinkageCategories(linkedScenario.id)) : mergeShrinkageCategoryTemplates()),
    [getScenarioShrinkageCategories, linkedScenario],
  )
  const effectiveVisibleShrinkageCategoryIds = useMemo(
    () =>
      withDefaultOooShrinkageCategoryIds(
        resolveActiveShrinkageCategoryIds(
          visibleShrinkageCategoryIds,
          scenarioShrinkageCategories.map((item) => item.id),
          Object.values(effectivePlannedOverrides).flatMap((weekOverride) => Object.keys(weekOverride.shrinkageById ?? {})),
        ),
      ),
    [effectivePlannedOverrides, scenarioShrinkageCategories, visibleShrinkageCategoryIds],
  )
  const rosterPlanStartProductionHc = useMemo(() => {
    if (!planStartWeek) return null
    if (!isCombinedView && linkedScenario) {
      return rosterHeadcountOverrides(getScenarioRoster(linkedScenario.id), planStartWeek).productionHc
    }
    if (isCombinedView && clientScenarios.length) {
      return clientScenarios.reduce(
        (sum, scenario) =>
          sum + rosterHeadcountOverrides(getScenarioRoster(scenario.id), planStartWeek).productionHc,
        0,
      )
    }
    return null
  }, [clientScenarios, getScenarioRoster, isCombinedView, linkedScenario, planStartWeek])
  const derivedRows = useMemo(() => {
    if (!linkedScenario) return []
    if (!isCombinedView) {
      return deriveCapacityPlanRows(
        effectiveLedger,
        linkedScenario,
        forecast,
        effectivePlannedOverrides,
        effectiveForecastModes,
        inactiveProductionRosterCount,
        ahtOverrides,
        stageAttritionOverrides,
        effectiveVisibleShrinkageCategoryIds,
        rosterPlanStartProductionHc,
      )
    }
    return combineCapacityRows(
      clientScenarios.map((scenario) =>
        deriveCapacityPlanRows(
          getScenarioLedger(scenario.id),
          scenario,
          getScenarioForecast(scenario.id, FORECAST_HORIZON_WEEKS),
          getScenarioCapacityPlanOverrides(scenario.id),
          capacityWorkspaceForecastModes(scenario, forecastModes),
          currentPlanningWeek
            ? getScenarioRoster(scenario.id).filter(
                (employee) =>
                  employee.status !== 'active' &&
                  employee.productionDate &&
                  employee.productionDate <= currentPlanningWeek,
              ).length
            : 0,
          getScenarioAhtOverrides(scenario.id),
          getScenarioStageAttritionOverrides(scenario.id),
          effectiveVisibleShrinkageCategoryIds,
          rosterHeadcountOverrides(getScenarioRoster(scenario.id), currentPlanningWeek).productionHc,
        ),
      ),
    )
  }, [ahtOverrides, clientScenarios, currentPlanningWeek, effectiveLedger, effectiveVisibleShrinkageCategoryIds, forecast, effectiveForecastModes, effectivePlannedOverrides, forecastModes, formulaRevision, getScenarioCapacityPlanOverrides, getScenarioForecast, getScenarioLedger, getScenarioRoster, getScenarioStageAttritionOverrides, inactiveProductionRosterCount, isCombinedView, linkedScenario, rosterPlanStartProductionHc, stageAttritionOverrides])
  const saveActiveAgentCount = useCallback(() => {
    if (!linkedScenario || !currentPlanningWeek || isCombinedView) return
    setSavingAgentCount(true)
    try {
      const count = countActiveAgents(getScenarioRoster(linkedScenario.id), linkedScenario.plan.client)
      updateActualOverrideMetric(linkedScenario.id, currentPlanningWeek, 'productionHc', count)
      updatePlannedOverrideMetric(linkedScenario.id, currentPlanningWeek, 'productionHc', count)
      setUploadMessage(`Saved ${count} active Agents to Actual and Planned Production HC for ${currentPlanningWeek}.`)
      setUploadError('')
    } finally {
      setSavingAgentCount(false)
    }
  }, [currentPlanningWeek, getScenarioRoster, isCombinedView, linkedScenario, updateActualOverrideMetric, updatePlannedOverrideMetric])
  const visibleFutureWeekCount = expandAllFutureWeeks ? MAX_FUTURE_WEEKS : DEFAULT_VISIBLE_FUTURE_WEEKS
  const visibleRows = useMemo(() => {
    const windowed = sliceCapacityWindow(derivedRows, {
      planningWeek: currentPlanningWeek,
      showFuture: showFutureWeeks,
      showPast: showPastWeeks,
      pastWeeks: VISIBLE_HISTORY_WEEKS,
      futureWeeks: visibleFutureWeekCount,
      importedWeeks: importedDisplayWeeks?.length ? importedDisplayWeeks : undefined,
    })
    return aggregateRows(windowed, view)
  }, [
    currentPlanningWeek,
    derivedRows,
    importedDisplayWeeks,
    showFutureWeeks,
    showPastWeeks,
    view,
    visibleFutureWeekCount,
  ])
  const ledgerByWeek = useMemo(() => new Map(ledger.map((row) => [row.week, row])), [ledger])
  const visibleLedgerRows = useMemo(() => {
    const windowed = sliceCapacityWindow(ledger, {
      planningWeek: currentPlanningWeek,
      showFuture: showFutureWeeks,
      showPast: showPastWeeks,
      pastWeeks: VISIBLE_HISTORY_WEEKS,
      futureWeeks: visibleFutureWeekCount,
      importedWeeks: importedDisplayWeeks?.length ? importedDisplayWeeks : undefined,
    })
    return summarizeWeeklyLedgerRows(windowed, view)
  }, [
    currentPlanningWeek,
    importedDisplayWeeks,
    ledger,
    showFutureWeeks,
    showPastWeeks,
    view,
    visibleFutureWeekCount,
  ])
  const displayedRows = useMemo(() => visibleRows.filter((row) => !hiddenWeeks.includes(row.week)), [hiddenWeeks, visibleRows])
  useEffect(() => {
    matrixScrolledRef.current = false
  }, [linkedScenario?.id, resolvedScopeId])

  useEffect(() => {
    const validWeeks = new Set(derivedRows.map((row) => row.week))
    setHiddenWeeks((prev) => {
      const next = prev.filter((week) => validWeeks.has(week))
      return next.length === prev.length ? prev : next
    })
  }, [derivedRows, linkedScenario?.id])

  const scrollMatrixToPlanningWeek = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const container = matrixRef.current
    if (!container || !currentPlanningWeek) return
    const planningHeader = container.querySelector<HTMLElement>('[data-cap-planning-week="true"]')
    if (!planningHeader) return
    const metricColumn = container.querySelector<HTMLElement>('.cap-ledger-matrix__metric')
    const metricWidth = metricColumn?.offsetWidth ?? 280
    const targetLeft = Math.max(0, planningHeader.offsetLeft - metricWidth - 12)
    container.scrollTo({ left: targetLeft, behavior })
  }, [currentPlanningWeek])

  const showAllVisibleWeeks = useCallback(() => {
    setHiddenWeeks([])
    setShowFutureWeeks(true)
    setShowPastWeeks(true)
    setExpandAllFutureWeeks(true)
    window.setTimeout(() => scrollMatrixToPlanningWeek('smooth'), 0)
  }, [scrollMatrixToPlanningWeek])

  useEffect(() => {
    if (!displayedRows.length || matrixScrolledRef.current || view !== 'weekly') return
    matrixScrolledRef.current = true
    window.setTimeout(() => scrollMatrixToPlanningWeek('auto'), 0)
  }, [displayedRows.length, scrollMatrixToPlanningWeek, view])

  const pickerRows = useMemo(() => {
    if (importedDisplayWeeks?.length) {
      return derivedRows.filter((row) => importedDisplayWeeks.includes(row.week))
    }
    return sliceCapacityWindow(derivedRows, {
      planningWeek: currentPlanningWeek,
      showFuture: true,
      pastWeeks: VISIBLE_HISTORY_WEEKS,
      futureWeeks: MAX_FUTURE_WEEKS,
    })
  }, [currentPlanningWeek, derivedRows, importedDisplayWeeks])
  const hasHistoricalWeeks = useMemo(
    () => visibleRows.some((row) => row.timeline === 'historical_actual'),
    [visibleRows],
  )
  const hasPastOrActualWeeks = useMemo(
    () =>
      displayedRows.some(
        (row) =>
          row.statusLabel === 'Actual' ||
          row.timeline === 'historical_actual' ||
          (currentPlanningWeek != null && row.week < currentPlanningWeek),
      ) ||
      ledger.some(
        (row) =>
          row.timeline === 'historical_actual' ||
          (currentPlanningWeek != null && row.week < currentPlanningWeek),
      ),
    [currentPlanningWeek, displayedRows, ledger],
  )
  const lastHistoricalWeek = ledger.filter((row) => row.timeline === 'historical_actual').at(-1)?.week ?? null
  const trainingWeeks = isCombinedView
    ? Math.max(...clientScenarios.map((scenario) => scenario.assumptions.newHire.trainingWeeks), 0)
    : linkedScenario?.assumptions.newHire.trainingWeeks ?? 0
  const nestingWeeks = isCombinedView
    ? Math.max(...clientScenarios.map((scenario) => scenario.assumptions.newHire.nestingWeeks), 0)
    : linkedScenario?.assumptions.newHire.nestingWeeks ?? 0
  const trainingAttritionRate = isCombinedView
    ? avg(clientScenarios.map((scenario) => scenario.assumptions.newHire.trainingAttritionRate))
    : linkedScenario?.assumptions.newHire.trainingAttritionRate ?? 0
  const nestingAttritionRate = isCombinedView
    ? avg(clientScenarios.map((scenario) => scenario.assumptions.newHire.nestingAttritionRate))
    : linkedScenario?.assumptions.newHire.nestingAttritionRate ?? 0
  const stageWeekMaps = useMemo(
    () => buildStageWeekMaps(derivedRows, trainingWeeks, nestingWeeks, linkedScenario?.assumptions ?? null),
    [derivedRows, linkedScenario?.assumptions, nestingWeeks, trainingWeeks],
  )
  const shrinkageLookup = useMemo(
    () =>
      buildShrinkageLookup(
        visibleLedgerRows,
        forecast,
        effectiveForecastModes,
        effectiveVisibleShrinkageCategoryIds,
        plannedOverrides,
      ),
    [effectiveForecastModes, effectiveVisibleShrinkageCategoryIds, forecast, plannedOverrides, visibleLedgerRows],
  )
  const addMatrixShrinkageCategory = useCallback(() => {
    if (!linkedScenario || !matrixShrinkageComposer) return
    const name = matrixShrinkageComposer.name.trim()
    if (!name) return
    const created = createCustomShrinkageCategory(name, matrixShrinkageComposer.group, matrixShrinkageComposer.billable)
    addScenarioShrinkageCategory(linkedScenario.id, created)
    setVisibleShrinkageCategoryIds((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]))
    setMatrixShrinkageComposer(null)
  }, [addScenarioShrinkageCategory, linkedScenario, matrixShrinkageComposer])
  const deleteMatrixShrinkageCategory = useCallback(
    (categoryId: string) => {
      if (!linkedScenario || !isCustomShrinkageCategoryId(categoryId)) return
      deleteScenarioShrinkageCategory(linkedScenario.id, categoryId)
      setVisibleShrinkageCategoryIds((prev) => prev.filter((id) => id !== categoryId))
    },
    [deleteScenarioShrinkageCategory, linkedScenario],
  )
  const getPlannedShrinkageCategoryValue = useCallback(
    (week: string, categoryId: string) =>
      plannedOverrides[week]?.shrinkageById?.[categoryId] ??
      shrinkageLookup.rowsByWeek.get(week)?.categories?.[categoryId]?.planned ??
      null,
    [plannedOverrides, shrinkageLookup],
  )
  const getActualShrinkageCategoryValue = useCallback(
    (week: string, categoryId: string) =>
      ledgerByWeek.get(week)?.shrinkage.find((item) => item.id === categoryId)?.actualPct ??
      shrinkageLookup.rowsByWeek.get(week)?.categories?.[categoryId]?.actual ??
      null,
    [ledgerByWeek, shrinkageLookup],
  )
  useEffect(() => {
    const categoryIds = new Set([
      ...DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS,
      ...ledger.flatMap((row) => row.shrinkage.map((item) => item.id)),
      ...scenarioShrinkageCategories.map((item) => item.id),
    ])
    const overrideIds = Object.values(plannedOverrides).flatMap((week) => Object.keys(week.shrinkageById ?? {}))
    setVisibleShrinkageCategoryIds((prev) => {
      const next = withDefaultOooShrinkageCategoryIds(
        resolveActiveShrinkageCategoryIds(
          prev,
          scenarioShrinkageCategories.map((item) => item.id),
          overrideIds,
        ).filter((id) => categoryIds.has(id) || overrideIds.includes(id)),
      )
      return next.length === prev.length && next.every((id, index) => id === prev[index]) ? prev : next
    })
  }, [ledger, plannedOverrides, scenarioShrinkageCategories])
  const actualStageAttritionLookup = useMemo(() => buildActualStageAttritionLookup(derivedRows), [derivedRows])
  const supportedChannelIds = linkedScenario?.plan.supportedChannels ?? ['voice']
  const capacityLabels = useMemo(() => channelDisplayLabels(supportedChannelIds), [supportedChannelIds])
  const chatConcurrencyValue =
    supportedChannelIds.length === 1 && supportedChannelIds[0] === 'chat'
      ? linkedScenario?.assumptions.channels?.chat?.chatConcurrency ?? null
      : null
  const matrixGroups = useMemo(() => {
    return capacityGroups(
      view,
      stageWeekMaps,
      shrinkageLookup,
      actualStageAttritionLookup,
      trainingAttritionRate,
      nestingAttritionRate,
      effectiveVisibleShrinkageCategoryIds,
      capacityLabels,
      chatConcurrencyValue,
      linkedScenario ? isFteBillingPlan(linkedScenario.plan.billingType) : false,
      scenarioShrinkageCategories,
    )
  }, [
      view,
      stageWeekMaps,
      shrinkageLookup,
      actualStageAttritionLookup,
      nestingAttritionRate,
      trainingAttritionRate,
      effectiveVisibleShrinkageCategoryIds,
      capacityLabels,
      chatConcurrencyValue,
      linkedScenario,
      scenarioShrinkageCategories,
    ])
  const orderedMatrixGroups = useMemo(
    () =>
      Object.fromEntries(
        MATRIX_GROUP_ORDER.filter((groupId) => (matrixGroups[groupId]?.length ?? 0) > 0).map((groupId) => [
          groupId,
          filterVisibleMetrics(
            groupId,
            orderMetrics(groupId, matrixGroups[groupId], metricOrders),
            optionalMetrics,
            showOptionalMetrics,
          ),
        ]),
      ) as Record<CapacityGroupId, MatrixRowDef[]>,
    [matrixGroups, metricOrders, optionalMetrics, showOptionalMetrics],
  )

  const optionalMetricCount = useMemo(
    () =>
      (Object.keys(matrixGroups) as CapacityGroupId[]).reduce((count, groupId) => {
        const optional = new Set(optionalMetrics[groupId] ?? [])
        return count + matrixGroups[groupId].filter((metric) => optional.has(metric.id)).length
      }, 0),
    [matrixGroups, optionalMetrics],
  )

  const markMetricOptional = useCallback((groupId: CapacityGroupId, metricId: string) => {
    setOptionalMetrics((prev) => {
      const current = prev[groupId] ?? []
      if (current.includes(metricId)) return prev
      return { ...prev, [groupId]: [...current, metricId] }
    })
  }, [])

  const unmarkMetricOptional = useCallback((groupId: CapacityGroupId, metricId: string) => {
    setOptionalMetrics((prev) => {
      const current = prev[groupId] ?? []
      const next = current.filter((id) => id !== metricId)
      if (next.length === current.length) return prev
      const copy = { ...prev }
      if (next.length) copy[groupId] = next
      else delete copy[groupId]
      return copy
    })
  }, [])

  const toggleMetricOptional = useCallback(
    (groupId: CapacityGroupId, metricId: string, nextOptional: boolean) => {
      if (nextOptional) markMetricOptional(groupId, metricId)
      else unmarkMetricOptional(groupId, metricId)
    },
    [markMetricOptional, unmarkMetricOptional],
  )

  const resetOptionalMetrics = useCallback(() => {
    setOptionalMetrics({ ...DEFAULT_OPTIONAL_METRICS })
    setShowOptionalMetrics(false)
  }, [])

  const persistMatrixView = useCallback(() => {
    if (!linkedScenario) return
    viewHydratedRef.current = true
    const savedAt = new Date().toISOString()
    saveCapacityMatrixView({
      scenarioId: linkedScenario.id,
      scopeId: resolvedScopeId,
      view,
      showFutureWeeks,
      showPastWeeks,
      expandAllFutureWeeks,
      controlsOpen,
      unlockHistorical,
      hiddenWeeks,
      collapsed,
      visibleShrinkageCategoryIds,
      sidebarPanelOpen,
      forecastInfoOpen: false,
      savedAt,
    })
    setViewSavedAt(savedAt)
  }, [
    collapsed,
    controlsOpen,
    expandAllFutureWeeks,
    hiddenWeeks,
    linkedScenario,
    resolvedScopeId,
    showFutureWeeks,
    showPastWeeks,
    sidebarPanelOpen,
    unlockHistorical,
    view,
    visibleShrinkageCategoryIds,
  ])

  const markCapacitySaved = useCallback(
    (message: string) => {
      persistMatrixView()
      localStorage.setItem(METRIC_OPTIONAL_STORAGE_KEY, JSON.stringify(optionalMetrics))
      const savedAt = new Date().toISOString()
      setDataSavedAt(savedAt)
      setSaveFlash(true)
      setUploadMessage(message)
      setUploadError('')
    },
    [optionalMetrics, persistMatrixView],
  )

  const openPlanSettings = useCallback((tab: 'plan' | 'metrics' = 'plan') => {
    if (!linkedScenario) return
    setSettingsError('')
    if (!isCombinedView) {
      setSettingsDraft({
        client: linkedScenario.plan.client ?? '',
        lob: resolvePlanLob(linkedScenario.plan),
        location: resolvePlanLocation(linkedScenario.plan),
        projectCode: linkedScenario.plan.projectCode ?? '',
        projectName: linkedScenario.plan.projectName ?? '',
        billingType: linkedScenario.plan.billingType ?? '',
        timezone: normalizeTimeZone(linkedScenario.plan.timezone),
        capacityPlanStartWeek: linkedScenario.plan.capacityPlanStartWeek ?? '',
        supportedChannels: explicitPlanChannels(linkedScenario.plan),
      })
      setSettingsTab(tab)
    } else {
      setSettingsTab('metrics')
    }
    setSettingsOpen(true)
  }, [isCombinedView, linkedScenario])

  const savePlanSettings = useCallback(() => {
    if (!linkedScenario) {
      setSettingsOpen(false)
      return
    }

    if (isCombinedView || settingsTab === 'metrics') {
      markCapacitySaved(
        optionalMetricCount > 0
          ? `Metric visibility saved (${optionalMetricCount} hidden).`
          : 'Metric visibility saved.',
      )
      setSettingsOpen(false)
      setSettingsError('')
      void flushWorkspaceSync()
      return
    }

    const client = settingsDraft.client.trim()
    const lob = settingsDraft.lob.trim()
    const location = settingsDraft.location.trim()
    if (!client) {
      setSettingsError('Client is required.')
      return
    }
    if (!lob) {
      setSettingsError('LOB is required.')
      return
    }
    if (!location) {
      setSettingsError('Site is required.')
      return
    }
    if (!settingsDraft.supportedChannels.length) {
      setSettingsError('Channel is required.')
      return
    }
    const nextPlan = {
      ...linkedScenario.plan,
      client,
      lob,
      location,
      projectCode: settingsDraft.projectCode.trim() || undefined,
      projectName: settingsDraft.projectName.trim() || undefined,
      billingType: settingsDraft.billingType || linkedScenario.plan.billingType,
      timezone: normalizeTimeZone(settingsDraft.timezone || linkedScenario.plan.timezone),
      capacityPlanStartWeek: settingsDraft.capacityPlanStartWeek || linkedScenario.plan.capacityPlanStartWeek,
      supportedChannels: settingsDraft.supportedChannels,
    }
    const channelMap = { ...(linkedScenario.assumptions.channels ?? {}) }
    for (const channel of settingsDraft.supportedChannels) {
      if (!channelMap[channel]) {
        channelMap[channel] = defaultChannelAssumptions(channel)
      }
    }
    const nextAssumptions = syncBusinessDerivedFields(
      syncChannelDerivedFields(
        {
          ...linkedScenario.assumptions,
          channels: normalizeChannelMix(channelMap, settingsDraft.supportedChannels),
        },
        nextPlan,
      ),
    )
    const ok = applyScenarioPlanSettings(linkedScenario.id, {
      plan: nextPlan,
      assumptions: nextAssumptions,
      scenarioName: planSettingsScenarioName(nextPlan),
      previousClientName: linkedScenario.plan.client,
    })
    if (!ok) {
      setSettingsError('You do not have permission to save plan settings.')
      return
    }
    markCapacitySaved('Plan settings saved.')
    setSettingsOpen(false)
    setSettingsError('')
    void flushWorkspaceSync()
  }, [
    applyScenarioPlanSettings,
    isCombinedView,
    linkedScenario,
    markCapacitySaved,
    optionalMetricCount,
    settingsDraft,
    settingsTab,
  ])

  const forecastModesDirty = !forecastModesEqual(forecastModes, savedForecastModes)

  const materializePlannedAttritionPct = useCallback(() => {
    if (!linkedScenario || isCombinedView) return
    for (const row of derivedRows) {
      if (row.timeline !== 'forward_plan') continue
      // Do not overwrite values already saved or currently being edited.
      if (plannedOverrides[row.week]?.attritionPct != null) continue
      if (cellDrafts[cellDraftId('planned', row.week, 'attritionPct')] != null) continue
      const pct = row.planned.attritionPct
      if (pct == null || !Number.isFinite(pct)) continue
      updatePlannedOverrideMetric(linkedScenario.id, row.week, 'attritionPct', pct)
    }
  }, [
    cellDrafts,
    derivedRows,
    isCombinedView,
    linkedScenario,
    plannedOverrides,
    updatePlannedOverrideMetric,
  ])

  const persistForecastModes = useCallback(() => {
    if (!linkedScenario || isCombinedView) return
    saveScenarioForecastModes(linkedScenario.id, forecastModes)
    setSavedForecastModes(forecastModes)
  }, [forecastModes, isCombinedView, linkedScenario])

  useEffect(() => {
    if (!linkedScenario || isCombinedView) {
      setForecastModes(DEFAULT_CAPACITY_FORECAST_MODES)
      setSavedForecastModes(DEFAULT_CAPACITY_FORECAST_MODES)
      return
    }
    const saved = resolveInitialForecastModes(linkedScenario.id)
    setForecastModes(saved)
    setSavedForecastModes(saved)
  }, [isCombinedView, linkedScenario?.id])

  /** Applied driver flags — updates when Forecasting Save/Apply refreshes models. */
  const driverApplyFingerprint = useMemo(() => {
    if (!linkedScenario) return ''
    const drivers = getScenarioAdvancedSettings(linkedScenario.id) ?? {}
    return Object.entries(drivers)
      .map(([id, config]) => `${id}:${config?.applyToCapacityPlan ? 1 : 0}:${config?.selectedModelId ?? ''}`)
      .sort()
      .join('|')
  }, [getScenarioAdvancedSettings, linkedScenario])

  /**
   * Pick up driver modes written by Forecasting Save/Apply without requiring a
   * remount. Skip while the Capacity sidebar has unsaved mode edits.
   */
  useEffect(() => {
    if (!linkedScenario || isCombinedView || forecastModesDirty) return
    const saved = resolveInitialForecastModes(linkedScenario.id)
    if (forecastModesEqual(forecastModes, saved)) return
    setForecastModes(saved)
    setSavedForecastModes(saved)
  }, [
    driverApplyFingerprint,
    forecastModes,
    forecastModesDirty,
    isCombinedView,
    linkedScenario,
  ])

  useEffect(() => {
    if (!viewHydratedRef.current) return
    const timer = window.setTimeout(() => persistMatrixView(), 500)
    return () => window.clearTimeout(timer)
  }, [persistMatrixView])

  const exportMatrixExcel = () => {
    if (!linkedScenario) return
    // Always export ISO week columns (not monthly/quarter buckets) so the file
    // round-trips through Upload template.
    const exportRows = (hiddenWeeks.length
      ? derivedRows.filter((row) => !hiddenWeeks.includes(row.week))
      : derivedRows
    ).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.week))
    const rowsForExport = exportRows.length ? exportRows : derivedRows.filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.week))
    if (!rowsForExport.length) {
      setUploadError('Nothing to download — this plan has no weekly columns yet.')
      setUploadMessage('')
      return
    }
    const groups = Object.fromEntries(
      (Object.keys(orderedMatrixGroups) as CapacityGroupId[]).map((groupId) => [
        groupId,
        {
          label: GROUP_LABELS[groupId],
          metrics: orderedMatrixGroups[groupId].map((metric) => ({
            label: metric.label,
            // Shrinkage categories use shrinkage:<id> so Upload can write shrinkageById.
            // Prefer planned key; fall back to actual so Production HC etc. round-trip.
            metricId: metric.shrinkageCategoryId
              ? metric.shrinkageEditKind === 'planned'
                ? `shrinkage:${metric.shrinkageCategoryId}`
                : undefined
              : metric.plannedOverrideKey ?? metric.actualOverrideKey ?? metric.exportMetricId,
            values: rowsForExport.map((row) => {
              const value =
                row.timeline === 'forward_plan' && metric.futureValue ? metric.futureValue(row) : metric.value(row)
              // Prefer raw numbers for editable/importable rows so upload matches exactly.
              const importable =
                Boolean(metric.plannedOverrideKey) ||
                Boolean(metric.actualOverrideKey) ||
                Boolean(metric.exportMetricId) ||
                metric.shrinkageEditKind === 'planned'
              if (importable && typeof value === 'number' && Number.isFinite(value)) {
                return value
              }
              return metric.format(value)
            }),
          })),
        },
      ]),
    )
    const payload = buildMatrixExportPayload(
      `${linkedScenario.plan.client}_${resolvePlanLocation(linkedScenario.plan)}_Capacity`,
      isCombinedView ? 'Combined LOB view' : `${billableTypeLabel(linkedScenario.plan.billingType)} · weekly template`,
      rowsForExport,
      groups,
    )
    downloadCapacityMatrixExcel(payload)
    persistMatrixView()
    setUploadError('')
    setUploadMessage(
      `Downloaded matrix Excel (${rowsForExport.length} weeks, all metric groups). Edit Metric_Id rows (including shrinkage:<category>), then use Upload template.`,
    )
    setDownloadMenuOpen(false)
  }

  const exportMatrixPdf = () => {
    if (!matrixRef.current || !linkedScenario) return
    const filename = `${linkedScenario.plan.client}_${resolvePlanLocation(linkedScenario.plan)}_capacity_matrix`
    downloadCapacityMatrixPdf(matrixRef.current, filename)
    persistMatrixView()
    setUploadError('')
    setUploadMessage('Opened print dialog for the capacity matrix PDF.')
    setDownloadMenuOpen(false)
  }

  const updatePipelineField = (
    field: 'trainingWeeks' | 'nestingWeeks' | 'trainingAttritionRate' | 'nestingAttritionRate' | 'nestingPhoneTimePct',
    value: number,
  ) => {
    if (!linkedScenario || isCombinedView) return
    const currentRamp = Array.isArray(linkedScenario.assumptions.newHire.nestingPhoneTimeRamp)
      ? linkedScenario.assumptions.newHire.nestingPhoneTimeRamp
      : []
    const next = {
      ...linkedScenario.assumptions,
      newHire: {
        ...linkedScenario.assumptions.newHire,
        nestingPhoneTimeRamp: currentRamp,
        [field]: value,
      },
    }
    if (field === 'trainingWeeks' || field === 'nestingWeeks') {
      next.newHire.graduationWeek = Math.max(1, next.newHire.trainingWeeks + next.newHire.nestingWeeks)
    }
    if (field === 'nestingWeeks') {
      const weeks = Math.max(1, Math.round(value))
      const defaultPhone = linkedScenario.assumptions.newHire.nestingPhoneTimePct
      next.newHire.nestingPhoneTimeRamp = Array.from({ length: weeks }, (_, index) => currentRamp[index] ?? defaultPhone)
    }
    if (field === 'nestingPhoneTimePct') {
      const weeks = Math.max(1, Math.round(next.newHire.nestingWeeks))
      next.newHire.nestingPhoneTimeRamp = Array.from({ length: weeks }, () => value)
    }
    updateAssumptions(linkedScenario.id, syncBusinessDerivedFields(syncDerivedTenuredFields(next, linkedScenario.plan)))
  }

  const updateNestingPhoneRamp = (index: number, value: number) => {
    if (!linkedScenario || isCombinedView) return
    const weeks = Math.max(1, Math.round(linkedScenario.assumptions.newHire.nestingWeeks))
    const currentRamp = Array.isArray(linkedScenario.assumptions.newHire.nestingPhoneTimeRamp)
      ? linkedScenario.assumptions.newHire.nestingPhoneTimeRamp
      : []
    const defaultPhone = linkedScenario.assumptions.newHire.nestingPhoneTimePct
    const nextRamp = Array.from({ length: weeks }, (_, rampIndex) => currentRamp[rampIndex] ?? defaultPhone)
    nextRamp[index] = value
    updateAssumptions(
      linkedScenario.id,
      syncBusinessDerivedFields(
        syncDerivedTenuredFields({
          ...linkedScenario.assumptions,
          newHire: {
            ...linkedScenario.assumptions.newHire,
            nestingPhoneTimeRamp: nextRamp,
          },
        }, linkedScenario.plan),
      ),
    )
  }

  const openAddLobWizard = () => {
    if (!linkedScenario) return
    const clientId = linkedScenario.plan.clientId ?? findClientByName(linkedScenario.plan.client)?.id ?? ''
    navigate(`/setup?clientId=${encodeURIComponent(clientId)}`)
  }

  const handleConfirmDeleteCapacityPlan = useCallback(() => {
    if (!linkedScenario || isCombinedView) return
    const scenarioId = linkedScenario.id
    const label = `${linkedScenario.plan.client} · ${resolvePlanLob(linkedScenario.plan)}`
    try {
      clearCapacityPlanData(scenarioId)
      saveScenarioForecastModes(scenarioId, DEFAULT_CAPACITY_FORECAST_MODES)
      setForecastModes(DEFAULT_CAPACITY_FORECAST_MODES)
      setSavedForecastModes(DEFAULT_CAPACITY_FORECAST_MODES)
      setCellDrafts({})
      writeSessionCellDrafts(scenarioId, {})
      setVisibleShrinkageCategoryIds([...DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS])
      setHiddenWeeks([])
      setMatrixShrinkageComposer(null)
      setSaveConfirmOpen(false)
      setDeleteConfirmOpen(false)
      setUploadError('')
      setUploadMessage(
        `Capacity plan deleted for ${label}. Planned overrides, imports, and locked weeks were cleared. Assumptions remain.`,
      )
      void flushWorkspaceSync()
    } catch (error) {
      setDeleteConfirmOpen(false)
      setUploadError(error instanceof Error ? error.message : 'Failed to delete capacity plan.')
    }
  }, [clearCapacityPlanData, isCombinedView, linkedScenario])

  const handleConfirmRemoveDeletedCapacity = useCallback(() => {
    if (!linkedScenario || isCombinedView) return
    const scenarioId = linkedScenario.id
    const label = `${linkedScenario.plan.client} · ${resolvePlanLob(linkedScenario.plan)}`
    try {
      deleteScenario(scenarioId)
      setCellDrafts({})
      writeSessionCellDrafts(scenarioId, {})
      setRemoveCapacityConfirmOpen(false)
      setDeleteConfirmOpen(false)
      setUploadError('')
      setUploadMessage(
        `Removed ${label} and all associated assumptions, overrides, and roster data from the workspace.`,
      )
      void persistScenarioDeletion([scenarioId])
    } catch (error) {
      setRemoveCapacityConfirmOpen(false)
      setUploadError(error instanceof Error ? error.message : 'Failed to remove capacity.')
    }
  }, [deleteScenario, isCombinedView, linkedScenario])

  useEffect(() => {
    if (!deleteConfirmOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDeleteConfirmOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [deleteConfirmOpen])

  const clearCellDraft = (draftId: string) => {
    setCellDrafts((prev) => {
      if (!(draftId in prev)) return prev
      setDraftUndoStack((stack) => [...stack.slice(-39), prev])
      const next = { ...prev }
      delete next[draftId]
      return next
    })
  }

  const pushCellDraft = useCallback((draftId: string, nextValue: string) => {
    setCellDrafts((prev) => {
      if (prev[draftId] === nextValue) return prev
      if (lastUndoDraftIdRef.current !== draftId) {
        setDraftUndoStack((stack) => [...stack.slice(-39), prev])
        lastUndoDraftIdRef.current = draftId
      }
      return { ...prev, [draftId]: nextValue }
    })
  }, [])

  const showInputNotice = useCallback((message: string) => {
    setInputNotice(message)
    setUploadMessage(message)
    setUploadError('')
  }, [])

  const pasteGridFromCell = useCallback(
    (start: { kind: MatrixEditKind; week: string; metricId: string }, grid: string[][]) => {
      const weeks = displayedRows.map((row) => row.week)
      const metricIds: string[] = []
      for (const groupId of MATRIX_GROUP_ORDER) {
        if (collapsed[groupId]) continue
        for (const metric of orderedMatrixGroups[groupId] ?? []) {
          if (start.kind === 'planned') {
            if (!metric.editablePlanned) continue
            if (metric.shrinkageEditKind && metric.shrinkageEditKind !== 'planned') continue
            const id = metric.shrinkageCategoryId
              ? `shrinkage:${metric.shrinkageCategoryId}`
              : metric.plannedOverrideKey
            if (id) metricIds.push(String(id))
          } else {
            if (!metric.editableActual) continue
            if (metric.shrinkageEditKind && metric.shrinkageEditKind !== 'actual') continue
            const id = metric.shrinkageCategoryId
              ? `shrinkage:${metric.shrinkageCategoryId}`
              : metric.actualOverrideKey
            if (id) metricIds.push(String(id))
          }
        }
      }
      setCellDrafts((prev) => {
        setDraftUndoStack((stack) => [...stack.slice(-39), prev])
        return applyClipboardGridToDrafts(prev, start, weeks, metricIds, grid)
      })
    },
    [collapsed, displayedRows, orderedMatrixGroups],
  )

  const undoLastCellEdit = useCallback(() => {
    setDraftUndoStack((stack) => {
      if (!stack.length) return stack
      const previous = stack[stack.length - 1]!
      setCellDrafts(previous)
      lastUndoDraftIdRef.current = null
      return stack.slice(0, -1)
    })
  }, [])

  const expandAllMetricGroups = useCallback(() => {
    setCollapsed(
      Object.fromEntries(MATRIX_GROUP_ORDER.map((id) => [id, false])) as Record<CapacityGroupId, boolean>,
    )
  }, [])

  const collapseAllMetricGroups = useCallback(() => {
    setCollapsed(
      Object.fromEntries(MATRIX_GROUP_ORDER.map((id) => [id, true])) as Record<CapacityGroupId, boolean>,
    )
  }, [])

  const commitAllCellDrafts = useCallback(() => {
    if (!linkedScenario) return false
    const finalized = finalizeCellDrafts(cellDrafts)
    const blocking = collectInvalidDraftMessages(finalized)
    if (blocking.length) {
      setUploadError(blocking[0] ?? 'Fix invalid cells before saving.')
      setInputNotice(blocking[0] ?? 'Fix invalid cells before saving.')
      return false
    }

    for (const [draftId, draft] of Object.entries(finalized)) {
      const parsedId = parseCellDraftId(draftId)
      if (!parsedId) continue
      const parsed = parseMetricDraft(parsedId.metricId, draft)
      if (parsed.status !== 'empty' && parsed.status !== 'ok') continue
      const nextValue = storedValueFromDraft(parsedId.metricId, draft) ?? null

      if (parsedId.metricId.startsWith('shrinkage:')) {
        const categoryId = parsedId.metricId.replace('shrinkage:', '')
        if (parsedId.kind === 'planned') updatePlannedShrinkageCategory(linkedScenario.id, parsedId.week, categoryId, nextValue)
        else updateActualShrinkageCategory(linkedScenario.id, parsedId.week, categoryId, nextValue)
        continue
      }

      if (parsedId.kind === 'planned') {
        updatePlannedOverrideMetric(linkedScenario.id, parsedId.week, parsedId.metricId as keyof LedgerMetricSnapshot, nextValue)
      } else {
        updateActualOverrideMetric(linkedScenario.id, parsedId.week, parsedId.metricId as keyof LedgerMetricSnapshot, nextValue)
      }
    }
    setCellDrafts({})
    writeSessionCellDrafts(linkedScenario.id, {})
    lastUndoDraftIdRef.current = null
    return true
  }, [
    cellDrafts,
    linkedScenario,
    updateActualOverrideMetric,
    updateActualShrinkageCategory,
    updatePlannedOverrideMetric,
    updatePlannedShrinkageCategory,
  ])

  const saveCapacityChanges = useCallback(() => {
    if (!canEditActivePlan) return false
    const committed = commitAllCellDrafts()
    if (!committed) {
      setSaveConfirmOpen(false)
      return false
    }
    materializePlannedAttritionPct()
    persistForecastModes()
    persistMatrixView()
    localStorage.setItem(METRIC_OPTIONAL_STORAGE_KEY, JSON.stringify(optionalMetrics))
    setDraftUndoStack([])
    const savedAt = new Date().toISOString()
    setDataSavedAt(savedAt)
    setSaveFlash(true)
    setUploadMessage('Capacity changes saved. Financial views that use this plan will update.')
    setUploadError('')
    setInputNotice('')
    setSaveConfirmOpen(false)
    void flushWorkspaceSync()
    return true
  }, [
    canEditActivePlan,
    commitAllCellDrafts,
    materializePlannedAttritionPct,
    optionalMetrics,
    persistForecastModes,
    persistMatrixView,
  ])

  const discardUnsavedCapacityChanges = useCallback(() => {
    setDraftUndoStack((stack) => [...stack.slice(-39), cellDrafts])
    setCellDrafts({})
    writeSessionCellDrafts(linkedScenario?.id, {})
    setForecastModes(savedForecastModes)
    lastUndoDraftIdRef.current = null
  }, [cellDrafts, linkedScenario?.id, savedForecastModes])

  const hasUnsavedMatrixEdits = Object.keys(cellDrafts).length > 0 || forecastModesDirty
  const canUndo = draftUndoStack.length > 0 || Object.keys(cellDrafts).length > 0
  const invalidDraftCount = collectInvalidDraftMessages(cellDrafts).length

  const applyScopeChange = useCallback(
    (nextScope: string) => {
      setPendingScopeId(null)
      setCellDrafts({})
      writeSessionCellDrafts(linkedScenario?.id, {})
      setDraftUndoStack([])
      lastUndoDraftIdRef.current = null
      setScopeId(nextScope)
      if (nextScope.startsWith('lob:')) {
        const nextId = nextScope.replace('lob:', '')
        selectScenario(nextId)
        saveAsCapacityPlanView(nextId)
      }
    },
    [linkedScenario?.id, saveAsCapacityPlanView, selectScenario],
  )

  const requestScopeChange = useCallback(
    (nextScope: string) => {
      if (nextScope === resolvedScopeId) return
      if (hasUnsavedMatrixEdits) {
        setPendingScopeId(nextScope)
        return
      }
      applyScopeChange(nextScope)
    },
    [applyScopeChange, hasUnsavedMatrixEdits, resolvedScopeId],
  )

  const requestSaveCapacity = useCallback(() => {
    if (!canEditActivePlan) return
    if (!hasUnsavedMatrixEdits) {
      markCapacitySaved('All capacity changes are saved.')
      void flushWorkspaceSync()
      return
    }
    if (invalidDraftCount > 0) {
      setUploadError('Fix highlighted cells before saving. Blank is OK — it clears the override.')
      return
    }
    // Save on first click — no confirm dialog.
    void saveCapacityChanges()
  }, [canEditActivePlan, hasUnsavedMatrixEdits, invalidDraftCount, markCapacitySaved, saveCapacityChanges])

  useEffect(() => {
    if (!saveFlash) return
    const timer = window.setTimeout(() => setSaveFlash(false), 2200)
    return () => window.clearTimeout(timer)
  }, [saveFlash])
  const { isBlocked: navigationBlocked, proceed: proceedNavigation, cancel: cancelNavigation } = useUnsavedChangesGuard({
    when: hasUnsavedMatrixEdits,
  })

  useEffect(() => {
    const id = linkedScenario?.id ?? null
    if (draftsScenarioRef.current && id && draftsScenarioRef.current !== id) {
      if (draftsHydratedRef.current) writeSessionCellDrafts(draftsScenarioRef.current, cellDrafts)
      setCellDrafts(readSessionCellDrafts(id))
      setDraftUndoStack([])
      lastUndoDraftIdRef.current = null
      draftsHydratedRef.current = true
    } else if (!draftsScenarioRef.current && id) {
      setCellDrafts(readSessionCellDrafts(id))
      draftsHydratedRef.current = true
    } else if (!id) {
      draftsHydratedRef.current = false
    }
    draftsScenarioRef.current = id
    // Intentionally omit cellDrafts — only react to scenario switches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedScenario?.id])

  useEffect(() => {
    if (!draftsHydratedRef.current) return
    writeSessionCellDrafts(linkedScenario?.id, cellDrafts)
  }, [cellDrafts, linkedScenario?.id])

  useEffect(() => {
    if (!inputNotice) return
    const timer = window.setTimeout(() => setInputNotice(''), 4000)
    return () => window.clearTimeout(timer)
  }, [inputNotice])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return
      event.preventDefault()
      requestSaveCapacity()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [requestSaveCapacity])

  const FINANCIAL_SAVE_MESSAGE =
    'Saving these capacity changes will update this plan and affect Financial Dashboard data that uses it (revenue, cost, and margin views). Continue?'

  const importTemplateWorkbook = async (file: File) => {
    if (!linkedScenario || isCombinedView) {
      setUploadError('Upload is available for a single LOB capacity file, not the combined view.')
      setUploadMessage('')
      return
    }
    if (!canEditActivePlan) {
      setUploadError('You do not have edit access to upload into this capacity plan.')
      setUploadMessage('')
      return
    }

    setUploadBusy(true)
    setUploadMessage('')
    setUploadError('')

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      const result = parseCapacityPlanWorkbook(workbook, [], { acceptUnknownWeeks: true })

      if (!result.success) {
        setUploadError(result.errors.length ? result.errors.join(' ') : result.message)
        return
      }

      const weekStart = linkedScenario.plan.weekStart
      const plannedByWeek: Record<string, import('../planner/capacityPlanOverridePersistence').WeekCapacityPlanOverride> = {}
      Object.entries(result.plannedByWeek).forEach(([week, metrics]) => {
        const snappedWeek = snapToWeekStart(week, weekStart)
        plannedByWeek[snappedWeek] = { ...(plannedByWeek[snappedWeek] ?? {}), ...metrics }
      })

      const snappedWeeks = uniqueSortedWeeks(
        (result.templateWeeks.length ? result.templateWeeks : Object.keys(plannedByWeek)).map((week) =>
          snapToWeekStart(week, weekStart),
        ),
      )

      if (!Object.keys(plannedByWeek).length && !result.actualOverrides.length) {
        setUploadError(
          'No importable planned or actual values were found. Use Download → Download full workbook or Download matrix (Excel), fill Planned_* / Required Production FTE cells, then upload again.',
        )
        return
      }

      let displayWeekCount = snappedWeeks.length
      let displayWeekStart = snappedWeeks[0]
      if (snappedWeeks.length) {
        const priorImported = linkedScenario.plan.capacityImportedWeeks ?? []
        const nextImportedWeeks =
          templateImportMode === 'append'
            ? uniqueSortedWeeks([...priorImported, ...snappedWeeks])
            : snappedWeeks
        displayWeekCount = nextImportedWeeks.length
        displayWeekStart = nextImportedWeeks[0]
        updateScenarioPlan(linkedScenario.id, {
          ...linkedScenario.plan,
          capacityPlanStartWeek: nextImportedWeeks[0]!,
          capacityImportedWeeks: nextImportedWeeks,
        })
        setHiddenWeeks([])
        setShowFutureWeeks(true)
      }

      applyPlannedWeekOverrides(linkedScenario.id, plannedByWeek, templateImportMode)

      // Uploaded values must stick: pin every imported metric to manual and clear
      // Forecasting "Apply" so a later Save Setup cannot flip them back to forecast.
      if (result.uploadedDriverMetricIds.length) {
        const nextModes: ScenarioForecastModes = {
          ...loadScenarioForecastModes(linkedScenario.id),
        }
        for (const metricId of result.uploadedDriverMetricIds) {
          nextModes[metricId] = 'manual'
        }
        saveScenarioForecastModes(linkedScenario.id, nextModes)
        setForecastModes(nextModes)
        setSavedForecastModes(nextModes)

        for (const metricId of result.uploadedDriverMetricIds) {
          if (
            metricId === 'callVolume' ||
            metricId === 'ahtSeconds' ||
            metricId === 'occupancy' ||
            metricId === 'totalShrinkagePct' ||
            metricId === 'attritionHc' ||
            metricId === 'absenteeism'
          ) {
            patchDriverForecast(linkedScenario.id, metricId, { applyToCapacityPlan: false })
          }
        }
        refreshAdvancedForecasts()
      }

      if (result.actualOverrides.length) {
        const normalizedActuals = result.actualOverrides.map((override) => ({
          ...override,
          week: snapToWeekStart(override.week, weekStart),
        }))
        importActualOverrides(linkedScenario.id, normalizedActuals)
      }

      const requiredFteCount = Object.values(plannedByWeek).filter((week) => week.requiredFte != null).length
      if (requiredFteCount === 0 && isFteBillingPlan(linkedScenario.plan.billingType)) {
        setUploadMessage(result.message)
        setUploadError(
          'Upload applied, but no Required Production FTE values were found. Fill Planned_Required_FTE in the full workbook, or the Required Production FTE row in the matrix download, then upload again.',
        )
        return
      }

      setUploadMessage(
        [
          result.message,
          `Mode: ${templateImportMode === 'overwrite' ? 'overwrite matching weeks' : 'append / merge'}.`,
          displayWeekCount
            ? `Showing ${displayWeekCount} template week${displayWeekCount === 1 ? '' : 's'}${displayWeekStart ? ` starting ${displayWeekStart}` : ''}.`
            : null,
          result.warnings?.length ? result.warnings.join(' ') : null,
        ]
          .filter(Boolean)
          .join(' '),
      )
      setUploadError('')
      void flushWorkspaceSync()
    } catch (error) {
      setUploadError(
        error instanceof Error
          ? `Upload failed: ${error.message}`
          : 'Upload failed. Use Download → Download full workbook or Download matrix (Excel), fill values, then upload.',
      )
    } finally {
      setUploadBusy(false)
    }
  }

  const applyForecastImport = (result: import('../planner/capacityForecastImport').CapacityForecastImportResult) => {
    if (!linkedScenario || isCombinedView) return
    if (!canEditActivePlan) {
      setUploadError('You do not have edit access to upload into this capacity plan.')
      return
    }
    applyPlannedWeekOverrides(linkedScenario.id, result.plannedByWeek, result.mode)
    const importedWeeks = uniqueSortedWeeks(Object.keys(result.plannedByWeek))
    if (importedWeeks.length) {
      const priorImported = linkedScenario.plan.capacityImportedWeeks ?? []
      const nextImportedWeeks =
        result.mode === 'append' ? uniqueSortedWeeks([...priorImported, ...importedWeeks]) : importedWeeks
      updateScenarioPlan(linkedScenario.id, {
        ...linkedScenario.plan,
        capacityPlanStartWeek: linkedScenario.plan.capacityPlanStartWeek ?? nextImportedWeeks[0],
        capacityImportedWeeks: nextImportedWeeks,
      })
    }
    const driverIds = [
      'callVolume',
      'ahtSeconds',
      'occupancy',
      'totalShrinkagePct',
      'attritionHc',
      'requiredFte',
    ].filter((metricId) =>
      Object.values(result.plannedByWeek).some(
        (week) => week[metricId as keyof typeof week] != null && Number.isFinite(week[metricId as keyof typeof week] as number),
      ),
    )
    if (driverIds.length) {
      const nextModes: ScenarioForecastModes = {
        ...loadScenarioForecastModes(linkedScenario.id),
      }
      for (const metricId of driverIds) nextModes[metricId] = 'manual'
      saveScenarioForecastModes(linkedScenario.id, nextModes)
      setForecastModes(nextModes)
      setSavedForecastModes(nextModes)
    }
    setUploadMessage(
      [
        result.message,
        `Mode: ${result.mode === 'overwrite' ? 'overwrite matching weeks' : 'append / merge'}.`,
      ].join(' '),
    )
    setUploadError(result.errors.length ? result.errors.join(' ') : '')
    void flushWorkspaceSync()
  }

  const exportWorkbook = () => {
    if (!linkedScenario) return
    const sameClientSheets = scenarios
      .filter((scenario) => scenario.plan.client === linkedScenario.plan.client)
      .map((scenario) => ({
        scenario,
        rows: deriveCapacityPlanRows(
          getScenarioLedger(scenario.id),
          scenario,
          getScenarioForecast(scenario.id, FORECAST_HORIZON_WEEKS),
          getScenarioCapacityPlanOverrides(scenario.id),
          capacityWorkspaceForecastModes(scenario, forecastModes),
            currentPlanningWeek
              ? getScenarioRoster(scenario.id).filter(
                  (employee) =>
                    employee.status !== 'active' &&
                    employee.productionDate &&
                    employee.productionDate <= currentPlanningWeek,
                ).length
              : 0,
        ),
      }))
    downloadFullCapacityPlanWorkbook(
      derivedRows,
      isCombinedView ? { ...linkedScenario, plan: { ...linkedScenario.plan, location: 'Combined' } } : linkedScenario,
      forecast,
      sameClientSheets,
    )
    setUploadError('')
    setUploadMessage(
      `Downloaded full workbook (${derivedRows.length} weeks). Edit Capacity_Plan sheet values, then use Upload template to import.`,
    )
    setDownloadMenuOpen(false)
  }

  if (!linkedScenario) {
    return <p className="saas-muted">Select or create a capacity file from Home to open the matrix view.</p>
  }

  const bindMatrixInput = (kind: MatrixEditKind, week: string, metricId: string) => {
    const draftId = cellDraftId(kind, week, metricId)
    const bounds = metricInputBounds(metricId)
    const draft = cellDrafts[draftId]
    const parsed = draft != null ? parseMetricDraft(metricId, draft) : null
    return {
      dirty: draft != null,
      invalid: parsed?.status === 'invalid',
      disabled: !canEditActivePlan,
      min: bounds.min,
      max: bounds.max,
      kind,
      week,
      metricId,
      onChange: (next: string) => pushCellDraft(draftId, next),
      onClear: () => clearCellDraft(draftId),
      onPasteGrid: (grid: string[][]) => pasteGridFromCell({ kind, week, metricId }, grid),
      onNotice: showInputNotice,
    }
  }

  return (
    <div className={`cap-module-page cap-capacity-workspace${embedded ? ' cap-module-page--embedded' : ''}`}>
      {!canEditActivePlan ? (
        <div className="cap-executive-access-banner" role="status">
          <strong>View only.</strong> You do not have edit access to this capacity plan. Ask an admin to grant access.
        </div>
      ) : null}
      {navigationBlocked ? (
        <UnsavedChangesDialog
          title="Unsaved capacity changes"
          message={`${FINANCIAL_SAVE_MESSAGE} Or leave without saving.`}
          saveLabel="Save changes"
          discardLabel="Leave without saving"
          onSave={() => {
            if (saveCapacityChanges()) proceedNavigation()
          }}
          onDiscard={() => {
            discardUnsavedCapacityChanges()
            proceedNavigation()
          }}
          onCancel={cancelNavigation}
        />
      ) : null}
      {saveConfirmOpen ? (
        <UnsavedChangesDialog
          title="Save capacity changes?"
          message={FINANCIAL_SAVE_MESSAGE}
          saveLabel="Save"
          discardLabel="Cancel"
          onSave={() => {
            void saveCapacityChanges()
          }}
          onDiscard={() => setSaveConfirmOpen(false)}
          onCancel={() => setSaveConfirmOpen(false)}
        />
      ) : null}
      {pendingScopeId ? (
        <UnsavedChangesDialog
          title="Unsaved capacity changes"
          message="Save before switching LOB or Combined view? Unsaved cell edits stay on this plan only if you save first."
          saveLabel="Save and switch"
          discardLabel="Switch without saving"
          onSave={() => {
            if (saveCapacityChanges()) applyScopeChange(pendingScopeId)
          }}
          onDiscard={() => {
            discardUnsavedCapacityChanges()
            applyScopeChange(pendingScopeId)
          }}
          onCancel={() => setPendingScopeId(null)}
        />
      ) : null}
      {deleteConfirmOpen
        ? createPortal(
            <div
              className="cap-unsaved-backdrop"
              role="presentation"
              onClick={() => setDeleteConfirmOpen(false)}
            >
              <div
                className="cap-delete-confirm cap-unsaved-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="cap-delete-plan-title"
                onClick={(event) => event.stopPropagation()}
              >
                <p id="cap-delete-plan-title" className="m-0 font-semibold text-slate-900">
                  Delete capacity plan data?
                </p>
                <p className="cap-panel__desc m-0 mt-1">
                  This removes all planned overrides, actual imports, stage attrition, shrinkage categories,
                  forecast overrides, template weeks, and locked driver weeks for{' '}
                  <strong>
                    {linkedScenario.plan.client} · {resolvePlanLob(linkedScenario.plan)}
                  </strong>
                  . The LOB and assumptions are kept.
                </p>
                <div className="cap-capacity-sidebar__actions mt-3" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '0.55rem' }}>
                  <button
                    type="button"
                    className="saas-btn saas-btn--secondary"
                    onClick={() => setDeleteConfirmOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="saas-btn saas-btn--danger"
                    onClick={handleConfirmDeleteCapacityPlan}
                  >
                    Yes, delete plan data
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {removeCapacityConfirmOpen
        ? createPortal(
            <div
              className="cap-unsaved-backdrop"
              role="presentation"
              onClick={() => setRemoveCapacityConfirmOpen(false)}
            >
              <div
                className="cap-delete-confirm cap-unsaved-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="cap-remove-capacity-title"
                onClick={(event) => event.stopPropagation()}
              >
                <p id="cap-remove-capacity-title" className="m-0 font-semibold text-slate-900">
                  Remove Deleted Capacity?
                </p>
                <p className="cap-panel__desc m-0 mt-1">
                  This permanently removes the capacity plan for{' '}
                  <strong>
                    {linkedScenario.plan.client} · {resolvePlanLob(linkedScenario.plan)}
                  </strong>
                  {' '}and all associated assumptions, overrides, forecast drivers, and roster data. This cannot be undone.
                </p>
                <div className="cap-capacity-sidebar__actions mt-3" style={{ display: 'flex', flexDirection: 'row', flexWrap: 'wrap', gap: '0.55rem' }}>
                  <button
                    type="button"
                    className="saas-btn saas-btn--secondary"
                    onClick={() => setRemoveCapacityConfirmOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="saas-btn saas-btn--danger"
                    onClick={handleConfirmRemoveDeletedCapacity}
                  >
                    Yes, remove capacity
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {settingsOpen
        ? createPortal(
            <div
              className="cap-unsaved-backdrop"
              role="presentation"
              onClick={() => setSettingsOpen(false)}
            >
              <div
                className="cap-unsaved-dialog cap-plan-settings-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="cap-plan-settings-title"
                onClick={(event) => event.stopPropagation()}
              >
                <header className="cap-plan-settings-header">
                  <div>
                    <p className="cap-plan-settings-kicker m-0">Capacity</p>
                    <h2 id="cap-plan-settings-title" className="cap-plan-settings-title m-0">
                      Settings
                    </h2>
                    <p className="cap-plan-settings-lead m-0">
                      {isCombinedView
                        ? 'Choose which metrics are visible in the capacity matrix.'
                        : 'Edit plan identity and control which metrics appear in the grid.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="saas-btn saas-btn--secondary cap-plan-settings-close"
                    onClick={() => setSettingsOpen(false)}
                    aria-label="Close settings"
                  >
                    Close
                  </button>
                </header>

                <div className="cap-plan-settings-tabs" role="tablist" aria-label="Settings sections">
                  {!isCombinedView ? (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={settingsTab === 'plan'}
                      className={`cap-plan-settings-tab${settingsTab === 'plan' ? ' is-active' : ''}`}
                      onClick={() => {
                        setSettingsError('')
                        setSettingsTab('plan')
                      }}
                    >
                      Plan
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="tab"
                    aria-selected={settingsTab === 'metrics'}
                    className={`cap-plan-settings-tab${settingsTab === 'metrics' ? ' is-active' : ''}`}
                    onClick={() => {
                      setSettingsError('')
                      setSettingsTab('metrics')
                    }}
                  >
                    Metrics
                    {optionalMetricCount > 0 ? (
                      <span className="cap-plan-settings-tab__count">{optionalMetricCount}</span>
                    ) : null}
                  </button>
                </div>

                {settingsTab === 'plan' && !isCombinedView ? (
                  <div className="cap-plan-settings-panel" role="tabpanel">
                    <p className="cap-plan-settings-panel__hint m-0">
                      These fields identify the capacity plan used across Capacity and Financial views.
                    </p>
                    <div className="cap-plan-settings-form">
                      <label className="saas-field">
                        <span className="saas-field__label">Client</span>
                        <input
                          className="cap-field__input"
                          value={settingsDraft.client}
                          onChange={(event) => setSettingsDraft((prev) => ({ ...prev, client: event.target.value }))}
                          autoFocus
                        />
                      </label>
                      <label className="saas-field">
                        <span className="saas-field__label">LOB</span>
                        <input
                          className="cap-field__input"
                          value={settingsDraft.lob}
                          onChange={(event) => setSettingsDraft((prev) => ({ ...prev, lob: event.target.value }))}
                          placeholder="Line of business"
                        />
                      </label>
                      <label className="saas-field">
                        <span className="saas-field__label">Site *</span>
                        <input
                          className="cap-field__input"
                          value={settingsDraft.location}
                          onChange={(event) => setSettingsDraft((prev) => ({ ...prev, location: event.target.value }))}
                          placeholder="Site / geography"
                        />
                      </label>
                      <label className="saas-field">
                        <span className="saas-field__label">Timezone *</span>
                        <select
                          className="cap-field__input"
                          value={settingsDraft.timezone}
                          onChange={(event) => setSettingsDraft((prev) => ({ ...prev, timezone: event.target.value }))}
                        >
                          {timezoneSelectOptions(settingsDraft.timezone).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <span className="cap-panel__desc m-0 mt-1">
                          Current week and Actual/Planned use {formatTimeZoneLabel(settingsDraft.timezone)}.
                        </span>
                      </label>
                      <label className="saas-field">
                        <span className="saas-field__label">Client code</span>
                        <input
                          className="cap-field__input"
                          value={settingsDraft.projectCode}
                          onChange={(event) => setSettingsDraft((prev) => ({ ...prev, projectCode: event.target.value }))}
                          placeholder="Optional"
                        />
                      </label>
                      <label className="saas-field">
                        <span className="saas-field__label">Project name</span>
                        <input
                          className="cap-field__input"
                          value={settingsDraft.projectName}
                          onChange={(event) => setSettingsDraft((prev) => ({ ...prev, projectName: event.target.value }))}
                          placeholder="Optional"
                        />
                      </label>
                      <label className="saas-field">
                        <span className="saas-field__label">Billing type</span>
                        <select
                          className="cap-field__input"
                          value={settingsDraft.billingType}
                          onChange={(event) => setSettingsDraft((prev) => ({ ...prev, billingType: event.target.value }))}
                        >
                          {BILLABLE_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="saas-field cap-plan-settings-form__full">
                        <ChannelSelector
                          selected={settingsDraft.supportedChannels}
                          onChange={(supportedChannels) => setSettingsDraft((prev) => ({ ...prev, supportedChannels }))}
                          compact
                          single
                        />
                      </div>
                      <div className="saas-field cap-plan-settings-form__full">
                        <span className="saas-field__label">Capacity start week</span>
                        <PlanStartWeekField
                          weekStart={linkedScenario.plan.weekStart}
                          timeZone={settingsDraft.timezone || linkedScenario.plan.timezone}
                          value={settingsDraft.capacityPlanStartWeek || planStartWeek || ''}
                          onChange={(capacityPlanStartWeek) =>
                            setSettingsDraft((prev) => ({ ...prev, capacityPlanStartWeek }))
                          }
                          compact
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                {settingsTab === 'metrics' ? (
                  <div className="cap-plan-settings-panel" role="tabpanel">
                    <div className="cap-plan-settings-metrics-toolbar">
                      <label className="cap-plan-settings-switch">
                        <input
                          type="checkbox"
                          checked={showOptionalMetrics}
                          onChange={(event) => setShowOptionalMetrics(event.target.checked)}
                        />
                        <span>Show hidden metrics in the grid now</span>
                      </label>
                      <button
                        type="button"
                        className="saas-btn saas-btn--secondary"
                        onClick={resetOptionalMetrics}
                      >
                        Reset defaults
                      </button>
                    </div>
                    <p className="cap-plan-settings-panel__hint m-0">
                      Expand a group, then use Hide / Show on each metric. Changes apply to the grid immediately.
                      {optionalMetricCount > 0
                        ? ` ${optionalMetricCount} metric${optionalMetricCount === 1 ? '' : 's'} currently hidden.`
                        : ' No metrics are hidden.'}
                    </p>
                    <div className="cap-plan-settings-metrics-list">
                      {MATRIX_GROUP_ORDER.filter((groupId) => (matrixGroups[groupId]?.length ?? 0) > 0).map(
                        (groupId) => {
                          const metrics = orderMetrics(groupId, matrixGroups[groupId] ?? [], metricOrders)
                          const hiddenInGroup = metrics.filter((metric) =>
                            isMetricOptional(groupId, metric.id, optionalMetrics),
                          ).length
                          return (
                            <details key={groupId} className="cap-plan-settings-metric-group" open>
                              <summary className="cap-plan-settings-metric-group__head">
                                <span className="cap-plan-settings-metric-group__title">
                                  {GROUP_LABELS[groupId]}
                                </span>
                                <span className="cap-plan-settings-metric-group__meta">
                                  {hiddenInGroup > 0
                                    ? `${hiddenInGroup} hidden · ${metrics.length} total`
                                    : `${metrics.length} metrics`}
                                </span>
                              </summary>
                              <div className="cap-plan-settings-metric-group__body">
                                <div className="cap-plan-settings-metric-group__bulk">
                                  <button
                                    type="button"
                                    className="cap-plan-settings-link-btn"
                                    onClick={(event) => {
                                      event.preventDefault()
                                      metrics.forEach((metric) =>
                                        toggleMetricOptional(groupId, metric.id, true),
                                      )
                                    }}
                                  >
                                    Hide all
                                  </button>
                                  <button
                                    type="button"
                                    className="cap-plan-settings-link-btn"
                                    onClick={(event) => {
                                      event.preventDefault()
                                      metrics.forEach((metric) =>
                                        toggleMetricOptional(groupId, metric.id, false),
                                      )
                                    }}
                                  >
                                    Show all
                                  </button>
                                </div>
                                {metrics.map((metric) => {
                                  const hidden = isMetricOptional(groupId, metric.id, optionalMetrics)
                                  return (
                                    <div
                                      key={metric.id}
                                      className={`cap-plan-settings-metric-row${hidden ? ' is-hidden' : ''}`}
                                    >
                                      <div className="cap-plan-settings-metric-row__text">
                                        <span className="cap-plan-settings-metric-row__label">
                                          {metric.label}
                                        </span>
                                        <span className="cap-plan-settings-metric-row__state">
                                          {hidden ? 'Hidden in grid' : 'Visible in grid'}
                                        </span>
                                      </div>
                                      <button
                                        type="button"
                                        className={`cap-plan-settings-visibility${hidden ? ' is-off' : ' is-on'}`}
                                        aria-pressed={!hidden}
                                        onClick={() => toggleMetricOptional(groupId, metric.id, !hidden)}
                                      >
                                        {hidden ? 'Show' : 'Hide'}
                                      </button>
                                    </div>
                                  )
                                })}
                              </div>
                            </details>
                          )
                        },
                      )}
                    </div>
                  </div>
                ) : null}

                <div className="cap-plan-settings-actions">
                  {settingsError ? (
                    <p className="cap-plan-settings-error m-0" role="alert">
                      {settingsError}
                    </p>
                  ) : null}
                  <button
                    type="button"
                    className="saas-btn saas-btn--secondary"
                    onClick={() => {
                      setSettingsOpen(false)
                      setSettingsError('')
                    }}
                  >
                    Cancel
                  </button>
                  <button type="button" className="saas-btn" onClick={savePlanSettings}>
                    {isCombinedView || settingsTab === 'metrics' ? 'Done' : 'Save settings'}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      <main className="cap-module-main cap-module-main--embedded">
        <ModulePageHeader
          title="Capacity"
          description={
            isCombinedView
              ? `${linkedScenario.plan.client} · All LOBs · ${
                  [...new Set(clientScenarios.flatMap((scenario) => explicitPlanChannels(scenario.plan).map((ch) => CHANNEL_LABELS[ch])))].join(', ') ||
                  'No channel'
                }`
              : `${linkedScenario.plan.client} · ${resolvePlanLob(linkedScenario.plan)} · ${formatPlanChannels(linkedScenario.plan) || 'No channel'} · ${billableTypeLabel(linkedScenario.plan.billingType)}`
          }
          actions={
            <div className="cap-capacity-toolbar">
              <button
                type="button"
                className="saas-btn saas-btn--secondary"
                title="Undo last unsaved cell edit"
                disabled={!canUndo && !hasPreviousCapacityPlan()}
                onClick={() => {
                  if (draftUndoStack.length > 0 || Object.keys(cellDrafts).length > 0) {
                    if (draftUndoStack.length > 0) {
                      undoLastCellEdit()
                    } else {
                      discardUnsavedCapacityChanges()
                    }
                    setUploadMessage('Undid last unsaved edit.')
                    setUploadError('')
                    return
                  }
                  if (!isCombinedView && hasPreviousCapacityPlan()) {
                    const restored = resetToPreviousCapacityPlan()
                    if (!restored) {
                      setUploadError('Nothing left to undo.')
                      return
                    }
                    setUploadMessage('Restored previous capacity plan snapshot.')
                    setUploadError('')
                  }
                }}
              >
                Undo
              </button>
              <button
                type="button"
                className="saas-btn saas-btn--secondary"
                title="Edit plan identity and optional metrics"
                onClick={() => openPlanSettings(isCombinedView ? 'metrics' : 'plan')}
              >
                Settings
              </button>
              <button
                type="button"
                className={`saas-btn${hasUnsavedMatrixEdits || saveFlash ? '' : ' saas-btn--secondary'}${saveFlash ? ' cap-capacity-save--flash' : ''}`}
                title={hasUnsavedMatrixEdits ? 'Save capacity cell edits and drivers (Ctrl+S)' : 'Confirm everything is saved'}
                disabled={!canEditActivePlan}
                onClick={requestSaveCapacity}
              >
                {hasUnsavedMatrixEdits ? 'Save changes' : saveFlash ? 'Saved ✓' : 'Saved'}
              </button>
              <button
                type="button"
                className={`saas-btn cap-capacity-toolbar__toggle${controlsOpen ? ' saas-btn--secondary' : ' cap-capacity-toolbar__toggle--highlight'}`}
                onClick={() => setControlsOpen((prev) => !prev)}
              >
                {controlsOpen ? 'Hide controls' : 'Capacity controls'}
              </button>
              <button
                type="button"
                className={`saas-btn cap-capacity-toolbar__charts${chartsOpen ? ' saas-btn--secondary' : ' cap-capacity-toolbar__charts--highlight'}`}
                onClick={() => setChartsOpen((prev) => !prev)}
              >
                {chartsOpen ? 'Hide charts' : 'Charts'}
              </button>
            </div>
          }
        />

        {!isCombinedView && resolvePlanLocation(linkedScenario.plan) ? (
          <div className="cap-staffing__meta" aria-label="Plan context">
            <span className="cap-staffing__chip cap-staffing__chip--location">
              {resolvePlanLocation(linkedScenario.plan)}
            </span>
          </div>
        ) : null}

        <CapacityChartsPanel
          rows={displayedRows}
          open={chartsOpen}
          onClose={() => setChartsOpen(false)}
        />

        <div className={`cap-capacity-layout${controlsOpen ? '' : ' cap-capacity-layout--collapsed'}`}>
          {controlsOpen ? (
          <aside className="saas-card cap-capacity-sidebar" aria-label="Capacity controls">
            <div className="cap-capacity-sidebar__section cap-capacity-sidebar__section--primary">
              <div className="cap-capacity-sidecard__head">
                <h3 className="cap-capacity-sidecard__title">Capacity controls</h3>
              </div>

              <label className="saas-field">
                <span className="saas-field__label">Client</span>
                <select
                  className="cap-field__input"
                  value={clientFilter}
                  aria-label="Client"
                  onChange={(event) => {
                    const nextClient = event.target.value
                    setClientFilter(nextClient)
                    setSiteFilter('')
                    const pool = portfolioScenarios.filter((scenario) => !nextClient || scenario.plan.client === nextClient)
                    const currentMatches = linkedScenario
                      ? !nextClient || linkedScenario.plan.client === nextClient
                      : false
                    if (!currentMatches && pool[0]) requestScopeChange(`lob:${pool[0].id}`)
                  }}
                >
                  <option value="">All clients</option>
                  {capacityClientOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label className="saas-field">
                <span className="saas-field__label">Site</span>
                <select
                  className="cap-field__input"
                  value={capacitySiteOptions.includes(siteFilter) ? siteFilter : ''}
                  aria-label="Site"
                  onChange={(event) => {
                    const nextSite = event.target.value
                    setSiteFilter(nextSite)
                    const pool = portfolioScenarios.filter((scenario) => {
                      if (clientFilter && scenario.plan.client !== clientFilter) return false
                      if (nextSite && resolvePlanLocation(scenario.plan) !== nextSite) return false
                      return true
                    })
                    const currentMatches = linkedScenario
                      ? (!clientFilter || linkedScenario.plan.client === clientFilter) &&
                        (!nextSite || resolvePlanLocation(linkedScenario.plan) === nextSite)
                      : false
                    if (!currentMatches && pool[0]) requestScopeChange(`lob:${pool[0].id}`)
                  }}
                >
                  <option value="">All sites</option>
                  {capacitySiteOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
              <label className="saas-field">
                <span className="saas-field__label">LOB and channel</span>
                <select
                  className="cap-field__input"
                  value={resolvedScopeId}
                  onChange={(event) => requestScopeChange(event.target.value)}
                  aria-label="Capacity scope"
                >
                  <optgroup label="One LOB">
                    {scopeOptions.lobOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                  {scopeOptions.combinedOptions.length ? (
                    <optgroup label="All LOBs together">
                      {scopeOptions.combinedOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                </select>
              </label>

              <label className="saas-field">
                <span className="saas-field__label">View</span>
                <select className="cap-field__input" value={view} onChange={(event) => setView(event.target.value as CapacityView)}>
                  <option value="weekly">Weekly — edit each week</option>
                  <option value="monthly">Monthly — summary only</option>
                  <option value="quarterly">Quarterly — summary only</option>
                </select>
              </label>

              <div className="cap-capacity-sidebar__actions">
                <p className="cap-capacity-sidebar__group-label">This plan</p>
                <button
                  type="button"
                  className="saas-btn saas-btn--secondary"
                  onClick={() => openPlanSettings(isCombinedView ? 'metrics' : 'plan')}
                >
                  Settings
                </button>
                <button
                  type="button"
                  className="saas-btn saas-btn--secondary"
                  disabled={!canUndo && !hasPreviousCapacityPlan()}
                  onClick={() => {
                    if (draftUndoStack.length > 0 || Object.keys(cellDrafts).length > 0) {
                      if (draftUndoStack.length > 0) undoLastCellEdit()
                      else discardUnsavedCapacityChanges()
                      setUploadMessage('Undid last unsaved edit.')
                      setUploadError('')
                      return
                    }
                    if (!isCombinedView && hasPreviousCapacityPlan()) {
                      const restored = resetToPreviousCapacityPlan()
                      if (!restored) {
                        setUploadError('Nothing left to undo.')
                        return
                      }
                      setUploadMessage('Restored previous capacity plan snapshot.')
                      setUploadError('')
                    }
                  }}
                >
                  Undo
                </button>
                {!isCombinedView && linkedScenario && hasPreviousCapacityPlan() ? (
                  <button
                    type="button"
                    className="saas-btn saas-btn--secondary"
                    onClick={() => {
                      const restored = resetToPreviousCapacityPlan()
                      if (!restored) {
                        setUploadError('No previous capacity plan is available to restore.')
                        return
                      }
                      setUploadMessage('Previous capacity plan restored.')
                      setUploadError('')
                    }}
                  >
                    Reset previous plan
                  </button>
                ) : null}
                <p className="cap-capacity-sidebar__group-label">Files</p>
                <label className="cap-capacity-upload-mode">
                  <span className="sr-only">Upload template mode</span>
                  <select
                    className="cap-field__input"
                    value={templateImportMode}
                    onChange={(event) => setTemplateImportMode(event.target.value as 'overwrite' | 'append')}
                    disabled={isCombinedView || !canEditActivePlan || uploadBusy}
                    title="Import mode for Upload template"
                  >
                    <option value="overwrite">Overwrite matching weeks</option>
                    <option value="append">Append / merge</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="saas-btn saas-btn--secondary"
                  onClick={() => {
                    setUploadMessage('')
                    setUploadError('')
                    fileInputRef.current?.click()
                  }}
                  disabled={isCombinedView || !canEditActivePlan || uploadBusy}
                  title={
                    isCombinedView
                      ? 'Switch to a single LOB to upload'
                      : !canEditActivePlan
                        ? 'You need edit access to upload'
                        : 'Upload a downloaded matrix or full workbook'
                  }
                >
                  {uploadBusy ? 'Uploading…' : 'Upload template'}
                </button>
                <details
                  className="cap-capacity-download-menu"
                  open={downloadMenuOpen}
                  onToggle={(event) => setDownloadMenuOpen((event.currentTarget as HTMLDetailsElement).open)}
                >
                  <summary className="saas-btn saas-btn--secondary cap-capacity-download-menu__trigger">Download</summary>
                  <div className="cap-capacity-download-menu__panel" role="menu">
                    <button type="button" className="cap-capacity-download-menu__item" role="menuitem" onClick={exportMatrixExcel}>
                      Download matrix (Excel)
                    </button>
                    <button type="button" className="cap-capacity-download-menu__item" role="menuitem" onClick={exportMatrixPdf}>
                      Print / save PDF
                    </button>
                    <button type="button" className="cap-capacity-download-menu__item" role="menuitem" onClick={exportWorkbook}>
                      Download full workbook
                    </button>
                  </div>
                </details>
                <button
                  type="button"
                  className="saas-btn saas-btn--secondary"
                  disabled={isCombinedView || !linkedScenario || !currentPlanningWeek || savingAgentCount}
                  onClick={saveActiveAgentCount}
                >
                  {savingAgentCount ? 'Saving…' : 'Save the Count of Agents this week'}
                </button>
                <button
                  type="button"
                  className={`saas-btn${hasUnsavedMatrixEdits || saveFlash ? '' : ' saas-btn--secondary'}${saveFlash ? ' cap-capacity-save--flash' : ''}`}
                  title={hasUnsavedMatrixEdits ? 'Save capacity cell edits and drivers (Ctrl+S)' : 'Confirm everything is saved'}
                  disabled={!canEditActivePlan}
                  onClick={requestSaveCapacity}
                >
                  {hasUnsavedMatrixEdits ? 'Save changes' : saveFlash ? 'Saved ✓' : 'Saved'}
                </button>
                {!isCombinedView && linkedScenario ? (
                  <button
                    type="button"
                    className="saas-btn saas-btn--danger"
                    onClick={() => setDeleteConfirmOpen(true)}
                    disabled={!canEditActivePlan}
                  >
                    Delete capacity plan
                  </button>
                ) : null}
                {!isCombinedView && linkedScenario && canCreatePlans && user && canDeleteCapacityPlan(linkedScenario, {
                  email: user.email,
                  accessLevel: user.accessLevel,
                }) ? (
                  <button
                    type="button"
                    className="saas-btn saas-btn--danger"
                    onClick={() => setRemoveCapacityConfirmOpen(true)}
                    disabled={!canEditActivePlan}
                    title="Permanently remove this capacity plan and all associated assumptions"
                  >
                    Remove Deleted Capacity
                  </button>
                ) : null}
              </div>
              {uploadError ? <p className="cap-capacity-upload-message cap-capacity-upload-message--error">{uploadError}</p> : null}
              {!uploadError && uploadMessage ? (
                <p className="cap-capacity-upload-message cap-capacity-upload-message--success">{uploadMessage}</p>
              ) : null}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  void importTemplateWorkbook(file)
                  event.target.value = ''
                }}
              />
            </div>

            <div className="cap-capacity-sidecard">
              <div className="cap-capacity-sidecard__head">
                <h3 className="cap-capacity-sidecard__title">{linkedScenario.plan.client}</h3>
              </div>
              <div className="cap-capacity-scope-list">
                {clientScenarios.map((scenario) => {
                  const selected = !isCombinedView && scenario.id === linkedScenario.id
                  const channel = formatPlanChannels(scenario.plan)
                  const primaryChannel = explicitPlanChannels(scenario.plan)[0]
                  return (
                    <button
                      key={scenario.id}
                      type="button"
                      className={`cap-capacity-scope-btn${selected ? ' cap-capacity-scope-btn--active' : ''}${primaryChannel ? ` cap-capacity-scope-btn--${primaryChannel}` : ''}`}
                      onClick={() => requestScopeChange(`lob:${scenario.id}`)}
                    >
                      <span className="cap-capacity-scope-btn__main">
                        <strong>{resolvePlanLob(scenario.plan) || scenario.plan.projectCode || scenario.name}</strong>
                        <em>
                          {[scenario.plan.projectCode, resolvePlanLocation(scenario.plan)].filter(Boolean).join(' · ') || billableTypeLabel(scenario.plan.billingType)}
                        </em>
                      </span>
                      <span className={`cap-capacity-scope-btn__channel${primaryChannel ? ` cap-capacity-scope-btn__channel--${primaryChannel}` : ''}`}>
                        {channel || 'No channel'}
                      </span>
                    </button>
                  )
                })}
                {clientScenarios.length > 1 ? (
                  <button
                    type="button"
                    className={`cap-capacity-scope-btn cap-capacity-scope-btn--combined${isCombinedView ? ' cap-capacity-scope-btn--active' : ''}`}
                    onClick={() => requestScopeChange(`combined:${linkedScenario.plan.client}`)}
                  >
                    <span className="cap-capacity-scope-btn__main">
                      <strong>All LOBs</strong>
                      <em>
                        {[...new Set(clientScenarios.flatMap((scenario) => explicitPlanChannels(scenario.plan).map((ch) => CHANNEL_LABELS[ch])))].join(', ')}
                      </em>
                    </span>
                    <span className="cap-capacity-scope-btn__channel">Combined</span>
                  </button>
                ) : null}
              </div>
            </div>

            {!isCombinedView && linkedScenario ? (
              <div className="cap-capacity-sidecard">
                <div className="cap-capacity-sidecard__head">
                  <div>
                    <p className="cap-capacity-sidecard__eyebrow">Plan window</p>
                    <h3 className="cap-capacity-sidecard__title">Capacity start week</h3>
                  </div>
                </div>
                <div className="cap-capacity-sidebar__form">
                  <PlanStartWeekField
                    weekStart={linkedScenario.plan.weekStart}
                    timeZone={linkedScenario.plan.timezone}
                    value={linkedScenario.plan.capacityPlanStartWeek ?? planStartWeek ?? ''}
                    onChange={(capacityPlanStartWeek) => {
                      updateScenarioPlan(linkedScenario.id, {
                        ...linkedScenario.plan,
                        capacityPlanStartWeek,
                        capacityImportedWeeks: undefined,
                      })
                      void flushWorkspaceSync()
                    }}
                    compact
                  />
                  <p className="cap-panel__desc m-0">
                    Current week (today): <strong>{currentPlanningWeek}</strong>
                  </p>
                  {importedDisplayWeeks?.length ? (
                    <p className="cap-panel__desc m-0">
                      Template upload active — showing all {importedDisplayWeeks.length} weeks. Change start week to return to the default {MAX_FUTURE_WEEKS}-week future view.
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            {!isCombinedView && linkedScenario ? (
              <CapacityDataUploadPanel
                scenario={linkedScenario}
                disabled={!canEditActivePlan}
                existingOverrides={plannedOverrides}
                onImport={applyForecastImport}
                onCapacityWorkbookFile={importTemplateWorkbook}
              />
            ) : null}

            {!isCombinedView && linkedScenario ? (
              <ShrinkagePlanningPanel
                rows={derivedRows}
                categories={scenarioShrinkageCategories}
                visibleCategoryIds={effectiveVisibleShrinkageCategoryIds}
                onVisibleCategoryIdsChange={(ids) =>
                  setVisibleShrinkageCategoryIds(withDefaultOooShrinkageCategoryIds(ids))
                }
                onPlannedCategoryChange={(week, categoryId, value) => {
                  updatePlannedShrinkageCategory(linkedScenario.id, week, categoryId, value)
                  void flushWorkspaceSync()
                }}
                getPlannedCategoryValue={getPlannedShrinkageCategoryValue}
                onAddCategory={(category) => {
                  addScenarioShrinkageCategory(linkedScenario.id, category)
                  setVisibleShrinkageCategoryIds((prev) => (prev.includes(category.id) ? prev : [...prev, category.id]))
                  void flushWorkspaceSync()
                }}
                onDeleteCategory={(categoryId) => {
                  deleteMatrixShrinkageCategory(categoryId)
                  void flushWorkspaceSync()
                }}
                disabled={!canEditActivePlan || isCombinedView}
              />
            ) : null}

            {!isCombinedView && linkedScenario ? (
              <StageAttritionPanel
                assumptions={linkedScenario.assumptions}
                overrides={stageAttritionOverrides ?? {}}
                onChange={(stage, stageWeek, value) =>
                  updateStageAttritionRate(linkedScenario.id, stage, stageWeek, value)
                }
                disabled={!canEditActivePlan || isCombinedView}
              />
            ) : null}

            <div className="cap-capacity-sidecard">
              <div className="cap-capacity-sidecard__head">
                <div>
                  <p className="cap-capacity-sidecard__eyebrow">Forecast use</p>
                  <h3 className="cap-capacity-sidecard__title">Planning drivers</h3>
                </div>
                <button
                  type="button"
                  className={`cap-capacity-sidecard__toggle${sidebarPanelOpen.forecastUse ? ' is-active' : ' cap-capacity-sidecard__toggle--highlight'}`}
                  onClick={() => setSidebarPanelOpen((prev) => ({ ...prev, forecastUse: !prev.forecastUse }))}
                >
                  {sidebarPanelOpen.forecastUse ? 'Hide' : 'Show'}
                </button>
              </div>
              {sidebarPanelOpen.forecastUse ? (
              <div className="cap-capacity-sidebar__form">
                {CAPACITY_FORECAST_MODE_METRICS.map((metricId) => (
                  <label key={metricId} className="saas-field">
                    <span className="saas-field__label">{driverMetricLabel(metricId)}</span>
                    <select
                      className="cap-field__input"
                      value={forecastModes[metricId]}
                      onChange={(event) =>
                        setForecastModes((prev) => ({
                          ...prev,
                          [metricId]: event.target.value as CapacityForecastMode,
                        }))
                      }
                      disabled={isCombinedView}
                    >
                      {driverModeOptions(metricId).map((mode) => (
                        <option key={`${metricId}-${mode}`} value={mode}>
                          {driverModeLabel(mode)}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
                <div className="cap-capacity-driver-subsection">
                  <button
                    type="button"
                    className={`cap-capacity-sidecard__toggle${shrinkageDriversOpen ? ' is-active' : ''}`}
                    onClick={() => setShrinkageDriversOpen((prev) => !prev)}
                  >
                    {shrinkageDriversOpen ? 'Hide shrinkage details' : 'Show shrinkage details'}
                  </button>
                  {shrinkageDriversOpen ? (
                    <div className="cap-capacity-driver-subsection__grid">
                      <p className="saas-muted m-0 text-xs cap-capacity-driver-subsection__hint">
                        Shows Out of office / In office categories added in the Shrinkage metric. Modes apply to future
                        planned weeks unless a cell is manually edited.
                      </p>
                      {scenarioShrinkageCategories
                        .filter(
                          (category) =>
                            category.id.startsWith('custom_') &&
                            effectiveVisibleShrinkageCategoryIds.includes(category.id),
                        ).length === 0 ? (
                        <p className="saas-muted m-0 text-xs">
                          No shrinkage categories added yet. Use + on Out of office / In office in the matrix to add
                          categories.
                        </p>
                      ) : (
                        scenarioShrinkageCategories
                          .filter(
                            (category) =>
                              category.id.startsWith('custom_') &&
                              effectiveVisibleShrinkageCategoryIds.includes(category.id),
                          )
                          .map((category) => (
                            <label key={`shrink-driver-${category.id}`} className="saas-field">
                              <span className="saas-field__label">
                                {category.name} ({category.group === 'out_of_office' ? 'Out of office' : 'In office'})
                              </span>
                              <select
                                className="cap-field__input"
                                value={forecastModes[category.id] ?? shrinkageDriverDefaultMode(category.id)}
                                onChange={(event) =>
                                  setForecastModes((prev) => ({
                                    ...prev,
                                    [category.id]: event.target.value as CapacityForecastMode,
                                  }))
                                }
                                disabled={isCombinedView}
                              >
                                {driverModeOptions('totalShrinkagePct').map((mode) => (
                                  <option key={`${category.id}-${mode}`} value={mode}>
                                    {driverModeLabel(mode)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ))
                      )}
                    </div>
                  ) : null}
                </div>
                <div className="cap-capacity-sidebar__actions mt-3">
                  {forecastModesDirty ? (
                    <p className="saas-muted m-0 text-xs">
                      Driver changes are included when you click <strong>Save changes</strong>.
                    </p>
                  ) : (
                    <p className="saas-muted m-0 text-xs">Drivers apply to future planned weeks unless a cell is typed over.</p>
                  )}
                </div>
              </div>
              ) : null}
            </div>

            <div className="cap-capacity-sidecard">
              <div className="cap-capacity-sidecard__head">
                <div>
                  <p className="cap-capacity-sidecard__eyebrow">Create</p>
                  <h3 className="cap-capacity-sidecard__title">Add LOB</h3>
                </div>
                <button
                  type="button"
                  className={`cap-capacity-sidecard__toggle${sidebarPanelOpen.addLob ? ' is-active' : ' cap-capacity-sidecard__toggle--highlight'}`}
                  onClick={() => setSidebarPanelOpen((prev) => ({ ...prev, addLob: !prev.addLob }))}
                >
                  {sidebarPanelOpen.addLob ? 'Hide' : 'Show'}
                </button>
              </div>
              {sidebarPanelOpen.addLob ? (
              <div className="cap-capacity-sidebar__form">
                <p className="cap-panel__desc m-0">
                  Add another LOB under <strong>{linkedScenario.plan.client}</strong> using the guided setup wizard.
                  Week 1 drivers will carry forward across the planning horizon.
                </p>
                <button type="button" className="saas-btn mt-3" onClick={openAddLobWizard}>
                  Add LOB via setup wizard
                </button>
              </div>
              ) : null}
            </div>

            <div className="cap-capacity-sidecard">
              <div className="cap-capacity-sidecard__head">
                <div>
                  <p className="cap-capacity-sidecard__eyebrow">Pipeline</p>
                  <h3 className="cap-capacity-sidecard__title">Training settings</h3>
                </div>
                <button
                  type="button"
                  className={`cap-capacity-sidecard__toggle${sidebarPanelOpen.trainingSettings ? ' is-active' : ' cap-capacity-sidecard__toggle--highlight'}`}
                  onClick={() => setSidebarPanelOpen((prev) => ({ ...prev, trainingSettings: !prev.trainingSettings }))}
                >
                  {sidebarPanelOpen.trainingSettings ? 'Hide' : 'Show'}
                </button>
              </div>
              {sidebarPanelOpen.trainingSettings ? (
              <div className="cap-capacity-sidebar__form">
                <NumField
                  label="Training weeks"
                  value={linkedScenario.assumptions.newHire.trainingWeeks}
                  min={1}
                  step={1}
                  onChange={(value) => updatePipelineField('trainingWeeks', Math.max(1, Math.round(value)))}
                />
                <NumField
                  label="Nesting weeks"
                  value={linkedScenario.assumptions.newHire.nestingWeeks}
                  min={1}
                  step={1}
                  onChange={(value) => updatePipelineField('nestingWeeks', Math.max(1, Math.round(value)))}
                  help="Changing nesting weeks also resizes the Nesting week phone % ramp below."
                />
                <NumField
                  label="Training attrition %"
                  value={linkedScenario.assumptions.newHire.trainingAttritionRate}
                  min={0}
                  max={1}
                  step={0.1}
                  percent
                  onChange={(value) => updatePipelineField('trainingAttritionRate', value)}
                />
                <NumField
                  label="Nesting attrition %"
                  value={linkedScenario.assumptions.newHire.nestingAttritionRate}
                  min={0}
                  max={1}
                  step={0.1}
                  percent
                  onChange={(value) => updatePipelineField('nestingAttritionRate', value)}
                  help="Default nesting attrition used for weeks without a matrix override."
                />
                <NumField
                  label="Default phone time %"
                  value={linkedScenario.assumptions.newHire.nestingPhoneTimePct}
                  min={0}
                  max={1}
                  step={0.01}
                  percent
                  onChange={(value) => updatePipelineField('nestingPhoneTimePct', value)}
                />
                {Array.from({ length: Math.max(1, Math.round(linkedScenario.assumptions.newHire.nestingWeeks)) }, (_, index) => (
                  <NumField
                    key={`phone-ramp-${index}`}
                    label={`Nesting week ${index + 1} phone %`}
                    value={
                      (Array.isArray(linkedScenario.assumptions.newHire.nestingPhoneTimeRamp)
                        ? linkedScenario.assumptions.newHire.nestingPhoneTimeRamp[index]
                        : undefined) ?? linkedScenario.assumptions.newHire.nestingPhoneTimePct
                    }
                    min={0}
                    max={1}
                    step={0.01}
                    percent
                    onChange={(value) => updateNestingPhoneRamp(index, value)}
                  />
                ))}
              </div>
              ) : null}
            </div>
          </aside>
          ) : null}

          <section className="saas-card cap-capacity-main" aria-label="Capacity matrix">
            <div className="cap-ledger-toolbar cap-ledger-toolbar--capacity">
              <div>
                <h3 className="m-0 text-base font-bold text-slate-900">Capacity matrix</h3>
                {hasUnsavedMatrixEdits || invalidDraftCount > 0 ? (
                  <p className={`cap-capacity-saved-note m-0${hasUnsavedMatrixEdits ? ' cap-capacity-saved-note--dirty' : ''}`}>
                    {invalidDraftCount > 0
                      ? 'Highlighted cells need a valid number.'
                      : 'Unsaved edits — Save or Ctrl+S.'}
                  </p>
                ) : dataSavedAt || viewSavedAt ? (
                  <p className="cap-capacity-saved-note m-0">Saved</p>
                ) : null}
                {view !== 'weekly' ? (
                  <p className="cap-capacity-view-note m-0" role="status">
                    Switch to Weekly to edit cells.
                  </p>
                ) : null}
                {inputNotice ? (
                  <p className="cap-capacity-input-notice m-0" role="status">
                    {inputNotice}
                  </p>
                ) : null}
              </div>
              <div className="cap-capacity-main__actions">
                <button
                  type="button"
                  className="saas-btn saas-btn--secondary cap-capacity-main__toggle"
                  onClick={expandAllMetricGroups}
                  title="Expand all metric groups"
                >
                  Expand all
                </button>
                <button
                  type="button"
                  className="saas-btn saas-btn--secondary cap-capacity-main__toggle is-active"
                  onClick={collapseAllMetricGroups}
                  title="Collapse all metric groups"
                >
                  Collapse all
                </button>
                {hasPastOrActualWeeks || hasHistoricalWeeks ? (
                  <>
                    <button
                      type="button"
                      className={`saas-btn saas-btn--secondary cap-capacity-main__toggle${showPastWeeks ? ' is-active' : ''}`}
                      onClick={() => setShowPastWeeks((prev) => !prev)}
                    >
                      {showPastWeeks ? `Hide past (${VISIBLE_HISTORY_WEEKS} wks)` : `Show past (6 mo)`}
                    </button>
                    <button
                      type="button"
                      className={`saas-btn saas-btn--secondary cap-capacity-main__toggle${unlockHistorical ? ' is-active' : ''}`}
                      title={
                        unlockHistorical
                          ? 'Lock past weeks — planned and actual inputs return to normal edit rules'
                          : 'Unlock past / Actual weeks so all manual planned and actual fields can be edited'
                      }
                      onClick={() => {
                        setUnlockHistorical((prev) => {
                          const next = !prev
                          if (next) setShowPastWeeks(true)
                          return next
                        })
                      }}
                    >
                      {unlockHistorical ? 'Lock past weeks' : 'Unlock past weeks'}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className={`saas-btn saas-btn--secondary cap-capacity-main__toggle${showFutureWeeks ? ' is-active' : ''}`}
                  onClick={() => setShowFutureWeeks((prev) => !prev)}
                >
                  {showFutureWeeks
                    ? `Hide future weeks`
                    : `Show future weeks (${DEFAULT_VISIBLE_FUTURE_WEEKS})`}
                </button>
                {showFutureWeeks ? (
                  <button
                    type="button"
                    className={`saas-btn saas-btn--secondary cap-capacity-main__toggle${expandAllFutureWeeks ? ' is-active' : ''}`}
                    onClick={() => setExpandAllFutureWeeks((prev) => !prev)}
                  >
                    {expandAllFutureWeeks
                      ? `Show ${DEFAULT_VISIBLE_FUTURE_WEEKS} future weeks`
                      : `Expand all future (${MAX_FUTURE_WEEKS})`}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="saas-btn saas-btn--secondary cap-capacity-main__toggle"
                  onClick={() => setWeekPickerOpen((prev) => !prev)}
                >
                  {weekPickerOpen ? 'Close week picker' : 'Week picker'}
                </button>
                {optionalMetricCount > 0 ? (
                  <button
                    type="button"
                    className={`saas-btn saas-btn--secondary cap-capacity-main__toggle${showOptionalMetrics ? ' is-active' : ''}`}
                    title={
                      showOptionalMetrics
                        ? 'Hide metrics marked as hidden'
                        : 'Temporarily show metrics marked as hidden'
                    }
                    onClick={() => setShowOptionalMetrics((prev) => !prev)}
                  >
                    {showOptionalMetrics
                      ? `Hide hidden (${optionalMetricCount})`
                      : `Show hidden (${optionalMetricCount})`}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="saas-btn saas-btn--secondary cap-capacity-main__toggle"
                  title="Choose which metrics are visible"
                  onClick={() => openPlanSettings('metrics')}
                >
                  Metrics visibility
                </button>
              </div>
            </div>

            {weekPickerOpen ? (
              <div className="cap-week-picker">
                <div className="cap-week-picker__head">
                  <div>
                    <strong>Visible weeks</strong>
                    <p className="saas-muted m-0">
                      {importedDisplayWeeks?.length
                        ? 'Show or hide any week from the uploaded template without affecting calculations.'
                        : `Show or hide any of the ${MAX_FUTURE_WEEKS} planned weeks without affecting calculations.`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="saas-btn saas-btn--secondary"
                    onClick={showAllVisibleWeeks}
                  >
                    Show all
                  </button>
                </div>
                <div className="cap-week-picker__grid">
                  {pickerRows.map((row) => {
                    const isHidden = hiddenWeeks.includes(row.week)
                    return (
                      <button
                        key={`week-picker-${row.week}`}
                        type="button"
                        className={`cap-week-picker__item${isHidden ? ' cap-week-picker__item--hidden' : ''}`}
                        onClick={() =>
                          setHiddenWeeks((prev) =>
                            prev.includes(row.week) ? prev.filter((item) => item !== row.week) : [...prev, row.week],
                          )
                        }
                      >
                        <span>{row.week}</span>
                        <span className={statusClass(row.statusLabel)}>{isHidden ? 'Hidden' : row.statusLabel}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : null}

            <div className="cap-ledger-table-wrap cap-ledger-table-wrap--capacity" ref={matrixRef}>
            <table className="cap-ledger-matrix cap-ledger-matrix--single">
              <thead>
                <tr>
                  <th className="cap-ledger-matrix__metric">Metric</th>
                  {displayedRows.map((row) => (
                    <th
                      key={row.week}
                      className={weekHeaderClass(row.statusLabel)}
                      data-cap-week={row.week}
                      data-cap-planning-week={row.week === currentPlanningWeek ? 'true' : undefined}
                    >
                      <div className="cap-ledger-matrix__week-stack">
                        <span className="cap-ledger-matrix__week-label">{row.week}</span>
                        <span className={statusClass(row.statusLabel)}>{row.statusLabel}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(MATRIX_GROUP_ORDER.filter((groupId) => (orderedMatrixGroups[groupId]?.length ?? 0) > 0) as CapacityGroupId[]).map((groupId) => (
                  <Fragment key={groupId}>
                    <tr className={`cap-ledger-matrix__group-row cap-ledger-matrix__group-row--${groupId}`}>
                      <th colSpan={displayedRows.length + 1} className={`cap-ledger-matrix__group cap-ledger-matrix__group--${groupId}`}>
                        <button
                          type="button"
                          className={`cap-ledger-matrix__group-btn cap-ledger-matrix__group-btn--${groupId}${collapsed[groupId] ? '' : ' is-expanded'}`}
                          onClick={() => setCollapsed((prev) => ({ ...prev, [groupId]: !prev[groupId] }))}
                          aria-expanded={!collapsed[groupId]}
                        >
                          <span className="cap-ledger-matrix__group-chevron" aria-hidden>
                            {collapsed[groupId] ? '▸' : '▾'}
                          </span>
                          <span className="cap-ledger-matrix__group-accent" aria-hidden />
                          <span className="cap-ledger-matrix__group-label">{GROUP_LABELS[groupId]}</span>
                          <span className="cap-ledger-matrix__group-hint">
                            {collapsed[groupId] ? 'Expand' : 'Collapse'}
                          </span>
                        </button>
                      </th>
                    </tr>

                    {!collapsed[groupId] &&
                      orderedMatrixGroups[groupId].flatMap((metric) => {
                        const metricRow = (
                        <tr
                          key={`${groupId}-${metric.id}`}
                          className={`cap-ledger-matrix__data-row cap-ledger-matrix__data-row--group-${groupId} ${metric.editablePlanned || metric.editableActual ? 'cap-ledger-matrix__data-row--input' : 'cap-ledger-matrix__data-row--calculated'}${draggingMetric?.groupId === groupId && draggingMetric.metricId === metric.id ? ' cap-ledger-matrix__data-row--dragging' : ''}`}
                          draggable
                          onDragStart={() => setDraggingMetric({ groupId, metricId: metric.id })}
                          onDragEnd={() => setDraggingMetric(null)}
                          onDragOver={(event) => {
                            if (draggingMetric?.groupId === groupId && draggingMetric.metricId !== metric.id) {
                              event.preventDefault()
                            }
                          }}
                          onDrop={(event) => {
                            event.preventDefault()
                            if (!draggingMetric || draggingMetric.groupId !== groupId || draggingMetric.metricId === metric.id) return
                            const currentOrder = orderedMatrixGroups[groupId].map((item) => item.id)
                            const fromIndex = currentOrder.indexOf(draggingMetric.metricId)
                            const toIndex = currentOrder.indexOf(metric.id)
                            if (fromIndex < 0 || toIndex < 0) return
                            const nextOrder = [...currentOrder]
                            const [moved] = nextOrder.splice(fromIndex, 1)
                            nextOrder.splice(toIndex, 0, moved!)
                            setMetricOrders((prev) => ({ ...prev, [groupId]: nextOrder }))
                            setDraggingMetric(null)
                          }}
                        >
                          <th className="cap-ledger-matrix__metric-row">
                            <span className="cap-ledger-matrix__metric-label">
                              <span className="cap-ledger-matrix__drag-handle" aria-hidden>
                                ⋮⋮
                              </span>
                              <span className="cap-ledger-matrix__metric-title">
                                <span className="cap-ledger-matrix__metric-name">{metric.label}</span>
                                {metric.formula ? (
                                  <span className="cap-ledger-matrix__metric-help">
                                    <HelpTip text={metric.formula} variant="matrix" />
                                  </span>
                                ) : null}
                              </span>
                              {groupId === 'shrinkage' && metric.id === 'planned-ooo-shrinkage' && !isCombinedView ? (
                                <button
                                  type="button"
                                  className="cap-shrinkage-matrix-add"
                                  title="Add out of office shrinkage"
                                  onClick={() =>
                                    setMatrixShrinkageComposer({ group: 'out_of_office', name: '', billable: false })
                                  }
                                >
                                  +
                                </button>
                              ) : null}
                              {groupId === 'shrinkage' && metric.id === 'planned-inoffice-shrinkage' && !isCombinedView ? (
                                <button
                                  type="button"
                                  className="cap-shrinkage-matrix-add"
                                  title="Add in office shrinkage"
                                  onClick={() =>
                                    setMatrixShrinkageComposer({ group: 'in_office', name: '', billable: false })
                                  }
                                >
                                  +
                                </button>
                              ) : null}
                              {groupId === 'shrinkage' &&
                              metric.shrinkageCategoryId &&
                              metric.shrinkageEditKind === 'planned' &&
                              isCustomShrinkageCategoryId(metric.shrinkageCategoryId) ? (
                                <button
                                  type="button"
                                  className="cap-shrinkage-row-delete"
                                  title={`Delete ${metric.label}`}
                                  onClick={() => deleteMatrixShrinkageCategory(metric.shrinkageCategoryId!)}
                                >
                                  Delete
                                </button>
                              ) : null}
                            </span>
                          </th>
                          {displayedRows.map((row) => {
                            const value =
                              row.timeline === 'forward_plan' && metric.futureValue
                                ? metric.futureValue(row)
                                : metric.value(row)
                            const tone = (metric.tone ?? NEUTRAL_TONE)(value)
                            const isActualStatusWeek =
                              row.timeline === 'historical_actual' || row.statusLabel === 'Actual'
                            const isPastOrActualWeek =
                              isActualStatusWeek ||
                              (currentPlanningWeek != null && row.week < currentPlanningWeek)
                            // Unlock past weeks: open every manual Planned/Actual input on past or Actual columns.
                            const unlockedPast = unlockHistorical && isPastOrActualWeek
                            const actualEntryAllowed =
                              row.timeline === 'historical_actual' &&
                              (unlockHistorical ||
                                row.week === lastHistoricalWeek ||
                                row.week < (currentPlanningWeek ?? ''))
                            const editablePlanned =
                              !isCombinedView &&
                              view === 'weekly' &&
                              metric.editablePlanned &&
                              (Boolean(metric.plannedOverrideKey) || metric.shrinkageEditKind === 'planned') &&
                              (!metric.editablePlannedCurrentWeekOnly || row.week === currentPlanningWeek) &&
                              (row.timeline === 'forward_plan' || unlockedPast)
                            const editableActual =
                              !isCombinedView &&
                              view === 'weekly' &&
                              metric.editableActual &&
                              (Boolean(metric.actualOverrideKey) || metric.shrinkageEditKind === 'actual') &&
                              (unlockedPast ||
                                (metric.editableActualPlanningWeek && row.isCurrentPlanningWeek) ||
                                (metric.editableActualAllHistorical && isPastOrActualWeek) ||
                                (metric.shrinkageEditKind === 'actual' && isPastOrActualWeek) ||
                                actualEntryAllowed)
                            if (editablePlanned && metric.shrinkageEditKind === 'planned' && metric.shrinkageCategoryId) {
                              const categoryId = metric.shrinkageCategoryId
                              const draftId = cellDraftId('planned', row.week, `shrinkage:${categoryId}`)
                              const bound = bindMatrixInput('planned', row.week, `shrinkage:${categoryId}`)
                              const inputValue =
                                cellDrafts[draftId] ??
                                toInputString(getPlannedShrinkageCategoryValue(row.week, categoryId), { percent: true })
                              return (
                                <td
                                  key={`${row.week}-${metric.id}`}
                                  className={matrixCellClasses({
                                    tone,
                                    timeline: row.timeline,
                                    editable: true,
                                    editKind: 'planned',
                                    invalid: bound.invalid,
                                  })}
                                >
                                  <MatrixNumberInput
                                    value={inputValue}
                                    step={metric.step ?? 0.1}
                                    ariaLabel={`${metric.label} planned ${row.week}`}
                                    {...bound}
                                  />
                                </td>
                              )
                            }
                            if (editableActual && metric.shrinkageEditKind === 'actual' && metric.shrinkageCategoryId) {
                              const categoryId = metric.shrinkageCategoryId
                              const draftId = cellDraftId('actual', row.week, `shrinkage:${categoryId}`)
                              const bound = bindMatrixInput('actual', row.week, `shrinkage:${categoryId}`)
                              const inputValue =
                                cellDrafts[draftId] ??
                                toInputString(getActualShrinkageCategoryValue(row.week, categoryId), { percent: true })
                              return (
                                <td
                                  key={`${row.week}-${metric.id}`}
                                  className={matrixCellClasses({
                                    tone,
                                    timeline: row.timeline,
                                    editable: true,
                                    editKind: 'actual',
                                    invalid: bound.invalid,
                                  })}
                                >
                                  <MatrixNumberInput
                                    value={inputValue}
                                    step={metric.step ?? 0.1}
                                    ariaLabel={`${metric.label} actual ${row.week}`}
                                    {...bound}
                                  />
                                </td>
                              )
                            }
                            if (editablePlanned) {
                              const metricKey = metric.plannedOverrideKey!
                              const draftId = cellDraftId('planned', row.week, metricKey)
                              const bound = bindMatrixInput('planned', row.week, metricKey)
                              const driverMode = (
                                effectiveForecastModes as Partial<Record<string, string>>
                              )[String(metricKey)]
                              const showResolvedDriver =
                                row.timeline === 'forward_plan' &&
                                (driverMode === 'forecast' || driverMode === 'previous_week')
                              const baseValue = showResolvedDriver
                                ? (value ?? null)
                                : (plannedOverrides[row.week]?.[metricKey] ?? value ?? null)
                              const inputValue =
                                cellDrafts[draftId] ??
                                toInputString(baseValue, {
                                  percent: Boolean(metric.isPercentInput),
                                  whole: isWholeNumberMetric(metricKey),
                                })
                              return (
                                <td
                                  key={`${row.week}-${metric.id}`}
                                  className={matrixCellClasses({
                                    tone,
                                    timeline: row.timeline,
                                    editable: true,
                                    editKind: 'planned',
                                    invalid: bound.invalid,
                                  })}
                                >
                                  <MatrixNumberInput
                                    value={inputValue}
                                    step={metric.step ?? 1}
                                    ariaLabel={`${metric.label} planned ${row.week}`}
                                    {...bound}
                                  />
                                </td>
                              )
                            }
                            if (editableActual) {
                              const rawLedgerRow = ledgerByWeek.get(row.week)
                              const metricKey = metric.actualOverrideKey!
                              const bound = bindMatrixInput('actual', row.week, metricKey)
                              const sourceValue = (() => {
                                switch (metricKey) {
                                  case 'callVolume':
                                    return rawLedgerRow?.actual?.callVolume ?? null
                                  case 'ahtSeconds':
                                    return rawLedgerRow?.actual?.ahtSeconds ?? null
                                  case 'cappedAhtSeconds':
                                    return rawLedgerRow?.actual?.cappedAhtSeconds ?? null
                                  case 'occupancy':
                                    return rawLedgerRow?.actual?.occupancy ?? null
                                  case 'handledVolume':
                                    return rawLedgerRow?.actual?.handledVolume ?? null
                                  case 'totalShrinkagePct':
                                    return rawLedgerRow?.actual?.totalShrinkagePct ?? null
                                  case 'actualTrainingStartHc':
                                    return rawLedgerRow?.actual?.actualTrainingStartHc ?? row.planned.plannedNewHires
                                  default:
                                    return rawLedgerRow?.actual?.[metricKey] ?? value
                                }
                              })()
                              const draftId = cellDraftId('actual', row.week, metricKey)
                              const inputValue =
                                cellDrafts[draftId] ??
                                toInputString(sourceValue, {
                                  percent: Boolean(metric.isPercentInput),
                                  whole: isWholeNumberMetric(metricKey),
                                })
                              return (
                                <td
                                  key={`${row.week}-${metric.id}`}
                                  className={matrixCellClasses({
                                    tone,
                                    timeline: row.timeline,
                                    editable: true,
                                    editKind: 'actual',
                                    invalid: bound.invalid,
                                  })}
                                >
                                  <MatrixNumberInput
                                    value={inputValue}
                                    step={metric.step ?? 1}
                                    ariaLabel={`${metric.label} actual ${row.week}`}
                                    {...bound}
                                  />
                                </td>
                              )
                            }
                            return (
                              <td
                                key={`${row.week}-${metric.id}`}
                                className={matrixCellClasses({ tone, timeline: row.timeline, editable: false })}
                              >
                                {metric.format(value)}
                              </td>
                            )
                          })}
                        </tr>
                        )
                        const rows = [metricRow]
                        const showOooComposer =
                          groupId === 'shrinkage' &&
                          metric.id === 'planned-ooo-shrinkage' &&
                          matrixShrinkageComposer?.group === 'out_of_office'
                        const showInOfficeComposer =
                          groupId === 'shrinkage' &&
                          metric.id === 'planned-inoffice-shrinkage' &&
                          matrixShrinkageComposer?.group === 'in_office'
                        if (showOooComposer || showInOfficeComposer) {
                          const groupLabel = showOooComposer ? 'Out of office' : 'In office'
                          rows.push(
                            <tr key={`${groupId}-${metric.id}-composer`} className="cap-shrinkage-matrix-composer-row">
                              <td colSpan={displayedRows.length + 1}>
                                <div className="cap-shrinkage-matrix-composer">
                                  <input
                                    className="cap-field__input"
                                    placeholder={`${groupLabel} name / Aux #`}
                                    value={matrixShrinkageComposer?.name ?? ''}
                                    autoFocus
                                    onChange={(event) =>
                                      setMatrixShrinkageComposer((prev) =>
                                        prev ? { ...prev, name: event.target.value } : prev,
                                      )
                                    }
                                    onKeyDown={(event) => {
                                      if (event.key === 'Enter') addMatrixShrinkageCategory()
                                      if (event.key === 'Escape') setMatrixShrinkageComposer(null)
                                    }}
                                  />
                                  <label className="cap-shrinkage-billable-toggle">
                                    <span className="saas-muted text-xs">Billing</span>
                                    <select
                                      className="cap-field__input"
                                      value={matrixShrinkageComposer?.billable ? 'billable' : 'non_billable'}
                                      onChange={(event) =>
                                        setMatrixShrinkageComposer((prev) =>
                                          prev
                                            ? { ...prev, billable: event.target.value === 'billable' }
                                            : prev,
                                        )
                                      }
                                    >
                                      <option value="non_billable">Not Billable</option>
                                      <option value="billable">Billable</option>
                                    </select>
                                  </label>
                                  <button
                                    type="button"
                                    className="saas-btn"
                                    onClick={addMatrixShrinkageCategory}
                                    disabled={!matrixShrinkageComposer?.name.trim()}
                                  >
                                    Add
                                  </button>
                                  <button
                                    type="button"
                                    className="saas-btn saas-btn--secondary"
                                    onClick={() => setMatrixShrinkageComposer(null)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </td>
                            </tr>,
                          )
                        }
                        return rows
                      })}
                  </Fragment>
                ))}
              </tbody>
            </table>
            </div>
            <StickyHorizontalScrollbar
              targetRef={matrixRef}
              label="Scroll the capacity matrix horizontally"
            />
          </section>
        </div>
      </main>
    </div>
  )
}

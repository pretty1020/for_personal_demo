import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { HelpTip } from '../components/planner/HelpTip'
import { ModulePageHeader } from '../components/shell/ModulePageHeader'
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog'
import { usePlanner } from '../context/PlannerContext'
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard'
import {
  combineCapacityRows,
  deriveCapacityPlanRows,
  actualProductionHcForDisplay,
  actualSupportHcForDisplay,
  downloadFullCapacityPlanWorkbook,
  type CapacityMetricSnapshot,
  type DerivedCapacityRow,
} from '../planner/capacityPlanDerived'
import { getScenarioAhtOverrides } from '../planner/ahtAnalysisPersistence'
import {
  buildMatrixExportPayload,
  downloadCapacityMatrixExcel,
  downloadCapacityMatrixPdf,
} from '../planner/capacityMatrixExport'
import {
  getActualProductionHcFormulaText,
  getPlannedProductionHcFormulaText,
} from '../planner/formulaOverrides'
import { useDemoSession } from '../context/DemoSessionContext'
import { flushAllCapacityDocuments, flushCapacityDocuments } from '../data/capacityDocuments'
import {
  derivePortfolioForecast,
  derivePortfolioLedger,
  loadCapacityPortfolio,
  portfolioPlanOverrides,
  type PortfolioOwner,
} from '../data/capacityPortfolio'
import { flushStaffingPlanRequiredHcSync } from '../data/staffingPlanSync'
import { isManagerOrAbove } from '../utils/accessLevel'
import { triggerDownloadCsv } from '../utils/exportCsv'
import { DEFAULT_CAPACITY_MATRIX_COLLAPSED, DEFAULT_CAPACITY_MATRIX_LAYOUT, loadCapacityMatrixView, saveCapacityMatrixView } from '../planner/capacityViewPersistence'
import {
  isProductionFteUnlocked,
  setProductionFteUnlocked,
} from '../planner/capacityProductionFteUnlockPersistence'
import {
  isRequiredProductionFteUnlocked,
  setRequiredProductionFteUnlocked,
} from '../planner/capacityRequiredProductionFteUnlockPersistence'
import {
  capacityPeriodLabel,
  filterRowsByCapacityPeriod,
  loadCapacityPeriod,
  resolvePeriodWindowForWeeks,
  saveCapacityPeriod,
  uniqCapacityWeeks,
  type CapacityPeriodState,
} from '../planner/capacityPeriod'
import { buildCohortStageMaps } from '../planner/trainingPipelineHc'
import {
  resolveCapacityPlanStartWeek,
  resolveCapacityFiscalStartWeek,
  resolveCurrentCalendarWeek,
  resolvePlanHorizonWeeks,
  snapToWeekStart,
  uniqueSortedWeeks,
} from '../planner/capacityWeekUtils'
import { fmtNum, fmtPct } from '../planner/format'
import { computeRosterCapacityMetrics, rosterHeadcountOverrides } from '../planner/rosterMetrics'
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
import { CHANNEL_VOLUME_LABELS, type PlannerAssumptions, type PlannerScenario } from '../planner/types'
import { billableTypeLabel, isFteBillingPlan } from '../utils/staffingCapacity/billingModel'
import { normalizeProjectCode, resolvePlanLob, resolvePlanLocation, resolvePlanProjectCode } from '../planner/planIdentity'
import { parseCapacityPlanWorkbook } from '../planner/capacityWorkbookImport'
import {
  buildDerivedPrefillByWeek,
  buildDownloadActualOverrides,
  downloadStaffingManualInputTemplate,
  isManualInputWorkbook,
  parseStaffingManualInputWorkbook,
  type ManualInputImportMode,
} from '../planner/capacityManualInputTemplate'
import { type LedgerMetricSnapshot, type WeeklyLedgerRow } from '../planner/weeklyLedger'
import type { WeekCapacityPlanOverride } from '../planner/capacityPlanOverridePersistence'
import { buildShrinkageLookup, withPeriodAggregatedShrinkageLookup } from '../planner/capacityMatrixDisplay'
import {
  createCustomShrinkageCategory,
  DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS,
  isCustomShrinkageCategoryId,
  resolveActiveShrinkageCategoryIds,
  type ShrinkageCategoryTemplate,
} from '../planner/shrinkageCategories'
import { buildSupportRoleLookup, type SupportRoleLookup } from '../planner/supportRoleLookup'
import {
  createCustomSupportRole,
  DEFAULT_VISIBLE_SUPPORT_ROLE_IDS,
  isCustomSupportRoleId,
  resolveActiveSupportRoleIds,
  type SupportRoleTemplate,
} from '../planner/supportRoles'
import { CapacityMatrixCellInput } from '../components/planner/CapacityMatrixCellInput'
import { CapacityPeriodFilter } from '../components/planner/CapacityPeriodFilter'
import { StaffingCapacityChartsPanel } from '../components/staffing/StaffingCapacityChartsPanel'

type CapacityView = 'weekly' | 'monthly' | 'quarterly'
type CapacityGroupId =
  | 'headcount'
  | 'support'
  | 'staffing'
  | 'pipeline'
  | 'attrition'
  | 'volume'
  | 'shrinkage'
  | 'aht'
  | 'occupancy'
  | 'hours'
import {
  capacityStatusClass,
  capacityWeekCellClass,
  capacityWeekHeaderClass,
  DEFAULT_VISIBLE_FUTURE_WEEKS,
  resolveMaxFutureWeeks,
  VISIBLE_HISTORY_WEEKS,
  sliceCapacityWindow,
} from '../planner/capacityMatrixTheme'
const FORECAST_HORIZON_WEEKS = 52
const CAPACITY_FORECAST_MODE_METRICS = ['callVolume', 'ahtSeconds', 'occupancy', 'totalShrinkagePct', 'attritionHc'] as const
type CapacityForecastMetricId = (typeof CAPACITY_FORECAST_MODE_METRICS)[number]
import { capacityWorkspaceForecastModes, scenarioHasCapacitySignal } from '../planner/capacityLookup'
import {
  forecastModesEqual,
  loadScenarioForecastModes,
  saveScenarioForecastModes,
  type ScenarioForecastModes,
} from '../planner/capacityForecastModesPersistence'

const DEFAULT_CAPACITY_FORECAST_MODES: ScenarioForecastModes = {
  callVolume: 'manual',
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
const METRIC_HIDDEN_STORAGE_KEY = 'wfp-capacity-metric-hidden-v1'
const DEFAULT_HIDDEN_METRICS: Partial<Record<CapacityGroupId, string[]>> = {
  staffing: ['actual-required-production-fte'],
}

type MatrixRowDef = {
  id: string
  label: string
  value: (row: DerivedCapacityRow) => number | null
  futureValue?: (row: DerivedCapacityRow) => number | null
  format: (value: number | null | undefined) => string
  plannedOverrideKey?: keyof LedgerMetricSnapshot
  actualOverrideKey?: keyof LedgerMetricSnapshot
  editablePlanned?: boolean
  editableActual?: boolean
  editablePlannedCurrentWeekOnly?: boolean
  editableActualAllHistorical?: boolean
  editableActualPlanningWeek?: boolean
  shrinkageCategoryId?: string
  shrinkageEditKind?: 'planned' | 'actual'
  supportRoleId?: string
  supportEditKind?: 'planned' | 'actual'
  step?: number
  isPercentInput?: boolean
  formula?: string
  tone?: (value: number | null | undefined) => string
  /**
   * Colour the cell from the whole week rather than from its own number, for metrics
   * whose meaning depends on a second field — Actual AHT only reads as a leak next to
   * the Planned AHT it is being measured against. Takes precedence over `tone`.
   */
  rowTone?: (row: DerivedCapacityRow) => string
  /** When true, metric starts hidden until the user reveals it. */
  defaultHidden?: boolean
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

function loadHiddenMetricStore(): Partial<Record<CapacityGroupId, string[]>> {
  try {
    const raw = localStorage.getItem(METRIC_HIDDEN_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_HIDDEN_METRICS }
    const parsed = JSON.parse(raw) as Partial<Record<CapacityGroupId, string[]>>
    return parsed && typeof parsed === 'object' ? parsed : { ...DEFAULT_HIDDEN_METRICS }
  } catch {
    return { ...DEFAULT_HIDDEN_METRICS }
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
  hiddenStore: Partial<Record<CapacityGroupId, string[]>>,
): MatrixRowDef[] {
  const hidden = new Set(hiddenStore[groupId] ?? [])
  return metrics.filter((metric) => !hidden.has(metric.id))
}

const GROUP_LABELS: Record<CapacityGroupId, string> = {
  headcount: '1 · Headcount',
  support: '2 · Support & Seats',
  staffing: '3 · Staffing',
  pipeline: '4 · Training pipeline',
  attrition: '5 · Attrition',
  volume: '6 · Volume',
  shrinkage: '7 · Shrinkage',
  aht: '8 · AHT',
  occupancy: '9 · Occupancy',
  hours: '10 · Hours',
}

const NEUTRAL_TONE = () => 'neutral'

/**
 * Production FTE / Required Production FTE for the matrix.
 * Locked: shrunk FTE. Unlocked: Production Headcount with no shrinkage.
 *
 * Weekly pairing (per week column — not Client/LOB-wide):
 *   - Required shows whenever present (must survive refresh from staffing_plan)
 *   - Required = 0 or no data → Production FTE blank
 * Monthly / quarterly buckets show each side independently.
 */
function hasFiniteNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value)
}

/** Present for weekly FTE pairing: finite (zero is a valid persisted value). */
function isPresentFte(value: number | null | undefined): value is number {
  return hasFiniteNumber(value)
}

function rawProductionFte(row: DerivedCapacityRow, unlocked: boolean, side: 'actual' | 'planned'): number | null {
  if (unlocked) {
    if (side === 'actual' && row.statusLabel === 'Actual') {
      const actual = actualProductionHcForDisplay(row)
      return hasFiniteNumber(actual) ? actual : null
    }
    return hasFiniteNumber(row.planned.productionHc) ? row.planned.productionHc : null
  }
  if (side === 'actual') {
    return hasFiniteNumber(row.actual.productionFte) ? row.actual.productionFte : null
  }
  return hasFiniteNumber(row.planned.productionFte) ? row.planned.productionFte : null
}

function productionFteForMatrix(
  row: DerivedCapacityRow,
  unlocked: boolean,
  weeklyMutualBlank: boolean,
): number | null {
  const required = row.planned.requiredFte ?? row.actual.requiredFte
  const production = rawProductionFte(row, unlocked, 'actual')
  if (!weeklyMutualBlank) return production
  if (!isPresentFte(required) || !isPresentFte(production)) return null
  return production
}

function plannedProductionFteForMatrix(
  row: DerivedCapacityRow,
  unlocked: boolean,
  weeklyMutualBlank: boolean,
): number | null {
  const required = row.planned.requiredFte
  const production = rawProductionFte(row, unlocked, 'planned')
  if (!weeklyMutualBlank) return production
  if (!isPresentFte(required) || !isPresentFte(production)) return null
  return production
}

function requiredProductionFteForMatrix(
  row: DerivedCapacityRow,
  _unlocked: boolean,
  weeklyMutualBlank: boolean,
): number | null {
  const required = row.planned.requiredFte
  if (!weeklyMutualBlank) return hasFiniteNumber(required) ? required : null
  // Show persisted Required even when Production HC/FTE has not rolled forward yet.
  if (!isPresentFte(required)) return null
  return required
}

/** Actual AHT minus Planned AHT, in seconds. Null until both sides of the week exist. */
function ahtVarianceSeconds(row: DerivedCapacityRow): number | null {
  if (row.planned.ahtSeconds == null || row.actual.ahtSeconds == null) return null
  return row.actual.ahtSeconds - row.planned.ahtSeconds
}

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

function cellDraftId(kind: 'planned' | 'actual', week: string, metricId: string): string {
  return `${kind}:${week}:${metricId}`
}

function isPercentDraftMetric(metricId: string): boolean {
  if (metricId.startsWith('shrinkage:')) return true
  if (metricId.startsWith('support:')) return false
  return (
    metricId === 'occupancy' ||
    metricId === 'trainingAttritionPct' ||
    metricId === 'nestingAttritionPct' ||
    metricId.endsWith('Pct') ||
    metricId === 'totalShrinkagePct'
  )
}

function toInputString(
  value: number | null | undefined,
  options?: { percent?: boolean; whole?: boolean },
): string {
  if (value == null || !Number.isFinite(value)) return ''
  if (options?.percent) {
    const pct = value * 100
    return String(Math.round(pct * 1000) / 1000)
  }
  if (options?.whole) return String(Math.round(value))
  return String(Math.round(value * 1000) / 1000)
}

function isHeadcountMetric(metricId: keyof LedgerMetricSnapshot): boolean {
  return (
    metricId === 'plannedNewHires' ||
    metricId === 'actualTrainingStartHc' ||
    metricId === 'plannedSeats' ||
    metricId.endsWith('Hc')
  )
}

function isWholeNumberMetric(metricId: keyof LedgerMetricSnapshot): boolean {
  return isHeadcountMetric(metricId) || metricId === 'handledVolume' || metricId === 'callVolume'
}

function normalizeMetricInput(metricId: keyof LedgerMetricSnapshot, value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null
  if (metricId === 'occupancy') return Math.max(0, Math.min(0.999, value))
  if (metricId === 'totalShrinkagePct') return Math.max(0, Math.min(1.25, value))
  if (
    metricId === 'attritionPct' ||
    metricId === 'trainingAttritionPct' ||
    metricId === 'nestingAttritionPct'
  ) {
    return Math.max(0, Math.min(1, value))
  }
  if (isWholeNumberMetric(metricId)) return Math.round(value)
  if (metricId === 'plannedSeats') return Math.max(0, Math.round(value))
  if (metricId === 'peakRatio') return Math.max(0, value)
  return value
}

/** Merge unsaved matrix cell drafts into planned overrides so Required FTE recalculates while typing. */
function mergePlannedOverridesWithDrafts(
  plannedOverrides: Record<string, WeekCapacityPlanOverride>,
  cellDrafts: Record<string, string>,
): Record<string, WeekCapacityPlanOverride> {
  let merged: Record<string, WeekCapacityPlanOverride> | null = null
  for (const [draftId, draft] of Object.entries(cellDrafts)) {
    const match = /^planned:([^:]+):(.+)$/.exec(draftId)
    if (!match) continue
    const week = match[1]!
    const metricId = match[2]!
    if (metricId.startsWith('shrinkage:')) {
      const categoryId = metricId.replace('shrinkage:', '')
      const trimmed = draft.trim()
      const parsed = trimmed === '' ? null : Number(trimmed)
      const rawValue =
        parsed == null || Number.isNaN(parsed) ? null : parsed / 100
      const nextValue = rawValue == null ? null : Math.max(0, rawValue)
      if (!merged) merged = { ...plannedOverrides }
      const weekRow = { ...(merged[week] ?? plannedOverrides[week] ?? {}) }
      weekRow.shrinkageById = { ...(weekRow.shrinkageById ?? {}), [categoryId]: nextValue ?? 0 }
      merged[week] = weekRow
      continue
    }
    if (metricId.startsWith('support:')) {
      const roleId = metricId.replace('support:', '')
      const trimmed = draft.trim()
      const parsed = trimmed === '' ? null : Number(trimmed)
      const nextValue =
        parsed == null || Number.isNaN(parsed) ? null : Math.max(0, Math.round(parsed))
      if (!merged) merged = { ...plannedOverrides }
      const weekRow = { ...(merged[week] ?? plannedOverrides[week] ?? {}) }
      weekRow.supportHcByRole = { ...(weekRow.supportHcByRole ?? {}), [roleId]: nextValue ?? 0 }
      merged[week] = weekRow
      continue
    }
    const trimmed = draft.trim()
    const parsed = trimmed === '' ? null : Number(trimmed)
    const rawValue =
      parsed == null || Number.isNaN(parsed)
        ? null
        : isPercentDraftMetric(metricId)
          ? parsed / 100
          : parsed
    const nextValue = normalizeMetricInput(metricId as keyof LedgerMetricSnapshot, rawValue)
    if (!merged) merged = { ...plannedOverrides }
    merged[week] = {
      ...(merged[week] ?? plannedOverrides[week] ?? {}),
      [metricId]: nextValue,
    }
  }
  return merged ?? plannedOverrides
}

/** Apply unsaved Actual cell drafts onto ledger rows for live Required FTE / variance calcs. */
function mergeLedgerWithActualDrafts(
  ledger: WeeklyLedgerRow[],
  cellDrafts: Record<string, string>,
): WeeklyLedgerRow[] {
  const draftEntries = Object.entries(cellDrafts).filter(([id]) => id.startsWith('actual:'))
  if (!draftEntries.length) return ledger

  const byWeek = new Map<string, Partial<LedgerMetricSnapshot>>()
  for (const [draftId, draft] of draftEntries) {
    const match = /^actual:([^:]+):(.+)$/.exec(draftId)
    if (!match) continue
    const week = match[1]!
    const metricId = match[2]!
    if (metricId.startsWith('shrinkage:')) continue
    const trimmed = draft.trim()
    const parsed = trimmed === '' ? null : Number(trimmed)
    const rawValue =
      parsed == null || Number.isNaN(parsed)
        ? null
        : isPercentDraftMetric(metricId)
          ? parsed / 100
          : parsed
    const nextValue = normalizeMetricInput(metricId as keyof LedgerMetricSnapshot, rawValue)
    byWeek.set(week, { ...(byWeek.get(week) ?? {}), [metricId]: nextValue })
  }
  if (!byWeek.size) return ledger

  return ledger.map((row) => {
    const patch = byWeek.get(row.week)
    if (!patch || !row.actual) return row
    return {
      ...row,
      actual: {
        ...row.actual,
        ...patch,
      },
    }
  })
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
  supportLookup: SupportRoleLookup,
  actualStageAttritionLookup: ReturnType<typeof buildActualStageAttritionLookup>,
  trainingAttritionRate: number,
  nestingAttritionRate: number,
  visibleShrinkageCategoryIds: string[] = DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS,
  visibleSupportRoleIds: string[] = DEFAULT_VISIBLE_SUPPORT_ROLE_IDS,
  labels = channelDisplayLabels([]),
  chatConcurrency: number | null = null,
  fteBilling = false,
  shrinkageCategories: ShrinkageCategoryTemplate[] = [],
  supportRoles: SupportRoleTemplate[] = [],
  unlockProductionFte = false,
  unlockRequiredProductionFte = false,
): Record<CapacityGroupId, MatrixRowDef[]> {
  const weeklyMutualBlank = view === 'weekly'
  const manualRequired = fteBilling || unlockRequiredProductionFte
  const requiredFteFormula = manualRequired
    ? unlockRequiredProductionFte && !fteBilling
      ? 'Unlocked: enter Required Production FTE manually. Volume, AHT, and occupancy do not drive this value while unlocked. Lock to restore formula from Volume × AHT ÷ Occupancy.'
      : 'Enter Required Production FTE manually for FTE billing. Volume, AHT, and occupancy are for tracking only and do not drive this value.'
    : 'Required Production FTE (productive staffing, before shrinkage). Voice: (Volume × AHT) ÷ (3600 × Productive Hours × Occupancy). Chat / Per Transaction: also ÷ Concurrency. Email/Back Office: Adjusted Volume × AHT or Processing Time ÷ (Productive Seconds × Occupancy). Paid FTE = Required ÷ (1 − Shrinkage) is separate. Weekly view: Production FTE blanks when Required is 0 or missing for that week.'
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
        // Weekly: show Required whenever present; Production blanks without Required.
        value: (row) => requiredProductionFteForMatrix(row, unlockProductionFte, weeklyMutualBlank),
        futureValue: (row) => requiredProductionFteForMatrix(row, unlockProductionFte, weeklyMutualBlank),
        format: (value) => fmtNum(value, 2),
        formula: requiredFteFormula,
        ...(manualRequired
          ? {
              plannedOverrideKey: 'requiredFte' as const,
              editablePlanned: true,
              step: 0.01,
            }
          : {}),
      },
      {
        id: 'production-fte',
        label: unlockProductionFte ? 'Production FTE (= Production HC)' : 'Production FTE',
        value: (row) => productionFteForMatrix(row, unlockProductionFte, weeklyMutualBlank),
        futureValue: (row) => plannedProductionFteForMatrix(row, unlockProductionFte, weeklyMutualBlank),
        format: (value) => fmtNum(value, unlockProductionFte ? 0 : 1),
        formula: unlockProductionFte
          ? 'Unlocked for this Client/LOB: Production FTE equals Planned Production Headcount (no shrinkage). Lock to restore Production HC × (1 − Shrinkage %) + Nesting productive FTE. Weekly view: blank when Required is 0 or missing for that week.'
          : 'Production FTE = (Production HC × (1 − Shrinkage %)) + Nesting productive FTE. Unlock per Client/LOB to show Production Headcount with no shrinkage. Weekly view: blank when Required is 0 or missing for that week.',
      },
      {
        id: 'fte-variance',
        label: 'FTE variance',
        // Match the Production FTE / Required Production FTE rows above (actual vs planned by week).
        value: (row) => {
          const production = productionFteForMatrix(row, unlockProductionFte, weeklyMutualBlank)
          const required = requiredProductionFteForMatrix(row, unlockProductionFte, weeklyMutualBlank)
          return production != null && required != null ? production - required : null
        },
        futureValue: (row) => {
          const production = plannedProductionFteForMatrix(row, unlockProductionFte, weeklyMutualBlank)
          const required = requiredProductionFteForMatrix(row, unlockProductionFte, weeklyMutualBlank)
          return production != null && required != null ? production - required : null
        },
        format: (value) => fmtVarianceDelta(value, unlockProductionFte ? 0 : 1),
        formula: 'FTE variance = Production FTE − Required Production FTE (same values as the rows above).',
        tone: varianceToneHigherBetter,
      },
      {
        id: 'staffing-pct',
        label: 'Staffing (%)',
        value: (row) =>
          safeRatio(
            productionFteForMatrix(row, unlockProductionFte, weeklyMutualBlank),
            requiredProductionFteForMatrix(row, unlockProductionFte, weeklyMutualBlank),
          ),
        futureValue: (row) =>
          safeRatio(
            plannedProductionFteForMatrix(row, unlockProductionFte, weeklyMutualBlank),
            requiredProductionFteForMatrix(row, unlockProductionFte, weeklyMutualBlank),
          ),
        format: (value) => fmtPct(value),
        formula: 'Staffing % = Production FTE / Required Production FTE (same values as the rows above).',
        tone: staffingPctTone,
      },
      {
        id: 'actual-required-production-fte',
        label: 'Actual Required Production FTE',
        value: (row) => (row.statusLabel === 'Actual' ? row.actual.requiredFte : null),
        futureValue: () => null,
        format: (value) => fmtNum(value, 2),
        defaultHidden: true,
        formula:
          'Actual Required Production FTE uses Actual Volume/Chat, AHT/processing time, Occupancy, and concurrency when present. Hidden by default.',
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
        formula: getPlannedProductionHcFormulaText(),
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
        formula: getActualProductionHcFormulaText(),
      },
      {
        id: 'production-hc-variance',
        label: 'Production HC variance (Act − Req)',
        value: (row) => {
          if (row.statusLabel !== 'Actual') return null
          const actual = actualProductionHcForDisplay(row)
          const required = row.planned.productionHc
          if (actual == null) return null
          return actual - required
        },
        futureValue: () => null,
        format: (value) => fmtVarianceDelta(value, 0),
        formula: 'Production HC variance = Actual production HC − Planned (required) production HC.',
        tone: varianceToneHigherBetter,
      },
    ],
    support: [
      ...visibleSupportRoleIds.flatMap((roleId) => {
        const roleName = supportLookup.labels[roleId] ?? supportRoles.find((r) => r.id === roleId)?.name ?? roleId
        return [
          {
            id: `planned-support-${roleId}`,
            label: `Planned ${roleName} HC`,
            value: (row: DerivedCapacityRow) =>
              supportLookup.rowsByWeek.get(row.week)?.roles?.[roleId]?.planned ?? 0,
            format: (value: number | null | undefined) => fmtNum(value, 0),
            editablePlanned: true,
            supportRoleId: roleId,
            supportEditKind: 'planned' as const,
            step: 1,
          },
          {
            id: `actual-support-${roleId}`,
            label: `Actual ${roleName} HC`,
            value: (row: DerivedCapacityRow) =>
              supportLookup.rowsByWeek.get(row.week)?.roles?.[roleId]?.actual ?? null,
            futureValue: () => null,
            format: (value: number | null | undefined) => fmtNum(value, 0),
            editableActual: true,
            editableActualAllHistorical: true,
            supportRoleId: roleId,
            supportEditKind: 'actual' as const,
            step: 1,
          },
        ]
      }),
      {
        id: 'planned-total-support-hc',
        label: 'Planned total support HC',
        value: (row) => supportLookup.rowsByWeek.get(row.week)?.plannedTotal ?? row.planned.supportHc,
        format: (value) => fmtNum(value, 0),
        formula: 'Sum of planned support role headcounts.',
      },
      {
        id: 'actual-total-support-hc',
        label: 'Actual total support HC',
        value: (row) => supportLookup.rowsByWeek.get(row.week)?.actualTotal ?? actualSupportHcForDisplay(row),
        futureValue: () => null,
        format: (value) => fmtNum(value, 0),
        formula: 'Sum of actual support role headcounts on Actual weeks.',
      },
      {
        id: 'support-hc-variance',
        label: 'Support HC variance (Act − Req)',
        value: (row) => {
          if (row.statusLabel !== 'Actual') return null
          const lookup = supportLookup.rowsByWeek.get(row.week)
          const actual = lookup?.actualTotal ?? actualSupportHcForDisplay(row)
          const required = lookup?.plannedTotal ?? row.planned.supportHc
          if (actual == null) return null
          return actual - required
        },
        futureValue: () => null,
        format: (value) => fmtVarianceDelta(value, 0),
        formula: 'Support HC variance = Actual total support HC − Planned (required) total support HC.',
        tone: varianceToneHigherBetter,
      },
      {
        id: 'planned-seats',
        label: 'Planned seats',
        value: (row) => supportLookup.rowsByWeek.get(row.week)?.plannedSeats ?? row.planned.plannedSeats ?? 0,
        format: (value) => fmtNum(value, 0),
        plannedOverrideKey: 'plannedSeats',
        editablePlanned: true,
        step: 1,
        formula: 'Physical seat capacity planned for the site / LOB.',
      },
      {
        id: 'peak-ratio',
        label: 'Peak ratio',
        value: (row) => supportLookup.rowsByWeek.get(row.week)?.peakRatio ?? row.planned.peakRatio ?? null,
        format: (value) => (value == null ? '—' : fmtNum(value, 2)),
        plannedOverrideKey: 'peakRatio',
        editablePlanned: true,
        step: 0.01,
        formula: 'Peak ratio for seat planning (e.g. seats ÷ peak production HC).',
      },
      {
        id: 'seats-variance',
        label: 'Seats variance',
        value: (row) =>
          supportLookup.rowsByWeek.get(row.week)?.seatsVariance ?? row.planned.seatsVariance ?? null,
        format: (value) => fmtVarianceDelta(value, 0),
        formula:
          'Seats variance = Planned seats − (Planned production HC + Planned total support HC).',
        tone: varianceToneHigherBetter,
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
        formula: 'Nesting phone time % uses the per-nesting-week ramp from Training settings (one % for each nesting week).',
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
        value: (row) => safeRatio(row.actual.offeredVolume, row.planned.volume),
        futureValue: () => null,
        format: (value) => fmtPct(value),
        formula: 'Offered to Forecast % = Offered volume / Forecast volume.',
        tone: offeredToForecastTone,
      },
      {
        id: 'handled-volume-variance',
        label: 'Handled volume variance (Hnd - Off)',
        value: (row) =>
          row.actual.handledVolume != null ? row.actual.handledVolume - row.actual.offeredVolume : null,
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
          // Combined Client/LOB uses the averaged snapshot — never sum distinct category ids.
          if (row.combinedGroupShrinkage) {
            const ooo = row.combinedGroupShrinkage.outOfOfficePlanned
            const inn = row.combinedGroupShrinkage.inOfficePlanned
            if (ooo == null && inn == null) {
              return hasFiniteNumber(row.planned.shrinkagePct) ? row.planned.shrinkagePct : null
            }
            return (ooo ?? 0) + (inn ?? 0)
          }
          const lookup = shrinkageLookup.rowsByWeek.get(row.week)
          if (!lookup) {
            return hasFiniteNumber(row.planned.shrinkagePct) ? row.planned.shrinkagePct : null
          }
          const total = (lookup.outOfOfficePlanned ?? 0) + (lookup.inOfficePlanned ?? 0)
          return total > 0 || hasFiniteNumber(row.planned.shrinkagePct) ? total : null
        },
        format: (value) => fmtPct(value),
        formula:
          'Planned shrinkage = Planned out of office + Planned in office. Combined Client/LOB views use the AVERAGE across LOBs, not the sum.',
      },
      {
        id: 'actual-shrinkage',
        label: 'Actual shrinkage',
        value: (row) => {
          if (row.statusLabel !== 'Actual' && row.timeline !== 'historical_actual') return null
          if (row.combinedGroupShrinkage) {
            const ooo = row.combinedGroupShrinkage.outOfOfficeActual
            const inn = row.combinedGroupShrinkage.inOfficeActual
            if (ooo == null && inn == null) {
              return hasFiniteNumber(row.actual.shrinkagePct) ? row.actual.shrinkagePct : null
            }
            return (ooo ?? 0) + (inn ?? 0)
          }
          const lookup = shrinkageLookup.rowsByWeek.get(row.week)
          if (lookup && row.timeline === 'historical_actual') {
            return (lookup.outOfOfficeActual ?? 0) + (lookup.inOfficeActual ?? 0)
          }
          return hasFiniteNumber(row.actual.shrinkagePct) ? row.actual.shrinkagePct : null
        },
        futureValue: () => null,
        format: (value) => fmtPct(value),
        formula:
          'Actual shrinkage = Actual out of office + Actual in office. Combined Client/LOB views use the AVERAGE across LOBs.',
      },
      {
        id: 'planned-ooo-shrinkage',
        label: 'Planned out of office shrinkage',
        value: (row) => {
          if (row.combinedGroupShrinkage) return row.combinedGroupShrinkage.outOfOfficePlanned
          const value = shrinkageLookup.rowsByWeek.get(row.week)?.outOfOfficePlanned
          return hasFiniteNumber(value) ? value : null
        },
        format: (value) => fmtPct(value),
        formula: 'Sum of visible Out of office planned category percentages (AVERAGE across LOBs when combined).',
      },
      {
        id: 'actual-ooo-shrinkage',
        label: 'Actual out of office shrinkage',
        value: (row) => {
          if (row.statusLabel !== 'Actual' && row.timeline !== 'historical_actual') return null
          if (row.combinedGroupShrinkage) return row.combinedGroupShrinkage.outOfOfficeActual
          if (row.timeline !== 'historical_actual') return null
          const value = shrinkageLookup.rowsByWeek.get(row.week)?.outOfOfficeActual
          return hasFiniteNumber(value) ? value : null
        },
        futureValue: () => null,
        format: (value) => fmtPct(value),
        formula: 'Sum of visible Out of office actual category percentages (AVERAGE across LOBs when combined).',
      },
      {
        id: 'planned-inoffice-shrinkage',
        label: 'Planned in office shrinkage',
        value: (row) => {
          if (row.combinedGroupShrinkage) return row.combinedGroupShrinkage.inOfficePlanned
          const value = shrinkageLookup.rowsByWeek.get(row.week)?.inOfficePlanned
          return hasFiniteNumber(value) ? value : null
        },
        format: (value) => fmtPct(value),
        formula: 'Sum of visible In office planned category percentages (AVERAGE across LOBs when combined).',
      },
      {
        id: 'actual-inoffice-shrinkage',
        label: 'Actual in office shrinkage',
        value: (row) => {
          if (row.statusLabel !== 'Actual' && row.timeline !== 'historical_actual') return null
          if (row.combinedGroupShrinkage) return row.combinedGroupShrinkage.inOfficeActual
          if (row.timeline !== 'historical_actual') return null
          const value = shrinkageLookup.rowsByWeek.get(row.week)?.inOfficeActual
          return hasFiniteNumber(value) ? value : null
        },
        futureValue: () => null,
        format: (value) => fmtPct(value),
        formula: 'Sum of visible In office actual category percentages (AVERAGE across LOBs when combined).',
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
        // Handling above plan is the leak, so the week that caused it is flagged red at
        // the point of entry rather than only on the variance row below.
        rowTone: (row) => varianceToneLowerBetter(ahtVarianceSeconds(row)),
      },
      {
        id: 'aht-variance',
        label: 'AHT variance sec (Act - Pl)',
        value: (row) => ahtVarianceSeconds(row),
        futureValue: () => null,
        format: (value) => fmtVarianceDeltaSeconds(value),
        formula:
          'AHT variance = Actual AHT - Planned AHT. Positive is red: handling above plan is revenue leakage.',
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
        formula: 'Actual occupancy is capped at 100%. Unlock past to edit on past / Actual columns.',
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

function avgPresentMetric(values: Array<number | null | undefined>): number | null {
  const filtered = values.filter(
    (value): value is number => value != null && Number.isFinite(value) && value !== 0,
  )
  if (!filtered.length) return null
  return avg(filtered)
}

function aggregateSnapshot(rows: CapacityMetricSnapshot[]): CapacityMetricSnapshot {
  const first = rows[0]!
  const last = rows[rows.length - 1]!
  const requiredFte = avgPresentMetric(rows.map((row) => row.requiredFte))
  const productionFte = avgPresentMetric(rows.map((row) => row.productionFte)) ?? 0
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
    requiredFte,
    coreProductionFte: avg(rows.map((row) => row.coreProductionFte)),
    nestingProductiveFte: avg(rows.map((row) => row.nestingProductiveFte)),
    productionFte,
    staffingPct:
      requiredFte != null && requiredFte > 0 && productionFte > 0
        ? productionFte / requiredFte
        : avgNullable(rows.map((row) => row.staffingPct)),
    overUnderFte: avg(rows.map((row) => row.overUnderFte)),
    scheduledBillableHours: sumNullableHours(rows.map((row) => row.scheduledBillableHours)),
    actualBillableHours: sumNullableHours(rows.map((row) => row.actualBillableHours)),
    productiveHours: sumNullableHours(rows.map((row) => row.productiveHours)),
    payrollHours: sumNullableHours(rows.map((row) => row.payrollHours)),
    switchHours: sumNullableHours(rows.map((row) => row.switchHours)),
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
    const categoryIds = [
      ...new Set(bucket.flatMap((row) => (row.shrinkageCategories ?? []).map((item) => item.id))),
    ]
    const shrinkageCategories = categoryIds.map((id) => {
      const peers = bucket.flatMap((row) =>
        (row.shrinkageCategories ?? []).filter((item) => item.id === id),
      )
      const template = peers[0]!
      const plannedValues = peers.map((item) => item.plannedPct)
      const actualValues = peers
        .map((item) => item.actualPct)
        .filter((value): value is number => value != null && Number.isFinite(value))
      return {
        id,
        name: template.name,
        group: template.group,
        billable: template.billable,
        plannedPct: plannedValues.reduce((sum, value) => sum + value, 0) / Math.max(plannedValues.length, 1),
        actualPct: actualValues.length
          ? actualValues.reduce((sum, value) => sum + value, 0) / actualValues.length
          : null,
      }
    })
    return {
      ...first,
      week: label,
      statusLabel: bucket.every((row) => row.statusLabel === 'Actual') ? 'Actual' : 'Planned',
      timeline: bucket.every((row) => row.timeline === 'historical_actual') ? 'historical_actual' : 'forward_plan',
      planned: aggregateSnapshot(bucket.map((row) => row.planned)),
      actual: aggregateSnapshot(bucket.map((row) => row.actual)),
      shrinkageCategories: shrinkageCategories.length ? shrinkageCategories : first.shrinkageCategories,
      combinedGroupShrinkage: first.combinedGroupShrinkage
        ? {
            outOfOfficePlanned: avgNullable(
              bucket.map((row) => row.combinedGroupShrinkage?.outOfOfficePlanned ?? null),
            ),
            outOfOfficeActual: avgNullable(
              bucket.map((row) => row.combinedGroupShrinkage?.outOfOfficeActual ?? null),
            ),
            inOfficePlanned: avgNullable(
              bucket.map((row) => row.combinedGroupShrinkage?.inOfficePlanned ?? null),
            ),
            inOfficeActual: avgNullable(
              bucket.map((row) => row.combinedGroupShrinkage?.inOfficeActual ?? null),
            ),
          }
        : undefined,
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
}): string {
  const weekClass = capacityWeekCellClass(options.timeline)
  if (options.editable && options.editKind) {
    return `pva-ref-table__num pva-ref-table__num--${options.tone} cap-ledger-matrix__cell cap-ledger-matrix__cell--input cap-ledger-matrix__cell--${options.editKind} ${weekClass}`
  }
  return `pva-ref-table__num pva-ref-table__num--${options.tone} cap-ledger-matrix__cell cap-ledger-matrix__cell--locked cap-ledger-matrix__cell--calculated ${weekClass}`
}

export function AdvancedStaffingCapacityPlanPage({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { canViewPortfolioSummary, canEditCapacity, accessLevel, user } = useDemoSession()
  const seesEveryPlanner = isManagerOrAbove(accessLevel)
  const ownEmail = user?.email ?? ''
  const {
    activeScenario,
    capacityPlanView,
    importActualOverrides,
    replaceActualOverrides,
    getScenarioActualOverrides,
    getScenarioCapacityPlanOverrides,
    getScenarioForecast,
    getScenarioLedger,
    getScenarioRoster,
    getScenarioShrinkageCategories,
    getScenarioSupportRoles,
    scenarios,
    selectScenario,
    publishScenarioToCapacity,
    addScenarioShrinkageCategory,
    deleteScenarioShrinkageCategory,
    addScenarioSupportRole,
    deleteScenarioSupportRole,
    updateActualShrinkageCategory,
    updateActualSupportRoleHc,
    updateActualOverrideMetric,
    updatePlannedOverrideMetric,
    applyPlannedWeekOverrides,
    updateScenarioPlan,
    clearCapacityPlanData,
    getScenarioStageAttritionOverrides,
    updatePlannedShrinkageCategory,
    updatePlannedSupportRoleHc,
    resetToPreviousCapacityPlan,
    hasPreviousCapacityPlan,
  } = usePlanner()

  // Manager+ see every planner's client staffing plans (same portfolio as Summary).
  const [foreignOwners, setForeignOwners] = useState<PortfolioOwner[]>([])
  const [portfolioError, setPortfolioError] = useState('')
  const [portfolioLoading, setPortfolioLoading] = useState(seesEveryPlanner)
  useEffect(() => {
    if (!seesEveryPlanner) {
      setForeignOwners([])
      setPortfolioError('')
      setPortfolioLoading(false)
      return
    }
    let cancelled = false
    setPortfolioLoading(true)
    loadCapacityPortfolio(ownEmail)
      .then((owners) => {
        if (cancelled) return
        setForeignOwners(owners)
        setPortfolioError('')
        setPortfolioLoading(false)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('Could not load other planners’ staffing plans:', error)
        setForeignOwners([])
        setPortfolioError('Showing your plans only — other planners’ data could not be loaded.')
        setPortfolioLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [ownEmail, seesEveryPlanner])

  const foreignDerived = useMemo(() => {
    const derived = new Map<
      string,
      {
        scenario: PlannerScenario
        ownerName: string
        ledger: ReturnType<typeof derivePortfolioLedger>
        forecast: ReturnType<typeof derivePortfolioForecast>
        overrides: ReturnType<typeof portfolioPlanOverrides>
      }
    >()
    for (const owner of foreignOwners) {
      for (const scenario of owner.scenarios) {
        if (derived.has(scenario.id) || scenarios.some((own) => own.id === scenario.id)) continue
        if (scenario.isBaseline) continue
        const ledger = derivePortfolioLedger(owner, scenario)
        derived.set(scenario.id, {
          scenario,
          ownerName: owner.name,
          ledger,
          forecast: derivePortfolioForecast(owner, scenario, ledger, 52),
          overrides: portfolioPlanOverrides(owner, scenario),
        })
      }
    }
    return derived
  }, [foreignOwners, scenarios])

  const resolveLedger = useCallback(
    (scenarioId: string) => foreignDerived.get(scenarioId)?.ledger ?? getScenarioLedger(scenarioId),
    [foreignDerived, getScenarioLedger],
  )
  const resolveForecast = useCallback(
    (scenarioId: string, horizon = 52) =>
      foreignDerived.get(scenarioId)?.forecast ?? getScenarioForecast(scenarioId, horizon),
    [foreignDerived, getScenarioForecast],
  )
  const resolvePlanOverrides = useCallback(
    (scenarioId: string) =>
      foreignDerived.get(scenarioId)?.overrides ?? getScenarioCapacityPlanOverrides(scenarioId),
    [foreignDerived, getScenarioCapacityPlanOverrides],
  )
  const isForeignScenario = useCallback(
    (scenarioId: string | null | undefined) =>
      Boolean(scenarioId && foreignDerived.has(scenarioId)),
    [foreignDerived],
  )
  const foreignOwnerName = useCallback(
    (scenarioId: string) => foreignDerived.get(scenarioId)?.ownerName ?? '',
    [foreignDerived],
  )
  const [visibleShrinkageCategoryIds, setVisibleShrinkageCategoryIds] = useState<string[]>(DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS)
  const [visibleSupportRoleIds, setVisibleSupportRoleIds] = useState<string[]>(DEFAULT_VISIBLE_SUPPORT_ROLE_IDS)
  const [matrixSupportComposer, setMatrixSupportComposer] = useState<string | null>(null)
  const [matrixShrinkageComposer, setMatrixShrinkageComposer] = useState<{
    group: 'out_of_office' | 'in_office'
    name: string
    billable: boolean
  } | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false)
  const [view, setView] = useState<CapacityView>('monthly')
  const [period, setPeriod] = useState<CapacityPeriodState>(() => loadCapacityPeriod())
  const [scopeId, setScopeId] = useState(
    searchParams.get('scope') ??
      (capacityPlanView?.scenarioId ? `lob:${capacityPlanView.scenarioId}` : activeScenario?.id ? `lob:${activeScenario.id}` : ''),
  )
  const [collapsed, setCollapsed] = useState<Record<CapacityGroupId, boolean>>(() => ({
    ...(DEFAULT_CAPACITY_MATRIX_COLLAPSED as Record<CapacityGroupId, boolean>),
  }))
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [templateImportMode, setTemplateImportMode] = useState<ManualInputImportMode>('append')
  const [controlsOpen, setControlsOpen] = useState(DEFAULT_CAPACITY_MATRIX_LAYOUT.controlsOpen)
  const [sidebarPanelOpen, setSidebarPanelOpen] = useState(DEFAULT_CAPACITY_MATRIX_LAYOUT.sidebarPanelOpen)
  const [forecastInfoOpen, setForecastInfoOpen] = useState(DEFAULT_CAPACITY_MATRIX_LAYOUT.forecastInfoOpen)
  const [showFutureWeeks, setShowFutureWeeks] = useState(DEFAULT_CAPACITY_MATRIX_LAYOUT.showFutureWeeks)
  const [showPastWeeks, setShowPastWeeks] = useState(DEFAULT_CAPACITY_MATRIX_LAYOUT.showPastWeeks)
  const [expandAllFutureWeeks, setExpandAllFutureWeeks] = useState(
    DEFAULT_CAPACITY_MATRIX_LAYOUT.expandAllFutureWeeks,
  )
  const [weekPickerOpen, setWeekPickerOpen] = useState(false)
  const [weekPanelTab, setWeekPanelTab] = useState<'range' | 'pick'>('range')
  const [dateRangeStart, setDateRangeStart] = useState('')
  const [dateRangeEnd, setDateRangeEnd] = useState('')
  const [chartsOpen, setChartsOpen] = useState(false)
  const [unlockHistorical, setUnlockHistorical] = useState(false)
  const [unlockProductionFte, setUnlockProductionFte] = useState(false)
  const [unlockRequiredProductionFte, setUnlockRequiredProductionFte] = useState(false)
  const [locationFilter, setLocationFilter] = useState('')
  const [hiddenWeeks, setHiddenWeeks] = useState<string[]>([])
  const [cellDrafts, setCellDrafts] = useState<Record<string, string>>({})
  const [forecastModes, setForecastModes] = useState<ScenarioForecastModes>(() => resolveInitialForecastModes())
  const [savedForecastModes, setSavedForecastModes] = useState<ScenarioForecastModes>(() => resolveInitialForecastModes())
  const [metricOrders, setMetricOrders] = useState<Partial<Record<CapacityGroupId, string[]>>>(() => loadMetricOrderStore())
  const [hiddenMetrics, setHiddenMetrics] = useState<Partial<Record<CapacityGroupId, string[]>>>(() => loadHiddenMetricStore())
  const [draggingMetric, setDraggingMetric] = useState<{ groupId: CapacityGroupId; metricId: string } | null>(null)
  const matrixRef = useRef<HTMLDivElement | null>(null)
  const matrixScrolledRef = useRef(false)
  const viewHydratedRef = useRef(false)
  const [viewSavedAt, setViewSavedAt] = useState<string | null>(null)
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadError, setUploadError] = useState('')
  const portfolioScenarios = useMemo(() => {
    const own = scenarios.filter((scenario) => !scenario.isBaseline)
    const foreign = [...foreignDerived.values()].map((entry) => entry.scenario)
    return [...own, ...foreign]
  }, [foreignDerived, scenarios])

  useEffect(() => {
    const scope = searchParams.get('scope')
    if (scope) setScopeId(scope)
  }, [searchParams])

  useEffect(() => {
    const saved = loadCapacityMatrixView()
    const scopeFromUrl = searchParams.get('scope')
    if (!saved) {
      if (scopeFromUrl) setScopeId(scopeFromUrl)
      viewHydratedRef.current = true
      return
    }
    setScopeId(scopeFromUrl || saved.scopeId || (saved.scenarioId ? `lob:${saved.scenarioId}` : ''))
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
    setForecastInfoOpen(saved.forecastInfoOpen ?? DEFAULT_CAPACITY_MATRIX_LAYOUT.forecastInfoOpen)
    const savedShrinkageIds = saved.visibleShrinkageCategoryIds ?? []
    const customSaved = savedShrinkageIds.filter((id) => id.startsWith('custom_'))
    const defaultSaved = savedShrinkageIds.filter((id) =>
      DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS.includes(id),
    )
    // Older saves filtered out non-custom ids — re-seed Absenteeism + Vacation Leave.
    setVisibleShrinkageCategoryIds([
      ...(defaultSaved.length ? defaultSaved : [...DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS]),
      ...customSaved,
    ])
    setViewSavedAt(saved.savedAt)
    viewHydratedRef.current = true
    // Intentionally hydrate once on mount; URL scope is also watched separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    localStorage.setItem(METRIC_ORDER_STORAGE_KEY, JSON.stringify(metricOrders))
  }, [metricOrders])

  useEffect(() => {
    localStorage.setItem(METRIC_HIDDEN_STORAGE_KEY, JSON.stringify(hiddenMetrics))
  }, [hiddenMetrics])


  const resolvedScopeId = scopeId || (capacityPlanView?.scenarioId ? `lob:${capacityPlanView.scenarioId}` : activeScenario?.id ? `lob:${activeScenario.id}` : '')
  const isAllCombinedView = resolvedScopeId === 'combined-all' || resolvedScopeId.startsWith('combined-all:')
  const isProjectCombinedView = resolvedScopeId.startsWith('combined-project:')
  const isClientCombinedView =
    resolvedScopeId.startsWith('combined:') && !isProjectCombinedView && !isAllCombinedView
  const isCombinedView = isAllCombinedView || isProjectCombinedView || isClientCombinedView
  const selectedProjectCodeKey = isProjectCombinedView
    ? normalizeProjectCode(resolvedScopeId.slice('combined-project:'.length))
    : null
  const selectedClient = isClientCombinedView ? resolvedScopeId.slice('combined:'.length) : null
  const linkedScenario = isAllCombinedView
    ? portfolioScenarios[0] ?? activeScenario ?? null
    : isProjectCombinedView
      ? portfolioScenarios.find(
          (scenario) => normalizeProjectCode(resolvePlanProjectCode(scenario.plan)) === selectedProjectCodeKey,
        ) ??
        activeScenario ??
        null
      : isClientCombinedView
        ? portfolioScenarios.find((scenario) => scenario.plan.client === selectedClient) ?? activeScenario ?? null
        : portfolioScenarios.find((scenario) => `lob:${scenario.id}` === resolvedScopeId) ?? activeScenario ?? null

  // Per Client/LOB unlock — reload whenever the scope changes so mixed state is preserved.
  useEffect(() => {
    setUnlockProductionFte(resolvedScopeId ? isProductionFteUnlocked(resolvedScopeId) : false)
    setUnlockRequiredProductionFte(resolvedScopeId ? isRequiredProductionFteUnlocked(resolvedScopeId) : false)
  }, [resolvedScopeId])

  const scenarioHasCapacityData = useCallback(
    (scenario: (typeof portfolioScenarios)[number]) =>
      scenarioHasCapacitySignal(
        resolveLedger(scenario.id),
        resolvePlanOverrides(scenario.id),
      ),
    [resolveLedger, resolvePlanOverrides],
  )

  /** Peers for LOB dropdown + combined matrix (all plans, client LOBs, or shared project code). */
  const clientScenarios = useMemo(() => {
    if (!linkedScenario && !isAllCombinedView) return []
    let peers: typeof portfolioScenarios
    if (isAllCombinedView) peers = portfolioScenarios
    else if (isProjectCombinedView && selectedProjectCodeKey) {
      peers = portfolioScenarios.filter(
        (scenario) => normalizeProjectCode(resolvePlanProjectCode(scenario.plan)) === selectedProjectCodeKey,
      )
    } else if (!linkedScenario) peers = []
    else peers = portfolioScenarios.filter((scenario) => scenario.plan.client === linkedScenario.plan.client)

    if (locationFilter) {
      peers = peers.filter((scenario) => resolvePlanLocation(scenario.plan) === locationFilter)
    }
    return peers
  }, [
    isAllCombinedView,
    isProjectCombinedView,
    linkedScenario,
    locationFilter,
    portfolioScenarios,
    selectedProjectCodeKey,
  ])

  const locationOptions = useMemo(() => {
    const pool = isAllCombinedView
      ? portfolioScenarios
      : linkedScenario
        ? portfolioScenarios.filter((scenario) => scenario.plan.client === linkedScenario.plan.client)
        : []
    const locs = new Set<string>()
    for (const scenario of pool) {
      const loc = resolvePlanLocation(scenario.plan).trim()
      if (!loc) continue
      // Manager+ see every location with a staffing plan, even before volume is entered.
      if (!seesEveryPlanner && !scenarioHasCapacityData(scenario)) continue
      locs.add(loc)
    }
    return [...locs].sort((a, b) => a.localeCompare(b))
  }, [isAllCombinedView, linkedScenario, portfolioScenarios, scenarioHasCapacityData, seesEveryPlanner])

  useEffect(() => {
    if (locationFilter && !locationOptions.includes(locationFilter)) {
      setLocationFilter('')
    }
  }, [locationFilter, locationOptions])

  const lobFilterScenarios = useMemo(() => {
    const pool = isAllCombinedView ? portfolioScenarios : clientScenarios
    if (seesEveryPlanner) return pool
    return pool.filter((scenario) => scenarioHasCapacityData(scenario) || `lob:${scenario.id}` === resolvedScopeId)
  }, [
    clientScenarios,
    isAllCombinedView,
    portfolioScenarios,
    resolvedScopeId,
    scenarioHasCapacityData,
    seesEveryPlanner,
  ])

  const clientOptions = useMemo(() => {
    const clients = new Set<string>()
    for (const scenario of portfolioScenarios) {
      const client = scenario.plan.client.trim()
      if (!client) continue
      // Manager+ list every client staffing plan from every planner.
      if (
        !seesEveryPlanner &&
        !scenarioHasCapacityData(scenario) &&
        scenario.plan.client !== linkedScenario?.plan.client
      ) {
        continue
      }
      clients.add(client)
    }
    if (linkedScenario?.plan.client.trim()) clients.add(linkedScenario.plan.client.trim())
    return [...clients].sort((a, b) => a.localeCompare(b))
  }, [linkedScenario, portfolioScenarios, scenarioHasCapacityData, seesEveryPlanner])

  // Manager+ with no own plan: open Combined · All plans once portfolio arrives.
  useEffect(() => {
    if (!seesEveryPlanner || portfolioLoading) return
    if (portfolioScenarios.length === 0) return
    if (resolvedScopeId && portfolioScenarios.some((s) => `lob:${s.id}` === resolvedScopeId)) return
    if (resolvedScopeId === 'combined-all' || resolvedScopeId.startsWith('combined:')) return
    if (resolvedScopeId.startsWith('combined-project:')) return
    // Empty / baseline-only local scope — land on the full portfolio.
    if (!resolvedScopeId || !portfolioScenarios.some((s) => `lob:${s.id}` === resolvedScopeId)) {
      setScopeId('combined-all')
    }
  }, [portfolioLoading, portfolioScenarios, resolvedScopeId, seesEveryPlanner])
  const sharedProjectCodeOptions = useMemo(() => {
    const byCode = new Map<string, { label: string; count: number }>()
    for (const scenario of portfolioScenarios) {
      if (!seesEveryPlanner && !scenarioHasCapacityData(scenario)) continue
      const code = resolvePlanProjectCode(scenario.plan)
      if (!code) continue
      const key = normalizeProjectCode(code)
      const prev = byCode.get(key)
      byCode.set(key, { label: prev?.label ?? code, count: (prev?.count ?? 0) + 1 })
    }
    return [...byCode.entries()]
      .filter(([, item]) => item.count >= 2)
      .sort((a, b) => a[1].label.localeCompare(b[1].label))
      .map(([key, item]) => ({ key, label: item.label, count: item.count }))
  }, [portfolioScenarios, scenarioHasCapacityData, seesEveryPlanner])
  const combinedProjectCodeLabel =
    isProjectCombinedView && selectedProjectCodeKey
      ? sharedProjectCodeOptions.find((item) => item.key === selectedProjectCodeKey)?.label ||
        resolvePlanProjectCode(linkedScenario?.plan ?? { projectCode: selectedProjectCodeKey }) ||
        selectedProjectCodeKey
      : null
  const forecast = !isCombinedView && linkedScenario ? resolveForecast(linkedScenario.id, FORECAST_HORIZON_WEEKS) : null
  const plannedOverrides = !isCombinedView && linkedScenario ? resolvePlanOverrides(linkedScenario.id) : {}
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
    if (isAllCombinedView) {
      return combineLedgerRows(clientScenarios.map((scenario) => resolveLedger(scenario.id)))
    }
    if (!linkedScenario) return []
    if (!isCombinedView) return resolveLedger(linkedScenario.id)
    return combineLedgerRows(clientScenarios.map((scenario) => resolveLedger(scenario.id)))
  }, [clientScenarios, isAllCombinedView, isCombinedView, linkedScenario, resolveLedger])
  const effectiveLedger = useMemo(
    () => mergeLedgerWithActualDrafts(ledger, cellDrafts),
    [cellDrafts, ledger],
  )
  const planStartWeek = linkedScenario ? resolveCapacityPlanStartWeek(linkedScenario.plan) : null
  const currentPlanningWeek = linkedScenario
    ? resolveCurrentCalendarWeek(linkedScenario.plan.weekStart)
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
    () => (linkedScenario ? getScenarioShrinkageCategories(linkedScenario.id) : []),
    [getScenarioShrinkageCategories, linkedScenario],
  )
  const scenarioSupportRoles = useMemo(
    () => (linkedScenario ? getScenarioSupportRoles(linkedScenario.id) : []),
    [getScenarioSupportRoles, linkedScenario],
  )
  const effectiveVisibleShrinkageCategoryIds = useMemo(
    () =>
      resolveActiveShrinkageCategoryIds(
        visibleShrinkageCategoryIds,
        scenarioShrinkageCategories.map((item) => item.id),
        Object.values(effectivePlannedOverrides).flatMap((weekOverride) => Object.keys(weekOverride.shrinkageById ?? {})),
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
        unlockRequiredProductionFte,
      )
    }
    return combineCapacityRows(
      clientScenarios.map((scenario) =>
        deriveCapacityPlanRows(
          resolveLedger(scenario.id),
          scenario,
          resolveForecast(scenario.id, FORECAST_HORIZON_WEEKS),
          resolvePlanOverrides(scenario.id),
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
          isRequiredProductionFteUnlocked(`lob:${scenario.id}`),
        ),
      ),
    )
  }, [ahtOverrides, clientScenarios, currentPlanningWeek, effectiveLedger, effectiveVisibleShrinkageCategoryIds, forecast, effectiveForecastModes, effectivePlannedOverrides, forecastModes, getScenarioRoster, getScenarioStageAttritionOverrides, inactiveProductionRosterCount, isCombinedView, linkedScenario, resolveForecast, resolveLedger, resolvePlanOverrides, rosterPlanStartProductionHc, stageAttritionOverrides, unlockRequiredProductionFte])
  const rosterCapacityMetrics = useMemo(() => {
    if (!currentPlanningWeek) return null
    const capacityRow = derivedRows.find((row) => row.week === currentPlanningWeek) ?? null
    if (!isCombinedView && linkedScenario) {
      return computeRosterCapacityMetrics(getScenarioRoster(linkedScenario.id), currentPlanningWeek, capacityRow)
    }
    if (isCombinedView && clientScenarios.length) {
      const roster = clientScenarios.flatMap((scenario) => getScenarioRoster(scenario.id))
      return computeRosterCapacityMetrics(roster, currentPlanningWeek, capacityRow)
    }
    return null
  }, [clientScenarios, currentPlanningWeek, derivedRows, getScenarioRoster, isCombinedView, linkedScenario])
  const activeAgentCount = useMemo(() => {
    if (isAllCombinedView) {
      return clientScenarios.reduce(
        (sum, scenario) => sum + countActiveAgents(getScenarioRoster(scenario.id), scenario.plan.client),
        0,
      )
    }
    if (!linkedScenario) return 0
    const client = linkedScenario.plan.client
    if (!isCombinedView) return countActiveAgents(getScenarioRoster(linkedScenario.id), client)
    return countActiveAgents(clientScenarios.flatMap((scenario) => getScenarioRoster(scenario.id)), client)
  }, [clientScenarios, getScenarioRoster, isAllCombinedView, isCombinedView, linkedScenario])
  useEffect(() => {
    saveCapacityPeriod(period)
    // Align matrix column bucketing with period when useful.
    if (period.mode === 'month') setView('monthly')
    else if (period.mode === 'quarter') setView('quarterly')
    else setView('weekly')
  }, [period])

  const planHorizonAnchor =
    currentPlanningWeek ??
    planStartWeek ??
    resolveCapacityFiscalStartWeek(linkedScenario?.plan.weekStart ?? 'sunday')
  const visibleFutureWeekCount = expandAllFutureWeeks
    ? resolveMaxFutureWeeks(planHorizonAnchor, linkedScenario?.plan.weekStart ?? 'sunday')
    : DEFAULT_VISIBLE_FUTURE_WEEKS
  const maxFutureWeeks = resolveMaxFutureWeeks(
    planHorizonAnchor,
    linkedScenario?.plan.weekStart ?? 'sunday',
  )
  const periodWeeks = useMemo(() => uniqCapacityWeeks(derivedRows), [derivedRows])
  const periodWindow = useMemo(
    () => resolvePeriodWindowForWeeks(periodWeeks, period),
    [period, periodWeeks],
  )
  const visibleRows = useMemo(() => {
    const windowed = periodWindow.active
      ? filterRowsByCapacityPeriod(derivedRows, period)
      : sliceCapacityWindow(derivedRows, {
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
    period,
    periodWindow.active,
    showFutureWeeks,
    showPastWeeks,
    view,
    visibleFutureWeekCount,
  ])
  const ledgerByWeek = useMemo(() => new Map(ledger.map((row) => [row.week, row])), [ledger])
  const windowedLedgerRows = useMemo(() => {
    return periodWindow.active
      ? filterRowsByCapacityPeriod(ledger, period)
      : sliceCapacityWindow(ledger, {
          planningWeek: currentPlanningWeek,
          showFuture: showFutureWeeks,
          showPast: showPastWeeks,
          pastWeeks: VISIBLE_HISTORY_WEEKS,
          futureWeeks: visibleFutureWeekCount,
          importedWeeks: importedDisplayWeeks?.length ? importedDisplayWeeks : undefined,
        })
  }, [
    currentPlanningWeek,
    importedDisplayWeeks,
    ledger,
    period,
    periodWindow.active,
    showFutureWeeks,
    showPastWeeks,
    visibleFutureWeekCount,
  ])
  const displayedRows = useMemo(() => {
    let rows = visibleRows.filter((row) => !hiddenWeeks.includes(row.week))
    if (dateRangeStart || dateRangeEnd) {
      rows = rows.filter((row) => {
        if (dateRangeStart && row.week < dateRangeStart) return false
        if (dateRangeEnd && row.week > dateRangeEnd) return false
        return true
      })
    }
    return rows
  }, [dateRangeEnd, dateRangeStart, hiddenWeeks, visibleRows])

  const dateRangeActive = Boolean(dateRangeStart || dateRangeEnd)

  function clearDateRange() {
    setDateRangeStart('')
    setDateRangeEnd('')
  }

  function applyDateRangeToVisibleWindow() {
    const weeks = derivedRows.map((row) => row.week).sort((a, b) => a.localeCompare(b))
    if (!weeks.length) return
    setDateRangeStart(weeks[0]!)
    setDateRangeEnd(weeks[weeks.length - 1]!)
    setWeekPanelTab('range')
    setWeekPickerOpen(true)
  }
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
    return derivedRows
  }, [derivedRows, importedDisplayWeeks])
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
  const shrinkageLookup = useMemo(() => {
    // Always resolve from ISO weeks + effective overrides (includes unsaved drafts) first, then
    // roll up to monthly/quarterly labels. Summarized ledger rows use labels like "Aug 26"
    // which cannot read weekly overrides.
    const weekly = buildShrinkageLookup(
      windowedLedgerRows,
      forecast,
      effectiveForecastModes,
      effectiveVisibleShrinkageCategoryIds,
      effectivePlannedOverrides,
    )
    return withPeriodAggregatedShrinkageLookup(
      weekly,
      windowedLedgerRows.map((row) => row.week),
      view,
    )
  }, [
    effectiveForecastModes,
    effectivePlannedOverrides,
    effectiveVisibleShrinkageCategoryIds,
    forecast,
    view,
    windowedLedgerRows,
  ])
  const supportLookup = useMemo(
    () => buildSupportRoleLookup(derivedRows, scenarioSupportRoles, effectivePlannedOverrides),
    [derivedRows, scenarioSupportRoles, effectivePlannedOverrides],
  )
  const addMatrixSupportRole = useCallback(() => {
    if (!linkedScenario || !matrixSupportComposer) return
    const name = matrixSupportComposer.trim()
    if (!name) return
    const created = createCustomSupportRole(name)
    addScenarioSupportRole(linkedScenario.id, created)
    setVisibleSupportRoleIds((prev) => (prev.includes(created.id) ? prev : [...prev, created.id]))
    setMatrixSupportComposer(null)
  }, [addScenarioSupportRole, linkedScenario, matrixSupportComposer])
  const deleteMatrixSupportRole = useCallback(
    (roleId: string) => {
      if (!linkedScenario || !isCustomSupportRoleId(roleId)) return
      deleteScenarioSupportRole(linkedScenario.id, roleId)
      setVisibleSupportRoleIds((prev) => prev.filter((id) => id !== roleId))
    },
    [deleteScenarioSupportRole, linkedScenario],
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
      effectivePlannedOverrides[week]?.shrinkageById?.[categoryId] ??
      shrinkageLookup.rowsByWeek.get(week)?.categories?.[categoryId]?.planned ??
      null,
    [effectivePlannedOverrides, shrinkageLookup],
  )
  const getActualShrinkageCategoryValue = useCallback(
    (week: string, categoryId: string) =>
      ledgerByWeek.get(week)?.shrinkage.find((item) => item.id === categoryId)?.actualPct ??
      shrinkageLookup.rowsByWeek.get(week)?.categories?.[categoryId]?.actual ??
      null,
    [ledgerByWeek, shrinkageLookup],
  )
  useEffect(() => {
    const overrideIds = Object.values(plannedOverrides).flatMap((week) =>
      Object.keys(week.supportHcByRole ?? {}),
    )
    setVisibleSupportRoleIds((prev) => {
      const next = resolveActiveSupportRoleIds(
        prev,
        scenarioSupportRoles.map((item) => item.id),
        overrideIds,
      )
      return next.length === prev.length && next.every((id, index) => id === prev[index]) ? prev : next
    })
  }, [plannedOverrides, scenarioSupportRoles])
  useEffect(() => {
    const categoryIds = new Set([
      ...DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS,
      ...ledger.flatMap((row) => row.shrinkage.map((item) => item.id)),
      ...scenarioShrinkageCategories.map((item) => item.id),
    ])
    const overrideIds = Object.values(plannedOverrides).flatMap((week) => Object.keys(week.shrinkageById ?? {}))
    setVisibleShrinkageCategoryIds((prev) => {
      const seeded =
        prev.length === 0
          ? [...DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS]
          : prev.includes('absenteeism') || prev.includes('vacation_leave')
            ? prev
            : [...DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS, ...prev]
      const next = resolveActiveShrinkageCategoryIds(
        seeded,
        scenarioShrinkageCategories.map((item) => item.id),
        overrideIds,
      ).filter((id) => categoryIds.has(id) || overrideIds.includes(id))
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
  const forecastInfoItems = useMemo(() => {
    if (isCombinedView) return []
    const resolveDriverMethod = (metricId: CapacityForecastMetricId, modelLabel: string | undefined) => {
      const mode = forecastModes[metricId]
      if (mode === 'previous_week') return 'Use previous week'
      if (mode === 'manual') return 'Manual / baseline'
      return modelLabel ?? 'Manual / no model'
    }
    const categories = scenarioShrinkageCategories.filter((category) =>
      effectiveVisibleShrinkageCategoryIds.includes(category.id),
    )
    return [
      {
        label: capacityLabels.forecastVolume,
        method: resolveDriverMethod('callVolume', forecast?.metrics.find((metric) => metric.metricId === 'callVolume')?.selectedModel?.label),
      },
      {
        label: capacityLabels.aht,
        method: resolveDriverMethod('ahtSeconds', forecast?.metrics.find((metric) => metric.metricId === 'ahtSeconds')?.selectedModel?.label),
      },
      {
        label: capacityLabels.occupancy,
        method: resolveDriverMethod('occupancy', forecast?.metrics.find((metric) => metric.metricId === 'occupancy')?.selectedModel?.label),
      },
      {
        label: 'Total Shrinkage',
        method: resolveDriverMethod(
          'totalShrinkagePct',
          forecast?.metrics.find((metric) => metric.metricId === 'totalShrinkagePct')?.selectedModel?.label,
        ),
      },
      {
        label: 'Planned Attrition %',
        method: resolveDriverMethod('attritionHc', forecast?.metrics.find((metric) => metric.metricId === 'attritionHc')?.selectedModel?.label),
      },
      ...categories.map((category) => ({
        label: category.name,
        method:
          forecastModes[category.id] === 'previous_week'
            ? 'Use previous week'
            : forecastModes[category.id] === 'forecast'
              ? forecast?.metrics.find((metric) => metric.metricId === category.id)?.selectedModel?.label ?? 'Manual / no model'
              : 'Manual / baseline',
      })),
    ]
  }, [
    capacityLabels.aht,
    capacityLabels.forecastVolume,
    capacityLabels.occupancy,
    effectiveVisibleShrinkageCategoryIds,
    forecast,
    forecastModes,
    isCombinedView,
    scenarioShrinkageCategories,
  ])
  const matrixGroups = useMemo(() => {
    return capacityGroups(
      view,
      stageWeekMaps,
      shrinkageLookup,
      supportLookup,
      actualStageAttritionLookup,
      trainingAttritionRate,
      nestingAttritionRate,
      effectiveVisibleShrinkageCategoryIds,
      visibleSupportRoleIds,
      capacityLabels,
      chatConcurrencyValue,
      linkedScenario ? isFteBillingPlan(linkedScenario.plan.billingType) : false,
      scenarioShrinkageCategories,
      scenarioSupportRoles,
      unlockProductionFte,
      unlockRequiredProductionFte,
    )
  }, [
      view,
      stageWeekMaps,
      shrinkageLookup,
      supportLookup,
      actualStageAttritionLookup,
      nestingAttritionRate,
      trainingAttritionRate,
      effectiveVisibleShrinkageCategoryIds,
      visibleSupportRoleIds,
      capacityLabels,
      chatConcurrencyValue,
      linkedScenario,
      scenarioShrinkageCategories,
      scenarioSupportRoles,
      unlockProductionFte,
      unlockRequiredProductionFte,
    ])
  const orderedMatrixGroups = useMemo(
    () =>
      Object.fromEntries(
        (Object.keys(matrixGroups) as CapacityGroupId[])
          .filter((groupId) => matrixGroups[groupId].length > 0)
          .map((groupId) => [
            groupId,
            filterVisibleMetrics(
              groupId,
              orderMetrics(groupId, matrixGroups[groupId], metricOrders),
              hiddenMetrics,
            ),
          ]),
      ) as Record<CapacityGroupId, MatrixRowDef[]>,
    [hiddenMetrics, matrixGroups, metricOrders],
  )

  const hiddenMetricCount = useMemo(
    () =>
      (Object.keys(matrixGroups) as CapacityGroupId[]).reduce((count, groupId) => {
        const hidden = new Set(hiddenMetrics[groupId] ?? [])
        return count + matrixGroups[groupId].filter((metric) => hidden.has(metric.id)).length
      }, 0),
    [hiddenMetrics, matrixGroups],
  )

  const revealHiddenMetrics = useCallback(() => {
    setHiddenMetrics({})
  }, [])

  const hideDefaultHiddenMetrics = useCallback(() => {
    setHiddenMetrics({ ...DEFAULT_HIDDEN_METRICS })
  }, [])

  const persistMatrixView = useCallback(() => {
    if (!linkedScenario || !viewHydratedRef.current) return
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
      forecastInfoOpen,
      savedAt,
    })
    setViewSavedAt(savedAt)
  }, [
    collapsed,
    controlsOpen,
    expandAllFutureWeeks,
    forecastInfoOpen,
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

  const forecastModesDirty = !forecastModesEqual(forecastModes, savedForecastModes)

  const materializePlannedAttritionPct = useCallback(() => {
    if (!linkedScenario || isCombinedView) return
    const patches: Record<string, WeekCapacityPlanOverride> = {}
    for (const row of derivedRows) {
      if (row.timeline !== 'forward_plan') continue
      // Do not overwrite values already saved or currently being edited.
      if (plannedOverrides[row.week]?.attritionPct != null) continue
      if (cellDrafts[cellDraftId('planned', row.week, 'attritionPct')] != null) continue
      const pct = row.planned.attritionPct
      if (pct == null || !Number.isFinite(pct)) continue
      patches[row.week] = { attritionPct: pct }
    }
    if (Object.keys(patches).length) {
      applyPlannedWeekOverrides(linkedScenario.id, patches, 'append')
    }
  }, [
    applyPlannedWeekOverrides,
    cellDrafts,
    derivedRows,
    isCombinedView,
    linkedScenario,
    plannedOverrides,
  ])

  /** Snapshot computed Required Production FTE into overrides + MariaDB staffing_plan.required_production_fte. */
  const materializePlannedRequiredFte = useCallback(() => {
    if (!linkedScenario || isCombinedView) return
    // Unlocked / FTE billing: user-entered Required must not be overwritten by formula.
    if (
      unlockRequiredProductionFte ||
      isFteBillingPlan(linkedScenario.plan.billingType)
    ) {
      return
    }
    const patches: Record<string, WeekCapacityPlanOverride> = {}
    for (const row of derivedRows) {
      if (row.timeline !== 'forward_plan') continue
      if (cellDrafts[cellDraftId('planned', row.week, 'requiredFte')] != null) continue
      const value = row.planned.requiredFte
      if (value == null || !Number.isFinite(value) || value < 0) continue
      const existing = plannedOverrides[row.week]?.requiredFte
      if (existing != null && Number.isFinite(existing) && existing === value) continue
      patches[row.week] = { requiredFte: value }
    }
    if (Object.keys(patches).length) {
      applyPlannedWeekOverrides(linkedScenario.id, patches, 'append')
    }
  }, [
    applyPlannedWeekOverrides,
    cellDrafts,
    derivedRows,
    isCombinedView,
    linkedScenario,
    plannedOverrides,
    unlockRequiredProductionFte,
  ])

  /** Snapshot computed Production FTE into overrides + MariaDB staffing_plan.production_fte. */
  const materializePlannedProductionFte = useCallback(() => {
    if (!linkedScenario || isCombinedView) return
    const patches: Record<string, WeekCapacityPlanOverride> = {}
    for (const row of derivedRows) {
      if (row.timeline !== 'forward_plan') continue
      if (cellDrafts[cellDraftId('planned', row.week, 'productionFte')] != null) continue
      const value = row.planned.productionFte
      if (value == null || !Number.isFinite(value) || value <= 0) continue
      const existing = plannedOverrides[row.week]?.productionFte
      if (existing != null && Number.isFinite(existing) && existing === value) continue
      patches[row.week] = { productionFte: value }
    }
    if (Object.keys(patches).length) {
      applyPlannedWeekOverrides(linkedScenario.id, patches, 'append')
    }
  }, [
    applyPlannedWeekOverrides,
    cellDrafts,
    derivedRows,
    isCombinedView,
    linkedScenario,
    plannedOverrides,
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

  useEffect(() => {
    if (!viewHydratedRef.current) return
    const timer = window.setTimeout(() => persistMatrixView(), 500)
    return () => window.clearTimeout(timer)
  }, [persistMatrixView])

  const exportMatrixExcel = () => {
    if (!linkedScenario) return
    const groups = Object.fromEntries(
      (Object.keys(orderedMatrixGroups) as CapacityGroupId[])
        .filter((groupId) => !collapsed[groupId])
        .map((groupId) => [
          groupId,
          {
            label: GROUP_LABELS[groupId],
            metrics: orderedMatrixGroups[groupId].map((metric) => ({
              label: metric.label,
              values: displayedRows.map((row) => {
                const value =
                  row.timeline === 'forward_plan' && metric.futureValue ? metric.futureValue(row) : metric.value(row)
                return metric.format(value)
              }),
            })),
          },
        ]),
    )
    const payload = buildMatrixExportPayload(
      `${linkedScenario.plan.client}_${linkedScenario.plan.location}_Capacity`,
      isCombinedView
        ? isProjectCombinedView
          ? 'Combined project-code view'
          : 'Combined client view'
        : `${billableTypeLabel(linkedScenario.plan.billingType)} · ${view} view`,
      displayedRows,
      groups,
    )
    downloadCapacityMatrixExcel(payload)
    persistMatrixView()
  }

  const exportMatrixPdf = () => {
    if (!matrixRef.current || !linkedScenario) return
    const filename = `${linkedScenario.plan.client}_${linkedScenario.plan.location}_capacity_matrix`
    downloadCapacityMatrixPdf(matrixRef.current, filename)
    persistMatrixView()
  }

  const exportMatrixCsv = () => {
    if (!linkedScenario) return
    const weekLabels = displayedRows.map((row) => row.week)
    const header = ['Category', 'Metric', ...weekLabels]
    const lines = [header.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')]
    ;(Object.keys(orderedMatrixGroups) as CapacityGroupId[])
      .filter((groupId) => !collapsed[groupId])
      .forEach((groupId) => {
        orderedMatrixGroups[groupId].forEach((metric) => {
          lines.push(
            [
              GROUP_LABELS[groupId],
              metric.label,
              ...displayedRows.map((row) => {
                const value =
                  row.timeline === 'forward_plan' && metric.futureValue ? metric.futureValue(row) : metric.value(row)
                return metric.format(value)
              }),
            ]
              .map((value) => `"${String(value).replaceAll('"', '""')}"`)
              .join(','),
          )
        })
      })
    triggerDownloadCsv(
      lines.join('\r\n'),
      `${linkedScenario.plan.client}_${linkedScenario.plan.location}_capacity_matrix`,
    )
    persistMatrixView()
  }

  const handleConfirmDeleteCapacityPlan = useCallback(() => {
    if (!linkedScenario || isCombinedView) return
    const scenarioId = linkedScenario.id
    const label = `${linkedScenario.plan.client} · ${linkedScenario.plan.location}`
    try {
      clearCapacityPlanData(scenarioId)
      saveScenarioForecastModes(scenarioId, DEFAULT_CAPACITY_FORECAST_MODES)
      setForecastModes(DEFAULT_CAPACITY_FORECAST_MODES)
      setSavedForecastModes(DEFAULT_CAPACITY_FORECAST_MODES)
      setCellDrafts({})
      setVisibleShrinkageCategoryIds([...DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS])
      setHiddenWeeks([])
      setMatrixShrinkageComposer(null)
      setSaveConfirmOpen(false)
      setDeleteConfirmOpen(false)
      setUploadError('')
      setUploadMessage(
        `Capacity plan deleted for ${label}. Planned overrides, imports, and locked weeks were cleared. Assumptions remain.`,
      )
    } catch (error) {
      setDeleteConfirmOpen(false)
      setUploadError(error instanceof Error ? error.message : 'Failed to delete capacity plan.')
    }
  }, [clearCapacityPlanData, isCombinedView, linkedScenario])

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
      const next = { ...prev }
      delete next[draftId]
      return next
    })
  }

  const setCellDraftValue = useCallback((draftId: string, value: string) => {
    setCellDrafts((prev) => ({ ...prev, [draftId]: value }))
  }, [])

  const applyCellDraft = useCallback(
    (draftId: string, draft: string) => {
      if (!linkedScenario) return
      const match = /^(planned|actual):([^:]+):(.+)$/.exec(draftId)
      if (!match) return
      const kind = match[1] as 'planned' | 'actual'
      const week = match[2]!
      const metricId = match[3]!
      const trimmed = draft.trim()
      const parsed = trimmed === '' ? null : Number(trimmed)
      const rawValue =
        parsed == null || Number.isNaN(parsed) ? null : isPercentDraftMetric(metricId) ? parsed / 100 : parsed

      if (metricId.startsWith('shrinkage:')) {
        const categoryId = metricId.replace('shrinkage:', '')
        const nextValue = rawValue == null ? null : Math.max(0, rawValue)
        if (kind === 'planned') updatePlannedShrinkageCategory(linkedScenario.id, week, categoryId, nextValue)
        else updateActualShrinkageCategory(linkedScenario.id, week, categoryId, nextValue)
        return
      }

      if (metricId.startsWith('support:')) {
        const roleId = metricId.replace('support:', '')
        const nextValue = rawValue == null ? null : Math.max(0, Math.round(rawValue))
        if (kind === 'planned') updatePlannedSupportRoleHc(linkedScenario.id, week, roleId, nextValue)
        else updateActualSupportRoleHc(linkedScenario.id, week, roleId, nextValue)
        return
      }

      const nextValue = normalizeMetricInput(metricId as keyof LedgerMetricSnapshot, rawValue)
      if (kind === 'planned') {
        updatePlannedOverrideMetric(linkedScenario.id, week, metricId as keyof LedgerMetricSnapshot, nextValue)
      } else {
        updateActualOverrideMetric(linkedScenario.id, week, metricId as keyof LedgerMetricSnapshot, nextValue)
      }
    },
    [
      linkedScenario,
      updateActualOverrideMetric,
      updateActualShrinkageCategory,
      updateActualSupportRoleHc,
      updatePlannedOverrideMetric,
      updatePlannedShrinkageCategory,
      updatePlannedSupportRoleHc,
    ],
  )

  /** Commit a single draft immediately (blur / Enter) so each cell edit takes effect. */
  const commitOneCellDraft = useCallback(
    (draftId: string) => {
      const draft = cellDrafts[draftId]
      if (draft == null) return
      applyCellDraft(draftId, draft)
      clearCellDraft(draftId)
    },
    [applyCellDraft, cellDrafts],
  )

  const commitAllCellDrafts = useCallback(() => {
    if (!linkedScenario) return
    for (const [draftId, draft] of Object.entries(cellDrafts)) {
      if (draft == null) continue
      applyCellDraft(draftId, draft)
    }
    setCellDrafts({})
  }, [applyCellDraft, cellDrafts, linkedScenario])

  // Persist in-progress cell drafts to MariaDB before refresh / tab close.
  useEffect(() => {
    const flushDrafts = () => {
      if (Object.keys(cellDrafts).length === 0) return
      for (const [draftId, draft] of Object.entries(cellDrafts)) {
        if (draft == null) continue
        applyCellDraft(draftId, draft)
      }
      void flushStaffingPlanRequiredHcSync()
      void flushCapacityDocuments()
    }
    window.addEventListener('pagehide', flushDrafts)
    window.addEventListener('beforeunload', flushDrafts)
    return () => {
      window.removeEventListener('pagehide', flushDrafts)
      window.removeEventListener('beforeunload', flushDrafts)
    }
  }, [applyCellDraft, cellDrafts])

  const saveCapacityChanges = useCallback(() => {
    materializePlannedAttritionPct()
    materializePlannedRequiredFte()
    materializePlannedProductionFte()
    commitAllCellDrafts()
    persistForecastModes()
    persistMatrixView()
    void flushCapacityDocuments()
    void flushStaffingPlanRequiredHcSync()
    setUploadMessage('Capacity changes saved. Financial Dashboard figures that use this plan will reflect these updates.')
    setUploadError('')
    setSaveConfirmOpen(false)
  }, [
    commitAllCellDrafts,
    materializePlannedAttritionPct,
    materializePlannedProductionFte,
    materializePlannedRequiredFte,
    persistForecastModes,
    persistMatrixView,
  ])

  // Keep MariaDB staffing_plan.required_production_fte / production_fte filled from computed matrix values.
  useEffect(() => {
    if (!linkedScenario || isCombinedView || !derivedRows.length) return
    const timer = window.setTimeout(() => {
      materializePlannedRequiredFte()
      materializePlannedProductionFte()
    }, 400)
    return () => window.clearTimeout(timer)
  }, [
    derivedRows,
    isCombinedView,
    linkedScenario,
    materializePlannedProductionFte,
    materializePlannedRequiredFte,
  ])

  const discardUnsavedCapacityChanges = useCallback(() => {
    setCellDrafts({})
    setForecastModes(savedForecastModes)
  }, [savedForecastModes])

  const hasUnsavedMatrixEdits = Object.keys(cellDrafts).length > 0 || forecastModesDirty
  const { isBlocked: navigationBlocked, proceed: proceedNavigation, cancel: cancelNavigation } = useUnsavedChangesGuard({
    when: hasUnsavedMatrixEdits,
  })

  const FINANCIAL_SAVE_MESSAGE =
    'Saving these capacity changes will update this plan and affect Financial Dashboard data that uses it (revenue, cost, and margin views). Continue?'

  const downloadManualInputTemplate = () => {
    if (!linkedScenario || isCombinedView || !planStartWeek) {
      setUploadError('Download input template is available for a single LOB plan.')
      setUploadMessage('')
      return
    }
    const weekCount = Math.max(13, resolvePlanHorizonWeeks(planStartWeek, linkedScenario.plan.weekStart))
    // Prefer the weeks the user is currently looking at, then the full ledger, so no
    // Actual week from the selection/matrix is dropped from the template.
    const selectionWeeks = uniqueSortedWeeks([
      ...displayedRows.map((row) => row.week),
      ...derivedRows.map((row) => row.week),
    ])
    const actualWeeks = uniqueSortedWeeks([
      ...derivedRows
        .filter((row) => row.statusLabel === 'Actual' || row.timeline === 'historical_actual')
        .map((row) => row.week),
      ...displayedRows
        .filter((row) => row.statusLabel === 'Actual' || row.timeline === 'historical_actual')
        .map((row) => row.week),
      ...getScenarioActualOverrides(linkedScenario.id).map((item) => item.week),
    ])
    const displayWeeks = uniqueSortedWeeks([
      ...selectionWeeks,
      ...actualWeeks,
      ...(linkedScenario.plan.capacityImportedWeeks ?? []),
      ...Object.keys(effectivePlannedOverrides),
    ])
    const actualOverrides = buildDownloadActualOverrides(
      derivedRows,
      getScenarioActualOverrides(linkedScenario.id),
    )
    downloadStaffingManualInputTemplate({
      planStartWeek,
      weekStart: linkedScenario.plan.weekStart,
      weekCount,
      client: linkedScenario.plan.client,
      lob: resolvePlanLob(linkedScenario.plan),
      includeRequiredFte: isFteBillingPlan(linkedScenario.plan.billingType),
      shrinkageCategories: scenarioShrinkageCategories.map((item) => ({ id: item.id, name: item.name })),
      supportRoles: scenarioSupportRoles.map((item) => ({ id: item.id, name: item.name })),
      plannedOverrides: effectivePlannedOverrides,
      actualOverrides,
      displayWeeks,
      derivedByWeek: buildDerivedPrefillByWeek(derivedRows),
    })
    setUploadError('')
    setUploadMessage(
      `Downloaded input template with Planned + all Actual weeks (${actualWeeks.length} actual · ${displayWeeks.length || weekCount} total weeks). Edit, then upload with Append or Overwrite.`,
    )
  }

  const importTemplateWorkbook = async (file: File) => {
    if (!linkedScenario || isCombinedView) {
      setUploadError('Upload is available for a single LOB capacity file, not the combined view.')
      setUploadMessage('')
      return
    }

    setUploadMessage('')
    setUploadError('')

    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      const weekStart = linkedScenario.plan.weekStart
      const includeRequiredFte = isFteBillingPlan(linkedScenario.plan.billingType)
      const shrinkageCategories = scenarioShrinkageCategories.map((item) => ({ id: item.id, name: item.name }))
      const supportRoles = scenarioSupportRoles.map((item) => ({ id: item.id, name: item.name }))

      const plannedByWeek: Record<string, WeekCapacityPlanOverride> = {}
      let actualOverrides: import('../planner/weeklyLedger').ImportedActualOverride[] = []
      let snappedWeeks: string[] = []
      let resultMessage = ''
      let warnings: string[] = []

      if (isManualInputWorkbook(workbook)) {
        const result = parseStaffingManualInputWorkbook(workbook, {
          mode: templateImportMode,
          weekStart,
          includeRequiredFte,
          shrinkageCategories,
          supportRoles,
          existingPlanned: effectivePlannedOverrides,
          existingActual: getScenarioActualOverrides(linkedScenario.id),
        })
        if (!result.success) {
          setUploadError(result.errors.length ? result.errors.join(' ') : result.message)
          return
        }
        Object.entries(result.plannedByWeek).forEach(([week, metrics]) => {
          const snappedWeek = snapToWeekStart(week, weekStart)
          plannedByWeek[snappedWeek] = { ...(plannedByWeek[snappedWeek] ?? {}), ...metrics }
        })
        actualOverrides = result.actualOverrides.map((override) => ({
          ...override,
          week: snapToWeekStart(override.week, weekStart),
        }))
        snappedWeeks = uniqueSortedWeeks(
          (result.templateWeeks.length ? result.templateWeeks : [...Object.keys(plannedByWeek), ...actualOverrides.map((item) => item.week)]).map(
            (week) => snapToWeekStart(week, weekStart),
          ),
        )
        resultMessage = result.message
        warnings = result.warnings
      } else {
        const result = parseCapacityPlanWorkbook(workbook, [], {
          acceptUnknownWeeks: true,
          shrinkageCategories,
        })
        if (!result.success) {
          setUploadError(result.errors.length ? result.errors.join(' ') : result.message)
          return
        }
        Object.entries(result.plannedByWeek).forEach(([week, metrics]) => {
          const snappedWeek = snapToWeekStart(week, weekStart)
          plannedByWeek[snappedWeek] = { ...(plannedByWeek[snappedWeek] ?? {}), ...metrics }
        })
        Object.entries(result.plannedShrinkageByWeek ?? {}).forEach(([week, shrinkageById]) => {
          const snappedWeek = snapToWeekStart(week, weekStart)
          const existing = plannedByWeek[snappedWeek] ?? {}
          plannedByWeek[snappedWeek] = {
            ...existing,
            shrinkageById: { ...(existing.shrinkageById ?? {}), ...shrinkageById },
          }
        })
        actualOverrides = result.actualOverrides.map((override) => ({
          ...override,
          week: snapToWeekStart(override.week, weekStart),
        }))
        snappedWeeks = uniqueSortedWeeks(
          (result.templateWeeks.length ? result.templateWeeks : Object.keys(plannedByWeek)).map((week) =>
            snapToWeekStart(week, weekStart),
          ),
        )
        resultMessage = result.message
        warnings = result.warnings ?? []
      }

      if (snappedWeeks.length) {
        updateScenarioPlan(linkedScenario.id, {
          ...linkedScenario.plan,
          capacityPlanStartWeek: linkedScenario.plan.capacityPlanStartWeek || snappedWeeks[0]!,
          capacityImportedWeeks: snappedWeeks,
        })
        setHiddenWeeks([])
        setShowFutureWeeks(true)
      }

      applyPlannedWeekOverrides(linkedScenario.id, plannedByWeek, templateImportMode, {
        skipRemoteSync: true,
      })

      // Uploaded Volume / AHT / Occupancy must drive the matrix (manual), not forecast invents.
      const uploadedDrivers = Object.values(plannedByWeek).some(
        (week) => week.callVolume != null || week.ahtSeconds != null || week.occupancy != null,
      )
      if (uploadedDrivers) {
        const nextModes: ScenarioForecastModes = {
          ...forecastModes,
          callVolume: 'manual',
          ahtSeconds: 'manual',
          occupancy: 'manual',
        }
        setForecastModes(nextModes)
        setSavedForecastModes(nextModes)
        saveScenarioForecastModes(linkedScenario.id, nextModes)
      }

      // Actual weeks: append merges only blank cells; overwrite fully replaces weeks present in the file.
      if (actualOverrides.length) {
        if (templateImportMode === 'append') {
          const existing = new Map(getScenarioActualOverrides(linkedScenario.id).map((item) => [item.week, item]))
          const filtered = actualOverrides
            .map((override) => {
              const prev = existing.get(override.week)
              const metrics: Partial<LedgerMetricSnapshot> = {}
              for (const [key, value] of Object.entries(override.metrics ?? {})) {
                const metricId = key as keyof LedgerMetricSnapshot
                if (prev?.metrics?.[metricId] != null) continue
                metrics[metricId] = value as number
              }
              const shrinkageById: Record<string, number> = {}
              for (const [id, pct] of Object.entries(override.shrinkageById ?? {})) {
                if (prev?.shrinkageById?.[id] != null) continue
                shrinkageById[id] = pct
              }
              const supportHcByRole: Record<string, number> = {}
              for (const [id, hc] of Object.entries(override.supportHcByRole ?? {})) {
                if (prev?.supportHcByRole?.[id] != null) continue
                supportHcByRole[id] = hc
              }
              if (!Object.keys(metrics).length && !Object.keys(shrinkageById).length && !Object.keys(supportHcByRole).length) {
                return null
              }
              return {
                week: override.week,
                metrics,
                ...(Object.keys(shrinkageById).length ? { shrinkageById } : {}),
                ...(Object.keys(supportHcByRole).length ? { supportHcByRole } : {}),
              }
            })
            .filter((item): item is NonNullable<typeof item> => item != null)
          if (filtered.length) {
            importActualOverrides(linkedScenario.id, filtered, { skipRemoteSync: true })
          }
        } else {
          // Overwrite: replace actuals for every week present in the upload.
          replaceActualOverrides(linkedScenario.id, actualOverrides, { skipRemoteSync: true })
        }
      }

      // Keep uploaded Shrinkage Breakdown rows visible in weekly + monthly matrices.
      const uploadedShrinkageIds = [
        ...Object.values(plannedByWeek).flatMap((week) => Object.keys(week.shrinkageById ?? {})),
        ...actualOverrides.flatMap((item) => Object.keys(item.shrinkageById ?? {})),
      ]
      if (uploadedShrinkageIds.length) {
        setVisibleShrinkageCategoryIds((prev) => {
          const next = new Set([
            ...DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS,
            ...prev,
            ...uploadedShrinkageIds,
          ])
          return [...next]
        })
      }

      // Persist immediately to MariaDB (staffing_plan + capacity_documents) — one flush after planned+actuals.
      try {
        await flushStaffingPlanRequiredHcSync()
        await flushAllCapacityDocuments()
      } catch (persistError) {
        const persistMessage =
          persistError instanceof Error
            ? persistError.message
            : 'Upload applied locally but failed to save to MariaDB.'
        setUploadMessage(resultMessage)
        setUploadError(persistMessage)
        return
      }

      const requiredFteCount = Object.values(plannedByWeek).filter((week) => week.requiredFte != null).length
      if (requiredFteCount === 0 && includeRequiredFte) {
        setUploadMessage(resultMessage)
        setUploadError(
          'Upload applied, but no Required Production FTE values were found. Fill RequiredProductionFTE in the manual-input template, then upload again.',
        )
        return
      }

      setUploadMessage(
        [
          resultMessage,
          `Mode: ${templateImportMode === 'overwrite' ? 'overwrite matching weeks' : 'append / merge'}.`,
          snappedWeeks.length ? `Touched ${snappedWeeks.length} week${snappedWeeks.length === 1 ? '' : 's'} (first ${snappedWeeks[0]}).` : null,
          'Saved to MariaDB (capacity_documents + staffing_plan). Weekly and monthly views keep these values after refresh.',
          warnings.length ? warnings.join(' ') : null,
        ]
          .filter(Boolean)
          .join(' '),
      )
      setUploadError('')
    } catch {
      setUploadError('Upload failed. Use File → Download input template, fill values, then upload.')
    }
  }


  const exportWorkbook = () => {
    if (!linkedScenario) return
    const sameClientSheets = portfolioScenarios
      .filter((scenario) => scenario.plan.client === linkedScenario.plan.client)
      .map((scenario) => ({
        scenario,
        rows: deriveCapacityPlanRows(
          resolveLedger(scenario.id),
          scenario,
          resolveForecast(scenario.id, FORECAST_HORIZON_WEEKS),
          resolvePlanOverrides(scenario.id),
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
  }

  if (!linkedScenario) {
    if (seesEveryPlanner && portfolioLoading) {
      return <p className="saas-muted">Loading every planner’s staffing plans…</p>
    }
    if (seesEveryPlanner && portfolioScenarios.length > 0) {
      return <p className="saas-muted">Opening portfolio staffing plans…</p>
    }
    return <p className="saas-muted">Select or create a capacity file from Home to open the matrix view.</p>
  }

  return (
    <div className={`cap-module-page cap-capacity-workspace cap-v2 cap-staffing${embedded ? ' cap-module-page--embedded' : ''}`}>
      {navigationBlocked ? (
        <UnsavedChangesDialog
          title="Unsaved capacity changes"
          message={`${FINANCIAL_SAVE_MESSAGE} Or leave without saving.`}
          saveLabel="Save changes"
          discardLabel="Leave without saving"
          onSave={() => {
            saveCapacityChanges()
            proceedNavigation()
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
          onSave={saveCapacityChanges}
          onDiscard={() => setSaveConfirmOpen(false)}
          onCancel={() => setSaveConfirmOpen(false)}
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
                  Delete this plan data?
                </p>
                <p className="cap-panel__desc m-0 mt-1">
                  This removes all planned overrides, actual imports, stage attrition, shrinkage categories,
                  forecast overrides, template weeks, and locked driver weeks for{' '}
                  <strong>
                    {linkedScenario.plan.client} · {resolvePlanLob(linkedScenario.plan)}
                    {resolvePlanLocation(linkedScenario.plan) ? ` · ${resolvePlanLocation(linkedScenario.plan)}` : ''}
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
      <main className="cap-module-main cap-module-main--embedded">
        <ModulePageHeader
          title="Staffing Plan"
          description={
            isAllCombinedView
              ? `Combined · All capacity plans (${clientScenarios.length} team${clientScenarios.length === 1 ? '' : 's'})`
              : isProjectCombinedView
                ? `Combined · Project Code ${combinedProjectCodeLabel ?? ''} · ${clientScenarios.length} team${clientScenarios.length === 1 ? '' : 's'}`
                : isClientCombinedView
                  ? `${linkedScenario.plan.client} — all LOBs (${clientScenarios.length})`
                  : `${linkedScenario.plan.client} · ${resolvePlanLob(linkedScenario.plan)}${
                      resolvePlanLocation(linkedScenario.plan) ? ` · ${resolvePlanLocation(linkedScenario.plan)}` : ''
                    }`
          }
          actions={
            <div className="cap-capacity-toolbar">
              {!isCombinedView && linkedScenario && hasPreviousCapacityPlan() ? (
                <button
                  type="button"
                  className="saas-btn saas-btn--secondary"
                  title="Restore the previous capacity plan"
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
                  Undo
                </button>
              ) : null}
              <button
                type="button"
                className={`saas-btn${hasUnsavedMatrixEdits ? '' : ' saas-btn--secondary'}`}
                onClick={() => {
                  if (!hasUnsavedMatrixEdits) return
                  setSaveConfirmOpen(true)
                }}
                disabled={!hasUnsavedMatrixEdits}
              >
                {hasUnsavedMatrixEdits ? 'Save' : 'Saved'}
              </button>
              <button
                type="button"
                className="saas-btn saas-btn--secondary"
                onClick={() => navigate('/plan-settings')}
              >
                Settings
              </button>
              <details className="cap-capacity-download-menu">
                <summary className="saas-btn saas-btn--secondary cap-capacity-download-menu__trigger">File</summary>
                <div className="cap-capacity-download-menu__panel">
                  <button
                    type="button"
                    className="cap-capacity-download-menu__item"
                    disabled={isCombinedView}
                    onClick={downloadManualInputTemplate}
                    title="Downloads Planned and Actual values for the active plan selection"
                  >
                    Download input template (with current data)
                  </button>
                  <label className="cap-capacity-download-menu__item cap-capacity-download-menu__item--select">
                    <span>Import mode</span>
                    <select
                      value={templateImportMode}
                      disabled={isCombinedView}
                      onChange={(event) => setTemplateImportMode(event.target.value as ManualInputImportMode)}
                      onClick={(event) => event.stopPropagation()}
                      title={
                        templateImportMode === 'append'
                          ? 'Fill empty cells only. Volume / AHT / Occupancy always update from the file.'
                          : 'Replace Planned inputs and Actual weeks present in the file.'
                      }
                    >
                      <option value="append">Append / merge — keep existing, fill blanks</option>
                      <option value="overwrite">Overwrite — replace weeks present in file</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="cap-capacity-download-menu__item"
                    disabled={isCombinedView}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload input template
                  </button>
                  <hr className="cap-capacity-download-menu__rule" />
                  <button type="button" className="cap-capacity-download-menu__item" onClick={exportMatrixExcel}>
                    Excel matrix
                  </button>
                  <button type="button" className="cap-capacity-download-menu__item" onClick={exportMatrixCsv}>
                    Data (CSV)
                  </button>
                  <button type="button" className="cap-capacity-download-menu__item" onClick={exportMatrixPdf}>
                    PDF / print
                  </button>
                  <button type="button" className="cap-capacity-download-menu__item" onClick={exportWorkbook}>
                    Full workbook
                  </button>
                </div>
              </details>
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
          }
        />
        <div className="cap-staffing__meta" aria-label="Plan context">
          <label className="cap-staffing__client-filter">
            <span>Client Name</span>
            <select
              value={isAllCombinedView ? '__all__' : linkedScenario?.plan.client ?? ''}
              onChange={(event) => {
                const clientName = event.target.value
                setLocationFilter('')
                if (clientName === '__all__') {
                  if (!canViewPortfolioSummary) return
                  setScopeId('combined-all')
                  return
                }
                const match =
                  portfolioScenarios.find((scenario) => scenario.plan.client === clientName) ?? null
                if (!match) return
                setScopeId(`lob:${match.id}`)
                if (!isForeignScenario(match.id)) {
                  selectScenario(match.id)
                  publishScenarioToCapacity(match.id)
                }
              }}
              aria-label="Switch client"
            >
              {canViewPortfolioSummary || seesEveryPlanner ? (
                clientOptions.length > 1 || (seesEveryPlanner && portfolioScenarios.length > 0) ? (
                  <option value="__all__">All clients (combined)</option>
                ) : null
              ) : null}
              {clientOptions.map((client) => (
                <option key={client} value={client}>
                  {client}
                </option>
              ))}
            </select>
          </label>
          {seesEveryPlanner ? (
            <p className="saas-muted m-0 text-sm" style={{ gridColumn: '1 / -1' }}>
              {portfolioLoading
                ? 'Loading other planners’ staffing plans…'
                : portfolioError
                  ? portfolioError
                  : foreignOwners.length
                    ? `Client filter includes ${clientOptions.length} client${clientOptions.length === 1 ? '' : 's'} from ${foreignOwners.length + 1} planner${foreignOwners.length + 1 === 1 ? '' : 's'} (others’ plans are read-only).`
                    : 'No other planners have saved a staffing plan yet — showing your plans only.'}
            </p>
          ) : null}
          {locationOptions.length > 0 ? (
            <label className="cap-staffing__client-filter">
              <span>Location</span>
              <select
                value={locationFilter}
                onChange={(event) => {
                  const next = event.target.value
                  setLocationFilter(next)
                  if (!next) return
                  const match = (isAllCombinedView ? portfolioScenarios : clientScenarios).find(
                    (scenario) => resolvePlanLocation(scenario.plan) === next && scenarioHasCapacityData(scenario),
                  )
                  if (match && `lob:${match.id}` !== resolvedScopeId && !isCombinedView) {
                    setScopeId(`lob:${match.id}`)
                    selectScenario(match.id)
                    publishScenarioToCapacity(match.id)
                  }
                }}
                aria-label="Filter by location"
              >
                <option value="">All locations with data</option>
                {locationOptions.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {canViewPortfolioSummary || clientScenarios.length > 1 || sharedProjectCodeOptions.length > 0 ? (
            <label className="cap-staffing__client-filter">
              <span>LOB / Project</span>
              <select
                value={
                  isAllCombinedView
                    ? 'combined-all'
                    : isProjectCombinedView
                      ? `combined-project:${selectedProjectCodeKey}`
                      : isClientCombinedView
                        ? `combined:${linkedScenario.plan.client}`
                        : `lob:${linkedScenario.id}`
                }
                onChange={(event) => {
                  const next = event.target.value
                  setScopeId(next)
                  if (next === 'combined-all') {
                    return
                  }
                  if (next.startsWith('lob:')) {
                    const id = next.slice(4)
                    if (!isForeignScenario(id)) {
                      selectScenario(id)
                      publishScenarioToCapacity(id)
                    }
                  } else if (next.startsWith('combined-project:')) {
                    const key = normalizeProjectCode(next.slice('combined-project:'.length))
                    const match = portfolioScenarios.find(
                      (scenario) => normalizeProjectCode(resolvePlanProjectCode(scenario.plan)) === key,
                    )
                    if (match && !isForeignScenario(match.id)) {
                      selectScenario(match.id)
                      publishScenarioToCapacity(match.id)
                    }
                  } else if (next.startsWith('combined:')) {
                    const clientName = next.slice('combined:'.length)
                    const match = portfolioScenarios.find((scenario) => scenario.plan.client === clientName)
                    if (match && !isForeignScenario(match.id)) {
                      selectScenario(match.id)
                      publishScenarioToCapacity(match.id)
                    }
                  }
                }}
                aria-label="Switch LOB or combined view"
              >
                {canViewPortfolioSummary || seesEveryPlanner
                  ? portfolioScenarios.length > 1 || (seesEveryPlanner && portfolioScenarios.length > 0)
                    ? (
                        <option value="combined-all">Combined · All plans</option>
                      )
                    : null
                  : null}
                {!isAllCombinedView ? (
                  <option value={`combined:${linkedScenario.plan.client}`}>
                    Combined · Client (all LOBs)
                  </option>
                ) : null}
                {isAllCombinedView
                  ? clientOptions.map((client) => (
                      <option key={`combined-client:${client}`} value={`combined:${client}`}>
                        Combined · {client} (all LOBs)
                      </option>
                    ))
                  : null}
                {sharedProjectCodeOptions.map((item) => (
                  <option key={item.key} value={`combined-project:${item.key}`}>
                    Combined · Project Code {item.label} ({item.count} teams)
                  </option>
                ))}
                {lobFilterScenarios.map((scenario) => {
                  const planner = foreignOwnerName(scenario.id)
                  return (
                  <option key={scenario.id} value={`lob:${scenario.id}`}>
                    {isAllCombinedView ? `${scenario.plan.client} · ` : ''}
                    {resolvePlanLob(scenario.plan) || scenario.plan.projectCode || scenario.name}
                    {resolvePlanLocation(scenario.plan) ? ` · ${resolvePlanLocation(scenario.plan)}` : ''}
                    {scenario.plan.projectCode ? ` (${scenario.plan.projectCode})` : ''}
                    {planner ? ` · ${planner}` : ''}
                    {!isAllCombinedView &&
                    isProjectCombinedView &&
                    scenario.plan.client !== linkedScenario.plan.client
                      ? ` · ${scenario.plan.client}`
                      : ''}
                  </option>
                  )
                })}
              </select>
            </label>
          ) : (
            <span className="cap-staffing__chip cap-staffing__chip--lob">
              {isCombinedView
                ? isAllCombinedView
                  ? 'All plans'
                  : isProjectCombinedView
                    ? `Project ${combinedProjectCodeLabel}`
                    : 'All LOBs'
                : resolvePlanLob(linkedScenario.plan)}
            </span>
          )}
          {!isCombinedView && resolvePlanLocation(linkedScenario.plan) && !locationFilter ? (
            <span className="cap-staffing__chip cap-staffing__chip--location">
              {resolvePlanLocation(linkedScenario.plan)}
            </span>
          ) : null}
          {isProjectCombinedView && combinedProjectCodeLabel ? (
            <span className="cap-staffing__chip">{combinedProjectCodeLabel}</span>
          ) : !isCombinedView && linkedScenario.plan.projectCode ? (
            <span className="cap-staffing__chip">{linkedScenario.plan.projectCode}</span>
          ) : null}
          {!isCombinedView ? (
            <span className="cap-staffing__chip cap-staffing__chip--billing">
              {billableTypeLabel(linkedScenario.plan.billingType)}
            </span>
          ) : (
            <span className="cap-staffing__chip cap-staffing__chip--lob">
              {isAllCombinedView
                ? `${clientScenarios.length} teams · all plans`
                : isProjectCombinedView
                  ? `${clientScenarios.length} teams · project code`
                  : `${clientScenarios.length} LOBs · client`}
            </span>
          )}
          <span className="cap-staffing__chip cap-staffing__chip--period">{capacityPeriodLabel(period)}</span>
          <span className="cap-staffing__hint">
            Orange = editable · sticky Metrics column · scroll sideways for weeks · File menu downloads current Planned &amp; Actual
          </span>
        </div>
        <CapacityPeriodFilter
          state={period}
          onChange={setPeriod}
          weeks={periodWeeks}
          className="cap-staffing__period"
        />
        {(uploadError || uploadMessage) ? (
          <p className={`cap-capacity-upload-message ${uploadError ? 'cap-capacity-upload-message--error' : 'cap-capacity-upload-message--success'}`}>
            {uploadError || uploadMessage}
          </p>
        ) : null}
        <div className="cap-capacity-layout cap-capacity-layout--collapsed">
          <section className="saas-card cap-capacity-main" aria-label="Staffing grid">
            <div className="cap-ledger-toolbar cap-ledger-toolbar--capacity cap-staffing__toolbar">
              <div className="cap-staffing__toolbar-copy">
                <p className="cap-v2-grid-kicker m-0">
                  {period.mode === 'weekly'
                    ? 'Weekly matrix'
                    : period.mode === 'month'
                      ? 'Monthly view'
                      : period.mode === 'quarter'
                        ? 'Quarterly view'
                        : period.mode === 'h1'
                          ? 'H1 view'
                          : period.mode === 'h2'
                            ? 'H2 view'
                            : 'Yearly view'}
                </p>
                <h3 className="m-0">Headcount, volume &amp; drivers</h3>
                {viewSavedAt ? (
                  <p className="cap-capacity-saved-note m-0">View remembered {new Date(viewSavedAt).toLocaleString()}</p>
                ) : null}
                <div className="cap-matrix-legend cap-staffing__legend" aria-label="Color key">
                  <span className="cap-matrix-legend__item">
                    <span className="cap-ledger-matrix__week-status cap-ledger-matrix__week-status--actual">Actual</span>
                  </span>
                  <span className="cap-matrix-legend__item">
                    <span className="cap-ledger-matrix__week-status cap-ledger-matrix__week-status--planned">Planned</span>
                  </span>
                  <span className="cap-matrix-legend__item">
                    <span className="cap-matrix-legend__swatch cap-matrix-legend__swatch--editable" />
                    editable
                  </span>
                  <span className="cap-matrix-legend__item">
                    <span className="cap-matrix-legend__swatch cap-matrix-legend__swatch--locked" />
                    calculated
                  </span>
                </div>
              </div>
              <div className="cap-capacity-main__actions">
                {hasPastOrActualWeeks || hasHistoricalWeeks ? (
                  <>
                    <button
                      type="button"
                      className={`saas-btn saas-btn--secondary cap-capacity-main__toggle${showPastWeeks ? ' is-active' : ''}`}
                      onClick={() => setShowPastWeeks((prev) => !prev)}
                    >
                      {showPastWeeks ? 'Hide past' : 'Show past'}
                    </button>
                    <button
                      type="button"
                      className={`saas-btn saas-btn--secondary cap-capacity-main__toggle${unlockHistorical ? ' is-active' : ''}`}
                      title={
                        unlockHistorical
                          ? 'Lock past — planned and actual inputs return to normal edit rules'
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
                      {unlockHistorical ? 'Lock past' : 'Unlock past'}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  className={`saas-btn saas-btn--secondary cap-capacity-main__toggle${unlockRequiredProductionFte ? ' is-active' : ''}`}
                  title={
                    unlockRequiredProductionFte
                      ? 'Lock Required Production FTE — restore formula from Volume × AHT ÷ Occupancy'
                      : 'Unlock Required Production FTE — enter values manually without Volume/AHT/Occupancy'
                  }
                  onClick={() => {
                    if (!resolvedScopeId) return
                    setUnlockRequiredProductionFte((prev) => {
                      const next = !prev
                      setRequiredProductionFteUnlocked(resolvedScopeId, next)
                      return next
                    })
                  }}
                >
                  {unlockRequiredProductionFte ? 'Lock Required FTE' : 'Unlock Required FTE'}
                </button>
                <button
                  type="button"
                  className={`saas-btn saas-btn--secondary cap-capacity-main__toggle${unlockProductionFte ? ' is-active' : ''}`}
                  title={
                    unlockProductionFte
                      ? 'Lock Production FTE for this Client/LOB — restore Production HC × (1 − Shrinkage %) + Nesting productive FTE'
                      : 'Unlock Production FTE for this Client/LOB — show Planned Production Headcount with no shrinkage'
                  }
                  onClick={() => {
                    if (!resolvedScopeId) return
                    setUnlockProductionFte((prev) => {
                      const next = !prev
                      setProductionFteUnlocked(resolvedScopeId, next)
                      return next
                    })
                  }}
                >
                  {unlockProductionFte ? 'Lock Production FTE' : 'Unlock Production FTE'}
                </button>
                <button
                  type="button"
                  className={`saas-btn saas-btn--secondary cap-capacity-main__toggle${showFutureWeeks ? ' is-active' : ''}`}
                  onClick={() => setShowFutureWeeks((prev) => !prev)}
                >
                  {showFutureWeeks
                    ? `Hide future`
                    : `Show future (${DEFAULT_VISIBLE_FUTURE_WEEKS})`}
                </button>
                {showFutureWeeks ? (
                  <button
                    type="button"
                    className={`saas-btn saas-btn--secondary cap-capacity-main__toggle${expandAllFutureWeeks ? ' is-active' : ''}`}
                    onClick={() => setExpandAllFutureWeeks((prev) => !prev)}
                  >
                    {expandAllFutureWeeks
                      ? `Show ${DEFAULT_VISIBLE_FUTURE_WEEKS} future weeks`
                      : `Expand all future (${maxFutureWeeks})`}
                  </button>
                ) : null}
                <button
                  type="button"
                  className={`saas-btn saas-btn--secondary cap-capacity-main__toggle${weekPickerOpen || dateRangeActive ? ' is-active' : ''}`}
                  onClick={() => {
                    setWeekPickerOpen((prev) => {
                      const next = !prev
                      if (next) setWeekPanelTab('range')
                      return next
                    })
                  }}
                >
                  {weekPickerOpen ? 'Close filter' : dateRangeActive ? 'Date range · on' : 'Date range'}
                </button>
                <button
                  type="button"
                  className={`saas-btn saas-btn--secondary cap-capacity-main__toggle${chartsOpen ? ' is-active' : ''}`}
                  onClick={() => setChartsOpen((prev) => !prev)}
                >
                  {chartsOpen ? 'Hide charts' : 'Charts'}
                </button>
                <button
                  type="button"
                  className="saas-btn saas-btn--secondary cap-capacity-main__toggle"
                  onClick={() => setForecastInfoOpen((prev) => !prev)}
                >
                  {forecastInfoOpen ? 'Hide summary' : 'Summary'}
                </button>
                {hiddenMetricCount > 0 ? (
                  <button
                    type="button"
                    className="saas-btn saas-btn--secondary cap-capacity-main__toggle"
                    title="Show metric rows that are hidden by default"
                    onClick={revealHiddenMetrics}
                  >
                    Show hidden rows ({hiddenMetricCount})
                  </button>
                ) : (
                  <button
                    type="button"
                    className="saas-btn saas-btn--secondary cap-capacity-main__toggle"
                    title="Hide metrics that are hidden by default"
                    onClick={hideDefaultHiddenMetrics}
                  >
                    Hide optional rows
                  </button>
                )}
              </div>
            </div>

            {weekPickerOpen ? (
              <div className="cap-week-picker">
                <div className="cap-week-picker__head">
                  <div>
                    <strong>Week display filter</strong>
                    <p className="saas-muted m-0">
                      Filter the matrix by date range, or pick individual weeks to hide. Calculations are unchanged.
                    </p>
                  </div>
                  <div className="cap-week-picker__head-actions">
                    <div className="cap-week-picker__tabs" role="tablist" aria-label="Week filter mode">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={weekPanelTab === 'range'}
                        className={`cap-week-picker__tab${weekPanelTab === 'range' ? ' is-active' : ''}`}
                        onClick={() => setWeekPanelTab('range')}
                      >
                        Date range
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={weekPanelTab === 'pick'}
                        className={`cap-week-picker__tab${weekPanelTab === 'pick' ? ' is-active' : ''}`}
                        onClick={() => setWeekPanelTab('pick')}
                      >
                        Pick weeks
                      </button>
                    </div>
                    {weekPanelTab === 'pick' ? (
                      <button
                        type="button"
                        className="saas-btn saas-btn--secondary"
                        onClick={showAllVisibleWeeks}
                      >
                        Show all
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="saas-btn saas-btn--secondary"
                        onClick={clearDateRange}
                        disabled={!dateRangeActive}
                      >
                        Clear range
                      </button>
                    )}
                  </div>
                </div>

                {weekPanelTab === 'range' ? (
                  <div className="cap-week-picker__range">
                    <label className="cap-week-picker__range-field">
                      <span>From week</span>
                      <input
                        type="date"
                        value={dateRangeStart}
                        max={dateRangeEnd || undefined}
                        onChange={(event) => setDateRangeStart(event.target.value)}
                      />
                    </label>
                    <label className="cap-week-picker__range-field">
                      <span>To week</span>
                      <input
                        type="date"
                        value={dateRangeEnd}
                        min={dateRangeStart || undefined}
                        onChange={(event) => setDateRangeEnd(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="saas-btn saas-btn--secondary"
                      onClick={applyDateRangeToVisibleWindow}
                    >
                      Use full plan range
                    </button>
                    {dateRangeActive ? (
                      <p className="saas-muted m-0 cap-week-picker__range-hint">
                        Showing weeks from {dateRangeStart || '…'} to {dateRangeEnd || '…'} (
                        {displayedRows.length} column{displayedRows.length === 1 ? '' : 's'}).
                      </p>
                    ) : (
                      <p className="saas-muted m-0 cap-week-picker__range-hint">
                        Choose a start and end date to limit visible week columns.
                      </p>
                    )}
                  </div>
                ) : (
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
                              prev.includes(row.week)
                                ? prev.filter((item) => item !== row.week)
                                : [...prev, row.week],
                            )
                          }
                        >
                          <span>{row.week}</span>
                          <span className={statusClass(row.statusLabel)}>
                            {isHidden ? 'Hidden' : row.statusLabel}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : null}

            {chartsOpen ? (
              <StaffingCapacityChartsPanel
                rows={displayedRows}
                volumeLabels={{
                  forecastVolume: capacityLabels.forecastVolume,
                  actualVolume: capacityLabels.actualVolume,
                  handledVolume: capacityLabels.handledVolume,
                }}
                onClose={() => setChartsOpen(false)}
              />
            ) : null}

            {forecastInfoOpen ? (
              <div className="cap-forecast-info">
                <div className="cap-forecast-info__grid">
                  <div className="cap-forecast-info__item">
                    <span className="cap-forecast-info__label">Planning week</span>
                    <span className="cap-forecast-info__method">{currentPlanningWeek ?? '—'}</span>
                  </div>
                  <div className="cap-forecast-info__item">
                    <span className="cap-forecast-info__label">View window</span>
                    <span className="cap-forecast-info__method">
                      {importedDisplayWeeks?.length
                        ? `Template mode · ${importedDisplayWeeks.length} weeks`
                        : `Plan start · ${
                            showFutureWeeks
                              ? `${visibleFutureWeekCount} future weeks`
                              : 'future weeks hidden'
                          }${showPastWeeks ? ` · ${VISIBLE_HISTORY_WEEKS} past` : ' · past hidden'}`}
                    </span>
                  </div>
                  <div className="cap-forecast-info__item">
                    <span className="cap-forecast-info__label">Training / Nesting</span>
                    <span className="cap-forecast-info__method">
                      {linkedScenario.assumptions.newHire.trainingWeeks}w training · {linkedScenario.assumptions.newHire.nestingWeeks}w nesting
                    </span>
                  </div>
                  <div className="cap-forecast-info__item">
                    <span className="cap-forecast-info__label">Nesting attrition</span>
                    <span className="cap-forecast-info__method">{fmtPct(linkedScenario.assumptions.newHire.nestingAttritionRate)}</span>
                  </div>
                  <div className="cap-forecast-info__item">
                    <span className="cap-forecast-info__label">Standard hours</span>
                    <span className="cap-forecast-info__method">{fmtNum(linkedScenario.assumptions.tenured.standardScheduledHoursPerWeek, 1)} h/wk</span>
                  </div>
                  <div className="cap-forecast-info__item">
                    <span className="cap-forecast-info__label">Inactive roster (production)</span>
                    <span className="cap-forecast-info__method">{inactiveProductionRosterCount} HC</span>
                  </div>
                  {rosterCapacityMetrics ? (
                    <>
                      <div className="cap-forecast-info__item">
                        <span className="cap-forecast-info__label">Active Agents (role)</span>
                        <span className="cap-forecast-info__method">{fmtNum(activeAgentCount, 0)}</span>
                      </div>
                      <div className="cap-forecast-info__item">
                        <span className="cap-forecast-info__label">Roster active HC</span>
                        <span className="cap-forecast-info__method">{fmtNum(rosterCapacityMetrics.activeHeadcount, 0)}</span>
                      </div>
                      <div className="cap-forecast-info__item">
                        <span className="cap-forecast-info__label">Roster training / nesting</span>
                        <span className="cap-forecast-info__method">
                          {fmtNum(rosterCapacityMetrics.trainingHc, 0)} / {fmtNum(rosterCapacityMetrics.nestingHc, 0)} HC
                        </span>
                      </div>
                      <div className="cap-forecast-info__item">
                        <span className="cap-forecast-info__label">Roster Agent production HC</span>
                        <span className="cap-forecast-info__method">{fmtNum(rosterCapacityMetrics.agentProductionHc, 0)}</span>
                      </div>
                      <div className="cap-forecast-info__item">
                        <span className="cap-forecast-info__label">Roster production HC</span>
                        <span className="cap-forecast-info__method">{fmtNum(rosterCapacityMetrics.productionHc, 0)}</span>
                      </div>
                      <div className="cap-forecast-info__item">
                        <span className="cap-forecast-info__label">Staffing gap (FTE)</span>
                        <span className="cap-forecast-info__method">
                          {rosterCapacityMetrics.staffingGap != null ? fmtNum(rosterCapacityMetrics.staffingGap, 1) : '—'}
                        </span>
                      </div>
                    </>
                  ) : null}
                  {!isCombinedView
                    ? forecastInfoItems.map((item) => (
                        <div key={item.label} className="cap-forecast-info__item">
                          <span className="cap-forecast-info__label">{item.label} driver</span>
                          <span className="cap-forecast-info__method">{item.method}</span>
                        </div>
                      ))
                    : null}
                </div>
                <p className="saas-muted m-0 mt-3 text-xs">
                  Production HC = prior HC + graduates + transfer in − attrition − transfer out − off-roster/LOA.
                  Click any highlighted cell to type a value — press Enter or click away to apply. Use Unlock past
                  to edit Actual / historical columns. Unlock Required FTE to enter Required Production FTE manually
                  (Volume/AHT/Occupancy will not recompute it). Unlock Production FTE to show Planned Production
                  Headcount with no shrinkage.
                </p>
              </div>
            ) : null}

            <div className="cap-ledger-table-wrap cap-ledger-table-wrap--capacity" ref={matrixRef}>
            <p className="cap-capacity-scroll-hint saas-muted m-0">
              {importedDisplayWeeks?.length
                ? `Showing ${importedDisplayWeeks.length} template weeks (${hiddenWeeks.length} hidden).`
                : `Showing ${
                    showPastWeeks ? `${VISIBLE_HISTORY_WEEKS} past + ` : ''
                  }${showFutureWeeks ? `${visibleFutureWeekCount} future` : 'start week only'} (${hiddenWeeks.length} hidden).`}
              {dateRangeActive
                ? ` Date range ${dateRangeStart || '…'} → ${dateRangeEnd || '…'} (${displayedRows.length} columns).`
                : ''}
              {unlockHistorical
                ? ' Past / Actual weeks unlocked — Planned and Actual cells are editable.'
                : ''}
              {unlockProductionFte
                ? ' Production FTE unlocked — equals Production Headcount (no shrinkage).'
                : ''}
              {view === 'weekly'
                ? ' Editable cells accept typing directly. Enter or blur applies the value; Escape cancels.'
                : ''}
            </p>
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
                {(Object.keys(orderedMatrixGroups) as CapacityGroupId[]).map((groupId) => (
                  <Fragment key={groupId}>
                    <tr className="cap-ledger-matrix__group-row">
                      <th colSpan={displayedRows.length + 1} className="cap-ledger-matrix__group">
                        <button
                          type="button"
                          className={`cap-ledger-matrix__group-btn cap-ledger-matrix__group-btn--${groupId}`}
                          onClick={() => setCollapsed((prev) => ({ ...prev, [groupId]: !prev[groupId] }))}
                        >
                          <span>{collapsed[groupId] ? '▸' : '▾'}</span>
                          <span>{GROUP_LABELS[groupId]}</span>
                        </button>
                      </th>
                    </tr>

                    {!collapsed[groupId] &&
                      orderedMatrixGroups[groupId].flatMap((metric) => {
                        const metricRow = (
                        <tr
                          key={`${groupId}-${metric.id}`}
                          className={`cap-ledger-matrix__data-row ${metric.editablePlanned || metric.editableActual ? 'cap-ledger-matrix__data-row--input' : 'cap-ledger-matrix__data-row--calculated'}${draggingMetric?.groupId === groupId && draggingMetric.metricId === metric.id ? ' cap-ledger-matrix__data-row--dragging' : ''}`}
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
                              {groupId === 'support' && metric.id === 'planned-total-support-hc' && !isCombinedView ? (
                                <button
                                  type="button"
                                  className="cap-shrinkage-matrix-add"
                                  title="Add support role (Team Lead, Manager, QA, Trainer, WFM, …)"
                                  onClick={() => setMatrixSupportComposer('')}
                                >
                                  +
                                </button>
                              ) : null}
                              {groupId === 'support' &&
                              metric.supportRoleId &&
                              metric.supportEditKind === 'planned' &&
                              isCustomSupportRoleId(metric.supportRoleId) ? (
                                <button
                                  type="button"
                                  className="cap-shrinkage-row-delete"
                                  title={`Delete ${metric.label}`}
                                  onClick={() => deleteMatrixSupportRole(metric.supportRoleId!)}
                                >
                                  Delete
                                </button>
                              ) : null}
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
                            // rowTone wins when a metric colours itself by comparing two
                            // fields on the week, which `tone(value)` cannot see.
                            const tone = metric.rowTone
                              ? metric.rowTone(row)
                              : (metric.tone ?? NEUTRAL_TONE)(value)
                            const isActualStatusWeek =
                              row.timeline === 'historical_actual' || row.statusLabel === 'Actual'
                            const isPastOrActualWeek =
                              isActualStatusWeek ||
                              (currentPlanningWeek != null && row.week < currentPlanningWeek)
                            // Unlock past: open every manual Planned/Actual input on past or Actual columns.
                            const unlockedPast = unlockHistorical && isPastOrActualWeek
                            const actualEntryAllowed =
                              row.timeline === 'historical_actual' &&
                              (unlockHistorical ||
                                row.week === lastHistoricalWeek ||
                                row.week < (currentPlanningWeek ?? ''))
                            const editablePlanned =
                              canEditCapacity &&
                              !isCombinedView &&
                              view === 'weekly' &&
                              metric.editablePlanned &&
                              (Boolean(metric.plannedOverrideKey) || metric.shrinkageEditKind === 'planned' || metric.supportEditKind === 'planned') &&
                              (!metric.editablePlannedCurrentWeekOnly || row.week === currentPlanningWeek) &&
                              (row.timeline === 'forward_plan' || unlockedPast)
                            const editableActual =
                              canEditCapacity &&
                              !isCombinedView &&
                              view === 'weekly' &&
                              metric.editableActual &&
                              (Boolean(metric.actualOverrideKey) || metric.shrinkageEditKind === 'actual' || metric.supportEditKind === 'actual') &&
                              (unlockedPast ||
                                (metric.editableActualPlanningWeek && row.isCurrentPlanningWeek) ||
                                (metric.editableActualAllHistorical && isPastOrActualWeek) ||
                                (metric.shrinkageEditKind === 'actual' && isPastOrActualWeek) ||
                                (metric.supportEditKind === 'actual' && isPastOrActualWeek) ||
                                actualEntryAllowed)
                            if (editablePlanned && metric.supportEditKind === 'planned' && metric.supportRoleId) {
                              const roleId = metric.supportRoleId
                              const draftId = cellDraftId('planned', row.week, `support:${roleId}`)
                              const baseValue =
                                effectivePlannedOverrides[row.week]?.supportHcByRole?.[roleId] ??
                                supportLookup.rowsByWeek.get(row.week)?.roles?.[roleId]?.planned ??
                                null
                              const inputValue =
                                cellDrafts[draftId] ?? toInputString(baseValue, { whole: true })
                              return (
                                <td
                                  key={`${row.week}-${metric.id}`}
                                  className={matrixCellClasses({ tone, timeline: row.timeline, editable: true, editKind: 'planned' })}
                                >
                                  <CapacityMatrixCellInput
                                    draftId={draftId}
                                    value={inputValue}
                                    min={0}
                                    step={metric.step ?? 1}
                                    aria-label={`${metric.label} planned ${row.week}`}
                                    onDraftChange={setCellDraftValue}
                                    onCommit={commitOneCellDraft}
                                    onClear={clearCellDraft}
                                  />
                                </td>
                              )
                            }
                            if (editableActual && metric.supportEditKind === 'actual' && metric.supportRoleId) {
                              const roleId = metric.supportRoleId
                              const draftId = cellDraftId('actual', row.week, `support:${roleId}`)
                              const baseValue = supportLookup.rowsByWeek.get(row.week)?.roles?.[roleId]?.actual ?? null
                              const inputValue =
                                cellDrafts[draftId] ?? toInputString(baseValue, { whole: true })
                              return (
                                <td
                                  key={`${row.week}-${metric.id}`}
                                  className={matrixCellClasses({ tone, timeline: row.timeline, editable: true, editKind: 'actual' })}
                                >
                                  <CapacityMatrixCellInput
                                    draftId={draftId}
                                    value={inputValue}
                                    min={0}
                                    step={metric.step ?? 1}
                                    aria-label={`${metric.label} actual ${row.week}`}
                                    onDraftChange={setCellDraftValue}
                                    onCommit={commitOneCellDraft}
                                    onClear={clearCellDraft}
                                  />
                                </td>
                              )
                            }
                            if (editablePlanned && metric.shrinkageEditKind === 'planned' && metric.shrinkageCategoryId) {
                              const categoryId = metric.shrinkageCategoryId
                              const draftId = cellDraftId('planned', row.week, `shrinkage:${categoryId}`)
                              const baseValue = getPlannedShrinkageCategoryValue(row.week, categoryId)
                              const inputValue =
                                cellDrafts[draftId] ??
                                toInputString(baseValue, {
                                  percent: true,
                                })
                              return (
                                <td
                                  key={`${row.week}-${metric.id}`}
                                  className={matrixCellClasses({ tone, timeline: row.timeline, editable: true, editKind: 'planned' })}
                                >
                                  <CapacityMatrixCellInput
                                    draftId={draftId}
                                    value={inputValue}
                                    min={0}
                                    max={125}
                                    step={metric.step ?? 0.1}
                                    aria-label={`${metric.label} planned ${row.week}`}
                                    onDraftChange={setCellDraftValue}
                                    onCommit={commitOneCellDraft}
                                    onClear={clearCellDraft}
                                  />
                                </td>
                              )
                            }
                            if (editableActual && metric.shrinkageEditKind === 'actual' && metric.shrinkageCategoryId) {
                              const categoryId = metric.shrinkageCategoryId
                              const draftId = cellDraftId('actual', row.week, `shrinkage:${categoryId}`)
                              const baseValue = getActualShrinkageCategoryValue(row.week, categoryId)
                              const inputValue =
                                cellDrafts[draftId] ??
                                toInputString(baseValue, {
                                  percent: true,
                                })
                              return (
                                <td
                                  key={`${row.week}-${metric.id}`}
                                  className={matrixCellClasses({ tone, timeline: row.timeline, editable: true, editKind: 'actual' })}
                                >
                                  <CapacityMatrixCellInput
                                    draftId={draftId}
                                    value={inputValue}
                                    min={0}
                                    max={125}
                                    step={metric.step ?? 0.1}
                                    aria-label={`${metric.label} actual ${row.week}`}
                                    onDraftChange={setCellDraftValue}
                                    onCommit={commitOneCellDraft}
                                    onClear={clearCellDraft}
                                  />
                                </td>
                              )
                            }
                            if (editablePlanned) {
                              const metricKey = metric.plannedOverrideKey!
                              const draftId = cellDraftId('planned', row.week, metricKey)
                              const baseValue = plannedOverrides[row.week]?.[metricKey] ?? value ?? null
                              const inputValue =
                                cellDrafts[draftId] ??
                                toInputString(baseValue, {
                                  percent: Boolean(metric.isPercentInput),
                                  whole: isWholeNumberMetric(metricKey),
                                })
                              return (
                                <td
                                  key={`${row.week}-${metric.id}`}
                                  className={matrixCellClasses({ tone, timeline: row.timeline, editable: true, editKind: 'planned' })}
                                >
                                  <CapacityMatrixCellInput
                                    draftId={draftId}
                                    value={inputValue}
                                    min={0}
                                    max={
                                      metricKey === 'occupancy' || metricKey === 'attritionPct'
                                        ? 100
                                        : metricKey === 'totalShrinkagePct'
                                          ? 125
                                          : undefined
                                    }
                                    step={metric.step ?? 1}
                                    aria-label={`${metric.label} planned ${row.week}`}
                                    onDraftChange={setCellDraftValue}
                                    onCommit={commitOneCellDraft}
                                    onClear={clearCellDraft}
                                  />
                                </td>
                              )
                            }
                            if (editableActual) {
                              const rawLedgerRow = ledgerByWeek.get(row.week)
                              const metricKey = metric.actualOverrideKey!
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
                                  className={matrixCellClasses({ tone, timeline: row.timeline, editable: true, editKind: 'actual' })}
                                >
                                  <CapacityMatrixCellInput
                                    draftId={draftId}
                                    value={inputValue}
                                    min={0}
                                    max={metricKey === 'occupancy' ? 100 : metricKey === 'totalShrinkagePct' ? 125 : undefined}
                                    step={metric.step ?? 1}
                                    aria-label={`${metric.label} actual ${row.week}`}
                                    onDraftChange={setCellDraftValue}
                                    onCommit={commitOneCellDraft}
                                    onClear={clearCellDraft}
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
                        const showSupportComposer =
                          groupId === 'support' &&
                          metric.id === 'planned-total-support-hc' &&
                          matrixSupportComposer != null
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
                        if (showSupportComposer) {
                          rows.push(
                            <tr key={`${groupId}-${metric.id}-support-composer`} className="cap-shrinkage-matrix-composer-row">
                              <td colSpan={displayedRows.length + 1}>
                                <div className="cap-shrinkage-matrix-composer">
                                  <input
                                    type="text"
                                    placeholder="Role name (e.g. Team Lead, QA, WFM)"
                                    value={matrixSupportComposer ?? ''}
                                    onChange={(event) => setMatrixSupportComposer(event.target.value)}
                                  />
                                  <button
                                    type="button"
                                    className="saas-btn saas-btn--primary"
                                    onClick={addMatrixSupportRole}
                                    disabled={!matrixSupportComposer?.trim()}
                                  >
                                    Add role
                                  </button>
                                  <button
                                    type="button"
                                    className="saas-btn saas-btn--secondary"
                                    onClick={() => setMatrixSupportComposer(null)}
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
          </section>
        </div>
      </main>
    </div>
  )
}

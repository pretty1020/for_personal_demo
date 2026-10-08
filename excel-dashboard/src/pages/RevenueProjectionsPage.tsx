import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { usePlanner } from '../context/PlannerContext'
import { useIdealFinancial } from '../context/IdealFinancialContext'
import { ChannelSelector } from '../components/planner/ChannelSelector'
import { CHANNEL_LABELS, type ChannelType, type PlannerScenario } from '../planner/types'
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog'
import { StableNumberInput } from '../components/fields/StableNumberInput'
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard'
import { useWorkspaceSnapshotRevision } from '../hooks/useWorkspaceSnapshotRevision'
import { flushWorkspaceSync } from '../data/workspaceSync'
import {
  billRateMethodsLabel,
  combineRevenueProjectionMonths,
  computeRevenueProjectionMonth,
  createRevenueProjectionLine,
  createRevenueProjectionFactor,
  createRevenueProjectionCostLine,
  COST_CATEGORY_SUGGESTIONS,
  DEFAULT_REV_PROJ_DEFAULTS,
  deleteRevenueProjectionLine,
  enabledBillRateMethods,
  emptyMonthInput,
  factorSheetLabel,
  formatFiscalMonthLabel,
  lineYearCost,
  lineYearMargin,
  lineYearRevenue,
  listClientLobs,
  listFiscalMonthKeys,
  listRevenueProjectionClients,
  listRevenueProjectionLocations,
  loadRevenueProjectionLines,
  MAX_COST_CATEGORY_LENGTH,
  MAX_COST_LINES,
  MAX_REVENUE_FACTORS,
  REV_PROJ_BILL_RATE_METHODS,
  REV_PROJ_METRIC_ROWS,
  saveRevenueProjectionLines,
  sumCostLinesWeekly,
  upsertRevenueProjectionLine,
  zeroInactiveBillRates,
  type RevProjBillRateMethod,
  type RevProjMetricRowId,
  type RevenueProjectionComputeOptions,
  type RevenueProjectionFactorKind,
  type RevenueProjectionLobDefaults,
  type RevenueProjectionLobLine,
  type RevenueProjectionMonthInput,
  type RevenueProjectionNamedFactor,
  type RevenueProjectionCostLine,
} from '../planner/revenueProjections/revenueProjectionPersistence'
import { RevenueProjectionCharts } from '../components/revenue/RevenueProjectionCharts'
import {
  filterRevenueLinesForAccessiblePlans,
  findMatchingStaffingScenario,
  findStaffingScenarioForRevenueProjectionLine,
  resolveRevenueProjectionChannel,
  resolveStaffingMonthDrivers,
  staffingScenarioHasDriverData,
  type StaffingDriverLookup,
} from '../planner/revenueProjections/staffingMonthDrivers'
import { useDemoSession } from '../context/DemoSessionContext'
import { resolveClientIndustry } from '../planner/clientRegistry'
import {
  driverSnapshotFromScenario,
  filterCapacityPlanPicks,
  findCapacityPlanPickForLine,
  listCapacityPlanPickOptions,
  uniquePickChannels,
  uniquePickClients,
  uniquePickLobs,
  uniquePickLocations,
  type CapacityPlanPickOption,
} from '../planner/revenueProjections/capacityPlanPickOptions'
import { deriveCapacityPlanRows } from '../planner/capacityPlanDerived'
import {
  BILLABLE_TYPE_OPTIONS,
  billsStaffedHours,
  canonicalBillingType,
  type CanonicalBillingType,
} from '../utils/staffingCapacity/billingModel'

const currency = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const currencyRate = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

type FormEntryMode = 'capacity' | 'manual'

type FormFactorDraft = {
  id: string
  name: string
  kind: RevenueProjectionFactorKind
  defaultValue: string
}

type FormCostLineDraft = {
  id: string
  name: string
  category: string
  amountUsdPerWeek: string
}

type FormState = {
  entryMode: FormEntryMode
  sourceScenarioId: string
  clientName: string
  lobProjectName: string
  location: string
  projectCode: string
  billingType: CanonicalBillingType
  channel: ChannelType | ''
  agentGroup: string
  billRateMethod: RevProjBillRateMethod
  billRateMethods: RevProjBillRateMethod[]
  defaults: Record<keyof RevenueProjectionLobDefaults, string>
  factors: FormFactorDraft[]
  costLines: FormCostLineDraft[]
}

function emptyForm(): FormState {
  const d = DEFAULT_REV_PROJ_DEFAULTS
  return {
    entryMode: 'capacity',
    sourceScenarioId: '',
    clientName: '',
    lobProjectName: '',
    location: '',
    projectCode: '',
    billingType: 'Production Hours',
    channel: '',
    agentGroup: '',
    billRateMethod: 'hourly',
    billRateMethods: ['hourly'],
    defaults: {
      aht: String(d.aht),
      loginHours: String(d.loginHours),
      absenteeismPct: String(d.absenteeismPct),
      shrinkagePct: String(d.shrinkagePct),
      occupancyPct: String(d.occupancyPct),
      hourlyBillRate: String(d.hourlyBillRate),
      monthlyBillRate: String(d.monthlyBillRate),
      perMinuteBillRate: String(d.perMinuteBillRate),
      perTransactionBillRate: String(d.perTransactionBillRate),
      hourlySalaryUsd: '',
      monthlyLaborPerFteUsd: '',
      supportSalaryUsd: '',
      trainingSalaryRateUsd: '',
      otherCostUsd: '',
      revenueFactorPct: '',
      revenueAdjustmentUsd: '',
    },
    factors: [],
    costLines: [],
  }
}

function mergeDriverSnapshot(
  defaults: FormState['defaults'],
  snapshot: ReturnType<typeof driverSnapshotFromScenario>,
): FormState['defaults'] {
  if (!snapshot) return defaults
  return {
    ...defaults,
    aht: snapshot.aht || defaults.aht,
    loginHours: snapshot.loginHours || defaults.loginHours,
    occupancyPct: snapshot.occupancyPct || defaults.occupancyPct,
    shrinkagePct: snapshot.shrinkagePct || defaults.shrinkagePct,
    absenteeismPct: snapshot.absenteeismPct || defaults.absenteeismPct,
  }
}

function applyPickToForm(
  prev: FormState,
  pick: CapacityPlanPickOption,
  scenario: PlannerScenario | undefined,
  channelOverride?: ChannelType | '',
): FormState {
  const channel =
    channelOverride !== undefined
      ? channelOverride
      : pick.channels.includes(prev.channel as ChannelType)
        ? prev.channel
        : (pick.channels[0] ?? '')
  return {
    ...prev,
    entryMode: 'capacity',
    sourceScenarioId: pick.scenarioId,
    clientName: pick.client,
    lobProjectName: pick.lob,
    location: pick.location,
    projectCode: pick.projectCode,
    billingType: pick.billingType,
    channel,
    defaults: mergeDriverSnapshot(prev.defaults, scenario ? driverSnapshotFromScenario(scenario, channel) : null),
    factors: prev.factors,
    costLines: prev.costLines,
  }
}

function defaultsFromForm(form: FormState): RevenueProjectionLobDefaults {
  const num = (raw: string, fallback: number) => {
    const trimmed = raw.trim()
    if (trimmed === '') return fallback
    const v = Number(trimmed)
    return Number.isFinite(v) && v >= 0 ? v : fallback
  }
  const positive = (raw: string, fallback: number) => {
    const v = num(raw, fallback)
    return v > 0 ? v : fallback
  }
  const signed = (raw: string, fallback: number) => {
    const trimmed = raw.trim()
    if (trimmed === '') return fallback
    const v = Number(trimmed)
    return Number.isFinite(v) ? v : fallback
  }
  const d = DEFAULT_REV_PROJ_DEFAULTS
  return {
    aht: num(form.defaults.aht, d.aht),
    loginHours: positive(form.defaults.loginHours, d.loginHours),
    absenteeismPct: num(form.defaults.absenteeismPct, d.absenteeismPct),
    shrinkagePct: num(form.defaults.shrinkagePct, d.shrinkagePct),
    occupancyPct: num(form.defaults.occupancyPct, d.occupancyPct),
    hourlyBillRate: num(form.defaults.hourlyBillRate, d.hourlyBillRate),
    monthlyBillRate: num(form.defaults.monthlyBillRate, d.monthlyBillRate),
    perMinuteBillRate: num(form.defaults.perMinuteBillRate, d.perMinuteBillRate),
    perTransactionBillRate: num(form.defaults.perTransactionBillRate, d.perTransactionBillRate),
    hourlySalaryUsd: num(form.defaults.hourlySalaryUsd, 0),
    monthlyLaborPerFteUsd: num(form.defaults.monthlyLaborPerFteUsd, 0),
    supportSalaryUsd: num(form.defaults.supportSalaryUsd, 0),
    trainingSalaryRateUsd: num(form.defaults.trainingSalaryRateUsd, 0),
    otherCostUsd: num(form.defaults.otherCostUsd, 0),
    revenueFactorPct: signed(form.defaults.revenueFactorPct, 0),
    revenueAdjustmentUsd: signed(form.defaults.revenueAdjustmentUsd, 0),
  }
}

function factorsFromForm(form: FormState): RevenueProjectionNamedFactor[] {
  const signed = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === '') return 0
    const value = Number(trimmed)
    return Number.isFinite(value) ? value : 0
  }
  return form.factors
    .map((item) =>
      createRevenueProjectionFactor({
        id: item.id,
        name: item.name,
        kind: item.kind,
        defaultValue: signed(item.defaultValue),
      }),
    )
    .filter((item) => item.name || item.defaultValue !== 0)
}

function costLinesFromForm(form: FormState): RevenueProjectionCostLine[] {
  const amount = (raw: string) => {
    const trimmed = raw.trim()
    if (trimmed === '') return 0
    const value = Number(trimmed)
    return Number.isFinite(value) && value > 0 ? value : 0
  }
  return form.costLines
    .map((item) =>
      createRevenueProjectionCostLine({
        id: item.id,
        name: item.name,
        category: item.category,
        amountUsdPerWeek: amount(item.amountUsdPerWeek),
      }),
    )
    .filter((item) => item.name || item.amountUsdPerWeek > 0)
}

function formatCell(rowId: RevProjMetricRowId, value: number): string {
  if (
    rowId === 'totalRevenue' ||
    rowId === 'discountOrLessToRevenue' ||
    rowId === 'revenueAdjustmentUsd' ||
    rowId === 'totalCost' ||
    rowId === 'grossMargin'
  ) {
    return currency.format(value)
  }
  if (
    rowId === 'hourlyBillRate' ||
    rowId === 'monthlyBillRate' ||
    rowId === 'perMinuteBillRate' ||
    rowId === 'perTransactionBillRate'
  ) {
    return currencyRate.format(value)
  }
  if (rowId === 'revenueFactorPct') {
    const sign = value > 0 ? '+' : ''
    return `${sign}${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
  }
  if (rowId === 'absenteeismPct' || rowId === 'shrinkagePct' || rowId === 'occupancyPct' || rowId === 'gmPct') {
    return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`
  }
  if (rowId === 'productiveHours' || rowId === 'productiveHoursPostOcc' || rowId === 'extraHours') {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (rowId === 'capacity' || rowId === 'fte') {
    return value.toLocaleString(undefined, { maximumFractionDigits: rowId === 'fte' ? 2 : 0 })
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function metricStoredValue(
  line: RevenueProjectionLobLine,
  month: string,
  rowId: RevProjMetricRowId,
  options?: RevenueProjectionComputeOptions,
): string {
  const input = line.months[month] ?? emptyMonthInput()
  if (
    rowId === 'fte' &&
    line.useStaffingAbsenteeismShrinkage &&
    !input.fteManual &&
    options?.fte != null &&
    Number.isFinite(options.fte)
  ) {
    return ''
  }
  if (
    rowId === 'capacity' &&
    line.useStaffingAbsenteeismShrinkage &&
    !input.capacityManual &&
    options?.capacity != null &&
    Number.isFinite(options.capacity)
  ) {
    return ''
  }
  const map: Partial<Record<RevProjMetricRowId, number | null>> = {
    capacity: input.capacity,
    fte: input.fte,
    aht: input.aht,
    loginHours: input.loginHours,
    absenteeismPct: input.absenteeismPct,
    shrinkagePct: input.shrinkagePct,
    occupancyPct: input.occupancyPct,
    hourlyBillRate: input.hourlyBillRate,
    monthlyBillRate: input.monthlyBillRate,
    perMinuteBillRate: input.perMinuteBillRate,
    perTransactionBillRate: input.perTransactionBillRate,
    discountOrLessToRevenue: input.discountOrLessToRevenue,
    extraHours: input.extraHours,
    revenueFactorPct: input.revenueFactorPct,
    revenueAdjustmentUsd: input.revenueAdjustmentUsd,
  }
  const raw = map[rowId]
  if (
    rowId === 'discountOrLessToRevenue' ||
    rowId === 'extraHours' ||
    rowId === 'revenueFactorPct' ||
    rowId === 'revenueAdjustmentUsd'
  ) {
    return raw == null ? '' : String(raw)
  }
  if (raw === null || raw === undefined) return ''
  return String(raw)
}

function metricPlaceholder(
  line: RevenueProjectionLobLine,
  rowId: RevProjMetricRowId,
  options?: RevenueProjectionComputeOptions,
): string {
  const d = line.defaults
  if (rowId === 'capacity' && options?.capacity != null && Number.isFinite(options.capacity)) {
    return String(options.capacity)
  }
  if (rowId === 'fte' && options?.fte != null && Number.isFinite(options.fte)) {
    return String(options.fte)
  }
  if (rowId === 'aht') return String(d.aht)
  if (rowId === 'loginHours') return String(d.loginHours)
  if (rowId === 'absenteeismPct') return String(d.absenteeismPct)
  if (rowId === 'shrinkagePct') return String(d.shrinkagePct)
  if (rowId === 'occupancyPct') return String(d.occupancyPct)
  if (rowId === 'hourlyBillRate') return d.hourlyBillRate ? String(d.hourlyBillRate) : '0'
  if (rowId === 'monthlyBillRate') return d.monthlyBillRate ? String(d.monthlyBillRate) : '0'
  if (rowId === 'perMinuteBillRate') return d.perMinuteBillRate ? String(d.perMinuteBillRate) : '0'
  if (rowId === 'perTransactionBillRate')
    return d.perTransactionBillRate ? String(d.perTransactionBillRate) : '0'
  if (rowId === 'revenueFactorPct') return d.revenueFactorPct ? String(d.revenueFactorPct) : '0'
  if (rowId === 'revenueAdjustmentUsd') return d.revenueAdjustmentUsd ? String(d.revenueAdjustmentUsd) : '0'
  if (rowId === 'capacity' || rowId === 'fte' || rowId === 'discountOrLessToRevenue' || rowId === 'extraHours')
    return '0'
  return ''
}

function revenueHint(method: RevProjBillRateMethod, fteBilling = false): string {
  if (fteBilling) {
    if (method === 'hourly') {
      return 'FTE × hourly rate × Productive Hours. Productive Hours = network days × login hours × (1 − absenteeism − shrinkage). Weekly Overview uses 5 network days so weeks sum to this month.'
    }
    if (method === 'monthly') return 'FTE × monthly rate'
    if (method === 'per_transaction') return 'Capacity / transactions × unit rate (AHT is not used)'
    return 'FTE × Productive Hours × 60 × per-minute rate'
  }
  return REV_PROJ_BILL_RATE_METHODS.find((item) => item.value === method)?.hint ?? ''
}

function isRateRowId(rowId: RevProjMetricRowId): boolean {
  return (
    rowId === 'hourlyBillRate' ||
    rowId === 'monthlyBillRate' ||
    rowId === 'perMinuteBillRate' ||
    rowId === 'perTransactionBillRate'
  )
}

function rateRowMethod(rowId: RevProjMetricRowId): RevProjBillRateMethod | null {
  if (rowId === 'hourlyBillRate') return 'hourly'
  if (rowId === 'monthlyBillRate') return 'monthly'
  if (rowId === 'perMinuteBillRate') return 'per_minute'
  if (rowId === 'perTransactionBillRate') return 'per_transaction'
  return null
}

function metricRowValue(
  rowId: RevProjMetricRowId,
  computed: ReturnType<typeof computeRevenueProjectionMonth>,
): number {
  if (rowId === 'productiveHours') return computed.productiveHours
  if (rowId === 'productiveHoursPostOcc') return computed.productiveHoursPostOcc
  if (rowId === 'absenteeismPct') return computed.absenteeismPct
  if (rowId === 'shrinkagePct') return computed.shrinkagePct
  if (rowId === 'totalCost') return computed.totalCost
  if (rowId === 'grossMargin') return computed.grossMargin
  if (rowId === 'gmPct') return computed.gmPct ?? 0
  if (rowId === 'totalRevenue') return computed.totalRevenue
  if (rowId === 'capacity') return computed.capacity
  if (rowId === 'fte') return computed.fte
  if (rowId === 'extraHours') return computed.extraHours
  if (rowId === 'revenueFactorPct') return computed.revenueFactorPct
  if (rowId === 'revenueAdjustmentUsd') return computed.revenueAdjustmentUsd
  if (rowId === 'occupancyPct') return computed.occupancyPct
  return 0
}

function RevenueProjectionLobSheet({
  line,
  months,
  resolveLineOptions,
  onMonthCommit,
  onFactorCommit,
}: {
  line: RevenueProjectionLobLine
  months: string[]
  resolveLineOptions: (line: RevenueProjectionLobLine, month: string) => RevenueProjectionComputeOptions | undefined
  onMonthCommit: (month: string, field: keyof RevenueProjectionMonthInput, parsed: number | null) => void
  onFactorCommit: (month: string, factorId: string, parsed: number | null) => void
}) {
  return (
    <div className="cap-revproj__sheet-wrap">
      <table className="cap-revproj-sheet">
        <thead>
          <tr>
            <th>Client and LOB Name</th>
            {months.map((month) => (
              <th key={month}>
                {formatFiscalMonthLabel(month)}
                <span className="cap-revproj-sheet__days">
                  {computeRevenueProjectionMonth(line, month, resolveLineOptions(line, month)).networkDays}d
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {REV_PROJ_METRIC_ROWS.filter((row) => {
            const method = rateRowMethod(row.id)
            if (method) return enabledBillRateMethods(line).includes(method)
            return true
          }).map((row) => {
            const isTotal =
              row.id === 'totalRevenue' ||
              row.id === 'totalCost' ||
              row.id === 'grossMargin' ||
              row.id === 'gmPct'
            const rowMethod = rateRowMethod(row.id)
            const isActiveRate = rowMethod != null && enabledBillRateMethods(line).includes(rowMethod)
            const isFteRow = row.id === 'fte'
            const staffingRow = row.id === 'absenteeismPct' || row.id === 'shrinkagePct'
            const anyStaffingLocked =
              staffingRow &&
              line.useStaffingAbsenteeismShrinkage &&
              months.some((month) => resolveLineOptions(line, month) != null)
            return (
              <Fragment key={row.id}>
                {row.id === 'discountOrLessToRevenue'
                  ? (line.revenueFactors ?? []).map((factor) => (
                      <tr key={factor.id}>
                        <td>
                          {factorSheetLabel(factor)}
                          <span className="cap-revproj-sheet__active-tag"> ± factor</span>
                        </td>
                        {months.map((month) => {
                          const input = line.months[month] ?? emptyMonthInput()
                          const stored = input.factorValues?.[factor.id]
                          return (
                            <td key={month} className="cap-revproj-sheet__input-cell">
                              <StableNumberInput
                                allowNegative
                                step={0.01}
                                value={stored == null ? '' : String(stored)}
                                placeholder={factor.defaultValue ? String(factor.defaultValue) : '0'}
                                onCommit={(parsed) => onFactorCommit(month, factor.id, parsed)}
                                aria-label={`${factorSheetLabel(factor)} ${formatFiscalMonthLabel(month)}`}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    ))
                  : null}
                <tr
                  className={
                    isTotal
                      ? 'cap-revproj-sheet__total'
                      : isActiveRate || isFteRow
                        ? 'cap-revproj-sheet__active-rate'
                        : undefined
                  }
                >
                <td>
                  {row.label}
                  {isActiveRate ? <span className="cap-revproj-sheet__active-tag"> active</span> : null}
                  {isFteRow && line.useStaffingAbsenteeismShrinkage ? (
                    <span className="cap-revproj-sheet__active-tag"> avg of weeks</span>
                  ) : isFteRow ? (
                    <span className="cap-revproj-sheet__active-tag"> FTE billing</span>
                  ) : null}
                  {row.id === 'capacity' && line.useStaffingAbsenteeismShrinkage ? (
                    <span className="cap-revproj-sheet__active-tag"> sum of weeks</span>
                  ) : null}
                  {anyStaffingLocked ? (
                    <span className="cap-revproj-sheet__active-tag"> from Staffing Plan</span>
                  ) : null}
                </td>
                {months.map((month) => {
                  const options = resolveLineOptions(line, month)
                  const computed = computeRevenueProjectionMonth(line, month, options)
                  const staffingLocked = Boolean(staffingRow && line.useStaffingAbsenteeismShrinkage && options)
                  if (!row.editable || staffingLocked) {
                    const value = metricRowValue(row.id, computed)
                    const show =
                      row.id === 'totalRevenue' ||
                      row.id === 'totalCost' ||
                      row.id === 'grossMargin' ||
                      row.id === 'gmPct'
                        ? computed.totalRevenue !== 0 ||
                          computed.totalCost !== 0 ||
                          computed.extraHours > 0 ||
                          computed.discountOrLessToRevenue > 0 ||
                          computed.revenueFactorPct !== 0 ||
                          computed.revenueAdjustmentUsd !== 0 ||
                          (computed.fte > 0 || computed.capacity > 0)
                        : row.id === 'absenteeismPct' || row.id === 'shrinkagePct'
                          ? true
                          : value > 0
                    return (
                      <td key={month} className="cap-revproj-sheet__computed">
                        {show ? formatCell(row.id, value) : '—'}
                      </td>
                    )
                  }

                  const field = row.id as keyof RevenueProjectionMonthInput
                  const isRateRow = isRateRowId(row.id) || row.id === 'discountOrLessToRevenue'
                  const isSignedRow = row.id === 'revenueFactorPct' || row.id === 'revenueAdjustmentUsd'
                  return (
                    <td key={month} className="cap-revproj-sheet__input-cell">
                      <StableNumberInput
                        min={isSignedRow ? undefined : 0}
                        allowNegative={isSignedRow}
                        step={
                          row.id === 'fte' ||
                          isRateRow ||
                          isSignedRow ||
                          row.id === 'extraHours' ||
                          row.id === 'revenueFactorPct'
                            ? 0.01
                            : row.id === 'capacity'
                              ? 1
                              : 0.01
                        }
                        value={metricStoredValue(line, month, row.id, options)}
                        placeholder={metricPlaceholder(line, row.id, options)}
                        onCommit={(parsed) => onMonthCommit(month, field, parsed)}
                        aria-label={`${row.label} ${formatFiscalMonthLabel(month)}`}
                      />
                    </td>
                  )
                })}
                </tr>
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function RevenueProjectionCombinedSheet({
  months,
  rows,
}: {
  months: string[]
  rows: ReturnType<typeof combineRevenueProjectionMonths>
}) {
  const byMonth = new Map(rows.map((row) => [row.month, row]))
  return (
    <div className="cap-revproj__sheet-wrap">
      <table className="cap-revproj-sheet">
        <thead>
          <tr>
            <th>Combined metrics</th>
            {months.map((month) => (
              <th key={month}>{formatFiscalMonthLabel(month)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Capacity / Transactions</td>
            {months.map((month) => {
              const row = byMonth.get(month)
              return (
                <td key={month}>{row && row.capacity > 0 ? row.capacity.toLocaleString() : '—'}</td>
              )
            })}
          </tr>
          <tr>
            <td>FTE</td>
            {months.map((month) => {
              const row = byMonth.get(month)
              return <td key={month}>{row && row.fte > 0 ? row.fte.toLocaleString() : '—'}</td>
            })}
          </tr>
          <tr>
            <td>Productive hours</td>
            {months.map((month) => {
              const row = byMonth.get(month)
              return (
                <td key={month}>
                  {row && row.productiveHours > 0
                    ? row.productiveHours.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : '—'}
                </td>
              )
            })}
          </tr>
          <tr>
            <td>Productive Hours post Occupancy</td>
            {months.map((month) => {
              const row = byMonth.get(month)
              return (
                <td key={month}>
                  {row && row.productiveHoursPostOcc > 0
                    ? row.productiveHoursPostOcc.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : '—'}
                </td>
              )
            })}
          </tr>
          <tr className="cap-revproj-sheet__total">
            <td>Total Revenue</td>
            {months.map((month) => {
              const row = byMonth.get(month)
              return <td key={month}>{row && row.totalRevenue > 0 ? currency.format(row.totalRevenue) : '—'}</td>
            })}
          </tr>
          <tr className="cap-revproj-sheet__total">
            <td>Total Cost</td>
            {months.map((month) => {
              const row = byMonth.get(month)
              return <td key={month}>{row && row.totalCost > 0 ? currency.format(row.totalCost) : '—'}</td>
            })}
          </tr>
          <tr className="cap-revproj-sheet__total">
            <td>Gross Margin</td>
            {months.map((month) => {
              const row = byMonth.get(month)
              return (
                <td key={month}>
                  {row && (row.totalRevenue !== 0 || row.totalCost !== 0)
                    ? currency.format(row.grossMargin)
                    : '—'}
                </td>
              )
            })}
          </tr>
          <tr className="cap-revproj-sheet__total">
            <td>GM %</td>
            {months.map((month) => {
              const row = byMonth.get(month)
              return (
                <td key={month}>
                  {row && row.gmPct != null
                    ? `${row.gmPct.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
                    : '—'}
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

export function RevenueProjectionsPage() {
  const { isAdmin } = useDemoSession()
  const {
    scenarios,
    getScenarioLedger,
    getScenarioForecast,
    getScenarioCapacityPlanOverrides,
    getScenarioShrinkageCategories,
  } = usePlanner()
  const {
    calendarYear,
    client,
    industry,
    location,
    lobId,
    channel,
    showNextYear,
    financialLobOptions,
    setClient,
  } = useIdealFinancial()
  const [lines, setLines] = useState<RevenueProjectionLobLine[]>(() => loadRevenueProjectionLines())
  const [savedLines, setSavedLines] = useState<RevenueProjectionLobLine[]>(lines)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [chartsOpen, setChartsOpen] = useState(false)
  const workspaceRevision = useWorkspaceSnapshotRevision()

  const fiscalStartYear = Number(calendarYear) || new Date().getFullYear()
  const months = useMemo(() => listFiscalMonthKeys(fiscalStartYear), [fiscalStartYear])
  const nextYearMonths = useMemo(() => listFiscalMonthKeys(fiscalStartYear + 1), [fiscalStartYear])
  const nextFiscalYear = fiscalStartYear + 1
  const scopedLines = useMemo(
    () => (isAdmin ? lines : filterRevenueLinesForAccessiblePlans(lines, scenarios)),
    [isAdmin, lines, scenarios],
  )
  const clients = useMemo(() => listRevenueProjectionClients(scopedLines), [scopedLines])
  const locations = useMemo(() => listRevenueProjectionLocations(scopedLines), [scopedLines])
  const capacityPicks = useMemo(() => listCapacityPlanPickOptions(scenarios), [scenarios])
  const scenarioById = useMemo(
    () => new Map(scenarios.map((scenario) => [scenario.id, scenario])),
    [scenarios],
  )
  const clientPlanPicks = useMemo(
    () => filterCapacityPlanPicks(capacityPicks, { client: form.clientName }),
    [capacityPicks, form.clientName],
  )
  const locationPlanPicks = useMemo(
    () =>
      filterCapacityPlanPicks(capacityPicks, {
        client: form.clientName,
        location: form.location,
      }),
    [capacityPicks, form.clientName, form.location],
  )
  const lobPlanPicks = useMemo(
    () =>
      filterCapacityPlanPicks(capacityPicks, {
        client: form.clientName,
        location: form.location,
        lob: form.lobProjectName,
      }),
    [capacityPicks, form.clientName, form.lobProjectName, form.location],
  )
  const capacityClientOptions = useMemo(() => uniquePickClients(capacityPicks), [capacityPicks])
  const capacityLocationOptions = useMemo(
    () => uniquePickLocations(form.clientName ? clientPlanPicks : capacityPicks),
    [capacityPicks, clientPlanPicks, form.clientName],
  )
  const capacityLobOptions = useMemo(() => {
    const source = form.location ? locationPlanPicks : form.clientName ? clientPlanPicks : capacityPicks
    return uniquePickLobs(source)
  }, [capacityPicks, clientPlanPicks, form.clientName, form.location, locationPlanPicks])
  const capacityChannelOptions = useMemo(() => {
    const source = form.lobProjectName ? lobPlanPicks : form.location ? locationPlanPicks : clientPlanPicks
    return uniquePickChannels(source.length ? source : capacityPicks)
  }, [capacityPicks, clientPlanPicks, form.lobProjectName, form.location, locationPlanPicks, lobPlanPicks])
  const selectedCapacityPick =
    capacityPicks.find((pick) => pick.scenarioId === form.sourceScenarioId) ??
    (lobPlanPicks.length === 1 ? lobPlanPicks[0] : undefined)
  const usingCapacity = form.entryMode === 'capacity'
  const selectedLob = financialLobOptions.find((item) => item.id === lobId)

  const staffingLookup: StaffingDriverLookup = useMemo(
    () => ({
      scenarios,
      getLedger: getScenarioLedger,
      getOverrides: getScenarioCapacityPlanOverrides,
      getShrinkageCategories: getScenarioShrinkageCategories,
      getCapacityRows: (scenarioId: string) => {
        const scenario = scenarios.find((item) => item.id === scenarioId)
        if (!scenario) return []
        return deriveCapacityPlanRows(
          getScenarioLedger(scenarioId),
          scenario,
          getScenarioForecast(scenarioId, 52),
          getScenarioCapacityPlanOverrides(scenarioId),
        ).map((row) => ({
          week: row.week,
          productionFte: row.planned.productionFte,
          volume: row.planned.volume,
        }))
      },
    }),
    [scenarios, getScenarioLedger, getScenarioForecast, getScenarioCapacityPlanOverrides, getScenarioShrinkageCategories],
  )

  const visibleLines = useMemo(() => {
    return scopedLines.filter((line) => {
      if (industry) {
        const lineIndustry = resolveClientIndustry(line.clientName)
        if (lineIndustry.toLowerCase() !== industry.toLowerCase()) return false
      }
      if (client && line.clientName.trim().toLowerCase() !== client.trim().toLowerCase()) {
        return false
      }
      if (location && line.location.trim().toLowerCase() !== location.trim().toLowerCase()) {
        return false
      }
      if (selectedLob) {
        if (line.clientName.trim().toLowerCase() !== selectedLob.client.trim().toLowerCase()) return false
        if (line.lobProjectName.trim().toLowerCase() !== selectedLob.lob.trim().toLowerCase()) return false
      }
      if (channel) {
        const lineChannel = resolveRevenueProjectionChannel(line, scenarios)
        if (lineChannel !== channel) return false
      }
      return true
    })
  }, [channel, client, industry, location, scenarios, scopedLines, selectedLob])

  const resolveLineOptions = useMemo(() => {
    return (line: RevenueProjectionLobLine, month: string): RevenueProjectionComputeOptions | undefined => {
      if (!line.useStaffingAbsenteeismShrinkage) return undefined
      const drivers = resolveStaffingMonthDrivers(line, month, staffingLookup)
      const options: RevenueProjectionComputeOptions = {}
      if (drivers.hasData) {
        options.absenteeismPct = Number.isFinite(drivers.absenteeismPct) ? drivers.absenteeismPct : 0
        options.shrinkagePct = Number.isFinite(drivers.shrinkagePct) ? drivers.shrinkagePct : 0
      }
      if (drivers.hasVolumeData) {
        options.fte = drivers.fte
        options.capacity = drivers.capacity
      }
      if (
        options.absenteeismPct == null &&
        options.shrinkagePct == null &&
        options.fte == null &&
        options.capacity == null
      ) {
        return undefined
      }
      return options
    }
  }, [staffingLookup])

  const selectedClient = client
  const clientLobs = useMemo(
    () => (selectedClient ? listClientLobs(scopedLines, selectedClient) : []),
    [scopedLines, selectedClient],
  )
  const combinedMonths = useMemo(
    () => combineRevenueProjectionMonths(visibleLines, months, resolveLineOptions),
    [visibleLines, months, resolveLineOptions],
  )

  const combinedNextYearMonths = useMemo(() => {
    if (!showNextYear) return []
    return combineRevenueProjectionMonths(visibleLines, nextYearMonths, resolveLineOptions)
  }, [showNextYear, visibleLines, nextYearMonths, resolveLineOptions])

  const yearCombinedRevenue = useMemo(
    () => combinedMonths.reduce((sum, row) => sum + row.totalRevenue, 0),
    [combinedMonths],
  )
  const yearCombinedCost = useMemo(
    () => combinedMonths.reduce((sum, row) => sum + row.totalCost, 0),
    [combinedMonths],
  )
  const yearCombinedMargin = yearCombinedRevenue - yearCombinedCost

  const dirty = useMemo(() => JSON.stringify(lines) !== JSON.stringify(savedLines), [lines, savedLines])
  useEffect(() => {
    if (workspaceRevision === 0 || dirty) return
    const next = loadRevenueProjectionLines()
    setLines(next)
    setSavedLines(next)
  }, [dirty, workspaceRevision])
  const { isBlocked: navigationBlocked, proceed: proceedNavigation, cancel: cancelNavigation } =
    useUnsavedChangesGuard({ when: dirty })

  function persist(next: RevenueProjectionLobLine[]) {
    setLines(next)
    setSavedLines(next)
    saveRevenueProjectionLines(next)
    void flushWorkspaceSync()
  }

  function saveSetup() {
    persist(lines)
    setMessage('Setup saved.')
  }

  function applyCapacityPick(pick: CapacityPlanPickOption, channelOverride?: ChannelType | '') {
    setForm((prev) => applyPickToForm(prev, pick, scenarioById.get(pick.scenarioId), channelOverride))
  }

  function setCapacityClient(clientName: string) {
    const remaining = filterCapacityPlanPicks(capacityPicks, { client: clientName })
    if (remaining.length === 1) {
      applyCapacityPick(remaining[0]!)
      return
    }
    setForm((prev) => ({
      ...prev,
      entryMode: 'capacity',
      sourceScenarioId: remaining.some((pick) => pick.scenarioId === prev.sourceScenarioId)
        ? prev.sourceScenarioId
        : '',
      clientName,
      location: remaining.some((pick) => pick.location === prev.location) ? prev.location : '',
      lobProjectName: remaining.some((pick) => pick.lob === prev.lobProjectName) ? prev.lobProjectName : '',
      projectCode: remaining.some((pick) => pick.projectCode === prev.projectCode) ? prev.projectCode : '',
      channel: remaining.some((pick) => pick.channels.includes(prev.channel as ChannelType))
        ? prev.channel
        : '',
    }))
  }

  function setCapacityLocation(location: string) {
    const remaining = filterCapacityPlanPicks(capacityPicks, {
      client: form.clientName,
      location,
    })
    if (remaining.length === 1) {
      applyCapacityPick(remaining[0]!)
      return
    }
    setForm((prev) => ({
      ...prev,
      entryMode: 'capacity',
      sourceScenarioId: remaining.some((pick) => pick.scenarioId === prev.sourceScenarioId)
        ? prev.sourceScenarioId
        : '',
      location,
      lobProjectName: remaining.some((pick) => pick.lob === prev.lobProjectName) ? prev.lobProjectName : '',
      channel: remaining.some((pick) => pick.channels.includes(prev.channel as ChannelType))
        ? prev.channel
        : '',
    }))
  }

  function setCapacityLob(lobProjectName: string) {
    const remaining = filterCapacityPlanPicks(capacityPicks, {
      client: form.clientName,
      location: form.location,
      lob: lobProjectName,
    })
    const fallback = filterCapacityPlanPicks(capacityPicks, {
      client: form.clientName,
      lob: lobProjectName,
    })
    const match = remaining.length === 1 ? remaining[0] : fallback.length === 1 ? fallback[0] : remaining[0] ?? fallback[0]
    if (match) {
      applyCapacityPick(match)
      return
    }
    setForm((prev) => ({ ...prev, entryMode: 'capacity', lobProjectName, sourceScenarioId: '' }))
  }

  function setCapacityChannel(channel: ChannelType | '') {
    const remaining = filterCapacityPlanPicks(capacityPicks, {
      client: form.clientName,
      location: form.location,
      lob: form.lobProjectName,
      channel,
    })
    const match =
      remaining.find((pick) => pick.scenarioId === form.sourceScenarioId) ?? remaining[0] ?? selectedCapacityPick
    if (match) {
      applyCapacityPick(match, channel)
      return
    }
    setForm((prev) => ({ ...prev, channel }))
  }

  function toggleStaffingDrivers(lineId: string, enabled: boolean) {
    const next = lines.map((line) => {
      if (line.id !== lineId) return line
      const months = enabled
        ? Object.fromEntries(
            Object.entries(line.months).map(([month, input]) => [
              month,
              { ...input, fteManual: false, capacityManual: false },
            ]),
          )
        : line.months
      return {
        ...line,
        useStaffingAbsenteeismShrinkage: enabled,
        months,
        updatedAt: new Date().toISOString(),
      }
    })
    setLines(next)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const clientName = form.clientName.trim()
    const lobProjectName = form.lobProjectName.trim()
    const location = form.location.trim()
    if (usingCapacity && !capacityPicks.length) {
      setMessage('No Capacity Plans found. Switch to Manual entry, or create a client plan first.')
      return
    }
    if (usingCapacity && !selectedCapacityPick && !lobProjectName) {
      setMessage('Choose a Capacity Plan, or switch to Manual entry for finance-only projects.')
      return
    }
    if (!clientName || !lobProjectName) {
      setMessage('Client Name and LOB / Project Name are required.')
      return
    }
    if (!location) {
      setMessage('Site is required.')
      return
    }
    if (
      !isAdmin &&
      !findMatchingStaffingScenario(
        {
          clientName,
          lobProjectName,
          location,
          projectCode: form.projectCode.trim(),
        } as Parameters<typeof findMatchingStaffingScenario>[0],
        scenarios,
      )
    ) {
      setMessage('You can only add revenue lines for capacity plans an admin granted you.')
      return
    }

    const payload = {
      clientName,
      lobProjectName,
      location,
      projectCode: form.projectCode.trim(),
      billingType: form.billingType,
      channel: form.channel,
      agentGroup: form.agentGroup.trim(),
      billRateMethod: form.billRateMethod,
      billRateMethods: form.billRateMethods.includes(form.billRateMethod)
        ? form.billRateMethods
        : [form.billRateMethod, ...form.billRateMethods],
      defaults: defaultsFromForm(form),
      revenueFactors: factorsFromForm(form),
      costLines: costLinesFromForm(form),
    }

    if (editingId) {
      const existing = lines.find((line) => line.id === editingId)
      if (!existing) return
      persist(upsertRevenueProjectionLine(lines, { ...existing, ...payload }))
      setMessage(`Saved setup for ${lobProjectName} (${location}).`)
    } else {
      const created = createRevenueProjectionLine({
        ...payload,
        useStaffingAbsenteeismShrinkage: usingCapacity,
        months: {},
      })
      persist([...lines, created])
      setMessage(`Saved setup for ${lobProjectName} (${clientName} · ${location}). Enter month values below, then Save Setup.`)
      setClient(clientName)
    }

    setForm((prev) => ({
      ...emptyForm(),
      entryMode: prev.entryMode,
      clientName,
      location,
      billRateMethod: prev.billRateMethod,
      billRateMethods: prev.billRateMethods,
      defaults: prev.defaults,
      factors: [],
      costLines: [],
    }))
    setEditingId(null)
  }

  function startEdit(line: RevenueProjectionLobLine) {
    setEditingId(line.id)
    const enabled = enabledBillRateMethods(line)
    const rateValue = (method: RevProjBillRateMethod, value: number) =>
      enabled.includes(method) ? String(value) : '0'
    const matchedScenario = findMatchingStaffingScenario(line, scenarios)
    const matchedPlan =
      findCapacityPlanPickForLine(capacityPicks, line) ??
      (matchedScenario
        ? capacityPicks.find((pick) => pick.scenarioId === matchedScenario.id) ?? null
        : null)
    const entryMode: FormEntryMode = matchedPlan ? 'capacity' : 'manual'
    setForm({
      entryMode,
      sourceScenarioId: matchedPlan?.scenarioId ?? '',
      clientName: line.clientName,
      lobProjectName: line.lobProjectName,
      location: line.location,
      projectCode: line.projectCode,
      billingType: canonicalBillingType(line.billingType),
      channel: resolveRevenueProjectionChannel(line, scenarios),
      agentGroup: line.agentGroup,
      billRateMethod: line.billRateMethod,
      billRateMethods: enabledBillRateMethods(line),
      defaults: {
        aht: String(line.defaults.aht),
        loginHours: String(line.defaults.loginHours),
        absenteeismPct: String(line.defaults.absenteeismPct),
        shrinkagePct: String(line.defaults.shrinkagePct),
        occupancyPct: String(line.defaults.occupancyPct),
        hourlyBillRate: rateValue('hourly', line.defaults.hourlyBillRate),
        monthlyBillRate: rateValue('monthly', line.defaults.monthlyBillRate),
        perMinuteBillRate: rateValue('per_minute', line.defaults.perMinuteBillRate),
        perTransactionBillRate: rateValue('per_transaction', line.defaults.perTransactionBillRate),
        hourlySalaryUsd: line.defaults.hourlySalaryUsd ? String(line.defaults.hourlySalaryUsd) : '',
        monthlyLaborPerFteUsd: line.defaults.monthlyLaborPerFteUsd
          ? String(line.defaults.monthlyLaborPerFteUsd)
          : '',
        supportSalaryUsd: line.defaults.supportSalaryUsd ? String(line.defaults.supportSalaryUsd) : '',
        trainingSalaryRateUsd: line.defaults.trainingSalaryRateUsd
          ? String(line.defaults.trainingSalaryRateUsd)
          : '',
        otherCostUsd: line.defaults.otherCostUsd ? String(line.defaults.otherCostUsd) : '',
        revenueFactorPct: line.defaults.revenueFactorPct ? String(line.defaults.revenueFactorPct) : '',
        revenueAdjustmentUsd: line.defaults.revenueAdjustmentUsd
          ? String(line.defaults.revenueAdjustmentUsd)
          : '',
      },
      factors: (line.revenueFactors ?? []).map((factor) => ({
        id: factor.id,
        name: factor.name,
        kind: factor.kind,
        defaultValue: factor.defaultValue ? String(factor.defaultValue) : '',
      })),
      costLines: (line.costLines ?? []).map((costLine) => ({
        id: costLine.id,
        name: costLine.name,
        category: costLine.category,
        amountUsdPerWeek: costLine.amountUsdPerWeek ? String(costLine.amountUsdPerWeek) : '',
      })),
    })
    setClient(line.clientName)
    setMessage(`Editing ${line.lobProjectName}.`)
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm())
    setMessage('')
  }

  function removeLine(id: string) {
    const target = lines.find((line) => line.id === id)
    if (!target) return
    if (
      !window.confirm(
        `Remove ${target.lobProjectName} (${target.location}) from Revenue Projections?`,
      )
    ) {
      return
    }
    persist(deleteRevenueProjectionLine(lines, id))
    if (editingId === id) cancelEdit()
    setMessage(`Removed ${target.lobProjectName}.`)
  }

  function setMonthField(
    lineId: string,
    month: string,
    field: keyof RevenueProjectionMonthInput,
    parsed: number | null,
  ) {
    setLines((current) =>
      current.map((line) => {
        if (line.id !== lineId) return line
        const prevMonth = line.months[month] ?? emptyMonthInput()
        const nextMonth = { ...prevMonth, [field]: parsed }
        if (field === 'fte') nextMonth.fteManual = parsed != null
        if (field === 'capacity') nextMonth.capacityManual = parsed != null
        return {
          ...line,
          months: {
            ...line.months,
            [month]: nextMonth,
          },
          updatedAt: new Date().toISOString(),
        }
      }),
    )
  }

  function setMonthFactorValue(lineId: string, month: string, factorId: string, parsed: number | null) {
    setLines((current) =>
      current.map((line) => {
        if (line.id !== lineId) return line
        const prevMonth = line.months[month] ?? emptyMonthInput()
        return {
          ...line,
          months: {
            ...line.months,
            [month]: {
              ...prevMonth,
              factorValues: { ...(prevMonth.factorValues ?? {}), [factorId]: parsed },
            },
          },
          updatedAt: new Date().toISOString(),
        }
      }),
    )
  }

  return (
    <div className="cap-revproj">
      {message ? (
        <p className="cap-revproj__message" role="status">
          {message}
        </p>
      ) : null}

      <section className="cap-panel cap-panel--accent cap-revproj__combined">
        <div className="cap-revproj__combined-head">
          <div>
            <h3 className="cap-panel__title">
              {selectedClient || 'All clients'}
            </h3>
          </div>
          <div className="cap-revproj__kpi">
            <span className="cap-revproj__kpi-label">FY projected revenue</span>
            <strong className="cap-revproj__kpi-value">{currency.format(yearCombinedRevenue)}</strong>
          </div>
          <div className="cap-revproj__kpi">
            <span className="cap-revproj__kpi-label">FY projected cost</span>
            <strong className="cap-revproj__kpi-value">{currency.format(yearCombinedCost)}</strong>
          </div>
          <div className="cap-revproj__kpi">
            <span className="cap-revproj__kpi-label">FY gross margin</span>
            <strong className="cap-revproj__kpi-value">{currency.format(yearCombinedMargin)}</strong>
          </div>
          <div className="cap-revproj__kpi">
            <span className="cap-revproj__kpi-label">FY GM %</span>
            <strong className="cap-revproj__kpi-value">
              {yearCombinedRevenue > 0
                ? `${((yearCombinedMargin / yearCombinedRevenue) * 100).toLocaleString(undefined, {
                    maximumFractionDigits: 1,
                  })}%`
                : '—'}
            </strong>
          </div>
        </div>
        {selectedClient ? (
          <ul className="cap-revproj__lob-list">
            {clientLobs
              .filter((lob) => visibleLines.some((line) => line.id === lob.id))
              .map((lob) => (
                <li key={lob.id}>
                  <strong>{lob.lobProjectName}</strong>
                  <span>{lob.location}</span>
                  <span>{lob.projectCode || 'no code'}</span>
                  <span>
                    {currency.format(
                      lineYearRevenue(lob, months, (month) => resolveLineOptions(lob, month)),
                    )}
                  </span>
                </li>
              ))}
          </ul>
        ) : null}
        {combinedMonths[0]?.lobCount ? (
          <>
            <div className="cap-revproj__charts-toggle-row">
              <button
                type="button"
                className="saas-btn saas-btn--secondary saas-btn--sm"
                aria-expanded={chartsOpen}
                onClick={() => setChartsOpen((open) => !open)}
              >
                {chartsOpen ? 'Hide charts' : 'Show charts'}
              </button>
            </div>
            {chartsOpen ? (
              <RevenueProjectionCharts months={months} combined={combinedMonths} lines={visibleLines} />
            ) : null}
            <RevenueProjectionCombinedSheet months={months} rows={combinedMonths} />
            {showNextYear ? (
              <div className="cap-revproj__next-year">
                <p className="cap-revproj__next-year-title">Next year · {nextFiscalYear}</p>
                <RevenueProjectionCombinedSheet months={nextYearMonths} rows={combinedNextYearMonths} />
              </div>
            ) : null}
          </>
        ) : (
          <p className="cap-panel__desc">No revenue projection lines match the current filters.</p>
        )}
      </section>

      <section className="cap-panel cap-revproj__form-panel">
        <h3 className="cap-panel__title">
          {editingId ? 'Edit Client / LOB' : 'Add Client, Site & LOB'}
        </h3>
        <p className="cap-panel__desc">
          Choose the same Client, Site, LOB, channel, and billing type from{' '}
          <Link to="/setup">Create a new client plan</Link>. Manual entry is optional for projects
          that do not need a Capacity Plan but still need Financial Overview and Revenue Projection.
        </p>
        <form className="cap-revproj__form" onSubmit={handleSubmit}>
          <div className="cap-revproj__source-mode" role="group" aria-label="How to add this client and LOB">
            <button
              type="button"
              className={`cap-revproj__source-btn${usingCapacity ? ' cap-revproj__source-btn--active' : ''}`}
              onClick={() =>
                setForm((prev) => {
                  const match = findCapacityPlanPickForLine(capacityPicks, {
                    clientName: prev.clientName,
                    lobProjectName: prev.lobProjectName,
                    location: prev.location,
                    projectCode: prev.projectCode,
                    channel: prev.channel,
                  })
                  if (match) return applyPickToForm(prev, match, scenarioById.get(match.scenarioId))
                  return { ...prev, entryMode: 'capacity' }
                })
              }
            >
              From Capacity Plan
            </button>
            <button
              type="button"
              className={`cap-revproj__source-btn${usingCapacity ? '' : ' cap-revproj__source-btn--active'}`}
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  entryMode: 'manual',
                  sourceScenarioId: '',
                }))
              }
            >
              Manual (finance only)
            </button>
          </div>
          {usingCapacity ? (
            <>
              <label className="cap-revproj__plan-picker">
                <span>Capacity plan</span>
                <select
                  value={selectedCapacityPick?.scenarioId ?? ''}
                  onChange={(event) => {
                    const pick = capacityPicks.find((item) => item.scenarioId === event.target.value)
                    if (pick) applyCapacityPick(pick)
                    else {
                      setForm((prev) => ({
                        ...prev,
                        sourceScenarioId: '',
                        clientName: '',
                        lobProjectName: '',
                        location: '',
                        projectCode: '',
                        channel: '',
                      }))
                    }
                  }}
                >
                  <option value="">
                    {capacityPicks.length ? 'Select a Capacity Plan' : 'No Capacity Plans yet'}
                  </option>
                  {capacityPicks.map((pick) => (
                    <option key={pick.scenarioId} value={pick.scenarioId}>
                      {pick.label}
                    </option>
                  ))}
                </select>
                <span className="cap-revproj__field-hint">
                  {selectedCapacityPick
                    ? `Linked to Capacity Plan: ${selectedCapacityPick.label} · ${selectedCapacityPick.billingType}.`
                    : capacityPicks.length
                      ? 'Filters below match Create a new client plan. Selecting a plan fills Client, Site, LOB, channel, client code, and billing type.'
                      : 'Create a client plan first, or switch to Manual entry for finance-only projects.'}
                </span>
              </label>
              <label>
                <span>Client Name</span>
                <select
                  value={form.clientName}
                  onChange={(event) => setCapacityClient(event.target.value)}
                  required
                >
                  <option value="">Select a client</option>
                  {capacityClientOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Site</span>
                <select
                  value={form.location}
                  onChange={(event) => setCapacityLocation(event.target.value)}
                  required
                >
                  <option value="">Select a site</option>
                  {capacityLocationOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>LOB / Project Name</span>
                <select
                  value={form.lobProjectName}
                  onChange={(event) => setCapacityLob(event.target.value)}
                  required
                >
                  <option value="">Select a LOB</option>
                  {capacityLobOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Client Code</span>
                <input value={form.projectCode} readOnly />
              </label>
              <label className="cap-revproj__channel-field">
                <span>Supported channel</span>
                <select
                  value={form.channel}
                  onChange={(event) => setCapacityChannel((event.target.value as ChannelType | '') || '')}
                  required={capacityChannelOptions.length > 0}
                >
                  <option value="">Select a channel</option>
                  {capacityChannelOptions.map((channel) => (
                    <option key={channel} value={channel}>
                      {CHANNEL_LABELS[channel]}
                    </option>
                  ))}
                </select>
                <span className="cap-revproj__field-hint">
                  Each LOB uses one channel for staffing assumptions and Required Production FTE.
                </span>
              </label>
              <label>
                <span>Billing type</span>
                <select value={form.billingType} disabled>
                  {BILLABLE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <p className="cap-revproj__manual-note">
                Manual rows are for Financial data and Revenue Projection only. They do not create a
                Capacity Plan.
              </p>
              <label>
                <span>Client Name</span>
                <input
                  list="revproj-client-names"
                  value={form.clientName}
                  onChange={(event) => setForm((prev) => ({ ...prev, clientName: event.target.value }))}
                  placeholder="e.g. Retail"
                  required
                />
                <datalist id="revproj-client-names">
                  {[...new Set([...capacityClientOptions, ...clients])].map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>
              <label>
                <span>Site</span>
                <input
                  list="revproj-locations"
                  value={form.location}
                  onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
                  placeholder="e.g. Manila"
                  required
                />
                <datalist id="revproj-locations">
                  {[...new Set([...uniquePickLocations(capacityPicks), ...locations])].map((loc) => (
                    <option key={loc} value={loc} />
                  ))}
                </datalist>
              </label>
              <label>
                <span>LOB / Project Name</span>
                <input
                  list="revproj-lobs"
                  value={form.lobProjectName}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, lobProjectName: event.target.value }))
                  }
                  placeholder="e.g. Voice · Tier 1"
                  required
                />
                <datalist id="revproj-lobs">
                  {uniquePickLobs(capacityPicks).map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>
              <label>
                <span>Client Code</span>
                <input
                  value={form.projectCode}
                  onChange={(event) => setForm((prev) => ({ ...prev, projectCode: event.target.value }))}
                />
              </label>
              <div className="cap-revproj__channel-field">
                <ChannelSelector
                  selected={form.channel ? [form.channel] : []}
                  onChange={(next) => setForm((prev) => ({ ...prev, channel: next[0] ?? '' }))}
                  required={false}
                  compact
                  single
                />
              </div>
              <label>
                <span>Billing type</span>
                <select
                  value={form.billingType}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      billingType: canonicalBillingType(event.target.value),
                    }))
                  }
                >
                  {BILLABLE_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label>
            <span>Bill rate method</span>
            <select
              value={form.billRateMethod}
              onChange={(event) => {
                const nextMethod = event.target.value as RevProjBillRateMethod
                setForm((prev) => {
                  const nextRates = zeroInactiveBillRates(nextMethod, {
                    hourlyBillRate: Number(prev.defaults.hourlyBillRate) || 0,
                    monthlyBillRate: Number(prev.defaults.monthlyBillRate) || 0,
                    perMinuteBillRate: Number(prev.defaults.perMinuteBillRate) || 0,
                    perTransactionBillRate: Number(prev.defaults.perTransactionBillRate) || 0,
                  })
                  return {
                    ...prev,
                    billRateMethod: nextMethod,
                    billRateMethods: [nextMethod],
                    defaults: {
                      ...prev.defaults,
                      hourlyBillRate: String(nextRates.hourlyBillRate),
                      monthlyBillRate: String(nextRates.monthlyBillRate),
                      perMinuteBillRate: String(nextRates.perMinuteBillRate),
                      perTransactionBillRate: String(nextRates.perTransactionBillRate),
                    },
                  }
                })
              }}
            >
              {REV_PROJ_BILL_RATE_METHODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Group of Agents</span>
            <input
              value={form.agentGroup}
              onChange={(event) => setForm((prev) => ({ ...prev, agentGroup: event.target.value }))}
            />
          </label>

          <div className="cap-revproj__defaults">
            <p className="cap-revproj__defaults-title">
              Default monthly drivers &amp; bill rates (override per month in sheet)
            </p>
            <div className="cap-revproj__defaults-grid">
              {(
                [
                  ['aht', 'AHT'],
                  ['loginHours', 'Login Hours'],
                  ['absenteeismPct', 'Absenteeism %'],
                  ['shrinkagePct', 'In office Shrinkage'],
                  ['occupancyPct', 'Occupancy %'],
                  ['hourlyBillRate', 'Hourly Bill Rate'],
                  ['monthlyBillRate', 'Monthly Bill Rate'],
                  ['perMinuteBillRate', 'Per Minute Bill Rate'],
                  ['perTransactionBillRate', 'Per Chat / Sale / Transaction'],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <StableNumberInput
                    min={0}
                    step={0.01}
                    value={form.defaults[key]}
                    onChange={(raw) =>
                      setForm((prev) => ({
                        ...prev,
                        defaults: { ...prev.defaults, [key]: raw },
                      }))
                    }
                    placeholder={key.includes('BillRate') || key === 'perTransactionBillRate' ? '0' : undefined}
                    aria-label={label}
                  />
                </label>
              ))}
            </div>
            <fieldset className="cap-revproj__method-set">
              <legend>Include in Total Revenue</legend>
              <p className="cap-revproj__field-hint">
                Primary method is always included. Check additional methods to add their formulas. A rate of 0
                contributes 0 — another method is never substituted.
              </p>
              <div className="cap-revproj__method-checks">
                {REV_PROJ_BILL_RATE_METHODS.map((option) => {
                  const checked = form.billRateMethods.includes(option.value)
                  const isPrimary = option.value === form.billRateMethod
                  return (
                    <label key={option.value}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isPrimary}
                        onChange={() =>
                          setForm((prev) => {
                            const next = new Set(prev.billRateMethods)
                            if (next.has(option.value)) next.delete(option.value)
                            else next.add(option.value)
                            next.add(prev.billRateMethod)
                            return { ...prev, billRateMethods: [...next] }
                          })
                        }
                      />
                      <span>
                        {option.label}
                        {isPrimary ? ' (primary)' : ''}
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
            <p className="cap-revproj__field-hint" style={{ marginTop: '0.65rem' }}>
              Active: {billRateMethodsLabel(form.billRateMethods)} —{' '}
              {form.billRateMethods
                .map((method) => revenueHint(method, billsStaffedHours(form.billingType)))
                .join(' ')}
            </p>
          </div>

          <div className="cap-revproj__defaults">
            <p className="cap-revproj__defaults-title">
              Cost details for GM (optional — saved on this Client · LOB)
            </p>
            <div className="cap-revproj__defaults-grid">
              {(
                [
                  ['hourlySalaryUsd', 'Hourly salary (USD)'],
                  ['monthlyLaborPerFteUsd', 'Monthly labor / FTE (optional)'],
                  ['supportSalaryUsd', 'Support salary / week'],
                  ['trainingSalaryRateUsd', 'Training salary / HC / week'],
                  ['otherCostUsd', 'Other cost / week'],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  <span>{label}</span>
                  <StableNumberInput
                    min={0}
                    step={0.01}
                    value={form.defaults[key]}
                    onChange={(raw) =>
                      setForm((prev) => ({
                        ...prev,
                        defaults: { ...prev.defaults, [key]: raw },
                      }))
                    }
                    placeholder="Optional"
                    aria-label={label}
                  />
                </label>
              ))}
            </div>
            <p className="cap-revproj__field-hint" style={{ marginTop: '0.65rem' }}>
              Leave blank to skip base cost / GM. Monthly cost = labor (FTE × productive hours × hourly
              salary, or FTE × monthly labor when that is filled) + support, training, and other
              costs scaled by working weeks, plus any cost detail lines below. Gross margin =
              revenue − cost. Overview uses these same costs for the matching Client · LOB.
            </p>
          </div>

          <div className="cap-revproj__defaults cap-revproj__defaults--costs">
            <p className="cap-revproj__defaults-title">
              Cost breakdown (optional — weekly $, custom categories)
            </p>
            {form.costLines.length === 0 ? (
              <p className="cap-revproj__field-hint" style={{ margin: 0 }}>
                Add named cost lines such as Team leads, Software licenses, or Facilities. Choose a
                suggested category or type your own (Salary, OPEX, Benefits, etc.). Each line is
                weekly USD and rolls into Total Cost and GM for this Client · LOB (and Capacity
                Overview for the same scope).
              </p>
            ) : (
              <div className="cap-revproj__factor-list">
                {form.costLines.map((costLine, index) => (
                  <div key={costLine.id} className="cap-revproj__factor-row cap-revproj__cost-row">
                    <label>
                      <span>Name</span>
                      <input
                        value={costLine.name}
                        maxLength={80}
                        placeholder="e.g. Team leads"
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            costLines: prev.costLines.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, name: event.target.value } : item,
                            ),
                          }))
                        }
                        aria-label={`Cost line ${index + 1} name`}
                      />
                    </label>
                    <label>
                      <span>Category</span>
                      <input
                        list="cap-revproj-cost-categories"
                        value={costLine.category}
                        maxLength={MAX_COST_CATEGORY_LENGTH}
                        placeholder="e.g. Salary or Benefits"
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            costLines: prev.costLines.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, category: event.target.value }
                                : item,
                            ),
                          }))
                        }
                        aria-label={`${costLine.name || 'Cost line'} category`}
                      />
                    </label>
                    <label>
                      <span>$ / week</span>
                      <StableNumberInput
                        min={0}
                        step={0.01}
                        value={costLine.amountUsdPerWeek}
                        onChange={(raw) =>
                          setForm((prev) => ({
                            ...prev,
                            costLines: prev.costLines.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, amountUsdPerWeek: raw } : item,
                            ),
                          }))
                        }
                        placeholder="0"
                        aria-label={`${costLine.name || 'Cost line'} weekly amount`}
                      />
                    </label>
                    <button
                      type="button"
                      className="cap-revproj__btn"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          costLines: prev.costLines.filter((_, itemIndex) => itemIndex !== index),
                        }))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <datalist id="cap-revproj-cost-categories">
              {COST_CATEGORY_SUGGESTIONS.map((suggestion) => (
                <option key={suggestion} value={suggestion} />
              ))}
            </datalist>
            <button
              type="button"
              className="cap-revproj__btn cap-revproj__add-factor"
              disabled={form.costLines.length >= MAX_COST_LINES}
              onClick={() =>
                setForm((prev) => {
                  if (prev.costLines.length >= MAX_COST_LINES) return prev
                  const created = createRevenueProjectionCostLine({
                    name: '',
                    category: 'Salary',
                    amountUsdPerWeek: 0,
                  })
                  return {
                    ...prev,
                    costLines: [
                      ...prev.costLines,
                      {
                        id: created.id,
                        name: '',
                        category: 'Salary',
                        amountUsdPerWeek: '',
                      },
                    ],
                  }
                })
              }
            >
              Add cost line
            </button>
            {form.costLines.length > 0 ? (
              <p className="cap-revproj__field-hint" style={{ marginTop: '0.65rem' }}>
                Weekly extras:{' '}
                {(() => {
                  const summed = sumCostLinesWeekly(costLinesFromForm(form))
                  const mix =
                    summed.byCategory.length > 0
                      ? summed.byCategory
                          .map((row) => `${row.category} ${currency.format(row.amountUsd)}`)
                          .join(' · ')
                      : 'none'
                  return `${mix} · Total ${currency.format(summed.totalUsd)}`
                })()}
                . Scaled by working weeks into monthly Total Cost.
              </p>
            ) : null}
          </div>

          <div className="cap-revproj__defaults cap-revproj__defaults--factors">
            <p className="cap-revproj__defaults-title">
              Factors affecting Revenue Projections (optional ±)
            </p>
            {form.factors.length === 0 ? (
              <p className="cap-revproj__field-hint" style={{ margin: 0 }}>
                Add a named factor such as seasonal uplift, SLA bonus, or client concession. Each one
                can be a percent or a dollar amount and is saved on this Client · LOB.
              </p>
            ) : (
              <div className="cap-revproj__factor-list">
                {form.factors.map((factor, index) => (
                  <div key={factor.id} className="cap-revproj__factor-row">
                    <label>
                      <span>Name</span>
                      <input
                        value={factor.name}
                        maxLength={80}
                        placeholder="e.g. Peak season uplift"
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            factors: prev.factors.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, name: event.target.value } : item,
                            ),
                          }))
                        }
                        aria-label={`Factor ${index + 1} name`}
                      />
                    </label>
                    <label>
                      <span>Type</span>
                      <select
                        value={factor.kind}
                        onChange={(event) =>
                          setForm((prev) => ({
                            ...prev,
                            factors: prev.factors.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, kind: event.target.value as RevenueProjectionFactorKind }
                                : item,
                            ),
                          }))
                        }
                        aria-label={`${factor.name || 'Factor'} type`}
                      >
                        <option value="percent">± %</option>
                        <option value="amount">± $</option>
                      </select>
                    </label>
                    <label>
                      <span>Default {factor.kind === 'percent' ? '± %' : '± $'}</span>
                      <StableNumberInput
                        allowNegative
                        step={0.01}
                        value={factor.defaultValue}
                        onChange={(raw) =>
                          setForm((prev) => ({
                            ...prev,
                            factors: prev.factors.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, defaultValue: raw } : item,
                            ),
                          }))
                        }
                        placeholder={factor.kind === 'percent' ? '+10 or -5' : '+500 or -250'}
                        aria-label={`${factor.name || 'Factor'} default`}
                      />
                    </label>
                    <button
                      type="button"
                      className="cap-revproj__btn"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          factors: prev.factors.filter((_, itemIndex) => itemIndex !== index),
                        }))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="cap-revproj__btn cap-revproj__add-factor"
              disabled={form.factors.length >= MAX_REVENUE_FACTORS}
              onClick={() =>
                setForm((prev) => {
                  if (prev.factors.length >= MAX_REVENUE_FACTORS) return prev
                  const created = createRevenueProjectionFactor({ name: '', kind: 'percent', defaultValue: 0 })
                  return {
                    ...prev,
                    factors: [
                      ...prev.factors,
                      { id: created.id, name: '', kind: 'percent', defaultValue: '' },
                    ],
                  }
                })
              }
            >
              Add factor
            </button>
            <p className="cap-revproj__field-hint" style={{ marginTop: '0.65rem' }}>
              Applied after billed methods and extra hours: Total Revenue × (1 ± sum of % factors) ±
              sum of $ factors, then Discount is subtracted. Override any factor per month on the
              sheet. + increases revenue; − decreases it.
            </p>
          </div>

          <div className="cap-revproj__form-actions">
            <button type="submit" className="cap-revproj__btn cap-revproj__btn--primary">
              {editingId ? 'Save Setup' : 'Add to Revenue Projections'}
            </button>
            {editingId ? (
              <button type="button" className="cap-revproj__btn" onClick={cancelEdit}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
        <p className="cap-revproj__hint">
          Productive hours = network days × login hours × (1 − absenteeism − in office shrinkage). Productive
          Hours post Occupancy = Productive Hours × Occupancy. Extra hours add to Total Revenue at
          the active bill rate. Optional named ± factors then move Total Revenue up or down.
          Discount or Less to Revenue is deducted last. Toggle “Use Capacity Plan for FTE,
          Capacity / Transactions, Absenteeism &amp; Shrinkage” to pull monthly FTE (average of
          included weeks), Capacity / Transactions (sum of included weeks), and planned
          Absenteeism / Shrinkage from a matching Capacity Plan. Type over any month to override.
          Months without planned values keep your manual input or LOB defaults.
        </p>
      </section>

      {visibleLines.length === 0 ? (
        <section className="cap-panel">
          <p className="cap-revproj__empty">
            No revenue projection lines yet. Add a client, location, and LOB above.
          </p>
        </section>
      ) : (
        visibleLines.map((line) => {
          const yearRev = lineYearRevenue(line, months, (month) => resolveLineOptions(line, month))
          const matchedStaffing = line.useStaffingAbsenteeismShrinkage
            ? findStaffingScenarioForRevenueProjectionLine(line, staffingLookup)
            : null
          const staffingHasDrivers =
            line.useStaffingAbsenteeismShrinkage &&
            staffingScenarioHasDriverData(line, staffingLookup)
          const staffingMissingMatch = line.useStaffingAbsenteeismShrinkage && !matchedStaffing
          const staffingMissingDrivers =
            line.useStaffingAbsenteeismShrinkage &&
            Boolean(matchedStaffing) &&
            !staffingHasDrivers
          return (
            <section key={line.id} className="cap-revproj__lob-block">
              <div className="cap-revproj__lob-head">
                <div>
                  <h3 className="cap-revproj__lob-title">
                    {line.clientName} — {line.lobProjectName}
                  </h3>
                  <p className="cap-revproj__lob-meta">
                    {line.location}
                    {line.projectCode ? ` · ${line.projectCode}` : ''}
                    {line.agentGroup ? ` · ${line.agentGroup}` : ''}
                    {resolveRevenueProjectionChannel(line, scenarios)
                      ? ` · ${CHANNEL_LABELS[resolveRevenueProjectionChannel(line, scenarios) as ChannelType]}`
                      : ''}
                    {` · ${line.billingType}`}
                    {` · ${billRateMethodsLabel(enabledBillRateMethods(line))}`}
                    {` · FY revenue ${currency.format(yearRev)}`}
                    {` · cost ${currency.format(
                      lineYearCost(line, months, (month) => resolveLineOptions(line, month)),
                    )}`}
                    {` · GM ${currency.format(
                      lineYearMargin(line, months, (month) => resolveLineOptions(line, month)),
                    )}`}
                    {yearRev > 0
                      ? ` · GM % ${((lineYearMargin(line, months, (month) => resolveLineOptions(line, month)) / yearRev) * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
                      : ''}
                    {(() => {
                      const extras = sumCostLinesWeekly(line.costLines)
                      if (extras.totalUsd <= 0) return ''
                      return ` · cost lines ${currency.format(extras.totalUsd)}/wk (${line.costLines.length})`
                    })()}
                  </p>
                  <label className="cap-revproj__staffing-toggle">
                    <input
                      type="checkbox"
                      checked={line.useStaffingAbsenteeismShrinkage}
                      onChange={(event) => toggleStaffingDrivers(line.id, event.target.checked)}
                    />
                    <span>Use Capacity Plan for FTE, Capacity / Transactions, Absenteeism &amp; Shrinkage</span>
                  </label>
                  {matchedStaffing && staffingHasDrivers ? (
                    <p className="cap-revproj__staffing-ok" role="status">
                      Linked to Capacity Plan “{matchedStaffing.name || matchedStaffing.plan.client}
                      ”. FTE uses the average Production FTE of weeks in that month.
                      Capacity / Transactions uses the sum of weekly capacity. Absenteeism
                      uses planned Absenteeism; In office Shrinkage uses Total planned in office
                      shrinkage, including Break. Saved starting headcount is ignored until you
                      type a month value to override. Clear the cell to go back to the weekly
                      average / sum. Months without Capacity Plan weeks keep your manual input
                      or LOB defaults.
                    </p>
                  ) : null}
                  {staffingMissingMatch ? (
                    <p className="cap-revproj__staffing-warn" role="status">
                      No matching Staffing Plan found for this Client / Location / LOB. Absenteeism
                      and In office Shrinkage fall back to your month cells or LOB defaults. Align
                      Client Name and LOB with the Staffing Plan, or enter values manually.
                    </p>
                  ) : null}
                  {staffingMissingDrivers ? (
                    <p className="cap-revproj__staffing-warn" role="status">
                      Staffing Plan matched, but no planned Absenteeism / In office Shrinkage values
                      were found. Those rows stay on your manual input or LOB defaults until you
                      enter them on the Staffing Plan weekly grid.
                    </p>
                  ) : null}
                </div>
                <div className="cap-revproj__row-actions">
                  <button type="button" className="cap-revproj__link" onClick={() => startEdit(line)}>
                    Edit setup
                  </button>
                  <button
                    type="button"
                    className="cap-revproj__link cap-revproj__link--danger"
                    onClick={() => removeLine(line.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <RevenueProjectionLobSheet
                line={line}
                months={months}
                resolveLineOptions={resolveLineOptions}
                onMonthCommit={(month, field, parsed) => setMonthField(line.id, month, field, parsed)}
                onFactorCommit={(month, factorId, parsed) =>
                  setMonthFactorValue(line.id, month, factorId, parsed)
                }
              />
              {showNextYear ? (
                <div className="cap-revproj__next-year">
                  <p className="cap-revproj__next-year-title">
                    Next year · {nextFiscalYear}
                    {` · revenue ${currency.format(
                      lineYearRevenue(line, nextYearMonths, (month) => resolveLineOptions(line, month)),
                    )}`}
                    {` · cost ${currency.format(
                      lineYearCost(line, nextYearMonths, (month) => resolveLineOptions(line, month)),
                    )}`}
                    {` · GM ${currency.format(
                      lineYearMargin(line, nextYearMonths, (month) => resolveLineOptions(line, month)),
                    )}`}
                  </p>
                  <RevenueProjectionLobSheet
                    line={line}
                    months={nextYearMonths}
                    resolveLineOptions={resolveLineOptions}
                    onMonthCommit={(month, field, parsed) => setMonthField(line.id, month, field, parsed)}
                    onFactorCommit={(month, factorId, parsed) =>
                      setMonthFactorValue(line.id, month, factorId, parsed)
                    }
                  />
                </div>
              ) : null}
            </section>
          )
        })
      )}

      <div className="cap-revproj__save-bar" data-clean={dirty ? 'false' : 'true'}>
        <p className="cap-revproj__save-bar-copy">
          {dirty ? 'You have unsaved month or setup changes.' : 'All revenue projection changes are saved.'}
        </p>
        <button
          type="button"
          className="cap-revproj__btn cap-revproj__btn--primary"
          onClick={saveSetup}
          disabled={!dirty}
        >
          Save Setup
        </button>
      </div>

      {navigationBlocked ? (
        <UnsavedChangesDialog
          title="Save Setup?"
          message="You have unsaved revenue projection changes. Save Setup before leaving this page?"
          saveLabel="Save Setup"
          onSave={() => {
            saveSetup()
            proceedNavigation()
          }}
          onDiscard={proceedNavigation}
          onCancel={cancelNavigation}
        />
      ) : null}
    </div>
  )
}

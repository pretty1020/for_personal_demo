import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { usePlanner } from './PlannerContext'
import { combineCapacityRows, deriveCapacityPlanRows, type DerivedCapacityRow } from '../planner/capacityPlanDerived'
import {
  actualWeeklyRevenue,
  activeBillRate,
  billingUnitLabel,
  defaultBillingRateForType,
  plannedWeeklyRevenue,
  resolveWeeklyProductiveHours,
  WEEKS_PER_MONTH,
  type WeeklyBillingSpec,
} from '../planner/capacityBillingRevenue'
import {
  actualWeeklyTotalCost,
  productionLaborWeekly,
  plannedWeeklyTotalCost,
  summarizeCapacityFinancials,
  trainingPipelineWeekly,
  weeklyCostBreakdown,
  isActualCapacityWeek,
  isPlannedCapacityWeek,
  type CapacityFinancialSummary,
  type FinancialCostInputs,
} from '../planner/capacityFinancialCosts'
import { PORTFOLIO_FINANCIAL_SCOPE_ID, resolveCapacityFinancialScope, type FinancialCardFilters } from '../planner/capacityFinancialScope'
import { formulaScopeFromPlan } from '../planner/formulas/formulaRegistry'
import { useFormulaRevision } from '../hooks/useFormulaRevision'
import { flushWorkspaceSync } from '../data/workspaceSync'
import {
  loadRevenueProjectionLines,
  normalizeBillRateMethods,
  saveRevenueProjectionLines,
  sumCostLinesWeekly,
  sumNamedFactors,
  upsertRevenueProjectionLine,
  type RevProjBillRateMethod,
  type RevenueProjectionLobLine,
} from '../planner/revenueProjections/revenueProjectionPersistence'
import { findRevenueProjectionLineForScenario } from '../planner/revenueProjections/staffingMonthDrivers'
import {
  addCapacityLeakages,
  calculateCapacityRevenueLeakages,
  emptyCapacityLeakages,
  type CapacityLeakageDrivers,
} from '../planner/capacityRevenueLeakage'
import type {
  CapacityLeakageDetailRow,
  CapacityWeeklyLeakageRow,
} from '../planner/capacityLeakageDisplay'
import { filterCapacityRowsByWeekRange } from '../utils/capacityWeekRange'
import { billableTypeLabel, canonicalBillingType, type CanonicalBillingType } from '../utils/staffingCapacity/billingModel'
import { dominantMonthKeyFromWeekStart } from '../utils/staffingCapacity/calendarWeek'
import type { PlannerScenario } from '../planner/types'

const FORECAST_HORIZON = 52

function specFromProjectionLine(
  line: RevenueProjectionLobLine,
  overrides?: { billingType?: string; method?: RevProjBillRateMethod; rate?: number },
  weekIso?: string,
): WeeklyBillingSpec {
  const month = weekIso ? line.months[dominantMonthKeyFromWeekStart(weekIso)] : undefined
  const d = line.defaults
  const pick = (monthValue: number | null | undefined, fallback: number) =>
    monthValue != null && Number.isFinite(monthValue) ? monthValue : fallback

  const billingType = overrides?.billingType ?? line.billingType
  const billRateMethod = overrides?.method ?? line.billRateMethod
  let hourlyBillRate = pick(month?.hourlyBillRate, d.hourlyBillRate)
  let monthlyBillRate = pick(month?.monthlyBillRate, d.monthlyBillRate)
  let perMinuteBillRate = pick(month?.perMinuteBillRate, d.perMinuteBillRate)
  let perTransactionBillRate = pick(month?.perTransactionBillRate, d.perTransactionBillRate)
  const rate = overrides?.rate
  if (rate != null && Number.isFinite(rate) && rate > 0) {
    if (billRateMethod === 'monthly') monthlyBillRate = rate
    else if (billRateMethod === 'per_minute') perMinuteBillRate = rate
    else if (billRateMethod === 'per_transaction') perTransactionBillRate = rate
    else hourlyBillRate = rate
  }
  const namedFactors = sumNamedFactors(line.revenueFactors ?? [], month?.factorValues)
  const hasNamedFactors = (line.revenueFactors ?? []).length > 0
  return {
    billingType,
    billRateMethod,
    billRateMethods: overrides?.method
      ? normalizeBillRateMethods(
          (line.billRateMethods ?? []).filter(
            (method) => method !== line.billRateMethod && method !== billRateMethod,
          ),
          billRateMethod,
        )
      : line.billRateMethods,
    hourlyBillRate,
    monthlyBillRate,
    perMinuteBillRate,
    perTransactionBillRate,
    loginHours: pick(month?.loginHours, d.loginHours),
    absenteeismPct: pick(month?.absenteeismPct, d.absenteeismPct),
    shrinkagePct: pick(month?.shrinkagePct, d.shrinkagePct),
    extraHoursMonthly: pick(month?.extraHours, 0),
    revenueFactorPct: hasNamedFactors
      ? namedFactors.revenueFactorPct
      : pick(month?.revenueFactorPct, d.revenueFactorPct),
    revenueAdjustmentUsdMonthly: hasNamedFactors
      ? namedFactors.revenueAdjustmentUsd
      : pick(month?.revenueAdjustmentUsd, d.revenueAdjustmentUsd),
    discountUsdMonthly: pick(month?.discountOrLessToRevenue, 0),
  }
}

function costInputsFromProjectionLine(
  line: RevenueProjectionLobLine,
  scenario: PlannerScenario,
  drafts: {
    hourlyInput: string
    supportInput: string
    trainingRateInput: string
    otherCostInput: string
  },
  applyDrafts: boolean,
): FinancialCostInputs {
  const standardHours =
    scenario.assumptions.tenured.standardScheduledHoursPerWeek > 0
      ? scenario.assumptions.tenured.standardScheduledHoursPerWeek
      : 40
  const monthlyLabor = line.defaults.monthlyLaborPerFteUsd
  const derivedHourly =
    monthlyLabor > 0 ? monthlyLabor / (standardHours * WEEKS_PER_MONTH) : line.defaults.hourlySalaryUsd
  const parse = (raw: string, fallback: number) => {
    if (!applyDrafts || raw.trim() === '') return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
  }
  return {
    hourlySalaryUsd: parse(drafts.hourlyInput, Math.max(0, derivedHourly)),
    supportSalaryUsd: parse(drafts.supportInput, Math.max(0, line.defaults.supportSalaryUsd)),
    trainingSalaryRateUsd: parse(drafts.trainingRateInput, Math.max(0, line.defaults.trainingSalaryRateUsd)),
    otherCostUsd: parse(drafts.otherCostInput, Math.max(0, line.defaults.otherCostUsd)),
    extraSalaryUsd: sumCostLinesWeekly(line.costLines).salaryUsd,
    extraOpexUsd: sumCostLinesWeekly(line.costLines).opexUsd,
    standardHoursPerWeek: standardHours,
    loginHours: line.defaults.loginHours,
    absenteeismPct: line.defaults.absenteeismPct,
    shrinkagePct: line.defaults.shrinkagePct,
    monthlyLaborPerFteUsd: Math.max(0, monthlyLabor),
  }
}

function leakageBillingType(spec: WeeklyBillingSpec | undefined, billingType: string): string {
  if (spec?.billRateMethod === 'per_minute') return 'Per Minute'
  if (spec?.billRateMethod === 'per_transaction') return 'Transactional'
  if (spec?.billRateMethod === 'monthly') return 'FTE'
  return billingType
}

function resolveBillingRate(
  scenario: PlannerScenario,
  billingType: string,
  rateInput: string,
): number {
  const canon = canonicalBillingType(billingType)
  const defaultRate = defaultBillingRateForType(billingType)
  if (rateInput.trim() !== '') {
    const parsed = Number(rateInput)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  const stored = scenario.assumptions.business.billingRate
  if (stored > 0) {
    if (canon === 'FTE' && stored >= 500) return stored
    if (canon === 'Transactional' && stored <= 50) return stored
    if (canon === 'Production Hours' && stored >= 5 && stored <= 100) return stored
    if (canonicalBillingType(scenario.plan.billingType) === canon) return stored
  }
  return defaultRate
}

function costInputsForScenario(
  scenario: PlannerScenario,
  drafts: {
    hourlyInput: string
    supportInput: string
    trainingRateInput: string
    otherCostInput: string
  },
  applyDrafts: boolean,
): FinancialCostInputs {
  const business = scenario.assumptions.business
  const standardHours = scenario.assumptions.tenured.standardScheduledHoursPerWeek ?? 40
  const parse = (raw: string, fallback: number) => {
    if (!applyDrafts || raw.trim() === '') return fallback
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
  }
  const monthly = scenario.assumptions.tenured.laborCostPerFteMonthly
  const derivedHourly =
    business.hourlySalaryUsd > 0
      ? business.hourlySalaryUsd
      : monthly > 0
        ? monthly / (standardHours > 0 ? (standardHours * 52) / 12 : 173.33)
        : 22
  return {
    hourlySalaryUsd: parse(drafts.hourlyInput, derivedHourly),
    supportSalaryUsd: parse(drafts.supportInput, business.supportSalaryUsd > 0 ? business.supportSalaryUsd : 0),
    trainingSalaryRateUsd: parse(
      drafts.trainingRateInput,
      business.trainingSalaryRateUsd > 0 ? business.trainingSalaryRateUsd : 0,
    ),
    otherCostUsd: parse(drafts.otherCostInput, business.otherCostUsd > 0 ? business.otherCostUsd : 0),
    standardHoursPerWeek: standardHours > 0 ? standardHours : 40,
  }
}

function summarizeScenarioFinancials(
  capacityRows: DerivedCapacityRow[],
  billingType: string,
  billingRate: number,
  costInputs: FinancialCostInputs,
  spec?: WeeklyBillingSpec,
  formulaScope?: ReturnType<typeof formulaScopeFromPlan>,
  specForWeek?: (week: string) => WeeklyBillingSpec | undefined,
): {
  summary: CapacityFinancialSummary
  salaryCost: number
  trainingCost: number
  opex: number
  totalHours: number
  totalUnits: number
} {
  const standardHours = costInputs.standardHoursPerWeek
  const weeklyHours = resolveWeeklyProductiveHours(costInputs, standardHours, formulaScope)
  const canon = canonicalBillingType(billingType)
  const specForRow = (row: DerivedCapacityRow) => specForWeek?.(row.week) ?? spec
  const summary = summarizeCapacityFinancials(
    capacityRows,
    (row) => plannedWeeklyRevenue(row, billingType, billingRate, standardHours, specForRow(row), formulaScope),
    (row) => actualWeeklyRevenue(row, billingType, billingRate, standardHours, specForRow(row), formulaScope),
    costInputs,
    formulaScope,
  )

  let salaryCost = 0
  let trainingCost = 0
  let opex = 0
  let totalHours = 0
  let totalUnits = 0

  capacityRows.forEach((row) => {
    if (!isPlannedCapacityWeek(row)) return
    salaryCost += productionLaborWeekly(row.planned.productionFte, costInputs, formulaScope, row.week)
    salaryCost += Math.max(0, costInputs.supportSalaryUsd) + Math.max(0, costInputs.extraSalaryUsd ?? 0)
    trainingCost += trainingPipelineWeekly(
      row.planned.trainingHc,
      row.planned.nestingHc,
      costInputs.trainingSalaryRateUsd,
      formulaScope,
    )
    opex += Math.max(0, costInputs.otherCostUsd) + Math.max(0, costInputs.extraOpexUsd ?? 0)
    totalHours += row.planned.productionFte * weeklyHours
    if (canon === 'Transactional') totalUnits += Math.max(0, row.planned.volume)
    else if (canon === 'FTE') totalUnits += Math.max(0, row.planned.productionHc)
    else totalUnits += row.planned.productionFte * weeklyHours
  })

  return { summary, salaryCost, trainingCost, opex, totalHours, totalUnits }
}

export type CapacityWeeklyFinancialRow = {
  week: string
  status: string
  productionFte: number
  productionHc: number
  trainingHc: number
  nestingHc: number
  volume: number
  projectedRevenue: number
  projectedCost: number
  projectedLabor: number
  projectedTraining: number
  projectedSalarySupport: number
  projectedOpex: number
  actualRevenue: number
  actualCost: number
  isActual: boolean
}

export type CapacityFinancialModel = {
  hasScope: boolean
  scopeId: string
  isCombined: boolean
  isPortfolio: boolean
  scopeLabel: string
  billingType: string
  billingTypeLabel: string
  billRateMethod: RevProjBillRateMethod
  projectionLinked: boolean
  projectionLabel: string
  projectedRevenue: number
  actualRevenue: number
  projectedCost: number
  actualCost: number
  projectedMargin: number
  actualMargin: number
  projectedGmPct: number | null
  actualGmPct: number | null
  revPerHour: number
  costPerHour: number
  revPerUnit: number
  costPerUnit: number
  unitLabel: string
  salaryCost: number
  trainingCost: number
  opex: number
  totalCost: number
  totalHours: number
  totalUnits: number
  weeksWithActual: number
  weeksPlanned: number
  capacityRows: DerivedCapacityRow[]
  billingRate: number
  costInputs: FinancialCostInputs
  defaultRate: number
  standardHours: number
  leakages: CapacityLeakageDrivers
  weeklyLeakages: CapacityWeeklyLeakageRow[]
  leakageDetailRows: CapacityLeakageDetailRow[]
  weeklyFinancials: CapacityWeeklyFinancialRow[]
}

type CapacityFinancialContextValue = CapacityFinancialModel & {
  rateInput: string
  hourlyInput: string
  supportInput: string
  trainingRateInput: string
  otherCostInput: string
  billingTypeDraft: CanonicalBillingType
  billRateMethodDraft: RevProjBillRateMethod
  setRateInput: (v: string) => void
  setHourlyInput: (v: string) => void
  setSupportInput: (v: string) => void
  setTrainingRateInput: (v: string) => void
  setOtherCostInput: (v: string) => void
  setBillingTypeDraft: (v: CanonicalBillingType) => void
  setBillRateMethodDraft: (v: RevProjBillRateMethod) => void
  saveAssumptions: () => void
  scenarioId: string | null
}

const CapacityFinancialContext = createContext<CapacityFinancialContextValue | null>(null)

const EMPTY_MODEL: CapacityFinancialModel = {
  hasScope: false,
  scopeId: '',
  isCombined: false,
  isPortfolio: false,
  scopeLabel: '',
  billingType: 'Production Hours',
  billingTypeLabel: 'Production Hours',
  billRateMethod: 'hourly',
  projectionLinked: false,
  projectionLabel: '',
  projectedRevenue: 0,
  actualRevenue: 0,
  projectedCost: 0,
  actualCost: 0,
  projectedMargin: 0,
  actualMargin: 0,
  projectedGmPct: null,
  actualGmPct: null,
  revPerHour: 0,
  costPerHour: 0,
  revPerUnit: 0,
  costPerUnit: 0,
  unitLabel: 'hour',
  salaryCost: 0,
  trainingCost: 0,
  opex: 0,
  totalCost: 0,
  totalHours: 0,
  totalUnits: 0,
  weeksWithActual: 0,
  weeksPlanned: 0,
  capacityRows: [],
  billingRate: 0,
  costInputs: {
    hourlySalaryUsd: 0,
    supportSalaryUsd: 0,
    trainingSalaryRateUsd: 0,
    otherCostUsd: 0,
    standardHoursPerWeek: 40,
  },
  defaultRate: 0,
  standardHours: 40,
  leakages: emptyCapacityLeakages(),
  weeklyLeakages: [],
  leakageDetailRows: [],
  weeklyFinancials: [],
}

function addWeeklyFinancial(
  byWeek: Map<string, CapacityWeeklyFinancialRow>,
  row: DerivedCapacityRow,
  billingType: string,
  billingRate: number,
  costInputs: FinancialCostInputs,
  spec?: WeeklyBillingSpec,
  formulaScope?: ReturnType<typeof formulaScopeFromPlan>,
) {
  const hours = costInputs.standardHoursPerWeek
  const isActual = isActualCapacityWeek(row)
  const isPlanned = isPlannedCapacityWeek(row)
  const productionFte = isPlanned ? row.planned.productionFte : row.actual.productionFte
  const productionHc = isPlanned ? row.planned.productionHc : row.actual.productionHc
  const trainingHc = isPlanned ? row.planned.trainingHc : row.actual.trainingHc
  const nestingHc = isPlanned ? row.planned.nestingHc : row.actual.nestingHc
  const volume = isPlanned ? row.planned.volume : (row.actual.handledVolume ?? row.actual.volume)
  const projectedRevenue = plannedWeeklyRevenue(row, billingType, billingRate, hours, spec, formulaScope)
  const projectedCost = plannedWeeklyTotalCost(row, costInputs, formulaScope)
  const breakdown = weeklyCostBreakdown(
    isPlanned ? row.planned.productionFte : row.actual.productionFte,
    isPlanned ? row.planned.trainingHc : row.actual.trainingHc,
    isPlanned ? row.planned.nestingHc : row.actual.nestingHc,
    costInputs,
    formulaScope,
    row.week,
  )
  const resolvedActualRevenue = isActual
    ? actualWeeklyRevenue(row, billingType, billingRate, hours, spec, formulaScope)
    : null
  const resolvedActualCost = isActual ? actualWeeklyTotalCost(row, costInputs, formulaScope) : null

  const existing = byWeek.get(row.week)
  if (!existing) {
    byWeek.set(row.week, {
      week: row.week,
      status: isActual ? 'Actual' : row.statusLabel,
      productionFte,
      productionHc,
      trainingHc,
      nestingHc,
      volume,
      projectedRevenue,
      projectedCost,
      projectedLabor: breakdown.labor,
      projectedTraining: breakdown.training,
      projectedSalarySupport: breakdown.salarySupport,
      projectedOpex: breakdown.opex,
      actualRevenue: resolvedActualRevenue ?? projectedRevenue,
      actualCost: resolvedActualCost ?? projectedCost,
      isActual,
    })
    return
  }

  existing.productionFte += productionFte
  existing.productionHc += productionHc
  existing.trainingHc += trainingHc
  existing.nestingHc += nestingHc
  existing.volume += volume
  existing.projectedRevenue += projectedRevenue
  existing.projectedCost += projectedCost
  existing.projectedLabor += breakdown.labor
  existing.projectedTraining += breakdown.training
  existing.projectedSalarySupport += breakdown.salarySupport
  existing.projectedOpex += breakdown.opex
  if (isActual) {
    existing.actualRevenue = existing.isActual
      ? existing.actualRevenue + (resolvedActualRevenue ?? 0)
      : (resolvedActualRevenue ?? projectedRevenue)
    existing.actualCost = existing.isActual
      ? existing.actualCost + (resolvedActualCost ?? 0)
      : (resolvedActualCost ?? projectedCost)
    existing.status = 'Actual'
    existing.isActual = true
  } else if (!existing.isActual) {
    existing.actualRevenue += projectedRevenue
    existing.actualCost += projectedCost
  }
}

export function CapacityFinancialProvider({
  weekStart = '',
  weekEnd = '',
  scopeId,
  cardFilters,
  children,
}: {
  weekStart?: string
  weekEnd?: string
  scopeId?: string
  cardFilters?: FinancialCardFilters
  children: ReactNode
}) {
  const {
    scenarios,
    getScenarioLedger,
    getScenarioForecast,
    getScenarioCapacityPlanOverrides,
    updateAssumptions,
    updateScenarioPlan,
  } = usePlanner()
  const formulaRevision = useFormulaRevision()

  const scope = useMemo(
    () =>
      resolveCapacityFinancialScope(scenarios, {
        cardFilters,
        scopeId: cardFilters ? undefined : scopeId || undefined,
        preferPortfolio: !scopeId || scopeId === PORTFOLIO_FINANCIAL_SCOPE_ID,
      }),
    [cardFilters, scenarios, scopeId],
  )
  const scenario = scope?.linkedScenario ?? null

  const [rateInput, setRateInput] = useState('')
  const [hourlyInput, setHourlyInput] = useState('')
  const [supportInput, setSupportInput] = useState('')
  const [trainingRateInput, setTrainingRateInput] = useState('')
  const [otherCostInput, setOtherCostInput] = useState('')
  const [billingTypeDraft, setBillingTypeDraft] = useState<CanonicalBillingType>('Production Hours')
  const [billRateMethodDraft, setBillRateMethodDraft] = useState<RevProjBillRateMethod>('hourly')
  const [projectionTick, setProjectionTick] = useState(0)

  useEffect(() => {
    const refresh = () => setProjectionTick((value) => value + 1)
    window.addEventListener('revenue-projection-changed', refresh)
    window.addEventListener('formula-registry-changed', refresh)
    const onStorage = (event: StorageEvent) => {
      if (
        event.key &&
        event.key !== 'wfp-formula-registry-v1' &&
        event.key !== 'wfp-revenue-projection-lines-v2' &&
        event.key !== 'wfp-revenue-projection-lines-v1'
      ) {
        return
      }
      refresh()
    }
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('revenue-projection-changed', refresh)
      window.removeEventListener('formula-registry-changed', refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const projectionLines = useMemo(() => loadRevenueProjectionLines(), [projectionTick])
  const matchedProjection = useMemo(
    () => (scenario ? findRevenueProjectionLineForScenario(scenario, projectionLines) : null),
    [projectionLines, scenario],
  )

  useEffect(() => {
    if (!scenario) {
      setBillingTypeDraft('Production Hours')
      setBillRateMethodDraft('hourly')
      return
    }
    if (matchedProjection) {
      setBillingTypeDraft(canonicalBillingType(matchedProjection.billingType))
      setBillRateMethodDraft(matchedProjection.billRateMethod)
      setRateInput(String(activeBillRate(matchedProjection.defaults ? {
        billRateMethod: matchedProjection.billRateMethod,
        hourlyBillRate: matchedProjection.defaults.hourlyBillRate,
        monthlyBillRate: matchedProjection.defaults.monthlyBillRate,
        perMinuteBillRate: matchedProjection.defaults.perMinuteBillRate,
        perTransactionBillRate: matchedProjection.defaults.perTransactionBillRate,
      } : { billRateMethod: 'hourly', hourlyBillRate: 0, monthlyBillRate: 0, perMinuteBillRate: 0, perTransactionBillRate: 0 })))
      const hours = scenario.assumptions.tenured.standardScheduledHoursPerWeek || 40
      const monthlyLabor = matchedProjection.defaults.monthlyLaborPerFteUsd
      const hourlySalary =
        monthlyLabor > 0 ? monthlyLabor / (hours * WEEKS_PER_MONTH) : matchedProjection.defaults.hourlySalaryUsd
      setHourlyInput(hourlySalary ? String(hourlySalary) : '')
      setSupportInput(matchedProjection.defaults.supportSalaryUsd ? String(matchedProjection.defaults.supportSalaryUsd) : '')
      setTrainingRateInput(
        matchedProjection.defaults.trainingSalaryRateUsd
          ? String(matchedProjection.defaults.trainingSalaryRateUsd)
          : '',
      )
      setOtherCostInput(matchedProjection.defaults.otherCostUsd ? String(matchedProjection.defaults.otherCostUsd) : '')
      return
    }
    setBillingTypeDraft(canonicalBillingType(scenario.plan.billingType))
    setBillRateMethodDraft(canonicalBillingType(scenario.plan.billingType) === 'FTE' ? 'monthly' : 'hourly')
    setRateInput('')
    setHourlyInput('')
    setSupportInput('')
    setTrainingRateInput('')
    setOtherCostInput('')
  }, [matchedProjection, scenario])

  const model = useMemo(() => {
    if (!scope || !scenario) return EMPTY_MODEL

    const buildRows = (item: PlannerScenario) =>
      deriveCapacityPlanRows(
        getScenarioLedger(item.id),
        item,
        getScenarioForecast(item.id, FORECAST_HORIZON),
        getScenarioCapacityPlanOverrides(item.id),
      )

    const rollupScenarios = scope.isCombined ? scope.clientScenarios : [scenario]
    const draftInputs = { hourlyInput, supportInput, trainingRateInput, otherCostInput }

    // Combined / portfolio: each LOB keeps its own billing type and cost rates, then totals are summed.
    // Single LOB: draft rate/cost inputs from the Financial panel apply.
    let projectedRevenue = 0
    let actualRevenue = 0
    let projectedCost = 0
    let actualCost = 0
    let weeksPlanned = 0
    let weeksWithActual = 0
    let salaryCost = 0
    let trainingCost = 0
    let opex = 0
    let totalHours = 0
    let totalUnits = 0

    let leakages = emptyCapacityLeakages()
    const weeklyByWeek = new Map<string, CapacityWeeklyFinancialRow>()
    const weeklyLeakByWeek = new Map<string, CapacityLeakageDrivers>()
    const leakageDetailRows: CapacityLeakageDetailRow[] = []

    for (const item of rollupScenarios) {
      const itemRows = filterCapacityRowsByWeekRange(buildRows(item), weekStart, weekEnd)
      const projectionLine = findRevenueProjectionLineForScenario(item, projectionLines)
      const applyDrafts = false
      const itemSpec = projectionLine ? specFromProjectionLine(projectionLine) : undefined
      const specForWeek = projectionLine
        ? (week: string) => specFromProjectionLine(projectionLine, undefined, week)
        : undefined
      const itemBillingType = itemSpec
        ? canonicalBillingType(itemSpec.billingType)
        : scope.isCombined
          ? canonicalBillingType(item.plan.billingType)
          : billingTypeDraft
      const itemCostInputs = projectionLine
        ? costInputsFromProjectionLine(projectionLine, item, draftInputs, applyDrafts)
        : costInputsForScenario(item, draftInputs, applyDrafts)
      const itemRate = itemSpec
        ? activeBillRate(itemSpec)
        : resolveBillingRate(item, itemBillingType, applyDrafts ? rateInput : '')
      const itemFormulaScope = formulaScopeFromPlan(item.plan)
      const leakageType = leakageBillingType(itemSpec, itemBillingType)
      const rolled = summarizeScenarioFinancials(
        itemRows,
        itemBillingType,
        itemRate,
        itemCostInputs,
        itemSpec,
        itemFormulaScope,
        specForWeek,
      )
      projectedRevenue += rolled.summary.projectedRevenue
      actualRevenue += rolled.summary.actualRevenue
      projectedCost += rolled.summary.projectedCost
      actualCost += rolled.summary.actualCost
      weeksPlanned += rolled.summary.weeksPlanned
      weeksWithActual += rolled.summary.weeksWithActual
      salaryCost += rolled.salaryCost
      trainingCost += rolled.trainingCost
      opex += rolled.opex
      totalHours += rolled.totalHours
      totalUnits += rolled.totalUnits
      leakages = addCapacityLeakages(
        leakages,
        calculateCapacityRevenueLeakages(
          itemRows,
          leakageType,
          itemRate,
          itemCostInputs.standardHoursPerWeek,
          itemCostInputs.hourlySalaryUsd,
          itemFormulaScope,
        ),
      )
      for (const row of itemRows) {
        addWeeklyFinancial(
          weeklyByWeek,
          row,
          itemBillingType,
          itemRate,
          itemCostInputs,
          specForWeek?.(row.week) ?? itemSpec,
          itemFormulaScope,
        )
        const rowLeak = calculateCapacityRevenueLeakages(
          [row],
          leakageType,
          itemRate,
          itemCostInputs.standardHoursPerWeek,
          itemCostInputs.hourlySalaryUsd,
          itemFormulaScope,
        )
        const priorWeekLeak = weeklyLeakByWeek.get(row.week) ?? emptyCapacityLeakages()
        weeklyLeakByWeek.set(row.week, addCapacityLeakages(priorWeekLeak, rowLeak))
        if (Math.abs(rowLeak.total) >= 0.5) {
          leakageDetailRows.push({
            week: row.week,
            client: item.plan.client,
            lob: item.plan.lob ?? item.plan.location ?? '',
            projectCode: item.plan.projectCode?.trim() ?? '',
            ...rowLeak,
          })
        }
      }
    }

    const allCapacityRows = scope.isCombined
      ? combineCapacityRows(rollupScenarios.map((item) => buildRows(item)))
      : buildRows(scenario)
    const capacityRows = filterCapacityRowsByWeekRange(allCapacityRows, weekStart, weekEnd)

    const billingType = scope.isCombined
      ? scope.isPortfolio
        ? 'Portfolio'
        : 'Combined'
      : billingTypeDraft
    const billingTypeLabel = scope.isCombined
      ? scope.isPortfolio
        ? 'All clients / LOBs'
        : 'Combined LOBs'
      : `${billableTypeLabel(billingTypeDraft)} · ${
          billRateMethodDraft === 'monthly'
            ? 'monthly rate'
            : billRateMethodDraft === 'per_minute'
              ? 'per minute'
              : billRateMethodDraft === 'per_transaction'
                ? 'per chat / sale / transaction'
                : 'hourly rate'
        }`
    const standardHours = scenario.assumptions.tenured.standardScheduledHoursPerWeek ?? 40
    const displaySpec = matchedProjection
      ? specFromProjectionLine(
          matchedProjection,
          scope.isCombined
            ? undefined
            : {
                billingType: billingTypeDraft,
                method: billRateMethodDraft,
                rate: Number(rateInput) || undefined,
              },
        )
      : undefined
    const costInputs = matchedProjection
      ? costInputsFromProjectionLine(matchedProjection, scenario, draftInputs, !scope.isCombined)
      : costInputsForScenario(scenario, draftInputs, !scope.isCombined)
    const billingRate = displaySpec
      ? activeBillRate(displaySpec)
      : resolveBillingRate(scenario, billingTypeDraft, scope.isCombined ? '' : rateInput)
    const defaultRate = displaySpec ? activeBillRate(displaySpec) : defaultBillingRateForType(billingTypeDraft)
    const projectedMargin = projectedRevenue - projectedCost
    const actualMargin = actualRevenue - actualCost
    const revPerHour = totalHours > 0 ? projectedRevenue / totalHours : 0
    const costPerHour = totalHours > 0 ? projectedCost / totalHours : 0
    const revPerUnit = totalUnits > 0 ? projectedRevenue / totalUnits : 0
    const costPerUnit = totalUnits > 0 ? projectedCost / totalUnits : 0
    const projectedGmPct =
      weeksPlanned > 0 && projectedRevenue > 0 ? (projectedMargin / projectedRevenue) * 100 : null
    const actualGmPct =
      weeksWithActual > 0 && actualRevenue > 0 ? (actualMargin / actualRevenue) * 100 : null

    const weeklyFinancials = [...weeklyByWeek.values()].sort((a, b) => a.week.localeCompare(b.week))
    const weeklyLeakages: CapacityWeeklyLeakageRow[] = [...weeklyLeakByWeek.entries()]
      .map(([week, drivers]) => ({ week, ...drivers }))
      .sort((a, b) => a.week.localeCompare(b.week))
    leakageDetailRows.sort((a, b) => b.total - a.total || a.week.localeCompare(b.week))

    return {
      hasScope: true,
      scopeId: scope.scopeId,
      isCombined: scope.isCombined,
      isPortfolio: scope.isPortfolio,
      scopeLabel: scope.displayLabel,
      billingType,
      billingTypeLabel,
      billRateMethod: scope.isCombined ? 'hourly' : billRateMethodDraft,
      projectionLinked: Boolean(matchedProjection) || rollupScenarios.some((item) => findRevenueProjectionLineForScenario(item, projectionLines)),
      projectionLabel: matchedProjection
        ? `${matchedProjection.clientName} · ${matchedProjection.lobProjectName}`
        : scope.isCombined
          ? 'Revenue Projections (per LOB)'
          : '',
      projectedRevenue,
      actualRevenue,
      projectedCost,
      actualCost,
      projectedMargin,
      actualMargin,
      projectedGmPct,
      actualGmPct,
      revPerHour,
      costPerHour,
      revPerUnit,
      costPerUnit,
      unitLabel: scope.isCombined ? 'hour' : billingUnitLabel(billingTypeDraft, billRateMethodDraft),
      salaryCost,
      trainingCost,
      opex,
      totalCost: projectedCost,
      totalHours,
      totalUnits,
      weeksWithActual,
      weeksPlanned,
      capacityRows,
      billingRate,
      costInputs,
      defaultRate,
      standardHours,
      leakages,
      weeklyLeakages,
      leakageDetailRows,
      weeklyFinancials,
    }
  }, [
    billRateMethodDraft,
    billingTypeDraft,
    getScenarioCapacityPlanOverrides,
    getScenarioForecast,
    getScenarioLedger,
    hourlyInput,
    matchedProjection,
    otherCostInput,
    projectionLines,
    rateInput,
    scenario,
    scope,
    supportInput,
    trainingRateInput,
    weekEnd,
    weekStart,
    formulaRevision,
  ])

  const saveAssumptions = () => {
    if (!scenario || scope?.isCombined) return
    const parsedRate = Number(rateInput || model.billingRate)
    const parsedHourly = Number(hourlyInput || model.costInputs.hourlySalaryUsd)
    const parsedSupport = Number(supportInput || model.costInputs.supportSalaryUsd)
    const parsedTraining = Number(trainingRateInput || model.costInputs.trainingSalaryRateUsd)
    const parsedOther = Number(otherCostInput || model.costInputs.otherCostUsd)
    if (!Number.isFinite(parsedRate) || parsedRate <= 0) return
    updateScenarioPlan(scenario.id, {
      ...scenario.plan,
      billingType: billingTypeDraft,
    })
    updateAssumptions(scenario.id, {
      ...scenario.assumptions,
      business: {
        ...scenario.assumptions.business,
        billingRate: parsedRate,
        hourlySalaryUsd: parsedHourly,
        supportSalaryUsd: parsedSupport,
        trainingSalaryRateUsd: parsedTraining,
        otherCostUsd: parsedOther,
      },
    })
    const existing = matchedProjection ?? findRevenueProjectionLineForScenario(scenario, loadRevenueProjectionLines())
    if (existing) {
      const nextDefaults = { ...existing.defaults }
      if (billRateMethodDraft === 'monthly') nextDefaults.monthlyBillRate = parsedRate
      else if (billRateMethodDraft === 'per_minute') nextDefaults.perMinuteBillRate = parsedRate
      else if (billRateMethodDraft === 'per_transaction') nextDefaults.perTransactionBillRate = parsedRate
      else nextDefaults.hourlyBillRate = parsedRate
      nextDefaults.hourlySalaryUsd = parsedHourly
      nextDefaults.supportSalaryUsd = parsedSupport
      nextDefaults.trainingSalaryRateUsd = parsedTraining
      nextDefaults.otherCostUsd = parsedOther
      const next = upsertRevenueProjectionLine(loadRevenueProjectionLines(), {
        ...existing,
        billingType: billingTypeDraft,
        billRateMethod: billRateMethodDraft,
        billRateMethods: normalizeBillRateMethods(
          (existing.billRateMethods ?? []).filter((method) => method !== existing.billRateMethod),
          billRateMethodDraft,
        ),
        defaults: nextDefaults,
      })
      saveRevenueProjectionLines(next)
      void flushWorkspaceSync()
    }
  }

  const value: CapacityFinancialContextValue = {
    ...model,
    rateInput,
    hourlyInput,
    supportInput,
    trainingRateInput,
    otherCostInput,
    billingTypeDraft,
    billRateMethodDraft,
    setRateInput,
    setHourlyInput,
    setSupportInput,
    setTrainingRateInput,
    setOtherCostInput,
    setBillingTypeDraft,
    setBillRateMethodDraft,
    saveAssumptions,
    scenarioId: scenario?.id ?? null,
  }

  return <CapacityFinancialContext.Provider value={value}>{children}</CapacityFinancialContext.Provider>
}

export function useCapacityFinancial(): CapacityFinancialContextValue {
  const ctx = useContext(CapacityFinancialContext)
  if (!ctx) throw new Error('useCapacityFinancial must be used within CapacityFinancialProvider')
  return ctx
}

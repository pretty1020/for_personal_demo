import { useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import {
  CapacityReadOnlyMatrix,
  buildCapacityMatrixDisplayContext,
} from '../components/planner/CapacityReadOnlyMatrix'
import { CapacityPeriodFilter } from '../components/planner/CapacityPeriodFilter'
import { CompanyHierarchyPanel } from '../components/executive/CompanyHierarchyPanel'
import { ModulePageHeader } from '../components/shell/ModulePageHeader'
import { useDemoSession } from '../context/DemoSessionContext'
import { usePlanner } from '../context/PlannerContext'
import {
  derivePortfolioForecast,
  derivePortfolioLedger,
  loadCapacityPortfolio,
  portfolioPlanOverrides,
  type PortfolioOwner,
} from '../data/capacityPortfolio'
import { isManagerOrAbove } from '../utils/accessLevel'
import { enterActAsPlanner } from '../data/capacityDocuments'
import {
  avgFiniteFte,
  avgPresentFte,
  capacityPlannedNestingHc,
  capacityPlannedNewHires,
  capacityPlannedProductionHc,
  capacityPlannedTrainingHc,
  capacityStaffingFtePair,
  deriveCapacityRowsForScenario,
  resolveCapacityRowForPlanningWeek,
  sumFiniteFte,
  sumPresentFte,
} from '../planner/capacityLookup'
import {
  capacityMatrixViewForPeriod,
  capacityPeriodLabel,
  filterRowsByCapacityPeriod,
  filterRowsByDateRange,
  loadCapacityPeriod,
  resolvePeriodSnapshotWeek,
  saveCapacityPeriod,
  type CapacityPeriodState,
} from '../planner/capacityPeriod'
import { combineCapacityRows } from '../planner/capacityPlanDerived'
import { resolveCapacityPlanStartWeek } from '../planner/capacityWeekUtils'
import { buildCompanyHierarchy } from '../planner/companyHierarchy'
import { fmtNum, fmtPct } from '../planner/format'
import { resolvePlanLob, resolvePlanLocation, resolvePlanProjectCode, normalizeProjectCode } from '../planner/planIdentity'
import type { WeekCapacityPlanOverride } from '../planner/capacityPlanOverridePersistence'
import type { ScenarioForecastPackage } from '../planner/forecasting'
import type { PlannerScenario } from '../planner/types'
import type { WeeklyLedgerRow } from '../planner/weeklyLedger'
import { billableTypeLabel, isFteBillingPlan } from '../utils/staffingCapacity/billingModel'
import type { CapacityView } from '../planner/capacityMatrixDisplay'

const FORECAST_HORIZON = 52
const UNSET_LOCATION = 'Unspecified'

type LobSnapshot = {
  scenarioId: string
  client: string
  lob: string
  location: string
  projectCode: string
  billingType: string
  planningWeek: string
  /** Null when mutual blank with Production FTE (0 / missing on either side). */
  requiredFte: number | null
  productionFte: number | null
  productionHc: number
  trainingHc: number
  nestingHc: number
  newHires: number
  staffingGap: number | null
  staffingPct: number | null
}

type SnapshotDeps = {
  getScenarioLedger: (id: string) => WeeklyLedgerRow[]
  getScenarioForecast: (id: string, weeks: number) => ScenarioForecastPackage | null
  getScenarioCapacityPlanOverrides: (id: string) => Record<string, WeekCapacityPlanOverride>
}

type DateRange = { start: string; end: string }

function locationLabel(plan: PlannerScenario['plan']): string {
  return resolvePlanLocation(plan) || UNSET_LOCATION
}

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

function avg(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function scopeRowsForSummary<T extends { week: string }>(
  rows: T[],
  period: CapacityPeriodState,
  dateRange: DateRange,
): T[] {
  return filterRowsByDateRange(filterRowsByCapacityPeriod(rows, period), dateRange.start, dateRange.end)
}

function combineLedgerRows(groups: WeeklyLedgerRow[][]): WeeklyLedgerRow[] {
  const byWeek = new Map<string, WeeklyLedgerRow[]>()
  groups.flat().forEach((row) => {
    byWeek.set(row.week, [...(byWeek.get(row.week) ?? []), row])
  })
  return [...byWeek.entries()].map(([week, rows]) => {
    const first = rows[0]!
    const shrinkageById = new Map<string, (typeof first.shrinkage)[number][]>()
    rows.forEach((row) => {
      row.shrinkage.forEach((item) => {
        shrinkageById.set(item.id, [...(shrinkageById.get(item.id) ?? []), item])
      })
    })
    const avgShrink = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
    return {
      ...first,
      week,
      planned: rows.reduce(
        (acc, row) => ({
          ...acc,
          callVolume: (acc.callVolume ?? 0) + (row.planned.callVolume ?? 0),
          handledVolume: (acc.handledVolume ?? 0) + (row.planned.handledVolume ?? 0),
        }),
        { ...first.planned },
      ),
      shrinkage: [...shrinkageById.entries()].map(([id, items]) => ({
        id,
        name: items[0]!.name,
        group: items[0]!.group,
        billable: items[0]!.billable,
        plannedPct: avgShrink(items.map((item) => item.plannedPct)),
        actualPct: avgShrink(items.map((item) => item.actualPct ?? 0)),
      })),
    }
  })
}

/**
 * Period / date-range roll-ups match the matrix aggregator:
 * FTE and pipeline HC → average across weeks; production HC → last week; hires → sum.
 */
function snapshotForScenario(
  scenario: PlannerScenario,
  deps: SnapshotDeps,
  period: CapacityPeriodState,
  dateRange: DateRange,
): LobSnapshot {
  const rows = deriveCapacityRowsForScenario(
    deps.getScenarioLedger(scenario.id),
    scenario,
    deps.getScenarioForecast(scenario.id, FORECAST_HORIZON),
    deps.getScenarioCapacityPlanOverrides(scenario.id),
  )
  const weeks = rows.map((row) => row.week)
  const fallbackWeek = resolveCapacityPlanStartWeek(scenario.plan)
  const dateRangeActive = Boolean(dateRange.start || dateRange.end)
  const usePeriodRollup = period.mode !== 'weekly' || dateRangeActive
  // Mutual blank is weekly-column only — not Client/LOB or month/quarter rollups.
  const weeklyMutualBlank = period.mode === 'weekly' && !dateRangeActive
  const scopedRows = scopeRowsForSummary(rows, period, dateRange)

  if (usePeriodRollup) {
    if (!scopedRows.length) {
      return {
        scenarioId: scenario.id,
        client: scenario.plan.client,
        lob: resolvePlanLob(scenario.plan),
        location: resolvePlanLocation(scenario.plan),
        projectCode: resolvePlanProjectCode(scenario.plan),
        billingType: billableTypeLabel(scenario.plan.billingType),
        planningWeek: fallbackWeek,
        requiredFte: null,
        productionFte: null,
        productionHc: 0,
        trainingHc: 0,
        nestingHc: 0,
        newHires: 0,
        staffingGap: null,
        staffingPct: null,
      }
    }
    const last = scopedRows[scopedRows.length - 1]!
    const pairs = scopedRows.map((item) => capacityStaffingFtePair(item, weeklyMutualBlank))
    const requiredFte = weeklyMutualBlank
      ? avgPresentFte(pairs.map((pair) => pair.requiredFte))
      : avgFiniteFte(pairs.map((pair) => pair.requiredFte))
    const productionFte = weeklyMutualBlank
      ? avgPresentFte(pairs.map((pair) => pair.productionFte))
      : avgFiniteFte(pairs.map((pair) => pair.productionFte))
    const productionHc = capacityPlannedProductionHc(last)
    const trainingHc = avg(scopedRows.map((item) => capacityPlannedTrainingHc(item)))
    const nestingHc = avg(scopedRows.map((item) => capacityPlannedNestingHc(item)))
    const newHires = scopedRows.reduce((sum, item) => sum + capacityPlannedNewHires(item), 0)
    return {
      scenarioId: scenario.id,
      client: scenario.plan.client,
      lob: resolvePlanLob(scenario.plan),
      location: resolvePlanLocation(scenario.plan),
      projectCode: resolvePlanProjectCode(scenario.plan),
      billingType: billableTypeLabel(scenario.plan.billingType),
      planningWeek: last.week,
      requiredFte,
      productionFte,
      productionHc,
      trainingHc,
      nestingHc,
      newHires,
      staffingGap:
        requiredFte != null && productionFte != null ? requiredFte - productionFte : null,
      staffingPct:
        requiredFte != null && productionFte != null && requiredFte > 0
          ? productionFte / requiredFte
          : null,
    }
  }

  const planningWeek = resolvePeriodSnapshotWeek(weeks, period, fallbackWeek)
  const row = resolveCapacityRowForPlanningWeek(rows, scenario, planningWeek)
  const pair = capacityStaffingFtePair(row, weeklyMutualBlank)
  const productionHc = capacityPlannedProductionHc(row)
  const trainingHc = capacityPlannedTrainingHc(row)
  const nestingHc = capacityPlannedNestingHc(row)
  const newHires = capacityPlannedNewHires(row)

  return {
    scenarioId: scenario.id,
    client: scenario.plan.client,
    lob: resolvePlanLob(scenario.plan),
    location: resolvePlanLocation(scenario.plan),
    projectCode: resolvePlanProjectCode(scenario.plan),
    billingType: billableTypeLabel(scenario.plan.billingType),
    planningWeek,
    requiredFte: pair.requiredFte,
    productionFte: pair.productionFte,
    productionHc,
    trainingHc,
    nestingHc,
    newHires,
    staffingGap:
      pair.requiredFte != null && pair.productionFte != null
        ? pair.requiredFte - pair.productionFte
        : null,
    staffingPct:
      pair.requiredFte != null && pair.productionFte != null && pair.requiredFte > 0
        ? pair.productionFte / pair.requiredFte
        : null,
  }
}

function MultiFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  return (
    <fieldset className="cap-summary__filter">
      <legend className="cap-summary__filter-label">{label}</legend>
      <div className="cap-summary__filter-options">
        <label className="cap-summary__check">
          <input
            type="checkbox"
            checked={selected.length === 0}
            onChange={() => onChange([])}
          />
          <span>All</span>
        </label>
        {options.map((option) => (
          <label key={option} className="cap-summary__check">
            <input
              type="checkbox"
              checked={selected.includes(option)}
              onChange={() => onChange(toggleValue(selected, option))}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

export function CapacitySummaryPage() {
  const navigate = useNavigate()
  const { canCreatePlans, canViewPortfolioSummary, accessLevel, user } = useDemoSession()
  const {
    scenarios,
    selectScenario,
    publishScenarioToCapacity,
    deleteScenario,
    getScenarioLedger,
    getScenarioForecast,
    getScenarioCapacityPlanOverrides,
  } = usePlanner()

  // Manager and above roll up the whole department, not just their own plans.
  const seesEveryPlanner = isManagerOrAbove(accessLevel)
  const ownEmail = user?.email ?? ''
  const [portfolio, setPortfolio] = useState<PortfolioOwner[]>([])
  const [portfolioError, setPortfolioError] = useState('')

  useEffect(() => {
    if (!seesEveryPlanner) {
      setPortfolio([])
      setPortfolioError('')
      return
    }
    let cancelled = false
    loadCapacityPortfolio(ownEmail)
      .then((owners) => {
        if (cancelled) return
        setPortfolio(owners)
        setPortfolioError('')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.error('Could not load the other planners\u2019 plans:', error)
        setPortfolio([])
        // Say so rather than quietly showing a total that is missing teams.
        setPortfolioError('Showing your plans only — the other planners\u2019 data could not be loaded.')
      })
    return () => {
      cancelled = true
    }
  }, [ownEmail, seesEveryPlanner])

  /**
   * Other planners' scenarios, derived once per load. PlannerContext resolves by id
   * against the signed-in user's own list, so foreign scenarios need their own pass.
   */
  const foreignDerived = useMemo(() => {
    const derived = new Map<
      string,
      {
        scenario: PlannerScenario
        ownerUserId: string
        ownerName: string
        ownerEmail: string
        ledger: WeeklyLedgerRow[]
        forecast: ScenarioForecastPackage | null
        overrides: Record<string, WeekCapacityPlanOverride>
      }
    >()
    for (const owner of portfolio) {
      for (const scenario of owner.scenarios) {
        // A plan the reader already owns locally wins: their copy may hold unsaved edits.
        if (derived.has(scenario.id) || scenarios.some((own) => own.id === scenario.id)) continue
        const ledger = derivePortfolioLedger(owner, scenario)
        derived.set(scenario.id, {
          scenario,
          ownerUserId: owner.userId,
          ownerName: owner.name,
          ownerEmail: owner.email,
          ledger,
          forecast: derivePortfolioForecast(owner, scenario, ledger, FORECAST_HORIZON),
          overrides: portfolioPlanOverrides(owner, scenario),
        })
      }
    }
    return derived
  }, [portfolio, scenarios])

  const allScenarios = useMemo(
    () => [...scenarios, ...[...foreignDerived.values()].map((entry) => entry.scenario)],
    [foreignDerived, scenarios],
  )

  const resolveLedger = useMemo(
    () => (scenarioId: string) => foreignDerived.get(scenarioId)?.ledger ?? getScenarioLedger(scenarioId),
    [foreignDerived, getScenarioLedger],
  )
  const resolveForecast = useMemo(
    () => (scenarioId: string, horizonWeeks = FORECAST_HORIZON) => {
      const entry = foreignDerived.get(scenarioId)
      return entry ? entry.forecast : getScenarioForecast(scenarioId, horizonWeeks)
    },
    [foreignDerived, getScenarioForecast],
  )
  const resolveOverrides = useMemo(
    () => (scenarioId: string) =>
      foreignDerived.get(scenarioId)?.overrides ?? getScenarioCapacityPlanOverrides(scenarioId),
    [foreignDerived, getScenarioCapacityPlanOverrides],
  )

  const [period, setPeriod] = useState<CapacityPeriodState>(() => loadCapacityPeriod())
  const [dateRangeStart, setDateRangeStart] = useState('')
  const [dateRangeEnd, setDateRangeEnd] = useState('')
  const [selectedClients, setSelectedClients] = useState<string[]>([])
  const [selectedLocations, setSelectedLocations] = useState<string[]>([])
  const [selectedLobs, setSelectedLobs] = useState<string[]>([])
  const [selectedProjectCodes, setSelectedProjectCodes] = useState<string[]>([])

  useEffect(() => {
    saveCapacityPeriod(period)
  }, [period])

  const dateRange = useMemo(
    () => ({ start: dateRangeStart, end: dateRangeEnd }),
    [dateRangeEnd, dateRangeStart],
  )
  const dateRangeActive = Boolean(dateRangeStart || dateRangeEnd)

  const visible = useMemo(() => allScenarios.filter((s) => !s.isBaseline), [allScenarios])
  const hierarchy = useMemo(() => buildCompanyHierarchy(visible), [visible])

  const clientOptions = useMemo(
    () => [...new Set(visible.map((s) => s.plan.client).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [visible],
  )
  const locationOptions = useMemo(
    () => [...new Set(visible.map((s) => locationLabel(s.plan)))].sort((a, b) => a.localeCompare(b)),
    [visible],
  )
  const lobOptions = useMemo(
    () => [...new Set(visible.map((s) => resolvePlanLob(s.plan)).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [visible],
  )
  const projectCodeOptions = useMemo(() => {
    const labels = new Map<string, string>()
    for (const scenario of visible) {
      const code = resolvePlanProjectCode(scenario.plan)
      if (!code) continue
      const key = normalizeProjectCode(code)
      if (!labels.has(key)) labels.set(key, code)
    }
    return [...labels.values()].sort((a, b) => a.localeCompare(b))
  }, [visible])

  const filtered = useMemo(() => {
    const selectedCodeKeys = new Set(selectedProjectCodes.map(normalizeProjectCode))
    return visible.filter((scenario) => {
      if (selectedClients.length && !selectedClients.includes(scenario.plan.client)) return false
      if (selectedLocations.length && !selectedLocations.includes(locationLabel(scenario.plan))) return false
      if (selectedLobs.length && !selectedLobs.includes(resolvePlanLob(scenario.plan))) return false
      if (selectedCodeKeys.size) {
        const code = resolvePlanProjectCode(scenario.plan)
        if (!code || !selectedCodeKeys.has(normalizeProjectCode(code))) return false
      }
      return true
    })
  }, [selectedClients, selectedLobs, selectedLocations, selectedProjectCodes, visible])

  const periodWeeks = useMemo(() => {
    const weeks = new Set<string>()
    for (const scenario of filtered) {
      deriveCapacityRowsForScenario(
        resolveLedger(scenario.id),
        scenario,
        resolveForecast(scenario.id, FORECAST_HORIZON),
        resolveOverrides(scenario.id),
      ).forEach((row) => weeks.add(row.week))
    }
    return [...weeks].sort()
  }, [filtered, resolveLedger, resolveForecast, resolveOverrides])

  const snapshots = useMemo(
    () =>
      filtered.map((scenario) =>
        snapshotForScenario(
          scenario,
          {
            getScenarioLedger: resolveLedger,
            getScenarioForecast: resolveForecast,
            getScenarioCapacityPlanOverrides: resolveOverrides,
          },
          period,
          dateRange,
        ),
      ),
    [dateRange, filtered, period, resolveLedger, resolveForecast, resolveOverrides],
  )

  const totals = useMemo(() => {
    // Weekly: exclude mutual-blanked zeros. Month/quarter: keep independent sides (zeros allowed).
    const weeklyMutualBlank = period.mode === 'weekly' && !dateRange.start && !dateRange.end
    const requiredFte = weeklyMutualBlank
      ? sumPresentFte(snapshots.map((row) => row.requiredFte))
      : sumFiniteFte(snapshots.map((row) => row.requiredFte))
    const productionFte = weeklyMutualBlank
      ? sumPresentFte(snapshots.map((row) => row.productionFte))
      : sumFiniteFte(snapshots.map((row) => row.productionFte))
    const productionHc = snapshots.reduce((sum, row) => sum + row.productionHc, 0)
    const trainingHc = snapshots.reduce((sum, row) => sum + row.trainingHc, 0)
    const nestingHc = snapshots.reduce((sum, row) => sum + row.nestingHc, 0)
    const newHires = snapshots.reduce((sum, row) => sum + row.newHires, 0)
    return {
      scenarioCount: snapshots.length,
      requiredFte,
      productionFte,
      productionHc,
      trainingHc,
      nestingHc,
      newHires,
      staffingPct:
        requiredFte != null && productionFte != null && requiredFte > 0
          ? productionFte / requiredFte
          : null,
      staffingGap:
        requiredFte != null && productionFte != null ? requiredFte - productionFte : null,
    }
  }, [dateRange.end, dateRange.start, period.mode, snapshots])

  const combinedRows = useMemo(() => {
    if (!filtered.length) return []
    // Same derive path the Staffing Plan uses for combined peers: per-scenario rows
    // with overrides + forecast, then combineCapacityRows (averages shrinkage %).
    const groups = filtered.map((scenario) =>
      deriveCapacityRowsForScenario(
        resolveLedger(scenario.id),
        scenario,
        resolveForecast(scenario.id, FORECAST_HORIZON),
        resolveOverrides(scenario.id),
      ),
    )
    const combined = groups.length === 1 ? groups[0]! : combineCapacityRows(groups)
    return scopeRowsForSummary(combined, period, dateRange)
  }, [dateRange, filtered, period, resolveLedger, resolveForecast, resolveOverrides])

  const combinedLedger = useMemo(() => {
    if (!filtered.length) return []
    const groups = filtered.map((scenario) => resolveLedger(scenario.id))
    return groups.length === 1 ? groups[0]! : combineLedgerRows(groups)
  }, [filtered, resolveLedger])

  const matrixView: CapacityView = capacityMatrixViewForPeriod(period.mode)

  const matrixContext = useMemo(() => {
    if (!filtered.length || !combinedRows.length) return null
    const anchor = filtered[0]!
    return buildCapacityMatrixDisplayContext({
      derivedRows: combinedRows,
      ledger: combinedLedger,
      forecast: resolveForecast(anchor.id, FORECAST_HORIZON),
      assumptions: anchor.assumptions,
      view: matrixView,
      fteBilling: filtered.every((scenario) => isFteBillingPlan(scenario.plan.billingType)),
    })
  }, [combinedLedger, combinedRows, filtered, matrixView, resolveForecast])

  if (!canViewPortfolioSummary) {
    return <Navigate to="/capacity-plan" replace />
  }

  /** True for a plan owned by another planner: readable here, but not editable from here. */
  const ownedByOther = (scenarioId: string) => foreignDerived.has(scenarioId)

  const openPlan = (scenarioId: string) => {
    const foreign = foreignDerived.get(scenarioId)
    if (foreign) {
      // The grid reads and writes whichever plans are in the local cache, so opening
      // someone else's means swapping the cache to them first. Writes then go to their
      // rows, attributed to this manager. Navigation waits for the swap: entering the
      // grid mid-swap would render against a half-cleared cache.
      void enterActAsPlanner({
        userId: foreign.ownerUserId,
        name: foreign.ownerName,
        email: foreign.ownerEmail,
      })
        .then(() => {
          selectScenario(scenarioId)
          navigate('/capacity-plan')
        })
        .catch((error: unknown) => {
          console.error('Could not open that planner\u2019s plans:', error)
          window.alert(
            `${foreign.ownerName}\u2019s plans could not be opened. Check your connection and try again.`,
          )
        })
      return
    }
    selectScenario(scenarioId)
    publishScenarioToCapacity(scenarioId)
    navigate('/capacity-plan')
  }

  const openCombined = (clientName: string) => {
    setSelectedClients([clientName])
    setSelectedLocations([])
    setSelectedLobs([])
    setSelectedProjectCodes([])
  }

  const openCombinedProjectCode = (projectCode: string) => {
    setSelectedProjectCodes([projectCode])
    setSelectedClients([])
    setSelectedLocations([])
    setSelectedLobs([])
  }

  const showAllClients = () => {
    setSelectedClients([])
    setSelectedLocations([])
    setSelectedLobs([])
    setSelectedProjectCodes([])
  }

  const goAddClient = () => navigate('/setup')

  const goAddLob = (clientId: string | null, clientName: string) => {
    const params = new URLSearchParams()
    if (clientId) params.set('clientId', clientId)
    if (clientName) params.set('clientName', clientName)
    navigate(`/setup?${params.toString()}`)
  }

  const removeScenario = (scenarioId: string, label: string) => {
    if (ownedByOther(scenarioId)) {
      const owner = foreignDerived.get(scenarioId)?.ownerName ?? 'another planner'
      window.alert(`${label} belongs to ${owner}. Only its owner can delete it.`)
      return
    }
    if (!window.confirm(`Delete ${label}? This will remove the capacity plan and its LOB data.`)) return
    deleteScenario(scenarioId)
  }

  const applyFullPlanRange = () => {
    if (!periodWeeks.length) return
    setDateRangeStart(periodWeeks[0]!)
    setDateRangeEnd(periodWeeks[periodWeeks.length - 1]!)
  }

  const periodCopy = capacityPeriodLabel(period)
  const scopeParts = [
    selectedClients.length ? `${selectedClients.length} client${selectedClients.length === 1 ? '' : 's'}` : 'All clients',
    selectedProjectCodes.length
      ? `${selectedProjectCodes.length} project code${selectedProjectCodes.length === 1 ? '' : 's'}`
      : 'All project codes',
    selectedLocations.length
      ? `${selectedLocations.length} location${selectedLocations.length === 1 ? '' : 's'}`
      : 'All locations',
    selectedLobs.length ? `${selectedLobs.length} LOB${selectedLobs.length === 1 ? '' : 's'}` : 'All LOBs',
  ]
  const rangeCopy = dateRangeActive
    ? ` · ${dateRangeStart || '…'} → ${dateRangeEnd || '…'}`
    : ''

  return (
    <div className="cap-overall cap-summary cap-staffing">
      <ModulePageHeader
        title="Summary view"
        description={`${scopeParts.join(' · ')} · ${filtered.length} team${filtered.length === 1 ? '' : 's'} · ${periodCopy}${rangeCopy}. Cards and Combined Staffing match Staffing Plan. Weekly mutual blank applies per week only (not Client/LOB-wide).`}
        actions={
          <div className="cap-overall__actions cap-summary__actions">
            {canCreatePlans ? (
              <button type="button" className="saas-btn" onClick={goAddClient}>
                Add client
              </button>
            ) : null}
            <button type="button" className="saas-btn saas-btn--secondary" onClick={showAllClients}>
              All clients
            </button>
            {selectedClients.length === 1 ? (
              <button
                type="button"
                className="saas-btn saas-btn--secondary"
                onClick={() =>
                  navigate(`/capacity-plan?scope=${encodeURIComponent(`combined:${selectedClients[0]}`)}`)
                }
              >
                Open client combined grid
              </button>
            ) : null}
            {selectedProjectCodes.length === 1 ? (
              <button
                type="button"
                className="saas-btn saas-btn--secondary"
                onClick={() =>
                  navigate(
                    `/capacity-plan?scope=${encodeURIComponent(
                      `combined-project:${normalizeProjectCode(selectedProjectCodes[0]!)}`,
                    )}`,
                  )
                }
              >
                Open project-code combined grid
              </button>
            ) : null}
            {filtered.length > 1 ? (
              <button
                type="button"
                className="saas-btn saas-btn--secondary"
                onClick={() => navigate(`/capacity-plan?scope=${encodeURIComponent('combined-all')}`)}
              >
                Open all-plans combined grid
              </button>
            ) : null}
            <button type="button" className="saas-btn saas-btn--secondary" onClick={() => navigate('/capacity-plan')}>
              Open Staffing Plan
            </button>
          </div>
        }
      />

      <CompanyHierarchyPanel
        hierarchy={hierarchy}
        onOpenLob={openPlan}
        onOpenCombined={openCombined}
        onOpenCombinedProjectCode={openCombinedProjectCode}
        onAddClient={canCreatePlans ? goAddClient : undefined}
        onAddLob={canCreatePlans ? goAddLob : undefined}
        onDeleteLob={canCreatePlans ? removeScenario : undefined}
        emptyMessage={
          canCreatePlans
            ? 'No clients yet. Use Add client to set up the first client and LOB.'
            : 'No clients yet. Ask an Admin or Capacity planner to add one.'
        }
      />

      <section className="cap-summary__filters saas-card" aria-label="Combined view filters">
        <header className="cap-summary__filters-head">
          <div>
            <p className="cap-summary__eyebrow">Combined view</p>
            <h3 className="m-0">Filter by client or project code</h3>
          </div>
          <button type="button" className="saas-btn saas-btn--secondary" onClick={showAllClients}>
            Clear filters
          </button>
        </header>
        <div className="cap-summary__filter-grid">
          <MultiFilter
            label="Combined Client"
            options={clientOptions}
            selected={selectedClients}
            onChange={setSelectedClients}
          />
          <MultiFilter
            label="Combined Project Code"
            options={projectCodeOptions}
            selected={selectedProjectCodes}
            onChange={setSelectedProjectCodes}
          />
          <MultiFilter
            label="Combined Location"
            options={locationOptions}
            selected={selectedLocations}
            onChange={setSelectedLocations}
          />
          <MultiFilter
            label="Combined LOB"
            options={lobOptions}
            selected={selectedLobs}
            onChange={setSelectedLobs}
          />
        </div>
        {hierarchy.sharedProjectCodes.length ? (
          <div className="cap-summary__shared-codes">
            <p className="saas-muted m-0 text-sm">
              Shared project codes (2+ teams) — open a combined roll-up:
            </p>
            <div className="cap-summary__shared-code-chips">
              {hierarchy.sharedProjectCodes.map((project) => (
                <button
                  key={project.codeKey}
                  type="button"
                  className="saas-btn saas-btn--secondary"
                  onClick={() => openCombinedProjectCode(project.label)}
                >
                  {project.label} · {project.teamCount} teams
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="cap-summary__time saas-card" aria-label="Date range and period">
        <header className="cap-summary__filters-head">
          <div>
            <p className="cap-summary__eyebrow">Time window</p>
            <h3 className="m-0">Date range &amp; period</h3>
          </div>
          <button
            type="button"
            className="saas-btn saas-btn--secondary"
            onClick={() => {
              setDateRangeStart('')
              setDateRangeEnd('')
            }}
            disabled={!dateRangeActive}
          >
            Clear date range
          </button>
        </header>
        <div className="cap-summary__date-range">
          <label className="cap-summary__date-field">
            <span>From week</span>
            <input
              type="date"
              value={dateRangeStart}
              max={dateRangeEnd || undefined}
              onChange={(event) => setDateRangeStart(event.target.value)}
            />
          </label>
          <label className="cap-summary__date-field">
            <span>To week</span>
            <input
              type="date"
              value={dateRangeEnd}
              min={dateRangeStart || undefined}
              onChange={(event) => setDateRangeEnd(event.target.value)}
            />
          </label>
          <button type="button" className="saas-btn saas-btn--secondary" onClick={applyFullPlanRange}>
            Use full plan range
          </button>
          {dateRangeActive ? (
            <p className="saas-muted m-0 text-sm">
              Limiting weeks {dateRangeStart || '…'} → {dateRangeEnd || '…'} ({combinedRows.length} week
              {combinedRows.length === 1 ? '' : 's'} after period filter).
            </p>
          ) : (
            <p className="saas-muted m-0 text-sm">Optional. Leave blank to use the period filter alone.</p>
          )}
        </div>
        <CapacityPeriodFilter state={period} onChange={setPeriod} weeks={periodWeeks} />
      </section>

      {!visible.length ? (
        <section className="cap-overall__empty saas-card">
          <h3 className="m-0">No capacity plans yet</h3>
          <p className="saas-muted m-0 mt-2">Add a client and LOB to see the summary staffing picture.</p>
          {canCreatePlans ? (
            <button type="button" className="saas-btn mt-3" onClick={goAddClient}>
              Add a client
            </button>
          ) : null}
        </section>
      ) : !filtered.length ? (
        <section className="cap-overall__empty saas-card">
          <h3 className="m-0">No teams match these filters</h3>
          <p className="saas-muted m-0 mt-2">Widen Combined Client, Location, or LOB to include plans.</p>
        </section>
      ) : (
        <>
          <section className="cap-overall__kpis cap-summary__kpis" aria-label="Summary staffing KPIs">
            <article className="cap-overall__kpi">
              <span>Teams</span>
              <strong>{fmtNum(totals.scenarioCount, 0)}</strong>
            </article>
            <article className="cap-overall__kpi">
              <span>Required FTE</span>
              <strong>{fmtNum(totals.requiredFte, 1)}</strong>
            </article>
            <article className="cap-overall__kpi">
              <span>Production FTE</span>
              <strong>{fmtNum(totals.productionFte, 1)}</strong>
            </article>
            <article className="cap-overall__kpi">
              <span>Staffing %</span>
              <strong>{totals.staffingPct != null ? fmtPct(totals.staffingPct) : '—'}</strong>
            </article>
            <article className="cap-overall__kpi">
              <span>Gap (FTE)</span>
              <strong>{totals.staffingGap != null ? fmtNum(totals.staffingGap, 1) : '—'}</strong>
            </article>
            <article className="cap-overall__kpi">
              <span>Production HC</span>
              <strong>{fmtNum(totals.productionHc, 0)}</strong>
            </article>
            <article className="cap-overall__kpi">
              <span>Training HC</span>
              <strong>{fmtNum(totals.trainingHc, 0)}</strong>
            </article>
            <article className="cap-overall__kpi">
              <span>Nesting HC</span>
              <strong>{fmtNum(totals.nestingHc, 0)}</strong>
            </article>
            <article className="cap-overall__kpi">
              <span>{period.mode === 'weekly' && !dateRangeActive ? 'Week-1 hires' : 'Period hires'}</span>
              <strong>{fmtNum(totals.newHires, 0)}</strong>
            </article>
          </section>

          <section className="cap-summary__matrix saas-card" aria-label="Combined staffing plan">
            <div className="cap-staffing__meta cap-summary__matrix-meta">
              <span className="cap-staffing__chip">Combined</span>
              <span className="cap-staffing__chip cap-staffing__chip--lob">{filtered.length} teams</span>
              <span className="cap-staffing__chip cap-staffing__chip--period">{periodCopy}</span>
              {dateRangeActive ? (
                <span className="cap-staffing__chip">
                  {dateRangeStart || '…'} → {dateRangeEnd || '…'}
                </span>
              ) : null}
              <span className="cap-staffing__hint">
                Read-only roll-up · {matrixView} buckets · same metrics as Staffing Plan
              </span>
            </div>
            {matrixContext ? (
              <CapacityReadOnlyMatrix
                rows={combinedRows}
                matrixContext={matrixContext}
                title="Combined Staffing Plan"
                description={`Same derived Staffing Plan data rolled up across ${filtered.length} team${filtered.length === 1 ? '' : 's'} for ${periodCopy}${rangeCopy}. Weekly mutual blank applies per week column only.`}
                view={matrixView}
                preserveRows
                className="cap-summary__matrix-table"
              />
            ) : (
              <p className="saas-muted m-0 text-sm">No capacity rows available for this combined scope.</p>
            )}
          </section>

          <section className="cap-overall__table-wrap saas-card" aria-label="Included teams">
            <header className="cap-overall__table-head">
              <h3 className="m-0">Included teams</h3>
              <p className="saas-muted m-0 text-sm">
                Teams in the combined matrix. Period values average FTE across weeks; production HC is as of the last week
                in range.
              </p>
              {seesEveryPlanner && (
                <p className="saas-muted m-0 text-sm">
                  {portfolioError
                    ? portfolioError
                    : portfolio.length
                      ? `Includes ${portfolio.length} other planner${portfolio.length === 1 ? '' : 's'}. You can open and edit your own plans; everyone else's are read-only.`
                      : 'No other planners have saved a plan yet.'}
                </p>
              )}
            </header>
            <div className="cap-ledger-table-wrap cap-summary__teams-wrap">
              <table className="cap-ledger-table cap-overall__table cap-summary__teams-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>LOB</th>
                    {seesEveryPlanner && <th>Planner</th>}
                    <th>Project Code</th>
                    <th>Location</th>
                    <th>Billing</th>
                    <th>As of</th>
                    <th>Required FTE</th>
                    <th>Prod FTE</th>
                    <th>Prod HC</th>
                    <th>Training</th>
                    <th>Nesting</th>
                    <th>Gap</th>
                    <th>Staffing %</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {snapshots.map((row) => (
                    <tr key={row.scenarioId}>
                      <td>{row.client}</td>
                      <td>{row.lob}</td>
                      {seesEveryPlanner && (
                        <td>{foreignDerived.get(row.scenarioId)?.ownerName ?? 'You'}</td>
                      )}
                      <td>{row.projectCode || '—'}</td>
                      <td>{row.location || '—'}</td>
                      <td>{row.billingType}</td>
                      <td>{row.planningWeek}</td>
                      <td>{fmtNum(row.requiredFte, 1)}</td>
                      <td>{fmtNum(row.productionFte, 1)}</td>
                      <td>{fmtNum(row.productionHc, 0)}</td>
                      <td>{fmtNum(row.trainingHc, 0)}</td>
                      <td>{fmtNum(row.nestingHc, 0)}</td>
                      <td>{row.staffingGap != null ? fmtNum(row.staffingGap, 1) : '—'}</td>
                      <td>{row.staffingPct != null ? fmtPct(row.staffingPct) : '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="portfolio-hierarchy__link"
                          onClick={() => openPlan(row.scenarioId)}
                        >
                          {ownedByOther(row.scenarioId)
                            ? `Open as ${foreignDerived.get(row.scenarioId)!.ownerName}`
                            : 'Open grid'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

/** @deprecated Use CapacitySummaryPage */
export { CapacitySummaryPage as CapacityOverallPage }

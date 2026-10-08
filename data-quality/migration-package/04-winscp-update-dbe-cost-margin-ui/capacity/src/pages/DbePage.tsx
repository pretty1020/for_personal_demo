import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { DbeFinancialSummaryPanel } from '../components/dbe/DbeFinancialSummaryPanel'
import { DbePeriodFilter } from '../components/dbe/DbePeriodFilter'
import { DbeSheetCellInput } from '../components/dbe/DbeSheetCellInput'
import { DbeFormMetricsEditor, DbeLineCostTable, DbeRemarkCell } from '../components/dbe/DbeMetricsCostPanels'
import { ModulePageHeader } from '../components/shell/ModulePageHeader'
import { useSheetCellDrafts } from '../hooks/useSheetCellDrafts'
import { usePlanner } from '../context/PlannerContext'
import { deriveCapacityRowsForScenario } from '../planner/capacityLookup'
import type { DerivedCapacityRow } from '../planner/capacityPlanDerived'
import {
  billRateMethodLabel,
  combineClientDbeMonths,
  combineDbeMonths,
  computeDbeMonth,
  createDbeLine,
  DBE_BILL_RATE_METHODS,
  DBE_METRIC_ROWS,
  dbeRemarkKey,
  deleteDbeLine,
  emptyMonthInput,
  formatFiscalMonthLabel,
  getDbeRowRemark,
  isFteBillingPlan,
  lineYearRevenue,
  listClientLobs,
  listDbeClients,
  listDbeLobs,
  listDbeLocations,
  listFiscalMonthKeys,
  loadDbeLines,
  mergeDbeTemplateImport,
  saveDbeLines,
  upsertDbeLine,
  type DbeBillRateMethod,
  type DbeComputeOptions,
  type DbeLobDefaults,
  type DbeLobLine,
  type DbeMetricRowId,
  type DbeMonthInput,
  type DbeCostItem,
  type DbeRevenueAdjustment,
} from '../planner/dbe/dbePersistence'
import { downloadDbeCsv, downloadDbeWorkbook } from '../planner/dbe/dbeExport'
import {
  downloadDbeClientTemplate,
  parseDbeClientTemplateFile,
} from '../planner/dbe/dbeClientTemplate'
import {
  dbePeriodSummaryLabel,
  filterDbeMonthKeys,
  loadDbePeriod,
  saveDbePeriod,
} from '../planner/dbe/dbePeriodFilter'
import {
  findStaffingScenarioForDbeLine,
  staffingScenarioHasDriverData,
  resolveStaffingMonthDrivers,
  type StaffingDriverLookup,
} from '../planner/dbe/staffingMonthDrivers'
import {
  buildDbeRevenueComparisonRows,
  rollupDbeRevenueComparisonByMonth,
} from '../planner/dbe/dbeRevenueComparison'
import { DbeSoftDecimalInput } from '../components/dbe/DbeSoftDecimalInput'
import {
  findStaffingPlanOption,
  listStaffingClients,
  listStaffingLobs,
  listStaffingLocations,
  listStaffingPlanOptions,
  listStaffingProjectCodes,
  mergeOptions,
} from '../planner/dbe/staffingPlanOptions'
import {
  BILLABLE_TYPE_OPTIONS,
  resolveBillableTypeOptionValue,
  type BillableTypeOptionValue,
} from '../utils/staffingCapacity/billingModel'
import { loadDbePortfolio, type DbePortfolioOwner } from '../data/capacityPortfolio'
import { useDemoSession } from '../context/DemoSessionContext'
import { isManagerOrAbove } from '../utils/accessLevel'
import { enterActAsPlanner, subscribeCacheReloaded } from '../data/capacityDocuments'
import { subscribeActAs, type ActAsTarget } from '../data/capacityActAs'

const currency = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const currencyRate = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const number2 = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

type FormState = {
  clientName: string
  lobProjectName: string
  location: string
  projectCode: string
  billingType: BillableTypeOptionValue
  agentGroup: string
  billRateMethod: DbeBillRateMethod
  defaults: Record<keyof DbeLobDefaults, string>
  revenueAdjustments: DbeRevenueAdjustment[]
  costItems: DbeCostItem[]
}

function emptyForm(): FormState {
  return {
    clientName: '',
    lobProjectName: '',
    location: '',
    projectCode: '',
    billingType: 'Prod hours',
    agentGroup: '',
    billRateMethod: 'hourly',
    defaults: {
      aht: '',
      loginHours: '',
      absenteeismPct: '',
      shrinkagePct: '',
      occupancyPct: '',
      hourlyBillRate: '',
      monthlyBillRate: '',
      perMinuteBillRate: '',
    },
    revenueAdjustments: [],
    costItems: [],
  }
}

function defaultsFromForm(form: FormState): DbeLobDefaults {
  const num = (raw: string): number => {
    const trimmed = raw.trim()
    if (trimmed === '') return 0
    const v = Number(trimmed)
    return Number.isFinite(v) && v >= 0 ? v : 0
  }
  return {
    aht: num(form.defaults.aht),
    loginHours: num(form.defaults.loginHours),
    absenteeismPct: num(form.defaults.absenteeismPct),
    shrinkagePct: num(form.defaults.shrinkagePct),
    occupancyPct: num(form.defaults.occupancyPct),
    hourlyBillRate: num(form.defaults.hourlyBillRate),
    monthlyBillRate: num(form.defaults.monthlyBillRate),
    perMinuteBillRate: num(form.defaults.perMinuteBillRate),
  }
}

function formatCell(rowId: DbeMetricRowId, value: number): string {
  if (rowId === 'totalRevenue' || rowId === 'discountOrLessToRevenue') return currency.format(value)
  if (rowId === 'hourlyBillRate' || rowId === 'monthlyBillRate' || rowId === 'perMinuteBillRate') {
    return currencyRate.format(value)
  }
  if (rowId === 'absenteeismPct' || rowId === 'shrinkagePct' || rowId === 'occupancyPct') {
    return `${number2.format(value)}%`
  }
  if (rowId === 'productiveHours' || rowId === 'productiveHoursPostOcc' || rowId === 'extraHours') {
    return number2.format(value)
  }
  if (rowId === 'capacity' || rowId === 'fte') {
    return number2.format(value)
  }
  return number2.format(value)
}

function formatInputNumber(value: number): string {
  return number2.format(value)
}

function metricInputValue(
  line: DbeLobLine,
  month: string,
  rowId: DbeMetricRowId,
  staffingAbsenteeism?: number | null,
  staffingShrinkage?: number | null,
): string {
  if (rowId === 'absenteeismPct' && staffingAbsenteeism != null) {
    return String(staffingAbsenteeism)
  }
  if (rowId === 'shrinkagePct' && staffingShrinkage != null) {
    return String(staffingShrinkage)
  }
  const input = line.months[month] ?? emptyMonthInput()
  const map: Partial<Record<DbeMetricRowId, number | null>> = {
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
    discountOrLessToRevenue: input.discountOrLessToRevenue,
    extraHours: input.extraHours,
  }
  const raw = map[rowId]
  if (rowId === 'discountOrLessToRevenue' || rowId === 'extraHours') {
    return raw == null ? '0' : formatInputNumber(raw)
  }
  // Login hours: 0 is treated as empty (falls back to LOB default). Do not invent sample drivers in the cell.
  const treatZeroAsEmpty = rowId === 'loginHours'
  if (raw === null || raw === undefined || (treatZeroAsEmpty && raw === 0)) {
    if (rowId === 'capacity' || rowId === 'fte') return ''
    // Show LOB default only when the line actually has a non-zero default; otherwise leave blank.
    const d = line.defaults
    if (rowId === 'aht') return d.aht ? formatInputNumber(d.aht) : ''
    if (rowId === 'loginHours') return d.loginHours > 0 ? formatInputNumber(d.loginHours) : ''
    if (rowId === 'absenteeismPct') return d.absenteeismPct ? formatInputNumber(d.absenteeismPct) : ''
    if (rowId === 'shrinkagePct') return d.shrinkagePct ? formatInputNumber(d.shrinkagePct) : ''
    if (rowId === 'occupancyPct') return d.occupancyPct ? formatInputNumber(d.occupancyPct) : ''
    if (rowId === 'hourlyBillRate') return d.hourlyBillRate ? formatInputNumber(d.hourlyBillRate) : ''
    if (rowId === 'monthlyBillRate') return d.monthlyBillRate ? formatInputNumber(d.monthlyBillRate) : ''
    if (rowId === 'perMinuteBillRate') return d.perMinuteBillRate ? formatInputNumber(d.perMinuteBillRate) : ''
    return ''
  }
  return formatInputNumber(raw)
}

function dbeCellDraftId(lineId: string, month: string, field: string): string {
  return `${lineId}:${month}:${field}`
}

export function DbePage() {
  const {
    scenarios,
    getScenarioLedger,
    getScenarioForecast,
    getScenarioCapacityPlanOverrides,
    getScenarioShrinkageCategories,
  } = usePlanner()
  const { accessLevel, user } = useDemoSession()

  // Manager and above work the whole book of clients, not just the LOBs they keyed in.
  // Other planners' lines are read-only here: they live in that planner's own rows, and
  // saving them from this page would copy their clients into the reader's document.
  const seesEveryPlanner = isManagerOrAbove(accessLevel)
  const ownEmail = user?.email ?? ''
  const [ownLines, setOwnLines] = useState<DbeLobLine[]>(() => loadDbeLines())
  const [foreignOwners, setForeignOwners] = useState<DbePortfolioOwner[]>([])
  const [portfolioError, setPortfolioError] = useState('')

  const [actingAs, setActingAs] = useState<ActAsTarget | null>(null)
  useEffect(() => subscribeActAs(setActingAs), [])

  // The cache was refilled for a different owner — the lines held in state are the
  // previous owner's, so re-read rather than keep showing and saving them.
  useEffect(() => subscribeCacheReloaded(() => setOwnLines(loadDbeLines())), [])

  useEffect(() => {
    // While standing in for a planner the cache holds their DBE, so the page already
    // shows exactly one person's book. Loading everyone else's on top would label this
    // manager's own LOBs as "someone else's", which is true but useless here.
    if (!seesEveryPlanner || actingAs) {
      setForeignOwners([])
      setPortfolioError('')
      return
    }

    let cancelled = false
    loadDbePortfolio(ownEmail)
      .then((owners) => {
        if (cancelled) return
        setForeignOwners(owners)
        setPortfolioError('')
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setForeignOwners([])
        setPortfolioError(
          error instanceof Error ? error.message : 'Other planners\u2019 DBE lines could not be loaded.',
        )
      })

    return () => {
      cancelled = true
    }
  }, [actingAs, ownEmail, seesEveryPlanner])

  /** Who owns each line the reader did not create, for attribution and edit guards. */
  const foreignOwnerByLineId = useMemo(() => {
    const map = new Map<string, DbePortfolioOwner>()
    for (const owner of foreignOwners) {
      for (const line of owner.lines) map.set(line.id, owner)
    }
    return map
  }, [foreignOwners])

  // Everything the page reads from — own lines first so the reader's work stays on top.
  const lines = useMemo(
    () => [...ownLines, ...foreignOwners.flatMap((owner) => owner.lines)],
    [ownLines, foreignOwners],
  )
  const foreignLineCount = foreignOwnerByLineId.size

  const [form, setForm] = useState<FormState>(emptyForm)
  const [fiscalStartYear, setFiscalStartYear] = useState(() => {
    const now = new Date()
    return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  })
  const [clientFilter, setClientFilter] = useState('all')
  const [locationFilter, setLocationFilter] = useState('all')
  const [lobFilter, setLobFilter] = useState('all')
  const [message, setMessage] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dbeView, setDbeView] = useState<'data' | 'financial'>('data')
  const [period, setPeriod] = useState(() => loadDbePeriod(fiscalStartYear))
  const { getValue: getCellDraft, setDraft: setCellDraft, commitDraft, clearDraft } = useSheetCellDrafts()
  const combinedSheetRef = useRef<HTMLDivElement>(null)
  const templateFileRef = useRef<HTMLInputElement>(null)
  const [templateBusy, setTemplateBusy] = useState(false)

  const allMonths = useMemo(() => listFiscalMonthKeys(fiscalStartYear), [fiscalStartYear])
  const displayMonths = useMemo(
    () => filterDbeMonthKeys(allMonths, period, fiscalStartYear),
    [allMonths, period, fiscalStartYear],
  )
  const clients = useMemo(() => listDbeClients(lines), [lines])
  const locations = useMemo(() => {
    const scoped =
      clientFilter === 'all'
        ? lines
        : lines.filter(
            (line) => line.clientName.trim().toLowerCase() === clientFilter.trim().toLowerCase(),
          )
    return listDbeLocations(scoped)
  }, [lines, clientFilter])
  const lobs = useMemo(() => {
    const scoped = lines.filter((line) => {
      if (
        clientFilter !== 'all' &&
        line.clientName.trim().toLowerCase() !== clientFilter.trim().toLowerCase()
      ) {
        return false
      }
      if (
        locationFilter !== 'all' &&
        line.location.trim().toLowerCase() !== locationFilter.trim().toLowerCase()
      ) {
        return false
      }
      return true
    })
    return listDbeLobs(scoped)
  }, [lines, clientFilter, locationFilter])

  useEffect(() => {
    if (locationFilter !== 'all' && !locations.some((loc) => loc === locationFilter)) {
      setLocationFilter('all')
    }
  }, [locations, locationFilter])

  useEffect(() => {
    if (lobFilter !== 'all' && !lobs.some((lob) => lob === lobFilter)) {
      setLobFilter('all')
    }
  }, [lobs, lobFilter])

  // Form suggestions come from the Staffing Plans first, so a new DBE line lands on
  // the exact spelling the scenario matcher looks for. Existing DBE values are kept
  // as well, since a LOB may legitimately have no plan yet.
  const staffingOptions = useMemo(() => listStaffingPlanOptions(scenarios), [scenarios])
  const clientChoices = useMemo(
    () => mergeOptions(listStaffingClients(staffingOptions), clients),
    [staffingOptions, clients],
  )
  const lobChoices = useMemo(
    () =>
      mergeOptions(
        listStaffingLobs(staffingOptions, form.clientName),
        // Narrow the DBE side to the same client so the two lists agree.
        form.clientName.trim()
          ? listDbeLobs(
              lines.filter((line) =>
                line.clientName.trim().toLowerCase() === form.clientName.trim().toLowerCase(),
              ),
            )
          : lobs,
      ),
    [staffingOptions, form.clientName, lines, lobs],
  )
  const locationChoices = useMemo(
    () => mergeOptions(listStaffingLocations(staffingOptions, form.clientName), locations),
    [staffingOptions, form.clientName, locations],
  )
  const projectCodeChoices = useMemo(
    () =>
      mergeOptions(
        listStaffingProjectCodes(staffingOptions, form.clientName, form.lobProjectName),
        form.clientName.trim()
          ? lines
              .filter(
                (line) =>
                  line.clientName.trim().toLowerCase() === form.clientName.trim().toLowerCase() &&
                  (!form.lobProjectName.trim() ||
                    line.lobProjectName.trim().toLowerCase() ===
                      form.lobProjectName.trim().toLowerCase()),
              )
              .map((line) => line.projectCode)
          : lines.map((line) => line.projectCode),
      ),
    [staffingOptions, form.clientName, form.lobProjectName, lines],
  )
  const matchedPlanOption = useMemo(
    () =>
      findStaffingPlanOption(
        staffingOptions,
        form.clientName,
        form.lobProjectName,
        form.projectCode,
      ),
    [staffingOptions, form.clientName, form.lobProjectName, form.projectCode],
  )

  // Planned Production HC has to come from the derived plan rows, not the raw ledger, or
  // the comparison quotes a headcount the planner never sees. Deriving is expensive and
  // the comparison asks per LOB per month, so each scenario is derived once and cached.
  // The cache is rebuilt whenever any of its inputs change.
  const derivedRowsCache = useMemo(
    () => new Map<string, DerivedCapacityRow[]>(),
    // The factory does not read these, which is why the rule flags them, but they are
    // what the cached rows were derived from: when any of them changes the cache is
    // stale and has to be thrown away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenarios, getScenarioLedger, getScenarioForecast, getScenarioCapacityPlanOverrides],
  )

  const getDerivedRows = useCallback(
    (scenarioId: string): DerivedCapacityRow[] => {
      const cached = derivedRowsCache.get(scenarioId)
      if (cached) return cached
      const scenario = scenarios.find((item) => item.id === scenarioId)
      if (!scenario) return []
      const rows = deriveCapacityRowsForScenario(
        getScenarioLedger(scenarioId),
        scenario,
        getScenarioForecast(scenarioId, 52),
        getScenarioCapacityPlanOverrides(scenarioId),
      )
      derivedRowsCache.set(scenarioId, rows)
      return rows
    },
    [derivedRowsCache, scenarios, getScenarioLedger, getScenarioForecast, getScenarioCapacityPlanOverrides],
  )

  const staffingLookup: StaffingDriverLookup = useMemo(
    () => ({
      scenarios,
      getLedger: getScenarioLedger,
      getOverrides: getScenarioCapacityPlanOverrides,
      getShrinkageCategories: getScenarioShrinkageCategories,
      getDerivedRows,
    }),
    [
      scenarios,
      getScenarioLedger,
      getScenarioCapacityPlanOverrides,
      getScenarioShrinkageCategories,
      getDerivedRows,
    ],
  )

  const visibleLines = useMemo(() => {
    return lines.filter((line) => {
      if (clientFilter !== 'all' && line.clientName.trim().toLowerCase() !== clientFilter.trim().toLowerCase()) {
        return false
      }
      if (
        locationFilter !== 'all' &&
        line.location.trim().toLowerCase() !== locationFilter.trim().toLowerCase()
      ) {
        return false
      }
      if (
        lobFilter !== 'all' &&
        line.lobProjectName.trim().toLowerCase() !== lobFilter.trim().toLowerCase()
      ) {
        return false
      }
      return true
    })
  }, [lines, clientFilter, locationFilter, lobFilter])

  const resolveLineOptions = useMemo(() => {
    return (line: DbeLobLine, month: string): DbeComputeOptions | undefined => {
      if (!line.useStaffingAbsenteeismShrinkage) return undefined
      const drivers = resolveStaffingMonthDrivers(line, month, staffingLookup)
      return {
        absenteeismPct: drivers.absenteeismPct,
        shrinkagePct: drivers.shrinkagePct,
      }
    }
  }, [staffingLookup])

  const selectedClient = clientFilter !== 'all' ? clientFilter : ''
  const clientLobs = useMemo(
    () => (selectedClient ? listClientLobs(lines, selectedClient) : []),
    [lines, selectedClient],
  )
  const combinedMonths = useMemo(() => {
    if (clientFilter === 'all') {
      return combineDbeMonths(visibleLines, displayMonths, resolveLineOptions)
    }
    return combineClientDbeMonths(
      lines.filter(
        (line) =>
          (locationFilter === 'all' ||
            line.location.trim().toLowerCase() === locationFilter.trim().toLowerCase()) &&
          (lobFilter === 'all' ||
            line.lobProjectName.trim().toLowerCase() === lobFilter.trim().toLowerCase()),
      ),
      selectedClient,
      displayMonths,
      resolveLineOptions,
    )
  }, [lines, visibleLines, clientFilter, selectedClient, locationFilter, lobFilter, displayMonths, resolveLineOptions])

  const periodRevenue = useMemo(
    () => combinedMonths.reduce((sum, row) => sum + row.totalRevenue, 0),
    [combinedMonths],
  )

  const revenueComparisonDetail = useMemo(
    () => buildDbeRevenueComparisonRows(visibleLines, displayMonths, staffingLookup),
    [visibleLines, displayMonths, staffingLookup],
  )

  const revenueComparisonMonths = useMemo(
    () => rollupDbeRevenueComparisonByMonth(revenueComparisonDetail),
    [revenueComparisonDetail],
  )

  const clientLabel =
    clientFilter === 'all' ? 'All clients' : selectedClient || clientFilter

  /**
   * When Client + LOB (+ Project Code when set) identify exactly one Staffing Plan,
   * borrow its Location and Project Code. Only blanks are filled — typed values are
   * never overwritten, and an ambiguous or missing match leaves the form untouched.
   */
  function withStaffingPlanDefaults(next: FormState): FormState {
    const option = findStaffingPlanOption(
      staffingOptions,
      next.clientName,
      next.lobProjectName,
      next.projectCode,
    )
    if (!option) {
      // Without a project code, still try Client + LOB alone for location/code autofill.
      if (next.projectCode.trim()) return next
      const byLob = findStaffingPlanOption(staffingOptions, next.clientName, next.lobProjectName)
      if (!byLob) return next
      return {
        ...next,
        location: next.location.trim() ? next.location : byLob.location,
        projectCode: next.projectCode.trim() ? next.projectCode : byLob.projectCode,
      }
    }
    return {
      ...next,
      location: next.location.trim() ? next.location : option.location,
      projectCode: next.projectCode.trim() ? next.projectCode : option.projectCode,
    }
  }

  function handlePeriodChange(next: typeof period) {
    setPeriod(next)
    saveDbePeriod(next)
  }

  function handleFiscalYearChange(year: number) {
    setFiscalStartYear(year)
    setPeriod((prev) => ({
      ...prev,
      years: [String(year), String(year + 1)],
      months: filterDbeMonthKeys(listFiscalMonthKeys(year), prev, year).slice(0, 1),
    }))
  }

  /**
   * Saves only the reader's own rows.
   *
   * Callers build `next` from the combined list, so another planner's lines ride along
   * untouched; dropping them here keeps them out of the reader's document. They are
   * never modified, because every mutation entry point refuses a foreign line first.
   */
  function persist(next: DbeLobLine[]) {
    const mine = next.filter((line) => !foreignOwnerByLineId.has(line.id))
    setOwnLines(mine)
    saveDbeLines(mine)
  }

  /**
   * True when the line belongs to another planner, meaning it cannot be edited in place.
   * The page is showing the reader's own DBE document; changing a foreign line here would
   * copy it into that document. "Edit as <name>" switches owners properly instead.
   */
  function blockForeignEdit(lineId: string): boolean {
    const owner = foreignOwnerByLineId.get(lineId)
    if (!owner) return false
    setMessage(`This LOB belongs to ${owner.name}. Use “Edit as ${owner.name}” to change it.`)
    return true
  }

  /**
   * Hands the whole page over to the planner who owns this LOB. Their DBE document
   * replaces the cache, so their lines become the editable ones and saves land on their
   * rows, recorded against this manager.
   */
  function openAsOwner(lineId: string) {
    const owner = foreignOwnerByLineId.get(lineId)
    if (!owner) return
    setMessage(`Opening ${owner.name}\u2019s DBE\u2026`)
    void enterActAsPlanner({ userId: owner.userId, name: owner.name, email: owner.email })
      .then(() => {
        // The cache now holds their lines; re-read it so the page shows them as editable.
        setOwnLines(loadDbeLines())
        setForeignOwners([])
        setMessage(`Editing ${owner.name}\u2019s DBE.`)
      })
      .catch((error: unknown) => {
        console.error('Could not open that planner\u2019s DBE:', error)
        setMessage(`${owner.name}\u2019s DBE could not be opened. Check your connection and try again.`)
      })
  }

  function toggleStaffingDrivers(lineId: string, enabled: boolean) {
    if (blockForeignEdit(lineId)) return
    const next = lines.map((line) =>
      line.id === lineId
        ? { ...line, useStaffingAbsenteeismShrinkage: enabled, updatedAt: new Date().toISOString() }
        : line,
    )
    persist(next)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const clientName = form.clientName.trim()
    const lobProjectName = form.lobProjectName.trim()
    const location = form.location.trim()
    if (!clientName || !lobProjectName) {
      setMessage('Client Name and LOB / Project Name are required.')
      return
    }
    if (!location) {
      setMessage('Location is required.')
      return
    }

    const payload = {
      clientName,
      lobProjectName,
      location,
      projectCode: form.projectCode.trim(),
      billingType: form.billingType,
      agentGroup: form.agentGroup.trim(),
      billRateMethod: form.billRateMethod,
      defaults: defaultsFromForm(form),
      revenueAdjustments: form.revenueAdjustments,
      costItems: form.costItems,
    }

    if (editingId) {
      if (blockForeignEdit(editingId)) return
      const existing = lines.find((line) => line.id === editingId)
      if (!existing) return
      persist(upsertDbeLine(lines, { ...existing, ...payload }))
      setMessage(`Updated ${lobProjectName} (${location}).`)
    } else {
      const created = createDbeLine({
        ...payload,
        useStaffingAbsenteeismShrinkage: false,
        months: {},
        rowRemarks: {},
      })
      persist([...lines, created])
      setMessage(`Added ${lobProjectName} for ${clientName} · ${location}. Enter month-on-month Capacity below.`)
      setClientFilter(clientName)
    }

    setForm((prev) => ({
      ...emptyForm(),
      clientName,
      location,
      billRateMethod: prev.billRateMethod,
      defaults: prev.defaults,
    }))
    setEditingId(null)
  }

  function startEdit(line: DbeLobLine) {
    if (blockForeignEdit(line.id)) return
    setEditingId(line.id)
    setForm({
      clientName: line.clientName,
      lobProjectName: line.lobProjectName,
      location: line.location,
      projectCode: line.projectCode,
      billingType: resolveBillableTypeOptionValue(line.billingType),
      agentGroup: line.agentGroup,
      billRateMethod: line.billRateMethod,
      defaults: {
        aht: String(line.defaults.aht),
        loginHours: String(line.defaults.loginHours),
        absenteeismPct: String(line.defaults.absenteeismPct),
        shrinkagePct: String(line.defaults.shrinkagePct),
        occupancyPct: String(line.defaults.occupancyPct),
        hourlyBillRate: String(line.defaults.hourlyBillRate),
        monthlyBillRate: line.defaults.monthlyBillRate ? String(line.defaults.monthlyBillRate) : '',
        perMinuteBillRate: line.defaults.perMinuteBillRate ? String(line.defaults.perMinuteBillRate) : '',
      },
      revenueAdjustments: line.revenueAdjustments.map((item) => ({
        ...item,
        months: { ...item.months },
      })),
      costItems: line.costItems.map((item) => ({
        ...item,
        months: { ...item.months },
        breakdown: item.breakdown.map((sub) => ({ ...sub, months: { ...sub.months } })),
      })),
    })
    setClientFilter(line.clientName)
    setMessage(`Editing ${line.lobProjectName}.`)
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm())
    setMessage('')
  }

  function removeLine(id: string) {
    if (blockForeignEdit(id)) return
    const target = lines.find((line) => line.id === id)
    if (!target) return
    if (!window.confirm(`Remove ${target.lobProjectName} (${target.location}) from DBE?`)) return
    persist(deleteDbeLine(lines, id))
    if (editingId === id) cancelEdit()
    setMessage(`Removed ${target.lobProjectName}.`)
  }

  function setRowRemark(lineId: string, rowKey: string, text: string) {
    if (blockForeignEdit(lineId)) return
    const next = lines.map((line) => {
      if (line.id !== lineId) return line
      const rowRemarks = { ...line.rowRemarks }
      const trimmed = text.trim()
      if (trimmed) rowRemarks[rowKey] = text
      else delete rowRemarks[rowKey]
      return {
        ...line,
        rowRemarks,
        updatedAt: new Date().toISOString(),
      }
    })
    persist(next)
  }

  function setMonthField(lineId: string, month: string, field: keyof DbeMonthInput, raw: string) {
    if (blockForeignEdit(lineId)) return
    const value = raw.trim() === '' ? null : Number(raw)
    if (value !== null && (!Number.isFinite(value) || value < 0)) return
    const next = lines.map((line) => {
      if (line.id !== lineId) return line
      const prevMonth = line.months[month] ?? emptyMonthInput()
      return {
        ...line,
        months: {
          ...line.months,
          [month]: { ...prevMonth, [field]: value },
        },
        updatedAt: new Date().toISOString(),
      }
    })
    persist(next)
  }

  function setRevenueAdjustmentField(lineId: string, adjId: string, month: string, raw: string) {
    if (blockForeignEdit(lineId)) return
    const value = raw.trim() === '' ? null : Number(raw)
    if (value !== null && (!Number.isFinite(value) || value < 0)) return
    const next = lines.map((line) => {
      if (line.id !== lineId) return line
      return {
        ...line,
        revenueAdjustments: line.revenueAdjustments.map((adj) =>
          adj.id === adjId
            ? { ...adj, months: { ...adj.months, [month]: value } }
            : adj,
        ),
        updatedAt: new Date().toISOString(),
      }
    })
    persist(next)
  }

  function setCostItemField(lineId: string, itemId: string, month: string, raw: string) {
    if (blockForeignEdit(lineId)) return
    const value = raw.trim() === '' ? null : Number(raw)
    if (value !== null && (!Number.isFinite(value) || value < 0)) return
    const next = lines.map((line) => {
      if (line.id !== lineId) return line
      return {
        ...line,
        costItems: line.costItems.map((item) =>
          item.id === itemId ? { ...item, months: { ...item.months, [month]: value } } : item,
        ),
        updatedAt: new Date().toISOString(),
      }
    })
    persist(next)
  }

  function setCostBreakdownField(
    lineId: string,
    itemId: string,
    subId: string,
    month: string,
    raw: string,
  ) {
    if (blockForeignEdit(lineId)) return
    const value = raw.trim() === '' ? null : Number(raw)
    if (value !== null && (!Number.isFinite(value) || value < 0)) return
    const next = lines.map((line) => {
      if (line.id !== lineId) return line
      return {
        ...line,
        costItems: line.costItems.map((item) =>
          item.id === itemId
            ? {
                ...item,
                breakdown: item.breakdown.map((sub) =>
                  sub.id === subId ? { ...sub, months: { ...sub.months, [month]: value } } : sub,
                ),
              }
            : item,
        ),
        updatedAt: new Date().toISOString(),
      }
    })
    persist(next)
  }

  /** Underscored, for download filenames. */
  const exportTitle = useMemo(() => {
    if (clientFilter === 'all') return 'DBE_All_Clients'
    return `DBE_${selectedClient || clientFilter}`
  }, [clientFilter, selectedClient])

  /** Readable, for the printed page header — filenames make poor report titles. */
  const printTitle = useMemo(() => {
    const scope = clientFilter === 'all' ? 'All clients' : selectedClient || clientFilter
    return `DBE — ${scope} · ${dbePeriodSummaryLabel(period, fiscalStartYear)}`
  }, [clientFilter, selectedClient, period, fiscalStartYear])

  function exportDbeExcel() {
    downloadDbeWorkbook(visibleLines, displayMonths, exportTitle, resolveLineOptions)
  }

  function exportDbeDataCsv() {
    downloadDbeCsv(visibleLines, displayMonths, exportTitle, resolveLineOptions)
  }

  function downloadAddClientTemplate() {
    downloadDbeClientTemplate(fiscalStartYear)
    setMessage(`Downloaded DBE Add Client template for FY ${fiscalStartYear}–${String(fiscalStartYear + 1).slice(2)}.`)
  }

  async function handleTemplateUpload(file: File | null) {
    if (!file) return
    setTemplateBusy(true)
    try {
      const result = await parseDbeClientTemplateFile(file, fiscalStartYear)
      if (!result.lines.length) {
        setMessage(result.errors[0] ?? result.message)
        return
      }
      const setupKeys = new Set(result.setupIdentityKeys)
      const costKeys = new Set(result.costIdentityKeys)
      const merged = mergeDbeTemplateImport(ownLines, result.lines, {
        setupIdentityKeys: setupKeys,
        costIdentityKeys: costKeys,
      })
      persist(merged.lines)
      const firstClient = result.lines[0]?.clientName
      if (firstClient) setClientFilter(firstClient)
      const mergeNote =
        merged.addedCount || merged.updatedCount
          ? ` ${merged.updatedCount} line${merged.updatedCount === 1 ? '' : 's'} updated, ${merged.addedCount} added, ${merged.unchangedCount} unchanged.`
          : ''
      const warn = result.warnings.length ? ` ${result.warnings.slice(0, 2).join(' ')}` : ''
      const err = result.errors.length ? ` ${result.errors.slice(0, 2).join(' ')}` : ''
      setMessage(`${result.message}${mergeNote}${warn}${err}`)
      setEditingId(null)
      setForm(emptyForm())
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Template upload failed.')
    } finally {
      setTemplateBusy(false)
      if (templateFileRef.current) templateFileRef.current.value = ''
    }
  }

  function exportDbeReportPdf() {
    if (!combinedSheetRef.current) return
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=1400,height=900')
    if (!printWindow) return
    printWindow.document.write(
      `<!DOCTYPE html><html><head><title>${printTitle}</title><style>
        body { font-family: Segoe UI, sans-serif; margin: 16px; }
        table { border-collapse: collapse; width: 100%; font-size: 12px; }
        th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: right; }
        th:first-child, td:first-child { text-align: left; }
        .total { font-weight: 700; background: #f8fafc; }
        @page { size: landscape; margin: 12mm; }
      </style></head><body>${combinedSheetRef.current.innerHTML}</body></html>`,
    )
    printWindow.document.close()
    printWindow.focus()
    printWindow.onload = () => printWindow.print()
  }

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear()
    return [current - 2, current - 1, current, current + 1]
  }, [])

  return (
    <div className="cap-dbe cap-staffing saas-page">
      <ModulePageHeader
        title="DBE"
        description="Client · Location · LOB capacity and financials."
        actions={
          <div className="cap-dbe__toolbar">
            <label className="cap-dbe__year">
              <span>Fiscal year (Apr–Mar)</span>
              <select
                value={fiscalStartYear}
                onChange={(event) => handleFiscalYearChange(Number(event.target.value))}
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    FY {y}–{String(y + 1).slice(2)}
                  </option>
                ))}
              </select>
            </label>
            <label className="cap-dbe__year">
              <span>Client</span>
              <select
                value={clientFilter}
                onChange={(event) => {
                  setClientFilter(event.target.value)
                  setLocationFilter('all')
                  setLobFilter('all')
                }}
              >
                <option value="all">All clients</option>
                {clients.map((client) => (
                  <option key={client} value={client}>
                    {client}
                  </option>
                ))}
              </select>
            </label>
            <label className="cap-dbe__year">
              <span>Location</span>
              <select
                value={locationFilter}
                onChange={(event) => {
                  setLocationFilter(event.target.value)
                  setLobFilter('all')
                }}
              >
                <option value="all">All locations</option>
                {locations.map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </label>
            <label className="cap-dbe__year">
              <span>LOB</span>
              <select value={lobFilter} onChange={(event) => setLobFilter(event.target.value)}>
                <option value="all">All LOBs</option>
                {lobs.map((lob) => (
                  <option key={lob} value={lob}>
                    {lob}
                  </option>
                ))}
              </select>
            </label>
            <details className="cap-capacity-download-menu">
              <summary className="saas-btn saas-btn--secondary cap-capacity-download-menu__trigger">Download</summary>
              <div className="cap-capacity-download-menu__panel">
                <button type="button" className="cap-capacity-download-menu__item" onClick={exportDbeExcel}>
                  Excel workbook
                </button>
                <button type="button" className="cap-capacity-download-menu__item" onClick={exportDbeDataCsv}>
                  Data (CSV)
                </button>
                <button type="button" className="cap-capacity-download-menu__item" onClick={exportDbeReportPdf}>
                  Report (PDF / print)
                </button>
              </div>
            </details>
          </div>
        }
      />

      {message ? (
        <p className="cap-dbe__message" role="status">
          {message}
        </p>
      ) : null}

      {seesEveryPlanner ? (
        <p className="saas-muted m-0 text-sm" role="status">
          {portfolioError
            ? portfolioError
            : foreignOwners.length
              ? `Showing every client in DBE, including ${foreignLineCount} LOB${foreignLineCount === 1 ? '' : 's'} from ${foreignOwners.length} other planner${foreignOwners.length === 1 ? '' : 's'}. Their lines are view only.`
              : 'Showing every client in DBE. No other planner has added a LOB yet.'}
        </p>
      ) : null}

      <div className="cap-dbe__view-bar">
        <div className="cap-dbe__view-tabs" role="tablist" aria-label="DBE views">
          <button
            type="button"
            role="tab"
            aria-selected={dbeView === 'data'}
            className={`cap-dbe__view-tab${dbeView === 'data' ? ' is-active' : ''}`}
            onClick={() => setDbeView('data')}
          >
            DBE data
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={dbeView === 'financial'}
            className={`cap-dbe__view-tab${dbeView === 'financial' ? ' is-active' : ''}`}
            onClick={() => setDbeView('financial')}
          >
            Financial summary
          </button>
        </div>
        <DbePeriodFilter
          state={period}
          onChange={handlePeriodChange}
          fiscalMonths={allMonths}
        />
      </div>

      {dbeView === 'financial' ? (
        <DbeFinancialSummaryPanel
          combinedMonths={combinedMonths}
          period={period}
          fiscalStartYear={fiscalStartYear}
          clientLabel={clientLabel}
          revenueComparisonMonths={revenueComparisonMonths}
          revenueComparisonDetail={revenueComparisonDetail}
        />
      ) : null}

      {dbeView === 'data' ? (
        <>
      <section className="cap-panel cap-panel--accent cap-dbe__combined">
        <div className="cap-dbe__combined-head">
          <div>
            <h3 className="cap-panel__title">
              {clientFilter === 'all' ? 'Combined — All clients' : `Combined — ${selectedClient}`}
            </h3>
            <p className="cap-panel__desc">
              {dbePeriodSummaryLabel(period, fiscalStartYear)}
              {combinedMonths[0]?.lobCount
                ? ` · ${combinedMonths[0].lobCount} LOB line${combinedMonths[0].lobCount === 1 ? '' : 's'}`
                : ''}
            </p>
          </div>
          <div className="cap-dbe__kpi">
            <span className="cap-dbe__kpi-label">{dbePeriodSummaryLabel(period, fiscalStartYear)} revenue</span>
            <strong className="cap-dbe__kpi-value">{currency.format(periodRevenue)}</strong>
          </div>
        </div>
        {clientFilter !== 'all' ? (
          <ul className="cap-dbe__lob-list">
            {clientLobs
              .filter(
                (lob) =>
                  (locationFilter === 'all' ||
                    lob.location.trim().toLowerCase() === locationFilter.trim().toLowerCase()) &&
                  (lobFilter === 'all' ||
                    lob.lobProjectName.trim().toLowerCase() === lobFilter.trim().toLowerCase()),
              )
              .map((lob) => (
                <li key={lob.id}>
                  <strong>{lob.lobProjectName}</strong>
                  <span>{lob.location}</span>
                  <span>{lob.projectCode || 'no code'}</span>
                  <span>
                    {currency.format(lineYearRevenue(lob, displayMonths, (month) => resolveLineOptions(lob, month)))}
                  </span>
                </li>
              ))}
          </ul>
        ) : null}
        {combinedMonths[0]?.lobCount && displayMonths.length ? (
          <div className="cap-dbe__sheet-wrap" ref={combinedSheetRef}>
            <table className="cap-dbe-sheet">
              <thead>
                <tr>
                  <th>Combined metrics</th>
                  {displayMonths.map((month) => (
                    <th key={month}>{formatFiscalMonthLabel(month)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Capacity / Transactions</td>
                  {combinedMonths.map((row) => (
                    <td key={row.month}>
                      {row.capacity > 0 ? row.capacity.toLocaleString() : '—'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>FTE</td>
                  {combinedMonths.map((row) => (
                    <td key={row.month}>{row.fte > 0 ? row.fte.toLocaleString() : '—'}</td>
                  ))}
                </tr>
                <tr>
                  <td>Productive hours</td>
                  {combinedMonths.map((row) => (
                    <td key={row.month}>
                      {row.productiveHours > 0
                        ? row.productiveHours.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        : '—'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>Productive Hours post Occupancy</td>
                  {combinedMonths.map((row) => (
                    <td key={row.month}>
                      {row.productiveHoursPostOcc > 0
                        ? row.productiveHoursPostOcc.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })
                        : '—'}
                    </td>
                  ))}
                </tr>
                <tr className="cap-dbe-sheet__total">
                  <td>Total Revenue</td>
                  {combinedMonths.map((row) => (
                    <td key={row.month}>{currency.format(row.totalRevenue)}</td>
                  ))}
                </tr>
                <tr>
                  <td>Total Cost</td>
                  {combinedMonths.map((row) => (
                    <td key={row.month}>{currency.format(row.totalCost)}</td>
                  ))}
                </tr>
                <tr className="cap-dbe-sheet__total">
                  <td>GM</td>
                  {combinedMonths.map((row) => (
                    <td key={row.month}>{currency.format(row.gm)}</td>
                  ))}
                </tr>
                <tr className="cap-dbe-sheet__total">
                  <td>GM %</td>
                  {combinedMonths.map((row) => (
                    <td key={row.month}>{number2.format(row.gmPct)}%</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p className="cap-panel__desc">
            {displayMonths.length === 0
              ? 'No months match the current period filter. Adjust Monthly / Quarterly / H1 / H2 / Yearly above.'
              : 'No DBE lines match the current filters.'}
          </p>
        )}
      </section>

      <section className="cap-panel cap-dbe__form-panel">
        <h3 className="cap-panel__title">{editingId ? 'Edit Client / LOB' : 'Add Client, Location & LOB'}</h3>
        <p className="cap-panel__desc">
          Add from the form or upload the Excel template (Setup, Monthly Capacity, Costs).
        </p>

        {!editingId ? (
          <div className="cap-dbe__template-bar" aria-label="Add client template">
            <button type="button" className="saas-btn saas-btn--secondary" onClick={downloadAddClientTemplate}>
              Download Add Client template
            </button>
            <button
              type="button"
              className="saas-btn"
              disabled={templateBusy}
              onClick={() => templateFileRef.current?.click()}
            >
              {templateBusy ? 'Uploading…' : 'Upload filled template'}
            </button>
            <input
              ref={templateFileRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="cap-dbe__template-file"
              onChange={(event) => void handleTemplateUpload(event.target.files?.[0] ?? null)}
            />
            <p className="cap-dbe__template-hint saas-muted m-0 text-sm">
              Merges by Client + LOB + Location + Project Code for FY {fiscalStartYear}–
              {String(fiscalStartYear + 1).slice(2)}.
            </p>
          </div>
        ) : null}

        <form className="cap-dbe__form" onSubmit={handleSubmit}>
          <label>
            <span>Client Name</span>
            <input
              list="dbe-client-names"
              className="cap-field__input"
              value={form.clientName}
              placeholder="e.g. Contoso"
              onChange={(event) =>
                setForm((prev) => withStaffingPlanDefaults({ ...prev, clientName: event.target.value }))
              }
              required
            />
            <datalist id="dbe-client-names">
              {clientChoices.map((client) => (
                <option key={client} value={client} />
              ))}
            </datalist>
          </label>
          <label>
            <span>LOB / Project Name</span>
            <input
              list="dbe-lob-names"
              className="cap-field__input"
              value={form.lobProjectName}
              placeholder="e.g. Voice · Tier 1"
              onChange={(event) =>
                setForm((prev) =>
                  withStaffingPlanDefaults({ ...prev, lobProjectName: event.target.value }),
                )
              }
              required
            />
            <datalist id="dbe-lob-names">
              {lobChoices.map((lob) => (
                <option key={lob} value={lob} />
              ))}
            </datalist>
            {matchedPlanOption ? (
              <small className="cap-field__hint">
                Matches Staffing Plan “{matchedPlanOption.scenarioName}”.
              </small>
            ) : null}
          </label>
          <label>
            <span>Location</span>
            <input
              list="dbe-locations"
              className="cap-field__input"
              value={form.location}
              onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
              placeholder="e.g. Manila"
              required
            />
            <datalist id="dbe-locations">
              {locationChoices.map((loc) => (
                <option key={loc} value={loc} />
              ))}
            </datalist>
          </label>
          <label>
            <span>Project Code</span>
            <input
              list="dbe-project-codes"
              className="cap-field__input"
              value={form.projectCode}
              placeholder="e.g. PRJ-1001"
              onChange={(event) =>
                setForm((prev) =>
                  withStaffingPlanDefaults({ ...prev, projectCode: event.target.value }),
                )
              }
            />
            <datalist id="dbe-project-codes">
              {projectCodeChoices.map((code) => (
                <option key={code} value={code} />
              ))}
            </datalist>
          </label>
          <label>
            <span>Billing type</span>
            <select
              className="cap-field__input"
              value={form.billingType}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  billingType: resolveBillableTypeOptionValue(event.target.value),
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
          <label>
            <span>Bill rate method</span>
            <select
              className="cap-field__input"
              value={form.billRateMethod}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  billRateMethod: event.target.value as DbeBillRateMethod,
                }))
              }
            >
              {DBE_BILL_RATE_METHODS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Group of Agents</span>
            <input
              className="cap-field__input"
              value={form.agentGroup}
              placeholder="e.g. Day shift · Nesting"
              onChange={(event) => setForm((prev) => ({ ...prev, agentGroup: event.target.value }))}
            />
          </label>

          <div className="cap-dbe__defaults">
            <p className="cap-dbe__defaults-title">Default monthly drivers &amp; bill rates</p>
            <div className="cap-dbe__defaults-grid">
              {(
                [
                  ['aht', 'AHT', 'e.g. 320'],
                  ['loginHours', 'Login Hours', 'e.g. 160'],
                  ['absenteeismPct', 'Absenteeism %', 'e.g. 5'],
                  ['shrinkagePct', 'Shrinkage %', 'e.g. 12'],
                  ['occupancyPct', 'Occupancy %', 'e.g. 85'],
                  ['hourlyBillRate', 'Hourly Bill Rate', 'Optional'],
                  ['monthlyBillRate', 'Monthly Bill Rate', 'Optional'],
                  ['perMinuteBillRate', 'Per Minute Bill Rate', 'Optional'],
                ] as const
              ).map(([key, label, placeholder]) => (
                <label key={key}>
                  <span>{label}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="cap-field__input"
                    value={form.defaults[key]}
                    placeholder={placeholder}
                    title="Type a number"
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => {
                      const next = event.target.value
                      if (next !== '' && !/^\d*\.?\d*$/.test(next)) return
                      setForm((prev) => ({
                        ...prev,
                        defaults: { ...prev.defaults, [key]: next },
                      }))
                    }}
                  />
                </label>
              ))}
            </div>
          </div>

          <DbeFormMetricsEditor
            revenueAdjustments={form.revenueAdjustments}
            costItems={form.costItems}
            onRevenueAdjustmentsChange={(next) => setForm((prev) => ({ ...prev, revenueAdjustments: next }))}
            onCostItemsChange={(next) => setForm((prev) => ({ ...prev, costItems: next }))}
          />

          <div className="cap-dbe__form-actions">
            <button type="submit" className="cap-dbe__btn cap-dbe__btn--primary">
              {editingId ? 'Save changes' : 'Add to DBE'}
            </button>
            {editingId ? (
              <button type="button" className="cap-dbe__btn" onClick={cancelEdit}>
                Cancel
              </button>
            ) : null}
          </div>
        </form>
      </section>

      {visibleLines.length === 0 ? (
        <section className="cap-panel">
          <p className="cap-dbe__empty">No DBE lines yet. Add a client, location, and LOB above.</p>
        </section>
      ) : (
        visibleLines.map((line) => {
          const yearRev = lineYearRevenue(line, displayMonths, (month) => resolveLineOptions(line, month))
          const matchedStaffing = line.useStaffingAbsenteeismShrinkage
            ? findStaffingScenarioForDbeLine(line, staffingLookup)
            : null
          const staffingHasDrivers =
            line.useStaffingAbsenteeismShrinkage && staffingScenarioHasDriverData(line, staffingLookup)
          const staffingMissingMatch = line.useStaffingAbsenteeismShrinkage && !matchedStaffing
          const staffingMissingDrivers =
            line.useStaffingAbsenteeismShrinkage && Boolean(matchedStaffing) && !staffingHasDrivers
          return (
            <section key={line.id} className="cap-dbe__lob-block">
              <div className="cap-dbe__lob-head">
                <div>
                  <h3 className="cap-dbe__lob-title">
                    {line.clientName} — {line.lobProjectName}
                  </h3>
                  <p className="cap-dbe__lob-meta">
                    {line.location}
                    {line.projectCode ? ` · ${line.projectCode}` : ''}
                    {line.agentGroup ? ` · ${line.agentGroup}` : ''}
                    {` · ${line.billingType}`}
                    {` · ${billRateMethodLabel(line.billRateMethod)}`}
                    {` · FY revenue ${currency.format(yearRev)}`}
                  </p>
                  <label className="cap-dbe__staffing-toggle">
                    <input
                      type="checkbox"
                      checked={line.useStaffingAbsenteeismShrinkage}
                      disabled={foreignOwnerByLineId.has(line.id)}
                      onChange={(event) => toggleStaffingDrivers(line.id, event.target.checked)}
                    />
                    <span>Use Staffing Plan planned Absenteeism &amp; Shrinkage</span>
                  </label>
                  {matchedStaffing && staffingHasDrivers ? (
                    <p className="cap-dbe__staffing-ok" role="status">
                      Linked to Staffing Plan “{matchedStaffing.name || matchedStaffing.plan.client}”. Absenteeism uses
                      planned Absenteeism; Shrinkage uses Planned in-office shrinkage (Break excluded).
                    </p>
                  ) : null}
                  {staffingMissingMatch ? (
                    <p className="cap-dbe__staffing-warn" role="status">
                      No matching Staffing Plan found for this Client / Location / LOB. Absenteeism and Shrinkage are set
                      to 0%. Align Client Name and LOB with the Staffing Plan, or set planned drivers there first.
                    </p>
                  ) : null}
                  {staffingMissingDrivers ? (
                    <p className="cap-dbe__staffing-warn" role="status">
                      Staffing Plan matched, but no planned Absenteeism / in-office Shrinkage values were found.
                      Absenteeism and Shrinkage are set to 0%. Enter them on the Staffing Plan weekly grid.
                    </p>
                  ) : null}
                </div>
                <div className="cap-dbe__row-actions">
                  {foreignOwnerByLineId.has(line.id) ? (
                    // Someone else's LOB. Editing it means switching the whole page over to
                    // that planner, because their LOBs live in their own document — so this
                    // is an explicit hand-off rather than an inline edit.
                    <button
                      type="button"
                      className="cap-dbe__link"
                      onClick={() => openAsOwner(line.id)}
                    >
                      Edit as {foreignOwnerByLineId.get(line.id)!.name}
                    </button>
                  ) : (
                    <>
                      <button type="button" className="cap-dbe__link" onClick={() => startEdit(line)}>
                        Edit setup
                      </button>
                      <button
                        type="button"
                        className="cap-dbe__link cap-dbe__link--danger"
                        onClick={() => removeLine(line.id)}
                      >
                        Remove
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="cap-dbe__sheet-wrap">
                <table className="cap-dbe-sheet">
                  <thead>
                    <tr>
                      <th>Client and LOB Name</th>
                      {displayMonths.map((month) => (
                        <th key={month}>
                          {formatFiscalMonthLabel(month)}
                          <span className="cap-dbe-sheet__days">
                            {computeDbeMonth(line, month, resolveLineOptions(line, month)).networkDays}d
                          </span>
                        </th>
                      ))}
                      <th className="cap-dbe-sheet__remark-head">Remarks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DBE_METRIC_ROWS.filter((row) => {
                      if (row.id === 'totalRevenue') return false
                      if (row.id === 'fte') return isFteBillingPlan(line.billingType)
                      if (row.id === 'hourlyBillRate') return line.billRateMethod === 'hourly'
                      if (row.id === 'monthlyBillRate') return line.billRateMethod === 'monthly'
                      if (row.id === 'perMinuteBillRate') return line.billRateMethod === 'per_minute'
                      return true
                    }).map((row) => {
                      const isTotal = row.id === 'totalRevenue'
                      const isActiveRate =
                        (row.id === 'hourlyBillRate' && line.billRateMethod === 'hourly') ||
                        (row.id === 'monthlyBillRate' && line.billRateMethod === 'monthly') ||
                        (row.id === 'perMinuteBillRate' && line.billRateMethod === 'per_minute')
                      const isFteRow = row.id === 'fte'
                      const staffingLocked =
                        line.useStaffingAbsenteeismShrinkage &&
                        (row.id === 'absenteeismPct' || row.id === 'shrinkagePct')
                      return (
                        <tr
                          key={row.id}
                          className={
                            isTotal
                              ? 'cap-dbe-sheet__total'
                              : isActiveRate || isFteRow
                                ? 'cap-dbe-sheet__active-rate'
                                : undefined
                          }
                        >
                          <td>
                            {row.label}
                            {isActiveRate ? <span className="cap-dbe-sheet__active-tag"> active</span> : null}
                            {isFteRow ? <span className="cap-dbe-sheet__active-tag"> FTE billing</span> : null}
                            {staffingLocked ? (
                              <span className="cap-dbe-sheet__active-tag"> from Staffing Plan</span>
                            ) : null}
                          </td>
                          {displayMonths.map((month) => {
                            const options = resolveLineOptions(line, month)
                            const computed = computeDbeMonth(line, month, options)
                            if (!row.editable || staffingLocked) {
                              const value =
                                row.id === 'productiveHours'
                                  ? computed.productiveHours
                                  : row.id === 'productiveHoursPostOcc'
                                    ? computed.productiveHoursPostOcc
                                    : row.id === 'absenteeismPct'
                                      ? computed.absenteeismPct
                                      : row.id === 'shrinkagePct'
                                        ? computed.shrinkagePct
                                        : computed.totalRevenue
                              const show =
                                row.id === 'totalRevenue'
                                  ? value !== 0 ||
                                    computed.extraHours > 0 ||
                                    computed.discountOrLessToRevenue > 0 ||
                                    (computed.fteBilling ? computed.fte > 0 : computed.capacity > 0)
                                  : row.id === 'absenteeismPct' || row.id === 'shrinkagePct'
                                    ? true
                                    : value > 0
                              return (
                                <td key={month} className="cap-dbe-sheet__computed">
                                  {show ? formatCell(row.id, value) : '—'}
                                </td>
                              )
                            }

                            const field = row.id as keyof DbeMonthInput
                            return (
                              <td key={month} className="cap-dbe-sheet__input-cell">
                                <DbeSheetCellInput
                                  draftId={dbeCellDraftId(line.id, month, field)}
                                  value={getCellDraft(
                                    dbeCellDraftId(line.id, month, field),
                                    metricInputValue(line, month, row.id, options?.absenteeismPct, options?.shrinkagePct),
                                  )}
                                  ariaLabel={`${row.label} ${formatFiscalMonthLabel(month)}`}
                                  onDraftChange={setCellDraft}
                                  onCommit={(draftId) =>
                                    commitDraft(
                                      draftId,
                                      metricInputValue(
                                        line,
                                        month,
                                        row.id,
                                        options?.absenteeismPct,
                                        options?.shrinkagePct,
                                      ),
                                      (raw) => setMonthField(line.id, month, field, raw),
                                    )
                                  }
                                  onClear={(draftId) => clearDraft(draftId)}
                                />
                              </td>
                            )
                          })}
                          <DbeRemarkCell
                            value={getDbeRowRemark(line, dbeRemarkKey('metric', row.id))}
                            label={`Remarks — ${row.label}`}
                            onChange={(text) => setRowRemark(line.id, dbeRemarkKey('metric', row.id), text)}
                          />
                        </tr>
                      )
                    })}
                    {line.revenueAdjustments.map((adj) => (
                      <tr key={adj.id}>
                        <td>
                          {adj.label}
                          <span className="cap-dbe-sheet__active-tag">
                            {' '}
                            {adj.effect === 'deduct' ? '−' : '+'} {adj.mode === 'percent' ? '%' : '$'}
                          </span>
                        </td>
                        {displayMonths.map((month) => {
                          const options = resolveLineOptions(line, month)
                          const computed = computeDbeMonth(line, month, options)
                          const applied = computed.revenueAdjustmentsApplied[adj.id] ?? 0
                          const raw = adj.months[month]
                          // Blank means "use the row default", shown as a placeholder.
                          const display = raw === null || raw === undefined ? '' : String(raw)
                          return (
                            <td key={month} className="cap-dbe-sheet__input-cell">
                              <DbeSoftDecimalInput
                                value={display}
                                placeholder={String(adj.defaultValue)}
                                onChange={(next) =>
                                  setRevenueAdjustmentField(line.id, adj.id, month, next)
                                }
                                ariaLabel={`${adj.label} ${formatFiscalMonthLabel(month)}`}
                              />
                              <span className="cap-dbe__applied">{currency.format(applied)}</span>
                            </td>
                          )
                        })}
                        <DbeRemarkCell
                          value={getDbeRowRemark(line, dbeRemarkKey('rev', adj.id))}
                          label={`Remarks — ${adj.label}`}
                          onChange={(text) => setRowRemark(line.id, dbeRemarkKey('rev', adj.id), text)}
                        />
                      </tr>
                    ))}
                    <tr className="cap-dbe-sheet__total">
                      <td>Total Revenue</td>
                      {displayMonths.map((month) => {
                        const options = resolveLineOptions(line, month)
                        const computed = computeDbeMonth(line, month, options)
                        return (
                          <td key={month} className="cap-dbe-sheet__computed">
                            {formatCell('totalRevenue', computed.totalRevenue)}
                          </td>
                        )
                      })}
                      <DbeRemarkCell
                        value={getDbeRowRemark(line, dbeRemarkKey('total-revenue'))}
                        label="Remarks — Total Revenue"
                        onChange={(text) => setRowRemark(line.id, dbeRemarkKey('total-revenue'), text)}
                      />
                    </tr>
                  </tbody>
                </table>
              </div>

              <DbeLineCostTable
                line={line}
                months={displayMonths}
                resolveOptions={(month) => resolveLineOptions(line, month)}
                onCostItemChange={setCostItemField}
                onCostBreakdownChange={setCostBreakdownField}
                onRowRemarkChange={setRowRemark}
              />
            </section>
          )
        })
      )}
        </>
      ) : null}
    </div>
  )
}

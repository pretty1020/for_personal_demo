import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useWorkbook } from './WorkbookContext'
import { usePlanner } from './PlannerContext'
import {
  financialScopeIdFromFilters,
  listFinancialChannelOptions,
  listFinancialClientNames,
  listFinancialLobOptions,
  listFinancialLocationNames,
  resolveCapacityFinancialScope,
  type FinancialLobOption,
} from '../planner/capacityFinancialScope'
import { combineCapacityRows, deriveCapacityPlanRows } from '../planner/capacityPlanDerived'
import { filterCommitActualsRows } from '../utils/commitVsActualsAnalytics'
import {
  uniqIdealClients,
  uniqIdealMonths,
  type IdealSampleRow,
} from '../utils/idealFinancialSample'
import { buildIdealFinancialPanelModel, type TrendGranularity } from '../utils/idealFinancialTrending'
import type { CalendarQuarter, PeriodView } from '../utils/executiveQuarter'
import type { ExecutiveUnifiedRow } from '../types/dashboard'
import type { WeeklyChangeRow } from '../types/dashboard'
import {
  defaultWeekWindow,
  filterRowsByWeekRange,
  IDEAL_DEFAULT_WEEK_COUNT,
  uniqIdealWeeks,
} from '../utils/idealWeekRange'
import {
  capacityMonthOptions,
  resolveCapacityWeekWindow,
  resolveFiscalYearWeekWindow,
  uniqCapacityWeeks,
} from '../utils/capacityWeekRange'
import { factsFromExecutiveModel, hasIdealFinancialFactRows } from '../utils/idealLiveData'
import type { ChannelType } from '../planner/types'
import { resolveClientIndustry } from '../planner/clientRegistry'
import {
  buildCommitActualsTableRowsFromFacts,
  buildProjectionWowFromCommitFacts,
} from '../utils/idealFinancialFromUpload'

export type IdealDataMode = 'sample' | 'live'

export type IdealFinancialContextValue = {
  dataMode: IdealDataMode
  setDataMode: (m: IdealDataMode) => void
  liveDataAvailable: boolean
  allFacts: ExecutiveUnifiedRow[]
  filteredRows: ExecutiveUnifiedRow[]
  projectionWow: WeeklyChangeRow[]
  sampleTable: IdealSampleRow[]
  monthOptions: string[]
  clientOptions: string[]
  weekOptions: string[]
  weekStart: string
  weekEnd: string
  setWeekStart: (v: string) => void
  setWeekEnd: (v: string) => void
  periodView: PeriodView
  setPeriodView: (v: PeriodView) => void
  calendarYear: string
  setCalendarYear: (v: string) => void
  month: string
  setMonth: (v: string) => void
  quarter: '' | CalendarQuarter
  setQuarter: (v: CalendarQuarter | '') => void
  client: string
  capacityScopeLabel: string
  setClient: (v: string) => void
  industry: string
  setIndustry: (v: string) => void
  location: string
  setLocation: (v: string) => void
  channel: ChannelType | ''
  setChannel: (v: ChannelType | '') => void
  showNextYear: boolean
  setShowNextYear: (open: boolean) => void
  lobId: string
  setLobId: (v: string) => void
  financialScopeId: string
  financialClientOptions: string[]
  financialLocationOptions: string[]
  financialChannelOptions: ChannelType[]
  financialLobOptions: FinancialLobOption[]
  yearOptions: string[]
  trendGranularity: TrendGranularity
  setTrendGranularity: (v: TrendGranularity) => void
  periodLabel: string
  dateRangeOpen: boolean
  setDateRangeOpen: (open: boolean) => void
  dateRangeActive: boolean
  capacityWeekOptions: string[]
  model: ReturnType<typeof buildIdealFinancialPanelModel>
  sampleSheetName: string
}

const IdealFinancialContext = createContext<IdealFinancialContextValue | null>(null)

function formatMonthLabel(month: string): string {
  if (month.length < 7) return month
  const date = new Date(`${month}-01T12:00:00`)
  if (Number.isNaN(date.getTime())) return month
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function periodLabel(
  periodView: PeriodView,
  calendarYear: string,
  month: string,
  quarter: CalendarQuarter | '',
  weekStart: string,
  weekEnd: string,
): string {
  if (periodView === 'month' && month) return formatMonthLabel(month)
  if (periodView === 'quarter' && quarter && calendarYear) return `${quarter} ${calendarYear}`
  if (periodView === 'h1' && calendarYear) return `H1 ${calendarYear}`
  if (periodView === 'h2' && calendarYear) return `H2 ${calendarYear}`
  if (periodView === 'full_year' && calendarYear) {
    if (weekStart && weekEnd) return `FY ${calendarYear} · ${weekStart} – ${weekEnd}`
    return `FY ${calendarYear}`
  }
  if (weekStart && weekEnd) return `${weekStart} – ${weekEnd}`
  return 'all periods'
}

export function IdealFinancialProvider({ children }: { children: ReactNode }) {
  const { executiveModel, financialFileName } = useWorkbook()
  const { scenarios, getScenarioLedger, getScenarioForecast, getScenarioCapacityPlanOverrides } = usePlanner()
  const [scopeTick, setScopeTick] = useState(0)

  useEffect(() => {
    const onScopeChange = () => setScopeTick((value) => value + 1)
    window.addEventListener('capacity-scope-changed', onScopeChange)
    return () => window.removeEventListener('capacity-scope-changed', onScopeChange)
  }, [])

  const [weekStart, setWeekStart] = useState('')
  const [weekEnd, setWeekEnd] = useState('')
  const [dateRangeOpen, setDateRangeOpen] = useState(true)
  const [periodView, setPeriodView] = useState<PeriodView>('full_year')
  const [calendarYear, setCalendarYear] = useState(() => String(new Date().getFullYear()))
  const [month, setMonth] = useState('')
  const [quarter, setQuarter] = useState<'' | CalendarQuarter>('')
  const [client, setClientState] = useState('')
  const [industry, setIndustryState] = useState('')
  const [location, setLocationState] = useState('')
  const [channel, setChannelState] = useState<ChannelType | ''>('')
  const [showNextYear, setShowNextYear] = useState(false)
  const [lobId, setLobIdState] = useState('')
  const [trendGranularity, setTrendGranularity] = useState<TrendGranularity>('week')

  const financialClientOptions = useMemo(() => {
    const all = listFinancialClientNames(scenarios)
    if (!industry) return all
    return all.filter((name) => resolveClientIndustry(name).toLowerCase() === industry.toLowerCase())
  }, [industry, scenarios])

  const industryScopedScenarios = useMemo(() => {
    if (!industry) return scenarios
    const needle = industry.toLowerCase()
    return scenarios.filter((scenario) => {
      const label =
        resolveClientIndustry(scenario.plan.clientId) || resolveClientIndustry(scenario.plan.client)
      return label.toLowerCase() === needle
    })
  }, [industry, scenarios])

  useEffect(() => {
    if (client && financialClientOptions.includes(client)) return
    if (client && !financialClientOptions.includes(client)) {
      setClientState(financialClientOptions[0] ?? '')
      return
    }
    if (!industry && financialClientOptions.includes('Telco')) {
      setClientState('Telco')
      return
    }
    if (financialClientOptions[0]) setClientState(financialClientOptions[0])
    else setClientState('')
  }, [client, financialClientOptions, industry])

  const setIndustry = (next: string) => {
    setIndustryState(next)
  }

  const financialLocationOptions = useMemo(
    () => listFinancialLocationNames(industryScopedScenarios, client),
    [client, industryScopedScenarios],
  )
  const financialChannelOptions = useMemo(
    () => listFinancialChannelOptions(industryScopedScenarios, client, location),
    [client, industryScopedScenarios, location],
  )
  const financialLobOptions = useMemo(
    () => listFinancialLobOptions(industryScopedScenarios, client, location, channel),
    [channel, client, industryScopedScenarios, location],
  )
  const financialScopeId = useMemo(() => financialScopeIdFromFilters(client, lobId), [client, lobId])

  const setClient = (next: string) => {
    setClientState(next)
    setLocationState((current) => {
      if (!current) return ''
      return listFinancialLocationNames(industryScopedScenarios, next).includes(current) ? current : ''
    })
    setLobIdState((current) => {
      if (!current) return ''
      if (!next) return current
      return industryScopedScenarios.some((scenario) => scenario.id === current && scenario.plan.client === next)
        ? current
        : ''
    })
  }

  const setLocation = (next: string) => {
    setLocationState(next)
    setLobIdState((current) => {
      if (!current) return ''
      const stillValid = listFinancialLobOptions(industryScopedScenarios, client, next, channel).some(
        (item) => item.id === current,
      )
      return stillValid ? current : ''
    })
  }

  const setChannel = (next: ChannelType | '') => {
    setChannelState(next)
    setLobIdState((current) => {
      if (!current) return ''
      const stillValid = listFinancialLobOptions(industryScopedScenarios, client, location, next).some(
        (item) => item.id === current,
      )
      return stillValid ? current : ''
    })
  }

  const setLobId = (next: string) => {
    setLobIdState(next)
    if (!next) return
    const match = industryScopedScenarios.find((scenario) => scenario.id === next)
    if (match?.plan.client) setClientState(match.plan.client)
  }

  const capacityScope = useMemo(
    () =>
      resolveCapacityFinancialScope(industryScopedScenarios, {
        cardFilters: { clientName: client, location, lobId, channel },
      }),
    [channel, client, industryScopedScenarios, lobId, location, scopeTick],
  )
  const capacityScopeLabel = capacityScope?.displayLabel ?? 'No Capacity scope selected'

  const capacityRows = useMemo(() => {
    if (!capacityScope?.clientScenarios.length) return []
    const buildRows = (item: (typeof capacityScope.clientScenarios)[number]) =>
      deriveCapacityPlanRows(
        getScenarioLedger(item.id),
        item,
        getScenarioForecast(item.id, 52),
        getScenarioCapacityPlanOverrides(item.id),
      )
    if (capacityScope.isCombined) {
      return combineCapacityRows(capacityScope.clientScenarios.map((item) => buildRows(item)))
    }
    const scenario = capacityScope.linkedScenario
    return scenario ? buildRows(scenario) : []
  }, [capacityScope, getScenarioCapacityPlanOverrides, getScenarioForecast, getScenarioLedger])

  const capacityWeekOptions = useMemo(() => uniqCapacityWeeks(capacityRows), [capacityRows])
  const liveFacts = useMemo(() => factsFromExecutiveModel(executiveModel), [executiveModel])
  const liveAvailable = useMemo(() => hasIdealFinancialFactRows(executiveModel), [executiveModel])

  const dataMode: IdealDataMode = 'live'
  const projectionWow = useMemo(
    () => (liveAvailable ? buildProjectionWowFromCommitFacts(liveFacts) : []),
    [liveAvailable, liveFacts],
  )
  const sampleTable = useMemo(
    () => (liveAvailable ? buildCommitActualsTableRowsFromFacts(liveFacts) : []),
    [liveAvailable, liveFacts],
  )

  const allFacts = useMemo(() => liveFacts, [liveFacts])

  const weekOptions = useMemo(
    () => (capacityWeekOptions.length ? capacityWeekOptions : uniqIdealWeeks(allFacts)),
    [allFacts, capacityWeekOptions],
  )
  const defaultWeeks = useMemo(() => defaultWeekWindow(weekOptions, IDEAL_DEFAULT_WEEK_COUNT), [weekOptions])
  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear()
    const years = new Set<string>([
      String(current - 2),
      String(current - 1),
      String(current),
      String(current + 1),
      String(current + 2),
      calendarYear,
    ])
    for (const week of weekOptions) {
      if (week.length >= 4) years.add(week.slice(0, 4))
    }
    return [...years].sort()
  }, [calendarYear, weekOptions])

  const monthOptions = useMemo(
    () => (capacityWeekOptions.length ? capacityMonthOptions(capacityWeekOptions) : uniqIdealMonths(allFacts)),
    [allFacts, capacityWeekOptions],
  )
  const clientOptions = useMemo(() => uniqIdealClients(allFacts), [allFacts])

  useEffect(() => {
    if (periodView === 'month') setTrendGranularity('month')
    else if (periodView === 'quarter') setTrendGranularity('quarter')
    else setTrendGranularity('week')
  }, [periodView])

  useEffect(() => {
    if (periodView !== 'month' || !monthOptions.length) return
    const inYear = monthOptions.filter((item) => item.startsWith(calendarYear))
    const pool = inYear.length ? inYear : monthOptions
    if (!month || !pool.includes(month)) setMonth(pool[0] ?? '')
  }, [periodView, calendarYear, month, monthOptions])

  useEffect(() => {
    if (periodView !== 'quarter') return
    if (!quarter) {
      const current = Math.floor(new Date().getMonth() / 3) + 1
      setQuarter(`Q${current}` as CalendarQuarter)
    }
  }, [periodView, quarter])

  useEffect(() => {
    if (!weekOptions.length) return
    if (periodView === 'full_year') {
      const next = resolveFiscalYearWeekWindow(weekOptions, calendarYear, showNextYear)
      setWeekStart(next.weekStart)
      setWeekEnd(next.weekEnd)
      return
    }
    const next = resolveCapacityWeekWindow(weekOptions, periodView, calendarYear, month, quarter)
    setWeekStart(next.weekStart)
    setWeekEnd(next.weekEnd)
  }, [calendarYear, month, periodView, quarter, showNextYear, weekOptions])

  const dateRangeActive = Boolean(weekStart && weekEnd)
  const effectiveWeekStart = dateRangeActive ? weekStart : ''
  const effectiveWeekEnd = dateRangeActive ? weekEnd : ''

  const weekScopedRows = useMemo(() => {
    if (!dateRangeActive) return allFacts
    return filterRowsByWeekRange(allFacts, effectiveWeekStart, effectiveWeekEnd)
  }, [allFacts, dateRangeActive, effectiveWeekEnd, effectiveWeekStart])

  const filteredRows = useMemo(() => {
    let rows = filterCommitActualsRows(weekScopedRows, {
      periodView,
      calendarYear,
      monthPrefix: periodView === 'month' ? month : '',
      quarter: periodView === 'quarter' ? quarter : '',
      client,
    })
    if (industry) {
      const needle = industry.toLowerCase()
      rows = rows.filter((row) => resolveClientIndustry(row.client_name).toLowerCase() === needle)
    }
    if (location) {
      rows = rows.filter((row) => (row.location ?? '') === location)
    }
    if (lobId) {
      const match = industryScopedScenarios.find((scenario) => scenario.id === lobId)
      const projectCode = match?.plan.projectCode?.trim()
      const lobName = match?.plan.lob?.trim()
      if (projectCode || lobName) {
        rows = rows.filter((row) => {
          const code = (row.project_code ?? '').trim()
          if (projectCode && code === projectCode) return true
          if (lobName && code && code.toLowerCase() === lobName.toLowerCase()) return true
          return false
        })
      }
    }
    return rows
  }, [
    weekScopedRows,
    periodView,
    calendarYear,
    month,
    quarter,
    client,
    industry,
    location,
    lobId,
    industryScopedScenarios,
  ])

  const model = useMemo(
    () => buildIdealFinancialPanelModel({ rows: filteredRows, projectionWow, granularity: trendGranularity, latestWeekKpis: true }),
    [filteredRows, projectionWow, trendGranularity],
  )

  const sampleSheetName = liveAvailable && financialFileName ? financialFileName : 'No financial workbook uploaded'

  const label = dateRangeActive
    ? periodLabel(periodView, calendarYear, month, quarter, effectiveWeekStart, effectiveWeekEnd)
    : capacityScopeLabel

  const value: IdealFinancialContextValue = {
    dataMode,
    setDataMode: () => {
      /* Data source is live only — upload a financial workbook; no sample fallback. */
    },
    liveDataAvailable: liveAvailable,
    allFacts,
    filteredRows,
    projectionWow,
    sampleTable,
    monthOptions,
    clientOptions,
    weekOptions,
    weekStart: effectiveWeekStart || defaultWeeks.weekStart,
    weekEnd: effectiveWeekEnd || defaultWeeks.weekEnd,
    setWeekStart,
    setWeekEnd,
    dateRangeOpen,
    setDateRangeOpen,
    dateRangeActive,
    capacityWeekOptions,
    periodView,
    setPeriodView,
    calendarYear,
    setCalendarYear,
    month,
    setMonth,
    quarter,
    setQuarter,
    client,
    capacityScopeLabel,
    setClient,
    industry,
    setIndustry,
    location,
    setLocation,
    channel,
    setChannel,
    showNextYear,
    setShowNextYear,
    lobId,
    setLobId,
    financialScopeId,
    financialClientOptions,
    financialLocationOptions,
    financialChannelOptions,
    financialLobOptions,
    yearOptions,
    trendGranularity,
    setTrendGranularity,
    periodLabel: label,
    model,
    sampleSheetName,
  }

  return <IdealFinancialContext.Provider value={value}>{children}</IdealFinancialContext.Provider>
}

export function useIdealFinancial(): IdealFinancialContextValue {
  const ctx = useContext(IdealFinancialContext)
  if (!ctx) throw new Error('useIdealFinancial must be used within IdealFinancialProvider')
  return ctx
}

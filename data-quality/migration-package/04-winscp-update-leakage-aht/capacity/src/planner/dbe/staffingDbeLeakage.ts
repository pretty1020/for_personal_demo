import { deriveCapacityRowsForScenario } from '../capacityLookup'
import type { DerivedCapacityRow } from '../capacityPlanDerived'
import type { WeekCapacityPlanOverride } from '../capacityPlanOverridePersistence'
import type { ScenarioForecastPackage } from '../forecasting'
import { resolvePlanLocation } from '../planIdentity'
import type { PlannerScenario } from '../types'
import type { WeeklyLedgerRow } from '../weeklyLedger'
import {
  computeDbeMonth,
  formatFiscalMonthLabel,
  listFiscalMonthKeys,
  type DbeBillRateMethod,
  type DbeLobLine,
  type DbeMonthComputed,
} from './dbePersistence'
import { networkDaysInMonth } from './networkDays'

function norm(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase()
}

function weekMonthKey(weekIso: string): string {
  return weekIso.length >= 7 ? weekIso.slice(0, 7) : weekIso
}

function avg(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Does this week carry actuals to measure against plan?
 *
 * Deliberately keyed on statusLabel rather than on timeline === 'historical_actual'.
 * A plan built for the fiscal year holds every week in the forward_plan timeline, and
 * the weeks that have since passed are relabelled 'Actual' — that label is what the
 * Staffing Plan opens the Actual column on. Testing the timeline instead would skip
 * every one of those weeks and report no leakage at all for an ordinary plan.
 */
function hasWeekActuals(row: DerivedCapacityRow): boolean {
  return row.statusLabel === 'Actual'
}

/**
 * First value that is actually populated.
 *
 * Volume fields are plain numbers that default to 0 rather than to null, so `??` reads a
 * missing figure as a real zero and stops the chain there. That is what silently drove
 * AHT leakage to zero: a week with no actual volume produced 0 leaked hours no matter
 * how far the AHT ran over plan.
 */
function firstPositive(...values: (number | null | undefined)[]): number {
  for (const value of values) {
    if (value != null && Number.isFinite(value) && value > 0) return value
  }
  return 0
}

/** Map key: Client Name + Location + Project Code */
export function staffingDbeMapKey(client: string, location: string, projectCode: string): string {
  return `${norm(client)}|${norm(location)}|${norm(projectCode)}`
}

export function scenarioMapKey(scenario: PlannerScenario): string {
  return staffingDbeMapKey(
    scenario.plan.client,
    resolvePlanLocation(scenario.plan) || scenario.plan.location || '',
    scenario.plan.projectCode || '',
  )
}

export function dbeLineMapKey(line: DbeLobLine): string {
  return staffingDbeMapKey(line.clientName, line.location, line.projectCode)
}

/** DBE $/FTE for the month from the active bill rate method. */
export function dbeRevenuePerFte(computed: DbeMonthComputed, method: DbeBillRateMethod): number {
  if (method === 'hourly' && computed.hourlyBillRate > 0) {
    const hours = computed.productiveHours > 0 ? computed.productiveHours : computed.networkDays * computed.loginHours
    return computed.hourlyBillRate * Math.max(0, hours)
  }
  if (method === 'monthly' && computed.monthlyBillRate > 0) return computed.monthlyBillRate
  if (method === 'per_minute' && computed.perMinuteBillRate > 0) {
    const hours = computed.productiveHours > 0 ? computed.productiveHours : computed.networkDays * computed.loginHours
    return Math.max(0, hours) * 60 * computed.perMinuteBillRate
  }
  return 0
}

/**
 * DBE $ per productive hour, for drivers measured in lost hours rather than in FTE.
 *
 * An hourly line states the rate directly. Per-minute states it per minute. A monthly
 * line has no hourly rate at all, so it is spread over the hours the month is expected
 * to bill, which is the same hours basis `dbeRevenuePerFte` uses.
 */
export function dbeRevenuePerHour(computed: DbeMonthComputed, method: DbeBillRateMethod): number {
  if (method === 'hourly' && computed.hourlyBillRate > 0) return computed.hourlyBillRate
  if (method === 'per_minute' && computed.perMinuteBillRate > 0) return computed.perMinuteBillRate * 60
  const perFte = dbeRevenuePerFte(computed, method)
  const hours =
    computed.productiveHours > 0 ? computed.productiveHours : computed.networkDays * computed.loginHours
  if (perFte > 0 && hours > 0) return perFte / hours
  return 0
}

/** DBE $ per contact/call from rate method (for volume leakage). */
export function dbeRevenuePerContact(computed: DbeMonthComputed, method: DbeBillRateMethod): number {
  if (method === 'per_minute' && computed.perMinuteBillRate > 0 && computed.aht > 0) {
    return (computed.aht / 60) * computed.perMinuteBillRate
  }
  if (computed.capacity > 0 && computed.totalRevenue > 0) {
    return computed.totalRevenue / computed.capacity
  }
  // Hourly/monthly: approximate contact value from AHT share of productive hour
  const perFte = dbeRevenuePerFte(computed, method)
  if (perFte > 0 && computed.aht > 0 && computed.productiveHours > 0 && computed.loginHours > 0) {
    const contactsPerFte = (computed.productiveHours * 3600) / computed.aht
    if (contactsPerFte > 0) return perFte / contactsPerFte
  }
  return 0
}

function isAbsenteeismCategory(id: string, name?: string | null): boolean {
  const hay = `${id} ${name ?? ''}`.trim().toLowerCase()
  return hay.includes('absenteeism')
}

function isBreakCategory(id: string, name?: string | null): boolean {
  const hay = `${id} ${name ?? ''}`.trim().toLowerCase()
  return /\bbreak\b/.test(hay) || hay.includes('break%') || hay.includes('break_')
}

type ShrinkageOverrun = { absenteeism: number; inOffice: number }

/**
 * Split a week's shrinkage overrun into its Absenteeism and In-Office parts.
 *
 * Buckets follow the same definitions the DBE sheet uses, so a leakage figure lines up
 * with the Absenteeism % and Shrinkage % rows the client agreed to: Absenteeism is the
 * out-of-office absence categories, In-Office is the in-office categories with Break
 * excluded (paid, contractual, and never a leak).
 *
 * Per-category actuals are preferred. When a week has none, the total shrinkage overrun
 * is apportioned by the plan's own declared in-office share instead of being dropped,
 * which would silently understate leakage for plans that only track shrinkage in total.
 */
function splitShrinkageOverrun(
  row: DerivedCapacityRow,
  totalOverrun: number,
  inOfficeShare: number,
): ShrinkageOverrun {
  const measured = (row.shrinkageCategories ?? []).filter((item) => item.actualPct != null)

  if (measured.length) {
    let absenteeism = 0
    let inOffice = 0
    for (const item of measured) {
      const delta = (item.actualPct ?? 0) - item.plannedPct
      if (isAbsenteeismCategory(item.id, item.name)) absenteeism += delta
      else if (item.group === 'in_office' && !isBreakCategory(item.id, item.name)) inOffice += delta
    }
    return { absenteeism: Math.max(0, absenteeism), inOffice: Math.max(0, inOffice) }
  }

  const share = Math.min(1, Math.max(0, inOfficeShare))
  return { absenteeism: totalOverrun * (1 - share), inOffice: totalOverrun * share }
}

export type WeekGapAccum = {
  understaffFte: number[]
  overstaffFte: number[]
  attritionGapHc: number
  absenteeismFteImpact: number[]
  inOfficeShrinkFteImpact: number[]
  ahtLeakHours: number
  volumeGap: number
  productionFte: number[]
  requiredFte: number[]
  plannedVolume: number
  actualVolume: number
  plannedAhtSeconds: number[]
  actualAhtSeconds: number[]
}

function emptyAccum(): WeekGapAccum {
  return {
    understaffFte: [],
    overstaffFte: [],
    attritionGapHc: 0,
    absenteeismFteImpact: [],
    inOfficeShrinkFteImpact: [],
    ahtLeakHours: 0,
    volumeGap: 0,
    productionFte: [],
    requiredFte: [],
    plannedVolume: 0,
    actualVolume: 0,
    plannedAhtSeconds: [],
    actualAhtSeconds: [],
  }
}

export function accumulateWeekGaps(rows: DerivedCapacityRow[], inOfficeShare: number): WeekGapAccum {
  const accum = emptyAccum()
  for (const row of rows) {
    const actualWeek = hasWeekActuals(row)
    const productionFte = actualWeek
      ? row.actual.productionFte || row.planned.productionFte
      : row.planned.productionFte
    const requiredFte = actualWeek
      ? row.actual.requiredFte ?? row.planned.requiredFte ?? 0
      : row.planned.requiredFte ?? 0

    accum.productionFte.push(productionFte)
    accum.requiredFte.push(requiredFte)
    accum.understaffFte.push(Math.max(0, requiredFte - productionFte))
    accum.overstaffFte.push(Math.max(0, productionFte - requiredFte))

    const plannedAttrition = row.planned.attritionHc ?? 0
    const actualAttrition = actualWeek ? row.actual.attritionHc ?? plannedAttrition : plannedAttrition
    accum.attritionGapHc += Math.max(0, actualAttrition - plannedAttrition)

    const plannedShrink = row.planned.shrinkagePct ?? 0
    const actualShrink = actualWeek ? row.actual.shrinkagePct ?? plannedShrink : plannedShrink
    const shrinkOverrun = Math.max(0, actualShrink - plannedShrink)
    const split = actualWeek
      ? splitShrinkageOverrun(row, shrinkOverrun, inOfficeShare)
      : { absenteeism: 0, inOffice: 0 }
    accum.absenteeismFteImpact.push(split.absenteeism * productionFte)
    accum.inOfficeShrinkFteImpact.push(split.inOffice * productionFte)

    const plannedVol = firstPositive(row.planned.volume)
    // A week with no actual volume recorded is not a week that handled nothing, so it
    // falls back to plan and contributes no gap rather than booking the whole forecast
    // as missed volume.
    const measuredVol = actualWeek
      ? firstPositive(row.actual.handledVolume, row.actual.offeredVolume, row.actual.volume)
      : 0
    const actualVol = measuredVol > 0 ? measuredVol : plannedVol
    accum.plannedVolume += plannedVol
    accum.actualVolume += actualVol
    accum.volumeGap += Math.max(0, plannedVol - actualVol)

    // AHT leakage: (Actual AHT − Planned AHT) × Volume ÷ 3600 = hours lost to over-handling.
    // Charged against the volume actually handled, since that is the traffic that carried
    // the longer handle time. Only an overrun leaks; beating the planned AHT is not a gain
    // to net off here, matching how every other driver is floored at zero.
    const plannedAht = row.planned.ahtSeconds ?? 0
    const actualAht = actualWeek ? row.actual.ahtSeconds ?? plannedAht : plannedAht
    if (plannedAht > 0) {
      accum.plannedAhtSeconds.push(plannedAht)
      accum.actualAhtSeconds.push(actualAht)
    }
    const ahtOverrun = Math.max(0, actualAht - plannedAht)
    // Charged against the traffic that carried the longer handle time, falling back to
    // the planned volume when the week records an AHT but no volume of its own.
    const ahtVolume = actualWeek
      ? firstPositive(
          row.actual.handledVolume,
          row.actual.volume,
          row.actual.offeredVolume,
          plannedVol,
        )
      : plannedVol
    accum.ahtLeakHours += (ahtOverrun * ahtVolume) / 3600
  }
  return accum
}

export type LeakageDrivers = {
  understaff: number
  overstaff: number
  attrition: number
  /** Out-of-office absence overrun. Shown apart from in-office shrinkage. */
  absenteeism: number
  /** In-office shrinkage overrun, Break excluded. Shown apart from absenteeism. */
  inOfficeShrinkage: number
  /** Revenue value of hours lost to handling above the planned AHT. */
  aht: number
  volume: number
  total: number
}

export type LeakageDriverId = Exclude<keyof LeakageDrivers, 'total'>

/**
 * The drivers, in display order, with the labels and colours every surface shares.
 * Charts, KPI cards, the pair table and both downloads read this list rather than
 * repeating it, so a driver cannot appear in one place and go missing in another.
 */
export const LEAKAGE_DRIVERS: readonly {
  id: LeakageDriverId
  /** Full label, for legends and column headers. */
  label: string
  /** Short label, for tight table headers and KPI cards. */
  short: string
  color: string
}[] = [
  { id: 'understaff', label: 'Understaff', short: 'Understaff', color: '#be185d' },
  { id: 'overstaff', label: 'Overstaff', short: 'Overstaff', color: '#d97706' },
  { id: 'attrition', label: 'Attrition (Actual vs Planned)', short: 'Attrition', color: '#0369a1' },
  { id: 'absenteeism', label: 'Absenteeism (Actual vs Planned)', short: 'Absenteeism', color: '#0f766e' },
  {
    id: 'inOfficeShrinkage',
    label: 'In-office shrinkage (Actual vs Planned)',
    short: 'In-office shrinkage',
    color: '#7c3aed',
  },
  { id: 'aht', label: 'AHT (Actual vs Planned)', short: 'AHT', color: '#c2410c' },
  { id: 'volume', label: 'Call volume (Actual vs Forecast)', short: 'Call volume', color: '#0891b2' },
] as const

export type LeakageMonthRow = {
  month: string
  monthLabel: string
  networkDays: number
  staffingProductionFte: number
  staffingRequiredFte: number
  staffingVolumePlanned: number
  staffingVolumeActual: number
  dbeFte: number
  dbeRevenue: number
  dbeRatePerFte: number
  dbeRatePerContact: number
  dbeRatePerHour: number
  understaffFte: number
  overstaffFte: number
  attritionGapHc: number
  absenteeismFteImpact: number
  inOfficeShrinkFteImpact: number
  /** Hours lost to AHT overrun, before they are valued at the hourly rate. */
  ahtLeakHours: number
  plannedAhtSeconds: number
  actualAhtSeconds: number
  volumeGap: number
  drivers: LeakageDrivers
}

export type MatchedLeakagePair = {
  key: string
  clientName: string
  location: string
  projectCode: string
  lobName: string
  scenarioId: string | null
  dbeLineId: string | null
  billingType: string
  billRateMethod: DbeBillRateMethod | null
  months: LeakageMonthRow[]
}

export type LeakagePortfolioSummary = {
  pairs: MatchedLeakagePair[]
  unmatchedStaffing: number
  unmatchedDbe: number
  totals: {
    dbeRevenue: number
    understaff: number
    overstaff: number
    attrition: number
    absenteeism: number
    inOfficeShrinkage: number
    aht: number
    ahtLeakHours: number
    volume: number
    totalLeakage: number
  }
  byMonth: Array<{
    month: string
    monthLabel: string
    dbeRevenue: number
    staffingFte: number
    requiredFte: number
    understaff: number
    overstaff: number
    attrition: number
    absenteeism: number
    inOfficeShrinkage: number
    aht: number
    ahtLeakHours: number
    volume: number
    totalLeakage: number
  }>
  drivers: LeakageDrivers
}

export type LeakageScenarioDeps = {
  getScenarioLedger: (scenarioId: string) => WeeklyLedgerRow[]
  getScenarioForecast: (scenarioId: string, horizonWeeks?: number) => ScenarioForecastPackage | null
  getScenarioCapacityPlanOverrides: (scenarioId: string) => Record<string, WeekCapacityPlanOverride>
}

export function monetizeMonth(
  accum: WeekGapAccum,
  computed: DbeMonthComputed | null,
  method: DbeBillRateMethod | null,
): LeakageMonthRow {
  const perFte = computed && method ? dbeRevenuePerFte(computed, method) : 0
  const perContact = computed && method ? dbeRevenuePerContact(computed, method) : 0
  const perHour = computed && method ? dbeRevenuePerHour(computed, method) : 0
  const understaffFte = Math.round(avg(accum.understaffFte) * 1000) / 1000
  const overstaffFte = Math.round(avg(accum.overstaffFte) * 1000) / 1000
  const absenteeismFteImpact = Math.round(avg(accum.absenteeismFteImpact) * 1000) / 1000
  const inOfficeShrinkFteImpact = Math.round(avg(accum.inOfficeShrinkFteImpact) * 1000) / 1000
  const ahtLeakHours = Math.round(accum.ahtLeakHours * 100) / 100
  const understaff = Math.round(understaffFte * perFte)
  const overstaff = Math.round(overstaffFte * perFte)
  const attrition = Math.round(accum.attritionGapHc * perFte)
  const absenteeism = Math.round(absenteeismFteImpact * perFte)
  const inOfficeShrinkage = Math.round(inOfficeShrinkFteImpact * perFte)
  const aht = Math.round(ahtLeakHours * perHour)
  const volume = Math.round(accum.volumeGap * perContact)
  const drivers: LeakageDrivers = {
    understaff,
    overstaff,
    attrition,
    absenteeism,
    inOfficeShrinkage,
    aht,
    volume,
    total: understaff + overstaff + attrition + absenteeism + inOfficeShrinkage + aht + volume,
  }

  return {
    month: computed?.month ?? '',
    monthLabel: computed ? formatFiscalMonthLabel(computed.month) : '',
    networkDays: computed?.networkDays ?? 0,
    staffingProductionFte: Math.round(avg(accum.productionFte) * 1000) / 1000,
    staffingRequiredFte: Math.round(avg(accum.requiredFte) * 1000) / 1000,
    staffingVolumePlanned: Math.round(accum.plannedVolume),
    staffingVolumeActual: Math.round(accum.actualVolume),
    dbeFte: computed?.fte ?? computed?.requiredFte ?? 0,
    dbeRevenue: computed?.totalRevenue ?? 0,
    dbeRatePerFte: Math.round(perFte * 100) / 100,
    dbeRatePerContact: Math.round(perContact * 10000) / 10000,
    dbeRatePerHour: Math.round(perHour * 100) / 100,
    understaffFte,
    overstaffFte,
    attritionGapHc: Math.round(accum.attritionGapHc * 1000) / 1000,
    absenteeismFteImpact,
    inOfficeShrinkFteImpact,
    ahtLeakHours,
    plannedAhtSeconds: Math.round(avg(accum.plannedAhtSeconds) * 10) / 10,
    actualAhtSeconds: Math.round(avg(accum.actualAhtSeconds) * 10) / 10,
    volumeGap: Math.round(accum.volumeGap),
    drivers,
  }
}

/**
 * Leakage from Staffing Plan gaps, valued with DBE rates.
 * Mapping: Client Name + Location + Project Code.
 */
export function buildStaffingDbeLeakage(
  scenarios: PlannerScenario[],
  dbeLines: DbeLobLine[],
  deps: LeakageScenarioDeps,
  fiscalStartYear: number,
  filters?: { client?: string; location?: string; projectCode?: string },
): LeakagePortfolioSummary {
  const months = listFiscalMonthKeys(fiscalStartYear)
  const clientFilter = filters?.client ? norm(filters.client) : ''
  const locationFilter = filters?.location ? norm(filters.location) : ''
  const projectFilter = filters?.projectCode ? norm(filters.projectCode) : ''

  const visibleScenarios = scenarios.filter((scenario) => {
    if (scenario.isBaseline) return false
    if (clientFilter && norm(scenario.plan.client) !== clientFilter) return false
    const loc = norm(resolvePlanLocation(scenario.plan) || scenario.plan.location || '')
    if (locationFilter && loc !== locationFilter) return false
    if (projectFilter && norm(scenario.plan.projectCode || '') !== projectFilter) return false
    return true
  })

  const filteredDbe = dbeLines.filter((line) => {
    if (clientFilter && norm(line.clientName) !== clientFilter) return false
    if (locationFilter && norm(line.location) !== locationFilter) return false
    if (projectFilter && norm(line.projectCode) !== projectFilter) return false
    return true
  })

  const dbeByKey = new Map<string, DbeLobLine[]>()
  for (const line of filteredDbe) {
    const key = dbeLineMapKey(line)
    dbeByKey.set(key, [...(dbeByKey.get(key) ?? []), line])
  }

  const usedDbeIds = new Set<string>()
  const pairs: MatchedLeakagePair[] = []

  for (const scenario of visibleScenarios) {
    const key = scenarioMapKey(scenario)
    const matchedLines = dbeByKey.get(key) ?? []
    const primaryLine = matchedLines[0] ?? null
    for (const line of matchedLines) usedDbeIds.add(line.id)

    const rows = deriveCapacityRowsForScenario(
      deps.getScenarioLedger(scenario.id),
      scenario,
      deps.getScenarioForecast(scenario.id, 52),
      deps.getScenarioCapacityPlanOverrides(scenario.id),
    )

    const monthRows = months.map((month) => {
      const weekRows = rows.filter((row) => weekMonthKey(row.week) === month)
      const accum = accumulateWeekGaps(weekRows, scenario.assumptions.tenured.shrinkageInOfficeShare)
      // Combine DBE rates when multiple lines share the same map key
      let computed: DbeMonthComputed | null = null
      let method: DbeBillRateMethod | null = null
      if (matchedLines.length) {
        const parts = matchedLines.map((line) => computeDbeMonth(line, month))
        const first = parts[0]!
        computed = {
          ...first,
          fte: parts.reduce((sum, p) => sum + p.fte, 0),
          requiredFte: parts.reduce((sum, p) => sum + p.requiredFte, 0),
          capacity: parts.reduce((sum, p) => sum + p.capacity, 0),
          totalRevenue: parts.reduce((sum, p) => sum + p.totalRevenue, 0),
          productiveHours: avg(parts.map((p) => p.productiveHours)),
          hourlyBillRate: avg(parts.map((p) => p.hourlyBillRate)),
          monthlyBillRate: avg(parts.map((p) => p.monthlyBillRate)),
          perMinuteBillRate: avg(parts.map((p) => p.perMinuteBillRate)),
        }
        method = primaryLine!.billRateMethod
      }
      const row = monetizeMonth(accum, computed ?? { ...computeDbeMonthEmpty(month) }, method)
      if (!computed) {
        row.dbeRevenue = 0
        row.dbeFte = 0
        row.dbeRatePerFte = 0
        row.dbeRatePerContact = 0
        row.dbeRatePerHour = 0
        // Without DBE rates, keep FTE/HC/hour gaps visible but $ = 0
        row.drivers = {
          understaff: 0,
          overstaff: 0,
          attrition: 0,
          absenteeism: 0,
          inOfficeShrinkage: 0,
          aht: 0,
          volume: 0,
          total: 0,
        }
      }
      row.month = month
      row.monthLabel = formatFiscalMonthLabel(month)
      row.networkDays = networkDaysInMonth(month)
      return row
    })

    pairs.push({
      key: `staff-${scenario.id}`,
      clientName: scenario.plan.client,
      location: resolvePlanLocation(scenario.plan) || scenario.plan.location || '',
      projectCode: scenario.plan.projectCode || '',
      lobName: scenario.plan.lob || scenario.plan.location || '',
      scenarioId: scenario.id,
      dbeLineId: primaryLine?.id ?? null,
      billingType: primaryLine?.billingType ?? scenario.plan.billingType,
      billRateMethod: primaryLine?.billRateMethod ?? null,
      months: monthRows,
    })
  }

  // DBE-only keys (no staffing match)
  for (const line of filteredDbe) {
    if (usedDbeIds.has(line.id)) continue
    usedDbeIds.add(line.id)
    const monthRows = months.map((month) => {
      const computed = computeDbeMonth(line, month)
      const row = monetizeMonth(emptyAccum(), computed, line.billRateMethod)
      row.month = month
      row.monthLabel = formatFiscalMonthLabel(month)
      return row
    })
    pairs.push({
      key: `dbe-${line.id}`,
      clientName: line.clientName,
      location: line.location,
      projectCode: line.projectCode,
      lobName: line.lobProjectName,
      scenarioId: null,
      dbeLineId: line.id,
      billingType: line.billingType,
      billRateMethod: line.billRateMethod,
      months: monthRows,
    })
  }

  const byMonth = months.map((month) => {
    const rows = pairs.map((pair) => pair.months.find((m) => m.month === month)!).filter(Boolean)
    const understaff = rows.reduce((sum, row) => sum + row.drivers.understaff, 0)
    const overstaff = rows.reduce((sum, row) => sum + row.drivers.overstaff, 0)
    const attrition = rows.reduce((sum, row) => sum + row.drivers.attrition, 0)
    const absenteeism = rows.reduce((sum, row) => sum + row.drivers.absenteeism, 0)
    const inOfficeShrinkage = rows.reduce((sum, row) => sum + row.drivers.inOfficeShrinkage, 0)
    const aht = rows.reduce((sum, row) => sum + row.drivers.aht, 0)
    const volume = rows.reduce((sum, row) => sum + row.drivers.volume, 0)
    return {
      month,
      monthLabel: formatFiscalMonthLabel(month),
      dbeRevenue: rows.reduce((sum, row) => sum + row.dbeRevenue, 0),
      staffingFte: Math.round(rows.reduce((sum, row) => sum + row.staffingProductionFte, 0) * 1000) / 1000,
      requiredFte: Math.round(rows.reduce((sum, row) => sum + row.staffingRequiredFte, 0) * 1000) / 1000,
      understaff,
      overstaff,
      attrition,
      absenteeism,
      inOfficeShrinkage,
      aht,
      ahtLeakHours: Math.round(rows.reduce((sum, row) => sum + row.ahtLeakHours, 0) * 100) / 100,
      volume,
      totalLeakage: understaff + overstaff + attrition + absenteeism + inOfficeShrinkage + aht + volume,
    }
  })

  const totals = {
    dbeRevenue: byMonth.reduce((sum, row) => sum + row.dbeRevenue, 0),
    understaff: byMonth.reduce((sum, row) => sum + row.understaff, 0),
    overstaff: byMonth.reduce((sum, row) => sum + row.overstaff, 0),
    attrition: byMonth.reduce((sum, row) => sum + row.attrition, 0),
    absenteeism: byMonth.reduce((sum, row) => sum + row.absenteeism, 0),
    inOfficeShrinkage: byMonth.reduce((sum, row) => sum + row.inOfficeShrinkage, 0),
    aht: byMonth.reduce((sum, row) => sum + row.aht, 0),
    ahtLeakHours: Math.round(byMonth.reduce((sum, row) => sum + row.ahtLeakHours, 0) * 100) / 100,
    volume: byMonth.reduce((sum, row) => sum + row.volume, 0),
    totalLeakage: 0,
  }
  totals.totalLeakage =
    totals.understaff +
    totals.overstaff +
    totals.attrition +
    totals.absenteeism +
    totals.inOfficeShrinkage +
    totals.aht +
    totals.volume

  return {
    pairs,
    unmatchedStaffing: pairs.filter((p) => p.scenarioId && !p.dbeLineId).length,
    unmatchedDbe: pairs.filter((p) => p.dbeLineId && !p.scenarioId).length,
    totals,
    byMonth,
    drivers: {
      understaff: totals.understaff,
      overstaff: totals.overstaff,
      attrition: totals.attrition,
      absenteeism: totals.absenteeism,
      inOfficeShrinkage: totals.inOfficeShrinkage,
      aht: totals.aht,
      volume: totals.volume,
      total: totals.totalLeakage,
    },
  }
}

function computeDbeMonthEmpty(month: string): DbeMonthComputed {
  return {
    month,
    networkDays: networkDaysInMonth(month),
    capacity: 0,
    fte: 0,
    aht: 0,
    loginHours: 0,
    absenteeismPct: 0,
    shrinkagePct: 0,
    occupancyPct: 0,
    hourlyBillRate: 0,
    monthlyBillRate: 0,
    perMinuteBillRate: 0,
    discountOrLessToRevenue: 0,
    extraHours: 0,
    billRateMethod: 'hourly',
    fteBilling: false,
    productiveHours: 0,
    productiveHoursPostOcc: 0,
    requiredFte: 0,
    subtotalRevenue: 0,
    revenueAdjustmentsApplied: {},
    totalRevenue: 0,
    totalCost: 0,
    costByItem: {},
    costBreakdownByItem: {},
    gm: 0,
    gmPct: 0,
  }
}

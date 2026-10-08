import {
  computeDbeMonth,
  formatFiscalMonthLabel,
  type DbeLobLine,
} from './dbePersistence'
import {
  resolveStaffingMonthDrivers,
  type StaffingDriverLookup,
} from './staffingMonthDrivers'

export type DbeRevenueComparisonRow = {
  key: string
  label: string
  clientName?: string
  lobProjectName?: string
  location?: string
  projectCode?: string
  manualAbsenteeismPct: number | null
  manualShrinkagePct: number | null
  /** Total Revenue using DBE Data Absenteeism & Shrinkage inputs */
  manualRevenue: number
  plannedAbsenteeismPct: number | null
  plannedShrinkagePct: number | null
  /** Total Revenue using Capacity Plan Planned Absenteeism & Shrinkage */
  plannedRevenue: number | null
  /** planned − manual */
  variance: number | null
  /** (planned − manual) / |manual| */
  variancePct: number | null
  plannedAvailable: boolean
  /** FTE from the DBE sheet: entered FTE when FTE-billing, else required FTE. */
  manualFte: number | null
  /** Production HC from the matched Staffing Plan. */
  plannedProductionHc: number | null
  /** plannedProductionHc − manualFte */
  fteVariance: number | null
  fteVariancePct: number | null
  /**
   * Independent of plannedAvailable: a plan can staff a month without defining
   * planned shrinkage categories, and the FTE comparison is still meaningful then.
   */
  fteComparable: boolean
  matchedScenarioName: string | null
}

function avgOrNull(values: number[]): number | null {
  if (!values.length) return null
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
}

function sumOrNull(values: number[]): number | null {
  if (!values.length) return null
  return Math.round(values.reduce((sum, value) => sum + value, 0) * 100) / 100
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * The FTE a DBE line represents. Mirrors the `fteBasis` rule used for per-FTE cost
 * items: FTE-billing lines carry an entered FTE, capacity-billing lines derive it
 * from volume and AHT.
 */
function dbeLineFte(computed: { fteBilling: boolean; fte: number; requiredFte: number }): number {
  return computed.fteBilling ? computed.fte : computed.requiredFte
}

function variancePctOf(manual: number, variance: number | null): number | null {
  if (variance == null) return null
  if (manual === 0) return variance === 0 ? 0 : null
  return Math.round((variance / manual) * 10000) / 10000
}

/**
 * Detail rows: one per DBE LOB × month.
 * Manual revenue always uses DBE sheet Absenteeism/Shrinkage.
 * Planned revenue forces Capacity Staffing Plan Planned Absenteeism / in-office Shrinkage when available.
 */
export function buildDbeRevenueComparisonRows(
  lines: DbeLobLine[],
  months: string[],
  lookup: StaffingDriverLookup,
): DbeRevenueComparisonRow[] {
  const rows: DbeRevenueComparisonRow[] = []

  for (const line of lines) {
    for (const month of months) {
      const manual = computeDbeMonth(line, month)
      const drivers = resolveStaffingMonthDrivers(line, month, lookup)
      const plannedAvailable = drivers.hasData
      const planned = plannedAvailable
        ? computeDbeMonth(line, month, {
            absenteeismPct: drivers.absenteeismPct,
            shrinkagePct: drivers.shrinkagePct,
          })
        : null

      const manualRevenue = manual.totalRevenue
      const plannedRevenue = planned?.totalRevenue ?? null
      const variance = plannedRevenue != null ? Math.round(plannedRevenue - manualRevenue) : null

      const manualFte = round2(dbeLineFte(manual))
      const plannedProductionHc = drivers.productionHc
      const fteComparable = plannedProductionHc != null
      const fteVariance = fteComparable ? round2(plannedProductionHc - manualFte) : null

      rows.push({
        key: `${line.id}:${month}`,
        label: formatFiscalMonthLabel(month),
        clientName: line.clientName,
        lobProjectName: line.lobProjectName,
        location: line.location,
        projectCode: line.projectCode,
        manualAbsenteeismPct: manual.absenteeismPct,
        manualShrinkagePct: manual.shrinkagePct,
        manualRevenue,
        plannedAbsenteeismPct: plannedAvailable ? drivers.absenteeismPct : null,
        plannedShrinkagePct: plannedAvailable ? drivers.shrinkagePct : null,
        plannedRevenue,
        variance,
        variancePct: variancePctOf(manualRevenue, variance),
        plannedAvailable,
        manualFte,
        plannedProductionHc,
        fteVariance,
        fteVariancePct: variancePctOf(manualFte, fteVariance),
        fteComparable,
        matchedScenarioName: drivers.matchedScenarioName,
      })
    }
  }

  return rows
}

/** One row per month — sums revenues; averages Abs%/Shrink% across LOBs. */
export function rollupDbeRevenueComparisonByMonth(
  detailRows: DbeRevenueComparisonRow[],
): DbeRevenueComparisonRow[] {
  const byMonth = new Map<string, DbeRevenueComparisonRow[]>()
  for (const row of detailRows) {
    const monthKey = row.key.includes(':') ? row.key.slice(row.key.indexOf(':') + 1) : row.key
    const list = byMonth.get(monthKey) ?? []
    list.push(row)
    byMonth.set(monthKey, list)
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, group]) => {
      const manualRevenue = group.reduce((sum, row) => sum + row.manualRevenue, 0)
      const withPlan = group.filter((row) => row.plannedAvailable && row.plannedRevenue != null)
      const plannedAvailable = withPlan.length > 0
      // Apples-to-apples: planned total and variance only over LOBs that have Capacity drivers.
      // Manual column still shows full period manual revenue for context.
      const plannedRevenue = plannedAvailable
        ? withPlan.reduce((sum, row) => sum + (row.plannedRevenue ?? 0), 0)
        : null
      const manualForVariance = plannedAvailable
        ? withPlan.reduce((sum, row) => sum + row.manualRevenue, 0)
        : manualRevenue
      const variance =
        plannedRevenue != null ? Math.round(plannedRevenue - manualForVariance) : null

      // Headcount is additive across LOBs within a month (unlike the Abs/Shrink
      // percentages above, which are averaged). Compare only over LOBs that have a
      // matched plan, so an unmatched LOB cannot look like a staffing shortfall.
      const withHc = group.filter((row) => row.fteComparable)
      const fteComparable = withHc.length > 0
      const manualFte = sumOrNull(
        group.map((row) => row.manualFte).filter((value): value is number => value != null),
      )
      const manualFteForVariance = sumOrNull(
        withHc.map((row) => row.manualFte).filter((value): value is number => value != null),
      )
      const plannedProductionHc = sumOrNull(
        withHc
          .map((row) => row.plannedProductionHc)
          .filter((value): value is number => value != null),
      )
      const fteVariance =
        plannedProductionHc != null && manualFteForVariance != null
          ? round2(plannedProductionHc - manualFteForVariance)
          : null

      return {
        key: monthKey,
        label: group[0]?.label ?? formatFiscalMonthLabel(monthKey),
        manualAbsenteeismPct: avgOrNull(
          group
            .map((row) => row.manualAbsenteeismPct)
            .filter((value): value is number => value != null),
        ),
        manualShrinkagePct: avgOrNull(
          group
            .map((row) => row.manualShrinkagePct)
            .filter((value): value is number => value != null),
        ),
        manualRevenue,
        plannedAbsenteeismPct: avgOrNull(
          withPlan
            .map((row) => row.plannedAbsenteeismPct)
            .filter((value): value is number => value != null),
        ),
        plannedShrinkagePct: avgOrNull(
          withPlan
            .map((row) => row.plannedShrinkagePct)
            .filter((value): value is number => value != null),
        ),
        plannedRevenue,
        variance,
        variancePct: variancePctOf(manualForVariance, variance),
        plannedAvailable,
        manualFte,
        plannedProductionHc,
        fteVariance,
        fteVariancePct:
          manualFteForVariance != null ? variancePctOf(manualFteForVariance, fteVariance) : null,
        fteComparable,
        matchedScenarioName:
          withPlan.find((row) => row.matchedScenarioName)?.matchedScenarioName ??
          withHc.find((row) => row.matchedScenarioName)?.matchedScenarioName ??
          null,
      }
    })
}

function monthKeyOf(row: DbeRevenueComparisonRow): string {
  return row.key.includes(':') ? row.key.slice(row.key.indexOf(':') + 1) : row.key
}

/**
 * Average monthly headcount over the period. Revenue accumulates across months, but
 * FTE and Production HC are levels, so summing them over months would scale with the
 * length of the period instead of describing the staffing level.
 */
function averageMonthlyHeadcount(
  rows: DbeRevenueComparisonRow[],
  pick: (row: DbeRevenueComparisonRow) => number | null,
): number | null {
  const byMonth = new Map<string, number>()
  for (const row of rows) {
    const value = pick(row)
    if (value == null) continue
    const key = monthKeyOf(row)
    byMonth.set(key, (byMonth.get(key) ?? 0) + value)
  }
  if (!byMonth.size) return null
  return round2([...byMonth.values()].reduce((sum, value) => sum + value, 0) / byMonth.size)
}

export function summarizeDbeRevenueComparison(rows: DbeRevenueComparisonRow[]): {
  manualRevenue: number
  plannedRevenue: number | null
  variance: number | null
  variancePct: number | null
  plannedAvailable: boolean
  comparedManualRevenue: number
  /** Average monthly DBE FTE across the period (all rows). */
  manualFte: number | null
  /** Average monthly Staffing Plan Production HC, over matched LOBs only. */
  plannedProductionHc: number | null
  fteVariance: number | null
  fteVariancePct: number | null
  fteComparable: boolean
} {
  const manualRevenue = rows.reduce((sum, row) => sum + row.manualRevenue, 0)

  const withHc = rows.filter((row) => row.fteComparable)
  const manualFte = averageMonthlyHeadcount(rows, (row) => row.manualFte)
  const comparedManualFte = averageMonthlyHeadcount(withHc, (row) => row.manualFte)
  const plannedProductionHc = averageMonthlyHeadcount(withHc, (row) => row.plannedProductionHc)
  const fteVariance =
    plannedProductionHc != null && comparedManualFte != null
      ? round2(plannedProductionHc - comparedManualFte)
      : null
  const fteBlock = {
    manualFte,
    plannedProductionHc,
    fteVariance,
    fteVariancePct:
      comparedManualFte != null ? variancePctOf(comparedManualFte, fteVariance) : null,
    fteComparable: withHc.length > 0,
  }

  const withPlan = rows.filter((row) => row.plannedAvailable && row.plannedRevenue != null)
  if (!withPlan.length) {
    return {
      manualRevenue,
      plannedRevenue: null,
      variance: null,
      variancePct: null,
      plannedAvailable: false,
      comparedManualRevenue: 0,
      ...fteBlock,
    }
  }
  const plannedRevenue = withPlan.reduce((sum, row) => sum + (row.plannedRevenue ?? 0), 0)
  const comparedManualRevenue = withPlan.reduce((sum, row) => sum + row.manualRevenue, 0)
  const variance = Math.round(plannedRevenue - comparedManualRevenue)
  return {
    manualRevenue,
    plannedRevenue,
    variance,
    variancePct: variancePctOf(comparedManualRevenue, variance),
    plannedAvailable: true,
    comparedManualRevenue,
    ...fteBlock,
  }
}

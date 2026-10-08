import type { ScenarioForecastPackage } from './forecasting'
import type { ForecastMetricId } from './forecastPersistence'
import { buildCohortStageMaps } from './trainingPipelineHc'
import { fmtNum, fmtPct } from './format'
import {
  fmtVarianceDelta,
  fmtVarianceDeltaPct,
  fmtVarianceDeltaSeconds,
  offeredToForecastTone,
  staffingPctTone,
  varianceToneHigherBetter,
  varianceToneLowerBetter,
} from './varianceDisplay'
import type { PlannerAssumptions } from './types'
import type { LedgerMetricSnapshot, WeeklyLedgerRow } from './weeklyLedger'
import {
  actualProductionHcForDisplay,
  actualSupportHcForDisplay,
  type CapacityForecastMode,
  type CapacityMetricSnapshot,
  type DerivedCapacityRow,
} from './capacityPlanDerived'
import { applyWeeklyMutualFteBlank } from './capacityLookup'
import type { WeekCapacityPlanOverride } from './capacityPlanOverridePersistence'
import { DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS, resolveActiveShrinkageCategoryIds } from './shrinkageCategories'
import { getPlannedProductionHcFormulaText } from './formulaOverrides'
import { sliceCapacityWindow } from './capacityMatrixTheme'

export type CapacityView = 'weekly' | 'monthly' | 'quarterly'
export type CapacityGroupId = 'headcount' | 'staffing' | 'pipeline' | 'attrition' | 'volume' | 'shrinkage' | 'aht' | 'occupancy'

export type CapacityMatrixRowDef = {
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
  step?: number
  isPercentInput?: boolean
  formula?: string
  tone?: (value: number | null | undefined) => string
}

type CapacityDriverModeId = ForecastMetricId | 'occupancy'

const DEFAULT_CAPACITY_FORECAST_MODES: Partial<Record<CapacityDriverModeId, CapacityForecastMode>> = {
  callVolume: 'manual',
  ahtSeconds: 'manual',
  occupancy: 'manual',
  totalShrinkagePct: 'manual',
  attritionHc: 'forecast',
}

export { DEFAULT_CAPACITY_FORECAST_MODES }

export const CAPACITY_GROUP_LABELS: Record<CapacityGroupId, string> = {
  headcount: 'Headcount',
  staffing: 'Staffing',
  pipeline: 'Training pipeline',
  attrition: 'Attrition',
  volume: 'Volume',
  shrinkage: 'Shrinkage',
  aht: 'AHT',
  occupancy: 'Occupancy',
}

export const CAPACITY_MATRIX_GROUP_ORDER: CapacityGroupId[] = [
  'staffing',
  'headcount',
  'pipeline',
  'attrition',
  'volume',
  'shrinkage',
  'aht',
  'occupancy',
]

function safeRatio(numerator: number | null | undefined, denominator: number | null | undefined): number | null {
  if (numerator == null || denominator == null || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null
  }
  return numerator / denominator
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
  const denominator = beginning > 0 ? beginning : ending > 0 ? ending + attritionHc : 0
  if (denominator <= 0) return attritionHc === 0 ? 0 : null
  return attritionHc / denominator
}

function plannedProductionHcAttrition(row: DerivedCapacityRow): number | null {
  if (row.planned.attritionPct == null) return null
  return Math.round(row.planned.attritionPct * row.planned.productionHc)
}

export function buildActualStageAttritionLookup(rows: DerivedCapacityRow[]) {
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

export function buildStageWeekMaps(rows: DerivedCapacityRow[], trainingWeeks: number, nestingWeeks: number, assumptions: PlannerAssumptions | null) {
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

export function buildShrinkageLookup(
  rows: WeeklyLedgerRow[],
  _forecast: ScenarioForecastPackage | null,
  _forecastModes: Partial<Record<CapacityDriverModeId, CapacityForecastMode>>,
  visibleCategoryIds: readonly string[] = DEFAULT_VISIBLE_SHRINKAGE_CATEGORY_IDS,
  plannedOverrides: Record<string, WeekCapacityPlanOverride> = {},
) {
  const labels = Object.fromEntries(
    rows.flatMap((row) => row.shrinkage.map((item) => [item.id, item.name] as const)),
  ) as Record<string, string>
  const overrideCategoryIds = [
    ...new Set(
      Object.values(plannedOverrides).flatMap((weekOverride) => Object.keys(weekOverride.shrinkageById ?? {})),
    ),
  ]
  const activeCategoryIds = resolveActiveShrinkageCategoryIds(
    visibleCategoryIds,
    rows.flatMap((row) => row.shrinkage.map((item) => item.id)),
    overrideCategoryIds,
  )
  const rowsByWeek = new Map<string, {
    totalPlanned: number
    totalActual: number | null
    outOfOfficePlanned: number
    outOfOfficeActual: number
    inOfficePlanned: number
    inOfficeActual: number
    categories: Record<string, { planned: number; actual: number | null; name: string }>
  }>()
  let previousResolvedCategories: Record<string, number> = {}
  rows.forEach((row) => {
    const weekOverrides = plannedOverrides[row.week]?.shrinkageById ?? {}
    const categoryIds = [
      ...new Set([...row.shrinkage.map((item) => item.id), ...Object.keys(weekOverrides)]),
    ]
    const resolvedCategories = Object.fromEntries(
      categoryIds.map((categoryId) => {
        const item = row.shrinkage.find((entry) => entry.id === categoryId)
        const manualValue = weekOverrides[categoryId]
        const planned =
          manualValue != null && Number.isFinite(manualValue)
            ? manualValue
            : row.timeline === 'forward_plan' && previousResolvedCategories[categoryId] != null
              ? previousResolvedCategories[categoryId]!
              : 0
        return [
          categoryId,
          {
            planned,
            actual: item?.actualPct ?? null,
            name: item?.name ?? labels[categoryId] ?? categoryId,
            group: item?.group ?? 'out_of_office',
          },
        ] as const
      }),
    )
    const categoryRecords = Object.entries(resolvedCategories).map(([categoryId, item]) => ({
      id: categoryId,
      planned: item.planned,
      actual: item.actual,
      name: item.name,
      group: item.group,
    }))
    const visibleOutOfOfficePlanned = categoryRecords
      .filter((item) => item.group === 'out_of_office' && activeCategoryIds.includes(item.id))
      .reduce((sum, item) => sum + item.planned, 0)
    const visibleInOfficePlanned = categoryRecords
      .filter((item) => item.group === 'in_office' && activeCategoryIds.includes(item.id))
      .reduce((sum, item) => sum + item.planned, 0)
    const visibleOutOfOfficeActual = row.shrinkage
      .filter((item) => item.group === 'out_of_office' && activeCategoryIds.includes(item.id))
      .reduce((sum, item) => sum + (item.actualPct ?? 0), 0)
    const visibleInOfficeActual = row.shrinkage
      .filter((item) => item.group === 'in_office' && activeCategoryIds.includes(item.id))
      .reduce((sum, item) => sum + (item.actualPct ?? 0), 0)
    const visiblePlannedTotal = visibleOutOfOfficePlanned + visibleInOfficePlanned
    const anyActualMeasured = categoryRecords.some((item) => item.actual != null)
    rowsByWeek.set(row.week, {
      totalPlanned: visiblePlannedTotal,
      totalActual:
        anyActualMeasured || row.timeline === 'historical_actual'
          ? visibleOutOfOfficeActual + visibleInOfficeActual
          : null,
      outOfOfficePlanned: visibleOutOfOfficePlanned,
      outOfOfficeActual: visibleOutOfOfficeActual,
      inOfficePlanned: visibleInOfficePlanned,
      inOfficeActual: visibleInOfficeActual,
      categories: Object.fromEntries(
        categoryRecords.map((item) => [
          item.id,
          {
            planned: item.planned,
            actual: item.actual,
            name: item.name,
          },
        ]),
      ),
    })
    previousResolvedCategories = Object.fromEntries(
      categoryRecords
        .filter((item) => activeCategoryIds.includes(item.id))
        .map((item) => [item.id, item.planned]),
    )
  })
  return { rowsByWeek, labels }
}

export type ShrinkageLookup = ReturnType<typeof buildShrinkageLookup>

/**
 * Add monthly/quarterly bucket keys (same labels as the matrix period view)
 * by averaging the weekly shrinkage lookup entries in each bucket.
 */
export function withPeriodAggregatedShrinkageLookup(
  lookup: ShrinkageLookup,
  weekIsos: string[],
  view: CapacityView,
): ShrinkageLookup {
  if (view === 'weekly') return lookup
  const rowsByWeek = new Map(lookup.rowsByWeek)
  const buckets = new Map<string, string[]>()
  for (const week of weekIsos) {
    const key = bucketLabel(week, view)
    buckets.set(key, [...(buckets.get(key) ?? []), week])
  }

  for (const [label, weeks] of buckets.entries()) {
    const entries = weeks
      .map((week) => lookup.rowsByWeek.get(week))
      .filter((entry): entry is NonNullable<typeof entry> => entry != null)
    if (!entries.length) continue

    const categoryIds = [
      ...new Set(entries.flatMap((entry) => Object.keys(entry.categories))),
    ]
    const categories: Record<string, { planned: number; actual: number | null; name: string }> = {}
    for (const categoryId of categoryIds) {
      const plannedValues = entries
        .map((entry) => entry.categories[categoryId]?.planned)
        .filter((value): value is number => value != null && Number.isFinite(value))
      const actualValues = entries
        .map((entry) => entry.categories[categoryId]?.actual)
        .filter((value): value is number => value != null && Number.isFinite(value))
      const name =
        entries.find((entry) => entry.categories[categoryId]?.name)?.categories[categoryId]?.name ??
        categoryId
      categories[categoryId] = {
        planned: plannedValues.length
          ? plannedValues.reduce((sum, value) => sum + value, 0) / plannedValues.length
          : 0,
        actual: actualValues.length
          ? actualValues.reduce((sum, value) => sum + value, 0) / actualValues.length
          : null,
        name,
      }
    }

    const avgField = (pick: (entry: (typeof entries)[number]) => number) =>
      entries.reduce((sum, entry) => sum + pick(entry), 0) / entries.length

    rowsByWeek.set(label, {
      totalPlanned: avgField((entry) => entry.totalPlanned),
      totalActual: entries.every((entry) => entry.totalActual == null)
        ? null
        : avgField((entry) => entry.totalActual ?? 0),
      outOfOfficePlanned: avgField((entry) => entry.outOfOfficePlanned),
      outOfOfficeActual: avgField((entry) => entry.outOfOfficeActual),
      inOfficePlanned: avgField((entry) => entry.inOfficePlanned),
      inOfficeActual: avgField((entry) => entry.inOfficeActual),
      categories,
    })
  }

  return { rowsByWeek, labels: lookup.labels }
}

export function buildCapacityMatrixGroups(
  view: CapacityView,
  stageWeekMaps: ReturnType<typeof buildStageWeekMaps>,
  shrinkageLookup: ReturnType<typeof buildShrinkageLookup>,
  actualStageAttritionLookup: ReturnType<typeof buildActualStageAttritionLookup>,
  trainingAttritionRate: number,
  nestingAttritionRate: number,
  fteBilling = false,
): Record<CapacityGroupId, CapacityMatrixRowDef[]> {
  const weeklyMutualBlank = view === 'weekly'
  const requiredFteFormula = fteBilling
    ? 'Enter Required Production FTE manually for FTE billing. Volume, AHT, and occupancy are for tracking only and do not drive this value.'
    : 'Required Production FTE is channel-specific productive staffing before shrinkage. Configure drivers in the Required Production FTE panel. Paid FTE = Required ÷ (1 − Shrinkage) is separate. Weekly view: Production FTE blanks when Required is 0 or missing for that week.'
  const forecastVolumeFormula = fteBilling
    ? 'Tracking only for FTE billing — does not change Required Production FTE.'
    : 'Forecast volume can be manually entered for planning weeks.'
  const plannedAhtFormula = fteBilling
    ? 'Tracking only for FTE billing — does not change Required Production FTE.'
    : undefined

  const weeklyPair = (
    required: number | null | undefined,
    production: number | null | undefined,
  ) => applyWeeklyMutualFteBlank(required, production, weeklyMutualBlank)

  return {
    staffing: [
      {
        id: 'required-production-fte',
        label: 'Required Production FTE',
        // Weekly: show Required whenever present; Production blanks without Required.
        value: (row) =>
          weeklyPair(row.planned.requiredFte, row.actual.productionFte ?? row.planned.productionFte)
            .requiredFte,
        futureValue: (row) =>
          weeklyPair(row.planned.requiredFte, row.planned.productionFte).requiredFte,
        format: (value) => fmtNum(value, 2),
        formula: requiredFteFormula,
        ...(fteBilling
          ? {
              plannedOverrideKey: 'requiredFte' as const,
              editablePlanned: true,
              step: 0.1,
            }
          : {}),
      },
      {
        id: 'production-fte',
        label: 'Production FTE',
        value: (row) =>
          weeklyPair(row.planned.requiredFte, row.actual.productionFte).productionFte,
        futureValue: (row) =>
          weeklyPair(row.planned.requiredFte, row.planned.productionFte).productionFte,
        format: (value) => fmtNum(value, 1),
        formula:
          'Production FTE = (Production HC × (1 − Shrinkage %)) + Nesting productive FTE. Weekly view: blank when Required is 0 / missing for that week.',
      },
      {
        id: 'fte-variance',
        label: 'FTE variance',
        // Match Production FTE / Required Production FTE display sources by week type.
        value: (row) => {
          const pair = weeklyPair(
            row.planned.requiredFte ?? row.actual.requiredFte,
            row.actual.productionFte,
          )
          return pair.requiredFte != null && pair.productionFte != null
            ? pair.productionFte - pair.requiredFte
            : null
        },
        futureValue: (row) => {
          const pair = weeklyPair(row.planned.requiredFte, row.planned.productionFte)
          return pair.requiredFte != null && pair.productionFte != null
            ? pair.productionFte - pair.requiredFte
            : null
        },
        format: (value) => fmtVarianceDelta(value, 1),
        formula: 'FTE variance = Production FTE − Required Production FTE (same values as the rows above).',
        tone: varianceToneHigherBetter,
      },
      {
        id: 'staffing-pct',
        label: 'Staffing (%)',
        value: (row) => {
          const pair = weeklyPair(
            row.planned.requiredFte ?? row.actual.requiredFte,
            row.actual.productionFte,
          )
          if (pair.requiredFte == null || pair.productionFte == null || pair.requiredFte === 0) {
            return null
          }
          return pair.productionFte / pair.requiredFte
        },
        futureValue: (row) => {
          const pair = weeklyPair(row.planned.requiredFte, row.planned.productionFte)
          if (pair.requiredFte == null || pair.productionFte == null || pair.requiredFte === 0) {
            return null
          }
          return pair.productionFte / pair.requiredFte
        },
        format: (value) => fmtPct(value),
        formula: 'Staffing % = Production FTE / Required Production FTE.',
        tone: staffingPctTone,
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
      },
      {
        id: 'actual-transfer-in',
        label: 'Actual transfer in',
        value: (row) => row.actual.transferInHc,
        futureValue: () => null,
        format: (value) => fmtNum(value, 0),
        actualOverrideKey: 'transferInHc',
        editableActual: true,
        step: 1,
      },
      {
        id: 'planned-transfer-out',
        label: 'Planned transfer out',
        value: (row) => row.planned.transferOutHc,
        format: (value) => fmtNum(value, 0),
        plannedOverrideKey: 'transferOutHc',
        editablePlanned: true,
        step: 1,
      },
      {
        id: 'actual-transfer-out',
        label: 'Actual transfer out',
        value: (row) => row.actual.transferOutHc,
        futureValue: () => null,
        format: (value) => fmtNum(value, 0),
        actualOverrideKey: 'transferOutHc',
        editableActual: true,
        step: 1,
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
        formula:
          'Actual Production HC is shown for historical actual weeks and the current planning week after saving roster agent count. Other planned weeks remain blank.',
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
          'Actual production HC attrition is entered for weeks marked Actual. It drives Actual attrition % as attrition HC / (Production HC − attrition HC).',
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
        label: 'Forecast volume',
        value: (row) => row.planned.volume,
        format: (value) => fmtNum(value, 0),
        plannedOverrideKey: 'callVolume',
        editablePlanned: true,
        step: 1,
        formula: forecastVolumeFormula,
      },
      {
        id: 'offered-volume',
        label: 'Offered volume',
        value: (row) => row.actual.offeredVolume,
        futureValue: () => null,
        format: (value) => fmtNum(value, 0),
        actualOverrideKey: 'callVolume',
        editableActual: true,
        step: 1,
        formula: 'Offered volume can be manually entered for actual weeks.',
      },
      {
        id: 'handled-volume',
        label: 'Handled volume',
        value: (row) => row.actual.handledVolume,
        futureValue: (row) => row.planned.handledVolume,
        format: (value) => fmtNum(value, 0),
        plannedOverrideKey: 'handledVolume',
        actualOverrideKey: 'handledVolume',
        editablePlanned: true,
        editableActual: true,
        step: 1,
        formula: 'Handled volume defaults to productive capacity, but planners can manually override it when needed.',
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
          const lookup = shrinkageLookup.rowsByWeek.get(row.week)
          if (!lookup) return 0
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
          if (lookup && (row.statusLabel === 'Actual' || row.timeline === 'historical_actual')) {
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
      },
      {
        id: 'actual-ooo-shrinkage',
        label: 'Actual out of office shrinkage',
        value: (row) =>
          row.statusLabel === 'Actual' || row.timeline === 'historical_actual'
            ? shrinkageLookup.rowsByWeek.get(row.week)?.outOfOfficeActual ?? 0
            : null,
        futureValue: () => null,
        format: (value) => fmtPct(value),
      },
      {
        id: 'planned-inoffice-shrinkage',
        label: 'Planned in office shrinkage',
        value: (row) => shrinkageLookup.rowsByWeek.get(row.week)?.inOfficePlanned ?? 0,
        format: (value) => fmtPct(value),
      },
      {
        id: 'actual-inoffice-shrinkage',
        label: 'Actual in office shrinkage',
        value: (row) =>
          row.statusLabel === 'Actual' || row.timeline === 'historical_actual'
            ? shrinkageLookup.rowsByWeek.get(row.week)?.inOfficeActual ?? 0
            : null,
        futureValue: () => null,
        format: (value) => fmtPct(value),
      },
      {
        id: 'shrinkage-variance',
        label: 'Shrinkage variance (Act - Pl)',
        value: (row) => {
          if (row.statusLabel !== 'Actual' && row.timeline !== 'historical_actual') return null
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
        label: 'Planned AHT',
        value: (row) => row.planned.ahtSeconds,
        format: (value) => fmtNum(value, 1),
        plannedOverrideKey: 'ahtSeconds',
        editablePlanned: true,
        step: 1,
        ...(plannedAhtFormula ? { formula: plannedAhtFormula } : {}),
      },
      {
        id: 'capped-aht',
        label: 'Capped AHT',
        value: (row) => row.planned.cappedAhtSeconds,
        format: (value) => fmtNum(value, 1),
        plannedOverrideKey: 'cappedAhtSeconds',
        editablePlanned: true,
        step: 1,
        formula: 'Upper bound applied to effective AHT in required FTE calculations.',
      },
      {
        id: 'actual-aht',
        label: 'Actual AHT',
        value: (row) => row.actual.ahtSeconds,
        futureValue: () => null,
        format: (value) => fmtNum(value, 1),
        actualOverrideKey: 'ahtSeconds',
        editableActual: true,
        step: 1,
      },
      {
        id: 'aht-variance',
        label: 'AHT variance sec (Act - Pl)',
        value: (row) =>
          row.actual.ahtSeconds != null && row.planned.ahtSeconds != null
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
        label: 'Planned occupancy',
        value: (row) => row.planned.occupancy,
        format: (value) => fmtPct(value),
        plannedOverrideKey: 'occupancy',
        editablePlanned: true,
        step: 0.1,
        isPercentInput: true,
        formula: 'Planned occupancy defaults to 85% unless manually overridden.',
      },
      {
        id: 'actual-occupancy',
        label: 'Actual occupancy',
        value: (row) => row.actual.occupancy,
        futureValue: () => null,
        format: (value) => fmtPct(value),
        actualOverrideKey: 'occupancy',
        editableActual: true,
        step: 0.1,
        isPercentInput: true,
        formula: 'Actual occupancy is capped at 100%.',
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
    ],
  }
}


export type CapacityMatrixDisplayContext = {
  view: CapacityView
  stageWeekMaps: ReturnType<typeof buildStageWeekMaps>
  shrinkageLookup: ReturnType<typeof buildShrinkageLookup>
  actualStageAttritionLookup: ReturnType<typeof buildActualStageAttritionLookup>
  trainingAttritionRate: number
  nestingAttritionRate: number
  fteBilling?: boolean
  forecastModes: Partial<Record<CapacityDriverModeId, CapacityForecastMode>>
}

export function buildCapacityMatrixDisplayContext(options: {
  derivedRows: DerivedCapacityRow[]
  ledger: WeeklyLedgerRow[]
  forecast: ScenarioForecastPackage | null
  assumptions: PlannerAssumptions
  view?: CapacityView
  forecastModes?: Partial<Record<CapacityDriverModeId, CapacityForecastMode>>
  fteBilling?: boolean
}): CapacityMatrixDisplayContext {
  const view = options.view ?? 'weekly'
  const forecastModes = options.forecastModes ?? DEFAULT_CAPACITY_FORECAST_MODES
  const trainingWeeks = options.assumptions.newHire.trainingWeeks ?? 4
  const nestingWeeks = options.assumptions.newHire.nestingWeeks ?? 2
  return {
    view,
    stageWeekMaps: buildStageWeekMaps(options.derivedRows, trainingWeeks, nestingWeeks, options.assumptions),
    shrinkageLookup: buildShrinkageLookup(options.ledger, options.forecast, forecastModes),
    actualStageAttritionLookup: buildActualStageAttritionLookup(options.derivedRows),
    trainingAttritionRate: options.assumptions.newHire.trainingAttritionRate ?? 0,
    nestingAttritionRate: options.assumptions.newHire.nestingAttritionRate ?? 0,
    fteBilling: options.fteBilling ?? false,
    forecastModes,
  }
}

export function getCapacityMatrixGroups(context: CapacityMatrixDisplayContext): Record<CapacityGroupId, CapacityMatrixRowDef[]> {
  return buildCapacityMatrixGroups(
    context.view,
    context.stageWeekMaps,
    context.shrinkageLookup,
    context.actualStageAttritionLookup,
    context.trainingAttritionRate,
    context.nestingAttritionRate,
    context.fteBilling ?? false,
  )
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

function sumNullable(values: Array<number | null>): number | null {
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
    requiredFte: avgNullable(rows.map((row) => row.requiredFte)),
    coreProductionFte: avg(rows.map((row) => row.coreProductionFte)),
    nestingProductiveFte: avg(rows.map((row) => row.nestingProductiveFte)),
    productionFte: avgNullable(rows.map((row) => row.productionFte)) ?? 0,
    staffingPct: avgNullable(rows.map((row) => row.staffingPct)),
    overUnderFte: avg(rows.map((row) => row.overUnderFte)),
    scheduledBillableHours: sumNullable(rows.map((row) => row.scheduledBillableHours)),
    actualBillableHours: sumNullable(rows.map((row) => row.actualBillableHours)),
    productiveHours: sumNullable(rows.map((row) => row.productiveHours)),
    payrollHours: sumNullable(rows.map((row) => row.payrollHours)),
    switchHours: sumNullable(rows.map((row) => row.switchHours)),
  }
}

export function aggregateCapacityRows(rows: DerivedCapacityRow[], view: CapacityView): DerivedCapacityRow[] {
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
    }
  })
}

export function selectCapacityDisplayRows(
  rows: DerivedCapacityRow[],
  options?: { showFutureWeeks?: boolean; planningWeek?: string | null },
): DerivedCapacityRow[] {
  return sliceCapacityWindow(rows, {
    planningWeek: options?.planningWeek,
    showFuture: options?.showFutureWeeks !== false,
  })
}

import fs from 'fs'

const src = fs.readFileSync('src/pages/AdvancedStaffingCapacityPlanPage.tsx', 'utf8')
const start = src.indexOf('function safeRatio')
const end = src.indexOf('function bucketLabel')
const chunk = src.slice(start, end)
const header = `import type { ScenarioForecastPackage } from './forecasting'
import { SHRINKAGE_FORECAST_METRIC_IDS, type ForecastMetricId } from './forecastPersistence'
import { buildCohortStageMaps } from './trainingPipelineHc'
import { fmtNum, fmtPct } from './format'
import type { PlannerAssumptions } from './types'
import type { LedgerMetricSnapshot, WeeklyLedgerRow } from './weeklyLedger'
import type { CapacityForecastMode, CapacityMetricSnapshot, DerivedCapacityRow } from './capacityPlanDerived'
import { MAX_FUTURE_WEEKS, VISIBLE_HISTORY_WEEKS } from './capacityMatrixTheme'

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
  step?: number
  isPercentInput?: boolean
  formula?: string
  tone?: (value: number | null | undefined) => string
}

type CapacityDriverModeId = ForecastMetricId | 'occupancy'

const DEFAULT_CAPACITY_FORECAST_MODES: Partial<Record<CapacityDriverModeId, CapacityForecastMode>> = {
  callVolume: 'forecast',
  ahtSeconds: 'forecast',
  occupancy: 'manual',
  totalShrinkagePct: 'forecast',
  attritionHc: 'forecast',
  ...Object.fromEntries(SHRINKAGE_FORECAST_METRIC_IDS.map((id) => [id, 'forecast' as const])),
}

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

`
const renamed = chunk
  .replace(/function capacityGroups\(/g, 'export function buildCapacityMatrixGroups(')
  .replace(/: MatrixRowDef/g, ': CapacityMatrixRowDef')
  .replace(/Record<CapacityGroupId, MatrixRowDef\[\]>/g, 'Record<CapacityGroupId, CapacityMatrixRowDef[]>')
  .replace(/const GROUP_LABELS[\s\S]*?occupancy: 'Occupancy',\n\}/, '')
  .replace(/function buildActualStageAttritionLookup/g, 'export function buildActualStageAttritionLookup')
  .replace(/function buildStageWeekMaps/g, 'export function buildStageWeekMaps')
  .replace(/function buildShrinkageLookup/g, 'export function buildShrinkageLookup')
  .replace(/function resolvedDriverMode/g, 'function resolvedDriverMode')
const footer = `
export type CapacityMatrixDisplayContext = {
  view: CapacityView
  stageWeekMaps: ReturnType<typeof buildStageWeekMaps>
  shrinkageLookup: ReturnType<typeof buildShrinkageLookup>
  actualStageAttritionLookup: ReturnType<typeof buildActualStageAttritionLookup>
  trainingAttritionRate: number
  nestingAttritionRate: number
  forecastModes: Partial<Record<CapacityDriverModeId, CapacityForecastMode>>
}

export function buildCapacityMatrixDisplayContext(options: {
  derivedRows: DerivedCapacityRow[]
  ledger: WeeklyLedgerRow[]
  forecast: ScenarioForecastPackage | null
  assumptions: PlannerAssumptions
  view?: CapacityView
  forecastModes?: Partial<Record<CapacityDriverModeId, CapacityForecastMode>>
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
  )
}

function bucketLabel(weekIso: string, view: CapacityView): string {
  const date = new Date(weekIso + 'T12:00:00')
  if (view === 'monthly') return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
  if (view === 'quarterly') return \`Q\${Math.floor(date.getMonth() / 3) + 1} \${String(date.getFullYear()).slice(-2)}\`
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
    attritionHc: rows.reduce((sum, row) => sum + row.attritionHc, 0),
    attritionPct: avgNullable(rows.map((row) => row.attritionPct)),
    transferInHc: rows.reduce((sum, row) => sum + row.transferInHc, 0),
    transferOutHc: rows.reduce((sum, row) => sum + row.transferOutHc, 0),
    volume: rows.reduce((sum, row) => sum + row.volume, 0),
    offeredVolume: rows.reduce((sum, row) => sum + row.offeredVolume, 0),
    handledVolume: rows.reduce((sum, row) => sum + row.handledVolume, 0),
    ahtSeconds: avg(rows.map((row) => row.ahtSeconds)),
    cappedAhtSeconds: avg(rows.map((row) => row.cappedAhtSeconds)),
    occupancy: avg(rows.map((row) => row.occupancy)),
    shrinkagePct: avg(rows.map((row) => row.shrinkagePct)),
    nestingPhoneTimePct: avg(rows.map((row) => row.nestingPhoneTimePct)),
    productionHc: last.productionHc,
    requiredFte: avg(rows.map((row) => row.requiredFte)),
    coreProductionFte: avg(rows.map((row) => row.coreProductionFte)),
    nestingProductiveFte: avg(rows.map((row) => row.nestingProductiveFte)),
    productionFte: avg(rows.map((row) => row.productionFte)),
    staffingPct: avgNullable(rows.map((row) => row.staffingPct)),
    overUnderFte: avg(rows.map((row) => row.overUnderFte)),
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
  options?: { showFutureWeeks?: boolean },
): DerivedCapacityRow[] {
  const actualRows = rows.filter((row) => row.timeline === 'historical_actual')
  const futureRows = rows.filter((row) => row.timeline === 'forward_plan')
  const futureLimit = options?.showFutureWeeks === false ? 0 : MAX_FUTURE_WEEKS
  return [...actualRows.slice(-VISIBLE_HISTORY_WEEKS), ...futureRows.slice(0, futureLimit)]
}
`

fs.writeFileSync('src/planner/capacityMatrixDisplay.ts', header + renamed + footer)
console.log('extracted capacityMatrixDisplay.ts')

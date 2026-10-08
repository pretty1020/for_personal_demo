import type { PeriodResult, PlannerAssumptions } from './types'
import {
  CAPACITY_MATRIX_ROWS,
  CAPACITY_MATRIX_SECTIONS,
  capacityMatrixRowDef,
  type CapacityMatrixSectionId,
} from './capacityMatrixMetrics'
import { deriveDemoActuals } from './variance'
import { headcountOverUnder } from './workforceMetrics'
import { fmtNum, fmtPct } from './format'

export type PvaMatrixValues = Record<string, (number | null)[]>

function handledFromOffered(offered: number, periodIndex: number): number {
  const seed = (periodIndex + 1) * 23
  const handleRate = 0.945 + ((seed % 17) / 17) * 0.035
  return Math.round(offered * handleRate)
}

function actualAttritionHc(p: PeriodResult, periodIndex: number): number {
  const base = p.attritionActual ?? p.attritionPlanned
  return deriveDemoActuals(base, periodIndex, 'attr', false)
}

function actualShrinkRate(p: PeriodResult, a: PlannerAssumptions): number {
  if (p.scheduledHours <= 0) return a.tenured.shrinkageRate
  const shrinkHrs = p.shrinkageInOfficeHours + p.shrinkageOutOfOfficeHours
  const fromHours = shrinkHrs / p.scheduledHours
  return deriveDemoActuals(
    fromHours > 0 ? fromHours : a.tenured.shrinkageRate,
    p.periodIndex,
    'shrink',
    false,
  )
}

function attritionPct(attrHc: number, productionHc: number): number | null {
  return productionHc > 0 ? (attrHc / productionHc) * 100 : null
}

function diffArrays(plan: (number | null)[], actual: (number | null)[]): (number | null)[] {
  return plan.map((pl, i) => {
    const ac = actual[i]
    if (pl == null || ac == null || !Number.isFinite(pl) || !Number.isFinite(ac)) return null
    return ac - pl
  })
}

function addVarianceRows(out: PvaMatrixValues) {
  out.paidHrsVariance = diffArrays(out.plannedPaidHrs ?? [], out.actualPaidHrs ?? [])
  out.trainHrsVariance = diffArrays(out.plannedTrainHrs ?? [], out.actualTrainHrs ?? [])
  out.attrPctVariance = diffArrays(out.plannedAttrPct ?? [], out.actualAttrPct ?? [])
  out.handledVolVariance = (out.forecastVol ?? []).map((fc, i) => {
    const hnd = out.handledVol?.[i]
    if (fc == null || hnd == null || !Number.isFinite(fc) || !Number.isFinite(hnd)) return null
    return hnd - fc
  })
  out.shrinkVariance = diffArrays(out.plannedShrink ?? [], out.actualShrink ?? [])
  out.ahtVariance = diffArrays(out.plannedAht ?? [], out.actualAht ?? [])
}

/** Build week-column values for Planned vs Actual using the same row ids as the capacity matrix. */
export function buildSimulatorMatrixValues(
  periods: PeriodResult[],
  assumptions: PlannerAssumptions,
): PvaMatrixValues {
  const a = assumptions
  const out: PvaMatrixValues = {}

  const set = (id: string, values: (number | null)[]) => {
    out[id] = values
  }

  set(
    'beginningProductionHc',
    periods.map((p) => p.beginningProductionHc),
  )
  set(
    'requiredHc',
    periods.map((p) => p.requiredFte),
  )
  set(
    'productionHc',
    periods.map((p) => p.scheduledFte),
  )
  set(
    'productionFte',
    periods.map((p) => p.productiveFte),
  )
  set(
    'staffingPct',
    periods.map((p) => (p.staffingPct == null ? null : p.staffingPct * 100)),
  )
  set(
    'overUnder',
    periods.map((p) => headcountOverUnder(p.productiveFte, p.requiredFte)),
  )
  set(
    'plannedPaidHrs',
    periods.map((p) => p.productiveHours),
  )
  set(
    'actualPaidHrs',
    periods.map((p) => deriveDemoActuals(p.productiveHours, p.periodIndex, 'paidHrs', true)),
  )
  set(
    'plannedTrainHrs',
    periods.map((p) => p.hiringPlanned * a.tenured.standardScheduledHoursPerWeek * 0.25),
  )
  set(
    'actualTrainHrs',
    periods.map((p) => (p.hiringActual ?? p.hiringPlanned) * a.tenured.standardScheduledHoursPerWeek * 0.25),
  )
  set(
    'newHires',
    periods.map((p) => p.hiringPlanned),
  )
  set(
    'actualTrainingStart',
    periods.map((p) => p.actualTrainingStart),
  )
  set(
    'inTraining',
    periods.map((p) => p.trainingHeadcount),
  )
  set(
    'nestingHc',
    periods.map((p) => p.nestingHeadcount),
  )
  set(
    'nestingPhoneTimePct',
    periods.map((p) => p.nestingPhoneTimePct * 100),
  )
  set(
    'graduates',
    periods.map((p) => p.graduateHc),
  )
  set(
    'plannedAttrPct',
    periods.map((p) => attritionPct(p.attritionPlanned, p.scheduledFte)),
  )
  set(
    'actualAttrPct',
    periods.map((p) => attritionPct(actualAttritionHc(p, p.periodIndex), p.scheduledFte)),
  )
  set(
    'forecastVol',
    periods.map((p) => p.forecastVolume),
  )
  const offeredValues = periods.map((p) =>
    Math.round(deriveDemoActuals(p.forecastVolume * 0.98, p.periodIndex, 'offered', true)),
  )
  set('offeredVol', offeredValues)
  set(
    'handledVol',
    offeredValues.map((offered, i) => handledFromOffered(offered, periods[i]!.periodIndex)),
  )
  set(
    'plannedShrink',
    periods.map(() => a.tenured.shrinkageRate),
  )
  set(
    'actualShrink',
    periods.map((p) => actualShrinkRate(p, a)),
  )
  set(
    'plannedAht',
    periods.map(() => a.tenured.ahtSeconds),
  )
  set(
    'actualAht',
    periods.map((p) => deriveDemoActuals(a.tenured.ahtSeconds, p.periodIndex, 'aht', false)),
  )

  addVarianceRows(out)
  return out
}

function fmtSignedDelta(value: number, decimals: number, suffix = ''): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}${suffix}`
}

export function formatMatrixCell(rowId: string, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const row = capacityMatrixRowDef(rowId)
  if (row?.kind === 'variance' || rowId === 'overUnder') {
    if (rowId === 'shrinkVariance') return fmtSignedDelta(value * 100, 2)
    if (rowId === 'attrPctVariance') return fmtSignedDelta(value, 2)
    if (rowId === 'ahtVariance') return fmtSignedDelta(value, 1)
    if (rowId.includes('Hrs') || rowId.includes('Vol')) return fmtSignedDelta(value, 0)
    return fmtSignedDelta(value, rowId === 'overUnder' ? 1 : 2)
  }
  if (rowId === 'plannedShrink' || rowId === 'actualShrink') return fmtPct(value)
  if (rowId === 'plannedAttrPct' || rowId === 'actualAttrPct' || rowId === 'staffingPct' || rowId === 'nestingPhoneTimePct') {
    return `${value.toFixed(2)}%`
  }
  if (rowId === 'plannedAht' || rowId === 'actualAht') return fmtNum(value, 1)
  if (
    rowId === 'graduates' ||
    rowId === 'newHires' ||
    rowId === 'actualTrainingStart' ||
    rowId === 'inTraining' ||
    rowId === 'nestingHc'
  ) {
    return fmtNum(value, 0)
  }
  if (rowId.includes('Vol') || rowId.includes('Hrs')) return fmtNum(value, 0)
  return fmtNum(value, 2)
}

function varianceNeutralThreshold(rowId: string): number {
  if (rowId === 'overUnder') return 1
  if (rowId === 'shrinkVariance') return 0.002
  if (rowId === 'attrPctVariance') return 0.05
  if (rowId === 'ahtVariance') return 2
  if (rowId.includes('Vol')) return 100
  if (rowId.includes('Hrs')) return 50
  return 0.5
}

export function matrixCellTone(rowId: string, value: number | null): string {
  if (value == null || !Number.isFinite(value)) return 'neutral'
  const row = capacityMatrixRowDef(rowId)
  if (row?.kind !== 'variance' && rowId !== 'overUnder') return 'neutral'

  if (Math.abs(value) < varianceNeutralThreshold(rowId)) return 'neutral'
  const higherIsBetter = row?.higherIsBetter ?? rowId === 'overUnder'
  const favorable = higherIsBetter ? value >= 0 : value <= 0
  return favorable ? 'variance-pos' : 'variance-neg'
}

export { CAPACITY_MATRIX_ROWS, CAPACITY_MATRIX_SECTIONS, type CapacityMatrixSectionId }

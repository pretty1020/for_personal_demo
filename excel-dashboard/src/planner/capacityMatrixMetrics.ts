import { METRIC_LABELS } from './metricLabels'
import type { WeekStart } from './types'

/** Canonical capacity matrix sections — shared by Capacity Plan and Planned vs Actual. */
export const CAPACITY_MATRIX_SECTIONS = [
  { id: 'headcount', title: 'Calculations' },
  { id: 'hours', title: 'Paid production & training hours' },
  { id: 'training', title: 'Training pipeline' },
  { id: 'attrition', title: 'Attrition' },
  { id: 'volume', title: 'Volume' },
  { id: 'shrinkage', title: 'Shrinkage' },
  { id: 'aht', title: 'AHT (seconds)' },
] as const

export type CapacityMatrixSectionId = (typeof CAPACITY_MATRIX_SECTIONS)[number]['id']

export type CapacityMatrixRowKind = 'value' | 'variance'

export type CapacityMatrixRowDef = {
  id: string
  sectionId: CapacityMatrixSectionId
  label: string
  kind?: CapacityMatrixRowKind
  /** For variance rows: whether a positive delta is favorable. */
  higherIsBetter?: boolean
}

export const CAPACITY_MATRIX_ROWS: CapacityMatrixRowDef[] = [
  { id: 'beginningProductionHc', sectionId: 'headcount', label: METRIC_LABELS.beginningProductionHeadcount },
  { id: 'requiredHc', sectionId: 'headcount', label: METRIC_LABELS.requiredHeadcount },
  { id: 'productionHc', sectionId: 'headcount', label: METRIC_LABELS.productionHeadcount },
  { id: 'productionFte', sectionId: 'headcount', label: METRIC_LABELS.productionFte },
  { id: 'staffingPct', sectionId: 'headcount', label: METRIC_LABELS.staffingPct },
  { id: 'overUnder', sectionId: 'headcount', label: METRIC_LABELS.overUnderStaffing, kind: 'variance', higherIsBetter: true },
  { id: 'plannedPaidHrs', sectionId: 'hours', label: 'Planned paid production hours' },
  { id: 'actualPaidHrs', sectionId: 'hours', label: 'Actual paid production hours' },
  {
    id: 'paidHrsVariance',
    sectionId: 'hours',
    label: 'Paid production hours variance (Act − Pl)',
    kind: 'variance',
    higherIsBetter: true,
  },
  { id: 'plannedTrainHrs', sectionId: 'hours', label: 'Planned new hire training hours' },
  { id: 'actualTrainHrs', sectionId: 'hours', label: 'Actual training hours' },
  {
    id: 'trainHrsVariance',
    sectionId: 'hours',
    label: 'Training hours variance (Act − Pl)',
    kind: 'variance',
    higherIsBetter: false,
  },
  { id: 'newHires', sectionId: 'training', label: 'New hire headcount' },
  { id: 'actualTrainingStart', sectionId: 'training', label: METRIC_LABELS.actualTrainingStart },
  { id: 'inTraining', sectionId: 'training', label: 'In-training headcount' },
  { id: 'nestingHc', sectionId: 'training', label: 'Nesting headcount' },
  { id: 'nestingPhoneTimePct', sectionId: 'training', label: 'Nesting phone time %' },
  { id: 'graduates', sectionId: 'training', label: 'Graduate headcount' },
  { id: 'plannedAttrPct', sectionId: 'attrition', label: 'Planned attrition %' },
  { id: 'actualAttrPct', sectionId: 'attrition', label: 'Actual attrition %' },
  {
    id: 'attrPctVariance',
    sectionId: 'attrition',
    label: 'Attrition rate variance (Act − Pl)',
    kind: 'variance',
    higherIsBetter: false,
  },
  { id: 'forecastVol', sectionId: 'volume', label: METRIC_LABELS.forecastVolume },
  { id: 'offeredVol', sectionId: 'volume', label: 'Offered volume' },
  { id: 'handledVol', sectionId: 'volume', label: 'Handled volume' },
  {
    id: 'handledVolVariance',
    sectionId: 'volume',
    label: 'Handled volume variance (Hnd − Fcst)',
    kind: 'variance',
    higherIsBetter: true,
  },
  { id: 'plannedShrink', sectionId: 'shrinkage', label: 'Planned shrinkage' },
  { id: 'actualShrink', sectionId: 'shrinkage', label: 'Actual shrinkage' },
  {
    id: 'shrinkVariance',
    sectionId: 'shrinkage',
    label: 'Shrinkage variance (Act − Pl)',
    kind: 'variance',
    higherIsBetter: false,
  },
  { id: 'plannedAht', sectionId: 'aht', label: 'Planned AHT' },
  { id: 'actualAht', sectionId: 'aht', label: 'Actual AHT' },
  {
    id: 'ahtVariance',
    sectionId: 'aht',
    label: 'AHT variance sec (Act − Pl)',
    kind: 'variance',
    higherIsBetter: false,
  },
]

export function periodWeekDate(periodIndex: number, weekStart: WeekStart = 'sunday'): string {
  const baseIso = weekStart === 'monday' ? '2026-01-05' : '2026-01-04'
  const d = new Date(baseIso + 'T12:00:00')
  d.setDate(d.getDate() + periodIndex * 7)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yy = String(d.getFullYear()).slice(-2)
  return `${mm}/${dd}/${yy}`
}

export function capacityMatrixRowDef(rowId: string): CapacityMatrixRowDef | undefined {
  return CAPACITY_MATRIX_ROWS.find((r) => r.id === rowId)
}

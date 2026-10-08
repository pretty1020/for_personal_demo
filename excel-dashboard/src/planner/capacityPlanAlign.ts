import type { CapacityPlanPublishSnapshot } from './capacityPlanBridge'
import { DEFAULT_ASSUMPTIONS } from './defaults'
import { buildSimulatorMatrixValues } from './simulatorMatrixValues'
import type { PeriodResult, PlannerAssumptions } from './types'
import { headcountOverUnder } from './workforceMetrics'

/** Period row shape used by the Capacity Plan week / month / quarter matrix. */
export type CapacityMatrixPeriod = {
  week: string
  beginningProductionHc?: number
  requiredHc: number
  activeHc: number
  activeFte: number
  staffingPct?: number | null
  hcOu: number
  actMinusReq: number
  ouPct: number | null
  forecast: number
  offered: number
  handled: number
  plannedShrink: number | null
  actualShrink: number | null
  plannedAht: number | null
  actualAht: number | null
  plannedAttr: number | null
  actualAttr: number | null
  plannedPaidProdHrs: number | null
  actualPaidProdHrs: number | null
  plannedNewHireTrainHrs: number | null
  actualTrainHrs: number | null
  newHires: number
  actualTrainingStart?: number
  trainingPipeline: number
  nestingHc?: number
  nestingPhoneTimePct?: number | null
  graduates: number
  plannedAttrOverActiveHcPct: number | null
  actualAttrOverActiveHcPct: number | null
  [key: string]: unknown
}

function headcountOu(active: number, required: number) {
  const ou = headcountOverUnder(active, required)
  const ouPct = required > 0 && Number.isFinite(active) ? (active / required) * 100 : null
  return { actMinusReq: ou, hcOu: ou, ouPct }
}

/**
 * Replace matrix headcount & plan metrics with Planning Simulator values
 * so Capacity Plan matches Planned vs Actual (same FTE scale, not portfolio HC).
 */
export function applySimulatorPlanToPeriods<T extends CapacityMatrixPeriod>(
  periods: T[],
  simulationPeriods: PeriodResult[] | undefined,
  assumptions: PlannerAssumptions = DEFAULT_ASSUMPTIONS,
  snapshot?: CapacityPlanPublishSnapshot,
): T[] {
  if (!simulationPeriods?.length || !periods.length) return periods

  const simSlice = simulationPeriods.slice(0, periods.length)
  const matrix = buildSimulatorMatrixValues(simSlice, assumptions)
  const { shrinkageRate, ahtSeconds, attritionRateMonthly } =
    snapshot?.planAssumptions ?? {
      shrinkageRate: assumptions.tenured.shrinkageRate,
      ahtSeconds: assumptions.tenured.ahtSeconds,
      attritionRateMonthly: assumptions.tenured.attritionRateMonthly,
    }

  return periods.map((row, i) => {
    const sim = simSlice[Math.min(i, simSlice.length - 1)]!
    const req = sim.requiredFte
    const prod = sim.productiveFte
    const ou = headcountOu(prod, req)
    const plannedAttrPct = sim.scheduledFte > 0 ? (sim.attritionPlanned / sim.scheduledFte) * 100 : attritionRateMonthly * 100
    const actualAttrPct =
      sim.scheduledFte > 0 ? ((sim.attritionActual ?? sim.attritionPlanned) / sim.scheduledFte) * 100 : plannedAttrPct

    return {
      ...row,
      beginningProductionHc: sim.beginningProductionHc,
      requiredHc: req,
      activeHc: sim.scheduledFte,
      activeFte: sim.productiveFte,
      staffingPct: sim.staffingPct != null ? sim.staffingPct * 100 : null,
      ...ou,
      forecast: sim.forecastVolume,
      offered: matrix.offeredVol?.[i] ?? row.offered,
      handled: matrix.handledVol?.[i] ?? row.handled,
      plannedShrink: shrinkageRate,
      actualShrink: matrix.actualShrink?.[i] ?? row.actualShrink,
      plannedAht: ahtSeconds,
      actualAht: matrix.actualAht?.[i] ?? row.actualAht,
      plannedPaidProdHrs: sim.productiveHours,
      actualPaidProdHrs: matrix.actualPaidHrs?.[i] ?? row.actualPaidProdHrs,
      plannedNewHireTrainHrs: matrix.plannedTrainHrs?.[i] ?? row.plannedNewHireTrainHrs,
      actualTrainHrs: matrix.actualTrainHrs?.[i] ?? row.actualTrainHrs,
      newHires: sim.hiringPlanned,
      actualTrainingStart: sim.actualTrainingStart,
      trainingPipeline: sim.trainingHeadcount,
      nestingHc: sim.nestingHeadcount,
      nestingPhoneTimePct: sim.nestingPhoneTimePct * 100,
      graduates: sim.graduateHc,
      plannedAttrOverActiveHcPct: matrix.plannedAttrPct?.[i] ?? plannedAttrPct,
      actualAttrOverActiveHcPct: matrix.actualAttrPct?.[i] ?? actualAttrPct,
    }
  })
}

/** Overlay planned shrink / AHT assumptions when simulator periods are unavailable. */
export function alignPeriodsWithPublishedPlan<T extends CapacityMatrixPeriod>(
  periods: T[],
  snapshot: CapacityPlanPublishSnapshot | undefined,
  _matrixView: 'week' | 'month' | 'quarter',
): T[] {
  if (!snapshot?.planAssumptions || !periods.length) return periods
  const { shrinkageRate, ahtSeconds, attritionRateMonthly } = snapshot.planAssumptions
  return periods.map((row) => ({
    ...row,
    plannedShrink: shrinkageRate,
    plannedAht: ahtSeconds,
    plannedAttr: attritionRateMonthly * 100,
    plannedAttrOverActiveHcPct: attritionRateMonthly * 100,
  }))
}

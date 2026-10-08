import type { ParsedWorkbookBundle } from '../types/dashboard'
import { DEFAULT_ASSUMPTIONS } from '../planner/defaults'
import { trainingPipelineHc } from '../planner/trainingPipelineHc'
import { simulatorWeekFactors } from '../planner/simulatorWeekCurve'
import { IDEAL_SAMPLE_CLIENTS, IDEAL_SAMPLE_WEEKS } from './idealSampleShared'
import {
  allocateDecimals,
  allocateIntegers,
  LOCATION_HC_TOTALS,
  locationHcBucket,
  ROMANIA_HC_TOTALS,
  type LocationHcBucket,
} from './idealStaffingLocationTotals'
import { dominantMonthShortFromSundayWeekStart } from './staffingCapacity/calendarWeek'
import { STAFFING_HEADERS, RATES_HEADERS } from './staffingCapacity/sampleWorkbook'
import { matrixToSnapshot } from './parseExcelCore'

export type IdealStaffingProgram = {
  projectCode: string
  client: string
  location: string
  lob: string
  billingType: string
  billingRate: number
  prodHoursPerAgent: number
  days: number
  baseReqHc: number
  baseActHc: number
  baseFte: number
  baseForecastVol: number
  plannedShrink: number
  plannedAttr: number
  plannedAht: number
  cappedAht: number
  newHires: number
  training: number
  graduates: number
  tls: number
  opsMgrs: number
  trainers: number
  qas: number
  wfms: number
}

function clientsForBucket(bucket: LocationHcBucket | 'Romania') {
  return IDEAL_SAMPLE_CLIENTS.filter((c) => locationHcBucket(c.location) === bucket)
}

function buildProgramsForBucket(
  bucket: LocationHcBucket | 'Romania',
  totals: typeof LOCATION_HC_TOTALS.Philippines,
): IdealStaffingProgram[] {
  const clients = clientsForBucket(bucket)
  if (!clients.length) return []

  const weights = clients.map((c) => c.budgetBase)
  const act = allocateIntegers(weights, totals.activeProduction)
  const tls = allocateIntegers(weights, totals.teamLead)
  const om = allocateIntegers(weights, totals.opsManager)
  const qa = allocateIntegers(weights, totals.qa)
  const trainers = allocateDecimals(weights, totals.trainer, 2)
  const wfm = allocateIntegers(weights, totals.wfm)

  return clients.map((c, i) => {
    const baseActHc = Math.max(1, act[i]!)
    const baseReqHc = Math.max(baseActHc, Math.round(baseActHc * 1.03))
    const baseFte = Math.round(baseActHc * 0.96 * 10) / 10
    const transactional = i % 5 === 0 && bucket === 'Philippines'
    const monthlyFte = !transactional && i % 3 === 1
    const handledPerAgent = 185
    const baseForecastVol = Math.round(baseActHc * handledPerAgent)
    const trn = Math.max(1, Math.round(baseActHc * 0.07))
    const nh = Math.max(0, Math.round(baseReqHc * 0.04))

    const billingType = transactional ? 'Transactional' : monthlyFte ? 'FTE' : 'Production Hours'
    const billingRate = transactional
      ? 3.5 + (i % 3) * 0.5
      : monthlyFte
        ? 2200 + (i % 4) * 250
        : 16 + (i % 5) * 2

    return {
      projectCode: c.code,
      client: c.name,
      location: c.location,
      lob: i % 2 === 0 ? 'Customer Support' : 'Operations',
      billingType,
      billingRate,
      prodHoursPerAgent: 157.5,
      days: 21,
      baseReqHc,
      baseActHc,
      baseFte,
      baseForecastVol,
      plannedShrink: 0.25 + (i % 4) * 0.008,
      plannedAttr: Math.max(1, Math.round(baseActHc * 0.008)),
      plannedAht: 285 + (i % 6) * 8,
      cappedAht: 340 + (i % 6) * 10,
      newHires: nh,
      training: trn,
      graduates: Math.max(0, Math.round(trn * 0.45)),
      tls: tls[i]!,
      opsMgrs: om[i]!,
      trainers: trainers[i]!,
      qas: qa[i]!,
      wfms: wfm[i]!,
    }
  })
}

/** Capacity Plan programs: Ideal Financial client names with PH/IN location HC totals. */
export function buildIdealStaffingPrograms(): IdealStaffingProgram[] {
  return [
    ...buildProgramsForBucket('Philippines', LOCATION_HC_TOTALS.Philippines),
    ...buildProgramsForBucket('India', LOCATION_HC_TOTALS.India),
    ...buildProgramsForBucket('Romania', ROMANIA_HC_TOTALS),
  ]
}

const IDEAL_STAFFING_PROGRAMS = buildIdealStaffingPrograms()

export function buildIdealStaffingPlanMatrix(): (string | number)[][] {
  const rows: (string | number)[][] = []
  const week0 = simulatorWeekFactors(0, DEFAULT_ASSUMPTIONS)
  let wi = 0
  for (const ws of IDEAL_SAMPLE_WEEKS) {
    const month = dominantMonthShortFromSundayWeekStart(ws) ?? 'Jan'
    const factors = simulatorWeekFactors(wi, DEFAULT_ASSUMPTIONS)
    const hcTrend = week0.requiredFte > 0 ? factors.requiredFte / week0.requiredFte : 1
    const volTrend = week0.forecastVolume > 0 ? factors.forecastVolume / week0.forecastVolume : 1
    const t = wi / Math.max(IDEAL_SAMPLE_WEEKS.length - 1, 1)
    IDEAL_STAFFING_PROGRAMS.forEach((p, pi) => {
      const drift = Math.sin(t * Math.PI * 2 + p.baseActHc * 0.0004 + pi * 0.15) * 0.012
      const stress = (wi + pi) % 5 === 0
      const req = Math.round(p.baseReqHc * hcTrend * (stress ? 1.012 + drift : 1.004 + drift * 0.3))
      const act = Math.round(p.baseActHc * hcTrend * (stress ? 0.975 - drift * 0.2 : 0.992 - drift * 0.1))
      const fte = Math.round(p.baseFte * hcTrend * (stress ? 0.98 : 1) * 10) / 10
      const fc = Math.round(p.baseForecastVol * volTrend * (1 + drift * 0.015))
      const offered = Math.round(fc * (0.975 + drift * 0.008))
      const handled = Math.round(offered * (stress ? 0.945 : 0.955 + ((pi + wi) % 7) * 0.004))
      const plannedShrink = factors.plannedShrink + (pi % 4) * 0.004
      const ash = Math.min(
        0.33,
        Math.max(0.235, plannedShrink + (stress ? 0.016 : 0.01) + drift * 0.006),
      )
      const nh = Math.max(0, Math.round(p.newHires * (stress ? 1.1 : 0.95)))
      const pipe = trainingPipelineHc(nh, DEFAULT_ASSUMPTIONS)
      const plannedNestingHc = pipe.nesting
      const actualNestingHc = Math.max(0, Math.round(plannedNestingHc * (stress ? 1.06 : 0.94 + ((pi + wi) % 5) * 0.02)))
      const plannedAht = factors.plannedAht + (pi % 6) * 6
      const nestingShare = plannedNestingHc / Math.max(1, act + plannedNestingHc)
      const aatr = Math.round(plannedAht * (1 + nestingShare * 0.16) + (stress ? 11 : 5) + drift * 7)
      const plIo = plannedShrink * DEFAULT_ASSUMPTIONS.tenured.shrinkageInOfficeShare
      const plOo = plannedShrink - plIo
      const acIo = ash * 0.62
      const acOo = ash - acIo
      const plannedAttrHc = Math.max(1, Math.round(p.plannedAttr * hcTrend))
      const actualAttrHc = Math.max(
        0,
        Math.round(plannedAttrHc * (stress ? 1.09 : 0.96 + ((pi + wi) % 6) * 0.008)),
      )
      const tls = p.tls
      const om = p.opsMgrs
      const trainers = p.trainers
      const qas = p.qas
      const wfms = p.wfms
      const trainingHc = pipe.inTraining
      const supportHc = tls + om + trainers + qas + wfms
      const plannedPaidProdHrs = req * p.prodHoursPerAgent * (1 - plannedShrink)
      const actualPaidProdHrs = act * p.prodHoursPerAgent * (1 - ash)
      rows.push([
        'FY26',
        month,
        ws,
        p.projectCode,
        p.client,
        p.lob,
        p.location,
        req,
        act,
        fte,
        fc,
        offered,
        handled,
        plannedShrink,
        Number(ash.toFixed(4)),
        Number(plIo.toFixed(5)),
        Number(acIo.toFixed(5)),
        Number(plOo.toFixed(5)),
        Number(acOo.toFixed(5)),
        plannedAttrHc,
        actualAttrHc,
        0,
        ash > p.plannedShrink + 0.025 ? 1 : 0,
        p.cappedAht,
        plannedAht,
        aatr,
        p.billingType,
        p.prodHoursPerAgent,
        p.days,
        p.billingRate,
        nh,
        nh,
        pipe.inTraining,
        pipe.graduates,
        plannedNestingHc,
        actualNestingHc,
        tls,
        om,
        trainers,
        qas,
        wfms,
        trainingHc,
        supportHc,
        Math.round(plannedPaidProdHrs),
        Math.round(actualPaidProdHrs),
        0,
        Math.round(pipe.inTraining * 37.5),
      ])
    })
    wi++
  }
  return rows
}

export function buildIdealRatesMatrix(): (string | number)[][] {
  return IDEAL_STAFFING_PROGRAMS.map((p) => [
    p.projectCode,
    p.client,
    p.lob,
    p.billingType,
    p.billingRate,
    'USD',
    '2026-01-01',
    '2026-12-31',
  ])
}

/** Workbook bundle for Capacity Plan leakage using the same clients as the financial sample. */
export function buildIdealStaffingSampleBundle(): ParsedWorkbookBundle {
  const staffingMatrix = [STAFFING_HEADERS, ...buildIdealStaffingPlanMatrix()]
  const ratesMatrix = [RATES_HEADERS, ...buildIdealRatesMatrix()]
  const snapshots: ParsedWorkbookBundle['snapshots'] = {
    Staffing_Plan: matrixToSnapshot('Staffing_Plan', staffingMatrix),
    Rates: matrixToSnapshot('Rates', ratesMatrix),
  }
  return {
    fileName: 'Ideal_Financial_Dashboard_Sample.xlsx',
    sheetNames: ['Staffing_Plan', 'Rates'],
    snapshots,
  }
}

import * as XLSX from 'xlsx'
import { IDEAL_SAMPLE_WEEKS } from '../idealSampleShared'
import { buildIdealStaffingPrograms, type IdealStaffingProgram } from '../idealStaffingSample'
import { DEFAULT_ASSUMPTIONS } from '../../planner/defaults'
import { trainingPipelineHc } from '../../planner/trainingPipelineHc'
import { dominantMonthShortFromSundayWeekStart } from './calendarWeek'

export const STAFFING_HEADERS = [
  'FY',
  'Month',
  'Week Start Date',
  'Project Code',
  'Client',
  'LOB',
  'Location',
  'Required Headcount',
  'Active Production Headcount',
  'Active Production FTE',
  'Forecast Volume',
  'Actual Offered Volume',
  'Actual Handled Volume',
  'Planned Shrinkage %',
  'Actual Shrinkage %',
  'Planned In-Office Shrinkage %',
  'Actual In-Office Shrinkage %',
  'Planned Out-of-Office Shrinkage %',
  'Actual Out-of-Office Shrinkage %',
  'Planned Attrition',
  'Actual Attrition',
  'Planned Training Attrition',
  'Actual Training Attrition',
  'Capped AHT',
  'Planned AHT',
  'Actual AHT',
  'Billing Type',
  'Production Hours',
  'Days',
  'Billing Rate',
  'Planned New Hire Class (Headcount)',
  'New Hire Employee Count',
  'Training Count',
  'Graduate Count',
  'Planned Nesting HC',
  'Actual Nesting HC',
  'Team Lead Count',
  'Operations Manager Count',
  'Trainer Count',
  'QA Count',
  'WFM Support Count',
  'Training HC',
  'Support HC',
  'Planned Paid Production Hours',
  'Actual Paid Production Hours',
  'Planned New Hire Training Hours',
  'Actual Training Hours',
]

/** Sample weeks aligned with Ideal Financial (Sun 4 Jan 2026, 12 weeks). */
const WEEK_STARTS = IDEAL_SAMPLE_WEEKS

type RowCfg = {
  fy: string
  projectCode: string
  client: string
  lob: string
  location: string
  billingType: string
  /** USD rate meaning depends on Billing Type (see User Guide) */
  billingRate: number
  /** Per-agent productive hours in period (e.g. 21 × 7.5) */
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

function rowCfgFromIdeal(p: IdealStaffingProgram): RowCfg {
  return {
    fy: 'FY26',
    projectCode: p.projectCode,
    client: p.client,
    lob: p.lob,
    location: p.location,
    billingType: p.billingType,
    billingRate: p.billingRate,
    prodHoursPerAgent: p.prodHoursPerAgent,
    days: p.days,
    baseReqHc: p.baseReqHc,
    baseActHc: p.baseActHc,
    baseFte: p.baseFte,
    baseForecastVol: p.baseForecastVol,
    plannedShrink: p.plannedShrink,
    plannedAttr: p.plannedAttr,
    plannedAht: p.plannedAht,
    cappedAht: p.cappedAht,
    newHires: p.newHires,
    training: p.training,
    graduates: p.graduates,
    tls: p.tls,
    opsMgrs: p.opsMgrs,
    trainers: p.trainers,
    qas: p.qas,
    wfms: p.wfms,
  }
}

function getPrograms(): RowCfg[] {
  return buildIdealStaffingPrograms().map(rowCfgFromIdeal)
}

function buildStaffingMatrix(): (string | number)[][] {
  const rows: (string | number)[][] = []
  let wi = 0
  for (const ws of WEEK_STARTS) {
    const month = dominantMonthShortFromSundayWeekStart(ws) ?? 'Jan'
    const t = wi / Math.max(WEEK_STARTS.length - 1, 1)
    for (const p of getPrograms()) {
      const drift = Math.sin(t * Math.PI * 2 + p.baseReqHc * 0.01) * 0.04
      const req = Math.round(p.baseReqHc * (1 + drift * 0.5))
      const act = Math.round(p.baseActHc * (1 - drift * 0.3))
      const fte = Math.round(p.baseFte * (1 - drift * 0.25) * 10) / 10
      const fc = Math.round(p.baseForecastVol * (1 + drift))
      const offered = Math.round(fc * (0.96 + drift * 0.02))
      const handled = Math.round(fc * (0.91 + drift * 0.03))
      const stress = wi % 5 === 0
      const ash = Math.min(0.48, Math.max(0.22, p.plannedShrink + drift * 0.08 + (act < req ? 0.04 : -0.02) + (stress ? 0.015 : 0)))
      const nh = Math.max(0, Math.round(p.newHires * (1 + drift * 0.4)))
      const pipe = trainingPipelineHc(nh, DEFAULT_ASSUMPTIONS)
      const plannedNestingHc = pipe.nesting
      const actualNestingHc = Math.max(0, Math.round(plannedNestingHc * (stress ? 1.06 : 0.94 + (wi % 5) * 0.02)))
      const nestingShare = plannedNestingHc / Math.max(1, act + plannedNestingHc)
      const aatr = Math.round(p.plannedAht * (1 + nestingShare * 0.16) + drift * 40 + (stress ? 12 : 5))
      const plannedNhClass = Math.max(0, Math.round(p.newHires * (1.08 + drift * 0.25)))
      const trn = Math.max(0, Math.round(p.training * (1 + drift * 0.2)))
      const grad = Math.max(0, Math.round(p.graduates * (1 + drift * 0.35)))
      const plannedAttrHc = Math.max(1, Math.round(p.plannedAttr * (act / Math.max(p.baseActHc, 1))))
      const actualAttrHc = Math.max(0, Math.round(plannedAttrHc * (stress ? 1.12 : 0.95 + (wi % 6) * 0.01)))
      const tls = Math.max(0, Math.round(p.tls * (1 + drift * 0.08)))
      const om = Math.max(0, Math.round(p.opsMgrs * (1 + drift * 0.05)))
      const trainers = Math.max(0, Math.round(p.trainers * (1 + drift * 0.1)))
      const qas = Math.max(0, Math.round(p.qas * (1 + drift * 0.1)))
      const wfms = Math.max(0, Math.round(p.wfms * (1 + drift * 0.12)))
      const trainingHc = trn
      const supportHc = tls + om + trainers + qas + wfms
      const plannedPaidProdHrs = req * p.prodHoursPerAgent * (1 - p.plannedShrink)
      const actualPaidProdHrs = act * p.prodHoursPerAgent * (1 - ash)
      const plannedNhTrainHrs = nh * 40
      const actualTrainHrs = trn * 37.5
      const plannedTrnAttr = Math.max(0, Math.round(trn * 0.06 + wi * 0.02))
      const actualTrnAttr = Math.max(0, plannedTrnAttr + (ash > p.plannedShrink + 0.03 ? 1 : 0))
      const plIo = p.plannedShrink * 0.62
      const plOo = p.plannedShrink - plIo
      const acIo = ash * 0.62
      const acOo = ash - acIo
      rows.push([
        p.fy,
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
        p.plannedShrink,
        Number(ash.toFixed(4)),
        Number(plIo.toFixed(5)),
        Number(acIo.toFixed(5)),
        Number(plOo.toFixed(5)),
        Number(acOo.toFixed(5)),
        plannedAttrHc,
        actualAttrHc,
        plannedTrnAttr,
        actualTrnAttr,
        p.cappedAht,
        p.plannedAht,
        aatr,
        p.billingType,
        p.prodHoursPerAgent,
        p.days,
        p.billingRate,
        plannedNhClass,
        nh,
        trn,
        grad,
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
        Math.round(plannedNhTrainHrs),
        Math.round(actualTrainHrs),
      ])
    }
    wi++
  }
  return rows
}

export const RATES_HEADERS = [
  'Project Code',
  'Client',
  'LOB',
  'Billing Type',
  'Rate',
  'Currency',
  'Effective Start Date',
  'Effective End Date',
]

const RATES_SAMPLE = () =>
  getPrograms().map((p) => [
  p.projectCode,
  p.client,
  p.lob,
  p.billingType,
  p.billingRate,
  'USD',
  '2026-01-01',
  '2026-12-31',
])

const OWNERS_HEADERS = ['Client', 'LOB', 'Operations Leader', 'WFM Lead', 'Finance Partner']

const OWNERS_SAMPLE = () =>
  getPrograms().map((p) => [
  p.client,
  p.lob,
  'Ops Exec',
  'WFM Lead',
  'Finance BP',
])

/** Scenario-level weekly totals for reference forecasting (aggregated). */
function buildForecastScenarioSheet(): (string | number)[][] {
  const hdr = ['Scenario', 'Week Start Date', 'Project Code', 'Baseline Forecast', 'Stretch Forecast', 'Actual Handled (ref)']
  const lines: (string | number)[][] = [hdr]
  let wi = 0
  for (const ws of WEEK_STARTS) {
    let sumFc = 0
    let sumH = 0
    for (const p of getPrograms()) {
      const t = wi / Math.max(WEEK_STARTS.length - 1, 1)
      const drift = Math.sin(t * Math.PI * 2 + p.baseReqHc * 0.01) * 0.04
      const fc = Math.round(p.baseForecastVol * (1 + drift))
      const handled = Math.round(fc * (0.91 + drift * 0.03))
      sumFc += fc
      sumH += handled
    }
    const stretch = Math.round(sumFc * 1.06)
    lines.push(['Portfolio — Base', ws, 'ALL', sumFc, stretch, sumH])
    wi++
  }
  return lines
}

const USER_GUIDE_LINES = [
  ['Workforce Capacity Plan — User Guide (v2)'],
  [''],
  ['Weeks (Sunday start)'],
  [
    'Week Start Date is the Sunday opening each Sun–Sat operational week. The sample begins 2026-01-04 (Sunday). Month on each row follows the calendar month that contains the most days in that week (e.g. Sun Jun 28–Sat Jul 4 2026 is tagged Jul).',
  ],
  [''],
  ['Dimensions (sample template)'],
  [
    'The sample Staffing Plan uses Week Start Date (Sunday), FY, Month, Project Code, Client, LOB, and Location. Campaign and Owner are optional in other workbooks; rate lookup matches Client + LOB + Billing Type when Campaign is absent.',
  ],
  [''],
  ['Required columns (Staffing Plan)'],
  [
    'Required Headcount, Active Production Headcount, Forecast Volume, Actual Offered Volume, Actual Handled Volume',
  ],
  [''],
  ['Project Code & Billing Rate'],
  [
    'Project Code should align with the Rates sheet for automatic rate lookup. Billing Rate on the staffing row overrides the Rates sheet when populated.',
  ],
  [''],
  ['Production Hours'],
  [
    'Enter per-agent productive hours for the period (e.g. 157.5 for 21 days × 7.5 h). Values greater than 300 are treated as total team hours and divided by Active Production HC.',
  ],
  [''],
  ['Billing Type → revenue math'],
  [
    'FTE: Billing Rate = USD per FTE per month (~$2,000–3,000). Leakage prorates monthly rate by row days ÷ 21.',
  ],
  [
    'Production Hours: Billing Rate = USD per productive labor hour (~$15–25/hr). HC leakage = max(Req−Act,0)×hours/head×rate.',
  ],
  [
    'Transactional: Billing Rate = USD per completed transaction (~$3–5). HC & attrition leakage use throughput (Handled÷Active HC). Volume leakage = max(Forecast−Handled,0)×rate.',
  ],
  [''],
  ['Forecast Scenarios sheet'],
  ['Optional reference series for demand scenarios (Baseline / Stretch vs actuals). The in-app Forecast tab builds models from loaded staffing actuals.'],
  [''],
  ['Optional columns (Staffing Plan)'],
  [
    'Planned New Hire Class (Headcount), New Hire Employee Count, Training Count, Graduate Count — training pipeline. Team Lead Count, Operations Manager Count, Trainer Count, QA Count, WFM Support Count — support staffing (row-level counts).',
  ],
  [''],
  ['Shrinkage may be decimal (0.32) or percent (32). AHT is seconds in this template.'],
]

export function buildStaffingCapacitySampleWorkbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new()

  const staffingMatrix = [STAFFING_HEADERS, ...buildStaffingMatrix()]
  const staffing = XLSX.utils.aoa_to_sheet(staffingMatrix)
  const rates = XLSX.utils.aoa_to_sheet([RATES_HEADERS, ...RATES_SAMPLE()])
  const owners = XLSX.utils.aoa_to_sheet([OWNERS_HEADERS, ...OWNERS_SAMPLE()])
  const forecast = XLSX.utils.aoa_to_sheet(buildForecastScenarioSheet())
  const guide = XLSX.utils.aoa_to_sheet(USER_GUIDE_LINES)

  XLSX.utils.book_append_sheet(wb, staffing, 'Staffing Plan')
  XLSX.utils.book_append_sheet(wb, rates, 'Rates')
  XLSX.utils.book_append_sheet(wb, owners, 'Owners')
  XLSX.utils.book_append_sheet(wb, forecast, 'Forecast Scenarios')
  XLSX.utils.book_append_sheet(wb, guide, 'User Guide')

  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
}

export function staffingSampleFilename(): string {
  return 'workforce-capacity-sample-template.xlsx'
}

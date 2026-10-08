import * as XLSX from 'xlsx'
import { buildIdealFinancialFacts, IDEAL_SAMPLE_SHEET } from './idealFinancialSample'
import { buildIdealRatesMatrix, buildIdealStaffingPlanMatrix } from './idealStaffingSample'
import { buildSampleIntervalPatternRows } from '../planner/scheduling/sampleIntervalPattern'
import { RATES_HEADERS, STAFFING_HEADERS } from './staffingCapacity/sampleWorkbook'

export const APPLICATION_SAMPLE_FILENAME = 'Capacity_Platform_Sample_Data.xlsx'

const FORMAT_GUIDE: (string | number)[][] = [
  ['Capacity Planning Platform — data format reference'],
  [''],
  ['Financial_Sample'],
  [
    'Columns: FY, Month, Week Start (YYYY-MM-DD, Sunday), Project Code, Client, Location, Scenario, Revenue, GM, GM %, Salary & Benefits, Training Cost, People Cost, OPEX, Other Cost, Hours, Projected Revenue, Projected Cost.',
  ],
  ['Scenario must be Actuals or Projection. Upload this tab for the Financial Dashboard.'],
  [''],
  ['Staffing_Plan'],
  [
    'Week Start Date is the Sunday opening each Sun–Sat week. Required dimensions: FY, Month, Project Code, Client, LOB, Location. Include headcount, volume, shrinkage, attrition, AHT, and training-pipeline columns as in the sample rows.',
  ],
  [''],
  ['Rates'],
  [
    'Billing lookup by Client + LOB + Billing Type (FTE, Per Hour, Per Contact). Align Project Code with staffing rows when using automatic rate lookup.',
  ],
  [''],
  ['Shrinkage may be decimal (0.32) or percent (32). AHT is in seconds.'],
  [''],
  ['Interval_Pattern (Scheduling)'],
  [
    'Columns: Day, Interval, Value. Day = weekday name or YYYY-MM-DD. Interval = 30-minute time (08:00). Value = relative volume for pattern only — not FTE. See Interval_Pattern and Guide sheets.',
  ],
]

export function buildApplicationSampleWorkbook(): XLSX.WorkBook {
  const facts = buildIdealFinancialFacts()
  const financialAoa: (string | number)[][] = [
    [
      'FY',
      'Month',
      'Week Start',
      'Project Code',
      'Client',
      'Location',
      'Scenario',
      'Revenue',
      'GM',
      'GM %',
      'Salary & Benefits',
      'Training Cost',
      'People Cost',
      'OPEX',
      'Other Cost',
      'Hours',
      'Projected Revenue',
      'Projected Cost',
    ],
  ]
  for (const r of facts) {
    financialAoa.push([
      String(r.fy ?? ''),
      (r.month_bucket ?? '').slice(0, 7),
      r.week_start ?? '',
      r.project_code,
      r.client_name ?? '',
      r.location ?? '',
      r.scenario ?? '',
      r.metrics.commit_vs_actuals_revenue ?? 0,
      r.metrics.commit_vs_actuals_gm ?? 0,
      r.metrics.commit_vs_actuals_gm_pct ?? 0,
      r.metrics.commit_vs_actuals_salary_cost ?? 0,
      r.metrics.commit_vs_actuals_training_cost ?? 0,
      r.metrics.commit_vs_actuals_people_cost ?? 0,
      r.metrics.commit_vs_actuals_opex ?? 0,
      r.metrics.commit_vs_actuals_other_cost ?? 0,
      r.metrics.commit_vs_actuals_hours ?? 0,
      r.metrics.commit_vs_actuals_projected_revenue ?? 0,
      r.metrics.commit_vs_actuals_projected_cost ?? 0,
    ])
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(financialAoa), IDEAL_SAMPLE_SHEET)
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([STAFFING_HEADERS, ...buildIdealStaffingPlanMatrix()]),
    'Staffing_Plan',
  )
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([RATES_HEADERS, ...buildIdealRatesMatrix()]),
    'Rates',
  )
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildSampleIntervalPatternRows()), 'Interval_Pattern')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(FORMAT_GUIDE), 'Data_Format')

  return wb
}

export function downloadApplicationSampleData(): void {
  XLSX.writeFile(buildApplicationSampleWorkbook(), APPLICATION_SAMPLE_FILENAME)
}

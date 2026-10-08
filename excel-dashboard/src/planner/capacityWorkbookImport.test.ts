import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseCapacityPlanWorkbook, detectCapacityWorkbookKind } from './capacityWorkbookImport'
import { buildMatrixExportPayload, downloadCapacityMatrixExcel } from './capacityMatrixExport'

function workbookFromRows(sheetName: string, rows: Record<string, unknown>[]) {
  const sheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
  return workbook
}

describe('parseCapacityPlanWorkbook', () => {
  it('imports Planned_Required_FTE from Capacity_Plan sheet', () => {
    const workbook = workbookFromRows('Capacity_Plan', [
      { Week: '2026-08-09', Planned_Required_FTE: 12.5, Planned_Transfer_In_HC: 1 },
      { Week: '2026-08-16', Planned_Required_FTE: 14 },
    ])
    const result = parseCapacityPlanWorkbook(workbook, [], { acceptUnknownWeeks: true })
    expect(result.success).toBe(true)
    expect(result.plannedByWeek['2026-08-09']?.requiredFte).toBe(12.5)
    expect(result.plannedByWeek['2026-08-16']?.requiredFte).toBe(14)
    expect(result.plannedByWeek['2026-08-09']?.transferInHc).toBe(1)
  })

  it('imports volume, occupancy, support HC, and shrinkage from full workbook', () => {
    const workbook = workbookFromRows('Capacity_Plan', [
      {
        Week: '2026-09-06',
        Planned_Volume: 15000,
        Planned_AHT: 280,
        Planned_Occupancy: 0.88,
        Planned_Shrinkage_Pct: 0.22,
        Planned_Support_HC: 5,
        Planned_New_Hires: 3,
        Planned_Required_FTE: 41.25,
      },
    ])
    const result = parseCapacityPlanWorkbook(workbook, [], { acceptUnknownWeeks: true })
    expect(result.success).toBe(true)
    expect(result.plannedByWeek['2026-09-06']).toMatchObject({
      callVolume: 15000,
      ahtSeconds: 280,
      occupancy: 0.88,
      totalShrinkagePct: 0.22,
      supportHc: 5,
      plannedNewHires: 3,
      requiredFte: 41.25,
    })
  })

  it('imports occupancy entered as percent text', () => {
    const workbook = workbookFromRows('Capacity_Plan', [
      { Week: '2026-09-06', Planned_Occupancy: '85%', Planned_Shrinkage_Pct: '25%' },
    ])
    const result = parseCapacityPlanWorkbook(workbook, [], { acceptUnknownWeeks: true })
    expect(result.success).toBe(true)
    expect(result.plannedByWeek['2026-09-06']?.occupancy).toBe(0.85)
    expect(result.plannedByWeek['2026-09-06']?.totalShrinkagePct).toBe(0.25)
  })

  it('imports Metric Status labels Required Staffing / Production with blank Metric_Id', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Category', 'Metric Status', 'Metric_Id', '2026-03-22', '2026-03-29'],
      ['', 'Status', '', 'Actual', 'Actual'],
      ['1 - Staffing', 'Required Staffing', '', 100, 100],
      ['1 - Staffing', 'Production', '', 102, 102],
      ['1 - Staffing', 'FTE variance', '', 2, 2],
      ['1 - Staffing', 'Staffing (%)', '', 1.02, 1.02],
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Capacity_Matrix')
    const result = parseCapacityPlanWorkbook(workbook, [], { acceptUnknownWeeks: true })
    expect(result.success).toBe(true)
    expect(result.plannedByWeek['2026-03-22']?.requiredFte).toBe(100)
    expect(result.plannedByWeek['2026-03-22']?.productionFte).toBe(102)
    expect(result.plannedByWeek['2026-03-22']?.productionHc).toBe(102)
    expect(result.plannedByWeek['2026-03-29']?.requiredFte).toBe(100)
    expect(result.actualOverrides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          week: '2026-03-22',
          metrics: expect.objectContaining({ requiredFte: 100, productionFte: 102, productionHc: 102 }),
        }),
      ]),
    )
  })

  it('imports Required Production FTE from Capacity_Matrix sheet by label', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Category', 'Metric', '2026-08-09', '2026-08-16'],
      ['Staffing', 'Required Production FTE', 20, 22.5],
      ['Headcount', 'Planned transfer in', 0, 1],
      ['Pipeline', 'Planned new hire', 2, 3],
      ['Headcount', 'Planned support HC', 4, 5],
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Capacity_Matrix')
    const result = parseCapacityPlanWorkbook(workbook, [], { acceptUnknownWeeks: true })
    expect(result.success).toBe(true)
    expect(result.plannedByWeek['2026-08-09']?.requiredFte).toBe(20)
    expect(result.plannedByWeek['2026-08-16']?.requiredFte).toBe(22.5)
    expect(result.plannedByWeek['2026-08-16']?.transferInHc).toBe(1)
    expect(result.plannedByWeek['2026-08-09']?.plannedNewHires).toBe(2)
    expect(result.plannedByWeek['2026-08-16']?.supportHc).toBe(5)
  })

  it('prefers Metric_Id over display labels for accurate capture', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Category', 'Metric', 'Metric_Id', '2026-08-09', '2026-08-16'],
      ['Volume', 'Forecast volume', 'callVolume', 1111, 2222],
      ['AHT', 'Planned AHT', 'ahtSeconds', 300, 310],
      ['Occupancy', 'Planned occupancy', 'occupancy', 0.9, 0.91],
      ['Staffing', 'Required Production FTE', 'requiredFte', 18.5, 19.25],
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Capacity_Matrix')
    const result = parseCapacityPlanWorkbook(workbook, [], { acceptUnknownWeeks: true })
    expect(result.success).toBe(true)
    expect(result.plannedByWeek['2026-08-09']).toMatchObject({
      callVolume: 1111,
      ahtSeconds: 300,
      occupancy: 0.9,
      requiredFte: 18.5,
    })
    expect(result.plannedByWeek['2026-08-16']).toMatchObject({
      callVolume: 2222,
      ahtSeconds: 310,
      occupancy: 0.91,
      requiredFte: 19.25,
    })
  })

  it('imports shrinkage:<categoryId> Metric_Id rows into shrinkageById', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Category', 'Metric', 'Metric_Id', '2026-08-09', '2026-08-16'],
      ['Shrinkage', 'Absenteeism planned', 'shrinkage:absenteeism', 0.05, 0.06],
      ['Volume', 'Forecast volume', 'callVolume', 1000, 1100],
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Capacity_Matrix')
    const result = parseCapacityPlanWorkbook(workbook, [], { acceptUnknownWeeks: true })
    expect(result.success).toBe(true)
    expect(result.plannedByWeek['2026-08-09']?.shrinkageById?.absenteeism).toBe(0.05)
    expect(result.plannedByWeek['2026-08-16']?.shrinkageById?.absenteeism).toBe(0.06)
    expect(result.plannedByWeek['2026-08-09']?.callVolume).toBe(1000)
    expect(result.uploadedDriverMetricIds).toEqual(expect.arrayContaining(['callVolume', 'totalShrinkagePct', 'absenteeism']))
  })

  it('imports Planned_Shrinkage_<category> columns from full workbook', () => {
    const workbook = workbookFromRows('Capacity_Plan', [
      {
        Week: '2026-09-06',
        Planned_Volume: 5000,
        Planned_AHT: 300,
        Planned_Shrinkage_absenteeism: '8%',
        Planned_Training_Attrition_Pct: 0.1,
        Planned_Scheduled_Billable_Hours: 160,
        Planned_Seat_Count: 40,
      },
    ])
    const result = parseCapacityPlanWorkbook(workbook, [], { acceptUnknownWeeks: true })
    expect(result.success).toBe(true)
    expect(result.plannedByWeek['2026-09-06']).toMatchObject({
      callVolume: 5000,
      ahtSeconds: 300,
      trainingAttritionPct: 0.1,
      scheduledBillableHours: 160,
      seatCount: 40,
    })
    expect(result.plannedByWeek['2026-09-06']?.shrinkageById?.absenteeism).toBe(0.08)
    expect(result.uploadedDriverMetricIds).toEqual(expect.arrayContaining(['callVolume', 'ahtSeconds']))
  })

  it('round-trips matrix Excel download payload with Metric_Id', () => {
    const payload = buildMatrixExportPayload(
      'Demo_Client_Capacity',
      'weekly template',
      [
        { week: '2026-08-09', statusLabel: 'Planned' },
        { week: '2026-08-16', statusLabel: 'Planned' },
      ] as never,
      {
        staffing: {
          label: 'Staffing',
          metrics: [{ label: 'Required Production FTE', metricId: 'requiredFte', values: [18.5, 19.25] }],
        },
        volume: {
          label: 'Volume',
          metrics: [{ label: 'Forecast volume', metricId: 'callVolume', values: [9000, 9100] }],
        },
      },
    )

    const header = ['Category', 'Metric', 'Metric_Id', ...payload.weekLabels]
    const statusRow = ['', 'Status', '', ...payload.weekStatuses]
    const dataRows = payload.metrics.map((metric) => [
      metric.groupLabel,
      metric.label,
      metric.metricId ?? '',
      ...metric.values,
    ])
    const sheet = XLSX.utils.aoa_to_sheet([header, statusRow, ...dataRows])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Capacity_Matrix')

    const result = parseCapacityPlanWorkbook(workbook, [], { acceptUnknownWeeks: true })
    expect(result.success).toBe(true)
    expect(result.plannedByWeek['2026-08-09']?.requiredFte).toBe(18.5)
    expect(result.plannedByWeek['2026-08-16']?.requiredFte).toBe(19.25)
    expect(result.plannedByWeek['2026-08-09']?.callVolume).toBe(9000)
    expect(result.plannedByWeek['2026-08-16']?.callVolume).toBe(9100)
  })

  it('imports Excel serial week dates', () => {
    const parsed = XLSX.SSF.parse_date_code(45913)
    expect(parsed).toBeTruthy()
    const workbook = workbookFromRows('Capacity_Plan', [
      { Week: 45913, RequiredFTE: 9 },
    ])
    const result = parseCapacityPlanWorkbook(workbook, [], { acceptUnknownWeeks: true })
    expect(result.success).toBe(true)
    const week = Object.keys(result.plannedByWeek)[0]
    expect(week).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(result.plannedByWeek[week!]?.requiredFte).toBe(9)
  })
})

describe('detectCapacityWorkbookKind', () => {
  it('detects Capacity_Matrix workbooks for upload routing', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Category', 'Metric Status', 'Metric_Id', '2026-03-22'],
      ['1 - Staffing', 'Required Staffing', '', 100],
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Capacity_Matrix')
    expect(detectCapacityWorkbookKind(workbook)).toBe('matrix')
  })
})

describe('downloadCapacityMatrixExcel helper', () => {
  it('builds a Capacity_Matrix sheet name payload shape', () => {
    const payload = buildMatrixExportPayload('Title', 'Sub', [{ week: '2026-01-04', statusLabel: 'Actual' }] as never, {
      staffing: { label: 'Staffing', metrics: [{ label: 'Required Production FTE', metricId: 'requiredFte', values: [10] }] },
    })
    expect(payload.weekLabels).toEqual(['2026-01-04'])
    expect(payload.metrics[0]?.metricId).toBe('requiredFte')
    expect(typeof downloadCapacityMatrixExcel).toBe('function')
  })
})

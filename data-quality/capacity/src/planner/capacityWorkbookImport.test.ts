import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseCapacityPlanWorkbook } from './capacityWorkbookImport'

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

  it('imports Required Production FTE from Capacity_Matrix sheet', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Category', 'Metric', '2026-08-09', '2026-08-16'],
      ['Staffing', 'Required Production FTE', 20, 22.5],
      ['Headcount', 'Planned transfer in', 0, 1],
    ])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, sheet, 'Capacity_Matrix')
    const result = parseCapacityPlanWorkbook(workbook, [], { acceptUnknownWeeks: true })
    expect(result.success).toBe(true)
    expect(result.plannedByWeek['2026-08-09']?.requiredFte).toBe(20)
    expect(result.plannedByWeek['2026-08-16']?.requiredFte).toBe(22.5)
    expect(result.plannedByWeek['2026-08-16']?.transferInHc).toBe(1)
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

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  DBE_CLIENT_TEMPLATE_MARKER,
  downloadDbeClientTemplate,
  isDbeClientTemplateWorkbook,
  parseDbeClientTemplateWorkbook,
} from './dbeClientTemplate'
import { computeDbeMonth, listFiscalMonthKeys } from './dbePersistence'

describe('dbeClientTemplate', () => {
  it('marks downloaded workbooks so uploads can be recognised', () => {
    // downloadDbeClientTemplate writes to disk; build the same shape inline for the marker test.
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[DBE_CLIENT_TEMPLATE_MARKER], ['DBE']]),
      'Instructions',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        [
          'ClientName',
          'LobProjectName',
          'Location',
          'ProjectCode',
          'BillingType',
          'BillRateMethod',
          'AgentGroup',
          'AHT',
          'LoginHours',
          'AbsenteeismPct',
          'ShrinkagePct',
          'OccupancyPct',
          'HourlyBillRate',
          'MonthlyBillRate',
          'PerMinuteBillRate',
        ],
        ['Acme', 'Voice', 'Manila', 'PRJ-1', 'Prod hours', 'hourly', '', 400, 8, 5, 10, 85, 18, '', ''],
      ]),
      'Setup',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        [
          'ClientName',
          'LobProjectName',
          'Location',
          'Month',
          'Capacity',
          'FTE',
          'AHT',
          'LoginHours',
          'AbsenteeismPct',
          'ShrinkagePct',
          'OccupancyPct',
          'HourlyBillRate',
          'MonthlyBillRate',
          'PerMinuteBillRate',
          'DiscountOrLessToRevenue',
          'ExtraHours',
        ],
        ['Acme', 'Voice', 'Manila', '2026-04', 50000, '', '', '', '', '', '', '', '', '', '', ''],
      ]),
      'Monthly Capacity',
    )

    expect(isDbeClientTemplateWorkbook(wb)).toBe(true)
    const result = parseDbeClientTemplateWorkbook(wb, 2026)
    expect(result.success).toBe(true)
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]!.clientName).toBe('Acme')
    expect(result.lines[0]!.lobProjectName).toBe('Voice')
    expect(result.lines[0]!.location).toBe('Manila')
    expect(result.lines[0]!.defaults.aht).toBe(400)
    expect(result.lines[0]!.defaults.loginHours).toBe(8)
    expect(result.lines[0]!.months['2026-04']?.capacity).toBe(50000)
    expect(result.monthsFilled).toBe(1)

    const computed = computeDbeMonth(result.lines[0]!, '2026-04')
    expect(computed.capacity).toBe(50000)
    expect(computed.aht).toBe(400)
    expect(computed.loginHours).toBe(8)
    expect(computed.totalRevenue).toBeGreaterThan(0)
  })

  it('does not invent sample defaults when Setup driver cells are blank', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[DBE_CLIENT_TEMPLATE_MARKER]]),
      'Instructions',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['ClientName', 'LobProjectName', 'Location'],
        ['BlankCo', 'Chat', 'Cebu'],
      ]),
      'Setup',
    )
    const result = parseDbeClientTemplateWorkbook(wb, 2026)
    expect(result.lines).toHaveLength(1)
    expect(result.lines[0]!.defaults.aht).toBe(0)
    expect(result.lines[0]!.defaults.hourlyBillRate).toBe(0)
    expect(Object.keys(result.lines[0]!.months)).toHaveLength(0)
  })

  it('lists fiscal months Apr–Mar for the template year', () => {
    expect(listFiscalMonthKeys(2026)[0]).toBe('2026-04')
    expect(listFiscalMonthKeys(2026).at(-1)).toBe('2027-03')
    expect(typeof downloadDbeClientTemplate).toBe('function')
  })
})

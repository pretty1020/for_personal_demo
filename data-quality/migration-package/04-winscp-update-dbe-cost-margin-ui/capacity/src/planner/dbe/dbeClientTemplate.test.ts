import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  DBE_CLIENT_TEMPLATE_MARKER,
  downloadDbeClientTemplate,
  isDbeClientTemplateWorkbook,
  parseDbeClientTemplateWorkbook,
} from './dbeClientTemplate'
import {
  computeDbeMonth,
  createDbeLine,
  DEFAULT_DBE_COST_ITEMS,
  listFiscalMonthKeys,
  mergeDbeTemplateImport,
  stripUnusedSampleCostItems,
  visibleCostItemsForDisplay,
} from './dbePersistence'

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
          'ProjectCode',
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
        ['Acme', 'Voice', 'Manila', 'PRJ-1', '2026-04', 50000, '', '', '', '', '', '', '', '', '', '', ''],
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

  it('imports Costs & Breakdown into LOB cost items', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[DBE_CLIENT_TEMPLATE_MARKER]]),
      'Instructions',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['ClientName', 'LobProjectName', 'Location', 'ProjectCode', 'BillingType', 'BillRateMethod', 'HourlyBillRate'],
        ['Acme', 'Voice', 'Manila', 'PRJ-1', 'Prod hours', 'hourly', 20],
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
          'ProjectCode',
          'CostItem',
          'BreakdownItem',
          'Mode',
          'DefaultValue',
          '2026-04',
        ],
        ['Acme', 'Voice', 'Manila', 'PRJ-1', 'People Cost', 'Salaries', 'amount', 1000, 1500],
        ['Acme', 'Voice', 'Manila', 'PRJ-1', 'OPEX', 'Travel Expenses', 'amount', 200, 250],
        ['Acme', 'Voice', 'Manila', 'PRJ-1', 'Custom Cost', '', 'amount', 50, 75],
      ]),
      'Costs',
    )

    const result = parseDbeClientTemplateWorkbook(wb, 2026)
    expect(result.success).toBe(true)
    const line = result.lines[0]!
    const people = line.costItems.find((item) => item.label === 'People Cost')
    const salaries = people?.breakdown.find((sub) => sub.label === 'Salaries')
    expect(salaries?.defaultValue).toBe(1000)
    expect(salaries?.months['2026-04']).toBe(1500)

    const opex = line.costItems.find((item) => item.label === 'OPEX')
    const travel = opex?.breakdown.find((sub) => sub.label === 'Travel Expenses')
    expect(travel?.defaultValue).toBe(200)
    expect(travel?.months['2026-04']).toBe(250)

    const custom = line.costItems.find((item) => item.label === 'Custom Cost')
    expect(custom?.defaultValue).toBe(50)
    expect(custom?.months['2026-04']).toBe(75)
    expect(custom?.breakdown).toHaveLength(0)

    const april = computeDbeMonth(line, '2026-04')
    expect(april.costByItem[people!.id]).toBe(1500)
    expect(april.totalCost).toBe(1500 + 250 + 75)
  })

  it('ignores blank Costs sample rows and does not invent fallback costs', () => {
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
        ['Solo', 'Chat', 'Cebu'],
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
          'ProjectCode',
          'CostItem',
          'BreakdownItem',
          'Mode',
          'DefaultValue',
          '2026-04',
        ],
        ['', '', '', '', 'People Cost', 'Salaries', 'amount', '', 4321.5],
      ]),
      'Costs',
    )

    const result = parseDbeClientTemplateWorkbook(wb, 2026)
    expect(result.errors).toHaveLength(0)
    expect(result.costIdentityKeys).toHaveLength(0)
    expect(result.lines[0]!.costItems).toHaveLength(0)
  })

  it('does not seed sample People Cost / OPEX when Costs sheet has no rows for the client', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[DBE_CLIENT_TEMPLATE_MARKER]]),
      'Instructions',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['ClientName', 'LobProjectName', 'Location', 'ProjectCode'],
        ['Acme', 'Voice', 'Manila', 'PRJ-1'],
      ]),
      'Setup',
    )

    const result = parseDbeClientTemplateWorkbook(wb, 2026)
    expect(result.lines[0]!.costItems).toEqual([])
    expect(result.costIdentityKeys).toEqual([])
  })

  it('applies Costs only to the exact Client, LOB, Location, and Project Code', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[DBE_CLIENT_TEMPLATE_MARKER]]),
      'Instructions',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['ClientName', 'LobProjectName', 'Location', 'ProjectCode'],
        ['Acme', 'Voice', 'Manila', 'PRJ-1'],
        ['Acme', 'Voice', 'Manila', 'PRJ-2'],
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
          'ProjectCode',
          'CostItem',
          'BreakdownItem',
          'Mode',
          '2026-04',
        ],
        ['Acme', 'Voice', 'Manila', 'PRJ-1', 'People Cost', 'Salaries', 'amount', 999],
      ]),
      'Costs',
    )

    const result = parseDbeClientTemplateWorkbook(wb, 2026)
    const prj1 = result.lines.find((line) => line.projectCode === 'PRJ-1')!
    const prj2 = result.lines.find((line) => line.projectCode === 'PRJ-2')!
    expect(prj1.costItems).toHaveLength(1)
    expect(prj1.costItems[0]!.breakdown[0]!.months['2026-04']).toBe(999)
    expect(prj2.costItems).toHaveLength(0)
    expect(result.costIdentityKeys).toHaveLength(1)
  })

  it('keeps separate LOB lines when Project Code differs', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[DBE_CLIENT_TEMPLATE_MARKER]]),
      'Instructions',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['ClientName', 'LobProjectName', 'Location', 'ProjectCode'],
        ['Acme', 'Voice', 'Manila', 'PRJ-1'],
        ['Acme', 'Voice', 'Manila', 'PRJ-2'],
      ]),
      'Setup',
    )

    const result = parseDbeClientTemplateWorkbook(wb, 2026)
    expect(result.lines).toHaveLength(2)
    expect(result.lines.map((line) => line.projectCode).sort()).toEqual(['PRJ-1', 'PRJ-2'])
  })

  it('merge preserves unrelated clients and overwrites only uploaded months', () => {
    const existingA = createDbeLine({
      clientName: 'KeepCo',
      lobProjectName: 'Chat',
      location: 'Cebu',
      projectCode: 'K-1',
      billingType: 'Prod hours',
      agentGroup: '',
      billRateMethod: 'hourly',
      defaults: { aht: 300, loginHours: 8, absenteeismPct: 0, shrinkagePct: 0, occupancyPct: 85, hourlyBillRate: 10, monthlyBillRate: 0, perMinuteBillRate: 0 },
      useStaffingAbsenteeismShrinkage: false,
      months: { '2026-04': { capacity: 1000, fte: null, aht: null, loginHours: null, absenteeismPct: null, shrinkagePct: null, occupancyPct: null, hourlyBillRate: null, monthlyBillRate: null, perMinuteBillRate: null, discountOrLessToRevenue: null, extraHours: null } },
      revenueAdjustments: [],
      costItems: [],
      rowRemarks: {},
    })
    const existingB = createDbeLine({
      clientName: 'Acme',
      lobProjectName: 'Voice',
      location: 'Manila',
      projectCode: 'PRJ-1',
      billingType: 'Prod hours',
      agentGroup: '',
      billRateMethod: 'hourly',
      defaults: { aht: 400, loginHours: 8, absenteeismPct: 0, shrinkagePct: 0, occupancyPct: 85, hourlyBillRate: 18, monthlyBillRate: 0, perMinuteBillRate: 0 },
      useStaffingAbsenteeismShrinkage: false,
      months: {
        '2026-04': { capacity: 100, fte: null, aht: null, loginHours: null, absenteeismPct: null, shrinkagePct: null, occupancyPct: null, hourlyBillRate: null, monthlyBillRate: null, perMinuteBillRate: null, discountOrLessToRevenue: null, extraHours: null },
        '2026-05': { capacity: 200, fte: null, aht: null, loginHours: null, absenteeismPct: null, shrinkagePct: null, occupancyPct: null, hourlyBillRate: null, monthlyBillRate: null, perMinuteBillRate: null, discountOrLessToRevenue: null, extraHours: null },
      },
      revenueAdjustments: [],
      costItems: [],
      rowRemarks: {},
    })

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[DBE_CLIENT_TEMPLATE_MARKER]]),
      'Instructions',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['ClientName', 'LobProjectName', 'Location', 'ProjectCode'],
        ['Acme', 'Voice', 'Manila', 'PRJ-1'],
      ]),
      'Setup',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['ClientName', 'LobProjectName', 'Location', 'ProjectCode', 'Month', 'Capacity'],
        ['Acme', 'Voice', 'Manila', 'PRJ-1', '2026-04', 99999],
      ]),
      'Monthly Capacity',
    )
    const imported = parseDbeClientTemplateWorkbook(wb, 2026)
    const merged = mergeDbeTemplateImport([existingA, existingB], imported.lines, {
      setupIdentityKeys: new Set(imported.setupIdentityKeys),
      costIdentityKeys: new Set(imported.costIdentityKeys),
    })

    expect(merged.unchangedCount).toBe(1)
    expect(merged.updatedCount).toBe(1)
    expect(merged.lines).toHaveLength(2)
    const keepCo = merged.lines.find((line) => line.clientName === 'KeepCo')
    const acme = merged.lines.find((line) => line.clientName === 'Acme')
    expect(keepCo?.months['2026-04']?.capacity).toBe(1000)
    expect(acme?.months['2026-04']?.capacity).toBe(99999)
    expect(acme?.months['2026-05']?.capacity).toBe(200)
    expect(acme?.costItems).toHaveLength(0)
  })

  it('merge leaves existing costs alone when upload has no Costs rows for that identity', () => {
    const existing = createDbeLine({
      clientName: 'Acme',
      lobProjectName: 'Voice',
      location: 'Manila',
      projectCode: 'PRJ-1',
      billingType: 'Prod hours',
      agentGroup: '',
      billRateMethod: 'hourly',
      defaults: {
        aht: 400,
        loginHours: 8,
        absenteeismPct: 0,
        shrinkagePct: 0,
        occupancyPct: 85,
        hourlyBillRate: 18,
        monthlyBillRate: 0,
        perMinuteBillRate: 0,
      },
      useStaffingAbsenteeismShrinkage: false,
      months: {
        '2026-04': {
          capacity: 100,
          fte: null,
          aht: null,
          loginHours: null,
          absenteeismPct: null,
          shrinkagePct: null,
          occupancyPct: null,
          hourlyBillRate: null,
          monthlyBillRate: null,
          perMinuteBillRate: null,
          discountOrLessToRevenue: null,
          extraHours: null,
        },
      },
      revenueAdjustments: [],
      costItems: [
        {
          id: 'cost-keep',
          label: 'People Cost',
          mode: 'amount',
          defaultValue: 0,
          months: {},
          breakdown: [
            { id: 'bd-keep', label: 'Salaries', defaultValue: 0, months: { '2026-04': 5000 } },
          ],
        },
      ],
      rowRemarks: {},
    })

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([[DBE_CLIENT_TEMPLATE_MARKER]]),
      'Instructions',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['ClientName', 'LobProjectName', 'Location', 'ProjectCode', 'Month', 'Capacity'],
        ['Acme', 'Voice', 'Manila', 'PRJ-1', '2026-04', 111],
      ]),
      'Monthly Capacity',
    )
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([['ClientName', 'LobProjectName', 'Location']]),
      'Setup',
    )

    const imported = parseDbeClientTemplateWorkbook(wb, 2026)
    const merged = mergeDbeTemplateImport([existing], imported.lines, {
      setupIdentityKeys: new Set(imported.setupIdentityKeys),
      costIdentityKeys: new Set(imported.costIdentityKeys),
    })
    const line = merged.lines[0]!
    expect(line.months['2026-04']?.capacity).toBe(111)
    expect(line.costItems[0]?.breakdown[0]?.months['2026-04']).toBe(5000)
  })

  it('strips unused sample People Cost / OPEX scaffolding with no values', () => {
    const stripped = stripUnusedSampleCostItems(
      DEFAULT_DBE_COST_ITEMS.map((item) => ({
        ...item,
        months: { ...item.months },
        breakdown: item.breakdown.map((sub) => ({ ...sub, months: { ...sub.months } })),
      })),
    )
    expect(stripped).toEqual([])
  })

  it('keeps only cost breakdown rows that have real month or default values', () => {
    const items = [
      {
        id: 'cost-people',
        label: 'People Cost',
        mode: 'amount' as const,
        defaultValue: 0,
        months: {},
        breakdown: [
          { id: 'cost-bd-salaries', label: 'Salaries', defaultValue: 0, months: { '2026-04': 1200 } },
          { id: 'cost-bd-transportation', label: 'Transportation Cost', defaultValue: 0, months: {} },
        ],
      },
    ]
    const visible = visibleCostItemsForDisplay(items)
    expect(visible).toHaveLength(1)
    expect(visible[0]!.breakdown).toHaveLength(1)
    expect(visible[0]!.breakdown[0]!.label).toBe('Salaries')
  })
})


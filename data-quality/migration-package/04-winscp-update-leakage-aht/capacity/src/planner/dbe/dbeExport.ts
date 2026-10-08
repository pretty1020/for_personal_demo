import * as XLSX from 'xlsx'
import { triggerDownloadCsv } from '../../utils/exportCsv'
import { LEAKAGE_DRIVERS, type LeakagePortfolioSummary } from './staffingDbeLeakage'
import {
  computeDbeMonth,
  DBE_METRIC_ROWS,
  dbeRemarkKey,
  formatFiscalMonthLabel,
  getDbeRowRemark,
  isFteBillingPlan,
  type DbeComputeOptions,
  type DbeLobLine,
  type DbeMetricRowId,
} from './dbePersistence'

function metricValue(
  line: DbeLobLine,
  month: string,
  rowId: DbeMetricRowId,
  options?: DbeComputeOptions,
): number | string {
  const computed = computeDbeMonth(line, month, options)
  if (rowId === 'productiveHours') return computed.productiveHours
  if (rowId === 'productiveHoursPostOcc') return computed.productiveHoursPostOcc
  if (rowId === 'totalRevenue') return computed.totalRevenue
  const input = line.months[month]
  const map: Partial<Record<DbeMetricRowId, number | null | undefined>> = {
    capacity: input?.capacity ?? computed.capacity,
    fte: input?.fte ?? computed.fte,
    aht: input?.aht ?? computed.aht,
    loginHours: input?.loginHours ?? computed.loginHours,
    absenteeismPct: computed.absenteeismPct,
    shrinkagePct: computed.shrinkagePct,
    occupancyPct: input?.occupancyPct ?? computed.occupancyPct,
    extraHours: input?.extraHours ?? computed.extraHours,
    hourlyBillRate: input?.hourlyBillRate ?? computed.hourlyBillRate,
    monthlyBillRate: input?.monthlyBillRate ?? computed.monthlyBillRate,
    perMinuteBillRate: input?.perMinuteBillRate ?? computed.perMinuteBillRate,
    discountOrLessToRevenue: input?.discountOrLessToRevenue ?? computed.discountOrLessToRevenue,
  }
  return map[rowId] ?? ''
}

function visibleMetricRows(line: DbeLobLine) {
  return DBE_METRIC_ROWS.filter((row) => {
    if (row.id === 'totalRevenue') return false
    if (row.id === 'fte') return isFteBillingPlan(line.billingType)
    if (row.id === 'hourlyBillRate') return line.billRateMethod === 'hourly'
    if (row.id === 'monthlyBillRate') return line.billRateMethod === 'monthly'
    if (row.id === 'perMinuteBillRate') return line.billRateMethod === 'per_minute'
    return true
  })
}

export function downloadDbeWorkbook(
  lines: DbeLobLine[],
  months: string[],
  title: string,
  resolveOptions?: (line: DbeLobLine, month: string) => DbeComputeOptions | undefined,
): void {
  const workbook = XLSX.utils.book_new()
  const summaryHeader = ['Metric', ...months.map(formatFiscalMonthLabel), 'Remarks']
  const summaryRows: (string | number)[][] = [summaryHeader]

  for (const line of lines) {
    const sheetRows: (string | number)[][] = [
      ['Client', line.clientName],
      ['LOB / Project', line.lobProjectName],
      ['Location', line.location],
      ['Project Code', line.projectCode],
      [],
      summaryHeader,
    ]
    for (const row of visibleMetricRows(line)) {
      sheetRows.push([
        row.label,
        ...months.map((month) => metricValue(line, month, row.id, resolveOptions?.(line, month)) as number),
        getDbeRowRemark(line, dbeRemarkKey('metric', row.id)),
      ])
    }
    for (const adjustment of line.revenueAdjustments) {
      sheetRows.push([
        `${adjustment.label} (${adjustment.effect === 'deduct' ? '−' : '+'} ${adjustment.mode === 'percent' ? '%' : '$'})`,
        ...months.map((month) => {
          const computed = computeDbeMonth(line, month, resolveOptions?.(line, month))
          return computed.revenueAdjustmentsApplied[adjustment.id] ?? 0
        }),
        getDbeRowRemark(line, dbeRemarkKey('rev', adjustment.id)),
      ])
    }
    sheetRows.push([
      'Total Revenue',
      ...months.map((month) => computeDbeMonth(line, month, resolveOptions?.(line, month)).totalRevenue),
      getDbeRowRemark(line, dbeRemarkKey('total-revenue')),
    ])
    sheetRows.push([
      'Total Cost',
      ...months.map((month) => computeDbeMonth(line, month, resolveOptions?.(line, month)).totalCost),
      getDbeRowRemark(line, dbeRemarkKey('total-cost')),
    ])
    for (const item of line.costItems) {
      sheetRows.push([
        item.label,
        ...months.map((month) => computeDbeMonth(line, month, resolveOptions?.(line, month)).costByItem[item.id] ?? 0),
        getDbeRowRemark(line, dbeRemarkKey('cost', item.id)),
      ])
      for (const sub of item.breakdown) {
        sheetRows.push([
          `  ${sub.label}`,
          ...months.map(
            (month) =>
              computeDbeMonth(line, month, resolveOptions?.(line, month)).costBreakdownByItem[item.id]?.[sub.id] ?? 0,
          ),
          getDbeRowRemark(line, dbeRemarkKey('cost-bd', sub.id)),
        ])
      }
    }
    sheetRows.push([
      'GM',
      ...months.map((month) => computeDbeMonth(line, month, resolveOptions?.(line, month)).gm),
      getDbeRowRemark(line, dbeRemarkKey('gm')),
    ])
    sheetRows.push([
      'GM %',
      ...months.map((month) => computeDbeMonth(line, month, resolveOptions?.(line, month)).gmPct),
      getDbeRowRemark(line, dbeRemarkKey('gm-pct')),
    ])

    const safeName = `${line.clientName}_${line.lobProjectName}`.replace(/[^\w.-]+/g, '_').slice(0, 28)
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheetRows), safeName || 'LOB')
  }

  if (lines.length) {
    summaryRows.push(
      [
        'Total Revenue',
        ...months.map((month) =>
          lines.reduce(
            (sum, line) => sum + computeDbeMonth(line, month, resolveOptions?.(line, month)).totalRevenue,
            0,
          ),
        ),
        '',
      ],
      [
        'Total Cost',
        ...months.map((month) =>
          lines.reduce(
            (sum, line) => sum + computeDbeMonth(line, month, resolveOptions?.(line, month)).totalCost,
            0,
          ),
        ),
        '',
      ],
      [
        'GM',
        ...months.map((month) =>
          lines.reduce((sum, line) => sum + computeDbeMonth(line, month, resolveOptions?.(line, month)).gm, 0),
        ),
        '',
      ],
    )
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary')
  }

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      { Field: 'Title', Value: title },
      { Field: 'Exported', Value: new Date().toISOString() },
      { Field: 'Lines', Value: lines.length },
      { Field: 'Months', Value: months.length },
    ]),
    'Export_Info',
  )

  XLSX.writeFile(workbook, `${title.replace(/[^\w.-]+/g, '_')}_dbe.xlsx`)
}

export function downloadDbeCsv(
  lines: DbeLobLine[],
  months: string[],
  title: string,
  resolveOptions?: (line: DbeLobLine, month: string) => DbeComputeOptions | undefined,
): void {
  const header = [
    'Client',
    'LOB',
    'Location',
    'Project Code',
    'Metric',
    ...months.map(formatFiscalMonthLabel),
    'Remarks',
  ]
  const rows = [header.join(',')]
  for (const line of lines) {
    for (const row of visibleMetricRows(line)) {
      const values = months.map((month) => metricValue(line, month, row.id, resolveOptions?.(line, month)))
      rows.push(
        [
          line.clientName,
          line.lobProjectName,
          line.location,
          line.projectCode,
          row.label,
          ...values,
          getDbeRowRemark(line, dbeRemarkKey('metric', row.id)),
        ]
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(','),
      )
    }
    for (const adjustment of line.revenueAdjustments) {
      rows.push(
        [
          line.clientName,
          line.lobProjectName,
          line.location,
          line.projectCode,
          adjustment.label,
          ...months.map((month) => {
            const computed = computeDbeMonth(line, month, resolveOptions?.(line, month))
            return computed.revenueAdjustmentsApplied[adjustment.id] ?? 0
          }),
          getDbeRowRemark(line, dbeRemarkKey('rev', adjustment.id)),
        ]
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(','),
      )
    }
    rows.push(
      [
        line.clientName,
        line.lobProjectName,
        line.location,
        line.projectCode,
        'Total Revenue',
        ...months.map((month) => computeDbeMonth(line, month, resolveOptions?.(line, month)).totalRevenue),
        getDbeRowRemark(line, dbeRemarkKey('total-revenue')),
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(','),
    )
    rows.push(
      [
        line.clientName,
        line.lobProjectName,
        line.location,
        line.projectCode,
        'GM',
        ...months.map((month) => computeDbeMonth(line, month, resolveOptions?.(line, month)).gm),
        getDbeRowRemark(line, dbeRemarkKey('gm')),
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(','),
    )
  }
  triggerDownloadCsv(rows.join('\r\n'), `${title.replace(/[^\w.-]+/g, '_')}_dbe`)
}

export function downloadLeakageWorkbook(portfolio: LeakagePortfolioSummary, title: string): void {
  const workbook = XLSX.utils.book_new()

  const pairHeader = [
    'Client',
    'Location',
    'Project Code',
    'LOB',
    ...LEAKAGE_DRIVERS.map((driver) => driver.short),
    'Total',
  ]
  const pairRows = portfolio.pairs.map((pair) => {
    const values = LEAKAGE_DRIVERS.map((driver) =>
      pair.months.reduce((sum, m) => sum + m.drivers[driver.id], 0),
    )
    return [
      pair.clientName,
      pair.location,
      pair.projectCode,
      pair.lobName,
      ...values,
      values.reduce((sum, value) => sum + value, 0),
    ]
  })
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([pairHeader, ...pairRows]), 'Pairs')

  const monthHeader = [
    'Month',
    'DBE Revenue',
    'Staffing FTE',
    'Required FTE',
    ...LEAKAGE_DRIVERS.map((driver) => driver.short),
    'AHT Hours Lost',
    'Total Leakage',
  ]
  const monthRows = portfolio.byMonth.map((row) => [
    row.monthLabel,
    row.dbeRevenue,
    row.staffingFte,
    row.requiredFte,
    ...LEAKAGE_DRIVERS.map((driver) => row[driver.id]),
    row.ahtLeakHours,
    row.totalLeakage,
  ])
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([monthHeader, ...monthRows]), 'By_Month')

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([
      { Metric: 'Total leakage', Value: portfolio.totals.totalLeakage },
      ...LEAKAGE_DRIVERS.map((driver) => ({
        Metric: driver.short,
        Value: portfolio.totals[driver.id],
      })),
      { Metric: 'AHT hours lost', Value: portfolio.totals.ahtLeakHours },
      { Metric: 'DBE revenue', Value: portfolio.totals.dbeRevenue },
    ]),
    'Totals',
  )

  XLSX.writeFile(workbook, `${title.replace(/[^\w.-]+/g, '_')}_leakage.xlsx`)
}

export function downloadLeakageCsv(portfolio: LeakagePortfolioSummary, title: string): void {
  const header = [
    'Client',
    'Location',
    'Project Code',
    'LOB',
    ...LEAKAGE_DRIVERS.map((driver) => driver.short),
    'Total',
  ]
  const lines = [header.join(',')]
  for (const pair of portfolio.pairs) {
    const values = LEAKAGE_DRIVERS.map((driver) =>
      pair.months.reduce((sum, m) => sum + m.drivers[driver.id], 0),
    )
    lines.push(
      [
        pair.clientName,
        pair.location,
        pair.projectCode,
        pair.lobName,
        ...values,
        values.reduce((sum, value) => sum + value, 0),
      ]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(','),
    )
  }
  triggerDownloadCsv(lines.join('\r\n'), `${title.replace(/[^\w.-]+/g, '_')}_leakage`)
}

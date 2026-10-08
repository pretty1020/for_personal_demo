import * as XLSX from 'xlsx'
import {
  createCostItem,
  createDbeLine,
  DEFAULT_DBE_COST_ITEMS,
  emptyMonthInput,
  formatFiscalMonthLabel,
  listFiscalMonthKeys,
  type DbeBillRateMethod,
  type DbeLobDefaults,
  type DbeLobLine,
  type DbeMonthInput,
} from './dbePersistence'
import { isFteBillingPlan } from '../../utils/staffingCapacity/billingModel'

/** Marker written into the Instructions sheet so uploads can be recognised. */
export const DBE_CLIENT_TEMPLATE_MARKER = 'DBE_CLIENT_TEMPLATE_V1'

export type DbeClientTemplateImportResult = {
  success: boolean
  lines: DbeLobLine[]
  clientsCreated: number
  monthsFilled: number
  skippedRows: number
  errors: string[]
  warnings: string[]
  message: string
}

const SETUP_HEADERS = [
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
] as const

const MONTH_HEADERS = [
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
] as const

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function cellString(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || trimmed === '—' || trimmed === '-' || trimmed === '–' || trimmed.toLowerCase() === 'n/a') {
      return null
    }
    const cleaned = trimmed.replace(/,/g, '').replace(/%$/, '')
    const parsed = Number(cleaned)
    return Number.isFinite(parsed) ? parsed : null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseBillRateMethod(raw: string): DbeBillRateMethod {
  const key = normalizeHeader(raw)
  if (key.includes('month')) return 'monthly'
  if (key.includes('minute') || key.includes('perminute')) return 'per_minute'
  if (raw === 'monthly' || raw === 'per_minute' || raw === 'hourly') return raw
  return 'hourly'
}

function lineKey(client: string, lob: string, location: string): string {
  return `${client.toLowerCase()}::${lob.toLowerCase()}::${location.toLowerCase()}`
}

function cloneDefaultCostItems() {
  return DEFAULT_DBE_COST_ITEMS.map((item) =>
    createCostItem({
      label: item.label,
      mode: item.mode,
      defaultValue: item.defaultValue,
      months: {},
      breakdown: [],
    }),
  )
}

function emptyDefaults(): DbeLobDefaults {
  return {
    aht: 0,
    loginHours: 0,
    absenteeismPct: 0,
    shrinkagePct: 0,
    occupancyPct: 0,
    hourlyBillRate: 0,
    monthlyBillRate: 0,
    perMinuteBillRate: 0,
  }
}

function sheetToObjects(sheet: XLSX.WorkSheet): Record<string, unknown>[] {
  const rows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(sheet, {
    header: 1,
    defval: '',
    raw: true,
  })
  if (!rows.length) return []
  const headers = (rows[0] ?? []).map((cell) => normalizeHeader(String(cell ?? '')))
  const objects: Record<string, unknown>[] = []
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i] ?? []
    const obj: Record<string, unknown> = {}
    let any = false
    headers.forEach((header, index) => {
      if (!header) return
      const value = row[index]
      if (value != null && String(value).trim() !== '') any = true
      obj[header] = value
    })
    if (any) objects.push(obj)
  }
  return objects
}

function pick(obj: Record<string, unknown>, ...aliases: string[]): unknown {
  for (const alias of aliases) {
    const key = normalizeHeader(alias)
    if (key in obj) return obj[key]
  }
  return undefined
}

function monthKeyFromCell(value: unknown, fiscalMonths: string[]): string | null {
  const raw = cellString(value)
  if (!raw) return null
  // Already YYYY-MM
  if (/^\d{4}-\d{2}$/.test(raw)) return raw
  // Excel serial date
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value)
    if (parsed) {
      return `${parsed.y}-${String(parsed.m).padStart(2, '0')}`
    }
  }
  // Match fiscal month labels (Apr, May, …)
  const label = raw.toLowerCase()
  for (const month of fiscalMonths) {
    if (formatFiscalMonthLabel(month).toLowerCase() === label) return month
    if (month.toLowerCase() === label) return month
  }
  // Apr-26 / Apr 2026
  const match = raw.match(/^([A-Za-z]{3})[\s\-_/]?(\d{2,4})$/)
  if (match) {
    const mon = match[1]!.toLowerCase()
    let year = Number(match[2]!.length === 2 ? `20${match[2]}` : match[2])
    const monthIndex = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(
      mon,
    )
    if (monthIndex >= 0) {
      // Fiscal Apr–Mar: Jan–Mar belong to fiscalStartYear+1 already encoded in year when user writes Apr-26
      return `${year}-${String(monthIndex + 1).padStart(2, '0')}`
    }
  }
  return null
}

/**
 * Download a blank DBE Add Client workbook for the given fiscal year (Apr–Mar).
 * Users fill Setup + Monthly Capacity, then upload back into the DBE page.
 */
export function downloadDbeClientTemplate(fiscalStartYear: number): void {
  const months = listFiscalMonthKeys(fiscalStartYear)
  const workbook = XLSX.utils.book_new()

  const instructions: (string | number)[][] = [
    [DBE_CLIENT_TEMPLATE_MARKER],
    ['DBE — Add New Client template'],
    [''],
    ['1. Fill the Setup sheet: one row per Client + LOB + Location.'],
    ['2. Fill Monthly Capacity: Capacity (or FTE for FTE billing) and optional driver overrides per month.'],
    ['3. Month column accepts YYYY-MM (e.g. 2026-04) or the short label (Apr).'],
    ['4. Leave unused month cells blank — blank does not invent sample data.'],
    ['5. Upload this file from Add Client, Location & LOB on the DBE page.'],
    [''],
    ['BillRateMethod: hourly | monthly | per_minute'],
    ['BillingType examples: Prod hours | FTE | Per Transaction'],
    [`Fiscal months included: ${months.join(', ')}`],
  ]
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(instructions), 'Instructions')

  const setupRows: (string | number)[][] = [
    [...SETUP_HEADERS],
    [
      '', // ClientName
      '', // LobProjectName
      '', // Location
      '', // ProjectCode
      'Prod hours',
      'hourly',
      '',
      '', // AHT
      '', // LoginHours
      '', // Absenteeism
      '', // Shrinkage
      '', // Occupancy
      '', // Hourly
      '', // Monthly
      '', // Per minute
    ],
  ]
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(setupRows), 'Setup')

  const monthRows: (string | number)[][] = [[...MONTH_HEADERS]]
  for (const month of months) {
    monthRows.push([
      '', // ClientName — fill to match Setup
      '', // LobProjectName
      '', // Location
      month,
      '', // Capacity
      '', // FTE
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ])
  }
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(monthRows), 'Monthly Capacity')

  const fileName = `DBE_Add_Client_Template_FY${fiscalStartYear}-${String(fiscalStartYear + 1).slice(2)}.xlsx`
  XLSX.writeFile(workbook, fileName)
}

export function isDbeClientTemplateWorkbook(workbook: XLSX.WorkBook): boolean {
  const instructions = workbook.Sheets.Instructions
  if (!instructions) return false
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(instructions, { header: 1, defval: '' })
  return rows.some((row) => row.some((cell) => String(cell).includes(DBE_CLIENT_TEMPLATE_MARKER)))
}

/**
 * Parse an uploaded DBE client template into new LOB lines ready to persist.
 * Matching Setup + Monthly Capacity rows by Client + LOB + Location.
 */
export function parseDbeClientTemplateWorkbook(
  workbook: XLSX.WorkBook,
  fiscalStartYear: number,
): DbeClientTemplateImportResult {
  const errors: string[] = []
  const warnings: string[] = []
  const fiscalMonths = listFiscalMonthKeys(fiscalStartYear)

  if (!workbook.Sheets.Setup) {
    return {
      success: false,
      lines: [],
      clientsCreated: 0,
      monthsFilled: 0,
      skippedRows: 0,
      errors: ['Missing Setup sheet. Download the DBE Add Client template and try again.'],
      warnings: [],
      message: 'Upload failed.',
    }
  }

  const setupRows = sheetToObjects(workbook.Sheets.Setup)
  const monthSheet = workbook.Sheets['Monthly Capacity'] ?? workbook.Sheets.Months ?? workbook.Sheets.Monthly
  const monthRows = monthSheet ? sheetToObjects(monthSheet) : []

  if (!isDbeClientTemplateWorkbook(workbook)) {
    warnings.push('Workbook marker not found — parsing Setup / Monthly Capacity sheets anyway.')
  }

  type Draft = {
    clientName: string
    lobProjectName: string
    location: string
    projectCode: string
    billingType: string
    billRateMethod: DbeBillRateMethod
    agentGroup: string
    defaults: DbeLobDefaults
    months: Record<string, DbeMonthInput>
  }

  const drafts = new Map<string, Draft>()
  let skippedRows = 0

  for (const row of setupRows) {
    const clientName = cellString(pick(row, 'ClientName', 'Client', 'Client Name'))
    const lobProjectName = cellString(pick(row, 'LobProjectName', 'LOB', 'LOB / Project Name', 'Lob'))
    const location = cellString(pick(row, 'Location'))
    if (!clientName && !lobProjectName && !location) {
      skippedRows += 1
      continue
    }
    if (!clientName || !lobProjectName || !location) {
      errors.push(`Setup row skipped — ClientName, LobProjectName, and Location are required (${clientName || '—'} / ${lobProjectName || '—'} / ${location || '—'}).`)
      skippedRows += 1
      continue
    }
    const key = lineKey(clientName, lobProjectName, location)
    if (drafts.has(key)) {
      warnings.push(`Duplicate Setup row for ${clientName} · ${lobProjectName} · ${location} — keeping the first.`)
      skippedRows += 1
      continue
    }
    const defaults = emptyDefaults()
    const aht = parseNumber(pick(row, 'AHT'))
    const loginHours = parseNumber(pick(row, 'LoginHours', 'Login Hours'))
    const absenteeismPct = parseNumber(pick(row, 'AbsenteeismPct', 'Absenteeism %'))
    const shrinkagePct = parseNumber(pick(row, 'ShrinkagePct', 'Shrinkage %'))
    const occupancyPct = parseNumber(pick(row, 'OccupancyPct', 'Occupancy %'))
    const hourlyBillRate = parseNumber(pick(row, 'HourlyBillRate', 'Hourly Bill Rate'))
    const monthlyBillRate = parseNumber(pick(row, 'MonthlyBillRate', 'Monthly Bill Rate'))
    const perMinuteBillRate = parseNumber(pick(row, 'PerMinuteBillRate', 'Per Minute Bill Rate'))
    if (aht != null) defaults.aht = aht
    if (loginHours != null) defaults.loginHours = loginHours
    if (absenteeismPct != null) defaults.absenteeismPct = absenteeismPct
    if (shrinkagePct != null) defaults.shrinkagePct = shrinkagePct
    if (occupancyPct != null) defaults.occupancyPct = occupancyPct
    if (hourlyBillRate != null) defaults.hourlyBillRate = hourlyBillRate
    if (monthlyBillRate != null) defaults.monthlyBillRate = monthlyBillRate
    if (perMinuteBillRate != null) defaults.perMinuteBillRate = perMinuteBillRate

    drafts.set(key, {
      clientName,
      lobProjectName,
      location,
      projectCode: cellString(pick(row, 'ProjectCode', 'Project Code')),
      billingType: cellString(pick(row, 'BillingType', 'Billing Type')) || 'Prod hours',
      billRateMethod: parseBillRateMethod(cellString(pick(row, 'BillRateMethod', 'Bill Rate Method'))),
      agentGroup: cellString(pick(row, 'AgentGroup', 'Group of Agents')),
      defaults,
      months: {},
    })
  }

  let monthsFilled = 0
  for (const row of monthRows) {
    const clientName = cellString(pick(row, 'ClientName', 'Client', 'Client Name'))
    const lobProjectName = cellString(pick(row, 'LobProjectName', 'LOB', 'LOB / Project Name', 'Lob'))
    const location = cellString(pick(row, 'Location'))
    const month = monthKeyFromCell(pick(row, 'Month', 'MonthKey', 'YYYY-MM'), fiscalMonths)
    if (!clientName && !lobProjectName && !location && !month) {
      skippedRows += 1
      continue
    }
    if (!clientName || !lobProjectName || !location || !month) {
      errors.push(
        `Monthly Capacity row skipped — need ClientName, LobProjectName, Location, and Month (${clientName || '—'} / ${month || '—'}).`,
      )
      skippedRows += 1
      continue
    }
    const key = lineKey(clientName, lobProjectName, location)
    let draft = drafts.get(key)
    if (!draft) {
      // Allow month-only uploads that imply a new Setup row.
      draft = {
        clientName,
        lobProjectName,
        location,
        projectCode: '',
        billingType: 'Prod hours',
        billRateMethod: 'hourly',
        agentGroup: '',
        defaults: emptyDefaults(),
        months: {},
      }
      drafts.set(key, draft)
      warnings.push(`Created Setup from Monthly Capacity for ${clientName} · ${lobProjectName} · ${location}.`)
    }

    const input = emptyMonthInput()
    input.capacity = parseNumber(pick(row, 'Capacity', 'Capacity / Transactions'))
    input.fte = parseNumber(pick(row, 'FTE'))
    input.aht = parseNumber(pick(row, 'AHT'))
    input.loginHours = parseNumber(pick(row, 'LoginHours', 'Login Hours'))
    input.absenteeismPct = parseNumber(pick(row, 'AbsenteeismPct', 'Absenteeism %'))
    input.shrinkagePct = parseNumber(pick(row, 'ShrinkagePct', 'Shrinkage %'))
    input.occupancyPct = parseNumber(pick(row, 'OccupancyPct', 'Occupancy %'))
    input.hourlyBillRate = parseNumber(pick(row, 'HourlyBillRate', 'Hourly Bill Rate'))
    input.monthlyBillRate = parseNumber(pick(row, 'MonthlyBillRate', 'Monthly Bill Rate'))
    input.perMinuteBillRate = parseNumber(pick(row, 'PerMinuteBillRate', 'Per Minute Bill Rate'))
    input.discountOrLessToRevenue = parseNumber(pick(row, 'DiscountOrLessToRevenue', 'Discount or Less to Revenue'))
    input.extraHours = parseNumber(pick(row, 'ExtraHours', 'Extra hours'))

    const hasAny = Object.values(input).some((value) => value != null)
    if (!hasAny) {
      skippedRows += 1
      continue
    }
    if (isFteBillingPlan(draft.billingType) && input.fte == null && input.capacity != null) {
      warnings.push(`${clientName} · ${month}: FTE billing — Capacity was set but FTE is blank.`)
    }
    draft.months[month] = input
    monthsFilled += 1
  }

  if (!drafts.size) {
    return {
      success: false,
      lines: [],
      clientsCreated: 0,
      monthsFilled: 0,
      skippedRows,
      errors: errors.length ? errors : ['No client rows found in Setup or Monthly Capacity.'],
      warnings,
      message: 'Upload failed — no clients to add.',
    }
  }

  const lines = [...drafts.values()].map((draft) =>
    createDbeLine({
      clientName: draft.clientName,
      lobProjectName: draft.lobProjectName,
      location: draft.location,
      projectCode: draft.projectCode,
      billingType: draft.billingType,
      agentGroup: draft.agentGroup,
      billRateMethod: draft.billRateMethod,
      defaults: draft.defaults,
      useStaffingAbsenteeismShrinkage: false,
      months: draft.months,
      revenueAdjustments: [],
      costItems: cloneDefaultCostItems(),
      rowRemarks: {},
    }),
  )

  const uniqueClients = new Set(lines.map((line) => line.clientName.toLowerCase())).size
  return {
    success: errors.length === 0 || lines.length > 0,
    lines,
    clientsCreated: uniqueClients,
    monthsFilled,
    skippedRows,
    errors,
    warnings,
    message: `Imported ${lines.length} LOB line${lines.length === 1 ? '' : 's'} (${uniqueClients} client${uniqueClients === 1 ? '' : 's'}, ${monthsFilled} month cell${monthsFilled === 1 ? '' : 's'}).`,
  }
}

export async function parseDbeClientTemplateFile(
  file: File,
  fiscalStartYear: number,
): Promise<DbeClientTemplateImportResult> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  return parseDbeClientTemplateWorkbook(workbook, fiscalStartYear)
}

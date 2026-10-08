import { randomBytes } from 'node:crypto'

export type ExternalRosterAccount = {
  id: string
  name: string
  client?: string
  status?: string
  accountCode?: string
  industry?: string
  region?: string
  programType?: string
  seatCapacity?: number
  accountManager?: string
  timezoneCoverage?: string
  raw: Record<string, unknown>
}

export type ExternalRosterStaffMember = {
  id: string
  employeeId: string
  name: string
  email: string
  accountId: string
  employmentStatus: string
  role: string
  department: string
  siteLocation: string
  shift: string
  seniorityLevel: string
  startDate: string
  trainingStatus: string
  nestingStatus: string
  productionStatus: string
  raw: Record<string, unknown>
}

export class RosterApiError extends Error {
  code: string
  status: number

  constructor(code: string, message: string, status = 502) {
    super(message)
    this.code = code
    this.status = status
  }
}

function rosterConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.ROSTER_API_URL?.trim()
  const apiKey = process.env.ROSTER_API_KEY?.trim()
  if (!baseUrl || !apiKey) {
    throw new RosterApiError(
      'roster_api_not_configured',
      'Roster API is not configured. Set ROSTER_API_URL and ROSTER_API_KEY on the server.',
      503,
    )
  }
  return { baseUrl, apiKey }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function pickString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (value != null && String(value).trim()) return String(value).trim()
  }
  return ''
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && !Number.isNaN(Number(value))) return Number(value)
  }
  return undefined
}

export function normalizeRosterDate(value: string): string {
  if (!value.trim()) return ''
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/)
  if (match) return match[1]
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return value.trim()
}

/**
 * API envelope is usually `{ status: 200, data: T | T[] }`.
 * Also accepts bare arrays / objects.
 */
function unwrapPayload(json: unknown): unknown[] {
  if (Array.isArray(json)) return json
  const record = asRecord(json)
  for (const key of ['data', 'results', 'items', 'accounts', 'staff', 'employees']) {
    const value = record[key]
    if (Array.isArray(value)) return value
    if (value && typeof value === 'object') return [value]
  }
  if ('status' in record && ('data' in record || 'error' in record)) return []
  if (Object.keys(record).length) return [record]
  return []
}

async function fetchRosterResource(query: Record<string, string>): Promise<unknown> {
  const { baseUrl, apiKey } = rosterConfig()
  const url = new URL(baseUrl)
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }
  url.searchParams.set('apiKey', apiKey)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 45_000)

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'follow',
      signal: controller.signal,
    })
  } catch (error) {
    console.error('Roster API network error:', error)
    const aborted = error instanceof Error && error.name === 'AbortError'
    throw new RosterApiError(
      'sync_failed',
      aborted ? 'Roster API request timed out.' : 'Failed to reach roster API.',
      502,
    )
  } finally {
    clearTimeout(timeoutId)
  }

  const text = await response.text()
  if (response.status === 401 || response.status === 403) {
    throw new RosterApiError('invalid_api_key', 'Invalid roster API key.', 401)
  }
  if (!text.trim()) {
    if (!response.ok) {
      throw new RosterApiError('sync_failed', `Roster API returned ${response.status}.`, response.status)
    }
    throw new RosterApiError('empty_response', 'Roster API returned an empty response.', 404)
  }

  let payload: unknown
  try {
    payload = JSON.parse(text) as unknown
  } catch {
    if (!response.ok) {
      throw new RosterApiError('sync_failed', `Roster API returned ${response.status}.`, response.status)
    }
    throw new RosterApiError('sync_failed', 'Roster API returned invalid JSON.', 502)
  }

  const envelope = asRecord(payload)
  if (typeof envelope.status === 'number' && envelope.status >= 400) {
    const message = pickString(envelope, ['error', 'message']) || `Roster API returned ${envelope.status}.`
    if (envelope.status === 401 || envelope.status === 403) {
      throw new RosterApiError('invalid_api_key', message, 401)
    }
    if (envelope.status === 404) {
      throw new RosterApiError('empty_response', message, 404)
    }
    throw new RosterApiError('sync_failed', message, envelope.status >= 500 ? 502 : envelope.status)
  }

  // Apps Script sometimes uses HTTP 404 while still returning a usable JSON payload.
  if (!response.ok && typeof envelope.status === 'number' && envelope.status < 400) {
    return payload
  }
  if (!response.ok) {
    throw new RosterApiError('sync_failed', `Roster API returned ${response.status}.`, response.status)
  }

  return payload
}

function mapAccount(record: Record<string, unknown>): ExternalRosterAccount | null {
  const id = pickString(record, ['account_id', 'accountId', 'id', 'AccountId', 'ID'])
  const name = pickString(record, ['account_name', 'accountName', 'name', 'client', 'Client', 'label'])
  if (!id && !name) return null
  return {
    id: id || name,
    name: name || id,
    client: pickString(record, ['client', 'client_name', 'clientName', 'account_name', 'accountName']) || name || undefined,
    status: pickString(record, ['contract_status', 'account_status', 'status']) || undefined,
    accountCode: pickString(record, ['account_code', 'accountCode']) || undefined,
    industry: pickString(record, ['industry']) || undefined,
    region: pickString(record, ['region']) || undefined,
    programType: pickString(record, ['program_type', 'programType', 'lob', 'LOB']) || undefined,
    seatCapacity: pickNumber(record, ['seat_capacity', 'seatCapacity']),
    accountManager: pickString(record, ['account_manager', 'accountManager']) || undefined,
    timezoneCoverage: pickString(record, ['timezone_coverage', 'timezoneCoverage']) || undefined,
    raw: record,
  }
}

function mapStaff(record: Record<string, unknown>, fallbackAccountId = ''): ExternalRosterStaffMember | null {
  const employeeId = pickString(record, [
    'staff_id',
    'staffId',
    'employee_id',
    'employeeId',
    'EmployeeId',
    'emp_id',
    'id',
    'ID',
  ])
  const firstName = pickString(record, ['first_name', 'firstName', 'given_name'])
  const lastName = pickString(record, ['last_name', 'lastName', 'family_name', 'surname'])
  const composedName = [firstName, lastName].filter(Boolean).join(' ').trim()
  const name = pickString(record, ['name', 'full_name', 'fullName', 'employee_name', 'EmployeeName']) || composedName
  if (!employeeId && !name) return null

  const accountId = pickString(record, ['account_id', 'accountId', 'AccountId']) || fallbackAccountId
  const role = pickString(record, ['role', 'position', 'job_title', 'jobTitle', 'title']) || ''
  const department = pickString(record, ['department', 'dept', 'lob', 'LOB']) || ''
  const employmentStatus =
    pickString(record, ['employment_status', 'employmentStatus', 'status', 'Status']) || 'Unknown'
  const startDate = normalizeRosterDate(
    pickString(record, ['hire_date', 'hireDate', 'start_date', 'startDate', 'hiring_date', 'HiringDate']),
  )

  return {
    id: pickString(record, ['staff_id', 'staffId', 'id']) || employeeId || cryptoRandomId(),
    employeeId: employeeId || name,
    name: name || employeeId,
    email: pickString(record, ['email', 'Email']) || '',
    accountId,
    employmentStatus,
    role,
    department,
    siteLocation: pickString(record, ['site_location', 'siteLocation', 'location', 'site']) || '',
    shift: pickString(record, ['shift']) || '',
    seniorityLevel: pickString(record, ['seniority_level', 'seniorityLevel', 'seniority']) || '',
    startDate,
    trainingStatus: pickString(record, ['training_status', 'trainingStatus', 'training']) || '',
    nestingStatus: pickString(record, ['nesting_status', 'nestingStatus', 'nesting']) || '',
    productionStatus: pickString(record, ['production_status', 'productionStatus', 'production']) || '',
    raw: record,
  }
}

function cryptoRandomId(): string {
  return `staff_${randomBytes(6).toString('hex')}`
}

export async function listRosterAccounts(): Promise<ExternalRosterAccount[]> {
  const payload = await fetchRosterResource({ resource: 'accounts' })
  const accounts = unwrapPayload(payload)
    .map((item) => mapAccount(asRecord(item)))
    .filter((item): item is ExternalRosterAccount => item != null)
  if (!accounts.length) {
    throw new RosterApiError('empty_response', 'No accounts returned from roster API.', 404)
  }
  return accounts
}

export async function getRosterAccount(accountId: string): Promise<ExternalRosterAccount> {
  if (!accountId.trim()) {
    throw new RosterApiError('missing_account_id', 'account_id is required.', 400)
  }
  const id = accountId.trim()

  try {
    const payload = await fetchRosterResource({ resource: 'accounts', id })
    const accounts = unwrapPayload(payload)
      .map((item) => mapAccount(asRecord(item)))
      .filter((item): item is ExternalRosterAccount => item != null)
    const account = accounts.find((item) => item.id === id) ?? accounts[0]
    if (account) return account
  } catch (error) {
    // Some Apps Script deployments 404 on `id=` — fall back to list + find.
    if (!(error instanceof RosterApiError) || error.code === 'invalid_api_key' || error.code === 'roster_api_not_configured') {
      throw error
    }
  }

  const accounts = await listRosterAccounts()
  const account = accounts.find((item) => item.id === id)
  if (!account) {
    throw new RosterApiError('empty_response', `Account ${id} was not found.`, 404)
  }
  return account
}

export async function listRosterStaff(options: {
  accountId?: string
  employmentStatus?: string
  allowEmpty?: boolean
}): Promise<ExternalRosterStaffMember[]> {
  const query: Record<string, string> = { resource: 'staff' }
  if (options.accountId?.trim()) query.account_id = options.accountId.trim()
  if (options.employmentStatus?.trim()) query.employment_status = options.employmentStatus.trim()
  if (!query.account_id && !query.employment_status) {
    throw new RosterApiError('missing_account_id', 'account_id or employment_status is required.', 400)
  }

  const payload = await fetchRosterResource(query)
  let staff = unwrapPayload(payload)
    .map((item) => mapStaff(asRecord(item), options.accountId ?? ''))
    .filter((item): item is ExternalRosterStaffMember => item != null)

  // Enforce account filter client-side — some API variants ignore account_id when other filters are present.
  if (options.accountId?.trim()) {
    const accountId = options.accountId.trim().toLowerCase()
    staff = staff.filter((member) => member.accountId.trim().toLowerCase() === accountId)
  }
  if (options.employmentStatus?.trim()) {
    const wanted = options.employmentStatus.trim().toLowerCase()
    staff = staff.filter((member) => member.employmentStatus.trim().toLowerCase() === wanted)
  }

  if (!staff.length && !options.allowEmpty) {
    throw new RosterApiError('empty_response', 'No staff returned from roster API.', 404)
  }
  return staff
}

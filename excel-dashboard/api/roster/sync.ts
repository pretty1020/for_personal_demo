import type { VercelRequest, VercelResponse } from '@vercel/node'
import { applyCors, handleOptions, json } from '../_lib/http.js'
import {
  getRosterAccount,
  listRosterStaff,
  normalizeRosterDate,
  RosterApiError,
} from '../_lib/externalRosterApi.js'
import { requireRosterApiUser } from '../_lib/rosterAuth.js'

type SyncBody = {
  accountId?: string
  client?: string
  lob?: string
  activeOnly?: boolean
  mergeWithExisting?: boolean
  existingEmployees?: Array<{
    id?: string
    employeeId?: string
    source?: string
    status?: string
  }>
}

function parseBody(req: VercelRequest): SyncBody | null {
  try {
    const raw = req.body
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as SyncBody
    if (typeof raw === 'string' && raw.trim()) {
      return JSON.parse(raw) as SyncBody
    }
  } catch {
    return null
  }
  return null
}

function inferPipelineStage(staff: Awaited<ReturnType<typeof listRosterStaff>>[number], status: string) {
  if (status !== 'active') return 'inactive' as const

  const training = staff.trainingStatus.toLowerCase()
  const nesting = staff.nestingStatus.toLowerCase()
  const production = staff.productionStatus.toLowerCase()
  if (training.includes('training') || training === 'yes' || training === 'active') return 'training' as const
  if (nesting.includes('nesting') || nesting === 'yes' || nesting === 'active') return 'nesting' as const
  if (production.includes('production') || production === 'yes' || production === 'active') return 'production' as const

  const role = `${staff.role} ${staff.department}`.toLowerCase()
  if (role.includes('train')) return 'training' as const
  if (role.includes('nest')) return 'nesting' as const
  return 'production' as const
}

function mapStaffToEmployee(
  staff: Awaited<ReturnType<typeof listRosterStaff>>[number],
  account: Awaited<ReturnType<typeof getRosterAccount>>,
  client: string,
  lob: string,
) {
  const employment = staff.employmentStatus.toLowerCase()
  let status: 'active' | 'inactive_pending_termed' | 'inactive_loa' | 'terminated' = 'active'
  if (employment.includes('terminated') || employment.includes('term')) status = 'terminated'
  else if (employment.includes('loa') || employment.includes('leave')) status = 'inactive_loa'
  else if (employment.includes('inactive') || employment.includes('pending')) status = 'inactive_pending_termed'

  const pipelineStage = inferPipelineStage(staff, status)
  const startDate = normalizeRosterDate(staff.startDate)

  return {
    id: `api_${staff.id}`,
    name: staff.name,
    position: staff.role,
    employeeId: staff.employeeId,
    hiringDate: startDate,
    waveNumber: '',
    startTrainingDate: pipelineStage === 'training' ? startDate : '',
    startNestingDate: pipelineStage === 'nesting' ? startDate : '',
    productionDate: pipelineStage === 'production' ? startDate : '',
    status,
    source: 'api' as const,
    accountId: staff.accountId || account.id,
    client,
    lob: lob || staff.department || account.programType || '',
    employmentStatus: staff.employmentStatus,
    role: staff.role,
    pipelineStage,
    syncedAt: new Date().toISOString(),
    accountName: account.name,
    email: staff.email || undefined,
    department: staff.department || undefined,
    siteLocation: staff.siteLocation || undefined,
    shift: staff.shift || undefined,
    seniorityLevel: staff.seniorityLevel || undefined,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res)
  if (handleOptions(req, res)) return

  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed.', code: 'method_not_allowed' })
    return
  }

  const user = await requireRosterApiUser(req, res)
  if (!user) return

  const body = parseBody(req)
  if (!body?.accountId?.trim()) {
    json(res, 400, { error: 'accountId is required.', code: 'missing_account_id' })
    return
  }

  try {
    const account = await getRosterAccount(body.accountId.trim())
    const client = body.client?.trim() || account.client || account.name
    const lob = body.lob?.trim() || account.programType || ''
    const staff = await listRosterStaff({
      accountId: body.accountId.trim(),
      employmentStatus: body.activeOnly ? 'Active' : undefined,
      allowEmpty: true,
    })

    const mapped = staff.map((member) => mapStaffToEmployee(member, account, client, lob))
    const existing = body.existingEmployees ?? []
    const manualEmployees = body.mergeWithExisting
      ? existing.filter((item) => item.source !== 'api')
      : []

    const mergedByEmployeeId = new Map<string, (typeof mapped)[number]>()
    const duplicateEmployeeIds: string[] = []

    for (const employee of mapped) {
      const key = employee.employeeId.trim().toLowerCase()
      if (!key) continue
      if (mergedByEmployeeId.has(key)) duplicateEmployeeIds.push(employee.employeeId)
      mergedByEmployeeId.set(key, employee)
    }

    const employees = [
      ...manualEmployees.map((item) => ({ ...item, source: item.source ?? 'manual' })),
      ...mergedByEmployeeId.values(),
    ]

    const hasActiveStatus = (item: (typeof employees)[number]): boolean =>
      'status' in item && item.status === 'active'

    json(res, 200, {
      ok: true,
      account,
      client,
      lob,
      syncedAt: new Date().toISOString(),
      employees,
      stats: {
        fetched: staff.length,
        imported: mergedByEmployeeId.size,
        duplicates: duplicateEmployeeIds.length,
        manualRetained: manualEmployees.length,
        active: employees.filter(hasActiveStatus).length,
      },
      warnings: duplicateEmployeeIds.length
        ? [{ code: 'duplicate_employees', message: `Skipped ${duplicateEmployeeIds.length} duplicate employee IDs.` }]
        : [],
    })
  } catch (error) {
    if (error instanceof RosterApiError) {
      json(res, error.status, { error: error.message, code: error.code })
      return
    }
    console.error('Roster sync failed:', error)
    json(res, 500, { error: 'Roster sync failed.', code: 'sync_failed' })
  }
}

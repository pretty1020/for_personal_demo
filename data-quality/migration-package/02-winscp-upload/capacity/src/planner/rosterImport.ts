import type { RosterEmployee } from './rosterPersistence'

export type RosterDuplicateEntry = {
  incoming: RosterEmployee
  existing: RosterEmployee
  client: string
}

function normalizeClient(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function normalizeEmployeeId(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

export function rosterEntryKey(employee: RosterEmployee, fallbackClient = ''): string {
  const client = normalizeClient(employee.client || fallbackClient)
  const employeeId = normalizeEmployeeId(employee.employeeId)
  if (!employeeId) return ''
  return `${client}|${employeeId}`
}

export function dedupeRosterEntries(roster: RosterEmployee[], fallbackClient = ''): RosterEmployee[] {
  const seen = new Set<string>()
  const deduped: RosterEmployee[] = []
  for (const employee of roster) {
    const key = rosterEntryKey(employee, fallbackClient)
    if (!key) {
      deduped.push(employee)
      continue
    }
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(employee)
  }
  return deduped
}

export function countRosterDuplicateEntries(roster: RosterEmployee[], fallbackClient = ''): number {
  const seen = new Set<string>()
  let duplicates = 0
  for (const employee of roster) {
    const key = rosterEntryKey(employee, fallbackClient)
    if (!key) continue
    if (seen.has(key)) duplicates += 1
    else seen.add(key)
  }
  return duplicates
}

export function filterStaffNotInRoster(
  incoming: RosterEmployee[],
  existing: RosterEmployee[],
  clientName: string,
): { newStaff: RosterEmployee[]; alreadyInRoster: RosterDuplicateEntry[] } {
  const alreadyInRoster = findClientRosterDuplicates(incoming, existing, clientName)
  const blockedKeys = new Set(alreadyInRoster.map((entry) => rosterEntryKey(entry.incoming, clientName)).filter(Boolean))
  const newStaff = incoming.filter((employee) => {
    const key = rosterEntryKey(employee, clientName)
    if (!key) return true
    return !blockedKeys.has(key)
  })
  return { newStaff, alreadyInRoster }
}

function applySyncedFields(existing: RosterEmployee, incoming: RosterEmployee): RosterEmployee {
  const role = incoming.role?.trim() || incoming.position?.trim() || existing.role || existing.position
  return {
    ...existing,
    name: incoming.name || existing.name,
    position: role,
    role: incoming.role?.trim() || role,
    employeeId: incoming.employeeId || existing.employeeId,
    hiringDate: incoming.hiringDate || existing.hiringDate,
    status: incoming.status ?? existing.status,
    employmentStatus: incoming.employmentStatus ?? existing.employmentStatus,
    accountId: incoming.accountId ?? existing.accountId,
    accountName: incoming.accountName ?? existing.accountName,
    client: incoming.client ?? existing.client,
    lob: incoming.lob ?? existing.lob,
    department: incoming.department ?? existing.department,
    siteLocation: incoming.siteLocation ?? existing.siteLocation,
    pipelineStage: incoming.pipelineStage ?? existing.pipelineStage,
    email: incoming.email ?? existing.email,
    shift: incoming.shift ?? existing.shift,
    seniorityLevel: incoming.seniorityLevel ?? existing.seniorityLevel,
    source: incoming.source ?? existing.source,
    syncedAt: incoming.syncedAt ?? existing.syncedAt,
  }
}

export function findClientRosterDuplicates(
  incoming: RosterEmployee[],
  existing: RosterEmployee[],
  clientName: string,
): RosterDuplicateEntry[] {
  const clientKey = normalizeClient(clientName)
  if (!clientKey) return []

  const existingByEmployeeId = new Map<string, RosterEmployee>()
  for (const employee of existing) {
    if (normalizeClient(employee.client) !== clientKey) continue
    const key = normalizeEmployeeId(employee.employeeId)
    if (key) existingByEmployeeId.set(key, employee)
  }

  const duplicates: RosterDuplicateEntry[] = []
  for (const employee of incoming) {
    const key = normalizeEmployeeId(employee.employeeId)
    if (!key) continue
    if (normalizeClient(employee.client || clientName) !== clientKey) continue
    const match = existingByEmployeeId.get(key)
    if (match) {
      duplicates.push({ incoming: employee, existing: match, client: clientName })
    }
  }
  return duplicates
}

export function mergeRosterImport(
  existing: RosterEmployee[],
  incoming: RosterEmployee[],
  options: {
    clientName: string
    removeExistingIds?: string[]
  },
): RosterEmployee[] {
  const clientKey = normalizeClient(options.clientName)
  const removeIds = new Set(options.removeExistingIds ?? [])
  const keptExisting = existing.filter((employee) => !removeIds.has(employee.id))

  const incomingForClient = incoming.filter(
    (employee) => normalizeClient(employee.client || options.clientName) === clientKey,
  )
  const incomingByEmployeeId = new Map<string, RosterEmployee>()
  for (const employee of incomingForClient) {
    const key = normalizeEmployeeId(employee.employeeId)
    if (key) incomingByEmployeeId.set(key, employee)
  }

  const consumedIncomingIds = new Set<string>()
  const mergedExisting = keptExisting.map((employee) => {
    if (normalizeClient(employee.client) !== clientKey) return employee
    const key = normalizeEmployeeId(employee.employeeId)
    if (!key) return employee
    const match = incomingByEmployeeId.get(key)
    if (!match) return employee
    consumedIncomingIds.add(key)
    return applySyncedFields(employee, match)
  })

  const appendedIncoming = incoming.filter((employee) => {
    const employeeClient = normalizeClient(employee.client || options.clientName)
    const employeeId = normalizeEmployeeId(employee.employeeId)
    if (employeeClient !== clientKey) return true
    if (!employeeId) return true
    if (removeIds.has(employee.id)) return false
    if (consumedIncomingIds.has(employeeId)) return false
    const blocked = mergedExisting.some(
      (existingEmployee) =>
        normalizeClient(existingEmployee.client) === clientKey &&
        normalizeEmployeeId(existingEmployee.employeeId) === employeeId,
    )
    return !blocked
  })

  return [...mergedExisting, ...appendedIncoming]
}

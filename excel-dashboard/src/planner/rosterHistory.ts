import type { RosterEmployee, RosterEmployeeStatus, RosterTransferType } from './rosterPersistence'

export type RosterHistoryKind = 'status' | 'client_lob' | 'supervisor' | 'manager' | 'pipeline'

export type RosterHistoryEvent = {
  id: string
  kind: RosterHistoryKind
  effectiveDate: string
  endedDate?: string
  fromClient?: string
  toClient?: string
  fromLob?: string
  toLob?: string
  fromSupervisor?: string
  toSupervisor?: string
  fromManager?: string
  toManager?: string
  fromStatus?: RosterEmployeeStatus
  toStatus?: RosterEmployeeStatus
  transferType?: RosterTransferType
  transferDestinationClient?: string
  transferDestinationLob?: string
  trainingDate?: string
  nestingDate?: string
  productionDate?: string
  note?: string
}

export type RosterTransferOutDetails = {
  transferType: RosterTransferType
  transferDestinationClient: string
  transferDestinationLob?: string
}

export function formatTransferOutDestination(
  transferType: RosterTransferType,
  transferDestinationClient?: string,
  transferDestinationLob?: string,
): string {
  const client = transferDestinationClient?.trim() || '—'
  if (transferType === 'external') return `External → ${client}`
  const lob = transferDestinationLob?.trim() || '—'
  return `Internal → ${client} / ${lob}`
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function newHistoryId(): string {
  return crypto.randomUUID()
}

export function rosterAssignmentHistory(employee: RosterEmployee): RosterHistoryEvent[] {
  return [...(employee.assignmentHistory ?? [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
}

function closeOpenEvent(
  events: RosterHistoryEvent[],
  kind: RosterHistoryKind,
  endedDate: string,
): RosterHistoryEvent[] {
  return events.map((event, index, list) => {
    const isLatestOfKind =
      event.kind === kind &&
      !event.endedDate &&
      list.findLastIndex((item) => item.kind === kind && !item.endedDate) === index
    return isLatestOfKind ? { ...event, endedDate } : event
  })
}

export function appendRosterHistory(
  employee: RosterEmployee,
  event: Omit<RosterHistoryEvent, 'id'>,
): RosterEmployee {
  const effectiveDate = event.effectiveDate.slice(0, 10) || todayIso()
  const history = closeOpenEvent(rosterAssignmentHistory(employee), event.kind, effectiveDate)
  history.push({ ...event, id: newHistoryId(), effectiveDate })
  return { ...employee, assignmentHistory: history }
}

export function recordClientLobTransfer(
  employee: RosterEmployee,
  next: { client: string; lob: string },
  effectiveDate = todayIso(),
): RosterEmployee {
  const fromClient = employee.client ?? ''
  const fromLob = employee.lob ?? ''
  if (fromClient === next.client && fromLob === next.lob) return employee
  return appendRosterHistory(
    { ...employee, client: next.client, lob: next.lob },
    {
      kind: 'client_lob',
      effectiveDate,
      fromClient,
      toClient: next.client,
      fromLob,
      toLob: next.lob,
      note: `Transferred ${fromClient} / ${fromLob} → ${next.client} / ${next.lob}`,
    },
  )
}

export function recordSupervisorChange(
  employee: RosterEmployee,
  nextSupervisor: string,
  effectiveDate = todayIso(),
): RosterEmployee {
  const fromSupervisor = employee.supervisor ?? ''
  if (fromSupervisor === nextSupervisor) return employee
  return appendRosterHistory(
    { ...employee, supervisor: nextSupervisor },
    {
      kind: 'supervisor',
      effectiveDate,
      fromSupervisor,
      toSupervisor: nextSupervisor,
    },
  )
}

export function recordManagerChange(
  employee: RosterEmployee,
  nextManager: string,
  effectiveDate = todayIso(),
): RosterEmployee {
  const fromManager = employee.manager ?? ''
  if (fromManager === nextManager) return employee
  return appendRosterHistory(
    { ...employee, manager: nextManager },
    {
      kind: 'manager',
      effectiveDate,
      fromManager,
      toManager: nextManager,
    },
  )
}

export function recordPipelineDates(
  employee: RosterEmployee,
  next: Pick<RosterEmployee, 'startTrainingDate' | 'startNestingDate' | 'productionDate'>,
  effectiveDate = todayIso(),
): RosterEmployee {
  const unchanged =
    employee.startTrainingDate === next.startTrainingDate &&
    employee.startNestingDate === next.startNestingDate &&
    employee.productionDate === next.productionDate
  if (unchanged) return employee
  return appendRosterHistory(
    {
      ...employee,
      startTrainingDate: next.startTrainingDate,
      startNestingDate: next.startNestingDate,
      productionDate: next.productionDate,
    },
    {
      kind: 'pipeline',
      effectiveDate,
      trainingDate: next.startTrainingDate,
      nestingDate: next.startNestingDate,
      productionDate: next.productionDate,
      note: 'Pipeline dates updated; previous dates remain in history.',
    },
  )
}

export function formatHistoryEvent(event: RosterHistoryEvent): string {
  switch (event.kind) {
    case 'client_lob':
      return `${event.effectiveDate}: ${event.fromClient || '—'} / ${event.fromLob || '—'} → ${event.toClient || '—'} / ${event.toLob || '—'}`
    case 'supervisor':
      return `${event.effectiveDate}: Supervisor ${event.fromSupervisor || '—'} → ${event.toSupervisor || '—'}`
    case 'manager':
      return `${event.effectiveDate}: Manager ${event.fromManager || '—'} → ${event.toManager || '—'}`
    case 'pipeline':
      return `${event.effectiveDate}: Training ${event.trainingDate || '—'} · Nesting ${event.nestingDate || '—'} · Production ${event.productionDate || '—'}`
    case 'status': {
      const base = `${event.effectiveDate}: Status ${event.fromStatus ?? '—'} → ${event.toStatus ?? '—'}`
      if (event.toStatus === 'transfer_out' && event.transferType) {
        return `${base} (${formatTransferOutDestination(
          event.transferType,
          event.transferDestinationClient,
          event.transferDestinationLob,
        )})`
      }
      return base
    }
    default:
      return `${event.effectiveDate}: ${event.note ?? event.kind}`
  }
}

/** Persist Transfer Out destination details on the employee and latest status history events. */
export function recordTransferOutDetails(
  employee: RosterEmployee,
  details: RosterTransferOutDetails,
): RosterEmployee {
  const transferType = details.transferType
  const transferDestinationClient = details.transferDestinationClient.trim()
  const transferDestinationLob =
    transferType === 'internal' ? (details.transferDestinationLob ?? '').trim() || undefined : undefined
  const note = `Transfer Out — ${formatTransferOutDestination(
    transferType,
    transferDestinationClient,
    transferDestinationLob,
  )}`

  const statusHistory = (employee.statusHistory ?? []).map((event, index, list) =>
    index === list.length - 1 && event.status === 'transfer_out'
      ? { ...event, transferType, transferDestinationClient, transferDestinationLob }
      : event,
  )

  const history = rosterAssignmentHistory(employee)
  const lastStatusIdx = history.findLastIndex((event) => event.kind === 'status' && event.toStatus === 'transfer_out')
  let assignmentHistory = history
  if (lastStatusIdx >= 0) {
    assignmentHistory = history.map((event, index) =>
      index === lastStatusIdx
        ? {
            ...event,
            transferType,
            transferDestinationClient,
            transferDestinationLob,
            note,
          }
        : event,
    )
  } else {
    assignmentHistory = appendRosterHistory(
      { ...employee, assignmentHistory: history },
      {
        kind: 'status',
        effectiveDate: employee.statusStartDate || todayIso(),
        fromStatus: employee.status === 'transfer_out' ? undefined : employee.status,
        toStatus: 'transfer_out',
        transferType,
        transferDestinationClient,
        transferDestinationLob,
        note,
      },
    ).assignmentHistory!
  }

  return {
    ...employee,
    transferType,
    transferDestinationClient,
    transferDestinationLob,
    statusHistory: employee.statusHistory?.length ? statusHistory : employee.statusHistory,
    assignmentHistory,
  }
}

export function formatFullAgentHistory(employee: RosterEmployee): string[] {
  const lines: string[] = [
    `Training date: ${employee.startTrainingDate || '—'}`,
    `Nesting date: ${employee.startNestingDate || '—'}`,
    `Production date: ${employee.productionDate || '—'}`,
    `Current: ${employee.client || '—'} / ${employee.lob || '—'} · Supervisor ${employee.supervisor || '—'} · Manager ${employee.manager || '—'}`,
  ]
  const history = rosterAssignmentHistory(employee)
  if (!history.length) {
    lines.push('No prior transfers or team changes recorded.')
    return lines
  }
  lines.push('History (oldest → newest):')
  for (const event of history) lines.push(formatHistoryEvent(event))
  return lines
}

export function uniqueSupervisors(roster: RosterEmployee[]): string[] {
  return [...new Set(roster.map((employee) => employee.supervisor?.trim()).filter(Boolean) as string[])].sort()
}

export function uniqueManagers(roster: RosterEmployee[]): string[] {
  return [...new Set(roster.map((employee) => employee.manager?.trim()).filter(Boolean) as string[])].sort()
}

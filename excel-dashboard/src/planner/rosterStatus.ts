import { snapToWeekStart } from './capacityWeekUtils'
import { appendRosterHistory, formatTransferOutDestination } from './rosterHistory'
import type {
  RosterEmployee,
  RosterEmployeeStatus,
  RosterPipelineStage,
  RosterStatusEvent,
  RosterTransferType,
} from './rosterPersistence'
import type { WeekStart } from './types'

export type RosterTransferMeta = {
  transferType?: RosterTransferType
  transferDestinationClient?: string
  transferDestinationLob?: string
}

export function isTransferOutDetailsComplete(employee: Pick<
  RosterEmployee,
  'status' | 'statusStartDate' | 'transferType' | 'transferDestinationClient' | 'transferDestinationLob'
>): boolean {
  if (employee.status !== 'transfer_out') return true
  if (!employee.statusStartDate?.trim()) return false
  if (employee.transferType !== 'internal' && employee.transferType !== 'external') return false
  if (!employee.transferDestinationClient?.trim()) return false
  if (employee.transferType === 'internal' && !employee.transferDestinationLob?.trim()) return false
  return true
}

function transferFieldsForStatus(
  nextStatus: RosterEmployeeStatus,
  transferMeta: RosterTransferMeta | undefined,
  employee: RosterEmployee,
): Pick<RosterEmployee, 'transferType' | 'transferDestinationClient' | 'transferDestinationLob'> {
  if (nextStatus !== 'transfer_out') {
    return {
      transferType: undefined,
      transferDestinationClient: undefined,
      transferDestinationLob: undefined,
    }
  }
  const transferType = transferMeta?.transferType ?? employee.transferType
  const transferDestinationClient =
    transferMeta?.transferDestinationClient ?? employee.transferDestinationClient
  const transferDestinationLob =
    transferType === 'external'
      ? undefined
      : (transferMeta?.transferDestinationLob ?? employee.transferDestinationLob)
  return { transferType, transferDestinationClient, transferDestinationLob }
}

export const ROSTER_STATUS_OPTIONS: Array<{ value: RosterEmployeeStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'inactive_pending_termed', label: 'Inactive - Pending Termed' },
  { value: 'inactive_loa', label: 'Inactive - LOA' },
  { value: 'terminated', label: 'Terminated' },
  { value: 'transfer_out', label: 'Transfer Out' },
]

export function labelForRosterStatus(status: RosterEmployeeStatus): string {
  return ROSTER_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? 'Active'
}

export function isExitRosterStatus(status: RosterEmployeeStatus): boolean {
  return status === 'terminated' || status === 'transfer_out'
}

export function isOffRosterStatus(status: RosterEmployeeStatus): boolean {
  return status === 'inactive_pending_termed' || status === 'inactive_loa'
}

export function datePipelineStage(
  employee: RosterEmployee,
  week: string | null,
): Exclude<RosterPipelineStage, 'inactive'> {
  if (!week) return employee.pipelineStage === 'inactive' ? 'pending' : (employee.pipelineStage ?? 'pending')
  if (!employee.startTrainingDate || week < employee.startTrainingDate) return 'pending'
  if (!employee.startNestingDate || week < employee.startNestingDate) return 'training'
  if (!employee.productionDate || week < employee.productionDate) return 'nesting'
  return 'production'
}

function eventWeek(event: RosterStatusEvent, weekStart: WeekStart): string {
  return snapToWeekStart(event.startDate || event.endedDate || new Date(), weekStart)
}

export function rosterStatusEvents(employee: RosterEmployee, weekStart: WeekStart = 'sunday'): RosterStatusEvent[] {
  if (employee.statusHistory?.length) {
    return [...employee.statusHistory].sort((a, b) => a.startDate.localeCompare(b.startDate))
  }
  const activeStart = employee.hiringDate || employee.startTrainingDate || '1970-01-01'
  if (employee.status === 'active') {
    return [{ status: 'active', startDate: activeStart }]
  }
  const startDate = employee.statusStartDate || activeStart
  return [
    { status: 'active', startDate: activeStart },
    {
      status: employee.status,
      startDate,
      pipelineStage: datePipelineStage(employee, snapToWeekStart(startDate, weekStart)),
    },
  ]
}

export function statusAsOfWeek(
  employee: RosterEmployee,
  week: string | null,
  weekStart: WeekStart = 'sunday',
): RosterEmployeeStatus {
  if (!week) return employee.status
  const events = rosterStatusEvents(employee, weekStart)
  let current: RosterEmployeeStatus = 'active'
  for (const event of events) {
    if (eventWeek(event, weekStart) <= week) current = event.status
    else break
  }
  return current
}

export function statusEventInWeek(
  employee: RosterEmployee,
  week: string | null,
  weekStart: WeekStart = 'sunday',
): RosterStatusEvent | null {
  if (!week) return null
  const events = rosterStatusEvents(employee, weekStart).filter((event) => eventWeek(event, weekStart) === week)
  return events[events.length - 1] ?? null
}

export function weeklyPipelineStage(
  employee: RosterEmployee,
  week: string | null,
  weekStart: WeekStart = 'sunday',
): RosterPipelineStage {
  if (!week) return employee.pipelineStage ?? 'inactive'
  const status = statusAsOfWeek(employee, week, weekStart)
  if (isExitRosterStatus(status)) {
    const event = rosterStatusEvents(employee, weekStart).find((item) => item.status === status)
    const leftWeek = event ? eventWeek(event, weekStart) : week
    if (week >= leftWeek) return 'inactive'
  }
  if (isOffRosterStatus(status)) return 'inactive'
  return datePipelineStage(employee, week)
}

export function weeklyStatusLabel(
  employee: RosterEmployee,
  week: string | null,
  weekStart: WeekStart = 'sunday',
): string {
  if (!week) return 'No week selected'
  const status = statusAsOfWeek(employee, week, weekStart)
  if (status !== 'active') return labelForRosterStatus(status)
  switch (weeklyPipelineStage(employee, week, weekStart)) {
    case 'pending':
      return 'Pending Start'
    case 'training':
      return 'Training'
    case 'nesting':
      return 'Nesting'
    case 'production':
      return 'Active Production'
    default:
      return 'Inactive'
  }
}

export function applyRosterStatusChange(
  employee: RosterEmployee,
  nextStatus: RosterEmployeeStatus,
  startDate: string,
  weekStart: WeekStart = 'sunday',
  transferMeta?: RosterTransferMeta,
): RosterEmployee {
  const date = startDate.slice(0, 10)
  const transferFields = transferFieldsForStatus(nextStatus, transferMeta, employee)
  const transferHistoryFields =
    nextStatus === 'transfer_out'
      ? {
          transferType: transferFields.transferType,
          transferDestinationClient: transferFields.transferDestinationClient,
          transferDestinationLob: transferFields.transferDestinationLob,
          note:
            transferFields.transferType && transferFields.transferDestinationClient
              ? `Transfer Out — ${formatTransferOutDestination(
                  transferFields.transferType,
                  transferFields.transferDestinationClient,
                  transferFields.transferDestinationLob,
                )}`
              : undefined,
        }
      : {}

  if (!date) {
    return { ...employee, status: nextStatus, ...transferFields }
  }
  if (employee.status === nextStatus) {
    const history = rosterStatusEvents(employee, weekStart).map((event, index, list) =>
      index === list.length - 1
        ? {
            ...event,
            startDate: date,
            ...(nextStatus === 'transfer_out'
              ? {
                  transferType: transferFields.transferType,
                  transferDestinationClient: transferFields.transferDestinationClient,
                  transferDestinationLob: transferFields.transferDestinationLob,
                }
              : { transferType: undefined, transferDestinationClient: undefined, transferDestinationLob: undefined }),
          }
        : event,
    )
    return {
      ...employee,
      status: nextStatus,
      statusStartDate: date,
      statusHistory: history,
      ...transferFields,
    }
  }
  const history = rosterStatusEvents(employee, weekStart).map((event, index, list) =>
    index === list.length - 1 ? { ...event, endedDate: date } : event,
  )
  history.push({
    status: nextStatus,
    startDate: date,
    pipelineStage: datePipelineStage(employee, snapToWeekStart(date, weekStart)),
    ...(nextStatus === 'transfer_out'
      ? {
          transferType: transferFields.transferType,
          transferDestinationClient: transferFields.transferDestinationClient,
          transferDestinationLob: transferFields.transferDestinationLob,
        }
      : {}),
  })
  return {
    ...employee,
    status: nextStatus,
    statusStartDate: history[history.length - 1]?.startDate ?? date,
    statusHistory: history,
    ...transferFields,
    assignmentHistory: appendRosterHistory(employee, {
      kind: 'status',
      effectiveDate: date,
      fromStatus: employee.status,
      toStatus: nextStatus,
      ...transferHistoryFields,
    }).assignmentHistory,
  }
}

export function applyRosterStatusStartDate(
  employee: RosterEmployee,
  startDate: string,
  weekStart: WeekStart = 'sunday',
): RosterEmployee {
  const date = startDate.slice(0, 10)
  const history = rosterStatusEvents(employee, weekStart).map((event, index, list) =>
    index === list.length - 1
      ? {
          ...event,
          startDate: date,
          pipelineStage: datePipelineStage(employee, snapToWeekStart(date || event.startDate, weekStart)),
        }
      : event,
  )
  return { ...employee, statusStartDate: date, statusHistory: history }
}

export function formatStatusHistory(employee: RosterEmployee, weekStart: WeekStart = 'sunday'): string {
  return rosterStatusEvents(employee, weekStart)
    .map((event) => `${labelForRosterStatus(event.status)} ${event.startDate}`)
    .join(' → ')
}

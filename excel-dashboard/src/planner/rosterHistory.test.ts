import { describe, expect, it } from 'vitest'
import {
  appendRosterHistory,
  formatFullAgentHistory,
  formatHistoryEvent,
  recordClientLobTransfer,
  recordManagerChange,
  recordSupervisorChange,
  recordTransferOutDetails,
  uniqueSupervisors,
} from './rosterHistory'
import type { RosterEmployee } from './rosterPersistence'
import { applyRosterStatusChange } from './rosterStatus'

function agent(partial: Partial<RosterEmployee> = {}): RosterEmployee {
  return {
    id: 'a1',
    name: 'Alex Agent',
    position: 'Agent',
    employeeId: 'E1',
    hiringDate: '2026-01-01',
    waveNumber: '1',
    startTrainingDate: '2026-01-06',
    startNestingDate: '2026-01-20',
    productionDate: '2026-02-01',
    status: 'active',
    client: 'Apex Retail',
    lob: 'Voice',
    supervisor: 'Supervisor A',
    manager: 'Manila Manager',
    ...partial,
  }
}

describe('rosterHistory', () => {
  it('appends transfers without overwriting earlier assignments', () => {
    const first = recordClientLobTransfer(agent(), { client: 'Apex Retail', lob: 'Chat' }, '2026-03-01')
    const second = recordClientLobTransfer(first, { client: 'Northwind', lob: 'Email' }, '2026-04-01')
    expect(second.lob).toBe('Email')
    expect(second.client).toBe('Northwind')
    expect(second.assignmentHistory).toHaveLength(2)
    expect(first.assignmentHistory).toHaveLength(1)
    expect(second.assignmentHistory?.[0]?.fromLob).toBe('Voice')
    expect(second.assignmentHistory?.[0]?.toLob).toBe('Chat')
    expect(second.assignmentHistory?.[1]?.fromLob).toBe('Chat')
    expect(second.assignmentHistory?.[1]?.endedDate).toBeUndefined()
  })

  it('records supervisor and manager changes with effective dates', () => {
    const next = recordManagerChange(
      recordSupervisorChange(agent(), 'Supervisor B', '2026-03-02'),
      'Site Lead',
      '2026-03-03',
    )
    expect(next.supervisor).toBe('Supervisor B')
    expect(next.manager).toBe('Site Lead')
    expect(next.assignmentHistory?.map((event) => event.kind)).toEqual(['supervisor', 'manager'])
  })

  it('keeps current pipeline dates visible while history lists prior events', () => {
    const transferred = recordClientLobTransfer(agent(), { client: 'Apex Retail', lob: 'Chat' }, '2026-03-01')
    const lines = formatFullAgentHistory(transferred)
    expect(lines.some((line) => line.includes('Training date'))).toBe(true)
    expect(lines.some((line) => line.includes('Voice') && line.includes('Chat'))).toBe(true)
  })

  it('lists unique supervisors', () => {
    expect(
      uniqueSupervisors([
        agent({ id: '1', supervisor: 'A' }),
        agent({ id: '2', supervisor: 'B' }),
        agent({ id: '3', supervisor: 'A' }),
      ]),
    ).toEqual(['A', 'B'])
  })

  it('does not add a history row when the assignment is unchanged', () => {
    const same = appendRosterHistory(agent(), {
      kind: 'supervisor',
      effectiveDate: '2026-03-01',
      fromSupervisor: 'Supervisor A',
      toSupervisor: 'Supervisor A',
    })
    const unchanged = recordSupervisorChange(same, 'Supervisor A', '2026-03-02')
    expect(unchanged.assignmentHistory).toHaveLength(1)
  })

  it('formats transfer_out status history with type and destination', () => {
    const line = formatHistoryEvent({
      id: 'h1',
      kind: 'status',
      effectiveDate: '2026-05-01',
      fromStatus: 'active',
      toStatus: 'transfer_out',
      transferType: 'internal',
      transferDestinationClient: 'Northwind',
      transferDestinationLob: 'Chat',
    })
    expect(line).toContain('transfer_out')
    expect(line).toContain('Internal → Northwind / Chat')
  })

  it('records transfer out details on employee and assignment history', () => {
    const transferred = applyRosterStatusChange(agent(), 'transfer_out', '2026-05-01')
    const withDetails = recordTransferOutDetails(transferred, {
      transferType: 'external',
      transferDestinationClient: 'Contoso',
    })
    expect(withDetails.transferType).toBe('external')
    expect(withDetails.transferDestinationClient).toBe('Contoso')
    expect(withDetails.transferDestinationLob).toBeUndefined()
    const statusEvent = withDetails.assignmentHistory?.find(
      (event) => event.kind === 'status' && event.toStatus === 'transfer_out',
    )
    expect(statusEvent?.transferType).toBe('external')
    expect(statusEvent?.transferDestinationClient).toBe('Contoso')
    expect(formatHistoryEvent(statusEvent!)).toContain('External → Contoso')
    expect(withDetails.statusHistory?.at(-1)?.transferDestinationClient).toBe('Contoso')
  })

  it('persists internal transfer meta through applyRosterStatusChange', () => {
    const next = applyRosterStatusChange(agent(), 'transfer_out', '2026-06-01', 'sunday', {
      transferType: 'internal',
      transferDestinationClient: 'Apex Retail',
      transferDestinationLob: 'Email',
    })
    expect(next.status).toBe('transfer_out')
    expect(next.transferType).toBe('internal')
    expect(next.transferDestinationLob).toBe('Email')
    expect(next.assignmentHistory?.at(-1)?.transferDestinationLob).toBe('Email')
  })
})

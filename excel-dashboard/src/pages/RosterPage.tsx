import { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { ScenarioPicker } from '../components/planner/ScenarioPicker'
import { usePlanner } from '../context/PlannerContext'
import { getScenarioAhtOverrides } from '../planner/ahtAnalysisPersistence'
import {
  actualProductionHcForDisplay,
  deriveCapacityPlanRows,
} from '../planner/capacityPlanDerived'
import { loadScenarioForecastModes } from '../planner/capacityForecastModesPersistence'
import { capacityWorkspaceForecastModes } from '../planner/capacityLookup'
import { DEFAULT_CAPACITY_FORECAST_MODES } from '../planner/capacityMatrixDisplay'
import { resolveCapacityPlanStartWeek, resolveCurrentCalendarWeek, snapToWeekStart } from '../planner/capacityWeekUtils'
import { loadClientRegistry } from '../planner/clientRegistry'
import { fmtNum } from '../planner/format'
import { resolvePlanLob, resolvePlanLocation } from '../planner/planIdentity'
import { ROSTER_TEMPLATE_COLUMNS } from '../planner/rosterColumns'
import { rosterHeadcountOverrides } from '../planner/rosterMetrics'
import {
  createEmptyRosterEmployee,
  type RosterEmployee,
  type RosterEmployeeStatus,
  type RosterTransferType,
} from '../planner/rosterPersistence'
import {
  applyRosterStatusChange,
  applyRosterStatusStartDate,
  isTransferOutDetailsComplete,
  labelForRosterStatus,
  ROSTER_STATUS_OPTIONS,
  statusEventInWeek,
  weeklyStatusLabel,
} from '../planner/rosterStatus'

function normalizeRosterHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function parseRosterStatus(value: unknown): RosterEmployeeStatus {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, '_')
  switch (normalized) {
    case 'inactive_pending_termed':
    case 'inactivependingtermed':
      return 'inactive_pending_termed'
    case 'inactive_loa':
    case 'inactiveloa':
      return 'inactive_loa'
    case 'terminated':
      return 'terminated'
    case 'transfer_out':
    case 'transferout':
      return 'transfer_out'
    default:
      return 'active'
  }
}

function toRosterWorkbookRows(roster: RosterEmployee[]) {
  return roster.map((employee) => ({
    Name: employee.name,
    Position: employee.position,
    'Employee ID': employee.employeeId,
    'Hiring Date': employee.hiringDate,
    'Wave Number': employee.waveNumber,
    'Start of Training Date': employee.startTrainingDate,
    'Start of Nesting Date': employee.startNestingDate,
    'Production Date': employee.productionDate,
    Status: labelForRosterStatus(employee.status),
    'Transfer Start Date': employee.status === 'transfer_out' ? (employee.statusStartDate ?? '') : '',
    'Transfer Type': employee.transferType ?? '',
    'Transfer Destination Client': employee.transferDestinationClient ?? '',
    'Transfer Destination LOB': employee.transferDestinationLob ?? '',
  }))
}

function parseRosterWorkbookRows(rows: Record<string, unknown>[]): RosterEmployee[] {
  return rows
    .map((row) => {
      const getValue = (header: string) => {
        const entry = Object.entries(row).find(([key]) => normalizeRosterHeader(key) === normalizeRosterHeader(header))
        return entry?.[1]
      }
      const status = parseRosterStatus(getValue('Status'))
      const transferTypeRaw = String(getValue('Transfer Type') ?? '')
        .trim()
        .toLowerCase()
      const transferType: RosterTransferType | undefined =
        transferTypeRaw === 'internal' || transferTypeRaw === 'external' ? transferTypeRaw : undefined
      const transferStartDate = String(getValue('Transfer Start Date') ?? getValue('Start Date of Transfer') ?? '')
        .trim()
        .slice(0, 10)
      const next: RosterEmployee = {
        id: crypto.randomUUID(),
        name: String(getValue('Name') ?? '').trim(),
        position: String(getValue('Position') ?? '').trim(),
        employeeId: String(getValue('Employee ID') ?? '').trim(),
        hiringDate: String(getValue('Hiring Date') ?? '').trim(),
        waveNumber: String(getValue('Wave Number') ?? '').trim(),
        startTrainingDate: String(getValue('Start of Training Date') ?? '').trim(),
        startNestingDate: String(getValue('Start of Nesting Date') ?? '').trim(),
        productionDate: String(getValue('Production Date') ?? '').trim(),
        status,
        statusStartDate: status === 'transfer_out' ? transferStartDate || undefined : undefined,
        transferType: status === 'transfer_out' ? transferType : undefined,
        transferDestinationClient:
          status === 'transfer_out' ? String(getValue('Transfer Destination Client') ?? '').trim() || undefined : undefined,
        transferDestinationLob:
          status === 'transfer_out' && transferType === 'internal'
            ? String(getValue('Transfer Destination LOB') ?? '').trim() || undefined
            : undefined,
      }
      const hasData =
        next.name !== '' ||
        next.position !== '' ||
        next.employeeId !== '' ||
        next.hiringDate !== '' ||
        next.waveNumber !== '' ||
        next.startTrainingDate !== '' ||
        next.startNestingDate !== '' ||
        next.productionDate !== ''
      return hasData ? next : null
    })
    .filter((employee): employee is RosterEmployee => employee != null)
}

function tenureWeeks(fromDate: string, currentWeek: string | null): number | null {
  if (!fromDate || !currentWeek) return null
  const from = new Date(`${fromDate}T12:00:00`)
  const current = new Date(`${currentWeek}T12:00:00`)
  const diffMs = current.getTime() - from.getTime()
  if (!Number.isFinite(diffMs)) return null
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24 * 7)))
}

function countTransferOutInWeek(
  roster: RosterEmployee[],
  week: string,
  weekStart: 'sunday' | 'monday',
): number {
  return roster.filter((employee) => statusEventInWeek(employee, week, weekStart)?.status === 'transfer_out')
    .length
}

export function RosterPage() {
  const {
    activeScenario,
    scenarios,
    getScenarioCapacityPlanOverrides,
    getScenarioForecast,
    getScenarioLedger,
    getScenarioRoster,
    getScenarioStageAttritionOverrides,
    saveScenarioRoster,
    updateActualOverrideMetric,
    updatePlannedOverrideMetric,
  } = usePlanner()
  const [scenarioId, setScenarioId] = useState(activeScenario?.id ?? '')
  const [clientSearch, setClientSearch] = useState('')
  const [transferSiteById, setTransferSiteById] = useState<Record<string, string>>({})
  const [statusNotice, setStatusNotice] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const resolvedScenarioId = scenarioId || activeScenario?.id || ''
  const scenario = scenarios.find((item) => item.id === resolvedScenarioId) ?? activeScenario ?? null
  const roster = scenario ? getScenarioRoster(scenario.id) : []
  const currentWeek = scenario
    ? resolveCurrentCalendarWeek(scenario.plan.weekStart)
    : resolveCurrentCalendarWeek('sunday')
  const planStartWeek = scenario ? resolveCapacityPlanStartWeek(scenario.plan) : null
  const weekStart = scenario?.plan.weekStart ?? 'sunday'

  const clientOptions = useMemo(() => {
    const names = new Set<string>()
    loadClientRegistry().forEach((client) => {
      if (client.name.trim()) names.add(client.name.trim())
    })
    scenarios.forEach((item) => {
      if (!item.isBaseline && item.plan.client.trim()) names.add(item.plan.client.trim())
    })
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [scenarios])

  const filteredClientOptions = useMemo(() => {
    const query = clientSearch.trim().toLowerCase()
    if (!query) return clientOptions
    return clientOptions.filter((name) => name.toLowerCase().includes(query))
  }, [clientOptions, clientSearch])

  const sitesForClient = (clientName: string) => {
    const label = clientName.trim().toLowerCase()
    if (!label) return [] as string[]
    const sites = new Set<string>()
    scenarios.forEach((item) => {
      if (item.isBaseline) return
      if (item.plan.client.trim().toLowerCase() !== label) return
      const site = resolvePlanLocation(item.plan)
      if (site) sites.add(site)
    })
    return [...sites].sort((a, b) => a.localeCompare(b))
  }

  const lobsForClient = (clientName: string, siteName = '') => {
    const label = clientName.trim().toLowerCase()
    if (!label) return [] as string[]
    const lobs = new Set<string>()
    scenarios.forEach((item) => {
      if (item.isBaseline) return
      if (item.plan.client.trim().toLowerCase() !== label) return
      if (siteName && resolvePlanLocation(item.plan) !== siteName) return
      const lob = resolvePlanLob(item.plan).trim()
      if (lob) lobs.add(lob)
    })
    return [...lobs].sort((a, b) => a.localeCompare(b))
  }

  const capacityRows = useMemo(() => {
    if (!scenario) return []
    const inactiveProductionCount = currentWeek
      ? roster.filter(
          (employee) =>
            employee.status !== 'active' &&
            employee.productionDate &&
            employee.productionDate <= currentWeek,
        ).length
      : 0
    const rosterPlanStartHc =
      planStartWeek != null
        ? rosterHeadcountOverrides(roster, planStartWeek, scenario.plan.client).productionHc
        : null
    return deriveCapacityPlanRows(
      getScenarioLedger(scenario.id),
      scenario,
      getScenarioForecast(scenario.id, 52),
      getScenarioCapacityPlanOverrides(scenario.id),
      capacityWorkspaceForecastModes(scenario, {
        ...DEFAULT_CAPACITY_FORECAST_MODES,
        ...loadScenarioForecastModes(scenario.id),
      }),
      inactiveProductionCount,
      getScenarioAhtOverrides(scenario.id),
      getScenarioStageAttritionOverrides(scenario.id),
      undefined,
      rosterPlanStartHc,
    )
  }, [
    currentWeek,
    getScenarioCapacityPlanOverrides,
    getScenarioForecast,
    getScenarioLedger,
    getScenarioStageAttritionOverrides,
    planStartWeek,
    roster,
    scenario,
  ])

  const currentWeekRow = capacityRows.find((row) => row.week === currentWeek) ?? null
  const capacityActualHc = currentWeekRow ? actualProductionHcForDisplay(currentWeekRow) : null
  const capacityProductionHc = Math.round(
    capacityActualHc != null && capacityActualHc > 0
      ? capacityActualHc
      : (currentWeekRow?.planned.productionHc ?? currentWeekRow?.actual.productionHc ?? 0),
  )
  const rosterMetrics = scenario
    ? rosterHeadcountOverrides(roster, currentWeek, scenario.plan.client)
    : { productionHc: 0, trainingHc: 0, nestingHc: 0 }
  const rosterAgentHc = Math.round(rosterMetrics.productionHc)
  const activeInProduction = roster.filter(
    (employee) => weeklyStatusLabel(employee, currentWeek, weekStart) === 'Active Production',
  ).length
  const transferOutThisWeek = currentWeek ? countTransferOutInWeek(roster, currentWeek, weekStart) : 0
  const mismatch =
    currentWeek != null && rosterAgentHc > 0 && capacityProductionHc > 0 && rosterAgentHc !== capacityProductionHc

  const syncRosterToCapacity = () => {
    if (!scenario || !currentWeek) return
    const count = rosterHeadcountOverrides(roster, currentWeek, scenario.plan.client).productionHc
    const transferOutHc = countTransferOutInWeek(roster, currentWeek, weekStart)
    updateActualOverrideMetric(scenario.id, currentWeek, 'transferOutHc', transferOutHc)
    updatePlannedOverrideMetric(scenario.id, currentWeek, 'transferOutHc', transferOutHc)

    // Also stamp Transfer Out onto each event's start week so Capacity matches the transfer date.
    const transferWeeks = new Set<string>()
    for (const employee of roster) {
      if (employee.status !== 'transfer_out' || !employee.statusStartDate) continue
      transferWeeks.add(snapToWeekStart(employee.statusStartDate, weekStart))
    }
    for (const week of transferWeeks) {
      const weekCount = countTransferOutInWeek(roster, week, weekStart)
      updateActualOverrideMetric(scenario.id, week, 'transferOutHc', weekCount)
      updatePlannedOverrideMetric(scenario.id, week, 'transferOutHc', weekCount)
    }

    // Prefer drivers over hard production HC when transfer-out events exist.
    if (transferOutHc <= 0) {
      updateActualOverrideMetric(scenario.id, currentWeek, 'productionHc', count)
      updatePlannedOverrideMetric(scenario.id, currentWeek, 'productionHc', count)
    }

    // Internal transfers: credit destination LOB transfer-in for the transfer start week.
    const internalTransfers = roster.filter((employee) => {
      if (employee.status !== 'transfer_out') return false
      return (
        employee.transferType === 'internal' &&
        Boolean(employee.transferDestinationClient?.trim()) &&
        Boolean(employee.transferDestinationLob?.trim()) &&
        Boolean(employee.statusStartDate?.trim())
      )
    })
    const byDestinationWeek = new Map<string, number>()
    for (const employee of internalTransfers) {
      const week = snapToWeekStart(employee.statusStartDate!, weekStart)
      const key = `${week}|${employee.transferDestinationClient!.trim().toLowerCase()}|${employee.transferDestinationLob!.trim().toLowerCase()}`
      byDestinationWeek.set(key, (byDestinationWeek.get(key) ?? 0) + 1)
    }
    for (const [key, amount] of byDestinationWeek) {
      const [week, clientKey, lobKey] = key.split('|')
      const target = scenarios.find(
        (item) =>
          !item.isBaseline &&
          item.plan.client.trim().toLowerCase() === clientKey &&
          resolvePlanLob(item.plan).trim().toLowerCase() === lobKey,
      )
      if (!target || !week) continue
      updateActualOverrideMetric(target.id, week, 'transferInHc', amount)
      updatePlannedOverrideMetric(target.id, week, 'transferInHc', amount)
    }
    setStatusNotice(
      `Synced: Transfer Out ${transferOutHc} for ${currentWeek}${transferWeeks.size ? ` (+ ${transferWeeks.size} transfer week${transferWeeks.size === 1 ? '' : 's'})` : ''}.`,
    )
  }

  const updateEmployee = (employeeId: string, patch: Partial<RosterEmployee>) => {
    if (!scenario) return
    saveScenarioRoster(
      scenario.id,
      roster.map((employee) => (employee.id === employeeId ? { ...employee, ...patch } : employee)),
    )
  }

  const changeEmployeeStatus = (employeeId: string, nextStatus: RosterEmployeeStatus) => {
    if (!scenario || !currentWeek) return
    const effectiveDate = snapToWeekStart(currentWeek, weekStart)
    saveScenarioRoster(
      scenario.id,
      roster.map((employee) => {
        if (employee.id !== employeeId) return employee
        return applyRosterStatusChange(employee, nextStatus, effectiveDate, weekStart, {
          transferType: nextStatus === 'transfer_out' ? employee.transferType ?? 'internal' : undefined,
          transferDestinationClient:
            nextStatus === 'transfer_out' ? employee.transferDestinationClient : undefined,
          transferDestinationLob: nextStatus === 'transfer_out' ? employee.transferDestinationLob : undefined,
        })
      }),
    )
    if (nextStatus === 'transfer_out') {
      setStatusNotice('Transfer Out selected — set Start Date of Transfer, type, and destination, then Sync roster → Capacity.')
    }
  }

  const updateTransferMeta = (
    employeeId: string,
    patch: {
      transferType?: RosterTransferType
      transferDestinationClient?: string
      transferDestinationLob?: string
      transferStartDate?: string
    },
  ) => {
    if (!scenario) return
    saveScenarioRoster(
      scenario.id,
      roster.map((employee) => {
        if (employee.id !== employeeId) return employee
        const nextType = patch.transferType ?? employee.transferType ?? 'internal'
        const startDate =
          (patch.transferStartDate ?? employee.statusStartDate ?? currentWeek ?? '').slice(0, 10) ||
          snapToWeekStart(new Date(), weekStart)
        let next = applyRosterStatusChange(employee, 'transfer_out', startDate, weekStart, {
          transferType: nextType,
          transferDestinationClient: patch.transferDestinationClient ?? employee.transferDestinationClient,
          transferDestinationLob:
            nextType === 'external' ? undefined : (patch.transferDestinationLob ?? employee.transferDestinationLob),
        })
        if (patch.transferStartDate) {
          next = applyRosterStatusStartDate(next, patch.transferStartDate, weekStart)
        }
        return next
      }),
    )
  }

  const deleteEmployee = (employeeId: string) => {
    if (!scenario) return
    saveScenarioRoster(
      scenario.id,
      roster.filter((employee) => employee.id !== employeeId),
    )
  }

  const addEmployee = () => {
    if (!scenario) return
    saveScenarioRoster(scenario.id, [...roster, createEmptyRosterEmployee()])
  }

  const downloadTemplate = () => {
    if (!scenario) return
    const workbook = XLSX.utils.book_new()
    const templateSheet = XLSX.utils.json_to_sheet([
      {
        Name: 'Alex Cruz',
        Position: 'Production Associate',
        'Employee ID': 'EMP-1001',
        'Hiring Date': '2026-07-01',
        'Wave Number': 'Wave 12',
        'Start of Training Date': '2026-07-07',
        'Start of Nesting Date': '2026-08-04',
        'Production Date': '2026-08-18',
        Status: 'Active',
        'Transfer Start Date': '',
        'Transfer Type': '',
        'Transfer Destination Client': '',
        'Transfer Destination LOB': '',
      },
    ])
    XLSX.utils.book_append_sheet(workbook, templateSheet, 'Roster Template')
    XLSX.writeFile(workbook, `${scenario.plan.client}-${scenario.plan.location}-roster-template.xlsx`)
  }

  const downloadRoster = () => {
    if (!scenario) return
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.json_to_sheet(toRosterWorkbookRows(roster), {
      header: [
        ...ROSTER_TEMPLATE_COLUMNS,
        'Transfer Start Date',
        'Transfer Type',
        'Transfer Destination Client',
        'Transfer Destination LOB',
      ],
    })
    XLSX.utils.book_append_sheet(workbook, sheet, 'Roster')
    XLSX.writeFile(workbook, `${scenario.plan.client}-${scenario.plan.location}-roster.xlsx`)
  }

  const importRosterTemplate = async (file: File) => {
    if (!scenario) return
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0] ?? '']
    if (!sheet) return
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
    saveScenarioRoster(scenario.id, parseRosterWorkbookRows(rows))
  }

  if (!scenario) {
    return <p className="saas-muted">Select a scenario to manage the roster.</p>
  }

  return (
    <div className="space-y-4">
      <div className="cap-view-toolbar">
        <div>
          <h2 className="m-0 text-lg font-bold text-slate-900">Roster</h2>
          <p className="saas-muted m-0 text-sm">Employees and support roles for the selected plan.</p>
        </div>
        <ScenarioPicker value={scenario.id} onChange={setScenarioId} label="Plan" />
      </div>

      <section className="saas-card roster-summary">
        <div>
          <p className="roster-summary__eyebrow">Current week</p>
          <h2 className="roster-summary__title">{currentWeek ?? '—'}</h2>
          <p className="saas-muted m-0">
            Capacity production HC: <strong>{fmtNum(capacityProductionHc, 0)}</strong>
            {' · '}
            Active in production: <strong>{fmtNum(activeInProduction, 0)}</strong>
            {' · '}
            Transfer Out this week: <strong>{fmtNum(transferOutThisWeek, 0)}</strong>
          </p>
          {statusNotice ? <p className="roster-summary__notice m-0 mt-2">{statusNotice}</p> : null}
        </div>
        <div className="roster-summary__actions">
          <button
            type="button"
            className="saas-btn saas-btn--secondary"
            disabled={!currentWeek}
            onClick={syncRosterToCapacity}
            title="Write roster agent count and Transfer Out into Capacity for this week"
          >
            Sync roster → Capacity
          </button>
          {mismatch ? (
            <div className="roster-alert roster-alert--warn">
              <span className="roster-alert__icon" aria-hidden>
                !
              </span>
              <span>Roster HC differs from Capacity for this week.</span>
            </div>
          ) : null}
        </div>
      </section>

      <section className="saas-card">
        <div className="cap-ledger-toolbar">
          <div>
            <h3 className="m-0 text-base font-bold text-slate-900">Employees</h3>
          </div>
          <div className="roster-actions">
            <button type="button" className="saas-btn saas-btn--secondary" onClick={downloadTemplate}>
              Download template
            </button>
            <button type="button" className="saas-btn saas-btn--secondary" onClick={() => fileInputRef.current?.click()}>
              Upload template
            </button>
            <button type="button" className="saas-btn saas-btn--secondary" onClick={downloadRoster}>
              Download roster
            </button>
            <button type="button" className="saas-btn" onClick={addEmployee}>
              Add employee
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file) return
                void importRosterTemplate(file)
                event.target.value = ''
              }}
            />
          </div>
        </div>

        <div className="cap-ledger-table-wrap mt-3">
          <table className="cap-ledger-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Position</th>
                <th>Employee ID</th>
                <th>Hiring Date</th>
                <th>Wave Number</th>
                <th>Tenure From Training</th>
                <th>Tenure From Nesting</th>
                <th>Tenure From Production</th>
                <th>Start of Training Date</th>
                <th>Start of Nesting Date</th>
                <th>Production Date</th>
                <th>Status</th>
                <th>Transfer</th>
                <th>Weekly Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {roster.length === 0 ? (
                <tr>
                  <td colSpan={15} className="saas-muted">
                    No employees yet. Use Add employee or upload a template.
                  </td>
                </tr>
              ) : (
                roster.map((employee) => {
                  const transferIncomplete =
                    employee.status === 'transfer_out' && !isTransferOutDetailsComplete(employee)
                  const siteOptions = sitesForClient(employee.transferDestinationClient ?? '')
                  const transferSite = siteOptions.includes(transferSiteById[employee.id] ?? '')
                    ? transferSiteById[employee.id] ?? ''
                    : ''
                  const lobOptions = lobsForClient(employee.transferDestinationClient ?? '', transferSite)
                  return (
                    <tr key={employee.id} className={transferIncomplete ? 'roster-row--warn' : undefined}>
                      <td>
                        <input
                          className="cap-field__input"
                          value={employee.name}
                          onChange={(event) => updateEmployee(employee.id, { name: event.target.value })}
                          maxLength={120}
                        />
                      </td>
                      <td>
                        <input
                          className="cap-field__input"
                          value={employee.position}
                          onChange={(event) => updateEmployee(employee.id, { position: event.target.value })}
                          maxLength={80}
                        />
                      </td>
                      <td>
                        <input
                          className="cap-field__input"
                          value={employee.employeeId}
                          onChange={(event) => updateEmployee(employee.id, { employeeId: event.target.value })}
                          maxLength={40}
                        />
                      </td>
                      <td>
                        <input
                          className="cap-field__input"
                          type="date"
                          value={employee.hiringDate}
                          onChange={(event) => updateEmployee(employee.id, { hiringDate: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="cap-field__input"
                          value={employee.waveNumber}
                          onChange={(event) => updateEmployee(employee.id, { waveNumber: event.target.value })}
                          maxLength={40}
                        />
                      </td>
                      <td>{fmtNum(tenureWeeks(employee.startTrainingDate, currentWeek), 0)}</td>
                      <td>{fmtNum(tenureWeeks(employee.startNestingDate, currentWeek), 0)}</td>
                      <td>{fmtNum(tenureWeeks(employee.productionDate, currentWeek), 0)}</td>
                      <td>
                        <input
                          className="cap-field__input"
                          type="date"
                          value={employee.startTrainingDate}
                          onChange={(event) => updateEmployee(employee.id, { startTrainingDate: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="cap-field__input"
                          type="date"
                          value={employee.startNestingDate}
                          onChange={(event) => updateEmployee(employee.id, { startNestingDate: event.target.value })}
                        />
                      </td>
                      <td>
                        <input
                          className="cap-field__input"
                          type="date"
                          value={employee.productionDate}
                          onChange={(event) => updateEmployee(employee.id, { productionDate: event.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          className="cap-field__input"
                          value={employee.status}
                          onChange={(event) =>
                            changeEmployeeStatus(employee.id, event.target.value as RosterEmployeeStatus)
                          }
                        >
                          {ROSTER_STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="roster-transfer-cell">
                        {employee.status === 'transfer_out' ? (
                          <div className="roster-transfer-fields">
                            <label className="roster-transfer-field">
                              <span className="roster-transfer-field__label">Start Date of Transfer</span>
                              <input
                                className="cap-field__input"
                                type="date"
                                value={employee.statusStartDate ?? ''}
                                required
                                onChange={(event) =>
                                  updateTransferMeta(employee.id, {
                                    transferStartDate: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <label className="roster-transfer-field">
                              <span className="roster-transfer-field__label">Transfer type</span>
                              <select
                                className="cap-field__input"
                                value={employee.transferType ?? ''}
                                onChange={(event) =>
                                  updateTransferMeta(employee.id, {
                                    transferType: event.target.value as RosterTransferType,
                                  })
                                }
                              >
                                <option value="">Type…</option>
                                <option value="internal">Internal</option>
                                <option value="external">External</option>
                              </select>
                            </label>
                            {employee.transferType === 'external' ? (
                              <label className="roster-transfer-field">
                                <span className="roster-transfer-field__label">Destination client</span>
                                <input
                                  className="cap-field__input"
                                  list={`roster-clients-${employee.id}`}
                                  placeholder="Search client…"
                                  value={employee.transferDestinationClient ?? ''}
                                  onFocus={() => setClientSearch('')}
                                  onChange={(event) => {
                                    setClientSearch(event.target.value)
                                    updateTransferMeta(employee.id, {
                                      transferDestinationClient: event.target.value,
                                    })
                                  }}
                                />
                              </label>
                            ) : (
                              <label className="roster-transfer-field">
                                <span className="roster-transfer-field__label">Destination client</span>
                                <select
                                  className="cap-field__input"
                                  value={employee.transferDestinationClient ?? ''}
                                  onChange={(event) => {
                                    setTransferSiteById((current) => ({ ...current, [employee.id]: '' }))
                                    updateTransferMeta(employee.id, {
                                      transferDestinationClient: event.target.value,
                                      transferDestinationLob: '',
                                    })
                                  }}
                                >
                                  <option value="">Client…</option>
                                  {clientOptions.map((name) => (
                                    <option key={name} value={name}>
                                      {name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            )}
                            <datalist id={`roster-clients-${employee.id}`}>
                              {filteredClientOptions.map((name) => (
                                <option key={name} value={name} />
                              ))}
                            </datalist>
                            {employee.transferType === 'internal' ? (
                              <label className="roster-transfer-field">
                                <span className="roster-transfer-field__label">Destination site</span>
                                <select
                                  className="cap-field__input"
                                  value={transferSite}
                                  disabled={!employee.transferDestinationClient}
                                  onChange={(event) => {
                                    const nextSite = event.target.value
                                    setTransferSiteById((current) => ({ ...current, [employee.id]: nextSite }))
                                    const stillValid = lobsForClient(
                                      employee.transferDestinationClient ?? '',
                                      nextSite,
                                    ).includes(employee.transferDestinationLob ?? '')
                                    if (!stillValid) {
                                      updateTransferMeta(employee.id, { transferDestinationLob: '' })
                                    }
                                  }}
                                >
                                  <option value="">All sites</option>
                                  {siteOptions.map((site) => (
                                    <option key={site} value={site}>
                                      {site}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                            {employee.transferType === 'internal' ? (
                              <label className="roster-transfer-field">
                                <span className="roster-transfer-field__label">Destination LOB</span>
                                <select
                                  className="cap-field__input"
                                  value={employee.transferDestinationLob ?? ''}
                                  disabled={!employee.transferDestinationClient}
                                  onChange={(event) =>
                                    updateTransferMeta(employee.id, {
                                      transferDestinationLob: event.target.value,
                                    })
                                  }
                                >
                                  <option value="">LOB…</option>
                                  {lobOptions.map((lob) => (
                                    <option key={lob} value={lob}>
                                      {lob}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : null}
                            {transferIncomplete ? (
                              <span className="roster-transfer-warn">Complete start date and destination</span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="saas-muted">—</span>
                        )}
                      </td>
                      <td>{weeklyStatusLabel(employee, currentWeek, weekStart)}</td>
                      <td>
                        <button
                          type="button"
                          className="saas-btn saas-btn--secondary"
                          onClick={() => deleteEmployee(employee.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

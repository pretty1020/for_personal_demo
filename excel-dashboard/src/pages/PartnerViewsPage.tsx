import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePlanner } from '../context/PlannerContext'
import {
  countInactiveProductionRoster,
  deriveCapacityPlanRows,
  type DerivedCapacityRow,
} from '../planner/capacityPlanDerived'
import { getScenarioAhtOverrides } from '../planner/ahtAnalysisPersistence'
import { DEFAULT_CAPACITY_FORECAST_MODES } from '../planner/capacityMatrixDisplay'
import { loadScenarioForecastModes } from '../planner/capacityForecastModesPersistence'
import { isoDate, resolveCapacityPlanStartWeek, resolveCurrentCalendarWeek } from '../planner/capacityWeekUtils'
import { rosterHeadcountOverrides } from '../planner/rosterMetrics'
import { resolvePlanLocation } from '../planner/planIdentity'
import type { WeekCapacityPlanOverride } from '../planner/capacityPlanOverridePersistence'
import type { ScenarioForecastPackage } from '../planner/forecasting'
import type { PlannerScenario } from '../planner/types'
import type { WeeklyLedgerRow } from '../planner/weeklyLedger'
import {
  applyMoves,
  confirmBy,
  confirmationStatus,
  itDemand,
  itStatus,
  readyBy,
  loadOperationsDay,
  resolveBoard,
  summarizeOverstaffing,
  type ClassMove,
  type HiringClass,
  type ItReady,
  type PartnerException,
  type PartnerProgram,
  type PlanWeek,
  type ShiftModel,
  type StaffingPoint,
} from '../planner/partnerViews'

type View = 'talent' | 'it' | 'operations'

const COPY: Record<View, { title: string; provides: string; needs: string }> = {
  talent: {
    title: 'Talent Acquisition',
    provides: 'Full visibility of hiring plans 6 months out. You can see which programs are overstaffed and move people there if needed.',
    needs: 'Confirms class dates 4 weeks in advance.',
  },
  it: {
    title: 'IT Provisioning',
    provides: 'Visibility of seat, device, and login demand by class date.',
    needs: 'Everything ready 5 days before start.',
  },
  operations: {
    title: 'Operations',
    provides: 'Schedules, an intraday playbook, and a scorecard.',
    needs: 'Adherence to the plan, and exceptions logged.',
  },
}

const STORE_KEY = 'wfp-partner-actions-v1'
const EMPTY_READY: ItReady = { seat: false, device: false, login: false }

type Store = {
  confirmed: string[]
  moves: ClassMove[]
  ready: Record<string, ItReady>
  exceptions: PartnerException[]
  playbook: Record<string, string[]>
  onFloor: Record<string, number>
}

export function TalentAcquisitionPage() {
  return <PartnerPage view="talent" />
}

export function ItProvisioningPage() {
  return <PartnerPage view="it" />
}

export function OperationsPartnerPage() {
  return <PartnerPage view="operations" />
}

function PartnerPage({ view }: { view: View }) {
  const copy = COPY[view]
  const today = isoDate(new Date())
  const {
    scenarios,
    getScenarioLedger,
    getScenarioForecast,
    getScenarioCapacityPlanOverrides,
    getScenarioRoster,
    getScenarioStageAttritionOverrides,
  } = usePlanner()
  const plans = useMemo(() => scenarios.filter((scenario) => !scenario.isBaseline), [scenarios])
  const weeks = useMemo(
    () =>
      plans.flatMap((scenario) =>
        safeDerive(scenario, {
          getScenarioLedger,
          getScenarioForecast,
          getScenarioCapacityPlanOverrides,
          getScenarioRoster,
          getScenarioStageAttritionOverrides,
        }).map((row) => toPlanWeek(scenario, row)),
      ),
    [
      plans,
      getScenarioLedger,
      getScenarioForecast,
      getScenarioCapacityPlanOverrides,
      getScenarioRoster,
      getScenarioStageAttritionOverrides,
    ],
  )
  const board = useMemo(() => resolveBoard(weeks, today), [weeks, today])
  const [store, setStore] = useState<Store>(loadStore)
  const [client, setClient] = useState('all')
  const [site, setSite] = useState('all')
  const [programId, setProgramId] = useState('all')
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [moveCount, setMoveCount] = useState(4)
  const [shiftModel, setShiftModel] = useState<ShiftModel>('two')
  const [exceptionShift, setExceptionShift] = useState('Shift A')
  const [exceptionNote, setExceptionNote] = useState('')

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  }, [store])

  const classes = useMemo(() => applyMoves(board.classes, store.moves), [board.classes, store.moves])
  const staffing = useMemo(
    () => board.staffing.map((point) => ({
      ...point,
      overUnderFte: point.overUnderFte + hired(classes, point.programId) - hired(board.classes, point.programId),
    })),
    [board.classes, board.staffing, classes],
  )
  const adjustedPrograms = useMemo(
    () => board.programs.map((item) => ({ ...item, overUnderFte: item.overUnderFte + hired(classes, item.id) - hired(board.classes, item.id) })),
    [board.classes, board.programs, classes],
  )
  const clients = unique(adjustedPrograms.map((item) => item.client))
  const sites = unique(adjustedPrograms.filter((item) => client === 'all' || item.client === client).map((item) => item.site))
  const activeClient = client === 'all' || clients.includes(client) ? client : 'all'
  const activeSite = site === 'all' || sites.includes(site) ? site : 'all'
  const programs = adjustedPrograms.filter(
    (item) => (activeClient === 'all' || item.client === activeClient) && (activeSite === 'all' || item.site === activeSite),
  )
  const activeProgram = view === 'operations'
    ? (programs.some((item) => item.id === programId) ? programId : programs[0]?.id ?? '')
    : (programId === 'all' || programs.some((item) => item.id === programId) ? programId : 'all')
  const visiblePrograms = activeProgram === 'all' || activeProgram === '' ? programs : programs.filter((item) => item.id === activeProgram)
  const visibleClasses = classes
    .filter((item) => visiblePrograms.some((program) => program.id === item.programId))
    .sort((a, b) => a.classDate.localeCompare(b.classDate))
  const donors = visibleClasses.filter((item) => (programOf(visiblePrograms, item.programId)?.overUnderFte ?? 0) >= 1 && item.hires > 0)
  const receivers = visibleClasses.filter((item) => (programOf(visiblePrograms, item.programId)?.overUnderFte ?? 0) <= -1)

  function patch(next: Partial<Store>) {
    setStore((current) => ({ ...current, ...next }))
  }

  return (
    <div className="seats-page partner-page">
      <header className="seats-hero">
        <div>
          <p className="seats-kicker">Capacity plan · Partners</p>
          <h2 className="seats-title">{copy.title}</h2>
        </div>
        <nav className="seats-toggle" aria-label="Partner views">
          <Link className={view === 'talent' ? 'is-on' : ''} to="/capacity-plan/talent">TA</Link>
          <Link className={view === 'it' ? 'is-on' : ''} to="/capacity-plan/it">IT</Link>
          <Link className={view === 'operations' ? 'is-on' : ''} to="/capacity-plan/operations">Operations</Link>
        </nav>
      </header>

      <section className="partner-promise">
        <p><b>WFM provides.</b> {copy.provides}</p>
        <p><b>WFM needs.</b> {copy.needs}</p>
      </section>
      <p className="partner-note">{originNote(board.classOrigin)}</p>

      <div className="seats-filters">
        <Filter label="Client" value={activeClient} options={['all', ...clients]} labels={{ all: 'All clients' }} onChange={(value) => { setClient(value); setSite('all'); setProgramId('all') }} />
        <Filter label="Site" value={activeSite} options={['all', ...sites]} labels={{ all: 'All sites' }} onChange={(value) => { setSite(value); setProgramId('all') }} />
        <Filter
          label="Program"
          value={activeProgram}
          options={view === 'operations' ? programs.map((item) => item.id) : ['all', ...programs.map((item) => item.id)]}
          labels={{ all: 'All programs', ...Object.fromEntries(programs.map((item) => [item.id, item.program])) }}
          onChange={setProgramId}
        />
      </div>

      {view === 'talent' ? (
        <TalentView
          today={today}
          programs={visiblePrograms}
          staffing={staffing.filter((point) => visiblePrograms.some((program) => program.id === point.programId))}
          classes={visibleClasses}
          confirmed={store.confirmed}
          donors={donors}
          receivers={receivers}
          fromId={donors.some((item) => item.id === fromId) ? fromId : donors[0]?.id ?? ''}
          toId={receivers.some((item) => item.id === toId) ? toId : receivers[0]?.id ?? ''}
          moveCount={moveCount}
          onFrom={setFromId}
          onTo={setToId}
          onCount={setMoveCount}
          onConfirm={(id) => patch({ confirmed: store.confirmed.includes(id) ? store.confirmed : [...store.confirmed, id] })}
          onMove={() => {
            const from = donors.some((item) => item.id === fromId) ? fromId : donors[0]?.id
            const to = receivers.some((item) => item.id === toId) ? toId : receivers[0]?.id
            if (!from || !to || from === to || moveCount <= 0) return
            patch({ moves: [...store.moves, { id: `move-${store.moves.length + 1}`, fromId: from, toId: to, hires: moveCount }] })
          }}
        />
      ) : null}

      {view === 'it' ? (
        <ItView
          today={today}
          classes={visibleClasses}
          ready={store.ready}
          onToggle={(id, key) => {
            const current = store.ready[id] ?? EMPTY_READY
            patch({ ready: { ...store.ready, [id]: { ...current, [key]: !current[key] } } })
          }}
        />
      ) : null}

      {view === 'operations' ? (
        <OperationsView
          today={today}
          program={visiblePrograms[0] ?? null}
          model={shiftModel}
          onModel={setShiftModel}
          onFloor={store.onFloor}
          setOnFloor={(key, value) => patch({ onFloor: { ...store.onFloor, [key]: value } })}
          playbookDone={store.playbook[visiblePrograms[0]?.id ?? '']}
          toggleStep={(stepId, current) => {
            const key = visiblePrograms[0]?.id
            if (!key) return
            const next = current.includes(stepId) ? current.filter((item) => item !== stepId) : [...current, stepId]
            patch({ playbook: { ...store.playbook, [key]: next } })
          }}
          savedExceptions={store.exceptions}
          exceptionShift={exceptionShift}
          exceptionNote={exceptionNote}
          onShift={setExceptionShift}
          onNote={setExceptionNote}
          onLog={(at) => {
            const program = visiblePrograms[0]
            const note = exceptionNote.trim()
            if (!program || !note) return
            patch({
              exceptions: [
                { id: `ex-${store.exceptions.length + 1}`, client: program.client, site: program.site, program: program.program, shift: exceptionShift, note, status: 'open', at, kind: 'Floor', owner: 'Floor lead' },
                ...store.exceptions,
              ],
            })
            setExceptionNote('')
          }}
          onClose={(row) => {
            const existing = store.exceptions.some((item) => item.id === row.id)
            patch({
              exceptions: existing
                ? store.exceptions.map((item) => item.id === row.id ? { ...item, status: 'closed' } : item)
                : [{ ...row, status: 'closed' }, ...store.exceptions],
            })
          }}
        />
      ) : null}
    </div>
  )
}

function TalentView({
  today,
  programs,
  staffing,
  classes,
  confirmed,
  donors,
  receivers,
  fromId,
  toId,
  moveCount,
  onFrom,
  onTo,
  onCount,
  onConfirm,
  onMove,
}: {
  today: string
  programs: PartnerProgram[]
  staffing: StaffingPoint[]
  classes: HiringClass[]
  confirmed: string[]
  donors: HiringClass[]
  receivers: HiringClass[]
  fromId: string
  toId: string
  moveCount: number
  onFrom: (id: string) => void
  onTo: (id: string) => void
  onCount: (value: number) => void
  onConfirm: (id: string) => void
  onMove: () => void
}) {
  const [grain, setGrain] = useState<'week' | 'month'>('week')
  const [overOpen, setOverOpen] = useState(false)
  const late = classes.filter((item) => confirmationStatus(item.classDate, today, confirmed.includes(item.id)) === 'late').length
  const over = programs.filter((item) => item.overUnderFte >= 1)
  const overstaffing = summarizeOverstaffing(staffing)
  const overWeekCount = new Set(overstaffing.flatMap((item) => item.overWeeks.map((week) => week.week))).size
  const overMonthCount = new Set(overstaffing.flatMap((item) => item.months.map((month) => month.key))).size
  return (
    <>
      <div className="partner-stats">
        <Stat label="Classes, 6 months" value={String(classes.length)} />
        <Stat label="Waiting on TA" value={String(classes.filter((item) => !confirmed.includes(item.id)).length)} />
        <Stat label="Late to confirm" value={String(late)} tone={late ? 'bad' : 'good'} />
        <Stat label="Overstaffed programs" value={String(over.length)} />
        <Stat label="Overstaffed weeks" value={String(overWeekCount)} tone={overWeekCount ? 'bad' : 'good'} />
        <Stat label="Overstaffed months" value={String(overMonthCount)} tone={overMonthCount ? 'bad' : 'good'} />
      </div>
      <section className="partner-over">
        <div className="partner-over__head">
          <div>
            <h3>Overstaffing</h3>
            <p>{overWeekCount} weeks and {overMonthCount} months have extra FTE.</p>
          </div>
          <button type="button" className="seats-btn seats-btn--ghost" aria-expanded={overOpen} onClick={() => setOverOpen((open) => !open)}>
            {overOpen ? 'Hide' : 'Show weeks and months'}
          </button>
        </div>
        {overOpen ? (
        <>
        <div className="seats-toggle" role="group" aria-label="Overstaffing grain">
          <button type="button" className={grain === 'week' ? 'is-on' : ''} onClick={() => setGrain('week')}>Weekly</button>
          <button type="button" className={grain === 'month' ? 'is-on' : ''} onClick={() => setGrain('month')}>Monthly</button>
        </div>
        <p className="partner-note">A week is overstaffed when the program has at least one extra FTE. A month is overstaffed when any of its weeks are.</p>
        {overstaffing.map((item) => (
          <article key={item.programId}>
            <header>
              <h3>{item.program}</h3>
              <p>{item.client} · {item.site}</p>
            </header>
            <p className="partner-over__count">
              <strong>{item.overWeeks.length} {item.overWeeks.length === 1 ? 'week' : 'weeks'}</strong> of {item.totalWeeks} overstaffed
              <span> · </span>
              <strong>{item.months.length} {item.months.length === 1 ? 'month' : 'months'}</strong>
            </p>
            {item.overWeeks.length === 0 ? <p>No overstaffed week in this range.</p> : null}
            {grain === 'week' && item.overWeeks.length > 0 ? (
              <ul>
                {item.overWeeks.map((week) => (
                  <li key={week.week}><b>Week of {labelDate(week.week)}</b><span>{signed(week.overUnderFte)} FTE</span></li>
                ))}
              </ul>
            ) : null}
            {grain === 'month' && item.months.length > 0 ? (
              <ul>
                {item.months.map((month) => (
                  <li key={month.key}>
                    <b>{month.label}</b>
                    <span>{month.weeks.length} {month.weeks.length === 1 ? 'week' : 'weeks'}: {month.weeks.map((week) => labelDate(week.week)).join(', ')}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
        </>
        ) : null}
      </section>
      <div className="partner-programs">
        {programs.map((item) => (
          <article key={item.id} className={item.overUnderFte >= 1 ? 'is-over' : item.overUnderFte <= -1 ? 'is-short' : ''}>
            <p>{item.client} · {item.site}</p>
            <h3>{item.program}</h3>
            <strong>{signed(item.overUnderFte)} FTE</strong>
            <span>{item.overUnderFte >= 1 ? 'Overstaffed. People can move.' : item.overUnderFte <= -1 ? 'Short. This program can take a class.' : 'Inside a person of the plan.'}</span>
          </article>
        ))}
      </div>
      <div className="partner-table-wrap">
        <table className="partner-table">
          <caption>Hiring plan</caption>
          <thead>
            <tr>
              <th>Class date</th>
              <th>Program</th>
              <th>Site</th>
              <th>Hires</th>
              <th>Confirm by</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {classes.map((item) => {
              const status = confirmationStatus(item.classDate, today, confirmed.includes(item.id))
              return (
                <tr key={item.id}>
                  <td>{labelDate(item.classDate)}</td>
                  <td>{item.program}</td>
                  <td>{item.site}</td>
                  <td>{item.hires}</td>
                  <td>{labelDate(confirmBy(item.classDate))}</td>
                  <td><em className={`partner-pill partner-pill--${status}`}>{statusLabel(status)}</em></td>
                  <td>{status === 'confirmed' ? 'Confirmed' : <button type="button" className="seats-btn" onClick={() => onConfirm(item.id)}>Confirm date</button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <section className="partner-move">
        <h3>Move people</h3>
        <p>Take hires from an overstaffed program and add them to a program that is short.</p>
        {donors.length && receivers.length ? (
          <div className="partner-move__row">
            <label>From
              <select value={fromId} onChange={(event) => onFrom(event.target.value)}>
                {donors.map((item) => <option key={item.id} value={item.id}>{item.program} · {item.hires} on {labelDate(item.classDate)}</option>)}
              </select>
            </label>
            <label>To
              <select value={toId} onChange={(event) => onTo(event.target.value)}>
                {receivers.map((item) => <option key={item.id} value={item.id}>{item.program} · {labelDate(item.classDate)}</option>)}
              </select>
            </label>
            <label>Hires
              <input type="number" min={1} max={24} value={moveCount} onChange={(event) => onCount(Number(event.target.value))} />
            </label>
            <button type="button" className="seats-btn" onClick={onMove}>Move</button>
          </div>
        ) : <p>There is no overstaffed class and short class in this filter to move between.</p>}
      </section>
    </>
  )
}

function ItView({
  today,
  classes,
  ready,
  onToggle,
}: {
  today: string
  classes: HiringClass[]
  ready: Record<string, ItReady>
  onToggle: (id: string, key: keyof ItReady) => void
}) {
  const totals = classes.reduce(
    (sum, item) => {
      const demand = itDemand(item.hires, item.onsiteShare)
      return { seats: sum.seats + demand.seats, devices: sum.devices + demand.devices, logins: sum.logins + demand.logins }
    },
    { seats: 0, devices: 0, logins: 0 },
  )
  const late = classes.filter((item) => itStatus(item.classDate, today, ready[item.id] ?? EMPTY_READY) === 'late').length
  return (
    <>
      <div className="partner-stats">
        <Stat label="Seats" value={String(totals.seats)} />
        <Stat label="Devices" value={String(totals.devices)} />
        <Stat label="Logins" value={String(totals.logins)} />
        <Stat label="Late to be ready" value={String(late)} tone={late ? 'bad' : 'good'} />
      </div>
      <div className="partner-classes">
        {classes.map((item) => {
          const demand = itDemand(item.hires, item.onsiteShare)
          const flags = ready[item.id] ?? EMPTY_READY
          const status = itStatus(item.classDate, today, flags)
          return (
            <article key={item.id}>
              <header>
                <div>
                  <p>{item.client} · {item.site} · {item.program}</p>
                  <h3>{labelDate(item.classDate)}</h3>
                </div>
                <em className={`partner-pill partner-pill--${status}`}>{statusLabel(status)}</em>
              </header>
              <dl>
                <div><dt>Seats</dt><dd>{demand.seats}</dd></div>
                <div><dt>Devices</dt><dd>{demand.devices}</dd></div>
                <div><dt>Logins</dt><dd>{demand.logins}</dd></div>
              </dl>
              <p>Ready by {labelDate(readyBy(item.classDate))}. Work-from-home hires take a device and a login, not a floor seat.</p>
              <div className="partner-checks">
                <Check label="Seat" on={flags.seat} onClick={() => onToggle(item.id, 'seat')} />
                <Check label="Device" on={flags.device} onClick={() => onToggle(item.id, 'device')} />
                <Check label="Login" on={flags.login} onClick={() => onToggle(item.id, 'login')} />
              </div>
            </article>
          )
        })}
      </div>
    </>
  )
}

function OperationsView({
  today,
  program,
  model,
  onModel,
  onFloor,
  setOnFloor,
  playbookDone,
  toggleStep,
  savedExceptions,
  exceptionShift,
  exceptionNote,
  onShift,
  onNote,
  onLog,
  onClose,
}: {
  today: string
  program: PartnerProgram | null
  model: ShiftModel
  onModel: (model: ShiftModel) => void
  onFloor: Record<string, number>
  setOnFloor: (key: string, value: number) => void
  playbookDone: string[] | undefined
  toggleStep: (id: string, current: string[]) => void
  savedExceptions: PartnerException[]
  exceptionShift: string
  exceptionNote: string
  onShift: (value: string) => void
  onNote: (value: string) => void
  onLog: (at: string) => void
  onClose: (row: PartnerException) => void
}) {
  if (!program) return <p className="partner-note">Choose a program to see the floor.</p>
  const day = loadOperationsDay(program, today, model)
  const rows = day.schedules.map((shift) => ({ ...shift, actual: onFloor[shift.id] ?? shift.onFloorHc }))
  const done = playbookDone ?? day.playbook.filter((step) => step.done).map((step) => step.id)
  const savedHere = savedExceptions.filter((item) => item.client === program.client && item.site === program.site && item.program === program.program)
  const exceptions = [
    ...day.exceptions.map((row) => savedHere.find((item) => item.id === row.id) ?? row),
    ...savedHere.filter((item) => !day.exceptions.some((row) => row.id === item.id)),
  ]
  const open = exceptions.filter((item) => item.status === 'open').length
  const planned = rows.reduce((sum, row) => sum + row.plannedHc, 0)
  const actual = rows.reduce((sum, row) => sum + row.actual, 0)
  const adherence = day.scorecard.find((row) => row.metric === 'Adherence')
  const service = day.scorecard.find((row) => row.status === 'miss') ?? day.scorecard[0]
  return (
    <>
      <div className="partner-ops-head">
        <div>
          <p className="seats-kicker">{program.client} · {program.site}</p>
          <h3>{program.program}</h3>
          <p>Service date {labelDate(day.serviceDate)} · {day.scheduleId}</p>
        </div>
        <div className="seats-toggle" role="group" aria-label="Shift model">
          {(['single', 'two', '24x7'] as const).map((item) => (
            <button key={item} type="button" className={model === item ? 'is-on' : ''} onClick={() => onModel(item)}>
              {item === 'single' ? 'Single shift' : item === 'two' ? 'Two shifts' : '24×7'}
            </button>
          ))}
        </div>
      </div>
      <div className="partner-stats">
        <Stat label="On the floor" value={`${actual} / ${planned}`} tone={actual < planned ? 'bad' : 'good'} />
        <Stat label="Adherence" value={adherence?.actual ?? '—'} tone={adherence?.status === 'met' ? 'good' : 'bad'} />
        <Stat label="Open exceptions" value={String(open)} tone={open ? 'bad' : 'good'} />
        <Stat label={service?.metric ?? 'Scorecard'} value={service?.actual ?? '—'} tone={service?.status === 'miss' ? 'bad' : 'good'} />
      </div>
      <section className="partner-move">
        <h3>Scorecard</h3>
        <table className="partner-table">
          <thead>
            <tr><th>Measure</th><th>Actual</th><th>Target</th><th>Status</th></tr>
          </thead>
          <tbody>
            {day.scorecard.map((row) => (
              <tr key={row.id}>
                <td>{row.metric}</td>
                <td>{row.actual}</td>
                <td>{row.target}</td>
                <td><em className={`partner-pill partner-pill--${row.status}`}>{row.status === 'met' ? 'Met' : row.status === 'watch' ? 'Watch' : 'Miss'}</em></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="partner-split">
        <section>
          <h3>Schedule</h3>
          <table className="partner-table">
            <thead>
              <tr><th>Shift</th><th>Hours</th><th>Plan</th><th>On the floor</th><th>Variance</th><th>Supervisor</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const variance = row.actual - row.plannedHc
                return (
                  <tr key={row.id}>
                    <td>{row.name}<span className="partner-sub">Break {row.breakWindow}</span></td>
                    <td>{row.start}–{row.end}</td>
                    <td>{row.plannedHc}</td>
                    <td>
                      <span className="partner-stepper">
                        <button type="button" onClick={() => setOnFloor(row.id, Math.max(0, row.actual - 1))} aria-label={`Fewer people on ${row.name}`}>−</button>
                        {row.actual}
                        <button type="button" onClick={() => setOnFloor(row.id, row.actual + 1)} aria-label={`More people on ${row.name}`}>+</button>
                      </span>
                    </td>
                    <td className={variance < 0 ? 'is-short' : variance > 0 ? 'is-over' : ''}>{signed(variance)}</td>
                    <td>{row.supervisor}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
        <section>
          <h3>Intraday playbook</h3>
          <ul className="partner-playbook">
            {day.playbook.map((step) => (
              <li key={step.id}>
                <label>
                  <input type="checkbox" checked={done.includes(step.id)} onChange={() => toggleStep(step.id, done)} />
                  <span><b>{step.at} · {step.title}.</b> {step.detail} <em>{step.owner}</em></span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="partner-move">
        <h3>Exceptions</h3>
        <div className="partner-move__row">
          <label>Shift
            <select value={rows.some((row) => row.name === exceptionShift) ? exceptionShift : rows[0]?.name ?? ''} onChange={(event) => onShift(event.target.value)}>
              {rows.map((row) => <option key={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label className="partner-note-field">Note
            <input value={exceptionNote} onChange={(event) => onNote(event.target.value)} placeholder="Absence, system, or volume" />
          </label>
          <button type="button" className="seats-btn" onClick={() => onLog(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }))}>Log exception</button>
        </div>
        <ul className="partner-exceptions">
          {exceptions.map((item) => (
            <li key={item.id} className={item.status === 'closed' ? 'is-closed' : ''}>
              <span><b>{item.at ? `${item.at} · ` : ''}{item.shift}{item.kind ? ` · ${item.kind}` : ''}.</b> {item.note}{item.owner ? ` — ${item.owner}` : ''}</span>
              {item.status === 'open' ? <button type="button" className="seats-btn seats-btn--ghost" onClick={() => onClose(item)}>Close</button> : <em>Closed</em>}
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

function Filter({ label, value, options, labels, onChange }: { label: string; value: string; options: string[]; labels: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <label className="seats-filter">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option} value={option}>{labels[option] ?? option}</option>)}
      </select>
    </label>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <article className={tone ? `is-${tone}` : ''}>
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  )
}

function Check({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return <button type="button" className={on ? 'is-on' : ''} aria-pressed={on} onClick={onClick}>{on ? 'Ready' : 'Mark'} {label.toLowerCase()}</button>
}

function originNote(origin: 'plan' | 'gap' | 'sample'): string {
  if (origin === 'plan') return 'Class sizes are the new hires on the capacity plan, for the next six months.'
  if (origin === 'gap') return 'The capacity plan has no new-hire row in the next six months. Class sizes follow the staffing gap already on the plan.'
  return 'The capacity plan has no hiring classes in the next six months. This is a sample for Retail and Telco.'
}

function programOf(programs: PartnerProgram[], id: string): PartnerProgram | undefined {
  return programs.find((item) => item.id === id)
}

function statusLabel(status: string): string {
  if (status === 'confirmed') return 'Confirmed'
  if (status === 'ready') return 'Ready'
  if (status === 'due') return 'Due'
  if (status === 'late') return 'Late'
  return 'Open'
}

function signed(value: number): string {
  const rounded = Math.round(value)
  if (rounded > 0) return `+${rounded}`
  return String(rounded)
}

function labelDate(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function hired(classes: HiringClass[], programId: string): number {
  return classes.filter((item) => item.programId === programId).reduce((sum, item) => sum + item.hires, 0)
}

function loadStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return { confirmed: [], moves: [], ready: {}, exceptions: [], playbook: {}, onFloor: {} }
    const parsed = JSON.parse(raw) as Partial<Store>
    return {
      confirmed: Array.isArray(parsed.confirmed) ? parsed.confirmed : [],
      moves: Array.isArray(parsed.moves) ? parsed.moves : [],
      ready: parsed.ready ?? {},
      exceptions: Array.isArray(parsed.exceptions) ? parsed.exceptions : [],
      playbook: parsed.playbook ?? {},
      onFloor: parsed.onFloor ?? {},
    }
  } catch {
    return { confirmed: [], moves: [], ready: {}, exceptions: [], playbook: {}, onFloor: {} }
  }
}

function toPlanWeek(scenario: PlannerScenario, row: DerivedCapacityRow): PlanWeek {
  const site = resolvePlanLocation(scenario.plan) || 'Unassigned site'
  const program = scenario.plan.lob || scenario.name
  return {
    programId: `${scenario.plan.client}|${site}|${program}`,
    client: scenario.plan.client,
    site,
    program,
    week: row.week,
    newHires: row.planned.plannedNewHires,
    overUnderFte: row.planned.overUnderFte,
    productionFte: row.planned.productionFte,
    requiredFte: row.planned.requiredFte,
    onsiteHc: row.planned.onsiteHc,
    productionHc: row.planned.productionHc,
  }
}

function safeDerive(
  scenario: PlannerScenario,
  planner: {
    getScenarioLedger: (id: string) => WeeklyLedgerRow[]
    getScenarioForecast: (id: string, horizonWeeks?: number) => ScenarioForecastPackage | null
    getScenarioCapacityPlanOverrides: (id: string) => Record<string, WeekCapacityPlanOverride>
    getScenarioRoster: (id: string) => Parameters<typeof rosterHeadcountOverrides>[0]
    getScenarioStageAttritionOverrides: (id: string) => Parameters<typeof deriveCapacityPlanRows>[7]
  },
): DerivedCapacityRow[] {
  try {
    const roster = planner.getScenarioRoster(scenario.id)
    const planStartWeek = resolveCapacityPlanStartWeek(scenario.plan)
    const currentWeek = resolveCurrentCalendarWeek(scenario.plan.weekStart, scenario.plan.timezone)
    return deriveCapacityPlanRows(
      planner.getScenarioLedger(scenario.id),
      scenario,
      planner.getScenarioForecast(scenario.id, 52),
      planner.getScenarioCapacityPlanOverrides(scenario.id),
      { ...DEFAULT_CAPACITY_FORECAST_MODES, ...loadScenarioForecastModes(scenario.id) },
      countInactiveProductionRoster(roster, currentWeek, scenario.plan.weekStart),
      getScenarioAhtOverrides(scenario.id),
      planner.getScenarioStageAttritionOverrides(scenario.id) ?? undefined,
      undefined,
      rosterHeadcountOverrides(roster, planStartWeek, scenario.plan.client).productionHc,
    ).filter((row) => row.timeline === 'forward_plan')
  } catch {
    return []
  }
}

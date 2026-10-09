import { isoDate } from './capacityWeekUtils'

export const HIRE_HORIZON_DAYS = 26 * 7
export const CONFIRM_LEAD_DAYS = 28
export const READY_LEAD_DAYS = 5

export type ShiftModel = 'single' | 'two' | '24x7'

export type PartnerProgram = {
  id: string
  client: string
  site: string
  program: string
  week: string
  productionFte: number
  requiredFte: number | null
  overUnderFte: number
  source: 'plan' | 'sample'
}

export type HiringClass = {
  id: string
  programId: string
  client: string
  site: string
  program: string
  classDate: string
  hires: number
  onsiteShare: number
  source: 'plan' | 'sample'
}

export type PlanWeek = {
  programId: string
  client: string
  site: string
  program: string
  week: string
  newHires: number
  overUnderFte: number
  productionFte: number
  requiredFte: number | null
  onsiteHc: number | null
  productionHc: number | null
}

export type ClassMove = {
  id: string
  fromId: string
  toId: string
  hires: number
}

export type ItReady = { seat: boolean; device: boolean; login: boolean }

export type PartnerException = {
  id: string
  client: string
  site: string
  program: string
  shift: string
  note: string
  status: 'open' | 'closed'
  at?: string
  kind?: string
  owner?: string
}

/** One published schedule row. This is the shape a schedule table would return. */
export type ScheduleRecord = {
  id: string
  shiftCode: string
  name: string
  start: string
  end: string
  plannedHc: number
  onFloorHc: number
  supervisor: string
  breakWindow: string
}

/** One intraday playbook step for a service date. */
export type PlaybookRecord = {
  id: string
  at: string
  title: string
  detail: string
  owner: string
  done: boolean
}

/** One scorecard measure for a service date. */
export type ScorecardRecord = {
  id: string
  metric: string
  actual: string
  target: string
  status: 'met' | 'watch' | 'miss'
}

export type OperationsDay = {
  source: 'sample'
  serviceDate: string
  scheduleId: string
  model: ShiftModel
  schedules: ScheduleRecord[]
  playbook: PlaybookRecord[]
  scorecard: ScorecardRecord[]
  exceptions: PartnerException[]
}

export type StaffingPoint = {
  programId: string
  client: string
  site: string
  program: string
  week: string
  overUnderFte: number
}

export type OverstaffMonth = {
  key: string
  label: string
  weeks: StaffingPoint[]
}

export type ProgramOverstaffing = {
  programId: string
  client: string
  site: string
  program: string
  totalWeeks: number
  overWeeks: StaffingPoint[]
  months: OverstaffMonth[]
}

export type PartnerBoard = {
  programs: PartnerProgram[]
  classes: HiringClass[]
  staffing: StaffingPoint[]
  usedSample: boolean
  classOrigin: 'plan' | 'gap' | 'sample'
}

/** Week offsets, from the first sample week, that stay overstaffed. */
export const SAMPLE_OVERSTAFF_OFFSETS: Record<string, number[]> = {
  'Retail|Manila|Chat': [0, 1, 2, 3, 4, 5, 6, 7, 11, 12, 13, 14, 19, 20],
  'Telco|Cebu|Billing': [2, 3, 4, 5, 6, 7, 15, 16, 17, 18],
  'Retail|Manila|Back office': [1, 4, 8, 9, 17, 18],
}

const SAMPLE_WEEKS = 26

export function summarizeOverstaffing(points: StaffingPoint[]): ProgramOverstaffing[] {
  const grouped = new Map<string, StaffingPoint[]>()
  for (const point of points) {
    const list = grouped.get(point.programId) ?? []
    list.push(point)
    grouped.set(point.programId, list)
  }
  return [...grouped.values()].map((list) => {
    const sorted = [...list].sort((a, b) => a.week.localeCompare(b.week))
    const overWeeks = sorted.filter((point) => point.overUnderFte >= 1)
    const months = new Map<string, StaffingPoint[]>()
    for (const point of overWeeks) {
      const key = point.week.slice(0, 7)
      const bucket = months.get(key) ?? []
      bucket.push(point)
      months.set(key, bucket)
    }
    const first = sorted[0]!
    return {
      programId: first.programId,
      client: first.client,
      site: first.site,
      program: first.program,
      totalWeeks: sorted.length,
      overWeeks,
      months: [...months.entries()].map(([key, weeks]) => ({ key, label: monthLabel(key), weeks })),
    }
  }).sort((a, b) => b.overWeeks.length - a.overWeeks.length || a.program.localeCompare(b.program))
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00`)
  date.setDate(date.getDate() + days)
  return isoDate(date)
}

export function confirmBy(classDate: string): string {
  return addDays(classDate, -CONFIRM_LEAD_DAYS)
}

export function readyBy(classDate: string): string {
  return addDays(classDate, -READY_LEAD_DAYS)
}

export type SlaStatus = 'confirmed' | 'ready' | 'open' | 'due' | 'late'

export function confirmationStatus(classDate: string, today: string, confirmed: boolean): SlaStatus {
  if (confirmed) return 'confirmed'
  const deadline = confirmBy(classDate)
  if (today > deadline) return 'late'
  if (addDays(today, 7) >= deadline) return 'due'
  return 'open'
}

export function itStatus(classDate: string, today: string, ready: ItReady): SlaStatus {
  if (ready.seat && ready.device && ready.login) return 'ready'
  const deadline = readyBy(classDate)
  if (today > deadline) return 'late'
  if (addDays(today, 7) >= deadline) return 'due'
  return 'open'
}

export function itDemand(hires: number, onsiteShare: number): { seats: number; devices: number; logins: number } {
  const people = Math.max(0, Math.round(hires))
  const share = Math.min(1, Math.max(0, onsiteShare))
  return { seats: Math.round(people * share), devices: people, logins: people }
}

export function applyMoves(classes: HiringClass[], moves: ClassMove[]): HiringClass[] {
  const next = classes.map((item) => ({ ...item }))
  for (const move of moves) {
    if (move.hires <= 0 || move.fromId === move.toId) continue
    const from = next.find((item) => item.id === move.fromId)
    const to = next.find((item) => item.id === move.toId)
    if (!from || !to) continue
    const amount = Math.min(Math.round(move.hires), from.hires)
    if (amount <= 0) continue
    from.hires -= amount
    to.hires += amount
  }
  return next.filter((item) => item.hires > 0)
}

export function staffingPct(productionFte: number, requiredFte: number | null): number | null {
  if (requiredFte == null || requiredFte <= 0) return null
  return (productionFte / requiredFte) * 100
}

export function adherencePct(productionFte: number, requiredFte: number | null, openExceptions: number): number {
  const fit = staffingPct(productionFte, requiredFte)
  const base = fit == null ? 96 : Math.max(80, Math.min(99, 100 - Math.abs(100 - fit) * 0.35))
  return Math.max(70, Math.round(base - openExceptions * 2))
}

export function shiftsFor(productionFte: number, model: ShiftModel): Array<{ name: string; planned: number }> {
  const people = Math.max(0, Math.round(productionFte))
  if (model === 'single') return [{ name: 'Shift A', planned: people }]
  if (model === 'two') {
    const first = Math.round(people * 0.6)
    return [
      { name: 'Shift A', planned: first },
      { name: 'Shift B', planned: people - first },
    ]
  }
  const first = Math.round(people * 0.45)
  const second = Math.round(people * 0.3)
  return [
    { name: 'Shift A', planned: first },
    { name: 'Shift B', planned: second },
    { name: 'Shift C', planned: Math.max(0, people - first - second) },
  ]
}

export const PLAYBOOK = [
  { id: 'read', title: 'Read the hour', detail: 'Compare the people on the floor with the plan before moving anyone.' },
  { id: 'move', title: 'Move inside the cap', detail: 'A team lead may move people. The move stays inside the written cap.' },
  { id: 'log', title: 'Log the exception', detail: 'An absence, a system fault, or a volume miss is written down before the hour closes.' },
] as const

type FloorKind = 'voice' | 'digital' | 'backoffice'

/**
 * Sample operations day. The records match the tables a database would hold:
 * schedule, playbook_step, scorecard_metric, floor_exception.
 * Swap this function for a query when that database is connected.
 */
export function loadOperationsDay(program: PartnerProgram, serviceDate: string, model: ShiftModel): OperationsDay {
  const kind = floorKind(program.program)
  const profile = FLOOR_PROFILES[kind]
  const schedules = scaleShifts(profile.shifts[model], program, serviceDate, model)
  return {
    source: 'sample',
    serviceDate,
    scheduleId: `SCH-${serviceDate.replace(/-/g, '')}-${slug(program.program)}`,
    model,
    schedules,
    playbook: profile.playbook.map((step) => ({
      ...step,
      id: `${program.id}:${step.id}`,
    })),
    scorecard: profile.scorecard.map((row) => ({ ...row, id: `${program.id}:${row.id}` })),
    exceptions: profile.exceptions.map((row) => ({
      ...row,
      id: `${program.id}:${row.id}`,
      client: program.client,
      site: program.site,
      program: program.program,
    })),
  }
}

const FLOOR_PROFILES: Record<FloorKind, {
  shifts: Record<ShiftModel, Array<Omit<ScheduleRecord, 'id'>>>
  playbook: PlaybookRecord[]
  scorecard: ScorecardRecord[]
  exceptions: Array<Omit<PartnerException, 'client' | 'site' | 'program'>>
}> = {
  voice: {
    shifts: {
      two: [
        { shiftCode: 'A', name: 'Shift A', start: '06:00', end: '15:00', plannedHc: 82, onFloorHc: 79, supervisor: 'A. Cruz', breakWindow: '09:30–10:00' },
        { shiftCode: 'B', name: 'Shift B', start: '14:00', end: '23:00', plannedHc: 54, onFloorHc: 54, supervisor: 'L. Reyes', breakWindow: '17:30–18:00' },
      ],
      single: [
        { shiftCode: 'A', name: 'Shift A', start: '08:00', end: '17:00', plannedHc: 136, onFloorHc: 131, supervisor: 'A. Cruz', breakWindow: '12:00–12:30' },
      ],
      '24x7': [
        { shiftCode: 'A', name: 'Shift A', start: '06:00', end: '14:00', plannedHc: 62, onFloorHc: 60, supervisor: 'A. Cruz', breakWindow: '09:00–09:30' },
        { shiftCode: 'B', name: 'Shift B', start: '14:00', end: '22:00', plannedHc: 42, onFloorHc: 41, supervisor: 'L. Reyes', breakWindow: '17:00–17:30' },
        { shiftCode: 'C', name: 'Shift C', start: '22:00', end: '06:00', plannedHc: 32, onFloorHc: 28, supervisor: 'M. Tan', breakWindow: '01:00–01:30' },
      ],
    },
    playbook: [
      { id: 'open', at: '06:15', title: 'Open the floor', detail: 'Read planned headcount against who badged in. Do not move anyone yet.', owner: 'A. Cruz', done: true },
      { id: 'peak', at: '09:00', title: 'Peak check', detail: 'Compare the hour with the forecast. A lead may move up to 6 people.', owner: 'A. Cruz', done: false },
      { id: 'midday', at: '12:00', title: 'Midday balance', detail: 'Shift the break wave if the interval is more than 5% short.', owner: 'Floor lead', done: false },
      { id: 'handover', at: '15:00', title: 'Handover', detail: 'Shift B takes the open exceptions and the people still out.', owner: 'L. Reyes', done: false },
      { id: 'close', at: '18:00', title: 'Close the book', detail: 'Every exception still open is written down before the hour ends.', owner: 'L. Reyes', done: false },
    ],
    scorecard: [
      { id: 'sl', metric: 'Service level', actual: '82%', target: '80%', status: 'met' },
      { id: 'occ', metric: 'Occupancy', actual: '86%', target: '85%', status: 'met' },
      { id: 'adh', metric: 'Adherence', actual: '93%', target: '95%', status: 'watch' },
      { id: 'sh', metric: 'Shrinkage', actual: '27%', target: '25%', status: 'watch' },
      { id: 'fc', metric: 'Forecast accuracy', actual: '91%', target: '90%', status: 'met' },
    ],
    exceptions: [
      { id: 'ex-0940', at: '09:40', shift: 'Shift A', kind: 'Absence', note: 'Three people badged in after 09:10. The 09:00 interval ran short.', owner: 'A. Cruz', status: 'open' },
      { id: 'ex-1110', at: '11:10', shift: 'Shift A', kind: 'Volume', note: 'Offered volume was 12% above the forecast for the hour.', owner: 'Floor lead', status: 'open' },
      { id: 'ex-1605', at: '16:05', shift: 'Shift B', kind: 'System', note: 'The phone platform was slow for 8 minutes. Calls were recovered.', owner: 'L. Reyes', status: 'closed' },
    ],
  },
  digital: {
    shifts: {
      two: [
        { shiftCode: 'A', name: 'Shift A', start: '08:00', end: '17:00', plannedHc: 34, onFloorHc: 33, supervisor: 'S. Reddy', breakWindow: '11:30–12:00' },
        { shiftCode: 'B', name: 'Shift B', start: '12:00', end: '21:00', plannedHc: 23, onFloorHc: 20, supervisor: 'N. Kulkarni', breakWindow: '16:00–16:30' },
      ],
      single: [
        { shiftCode: 'A', name: 'Shift A', start: '09:00', end: '18:00', plannedHc: 57, onFloorHc: 54, supervisor: 'S. Reddy', breakWindow: '13:00–13:30' },
      ],
      '24x7': [
        { shiftCode: 'A', name: 'Shift A', start: '07:00', end: '15:00', plannedHc: 26, onFloorHc: 25, supervisor: 'S. Reddy', breakWindow: '10:30–11:00' },
        { shiftCode: 'B', name: 'Shift B', start: '15:00', end: '23:00', plannedHc: 20, onFloorHc: 19, supervisor: 'N. Kulkarni', breakWindow: '18:30–19:00' },
        { shiftCode: 'C', name: 'Shift C', start: '23:00', end: '07:00', plannedHc: 11, onFloorHc: 11, supervisor: 'M. Tan', breakWindow: '02:30–03:00' },
      ],
    },
    playbook: [
      { id: 'open', at: '08:15', title: 'Open the queue', detail: 'Chat concurrency starts at 1.6. Email stays in its own queue.', owner: 'S. Reddy', done: true },
      { id: 'response', at: '11:00', title: 'Response check', detail: 'If replies within 60 seconds fall under 80%, move two people from email to chat.', owner: 'S. Reddy', done: false },
      { id: 'overlap', at: '14:00', title: 'Overlap', detail: 'Shift B joins. The cap for a move is 4 people.', owner: 'N. Kulkarni', done: false },
      { id: 'evening', at: '17:30', title: 'Evening queue', detail: 'Log any chat still waiting past the target before the day shift leaves.', owner: 'N. Kulkarni', done: false },
    ],
    scorecard: [
      { id: 'rt', metric: 'Reply within 60 seconds', actual: '76%', target: '80%', status: 'miss' },
      { id: 'occ', metric: 'Occupancy', actual: '81%', target: '85%', status: 'watch' },
      { id: 'adh', metric: 'Adherence', actual: '94%', target: '95%', status: 'watch' },
      { id: 'cc', metric: 'Concurrency', actual: '1.6', target: '1.8', status: 'watch' },
      { id: 'fc', metric: 'Forecast accuracy', actual: '88%', target: '90%', status: 'watch' },
    ],
    exceptions: [
      { id: 'ex-1048', at: '10:48', shift: 'Shift A', kind: 'Volume', note: 'Chat offered 18% above the hour. Two email agents were moved across.', owner: 'S. Reddy', status: 'open' },
      { id: 'ex-1320', at: '13:20', shift: 'Shift B', kind: 'System', note: 'The chat desktop froze for four agents. They were back within 6 minutes.', owner: 'N. Kulkarni', status: 'closed' },
    ],
  },
  backoffice: {
    shifts: {
      two: [
        { shiftCode: 'A', name: 'Shift A', start: '08:00', end: '17:00', plannedHc: 22, onFloorHc: 22, supervisor: 'H. Farouk', breakWindow: '12:00–12:30' },
        { shiftCode: 'B', name: 'Shift B', start: '10:00', end: '19:00', plannedHc: 12, onFloorHc: 11, supervisor: 'L. Gómez', breakWindow: '15:00–15:30' },
      ],
      single: [
        { shiftCode: 'A', name: 'Shift A', start: '08:00', end: '17:00', plannedHc: 34, onFloorHc: 33, supervisor: 'H. Farouk', breakWindow: '12:00–12:30' },
      ],
      '24x7': [
        { shiftCode: 'A', name: 'Shift A', start: '06:00', end: '14:00', plannedHc: 16, onFloorHc: 16, supervisor: 'H. Farouk', breakWindow: '09:30–10:00' },
        { shiftCode: 'B', name: 'Shift B', start: '14:00', end: '22:00', plannedHc: 12, onFloorHc: 11, supervisor: 'L. Gómez', breakWindow: '17:30–18:00' },
        { shiftCode: 'C', name: 'Shift C', start: '22:00', end: '06:00', plannedHc: 6, onFloorHc: 6, supervisor: 'M. Tan', breakWindow: '01:00–01:30' },
      ],
    },
    playbook: [
      { id: 'open', at: '08:15', title: 'Open the queue', detail: 'Cases waiting from yesterday are assigned before new work.', owner: 'H. Farouk', done: true },
      { id: 'midday', at: '12:00', title: 'Midday reallocation', detail: 'Move cases, not seats. The limit is 15 cases per person.', owner: 'H. Farouk', done: false },
      { id: 'sameday', at: '15:30', title: 'Same-day check', detail: 'Anything still open that was due today is logged before the last break.', owner: 'L. Gómez', done: false },
      { id: 'close', at: '16:45', title: 'Close the book', detail: 'The scorecard uses cases closed from the certified set, not the local sheet.', owner: 'H. Farouk', done: false },
    ],
    scorecard: [
      { id: 'cases', metric: 'Cases closed', actual: '186', target: '180', status: 'met' },
      { id: 'aht', metric: 'Handle time', actual: '11.4 min', target: '12 min', status: 'met' },
      { id: 'adh', metric: 'Adherence', actual: '97%', target: '95%', status: 'met' },
      { id: 'rw', metric: 'Rework', actual: '4.2%', target: '5%', status: 'met' },
      { id: 'sd', metric: 'Same-day completion', actual: '91%', target: '90%', status: 'met' },
    ],
    exceptions: [
      { id: 'ex-1215', at: '12:15', shift: 'Shift A', kind: 'Volume', note: 'A client file of 40 cases arrived after the lock. They were queued for tomorrow.', owner: 'H. Farouk', status: 'open' },
      { id: 'ex-0905', at: '09:05', shift: 'Shift A', kind: 'Absence', note: 'One processor was out. The cases were split across the team.', owner: 'H. Farouk', status: 'closed' },
    ],
  },
}

function floorKind(program: string): FloorKind {
  const name = program.toLowerCase()
  if (name.includes('chat') || name.includes('digital') || name.includes('email')) return 'digital'
  if (name.includes('back') || name.includes('bill') || name.includes('case')) return 'backoffice'
  return 'voice'
}

function scaleShifts(
  rows: Array<Omit<ScheduleRecord, 'id'>>,
  program: PartnerProgram,
  serviceDate: string,
  model: ShiftModel,
): ScheduleRecord[] {
  const base = rows.reduce((sum, row) => sum + row.plannedHc, 0)
  const target = Math.max(0, Math.round(program.productionFte))
  const scaled = rows.map((row) => {
    const plannedHc = base > 0 ? Math.round(row.plannedHc * target / base) : 0
    const onFloorHc = row.plannedHc > 0 ? Math.round(row.onFloorHc * plannedHc / row.plannedHc) : 0
    return { ...row, plannedHc, onFloorHc }
  })
  const drift = target - scaled.reduce((sum, row) => sum + row.plannedHc, 0)
  const last = scaled[scaled.length - 1]
  if (last) last.plannedHc = Math.max(0, last.plannedHc + drift)
  return scaled.map((row) => ({
    ...row,
    id: `${program.id}:${serviceDate}:${model}:${row.shiftCode}`,
  }))
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'program'
}

export function resolveBoard(rows: PlanWeek[], today: string): PartnerBoard {
  const end = addDays(today, HIRE_HORIZON_DAYS)
  const future = rows.filter((row) => row.week >= today && row.week <= end)
  const programs = programsFrom(future)
  const classes = classesFrom(future)
  const staffing = staffingFrom(future)
  if (programs.length && classes.length) return { programs, classes, staffing, usedSample: false, classOrigin: 'plan' }
  if (programs.length) {
    const made = classesFromGap(programs, today)
    if (made.length) return { programs, classes: made, staffing, usedSample: false, classOrigin: 'gap' }
  }
  return sampleBoard(today)
}

export function sampleBoard(today: string): PartnerBoard {
  const programs: PartnerProgram[] = [
    program('Retail', 'Manila', 'Voice Care', addDays(today, 7), 136, 142, 'sample'),
    program('Retail', 'Manila', 'Chat', addDays(today, 7), 57, 48, 'sample'),
    program('Retail', 'Manila', 'Back office', addDays(today, 7), 34, 32, 'sample'),
    program('Telco', 'Cebu', 'Prepaid Voice', addDays(today, 7), 118, 129, 'sample'),
    program('Telco', 'Cebu', 'Billing', addDays(today, 7), 46, 39, 'sample'),
    program('Telco', 'Cebu', 'Tech Support', addDays(today, 7), 71, 75, 'sample'),
  ]
  const classes: HiringClass[] = [
    hiring(programs[2]!, addDays(today, 10), 8, 1),
    hiring(programs[0]!, addDays(today, 21), 12, 0.86),
    hiring(programs[1]!, addDays(today, 35), 10, 0.4),
    hiring(programs[3]!, addDays(today, 49), 16, 0.9),
    hiring(programs[4]!, addDays(today, 77), 8, 0.7),
    hiring(programs[5]!, addDays(today, 112), 14, 0.8),
    hiring(programs[0]!, addDays(today, 154), 18, 0.86),
  ]
  return { programs, classes, staffing: sampleStaffing(programs, today), usedSample: true, classOrigin: 'sample' }
}

function sampleStaffing(programs: PartnerProgram[], today: string): StaffingPoint[] {
  const points: StaffingPoint[] = []
  for (const item of programs) {
    const over = new Set(SAMPLE_OVERSTAFF_OFFSETS[item.id] ?? [])
    for (let index = 0; index < SAMPLE_WEEKS; index += 1) {
      const week = addDays(today, 7 * (index + 1))
      points.push({
        programId: item.id,
        client: item.client,
        site: item.site,
        program: item.program,
        week,
        overUnderFte: over.has(index) ? 4 + (index % 5) : Math.min(-1, item.overUnderFte),
      })
    }
  }
  return points
}

function staffingFrom(rows: PlanWeek[]): StaffingPoint[] {
  const grouped = new Map<string, StaffingPoint>()
  for (const row of rows) {
    const key = `${row.programId}|${row.week}`
    const existing = grouped.get(key)
    if (existing) {
      existing.overUnderFte += row.overUnderFte
      continue
    }
    grouped.set(key, {
      programId: row.programId,
      client: row.client,
      site: row.site,
      program: row.program,
      week: row.week,
      overUnderFte: row.overUnderFte,
    })
  }
  return [...grouped.values()].sort((a, b) => a.week.localeCompare(b.week) || a.program.localeCompare(b.program))
}

function monthLabel(key: string): string {
  const date = new Date(`${key}-01T12:00:00`)
  if (Number.isNaN(date.getTime())) return key
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function programsFrom(rows: PlanWeek[]): PartnerProgram[] {
  const grouped = new Map<string, PlanWeek[]>()
  for (const row of rows) {
    const list = grouped.get(row.programId) ?? []
    list.push(row)
    grouped.set(row.programId, list)
  }
  const programs: PartnerProgram[] = []
  for (const [id, list] of grouped) {
    const row = [...list].sort((a, b) => a.week.localeCompare(b.week))[0]
    if (!row) continue
    if (row.productionFte <= 0 && (row.requiredFte == null || row.requiredFte <= 0) && row.newHires <= 0) continue
    programs.push({
      id,
      client: row.client,
      site: row.site,
      program: row.program,
      week: row.week,
      productionFte: row.productionFte,
      requiredFte: row.requiredFte,
      overUnderFte: row.overUnderFte,
      source: 'plan',
    })
  }
  return programs.sort((a, b) => a.client.localeCompare(b.client) || a.site.localeCompare(b.site) || a.program.localeCompare(b.program))
}

function classesFrom(rows: PlanWeek[]): HiringClass[] {
  const hiringWeeks = rows.filter((row) => row.newHires >= 1)
  const byProgram = new Map<string, PlanWeek[]>()
  for (const row of hiringWeeks) {
    const list = byProgram.get(row.programId) ?? []
    list.push(row)
    byProgram.set(row.programId, list)
  }
  const classes: HiringClass[] = []
  for (const list of byProgram.values()) {
    const sorted = [...list].sort((a, b) => a.week.localeCompare(b.week))
    const batches = sorted.length > 6 ? byMonth(sorted) : sorted.map((row) => [row])
    for (const batch of batches) {
      const first = batch[0]
      if (!first) continue
      classes.push({
        id: `${first.programId}:${sorted.length > 6 ? first.week.slice(0, 7) : first.week}`,
        programId: first.programId,
        client: first.client,
        site: first.site,
        program: first.program,
        classDate: first.week,
        hires: batch.reduce((sum, row) => sum + Math.round(row.newHires), 0),
        onsiteShare: onsiteShare(first),
        source: 'plan',
      })
    }
  }
  return classes.sort((a, b) => a.classDate.localeCompare(b.classDate) || a.program.localeCompare(b.program))
}

function byMonth(rows: PlanWeek[]): PlanWeek[][] {
  const groups = new Map<string, PlanWeek[]>()
  for (const row of rows) {
    const key = row.week.slice(0, 7)
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }
  return [...groups.values()]
}

function classesFromGap(programs: PartnerProgram[], today: string): HiringClass[] {
  const shorts = programs.filter((item) => item.overUnderFte <= -1)
  const donors = [...programs].filter((item) => item.overUnderFte >= 1).sort((a, b) => b.overUnderFte - a.overUnderFte)
  const classes = shorts.map((item, index) =>
    hiring(item, addDays(today, 28 + index * 14), Math.min(24, Math.max(4, Math.ceil(-item.overUnderFte))), 0.86),
  )
  const donor = donors[0]
  if (donor) {
    classes.push(hiring(donor, addDays(today, 42), Math.min(24, Math.max(4, Math.ceil(donor.overUnderFte))), 0.7))
  }
  return classes
}

function program(
  client: string,
  site: string,
  name: string,
  week: string,
  productionFte: number,
  requiredFte: number,
  source: 'plan' | 'sample',
): PartnerProgram {
  return {
    id: `${client}|${site}|${name}`,
    client,
    site,
    program: name,
    week,
    productionFte,
    requiredFte,
    overUnderFte: productionFte - requiredFte,
    source,
  }
}

function hiring(item: PartnerProgram, classDate: string, hires: number, onsiteShareValue: number): HiringClass {
  return {
    id: `${item.id}:${classDate}`,
    programId: item.id,
    client: item.client,
    site: item.site,
    program: item.program,
    classDate,
    hires,
    onsiteShare: onsiteShareValue,
    source: item.source,
  }
}

function onsiteShare(row: PlanWeek): number {
  if (row.onsiteHc == null || row.productionHc == null || row.productionHc <= 0) return 0.86
  return Math.min(1, Math.max(0, row.onsiteHc / row.productionHc))
}

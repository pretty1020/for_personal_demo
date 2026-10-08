/** Sample path from source systems to one certified number. Week of 4 Oct 2026. */

export const STAGES = [
  {
    id: 'sources',
    name: 'Sources',
    plain: 'The numbers already live in the systems of record. Nobody copies them into a private sheet.',
    points: ['NICE IEX and Verint', 'The phone switch (ACD)', 'HR, payroll, and badge', 'Hiring and finance'],
  },
  {
    id: 'ingest',
    name: 'Automated ingestion',
    plain: 'A schedule pulls each feed. If it is late or it fails, the owner hears about it. There is no manual extract.',
    points: ['API or secure file drop, on a clock', 'A freshness promise on every feed', 'An alert when a load fails'],
  },
  {
    id: 'platform',
    name: 'Governed platform',
    plain: 'A raw file is shaped, checked, and only then marked certified. Employee, line of business, site, and client each have one meaning.',
    points: ['Raw, then conformed, then certified', 'One master record for people and sites', 'Rules on every load, plus a trail of where the number came from'],
  },
  {
    id: 'semantic',
    name: 'Semantic layer',
    plain: 'Service level, handle time, shrinkage, and occupancy are written down once. A person only sees the rows they are allowed to see.',
    points: ['One dictionary', 'The same four measures everywhere', 'Row-level access by site and client'],
  },
  {
    id: 'dashboards',
    name: 'Dashboards',
    plain: 'The executive view and the site view read the same certified table. Forecasts come from the forecasting tool, not from a side file.',
    points: ['Executive, regional, and site', 'One client and capacity view', 'Forecasts from the forecasting tool'],
  },
] as const

export type StageId = (typeof STAGES)[number]['id']
export type FeedStatus = 'on-time' | 'late' | 'failed'

export type Feed = {
  id: string
  source: string
  what: string
  how: string
  sla: string
  age: string
  status: FeedStatus
  owner: string
  note: string
}

export const FEEDS: Feed[] = [
  feed('iex', 'NICE IEX', 'Schedules', 'API, every 15 minutes', '15 minutes', '6 minutes ago', 'on-time', 'APAC steward', 'Manila and Cebu loaded cleanly.'),
  feed('verint', 'Verint', 'Adherence', 'API, every 15 minutes', '15 minutes', '9 minutes ago', 'on-time', 'EMEA steward', 'Dublin and Warsaw are current.'),
  feed('acd', 'ACD', 'Contacts and handle time', 'File drop, every 15 minutes', '20 minutes', '47 minutes ago', 'late', 'India steward', 'Hyderabad’s file stalled. The interval hours are not fresh.'),
  feed('hris', 'HRIS', 'People and hierarchy', 'API, nightly', 'By 06:00', 'Loaded at 05:12', 'on-time', 'People steward', 'One employee ID for every system.'),
  feed('payroll', 'Payroll', 'Paid hours', 'File drop, nightly', 'By 07:00', 'Did not arrive', 'failed', 'Americas steward', 'Tampa’s file failed. Paid hours are missing for the day.'),
  feed('badge', 'Badge', 'Building entry', 'API, hourly', '60 minutes', '22 minutes ago', 'on-time', 'APAC steward', 'Used only to check presence, not to replace the schedule.'),
  feed('ats', 'Hiring', 'Classes and start dates', 'API, nightly', 'By 06:00', 'Loaded at 05:40', 'on-time', 'Talent steward', 'Hyderabad’s class slip is visible here.'),
  feed('finance', 'Finance', 'Site cost', 'API, nightly', 'By 08:00', 'Loaded at 07:10', 'on-time', 'Finance steward', 'Cost is attached after the hours are certified.'),
]

export type HoursRow = {
  site: string
  region: string
  wfm: number
  acd: number | null
  payroll: number | null
}

/** Worked hours for the week of 4 Oct 2026. Compared with the workforce plan as the base. */
export const WORKED_HOURS: HoursRow[] = [
  { site: 'Manila', region: 'APAC', wfm: 32840, acd: 32710, payroll: 32990 },
  { site: 'Dublin', region: 'EMEA', wfm: 10120, acd: 10080, payroll: 10140 },
  { site: 'Hyderabad', region: 'India', wfm: 28110, acd: 26840, payroll: 27990 },
  { site: 'Tampa', region: 'AMER', wfm: 11260, acd: 11210, payroll: null },
]

export const METRICS = [
  {
    id: 'sl',
    name: 'Service level',
    definition: 'Contacts answered inside the client’s threshold, divided by contacts offered. The threshold is set once per client.',
  },
  {
    id: 'aht',
    name: 'Handle time',
    definition: 'Talk, hold, and after-call work, in seconds. The same three parts everywhere.',
  },
  {
    id: 'shrink',
    name: 'Shrinkage',
    definition: 'Paid hours that were not available to take work, divided by paid hours.',
  },
  {
    id: 'occ',
    name: 'Occupancy',
    definition: 'Handle time divided by handle time plus ready time.',
  },
] as const

export type MetricId = (typeof METRICS)[number]['id']

export const HYGIENE = [
  {
    id: 'master',
    name: 'One person, one ID',
    plain: 'The same employee is mapped across IEX, Verint, the phone switch, and HR. A nickname in one system cannot become a second person.',
  },
  {
    id: 'checks',
    name: 'Checks on every load',
    plain: 'Each load is tested for missing rows, lateness, and values that cannot be true. A failed check stops the number from being certified.',
  },
  {
    id: 'reconcile',
    name: 'Hours must agree',
    plain: 'Workforce hours, phone-switch hours, and payroll hours must sit within 1% of each other. A wider gap is flagged the same day.',
  },
  {
    id: 'steward',
    name: 'A named owner',
    plain: 'Each region has a steward. A defect is fixed in the source system, not painted over in the dashboard.',
  },
  {
    id: 'certified',
    name: 'Certified tables only',
    plain: 'The executive view and the site view read the same tables. If a number is not certified, neither screen shows it as fact.',
  },
] as const

export const PERSON = {
  name: 'Ana Cruz',
  id: 'E-10482',
  site: 'Manila',
  maps: [
    { system: 'HRIS', value: 'E-10482' },
    { system: 'NICE IEX', value: '88341' },
    { system: 'Verint', value: 'VR-22910' },
    { system: 'ACD', value: 'Agent 55281' },
  ],
}

export const CERTIFIED = {
  site: 'Manila',
  week: 'Oct 4, 2026',
  contacts: 186420,
  serviceLevel: 0.842,
  aht: 412,
}

export const ANOMALY = {
  site: 'Pune',
  when: 'Oct 3, 2026, 14:00',
  offered: 1840,
  usual: 380,
  inquiry: 'IQ-2041',
  plain: 'That hour is about five times a normal hour. It is held out of forecast history, and a client inquiry is open so a bad hour cannot train next week’s forecast.',
}

export function gapRatio(base: number, other: number | null): number | null {
  if (other == null || base <= 0) return null
  return Math.abs(other - base) / base
}

export function hoursAgree(row: HoursRow): boolean {
  const acd = gapRatio(row.wfm, row.acd)
  const payroll = gapRatio(row.wfm, row.payroll)
  return acd != null && payroll != null && acd <= 0.01 && payroll <= 0.01
}

export function feedTone(status: FeedStatus): string {
  if (status === 'on-time') return 'The load is inside its freshness promise.'
  if (status === 'late') return 'The load is late. Those rows stay uncertified until a fresh file arrives.'
  return 'The load failed. There is nothing new to certify.'
}

function feed(
  id: string,
  source: string,
  what: string,
  how: string,
  sla: string,
  age: string,
  status: FeedStatus,
  owner: string,
  note: string,
): Feed {
  return { id, source, what, how, sla, age, status, owner, note }
}

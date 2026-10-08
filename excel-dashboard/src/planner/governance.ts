/** Sample governance scorecard. Six weeks ending 4 Oct 2026. */

export const GOV_WEEKS = ['2026-08-30', '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27', '2026-10-04'] as const

export const KPIS = [
  {
    id: 'forecast',
    name: 'Forecast accuracy',
    definition: 'Actual volume and handle time against the forecast, for the week and for each interval.',
    target: 'Within ±5% for the week. Interval error at or under 10%.',
    owner: 'Central forecasting',
    plain: 'Did we predict the work well enough to staff it?',
  },
  {
    id: 'staffing',
    name: 'Staffing fit',
    definition: 'Share of intervals where the people on the schedule are within ±5% of what the forecast needs.',
    target: 'At least 85% of intervals.',
    owner: 'Regional scheduling',
    plain: 'Were the right number of people scheduled through the day?',
  },
  {
    id: 'adherence',
    name: 'Adherence and conformance',
    definition: 'People on the right activity at the right time, and hours worked against hours scheduled.',
    target: 'Adherence at least 92%. Conformance between 98% and 102%.',
    owner: 'Operations leaders',
    plain: 'Did people work the plan they were given?',
  },
  {
    id: 'capacity',
    name: 'Capacity plan accuracy',
    definition: 'Actual headcount and seats against the plan, looking 24 weeks ahead.',
    target: 'Headcount within ±3%. No unplanned seat shortfall.',
    owner: 'Capacity, talent, and finance',
    plain: 'Will we have the people and the desks we said we would?',
  },
  {
    id: 'sop',
    name: 'SOP and data compliance',
    definition: 'Audit score, changes that skipped approval, and reports built on certified data.',
    target: 'Audit at least 95%. No unapproved change. Certified data at 100%.',
    owner: 'Regional workforce leads',
    plain: 'Are we following the signed way of working, on numbers we trust?',
  },
] as const

export type KpiId = (typeof KPIS)[number]['id']
export type RegionName = 'APAC' | 'India' | 'EMEA' | 'AMER'
export type Tone = 'pass' | 'fail'

export type Reading = {
  forecastError: number
  wmape: number
  staffingFit: number
  adherence: number
  conformance: number
  hcGap: number
  seatShortfalls: number
  audit: number
  unapproved: number
  certified: number
}

export type GovSite = {
  id: string
  name: string
  region: RegionName
  weeks: Reading[]
}

export const CADENCE = [
  {
    id: 'daily',
    name: 'Daily',
    title: 'Site intraday huddle',
    plain: 'A short huddle on the floor. Fix what is breaking today. Do not wait for Friday.',
    looksAt: ['staffing', 'adherence'] as KpiId[],
  },
  {
    id: 'weekly',
    name: 'Weekly',
    title: 'Regional compliance review',
    plain: 'Leaders read the scorecard. Anything red needs a cause, and a fix, before the next week.',
    looksAt: ['forecast', 'staffing', 'adherence', 'capacity', 'sop'] as KpiId[],
  },
  {
    id: 'monthly',
    name: 'Monthly',
    title: 'Global workforce council',
    plain: 'Finance and operations sit with workforce planning. A change to the rules needs this room.',
    looksAt: ['capacity', 'sop'] as KpiId[],
  },
  {
    id: 'quarterly',
    name: 'Quarterly',
    title: 'Client and standard review',
    plain: 'Refresh the standard and look at the audit again. A green from last quarter is not a free pass.',
    looksAt: ['sop', 'forecast'] as KpiId[],
  },
] as const

export type CadenceId = (typeof CADENCE)[number]['id']

export const LOOP = [
  { id: 'measure', name: 'Measure', plain: 'The week closes. The five numbers are in.' },
  { id: 'review', name: 'Review', plain: 'The regional review reads the scorecard out loud.' },
  { id: 'cause', name: 'Root cause', plain: 'A red item needs a cause, not a shrug.' },
  { id: 'fix', name: 'Fix or change the standard', plain: 'Correct the site. If the rule itself is wrong, the monthly council has to approve the change.' },
  { id: 'reaudit', name: 'Re-audit', plain: 'Score it again. The quarterly review checks that the fix held.' },
] as const

const HEALTHY: Reading = {
  forecastError: 1.8,
  wmape: 6.4,
  staffingFit: 91,
  adherence: 94.2,
  conformance: 100.1,
  hcGap: 1.1,
  seatShortfalls: 0,
  audit: 97,
  unapproved: 0,
  certified: 100,
}

export const GOV_SITES: GovSite[] = [
  site('manila', 'Manila', 'APAC', HEALTHY),
  site('cebu', 'Cebu', 'APAC', HEALTHY, { at: 4, patch: { forecastError: 6.4, wmape: 11.2 } }),
  site('hyderabad', 'Hyderabad', 'India', HEALTHY, {
    at: 4,
    patch: { hcGap: 6.4, seatShortfalls: 3 },
    andNext: { hcGap: 5.8, seatShortfalls: 4 },
  }),
  site('pune', 'Pune', 'India', HEALTHY, {
    at: 4,
    patch: { staffingFit: 79 },
    andNext: { staffingFit: 76 },
  }),
  site('dublin', 'Dublin', 'EMEA', HEALTHY),
  site('cairo', 'Cairo', 'EMEA', HEALTHY, {
    at: 4,
    patch: { audit: 88, unapproved: 2 },
    andNext: { audit: 90, unapproved: 1 },
  }),
  site('dallas', 'Dallas', 'AMER', HEALTHY, {
    at: 4,
    patch: { adherence: 90.4, conformance: 103.2 },
    andNext: { adherence: 91.1, conformance: 103.4 },
  }),
  site('tampa', 'Tampa', 'AMER', HEALTHY, { at: 5, patch: { staffingFit: 84 } }),
]

const CAUSES: Partial<Record<string, string>> = {
  'cebu:forecast': 'A campaign mailer went out a day early. The Monday forecast was not rebuilt.',
  'hyderabad:capacity': 'The new-hire class slipped two weeks, and the extra seats were never ordered.',
  'pune:staffing': 'Breaks were left off the schedule, so midday intervals ran short.',
  'cairo:sop': 'The client pack was edited after sign-off. Those edits were not approved.',
  'dallas:adherence': 'A local overtime rule pulled people off the planned activity after lunch.',
  'tampa:staffing': 'One interval was thin after a same-day absence. The next day was covered.',
}

export function weekLabel(iso: string): string {
  const date = new Date(`${iso}T12:00:00`)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function kpiTone(reading: Reading, kpi: KpiId): Tone {
  if (kpi === 'forecast') return Math.abs(reading.forecastError) <= 5 && reading.wmape <= 10 ? 'pass' : 'fail'
  if (kpi === 'staffing') return reading.staffingFit >= 85 ? 'pass' : 'fail'
  if (kpi === 'adherence') {
    return reading.adherence >= 92 && reading.conformance >= 98 && reading.conformance <= 102 ? 'pass' : 'fail'
  }
  if (kpi === 'capacity') return Math.abs(reading.hcGap) <= 3 && reading.seatShortfalls === 0 ? 'pass' : 'fail'
  return reading.audit >= 95 && reading.unapproved === 0 && reading.certified >= 100 ? 'pass' : 'fail'
}

export function tones(site: GovSite, kpi: KpiId): Tone[] {
  return site.weeks.map((reading) => kpiTone(reading, kpi))
}

/** Red on the latest week, and red the week before. */
export function needsRecovery(site: GovSite, kpi: KpiId): boolean {
  const row = tones(site, kpi)
  return row.at(-1) === 'fail' && row.at(-2) === 'fail'
}

export function latestReading(site: GovSite): Reading {
  return site.weeks[site.weeks.length - 1]!
}

export function valueLine(reading: Reading, kpi: KpiId): string {
  if (kpi === 'forecast') return `${signed(reading.forecastError)} week · ${reading.wmape}% interval`
  if (kpi === 'staffing') return `${reading.staffingFit}% of intervals`
  if (kpi === 'adherence') return `${reading.adherence}% adherence · ${reading.conformance}% conformance`
  if (kpi === 'capacity') {
    const desks = reading.seatShortfalls === 1 ? '1 unplanned shortfall' : `${reading.seatShortfalls} unplanned shortfalls`
    return `${signed(reading.hcGap)} headcount · ${desks}`
  }
  const edits = reading.unapproved === 1 ? '1 unapproved change' : `${reading.unapproved} unapproved changes`
  return `${reading.audit}% audit · ${edits}`
}

export function causeFor(site: GovSite, kpi: KpiId): string {
  return CAUSES[`${site.id}:${kpi}`] ?? 'The miss is real, and the owner still owes a cause.'
}

export function loopStep(site: GovSite, kpi: KpiId): (typeof LOOP)[number]['id'] {
  const row = tones(site, kpi)
  if (row.at(-1) !== 'fail') return 'measure'
  if (row.at(-2) === 'fail') return 'cause'
  return 'review'
}

export function plainStatus(site: GovSite, kpi: KpiId): string {
  const name = KPIS.find((item) => item.id === kpi)?.name ?? kpi
  const latest = latestReading(site)
  if (needsRecovery(site, kpi)) {
    return `${site.name} has missed ${name.toLowerCase()} for two weeks in a row (${valueLine(latest, kpi)}). A recovery plan is due in five days, and it is escalated to the executives.`
  }
  if (kpiTone(latest, kpi) === 'fail') {
    return `${site.name} missed ${name.toLowerCase()} this week (${valueLine(latest, kpi)}). The weekly review has to name the cause before it becomes a second red week.`
  }
  return `${site.name} is inside the target for ${name.toLowerCase()} (${valueLine(latest, kpi)}).`
}

function signed(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return `${rounded > 0 ? '+' : ''}${rounded}%`
}

function site(
  id: string,
  name: string,
  region: RegionName,
  base: Reading,
  shock?: { at: number; patch: Partial<Reading>; andNext?: Partial<Reading> },
): GovSite {
  const weeks = GOV_WEEKS.map(() => ({ ...base }))
  if (shock) {
    weeks[shock.at] = { ...weeks[shock.at]!, ...shock.patch }
    if (shock.andNext) weeks[shock.at + 1] = { ...weeks[shock.at + 1]!, ...shock.andNext }
  }
  return { id, name, region, weeks }
}
